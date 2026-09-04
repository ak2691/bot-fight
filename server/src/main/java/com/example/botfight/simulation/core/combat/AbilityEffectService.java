package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.DistanceCalculator.between;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.state.BotMovementService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Applies ordered direct ability effects after delivery. */
@Service
class AbilityEffectService {
    private final BotStateService botStateService;
    private final BotMovementService movementService;
    private final AbilityHitDetectionService hitDetectionService;

    AbilityEffectService(BotStateService botStateService,
                         BotMovementService movementService,
                         AbilityHitDetectionService hitDetectionService) {
        this.botStateService = botStateService;
        this.movementService = movementService;
        this.hitDetectionService = hitDetectionService;
    }

    void resolveTriggeredAbility(Bot attacker, Bot defender, Arena arena) {
        resolveTriggeredAbility(attacker, defender, arena, false);
    }

    private void resolveTriggeredAbility(Bot attacker, Bot defender, Arena arena, boolean skipTeleport) {
        AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(attacker);
        if (payload == null || !hitDetectionService.isDirectDelivery(payload.contract().delivery())) return;
        if (payload.contract().delivery() != DeliveryType.SELF
                && (defender == null || defender.hp <= 0)) return;
        if (payload.contract().delivery() != DeliveryType.SELF
                && defender != attacker
                && defender.entityTeam() == attacker.entityTeam()) return;

        boolean targetHit = payload.contract().delivery() == DeliveryType.SELF
                || hitDetectionService.abilityHitsTarget(attacker, defender, payload);
        if (!targetHit) return;
        boolean hostileImpact = payload.contract().delivery() != DeliveryType.SELF
                && !defender.ignoresHostileEffects();
        if (!hostileImpact && payload.contract().delivery() != DeliveryType.SELF) return;

        double sourceX = payload.hasCapturedPose() ? payload.capturedOriginX() : attacker.x;
        double sourceY = payload.hasCapturedPose() ? payload.capturedOriginY() : attacker.y;
        applyContractEffects(attacker, defender, payload, arena, sourceX, sourceY, skipTeleport);
    }

    void resolveTriggeredAbilities(Bot attacker, List<Bot> bots, Arena arena) {
        AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(attacker);
        if (payload == null || !hitDetectionService.isDirectDelivery(payload.contract().delivery())) return;
        // Browser combat attaches the transient visual before applying any
        // effect (including teleport). Preserve that exact activation pose in
        // the authoritative frame so replay can use the same origin.
        attacker.visualOriginX = attacker.x;
        attacker.visualOriginY = attacker.y;
        attacker.visualOriginRotation = attacker.rotation;
        if (payload.contract().delivery() == DeliveryType.SELF) {
            resolveTriggeredAbility(attacker, null, arena);
            return;
        }
        if (!payload.contract().execution().teleportOncePerActivation()) {
            bots.stream()
                    .filter(defender -> defender != attacker
                            && defender.entityTeam() != attacker.entityTeam())
                    .forEach(defender -> resolveTriggeredAbility(attacker, defender, arena));
            return;
        }

        double sourceX = payload.hasCapturedPose() ? payload.capturedOriginX() : attacker.x;
        double sourceY = payload.hasCapturedPose() ? payload.capturedOriginY() : attacker.y;
        List<Bot> hitTargets = bots.stream()
                .filter(defender -> defender != attacker
                        && defender.hp > 0
                        && defender.entityTeam() != attacker.entityTeam())
                .filter(defender -> hitDetectionService.abilityHitsTarget(attacker, defender, payload))
                .sorted(Comparator.comparingDouble(defender -> between(sourceX, sourceY, defender.x, defender.y)))
                .toList();
        boolean teleportApplied = false;
        for (Bot defender : hitTargets) {
            boolean canApplyTeleport = !defender.ignoresHostileEffects();
            resolveTriggeredAbility(attacker, defender, arena, teleportApplied);
            if (!teleportApplied && canApplyTeleport) teleportApplied = true;
        }
    }

    private void applyContractEffects(Bot attacker, Bot defender,
                                      AbilityExecutionPayload payload,
                                      Arena arena,
                                      double sourceX,
                                      double sourceY,
                                      boolean skipTeleport) {
        AbilityContracts.AbilityPhase phase = firstPhase(payload);
        Map<String, AbilityContracts.EffectOverride> overrides = phase == null
                ? Map.of() : phase.effectOverrides();
        Double rangeOverride = phase == null ? null : phaseRange(phase.statOverrides());
        double confirmedDamage = 0;
        for (AbilityContracts.Effect effect : directPhaseEffects(payload)) {
            double distance = defender == null ? 0 : between(sourceX, sourceY, defender.x, defender.y);
            AbilityContracts.Effect resolved = withEffectOverride(effect, effectOverrideFor(effect, overrides));
            resolved = withResolvedDuration(payload, resolved, distance, rangeOverride);
            switch (resolved.type()) {
                case DAMAGE -> {
                    if (defender == null || defender.hp <= 0) continue;
                    double hpBefore = defender.hp;
                    double damage = amountForEffect(payload, resolved, distance, rangeOverride)
                            * botStateService.damageMultiplier(attacker);
                    botStateService.applyDamage(defender, damage, attacker.slot, sourceX, sourceY);
                    confirmedDamage += Math.max(0, hpBefore - defender.hp);
                }
                case HEALING -> {
                    if (resolved.requiresConfirmedDamage() && confirmedDamage <= 0) continue;
                    Bot recipient = "target".equals(resolved.recipient()) || "defender".equals(resolved.recipient())
                            ? defender : attacker;
                    if (recipient == null) continue;
                    recipient.pendingHealing += resolved.mirrorsDamage()
                            ? confirmedDamage : amountForEffect(payload, resolved, distance, rangeOverride);
                }
                case BUFF -> applyBuff(payload, attacker, resolved);
                case DAMAGE_REDUCTION -> applyDefensiveStatus(attacker, "reactive-armor", payload,
                        resolved.durationMs(),
                        new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                                .damageModifier(-Math.max(0, resolved.amount())));
                case DAMAGE_REFLECTION -> applyDefensiveStatus(attacker, "reactive-armor", payload,
                        resolved.durationMs(),
                        new StatusEffectState.Effect("damage_reflection", "constant")
                                .multiplier(Math.max(0, resolved.amount())));
                case DAMAGE_IMMUNITY -> applyDefensiveStatus(attacker, "absolute-guard", payload,
                        resolved.durationMs(),
                        new StatusEffectState.Effect("damage_immunity", "constant")
                                .amount(Math.max(0, resolved.amount())));
                case STATUS -> applyStatusEffect(attacker, defender, payload, resolved);
                case INTERRUPT -> {
                    if (defender == null || defender.hp <= 0) continue;
                    BotStateService.applyInterrupt(defender, resolved.durationMs(), payload.abilityId());
                }
                case KNOCKBACK -> {
                    if (defender == null || arena == null) continue;
                    movementService.applyKnockback(defender, defender.x - attacker.x,
                            defender.y - attacker.y, amountForEffect(payload, resolved, distance, rangeOverride), arena);
                }
                case TELEPORT -> {
                    if (!skipTeleport && defender != null && arena != null) {
                        double teleportDistance = "center_distance".equals(resolved.distanceMode())
                                ? between(sourceX, sourceY, defender.x, defender.y)
                                : amountForEffect(payload, resolved, distance, rangeOverride);
                        movementService.applyTeleport(attacker, defender, teleportDistance, payload, arena);
                    }
                }
                case MOVEMENT -> {
                    if (arena != null && payload.contract().execution().movement() != null
                            && attacker.dashActiveMs <= 0) {
                        movementService.startDash(attacker, payload, arena);
                    }
                }
                case RESTORE_STATE -> {
                    attacker.temporalRewindX = attacker.x;
                    attacker.temporalRewindY = attacker.y;
                    attacker.temporalRewindHp = attacker.hp;
                    attacker.temporalRewindMs = resolved.durationMs() > 0
                            ? resolved.durationMs() : (int) Math.round(payload.definition().stats()
                                    .getOrDefault("delayMs", 0.0));
                    attacker.temporalRewindPulseMs = 0;
                }
                default -> { }
            }
        }
    }

    /** Reads direct effects from the canonical active phase before root fallback. */
    private static List<AbilityContracts.Effect> directPhaseEffects(AbilityExecutionPayload payload) {
        AbilityContracts.AbilityPhase phase = firstPhase(payload);
        if (phase == null) return payload.contract().effects();
        AbilityContracts.PhaseEventType eventType = payload.contract().delivery()
                == DeliveryType.SELF
                ? AbilityContracts.PhaseEventType.ACTIVATION
                : AbilityContracts.PhaseEventType.COLLISION;
        AbilityContracts.PhaseEvent event = phase.events().get(eventType);
        if (event != null && !event.actions().contains(AbilityContracts.PhaseAction.APPLY_EFFECTS)) {
            return List.of();
        }
        List<AbilityContracts.Effect> declared = phase.effects().isEmpty()
                ? payload.contract().effects() : phase.effects();
        Set<AbilityContracts.EffectType> allowed = event == null ? Set.of() : event.effectTypes();
        return declared.stream()
                .filter(effect -> effect.type() != AbilityContracts.EffectType.SPAWN_ENTITY)
                .filter(effect -> allowed.isEmpty() || allowed.contains(effect.type()))
                .toList();
    }

    private static AbilityContracts.AbilityPhase firstPhase(AbilityExecutionPayload payload) {
        return payload.contract().phases().isEmpty()
                ? null : payload.contract().phases().getFirst();
    }

    private static void applyBuff(AbilityExecutionPayload payload, Bot target, AbilityContracts.Effect effect) {
        if (!"overclock".equals(effect.subtype())) return;
        StatusEffectState status = new StatusEffectState("overclock", effect.durationMs(), 0)
                .addEffect(new StatusEffectState.Effect("cooldown_modifier", "constant")
                        .multiplier(Math.max(0, 1.0 - effect.amount())));
        status.abilityId = payload.abilityId();
        BotStateService.upsertStatusEffect(target, status);
    }

    private static void applyDefensiveStatus(Bot target, String type,
                                             AbilityExecutionPayload payload,
                                             int durationMs,
                                             StatusEffectState.Effect application) {
        StatusEffectState status = new StatusEffectState(type, durationMs, 0);
        status.abilityId = payload.abilityId();
        status.addEffect(application);
        BotStateService.upsertStatusEffect(target, status);
    }

    private void applyStatusEffect(Bot attacker, Bot defender, AbilityExecutionPayload payload,
                                   AbilityContracts.Effect effect) {
        if (defender == null || defender.hp <= 0) return;
        int durationMs = effect.durationMs();
        switch (effect.subtype()) {
            case "burn" -> {
                Abilities.DamageOverTime dot = payload.definition().damageOverTime();
                StatusEffectState status = new StatusEffectState("burn", durationMs,
                        Abilities.statusIntervalMs(payload.abilityId(), "burn", 1_000));
                status.sourceSlot = attacker.slot;
                status.abilityId = payload.abilityId();
                status.addEffect(new StatusEffectState.Effect("damage", "tick")
                        .amount(dot == null ? 0 : dot.damage())
                        .multiplier(botStateService.damageMultiplier(attacker)));
                BotStateService.upsertStatusEffect(defender, status);
            }
            case "slow" -> BotStateService.upsertStatusEffect(defender,
                    statusWithAbility(payload.abilityId(), new StatusEffectState("slow", durationMs, 0)
                            .addEffect(new StatusEffectState.Effect("movement_modifier", "constant")
                                    .movement(HitStagger.CONCUSSIVE_MOVEMENT_MULTIPLIER,
                                            HitStagger.CONCUSSIVE_ROTATION_MULTIPLIER))));
            case "stun" -> {
                StatusEffectState stun = statusWithAbility(payload.abilityId(), new StatusEffectState("stun", durationMs, 0)
                        .addEffect(new StatusEffectState.Effect("stun", "constant")));
                BotStateService.upsertStatusEffect(defender, stun);
                defender.movementVelocityX = 0;
                defender.movementVelocityY = 0;
                defender.velocityX = 0;
                defender.velocityY = 0;
            }
            case "silence" -> {
                StatusEffectState silence = statusWithAbility(payload.abilityId(), new StatusEffectState("silence", durationMs, 0)
                        .addEffect(new StatusEffectState.Effect("silence", "constant")));
                BotStateService.upsertStatusEffect(defender, silence);
            }
            case "shock" -> {
                StatusEffectState shock = new StatusEffectState("shock", durationMs,
                        Abilities.statusIntervalMs(payload.abilityId(), "shock", 1_000));
                shock.sourceSlot = attacker.slot;
                shock.abilityId = payload.abilityId();
                shock.addEffect(new StatusEffectState.Effect("damage", "tick")
                                .amount(Abilities.stat(payload.abilityId(), "shockDamage", 0)))
                        .addEffect(new StatusEffectState.Effect("movement_lock", "tick")
                                .durationMs((int) Math.round(Abilities.stat(payload.abilityId(), "movementLockMs", 0))));
                BotStateService.upsertStatusEffect(defender, shock);
            }
            case "bleed" -> {
                StatusEffectState bleed = new StatusEffectState("bleed", durationMs,
                        Abilities.statusIntervalMs(payload.abilityId(), "bleed", 1_000));
                bleed.sourceSlot = attacker.slot;
                bleed.abilityId = payload.abilityId();
                bleed.addEffect(new StatusEffectState.Effect("damage", "tick")
                        .amount(AbilityContracts.effectAmount(payload.abilityId(), EffectType.STATUS)))
                        .addEffect(new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                                .damageModifier(StatusEffectState.BLEED_INCOMING_DAMAGE_MODIFIER)
                                .rounding(StatusEffectState.TRUNCATE_DAMAGE_TO_TENTHS)
                                .excludeDamageSourceType("bleed"));
                BotStateService.upsertStatusEffect(defender, bleed);
            }
            default -> { }
        }
    }

    private static StatusEffectState statusWithAbility(int abilityId, StatusEffectState status) {
        status.abilityId = abilityId;
        return status;
    }

    private static AbilityContracts.Effect withResolvedDuration(
            AbilityExecutionPayload payload, AbilityContracts.Effect effect,
            double distance, Double rangeOverride) {
        int durationMs = durationForEffect(payload, effect, distance, rangeOverride);
        if (durationMs == effect.durationMs()) return effect;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(), effect.amount(),
                durationMs, effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), effect.falloff());
    }

    private static AbilityContracts.Effect withEffectOverride(
            AbilityContracts.Effect effect, AbilityContracts.EffectOverride override) {
        if (effect == null || override == null) return effect;
        double amount = override.amount() == null ? effect.amount() : override.amount();
        int durationMs = override.durationMs() == null ? effect.durationMs() : override.durationMs();
        AbilityContracts.Falloff falloff = effect.falloff();
        if (override.falloff() != null) {
            falloff = falloff == null ? override.falloff() : falloff.mergedWith(override.falloff());
        } else if (override.amount() != null) {
            falloff = null;
        }
        if (amount == effect.amount() && durationMs == effect.durationMs()
                && falloff == effect.falloff()) return effect;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(), amount,
                durationMs, effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff);
    }

    private static AbilityContracts.EffectOverride effectOverrideFor(
            AbilityContracts.Effect effect,
            Map<String, AbilityContracts.EffectOverride> overrides) {
        if (effect == null || overrides == null || overrides.isEmpty()) return null;
        String qualifiedKey = AbilityContracts.effectOverrideKey(effect);
        AbilityContracts.EffectOverride qualified = qualifiedKey == null
                ? null : overrides.get(qualifiedKey);
        if (qualified != null) return qualified;
        return effect.type() == null ? null
                : overrides.get(effect.type().name().toLowerCase());
    }

    private static Double phaseRange(Map<String, Double> statOverrides) {
        if (statOverrides == null) return null;
        Double range = statOverrides.get("range");
        return range != null ? range : statOverrides.get("radius");
    }

    private static double amountForEffect(AbilityExecutionPayload payload,
                                          AbilityContracts.Effect effect,
                                          double distance,
                                          Double rangeOverride) {
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(payload.abilityId(), distance,
                    effect.falloff(), rangeOverride == null
                            ? payload.definition().range() : rangeOverride);
        }
        return effect.runtimeComputed()
                ? Abilities.amountAtDistance(payload.abilityId(), distance, null,
                        rangeOverride == null ? payload.definition().range() : rangeOverride)
                : effect.amount();
    }

    private static int durationForEffect(AbilityExecutionPayload payload,
                                         AbilityContracts.Effect effect,
                                         double distance,
                                         Double rangeOverride) {
        return Abilities.durationAtDistance(payload.abilityId(), distance,
                effect.durationMs(), effect.falloff(), rangeOverride == null
                        ? payload.definition().range() : rangeOverride);
    }
}
