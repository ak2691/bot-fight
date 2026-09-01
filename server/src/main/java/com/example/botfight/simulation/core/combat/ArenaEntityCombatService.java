package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import java.util.List;
import org.springframework.stereotype.Service;

/** Resolves bot and transient-entity interactions with persistent arena entities. */
@Service
class ArenaEntityCombatService {
    private final ProjectileSimulationService projectileSimulationService;
    private final AbilityHitDetectionService hitDetectionService;

    ArenaEntityCombatService(ProjectileSimulationService projectileSimulationService,
                             AbilityHitDetectionService hitDetectionService) {
        this.projectileSimulationService = projectileSimulationService;
        this.hitDetectionService = hitDetectionService;
    }

    int damageToDroneThisTick(ArenaEntity drone, List<Bot> bots,
                              List<ArenaEntity> projectileEffects, List<ArenaEntity> projectiles,
                              List<ArenaEntity> placements) {
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
            if (rayHit || rangeHit) damage += (int) Math.round(damageForEffect(payload, distance));
        }
        for (ArenaEntity projectile : projectiles) {
            if (!overlaps(projectile, drone)) continue;
            AbilityContracts.Effect damageEffect = AbilityContracts.get(projectile.abilityId()).effects().stream()
                    .filter(effect -> effect.type() == EffectType.DAMAGE)
                    .findFirst().orElse(null);
            if (damageEffect == null) continue;
            double baseDamage = damageEffect.runtimeComputed()
                    ? Abilities.damageAtDistance(projectile.abilityId(), 0) : damageEffect.amount();
            damage += (int) Math.round(baseDamage * projectile.damageMultiplier());
        }
        for (ArenaEntity effect : projectileEffects) {
            damage += projectileSimulationService.radialDamageToEntity(effect, drone);
        }
        for (ArenaEntity effect : placements) {
            double distance = Math.hypot(effect.x() - drone.x(), effect.y() - drone.y());
            EntityContracts.EntityContract entityContract = EntityContracts.forEntity(effect);
            if (entityContract == null || distance > effect.size() / 2.0) continue;
            for (EntityContracts.Derived derived : entityContract.derived().values()) {
                if (derived.type().equals(effect.type()) && derived.damageAbilityId() > 0) {
                    damage += (int) Math.round(Abilities.damageAtDistance(derived.damageAbilityId(), distance)
                            * effect.damageMultiplier());
                    break;
                }
            }
        }
        return damage;
    }

    boolean mineHitByCurrentAttack(ArenaEntity mine, List<Bot> bots,
                                   List<ArenaEntity> projectiles, List<ArenaEntity> placements) {
        return mineHitByAttack(mine, bots, projectiles, placements);
    }

    private boolean mineHitByAttack(ArenaEntity mine, List<Bot> bots,
                                    List<ArenaEntity> projectiles, List<ArenaEntity> placements) {
        if (projectiles.stream().anyMatch(entity -> overlaps(entity, mine))) return true;
        if (placements.stream().anyMatch(entity -> entity != mine
                && segmentCanHitEntities(entity) && overlaps(entity, mine))) return true;
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

    private static boolean segmentCanHitEntities(ArenaEntity entity) {
        EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
        if (contract == null) return false;
        EntityContracts.Behavior behavior = contract.behaviorFor(entity.type());
        return behavior != null && behavior.kind() == EntityContracts.BehaviorKind.SEGMENT
                && behavior.hit() != null && !behavior.hit().effectTypes().isEmpty();
    }

    private static double damageForEffect(AbilityExecutionPayload payload, double distance) {
        AbilityContracts.Effect effect = payload.contract().effects().stream()
                .filter(item -> item.type() == EffectType.DAMAGE)
                .findFirst().orElse(null);
        if (effect == null) return 0;
        return effect.runtimeComputed() || !payload.definition().damageFalloff().isEmpty()
                ? Abilities.damageAtDistance(payload.abilityId(), distance) : effect.amount();
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
