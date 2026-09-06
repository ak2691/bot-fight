package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.DistanceCalculator.between;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.state.BotMovementService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Applies ordered phase effects for attached activations and impacts. */
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
        if (payload == null || (!hitDetectionService.isAttachedAbility(payload)
                && !hitDetectionService.hasActivationEvent(payload))) return;
        boolean targetsOwner = hitDetectionService.hasActivationEvent(payload);
        if (!targetsOwner
                && (defender == null || defender.hp <= 0)) return;
        if (!targetsOwner
                && defender != attacker
                && defender.entityTeam() == attacker.entityTeam()) return;

        boolean targetHit = targetsOwner
                || hitDetectionService.abilityHitsTarget(attacker, defender, payload);
        if (!targetHit) return;
        boolean hostileImpact = !targetsOwner
                && !defender.ignoresHostileEffects();
        if (!hostileImpact && !targetsOwner) return;

        double sourceX = payload.hasCapturedPose() ? payload.capturedOriginX() : attacker.x;
        double sourceY = payload.hasCapturedPose() ? payload.capturedOriginY() : attacker.y;
        applyContractEffects(attacker, defender, payload, arena, sourceX, sourceY, skipTeleport);
    }

    void resolveTriggeredAbilities(Bot attacker, List<Bot> bots, Arena arena) {
        AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(attacker);
        if (payload == null || (!hitDetectionService.isAttachedAbility(payload)
                && !hitDetectionService.hasActivationEvent(payload))) return;
        // Browser combat attaches the transient visual before applying any
        // effect (including teleport). Preserve that exact activation pose in
        // the authoritative frame so replay can use the same origin.
        attacker.visualOriginX = attacker.x;
        attacker.visualOriginY = attacker.y;
        attacker.visualOriginRotation = attacker.rotation;
        if (hitDetectionService.hasActivationEvent(payload)) {
            resolveTriggeredAbility(attacker, null, arena);
            return;
        }
        if (!payload.activation().teleportOncePerActivation()) {
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
        AttachedAbilityContracts.AbilityPhase phase = firstPhase(payload);
        Map<String, AttachedAbilityContracts.EffectOverride> overrides = phase == null
                ? Map.of() : phase.effectOverrides();
        Double rangeOverride = phase == null ? null : phaseRange(phase);
        double confirmedDamage = 0;
        for (AttachedAbilityContracts.Effect effect : directPhaseEffects(payload)) {
            double distance = defender == null ? 0 : between(sourceX, sourceY, defender.x, defender.y);
            AttachedAbilityContracts.Effect resolved = withEffectOverride(effect, effectOverrideFor(effect, overrides));
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
                case RESTORE_STATE -> {
                    attacker.temporalRewindX = attacker.x;
                    attacker.temporalRewindY = attacker.y;
                    attacker.temporalRewindHp = attacker.hp;
                    attacker.temporalRewindMs = resolved.durationMs();
                    attacker.temporalRewindPulseMs = 0;
                }
                default -> { }
            }
        }
        AttachedAbilityContracts.PhaseMovement movement = phase == null ? null : phase.movement();
        if (arena != null && movement != null && movement.distance() != null
                && attacker.dashActiveMs <= 0) {
            movementService.startDash(attacker, payload, arena);
        }
    }

    /** Reads direct effects from the canonical active phase before root fallback. */
    private static List<AttachedAbilityContracts.Effect> directPhaseEffects(AbilityExecutionPayload payload) {
        AttachedAbilityContracts.AbilityPhase phase = firstPhase(payload);
        if (phase == null) return List.of();
        AttachedAbilityContracts.PhaseEvent event = phase.events().get(
                AttachedAbilityContracts.PhaseEventType.ACTIVATION);
        if (event == null && AttachedAbilityContracts.isAttachedAbility(payload.abilityId())) {
            event = phase.events().get(AttachedAbilityContracts.PhaseEventType.COLLISION);
        }
        if (event != null && !event.actions().contains(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)) {
            return List.of();
        }
        List<AttachedAbilityContracts.Effect> declared = phase.effects();
        Set<AttachedAbilityContracts.EffectType> allowed = event == null ? Set.of() : event.effectTypes();
        return declared.stream()
                .filter(effect -> allowed.isEmpty() || allowed.contains(effect.type()))
                .toList();
    }

    private static AttachedAbilityContracts.AbilityPhase firstPhase(AbilityExecutionPayload payload) {
        return payload.phases().isEmpty()
                ? null : payload.phases().getFirst();
    }

    private static void applyBuff(AbilityExecutionPayload payload, Bot target, AttachedAbilityContracts.Effect effect) {
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
                                   AttachedAbilityContracts.Effect effect) {
        applyStatusEffect(attacker, defender, payload.abilityId(), effect);
    }

    void applyStatusEffect(Bot attacker, Bot defender, int abilityId,
                           AttachedAbilityContracts.Effect effect) {
        if (defender == null || defender.hp <= 0) return;
        int durationMs = effect.durationMs();
        switch (effect.subtype()) {
            case "burn" -> {
                StatusEffectState status = new StatusEffectState("burn", durationMs,
                        effect.intervalMs() == null ? 1_000 : Math.max(0, effect.intervalMs()));
                status.sourceSlot = attacker.slot;
                status.abilityId = abilityId;
                status.addEffect(new StatusEffectState.Effect("damage", "tick")
                        .amount(effect.amount())
                        .multiplier(botStateService.damageMultiplier(attacker)));
                BotStateService.upsertStatusEffect(defender, status);
            }
            case "slow" -> BotStateService.upsertStatusEffect(defender,
                    statusWithAbility(abilityId, new StatusEffectState("slow", durationMs, 0)
                            .addEffect(new StatusEffectState.Effect("movement_modifier", "constant")
                                    .movement(HitStagger.CONCUSSIVE_MOVEMENT_MULTIPLIER,
                                            HitStagger.CONCUSSIVE_ROTATION_MULTIPLIER))));
            case "stun" -> {
                StatusEffectState stun = statusWithAbility(abilityId, new StatusEffectState("stun", durationMs, 0)
                        .addEffect(new StatusEffectState.Effect("stun", "constant")));
                BotStateService.upsertStatusEffect(defender, stun);
                defender.movementVelocityX = 0;
                defender.movementVelocityY = 0;
                defender.velocityX = 0;
                defender.velocityY = 0;
            }
            case "silence" -> {
                StatusEffectState silence = statusWithAbility(abilityId, new StatusEffectState("silence", durationMs, 0)
                        .addEffect(new StatusEffectState.Effect("silence", "constant")));
                BotStateService.upsertStatusEffect(defender, silence);
            }
            case "shock" -> {
                StatusEffectState shock = new StatusEffectState("shock", durationMs,
                        effect.intervalMs() == null ? 1_000 : Math.max(0, effect.intervalMs()));
                shock.sourceSlot = attacker.slot;
                shock.abilityId = abilityId;
                shock.addEffect(new StatusEffectState.Effect("damage", "tick")
                                .amount(effect.amount()))
                        .addEffect(new StatusEffectState.Effect("movement_lock", "tick")
                                .durationMs(effect.movementLockMs() == null ? 0 : effect.movementLockMs()));
                BotStateService.upsertStatusEffect(defender, shock);
            }
            case "bleed" -> {
                StatusEffectState bleed = new StatusEffectState("bleed", durationMs,
                        effect.intervalMs() == null ? 1_000 : Math.max(0, effect.intervalMs()));
                bleed.sourceSlot = attacker.slot;
                bleed.abilityId = abilityId;
                bleed.addEffect(new StatusEffectState.Effect("damage", "tick")
                        .amount(effect.amount()))
                        .addEffect(new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                                .damageModifier(StatusEffectState.BLEED_INCOMING_DAMAGE_MODIFIER)
                                .rounding(StatusEffectState.TRUNCATE_DAMAGE_TO_TENTHS)
                                .excludeDamageSourceType("bleed"));
                BotStateService.upsertStatusEffect(defender, bleed);
            }
            default -> throw new IllegalArgumentException(
                    "Unsupported status effect subtype for ability " + abilityId + ": " + effect.subtype());
        }
    }

    private static StatusEffectState statusWithAbility(int abilityId, StatusEffectState status) {
        status.abilityId = abilityId;
        return status;
    }

    private static AttachedAbilityContracts.Effect withResolvedDuration(
            AbilityExecutionPayload payload, AttachedAbilityContracts.Effect effect,
            double distance, Double rangeOverride) {
        int durationMs = durationForEffect(payload, effect, distance, rangeOverride);
        if (durationMs == effect.durationMs()) return effect;
        return new AttachedAbilityContracts.Effect(effect.type(), effect.subtype(), effect.amount(),
                durationMs, effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), effect.falloff(), effect.intervalMs(), effect.movementLockMs());
    }

    private static AttachedAbilityContracts.Effect withEffectOverride(
            AttachedAbilityContracts.Effect effect, AttachedAbilityContracts.EffectOverride override) {
        if (effect == null || override == null) return effect;
        double amount = override.amount() == null ? effect.amount() : override.amount();
        int durationMs = override.durationMs() == null ? effect.durationMs() : override.durationMs();
        AttachedAbilityContracts.Falloff falloff = effect.falloff();
        if (override.falloff() != null) {
            falloff = falloff == null ? override.falloff() : falloff.mergedWith(override.falloff());
        } else if (override.amount() != null) {
            falloff = null;
        }
        if (amount == effect.amount() && durationMs == effect.durationMs()
                && falloff == effect.falloff()) return effect;
        return new AttachedAbilityContracts.Effect(effect.type(), effect.subtype(), amount,
                durationMs, effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff, effect.intervalMs(), effect.movementLockMs());
    }

    private static AttachedAbilityContracts.EffectOverride effectOverrideFor(
            AttachedAbilityContracts.Effect effect,
            Map<String, AttachedAbilityContracts.EffectOverride> overrides) {
        if (effect == null || overrides == null || overrides.isEmpty()) return null;
        String qualifiedKey = AttachedAbilityContracts.effectOverrideKey(effect);
        AttachedAbilityContracts.EffectOverride qualified = qualifiedKey == null
                ? null : overrides.get(qualifiedKey);
        if (qualified != null) return qualified;
        return effect.type() == null ? null
                : overrides.get(effect.type().name().toLowerCase());
    }

    private static Double phaseRange(AttachedAbilityContracts.AbilityPhase phase) {
        if (phase == null) return null;
        AttachedAbilityContracts.Hitbox hitbox = phase.hitbox();
        if (hitbox != null) {
            if ("circle".equals(hitbox.shape()) && hitbox.radius() != null) return hitbox.radius();
            if (hitbox.range() != null) return hitbox.range();
            if (hitbox.length() != null) return hitbox.length();
        }
        Double range = phase.statOverrides().get("range");
        return range != null ? range : phase.statOverrides().get("radius");
    }

    private static double amountForEffect(AbilityExecutionPayload payload,
                                          AttachedAbilityContracts.Effect effect,
                                          double distance,
                                          Double rangeOverride) {
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
                    return Abilities.amountAtDistance(payload.abilityId(), distance,
                            effect.falloff(), rangeOverride == null
                            ? phaseRange(payload) : rangeOverride);
        }
        return effect.runtimeComputed()
                ? Abilities.amountAtDistance(payload.abilityId(), distance, null,
                        rangeOverride == null ? phaseRange(payload) : rangeOverride)
                : effect.amount();
    }

    private static int durationForEffect(AbilityExecutionPayload payload,
                                         AttachedAbilityContracts.Effect effect,
                                         double distance,
                                         Double rangeOverride) {
        return Abilities.durationAtDistance(payload.abilityId(), distance,
                effect.durationMs(), effect.falloff(), rangeOverride == null
                        ? phaseRange(payload) : rangeOverride);
    }

    private static double phaseRange(AbilityExecutionPayload payload) {
        if (payload == null || payload.phases().isEmpty()) return 0;
        AttachedAbilityContracts.AbilityPhase phase = payload.phases().getFirst();
        AttachedAbilityContracts.Hitbox hitbox = phase.hitbox();
        if (hitbox == null) return 0;
        if ("circle".equals(hitbox.shape())) return hitbox.radius() == null ? 0 : hitbox.radius();
        if ("rectangle".equals(hitbox.shape())) {
            Double length = hitbox.length() == null ? hitbox.range() : hitbox.length();
            return length == null ? 0 : length;
        }
        return hitbox.range() == null ? 0 : hitbox.range();
    }
}
