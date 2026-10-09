package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.CombatLog;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import java.util.List;
import org.springframework.stereotype.Service;

/** Resolves bot and transient-entity interactions with persistent arena entities. */
@Service
class ArenaEntityCombatService {
    private final AbilityHitDetectionService hitDetectionService;

    ArenaEntityCombatService(AbilityHitDetectionService hitDetectionService) {
        this.hitDetectionService = hitDetectionService;
    }

    ArenaEntity applyEffectsToEntity(ArenaEntity target, List<Bot> bots,
                                     List<ArenaEntity> entities, ArenaBounds arena) {
        if (target == null || target.hp() <= 0) return target;
        AbilityContracts.AbilityPhase targetPhase = AbilityContracts.phaseFor(target);
        boolean summonTarget = AbilityContracts.isSummon(target);
        boolean allowFriendlyDamage = allowsFriendlyDamage(targetPhase);
        ArenaEntity next = target;
        for (Bot bot : bots) {
            AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(bot);
            if (payload == null) continue;
            // A trigger hit verb reaches an entity that its targets name when its hitbox touches it.
            for (AbilityContracts.HitVerb verb : payload.hitVerbs()) {
                if (!AbilityContracts.targetsEntity(verb.targets(), summonTarget)
                        || !(allowFriendlyDamage || ownersAreHostile(bot.slot, target.ownerSlot(), bots))
                        || !hitDetectionService.verbHitsEntity(bot, next, payload, verb)) continue;
                double distance = Math.hypot(next.x() - bot.x, next.y() - bot.y);
                next = applyImpact(next, new EffectSource(bot.slot, bot.x, bot.y,
                        bot.velocityX, bot.velocityY, 1.0), payload.abilityId(),
                        verb.hitbox(), false, verb.effects(), distance, summonTarget, arena);
            }
        }
        for (ArenaEntity source : entities) {
            if (source == null || source.id().equals(target.id())) continue;
            AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(source);
            AbilityContracts.PhaseEvent event = phase == null ? null
                    : phase.on().get(AbilityContracts.PhaseEventType.COLLISION);
            if (!canAffectEntity(event, source.ownerSlot(), target.ownerSlot(), summonTarget,
                    allowFriendlyDamage, bots)
                    || !overlaps(source, next)) continue;
            double distance = phase.type() == AbilityContracts.PhaseType.PROJECTILE
                    ? 0 : Math.hypot(source.x() - next.x(), source.y() - next.y());
            next = applyImpact(next, new EffectSource(source.ownerSlot(), source.x(), source.y(),
                    source.velocityX(), source.velocityY(), source.damageMultiplier()),
                    source.abilityId(), phase.hitbox(), phase.type() == AbilityContracts.PhaseType.ZONE,
                    event.applyEffects(), distance, summonTarget, arena);
        }
        return next;
    }

    private static boolean canAffectEntity(AbilityContracts.PhaseEvent event,
                                            int sourceOwnerSlot, int targetOwnerSlot,
                                            boolean summonTarget, boolean allowFriendlyDamage,
                                            List<Bot> bots) {
        return event != null && event.has(AbilityContracts.ApplyEffectsVerb.class)
                && (allowFriendlyDamage
                    || ownersAreHostile(sourceOwnerSlot, targetOwnerSlot, bots))
                && AbilityContracts.eventTargetsEntity(event, summonTarget);
    }

    private static boolean allowsFriendlyDamage(AbilityContracts.AbilityPhase phase) {
        return phase != null && phase.health() != null
                && phase.health().allowFriendlyDamage();
    }

    private static boolean ownersAreHostile(int sourceOwnerSlot, int targetOwnerSlot,
                                            List<Bot> bots) {
        Bot sourceOwner = bots.stream().filter(bot -> bot.slot == sourceOwnerSlot).findFirst().orElse(null);
        Bot targetOwner = bots.stream().filter(bot -> bot.slot == targetOwnerSlot).findFirst().orElse(null);
        if (sourceOwner != null && targetOwner != null) {
            return sourceOwner.entityTeam() != targetOwner.entityTeam();
        }
        return sourceOwnerSlot != targetOwnerSlot;
    }

    private static ArenaEntity applyImpact(ArenaEntity target, EffectSource source,
                                           int abilityId, AbilityContracts.Hitbox hitbox, boolean zoneSource,
                                           List<AbilityContracts.Effect> effects, double distance,
                                           boolean summonTarget,
                                           ArenaBounds arena) {
        Integer previousAbility = CombatLog.setAbility(abilityId);
        try {
            return applyImpactScoped(target, source, abilityId, hitbox, zoneSource, effects, distance,
                    summonTarget, arena);
        } finally {
            CombatLog.setAbility(previousAbility);
        }
    }

    private static ArenaEntity applyImpactScoped(ArenaEntity target, EffectSource source,
                                                 int abilityId, AbilityContracts.Hitbox hitbox, boolean zoneSource,
                                                 List<AbilityContracts.Effect> effects, double distance,
                                                 boolean summonTarget,
                                                 ArenaBounds arena) {
        Effects.Context ctx = new Effects.Context();
        ctx.abilityId = abilityId;
        ctx.range = Effects.hitboxRange(hitbox);
        ctx.ownerSlot = source.ownerSlot();
        ctx.sourceX = source.x();
        ctx.sourceY = source.y();
        ctx.damageMultiplier = Math.max(0, source.damageMultiplier());
        ctx.fromEntity = true;
        ctx.zoneSource = zoneSource;
        ctx.arena = arena;
        ctx.fixedDistance = distance;
        ctx.entity = target;
        for (AbilityContracts.Effect declared : effects) {
            if (declared == null) continue;
            if (!AbilityContracts.effectTargetsEntity(declared, summonTarget)) continue;
            Effects.apply(declared, ctx);
        }
        return ctx.entity;
    }

    private record EffectSource(int ownerSlot, double x, double y,
                                double velocityX, double velocityY,
                                double damageMultiplier) {}

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
            if (payload == null || AbilityContracts.appliesToOwner(payload.abilityId())) continue;
            if (hitDetectionService.phaseRange(payload, 0) > 0
                    && hitDetectionService.abilityHitsEntity(bot, mine, payload)) return true;
        }
        return false;
    }

    private static boolean projectilePhase(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        return phase != null && phase.type() == AbilityContracts.PhaseType.PROJECTILE;
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return FindTargets.overlap(first, second);
    }
}
