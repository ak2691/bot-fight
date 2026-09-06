package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Resolves bot and transient-entity interactions with persistent arena entities. */
@Service
class ArenaEntityCombatService {
    private final AbilityHitDetectionService hitDetectionService;

    ArenaEntityCombatService(AbilityHitDetectionService hitDetectionService) {
        this.hitDetectionService = hitDetectionService;
    }

    int damageToDroneThisTick(ArenaEntity drone, List<Bot> bots,
                              List<ArenaEntity> entities) {
        int damage = 0;
        for (Bot bot : bots) {
            double distance = Math.hypot(drone.x() - bot.x, drone.y() - bot.y);
            AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(bot);
            if (payload == null || !hitDetectionService.isAttachedAbility(payload)) continue;
            double range = hitDetectionService.phaseRange(payload, 0);
            AttachedAbilityContracts.AbilityPhase phase = attachedPhase(payload);
            boolean rayHit = phase != null && phase.hitbox() != null
                    && "ray".equals(phase.hitbox().shape())
                    && hitDetectionService.rayHits(payload, bot, drone.x(), drone.y(), drone.size() / 2.0);
            boolean rangeHit = hitDetectionService.abilityRangeHits(
                    bot, drone.x(), drone.y(), drone.size(), payload, range);
            if (rayHit || rangeHit) damage += (int) Math.round(amountForEffect(payload, distance));
        }
        for (ArenaEntity effect : entities) {
            if (effect == null || effect.id().equals(drone.id())) continue;
            AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(effect);
            if (!phaseHasEventEffect(phase, AttachedAbilityContracts.PhaseEventType.COLLISION, EffectType.DAMAGE)
                    || !overlaps(effect, drone)) continue;
            AttachedAbilityContracts.Effect damageEffect = phase.effects().stream()
                    .filter(item -> item.type() == EffectType.DAMAGE)
                    .findFirst().orElse(null);
            if (damageEffect == null) continue;
            damageEffect = withEffectOverride(damageEffect,
                    phase.effectOverrides().get(AttachedAbilityContracts.effectOverrideKey(damageEffect)));
            double distance = phase.type() == AttachedAbilityContracts.PhaseType.PROJECTILE
                    ? 0
                    : Math.hypot(effect.x() - drone.x(), effect.y() - drone.y());
            double baseDamage = amountForEffect(effect.abilityId(), damageEffect, distance,
                    phaseRange(phase));
            damage += (int) Math.round(baseDamage * effect.damageMultiplier());
        }
        return damage;
    }

    boolean mineHitByCurrentAttack(ArenaEntity mine, List<Bot> bots,
                                   List<ArenaEntity> entities) {
        return mineHitByAttack(mine, bots, entities);
    }

    private boolean mineHitByAttack(ArenaEntity mine, List<Bot> bots,
                                    List<ArenaEntity> entities) {
        if (entities.stream().anyMatch(entity -> entity != mine
                && projectilePhase(entity) && overlaps(entity, mine))) return true;
        for (Bot bot : bots) {
            AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(bot);
            if (payload == null || !hitDetectionService.isAttachedAbility(payload)) continue;
            AttachedAbilityContracts.AbilityPhase phase = attachedPhase(payload);
            double range = phase != null && phase.hitbox() != null
                    && "ray".equals(phase.hitbox().shape())
                    ? hitDetectionService.phaseRange(payload, 0) : 0;
            if (range > 0 && hitDetectionService.rayHits(payload, bot,
                    mine.x(), mine.y(), mine.size() / 2.0)) return true;
            double meleeRange = hitDetectionService.phaseRange(payload, 0);
            if (meleeRange > 0 && hitDetectionService.abilityRangeHits(
                    bot, mine.x(), mine.y(), mine.size(), payload, meleeRange)) return true;
        }
        return false;
    }

    private static boolean projectilePhase(ArenaEntity entity) {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        return phase != null && phase.type() == AttachedAbilityContracts.PhaseType.PROJECTILE;
    }

    private static boolean phaseHasEventEffect(AttachedAbilityContracts.AbilityPhase phase,
                                               AttachedAbilityContracts.PhaseEventType eventType,
                                               EffectType effectType) {
        AttachedAbilityContracts.PhaseEvent event = phase == null ? null : phase.events().get(eventType);
        if (event == null || !event.actions().contains(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)) {
            return false;
        }
        Set<EffectType> allowed = event.effectTypes().isEmpty()
                ? phase.effectTypes() : event.effectTypes();
        return allowed.contains(effectType);
    }

    private static double amountForEffect(AbilityExecutionPayload payload, double distance) {
        AttachedAbilityContracts.Effect effect = payload.phases().stream()
                .flatMap(phase -> phase.effects().stream())
                .filter(item -> item.type() == EffectType.DAMAGE)
                .findFirst().orElse(null);
        if (effect == null) return 0;
        return amountForEffect(payload.abilityId(), effect, distance, null);
    }

    private static double amountForEffect(int abilityId, AttachedAbilityContracts.Effect effect,
                                          double distance, Double rangeOverride) {
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(abilityId, distance,
                    effect.falloff(), rangeOverride);
        }
        return effect.runtimeComputed()
                ? Abilities.amountAtDistance(abilityId, distance, null, rangeOverride)
                : effect.amount();
    }

    private static AttachedAbilityContracts.Effect withEffectOverride(
            AttachedAbilityContracts.Effect effect,
            AttachedAbilityContracts.EffectOverride override) {
        if (override == null) return effect;
        AttachedAbilityContracts.Falloff falloff = override.falloff() == null
                ? effect.falloff()
                : effect.falloff() == null
                    ? override.falloff()
                    : effect.falloff().mergedWith(override.falloff());
        if (override.amount() != null && override.falloff() == null) falloff = null;
        return new AttachedAbilityContracts.Effect(effect.type(), effect.subtype(),
                override.amount() == null ? effect.amount() : override.amount(),
                override.durationMs() == null ? effect.durationMs() : override.durationMs(),
                effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff, effect.intervalMs(), effect.movementLockMs());
    }

    private static Double phaseRange(AttachedAbilityContracts.AbilityPhase phase) {
        if (phase == null) return null;
        AttachedAbilityContracts.Hitbox hitbox = phase.hitbox();
        if (hitbox != null) {
            if (hitbox.range() != null) return hitbox.range();
            if (hitbox.length() != null) return hitbox.length();
            if (hitbox.radius() != null) return hitbox.radius();
        }
        Map<String, Double> statOverrides = phase.statOverrides();
        if (statOverrides == null) return null;
        Double range = statOverrides.get("range");
        return range != null ? range : statOverrides.get("radius");
    }

    private static AttachedAbilityContracts.AbilityPhase attachedPhase(AbilityExecutionPayload payload) {
        return payload.phases().isEmpty() ? null : payload.phases().getFirst();
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return movingCollision(
                first,
                first.x() - first.velocityX(), first.y() - first.velocityY(), first.x(), first.y(),
                second,
                second.x() - second.velocityX(), second.y() - second.velocityY(), second.x(), second.y(),
                0).hit();
    }
}
