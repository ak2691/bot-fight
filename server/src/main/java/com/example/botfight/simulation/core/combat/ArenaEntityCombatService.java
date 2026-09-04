package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
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
            if (payload == null || !hitDetectionService.isDirectDelivery(payload.contract().delivery())) continue;
            double range = Abilities.range(payload.abilityId());
            boolean rayHit = payload.contract().delivery() == AbilityContracts.DeliveryType.RAY
                    && hitDetectionService.rayHits(payload, bot, drone.x(), drone.y(), drone.size() / 2.0);
            boolean rangeHit = hitDetectionService.abilityRangeHits(
                    bot, drone.x(), drone.y(), drone.size(), payload, range);
            if (rayHit || rangeHit) damage += (int) Math.round(amountForEffect(payload, distance));
        }
        for (ArenaEntity effect : entities) {
            if (effect == null || effect.id().equals(drone.id())) continue;
            EntityContracts.Phase phase = EntityContracts.phaseFor(effect);
            if (!phaseHasEventEffect(phase, EntityContracts.PhaseEventType.COLLISION, EffectType.DAMAGE)
                    || !overlaps(effect, drone)) continue;
            AbilityContracts.Effect damageEffect = damageEffect(effect.abilityId());
            if (damageEffect == null) continue;
            damageEffect = withEffectOverride(damageEffect,
                    phase.effectOverrides().get(AbilityContracts.effectOverrideKey(damageEffect)));
            double distance = phase.type() == EntityContracts.PhaseType.PROJECTILE
                    ? 0
                    : Math.hypot(effect.x() - drone.x(), effect.y() - drone.y());
            double baseDamage = amountForEffect(effect.abilityId(), damageEffect, distance,
                    phaseRange(phase.statOverrides()));
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
            if (payload == null || !hitDetectionService.isDirectDelivery(payload.contract().delivery())) continue;
            double range = payload.contract().delivery() == AbilityContracts.DeliveryType.RAY
                    ? Abilities.range(payload.abilityId()) : 0;
            if (range > 0 && hitDetectionService.rayHits(payload, bot,
                    mine.x(), mine.y(), mine.size() / 2.0)) return true;
            double meleeRange = Abilities.range(payload.abilityId());
            if (meleeRange > 0 && hitDetectionService.abilityRangeHits(
                    bot, mine.x(), mine.y(), mine.size(), payload, meleeRange)) return true;
        }
        return false;
    }

    private static boolean projectilePhase(ArenaEntity entity) {
        EntityContracts.Phase phase = EntityContracts.phaseFor(entity);
        return phase != null && phase.type() == EntityContracts.PhaseType.PROJECTILE;
    }

    private static AbilityContracts.Effect damageEffect(Integer abilityId) {
        if (abilityId == null) return null;
        return AbilityContracts.get(abilityId).effects().stream()
                .filter(effect -> effect.type() == EffectType.DAMAGE)
                .findFirst().orElse(null);
    }

    private static boolean phaseHasEventEffect(EntityContracts.Phase phase,
                                               EntityContracts.PhaseEventType eventType,
                                               EffectType effectType) {
        EntityContracts.PhaseEvent event = phase == null ? null : phase.events().get(eventType);
        if (event == null || !event.actions().contains(EntityContracts.PhaseAction.APPLY_EFFECTS)) {
            return false;
        }
        Set<EffectType> allowed = event.effectTypes().isEmpty()
                ? phase.effectTypes() : event.effectTypes();
        return allowed.contains(effectType);
    }

    private static double amountForEffect(AbilityExecutionPayload payload, double distance) {
        AbilityContracts.Effect effect = payload.contract().effects().stream()
                .filter(item -> item.type() == EffectType.DAMAGE)
                .findFirst().orElse(null);
        if (effect == null) return 0;
        return amountForEffect(payload.abilityId(), effect, distance, null);
    }

    private static double amountForEffect(int abilityId, AbilityContracts.Effect effect,
                                          double distance, Double rangeOverride) {
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(abilityId, distance,
                    effect.falloff(), rangeOverride);
        }
        return effect.runtimeComputed()
                ? Abilities.amountAtDistance(abilityId, distance, null, rangeOverride)
                : effect.amount();
    }

    private static AbilityContracts.Effect withEffectOverride(
            AbilityContracts.Effect effect,
            AbilityContracts.EffectOverride override) {
        if (override == null) return effect;
        AbilityContracts.Falloff falloff = override.falloff() == null
                ? effect.falloff()
                : effect.falloff() == null
                    ? override.falloff()
                    : effect.falloff().mergedWith(override.falloff());
        if (override.amount() != null && override.falloff() == null) falloff = null;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(),
                override.amount() == null ? effect.amount() : override.amount(),
                override.durationMs() == null ? effect.durationMs() : override.durationMs(),
                effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff);
    }

    private static Double phaseRange(Map<String, Double> statOverrides) {
        if (statOverrides == null) return null;
        Double range = statOverrides.get("range");
        return range != null ? range : statOverrides.get("radius");
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
