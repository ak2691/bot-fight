package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.DistanceCalculator.between;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.state.BotMovementService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.List;
import org.springframework.stereotype.Service;

/** Applies ordered direct ability effects after delivery and shield resolution. */
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

        double sourceX = attacker.x;
        double sourceY = attacker.y;
        AbilityEntitySystem.ShieldResult shield = hostileImpact
                ? botStateService.resolveShield(defender, attacker.x, attacker.y, payload.abilityId())
                : AbilityEntitySystem.ShieldResult.none();
        applyContractEffects(attacker, defender, payload, shield, arena, sourceX, sourceY);
    }

    void resolveTriggeredAbilities(Bot attacker, List<Bot> bots, Arena arena) {
        AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(attacker);
        if (payload == null || !hitDetectionService.isDirectDelivery(payload.contract().delivery())) return;
        if (payload.contract().delivery() == DeliveryType.SELF) {
            resolveTriggeredAbility(attacker, null, arena);
            return;
        }
        bots.stream()
                .filter(defender -> defender != attacker
                        && defender.entityTeam() != attacker.entityTeam())
                .forEach(defender -> resolveTriggeredAbility(attacker, defender, arena));
    }

    private void applyContractEffects(Bot attacker, Bot defender,
                                      AbilityExecutionPayload payload,
                                      AbilityEntitySystem.ShieldResult shield,
                                      Arena arena,
                                      double sourceX,
                                      double sourceY) {
        double confirmedDamage = 0;
        for (AbilityContracts.Effect effect : payload.contract().effects()) {
            if (shield.prevents(effect.type())) continue;
            switch (effect.type()) {
                case DAMAGE -> {
                    if (defender == null || defender.hp <= 0) continue;
                    double hpBefore = defender.hp;
                    double distance = between(sourceX, sourceY, defender.x, defender.y);
                    double damage = damageForEffect(payload, distance)
                            * botStateService.damageMultiplier(attacker);
                    botStateService.applyDamage(defender, damage, attacker.slot, sourceX, sourceY);
                    confirmedDamage += Math.max(0, hpBefore - defender.hp);
                }
                case HEALING -> {
                    if (effect.requiresConfirmedDamage() && confirmedDamage <= 0) continue;
                    Bot recipient = "target".equals(effect.recipient()) || "defender".equals(effect.recipient())
                            ? defender : attacker;
                    if (recipient == null) continue;
                    recipient.pendingHealing += effect.mirrorsDamage() ? confirmedDamage : effect.amount();
                }
                case BUFF -> applyBuff(payload, attacker, effect);
                case DAMAGE_REDUCTION -> applyDefensiveStatus(attacker, "reactive-armor", payload,
                        effect.durationMs(),
                        new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                                .multiplier(Math.max(0, 1.0 - effect.amount())));
                case DAMAGE_REFLECTION -> applyDefensiveStatus(attacker, "reactive-armor", payload,
                        effect.durationMs(),
                        new StatusEffectState.Effect("damage_reflection", "constant")
                                .multiplier(Math.max(0, effect.amount())));
                case DAMAGE_IMMUNITY -> applyDefensiveStatus(attacker, "absolute-guard", payload,
                        effect.durationMs(),
                        new StatusEffectState.Effect("damage_immunity", "constant")
                                .amount(Math.max(0, effect.amount())));
                case DEBUFF -> applyDebuff(attacker, defender, payload, effect);
                case INTERRUPT -> {
                    if (defender == null || defender.hp <= 0) continue;
                    defender.preparingAbility = null;
                    defender.preparingMs = 0;
                    StatusEffectState stun = new StatusEffectState("stun", effect.durationMs(), 0)
                            .addEffect(new StatusEffectState.Effect("stun", "constant"));
                    stun.abilityId = payload.abilityId();
                    BotStateService.upsertStatusEffect(defender, stun);
                }
                case KNOCKBACK -> {
                    if (defender == null || arena == null) continue;
                    movementService.applyKnockback(defender, defender.x - attacker.x,
                            defender.y - attacker.y, effect.amount(), arena);
                }
                case TELEPORT -> {
                    if (defender != null && arena != null) {
                        movementService.applyTeleport(attacker, defender, effect.amount(), payload, arena);
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
                    attacker.temporalRewindMs = effect.durationMs() > 0
                            ? effect.durationMs() : (int) Math.round(payload.definition().stats()
                                    .getOrDefault("delayMs", 0.0));
                    attacker.temporalRewindPulseMs = 0;
                }
                default -> { }
            }
        }
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

    private void applyDebuff(Bot attacker, Bot defender, AbilityExecutionPayload payload,
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
                        .amount(AbilityContracts.effectAmount(payload.abilityId(), EffectType.DEBUFF)));
                BotStateService.upsertStatusEffect(defender, bleed);
            }
            default -> { }
        }
    }

    private static StatusEffectState statusWithAbility(int abilityId, StatusEffectState status) {
        status.abilityId = abilityId;
        return status;
    }

    private static double damageForEffect(AbilityExecutionPayload payload, double distance) {
        AbilityContracts.Effect damageEffect = payload.contract().effects().stream()
                .filter(effect -> effect.type() == EffectType.DAMAGE)
                .findFirst().orElse(null);
        if (damageEffect == null) return 0;
        return damageEffect.runtimeComputed() || !payload.definition().damageFalloff().isEmpty()
                ? Abilities.damageAtDistance(payload.abilityId(), distance) : damageEffect.amount();
    }
}
