package com.example.botfight.simulation.ecs.abilities;

import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesDistance;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesIntersect;
import static com.example.botfight.simulation.geometry.EntityHitbox.movingAgainstCircle;
import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Generic authoritative system for persistent ability entities.
 *
 * Collision detection supplies target IDs; the current phase decides which
 * event to dispatch and which allowlisted payload effects to apply. Every
 * entity uses this same phase execution path.
 */
public final class AbilityEntitySystem {
    private AbilityEntitySystem() {}

    public interface Combat<F extends AbilityEntityBot> {
        void damage(F bot, double amount);
        void damageFromOwner(List<F> bots, int ownerSlot, F target, double amount,
                             double sourceX, double sourceY);
        int damageToEntity(ArenaEntity entity, List<F> bots, List<ArenaEntity> entities);
        boolean entityHitByCurrentAttack(ArenaEntity entity, List<F> bots,
                                         List<ArenaEntity> entities);

        /** Applies a contract-owned status through the host simulation's canonical status builder. */
        default void applyStatus(List<F> bots, int ownerSlot, F target, int abilityId,
                                 AttachedAbilityContracts.Effect effect) {
            target.applyStatus(effect.subtype(), effect.durationMs(), ownerSlot);
        }
    }

    public static boolean isAbilityEntity(ArenaEntity entity) {
        EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
        return contract != null && !contract.phases().isEmpty();
    }

    public static <F extends AbilityEntityBot> List<ArenaEntity> tick(
            List<ArenaEntity> entities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        List<ArenaEntity> tickEntities = entities.stream()
                .map(ArenaEntity::beginTickMetrics).toList();
        bots.forEach(bot -> bot.setZoneSilenced(false));
        List<EntityEntry> traps = tickEntities.stream()
                .map(entity -> new EntityEntry(entity, EntityContracts.forEntity(entity), false))
                .filter(entry -> entry.contract() != null
                        && entry.contract().category() == EntityContracts.Category.TRAP
                        && hasTriggerPhase(entry))
                .toList();
        List<ArenaEntity> next = new ArrayList<>();
        Set<String> trapIds = new HashSet<>(traps.stream()
                .map(entry -> entry.entity().id()).toList());
        List<F> botsAtTickStart = bots;
        List<EntityEntry> movedTraps = traps.stream().map(entry -> {
            ArenaEntity moved = advanceTriggerEntity(entry.entity(), entry.contract(), arena, stepMs);
            boolean destroyed = false;
            if (entry.contract().health() != null && entry.contract().collider().hittable()) {
                int damage = Math.max(0, combat.damageToEntity(moved, botsAtTickStart, tickEntities));
                int hp = Math.max(0, moved.hp() - damage);
                destroyed = hp <= 0 && damage > 0;
                moved = moved.withHp(hp).withDamageTakenThisTick(damage);
            }
            return new EntityEntry(moved, entry.contract(), destroyed);
        }).filter(entry -> entry.contract().health() == null
                || entry.entity().hp() > 0 || entry.destroyedByDamage()).toList();
        Set<String> triggered = resolveTrapTriggers(movedTraps, tickEntities, bots, arena, combat);

        for (EntityEntry entry : movedTraps) {
            if (!triggered.contains(entry.entity().id())) {
                next.add(entry.entity());
                continue;
            }
            AttachedAbilityContracts.AbilityPhase phase = phaseForEntry(entry);
            if (phase == null) continue;
            ArenaEntity current = entry.entity();
            boolean enteredPhase = false;
            if (entry.destroyedByDamage()) {
                AttachedAbilityContracts.AbilityPhase destroyed = EntityContracts.phaseById(current, "destroyed");
                if (destroyed != null) {
                    current = transitionToPhase(current, destroyed);
                    phase = destroyed;
                    enteredPhase = true;
                }
            }
            List<HitCandidate<F>> candidates = phaseTargets(current, phase, bots);
            DispatchResult<F> dispatched = dispatchPhaseEvent(current, entry.contract(), phase,
                    AttachedAbilityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    candidates.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                    distancesBySlot(candidates), stepMs);
            ArenaEntity nextEntity = dispatched.entity();
            bots = dispatched.bots();
            AttachedAbilityContracts.AbilityPhase entered = nextEntity == null
                    ? null : EntityContracts.phaseFor(nextEntity);
            if (nextEntity != null && entry.contract().abilityId() == 11
                    && "armed".equals(phase.id()) && entered != null
                    && "active".equals(entered.id())) {
                DispatchResult<F> active = dispatchPhaseEvent(nextEntity, entry.contract(), entered,
                        AttachedAbilityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                        candidates.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                        distancesBySlot(candidates), stepMs);
                nextEntity = active.entity();
                bots = active.bots();
                enteredPhase = true;
            }
            AttachedAbilityContracts.AbilityPhase finalPhase = nextEntity == null
                    ? null : EntityContracts.phaseFor(nextEntity);
            if (nextEntity != null && finalPhase != null && !phase.id().equals(finalPhase.id())) {
                enteredPhase = true;
            }
            if (nextEntity != null && enteredPhase) {
                nextEntity = consumeEnteredPhaseTick(nextEntity, stepMs);
            }
            if (nextEntity != null) next.add(nextEntity);
        }

        for (ArenaEntity entity : tickEntities) {
            if (trapIds.contains(entity.id())) continue;
            EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
            if (contract == null || contract.phases().isEmpty()) {
                next.add(entity);
                continue;
            }
            TickResult result = tickCanonicalEntity(entity, contract, tickEntities, bots,
                    arena, stepMs, combat);
            if (result.entity() != null) next.add(result.entity());
        }
        return next.stream().map(ArenaEntity::settleTickMetrics).toList();
    }

    private static boolean hasTriggerPhase(EntityEntry entry) {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entry.entity());
        return phase != null && phase.trigger() != null;
    }

    private static ArenaEntity advanceTriggerEntity(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            ArenaBounds arena, int stepMs) {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        if (phase == null) return entity;
        AttachedAbilityContracts.PhaseMovement movement = phase.movement();
        double speed = movement == null ? 0 : movement.speed();
        boolean moving = speed > 0;
        double directionMagnitude = Math.hypot(entity.velocityX(), entity.velocityY());
        double directionX = directionMagnitude > 0.001 ? entity.velocityX() / directionMagnitude : 0;
        double directionY = directionMagnitude > 0.001 ? entity.velocityY() / directionMagnitude : 0;
        double nextX = moving ? entity.x() + directionX * speed : entity.x();
        double nextY = moving ? entity.y() + directionY * speed : entity.y();
        if (moving) {
            nextX = clamp(nextX, 0, arena.width());
            nextY = clamp(nextY, 0, arena.height());
        }
        double velocityX = moving ? directionX * speed : 0;
        double velocityY = moving ? directionY * speed : 0;
        boolean armed = entity.armed() || phase.type() == AttachedAbilityContracts.PhaseType.ZONE
                || phase.type() == AttachedAbilityContracts.PhaseType.SELF;
        int timerMs = entity.timerMs() - stepMs;
        ArenaEntity moved = copyWithPhase(entity, nextX, nextY, velocityX, velocityY,
                entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY),
                timerMs, armed, entity.ageMs(), phase.id(), entity.phaseLocked(),
                Math.max(0, entity.visibleMs() - stepMs), entity.visualEventType(),
                Math.max(0, entity.visualEventMs() - stepMs), entity.visualEventSize());
        return withPhaseTimer(moved, entity.phaseTimerMs() + stepMs);
    }

    private static <F extends AbilityEntityBot> Set<String> resolveTrapTriggers(
            List<EntityEntry> entries, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, Combat<F> combat) {
        Set<String> triggered = new HashSet<>();
        for (EntityEntry entry : entries) {
            AttachedAbilityContracts.AbilityPhase phase = phaseForEntry(entry);
            AttachedAbilityContracts.Trigger trigger = phase == null ? null : phase.trigger();
            if (trigger == null) continue;
            boolean hit = entry.destroyedByDamage()
                    || (!trigger.requiresDestruction()
                    && entityHitByCurrentAttack(entry.entity(), allEntities, bots, arena,
                    trigger, combat));
            boolean contact = trigger.botContact() && bots.stream().anyMatch(bot ->
                    isEnemy(entry.entity().ownerSlot(), bot, bots)
                            && movingCirclesIntersect(
                            entry.entity().x() - entry.entity().velocityX(),
                            entry.entity().y() - entry.entity().velocityY(),
                            entry.entity().x(), entry.entity().y(), 0,
                            bot.entityMovementStartX(), bot.entityMovementStartY(),
                            bot.entityX(), bot.entityY(),
                            phaseRadius(entry.contract().abilityId(), phase, trigger.radius(), 0)
                                    + bot.entitySize() / 2.0));
            boolean lifetimeExpired = trigger.lifetimeMs() != null
                    && entry.entity().ageMs() >= trigger.lifetimeMs();
            if (lifetimeExpired || hit || contact) triggered.add(entry.entity().id());
        }
        boolean changed;
        do {
            changed = false;
            for (EntityEntry source : entries) {
                AttachedAbilityContracts.AbilityPhase phase = phaseForEntry(source);
                AttachedAbilityContracts.Trigger trigger = phase == null ? null : phase.trigger();
                if (!triggered.contains(source.entity().id())
                        || trigger == null || !trigger.chain()) continue;
                double radius = phaseRadius(source.contract().abilityId(), phase,
                        trigger.radius(), 0);
                for (EntityEntry target : entries) {
                    if (triggered.contains(target.entity().id())
                            || target.contract().abilityId() != source.contract().abilityId()
                            || distance(target.entity().x(), target.entity().y(),
                            source.entity().x(), source.entity().y()) > radius) continue;
                    triggered.add(target.entity().id());
                    changed = true;
                }
            }
        } while (changed);
        return triggered;
    }

    private static AttachedAbilityContracts.AbilityPhase phaseForEntry(EntityEntry entry) {
        AttachedAbilityContracts.AbilityPhase destroyed = entry.destroyedByDamage()
                ? EntityContracts.phaseById(entry.entity(), "destroyed") : null;
        return destroyed == null ? EntityContracts.phaseFor(entry.entity()) : destroyed;
    }

    private static <F extends AbilityEntityBot> boolean entityHitByCurrentAttack(
            ArenaEntity entity, List<ArenaEntity> allEntities, List<F> bots,
            ArenaBounds arena, AttachedAbilityContracts.Trigger trigger, Combat<F> combat) {
        if (trigger.attackHits() && combat.entityHitByCurrentAttack(entity, bots, allEntities)) {
            return true;
        }
        return trigger.projectileOverlap() && allEntities.stream().anyMatch(candidate ->
                candidate != entity
                        && EntityContracts.phaseFor(candidate) != null
                        && EntityContracts.phaseFor(candidate).type() == AttachedAbilityContracts.PhaseType.PROJECTILE
                        && overlaps(candidate, entity));
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalEntity(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            List<ArenaEntity> allEntities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        if (phase == null || phase.type() == null) return new TickResult(entity);
        return switch (phase.type()) {
            case PROJECTILE, RAY, ARC, MELEE ->
                    tickCanonicalProjectile(entity, contract, phase, bots, arena, stepMs, combat);
            case ZONE, SELF ->
                    tickCanonicalZone(entity, contract, phase, bots, arena, stepMs, combat);
            case SUMMON ->
                    tickCanonicalSummon(entity, contract, phase, allEntities, bots, arena, stepMs, combat);
            case BOT_ATTACHED ->
                    tickCanonicalZone(entity, contract, phase, bots, arena, stepMs, combat);
        };
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalProjectile(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            AttachedAbilityContracts.AbilityPhase phase, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        AttachedAbilityContracts.PhaseMovement movement = phase.movement();
        double speed = movement == null ? 0 : movement.speed();
        boolean moving = speed > 0;
        double directionMagnitude = Math.hypot(entity.velocityX(), entity.velocityY());
        double directionX = directionMagnitude > 0.001 ? entity.velocityX() / directionMagnitude : 0;
        double directionY = directionMagnitude > 0.001 ? entity.velocityY() / directionMagnitude : 0;
        double nextX = moving ? entity.x() + directionX * speed : entity.x();
        double nextY = moving ? entity.y() + directionY * speed : entity.y();
        if (moving) {
            nextX = clamp(nextX, 0, arena.width());
            nextY = clamp(nextY, 0, arena.height());
        }
        double velocityX = moving ? directionX * speed : 0;
        double velocityY = moving ? directionY * speed : 0;
        int timer = switch (contract.lifetime().timerMode()) {
                    case AGE -> entity.timerMs() + stepMs;
                    case REMAINING, FUSE -> entity.timerMs() - stepMs;
                    default -> entity.timerMs();
                };
        ArenaEntity moved = copyWithPhase(entity, nextX, nextY, velocityX, velocityY,
                entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY),
                timer, entity.armed(), entity.ageMs(), phase.id(), entity.phaseLocked(),
                Math.max(0, entity.visibleMs() - stepMs), entity.visualEventType(),
                Math.max(0, entity.visualEventMs() - stepMs), entity.visualEventSize());
        moved = withPhaseTimer(moved, entity.phaseTimerMs() + stepMs);

        final double collisionNextX = nextX;
        final double collisionNextY = nextY;
        final ArenaEntity collisionEntity = moved;
        final List<F> collisionBots = bots;
        List<HitCandidate<F>> candidates = bots.stream()
                .filter(bot -> isEnemy(entity.ownerSlot(), bot, collisionBots)
                        && bot.entityHp() > 0 && !bot.ignoresHostileEffects())
                .map(bot -> new HitCandidate<>(bot, movingCirclesDistance(
                        entity.x(), entity.y(), collisionNextX, collisionNextY,
                        bot.entityMovementStartX(), bot.entityMovementStartY(),
                        bot.entityX(), bot.entityY())))
                .filter(candidate -> movingAgainstCircle(collisionEntity, entity.x(), entity.y(),
                        collisionNextX, collisionNextY, candidate.bot().entityMovementStartX(),
                        candidate.bot().entityMovementStartY(), candidate.bot().entityX(),
                        candidate.bot().entityY(), candidate.bot().entitySize() / 2.0).hit())
                .sorted(Comparator.comparingDouble(HitCandidate::distance)).toList();
        List<HitCandidate<F>> selected = phase.hit() != null
                && phase.hit().mode() == AttachedAbilityContracts.HitMode.NEAREST
                ? candidates.stream().limit(1).toList() : candidates;
        AttachedAbilityContracts.Repeat repeat = phase.repeat();
        AttachedAbilityContracts.PhaseEventType repeatEvent = repeat == null ? null : repeat.event();
        if (repeatEvent == null && phase.events().containsKey(AttachedAbilityContracts.PhaseEventType.INTERVAL)) {
            repeatEvent = AttachedAbilityContracts.PhaseEventType.INTERVAL;
        }
        AttachedAbilityContracts.PhaseEvent repeatHandler = repeatEvent == null
                ? null : phase.events().get(repeatEvent);
        int intervalTimer = moved.intervalTimerMs() - stepMs;
        boolean scheduled = repeatHandler != null;
        int intervalMs = !scheduled ? 0 : repeat.intervalMs() != null ? repeat.intervalMs()
                : repeatHandler.intervalMs() == null ? stepMs : repeatHandler.intervalMs();
        if (scheduled && !repeat.startImmediately() && entity.phaseTimerMs() == 0) {
            intervalTimer = intervalMs - stepMs;
        }
        boolean due = !scheduled || intervalTimer <= 0;
        Map<Integer, ArenaEntity> collisionSources = new HashMap<>();
        for (HitCandidate<F> candidate : selected) {
            collisionSources.put(candidate.bot().entitySlot(), entity);
        }
        DispatchResult<F> dispatched = !due
                || selected.isEmpty() && !scheduled
                ? new DispatchResult<>(moved, bots)
                : dispatchPhaseEvent(moved, contract, phase,
                scheduled ? repeatEvent : AttachedAbilityContracts.PhaseEventType.COLLISION,
                bots, arena, combat,
                selected.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                distancesBySlot(selected), collisionSources, stepMs);
        if (scheduled && due) {
            intervalTimer += Math.max(1, intervalMs);
        }
        ArenaEntity next = dispatched.entity();
        if (next == null) return new TickResult(null);
        AttachedAbilityContracts.AbilityPhase entered = EntityContracts.phaseFor(next);
        if (entered != null && entered.type() == AttachedAbilityContracts.PhaseType.ZONE
                && !entered.id().equals(phase.id())) {
            return tickCanonicalZone(next, contract, entered, dispatched.bots(),
                    arena, stepMs, combat);
        }
        boolean edge = nextX == 0 || nextX == arena.width()
                || nextY == 0 || nextY == arena.height();
        AttachedAbilityContracts.PhaseEvent edgeEvent = phase.events().get(
                AttachedAbilityContracts.PhaseEventType.COLLISION);
        boolean removeAtEdge = edge && edgeEvent != null
                && edgeEvent.actions().contains(AttachedAbilityContracts.PhaseAction.REMOVE);
        boolean expired = phase.durationMs() != null
                && next.phaseTimerMs() >= phase.durationMs();
        if (!expired) {
            expired = switch (contract.lifetime().timerMode()) {
                case AGE -> next.ageMs() >= contract.lifetime().duration();
                case REMAINING, FUSE -> next.timerMs() <= 0;
                default -> false;
            };
        }
        if (expired || removeAtEdge) {
            DispatchResult<F> ended = dispatchPhaseEvent(next, contract, phase,
                    AttachedAbilityContracts.PhaseEventType.LIFETIME_END, dispatched.bots(),
                    arena, combat, List.of(), Map.of(), stepMs);
            return new TickResult(ended.entity() == next
                    && !phase.events().containsKey(AttachedAbilityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        return new TickResult(withIntervalTimer(next, intervalTimer));
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalZone(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            AttachedAbilityContracts.AbilityPhase phase, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        ArenaEntity current = entity;
        int timer = current.timerMs() - (phase.durationMs() != null
                || contract.lifetime().timerMode() == EntityContracts.TimerMode.REMAINING
                ? stepMs : 0);
        ArenaEntity moved = copyWithPhase(current, current.x(), current.y(), 0, 0,
                current.traveled(), timer, true, current.ageMs(), phase.id(),
                current.phaseLocked(), Math.max(0, current.visibleMs() - stepMs), current.visualEventType(),
                Math.max(0, current.visualEventMs() - stepMs), current.visualEventSize());
        moved = withPhaseTimer(moved, current.phaseTimerMs() + stepMs);
        List<HitCandidate<F>> candidates = phaseTargets(moved, phase, bots);
        boolean active = contract.lifetime().timerMode() != EntityContracts.TimerMode.REMAINING
                || current.timerMs() > 0;
        List<Integer> targetSlots = candidates.stream()
                .map(candidate -> candidate.bot().entitySlot()).toList();
        Map<Integer, Double> distances = distancesBySlot(candidates);
        AttachedAbilityContracts.Repeat repeat = phase.repeat();
        AttachedAbilityContracts.PhaseEventType repeatEvent = repeat == null ? null : repeat.event();
        if (repeatEvent == null && phase.events().containsKey(AttachedAbilityContracts.PhaseEventType.INTERVAL)) {
            repeatEvent = AttachedAbilityContracts.PhaseEventType.INTERVAL;
        }
        AttachedAbilityContracts.PhaseEvent intervalEvent = repeatEvent == null
                ? null : phase.events().get(repeatEvent);
        DispatchResult<F> dispatched = new DispatchResult<>(moved, bots);
        int intervalTimer = moved.intervalTimerMs() - stepMs;
        if (intervalEvent != null && active) {
            int intervalMs = repeat != null && repeat.intervalMs() != null
                    ? repeat.intervalMs()
                    : intervalEvent.intervalMs() == null ? stepMs : intervalEvent.intervalMs();
            if (repeat != null && !repeat.startImmediately()
                    && current.phaseTimerMs() == 0) {
                intervalTimer = intervalMs - stepMs;
            }
            boolean canRun = current.timerMs() > 0
                    || contract.lifetime().timerMode() != EntityContracts.TimerMode.REMAINING;
            while (intervalTimer <= 0 && canRun && dispatched.entity() != null) {
                dispatched = dispatchPhaseEvent(dispatched.entity(), contract, phase,
                        repeatEvent, dispatched.bots(), arena, combat,
                        targetSlots, distances, stepMs);
                intervalTimer += Math.max(1, intervalMs);
            }
        } else if (active && phase.events().containsKey(AttachedAbilityContracts.PhaseEventType.COLLISION)) {
            dispatched = dispatchPhaseEvent(moved, contract, phase,
                    AttachedAbilityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    targetSlots, distances, stepMs);
        }
        if (dispatched.entity() == null) return new TickResult(null);
        ArenaEntity next = withIntervalTimer(dispatched.entity(), intervalTimer);
        boolean expired = phase.durationMs() != null
                && next.phaseTimerMs() >= phase.durationMs()
                || phase.durationMs() == null
                && contract.lifetime().timerMode() == EntityContracts.TimerMode.REMAINING
                && next.timerMs() <= 0;
        if (expired) {
            if (next.visualEventMs() > 0) return new TickResult(next);
            DispatchResult<F> ended = dispatchPhaseEvent(next, contract, phase,
                    AttachedAbilityContracts.PhaseEventType.LIFETIME_END, dispatched.bots(),
                    arena, combat, List.of(), Map.of(), stepMs);
            AttachedAbilityContracts.AbilityPhase entered = ended.entity() == null
                    ? null : EntityContracts.phaseFor(ended.entity());
            if (entered != null && !entered.id().equals(phase.id())) {
                AttachedAbilityContracts.PhaseEvent collision = entered.events().get(
                        AttachedAbilityContracts.PhaseEventType.COLLISION);
                if (collision != null && collision.actions().contains(
                        AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)) {
                    List<HitCandidate<F>> enteredCandidates = phaseTargets(
                            ended.entity(), entered, ended.bots());
                    return new TickResult(dispatchPhaseEvent(ended.entity(), contract,
                            entered, AttachedAbilityContracts.PhaseEventType.COLLISION,
                            ended.bots(), arena, combat,
                            enteredCandidates.stream().map(candidate ->
                                    candidate.bot().entitySlot()).toList(),
                            distancesBySlot(enteredCandidates), stepMs).entity());
                }
            }
            return new TickResult(ended.entity() == next
                    && !phase.events().containsKey(AttachedAbilityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalSummon(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            AttachedAbilityContracts.AbilityPhase phase, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, int stepMs, Combat<F> combat) {
        int lifetime = contract.lifetime().duration();
        int damage = Math.max(0, combat.damageToEntity(entity, bots, allEntities));
        int hp = entity.hp() - damage;
        if (hp <= 0) return new TickResult(null);
        if (entity.ageMs() >= lifetime) {
            DispatchResult<F> ended = dispatchPhaseEvent(entity, contract, phase,
                    AttachedAbilityContracts.PhaseEventType.LIFETIME_END, bots, arena, combat,
                    List.of(), Map.of(), stepMs);
            return new TickResult(ended.entity() == entity
                    && !phase.events().containsKey(AttachedAbilityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        final List<F> summonBots = bots;
        final ArenaEntity summon = entity;
        F target = summonBots.stream()
                .filter(bot -> isEnemy(summon.ownerSlot(), bot, summonBots) && bot.entityHp() > 0)
                .min(Comparator.comparingDouble(bot -> distance(
                        bot.entityX(), bot.entityY(), entity.x(), entity.y())))
                .orElse(null);
        ArenaEntity next = copyWithPhase(entity, entity.x(), entity.y(),
                entity.velocityX(), entity.velocityY(), entity.traveled(), entity.timerMs(),
                true, entity.ageMs(), phase.id(), false, Math.max(0, entity.visibleMs() - stepMs),
                entity.visualEventType(), Math.max(0, entity.visualEventMs() - stepMs),
                entity.visualEventSize()).withHp(hp).withDamageTakenThisTick(damage);
        if (target == null) return new TickResult(next);
        double dx = target.entityX() - next.x();
        double dy = target.entityY() - next.y();
        double targetDistance = Math.max(1, Math.hypot(dx, dy));
        AttachedAbilityContracts.PhaseMovement movement = phase.movement();
        double speed = movement == null ? 0 : movement.speed();
        double size = movement == null || movement.size() <= 0 ? next.size() : movement.size();
        double desired = vectorBearing(dx, dy);
        double current = vectorBearing(next.velocityX(), next.velocityY());
        double turn = movement == null || movement.turnDegrees() <= 0 ? 8 : movement.turnDegrees();
        double rotation = normalizeDegrees(current
                + clamp(shortestDelta(current, desired), -turn, turn));
        double radians = Math.toRadians(rotation - 90);
        double nextX = clamp(next.x() + dx / targetDistance * Math.min(speed, targetDistance),
                size / 2, arena.width() - size / 2);
        double nextY = clamp(next.y() + dy / targetDistance * Math.min(speed, targetDistance),
                size / 2, arena.height() - size / 2);
        next = copyWithPhase(next, nextX, nextY, Math.cos(radians), Math.sin(radians),
                next.traveled(), next.timerMs(), true, next.ageMs(), phase.id(), false,
                next.visibleMs(), next.visualEventType(), next.visualEventMs(),
                next.visualEventSize(), rotation);
        AttachedAbilityContracts.Attack attack = phase.attack();
        if (attack != null && next.intervalTimerMs() <= 0
                && rayIntersectsCircle(next.x(), next.y(), next.velocityX(), next.velocityY(),
                attack.range() == null ? 0 : attack.range(), target.entityX(),
                target.entityY(), target.entitySize() / 2.0)) {
            DispatchResult<F> result = dispatchPhaseEvent(next, contract, phase,
                    AttachedAbilityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    List.of(target.entitySlot()), Map.of(target.entitySlot(), targetDistance),
                    Map.of(target.entitySlot(), next), stepMs);
            next = result.entity();
            bots = result.bots();
            if (next != null) {
                next = withIntervalTimer(next, attack.cooldownMs() == null ? 1000 : attack.cooldownMs());
                next = withShotVisual(next, attack.visualMs() == null ? 300 : attack.visualMs());
            }
        } else {
            next = withIntervalTimer(next,
                    Math.max(0, next.intervalTimerMs() - stepMs));
        }
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> List<HitCandidate<F>> phaseTargets(
            ArenaEntity entity, AttachedAbilityContracts.AbilityPhase phase, List<F> bots) {
        Double radiusValue = phase.hitbox() == null ? null : phase.hitbox().radius();
        double radius = phaseRadius(entity.abilityId(), phase, radiusValue,
                entity.size() / 2.0);
        return bots.stream()
                .filter(bot -> isEnemy(entity.ownerSlot(), bot, bots)
                        && bot.entityHp() > 0 && !bot.ignoresHostileEffects()
                        && (!phase.skipOwner() || bot.entitySlot() != entity.ownerSlot()))
                .filter(bot -> withinRadius(bot, entity, radius))
                .map(bot -> new HitCandidate<>(bot, movingCirclesDistance(
                        entity.x(), entity.y(), entity.x(), entity.y(),
                        bot.entityMovementStartX(), bot.entityMovementStartY(),
                        bot.entityX(), bot.entityY())))
                .toList();
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            AttachedAbilityContracts.AbilityPhase phase, AttachedAbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances, int stepMs) {
        return dispatchPhaseEvent(entity, contract, phase, eventType, bots, arena,
                combat, targetSlots, distances, Map.of(), stepMs);
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            AttachedAbilityContracts.AbilityPhase phase, AttachedAbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances,
            Map<Integer, ArenaEntity> effectSources, int stepMs) {
        AttachedAbilityContracts.PhaseEvent event = phase.events().get(eventType);
        if (event == null) return new DispatchResult<>(entity, bots);
        ArenaEntity next = entity;
        Set<EffectType> effects = event.effectTypes().isEmpty()
                ? phase.effects().stream().map(AttachedAbilityContracts.Effect::type)
                        .collect(java.util.stream.Collectors.toUnmodifiableSet())
                : event.effectTypes();
        for (AttachedAbilityContracts.PhaseAction action : event.actions()) {
            if (action == AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS) {
                for (Integer targetSlot : targetSlots) {
                    F target = bots.stream().filter(bot -> bot.entitySlot() == targetSlot)
                            .findFirst().orElse(null);
                    if (next == null || target == null || target.entityHp() <= 0
                            || target.ignoresHostileEffects()
                            || phase.skipOwner() && target.entitySlot() == next.ownerSlot()
                            || !canApplyToTarget(next, targetSlot, event.targetPolicy(), stepMs)) continue;
                    applyEntityEffects(bots, target,
                            effectSources.getOrDefault(targetSlot, next),
                            contract.abilityId(), phase.effects(), effects, arena, combat,
                            "source", distances.getOrDefault(targetSlot, Double.NaN),
                            phase.effectOverrides(), phaseRange(phase));
                    next = recordTargetApplication(next, targetSlot, event.targetPolicy(), stepMs);
                }
            } else if (action == AttachedAbilityContracts.PhaseAction.TRANSITION) {
                AttachedAbilityContracts.AbilityPhase target = EntityContracts.phaseById(next,
                        event.transition() == null ? null : event.transition().to());
                if (target != null) next = transitionToPhase(next, target);
            } else if (action == AttachedAbilityContracts.PhaseAction.EMIT_VISUAL) {
                int visibleMs = event.visibleMs() == null ? 0 : event.visibleMs();
                String visualType = event.visualType() != null ? event.visualType()
                        : phase.visual() == null ? null : phase.visual().type();
                int visualSize = event.visualSize() == null
                        ? phase.visual() == null ? next.size()
                        : (int) Math.round(phase.visual().visualSize())
                        : (int) Math.round(event.visualSize());
                next = copyWithPhase(next, next.x(), next.y(), next.velocityX(),
                        next.velocityY(), next.traveled(), next.timerMs(), next.armed(),
                        next.ageMs(), next.phaseId(), next.phaseLocked(), visibleMs,
                        visualType, visibleMs, visualSize);
            } else if (action == AttachedAbilityContracts.PhaseAction.REMOVE) {
                next = null;
            }
            if (next == null) break;
        }
        return new DispatchResult<>(next, bots);
    }

    private static boolean canApplyToTarget(ArenaEntity entity, int targetSlot,
                                             AttachedAbilityContracts.TargetPolicy targetPolicy,
                                            int stepMs) {
        if (targetPolicy == null
                || targetPolicy.mode() == AttachedAbilityContracts.TargetPolicyMode.EVERY_TICK) return true;
        Integer previous = entity.hitLedger().get(targetSlot);
        if (previous == null) return true;
        if (targetPolicy.mode() == AttachedAbilityContracts.TargetPolicyMode.ONCE) return false;
        int interval = targetPolicy.intervalMs() != null ? targetPolicy.intervalMs() : stepMs;
        return eventTimestampMs(entity, stepMs) - previous >= interval;
    }

    private static ArenaEntity recordTargetApplication(ArenaEntity entity, int targetSlot,
                                                        AttachedAbilityContracts.TargetPolicy targetPolicy,
                                                       int stepMs) {
        if (targetPolicy == null
                || targetPolicy.mode() == AttachedAbilityContracts.TargetPolicyMode.EVERY_TICK) {
            return entity;
        }
        Map<Integer, Integer> ledger = new HashMap<>(entity.hitLedger());
        ledger.put(targetSlot, eventTimestampMs(entity, stepMs));
        return entity.withHitLedger(ledger);
    }

    private static int eventTimestampMs(ArenaEntity entity, int stepMs) {
        return Math.max(0, entity.ageMs() - Math.max(0, stepMs));
    }

    private static ArenaEntity transitionToPhase(ArenaEntity entity,
                                                  AttachedAbilityContracts.AbilityPhase phase) {
        int visibleMs = phase.visibleMs() == null ? 0 : phase.visibleMs();
        if (visibleMs <= 0 && phase.visual() != null
                && phase.visual().visibleMs() != null) {
            visibleMs = phase.visual().visibleMs();
        }
        int duration = phase.durationMs() == null
                ? (visibleMs > 0 ? visibleMs : entity.timerMs()) : phase.durationMs();
        // A phase visual is resolved from phaseId by the renderer. Only an
        // explicit EMIT_VISUAL action belongs in the transient event fields.
        // Preserve an already-emitted event when the same tick also
        // transitions phase (for example, a snare's collision burst).
        String visualEventType = entity.visualEventType();
        int visualEventMs = entity.visualEventMs();
        int visualEventSize = entity.visualEventSize();
        ArenaEntity transitioned = copyWithPhase(entity, entity.x(), entity.y(), 0, 0,
                entity.traveled(), duration, true, entity.ageMs(), phase.id(), true,
                visibleMs, visualEventType, visualEventMs, visualEventSize);
        return withPhaseTimer(transitioned.withHitLedger(Map.of()), 0);
    }

    private static ArenaEntity withIntervalTimer(ArenaEntity entity, int timer) {
        return new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(),
                entity.y(), entity.size(), entity.velocityX(), entity.velocityY(),
                entity.traveled(), entity.timerMs(), entity.armed(), entity.hp(),
                entity.shotVisualMs(), entity.damageMultiplier(), entity.abilityId(),
                timer, entity.phaseTimerMs(), entity.ageMs(),
                entity.tickStartHp(), entity.damageTakenThisTick(),
                entity.damageTakenLastTick(), entity.hpNetChangeLastTick(), entity.rotation(),
                entity.hitLedger(), entity.phaseId(), entity.phaseLocked(),
                entity.visibleMs(), entity.visualEventType(), entity.visualEventMs(),
                entity.visualEventSize());
    }

    private static ArenaEntity consumeEnteredPhaseTick(ArenaEntity entity, int stepMs) {
        ArenaEntity consumed = copyWithPhase(entity, entity.x(), entity.y(),
                entity.velocityX(), entity.velocityY(), entity.traveled(),
                entity.timerMs() - Math.max(0, stepMs), entity.armed(), entity.ageMs(),
                entity.phaseId(), entity.phaseLocked(),
                Math.max(0, entity.visibleMs() - Math.max(0, stepMs)),
                entity.visualEventType(), Math.max(0, entity.visualEventMs() - Math.max(0, stepMs)),
                entity.visualEventSize());
        return withPhaseTimer(consumed, entity.phaseTimerMs() + Math.max(0, stepMs));
    }

    private static ArenaEntity withPhaseTimer(ArenaEntity entity, int phaseTimerMs) {
        return new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(),
                entity.y(), entity.size(), entity.velocityX(), entity.velocityY(),
                entity.traveled(), entity.timerMs(), entity.armed(), entity.hp(),
                entity.shotVisualMs(), entity.damageMultiplier(), entity.abilityId(),
                entity.intervalTimerMs(), phaseTimerMs, entity.ageMs(),
                entity.tickStartHp(), entity.damageTakenThisTick(),
                entity.damageTakenLastTick(), entity.hpNetChangeLastTick(), entity.rotation(),
                entity.hitLedger(), entity.phaseId(), entity.phaseLocked(),
                entity.visibleMs(), entity.visualEventType(), entity.visualEventMs(),
                entity.visualEventSize());
    }

    private static ArenaEntity withShotVisual(ArenaEntity entity, int visualMs) {
        return new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(),
                entity.y(), entity.size(), entity.velocityX(), entity.velocityY(),
                entity.traveled(), entity.timerMs(), entity.armed(), entity.hp(),
                visualMs, entity.damageMultiplier(), entity.abilityId(),
                entity.intervalTimerMs(), entity.phaseTimerMs(), entity.ageMs(),
                entity.tickStartHp(), entity.damageTakenThisTick(),
                entity.damageTakenLastTick(), entity.hpNetChangeLastTick(), entity.rotation(),
                entity.hitLedger(), entity.phaseId(), entity.phaseLocked(),
                entity.visibleMs(), entity.visualEventType(), entity.visualEventMs(),
                entity.visualEventSize());
    }

    private static ArenaEntity copyWithPhase(ArenaEntity source, double x, double y,
                                             double velocityX, double velocityY,
                                             double traveled, int timerMs, boolean armed,
                                             int ageMs, String phaseId, boolean phaseLocked,
                                             int visibleMs, String visualEventType,
                                             int visualEventMs, int visualEventSize) {
        return copyWithPhase(source, x, y, velocityX, velocityY, traveled, timerMs,
                armed, ageMs, phaseId, phaseLocked, visibleMs, visualEventType,
                visualEventMs, visualEventSize, source.rotation());
    }

    private static ArenaEntity copyWithPhase(ArenaEntity source, double x, double y,
                                             double velocityX, double velocityY,
                                             double traveled, int timerMs, boolean armed,
                                             int ageMs, String phaseId, boolean phaseLocked,
                                             int visibleMs, String visualEventType,
                                             int visualEventMs, int visualEventSize,
                                             double rotation) {
        return new ArenaEntity(source.id(), source.type(), source.ownerSlot(), x, y,
                source.size(), velocityX, velocityY, traveled, timerMs, armed, source.hp(),
                source.shotVisualMs(), source.damageMultiplier(), source.abilityId(),
                source.intervalTimerMs(), source.phaseTimerMs(), ageMs,
                source.tickStartHp(), source.damageTakenThisTick(),
                source.damageTakenLastTick(), source.hpNetChangeLastTick(), rotation,
                source.hitLedger(), phaseId, phaseLocked, Math.max(0, visibleMs),
                visualEventType, Math.max(0, visualEventMs),
                Math.max(0, visualEventSize));
    }

    private static <F extends AbilityEntityBot> void applyEntityEffects(
            List<F> bots, F target, ArenaEntity source, int abilityId,
            List<AttachedAbilityContracts.Effect> declaredEffects,
            Set<EffectType> allowedEffects, ArenaBounds arena, Combat<F> combat,
            String knockbackDirection, double collisionDistance,
            Map<String, AttachedAbilityContracts.EffectOverride> overrides,
            Double rangeOverride) {
        if (!isEnemy(source.ownerSlot(), target, bots)) return;
        for (AttachedAbilityContracts.Effect effect : declaredEffects) {
            if (!allowedEffects.isEmpty() && !allowedEffects.contains(effect.type())) continue;
            AttachedAbilityContracts.EffectOverride override = effectOverrideFor(effect, overrides);
            AttachedAbilityContracts.Effect resolved = withEffectOverride(effect, override);
            double distance = Double.isFinite(collisionDistance)
                    ? collisionDistance
                    : distance(source.x(), source.y(), target.entityX(), target.entityY());
            switch (resolved.type()) {
                case DAMAGE -> {
                    double base = resolveEffectAmount(abilityId, resolved, override,
                            distance, rangeOverride);
                    combat.damageFromOwner(bots, source.ownerSlot(), target,
                            base * Math.max(0, source.damageMultiplier()),
                            source.x(), source.y());
                }
                case STATUS -> {
                    int durationMs = resolveEffectDuration(abilityId, resolved,
                            distance, rangeOverride);
                    AttachedAbilityContracts.AbilityPhase sourcePhase = EntityContracts.phaseFor(source);
                    if ("silence".equals(resolved.subtype())
                            && durationMs <= 0
                            && sourcePhase != null
                            && sourcePhase.type() == AttachedAbilityContracts.PhaseType.ZONE) {
                        target.setZoneSilenced(true);
                    } else {
                        combat.applyStatus(bots, source.ownerSlot(), target, abilityId,
                                withDuration(resolved, durationMs));
                    }
                }
                case INTERRUPT -> target.applyInterrupt(resolveEffectDuration(abilityId,
                        resolved, distance, rangeOverride));
                case KNOCKBACK -> {
                    double dx = "velocity".equals(knockbackDirection)
                            ? source.velocityX() : target.entityX() - source.x();
                    double dy = "velocity".equals(knockbackDirection)
                            ? source.velocityY() : target.entityY() - source.y();
                    double magnitude = Math.max(.001, Math.hypot(dx, dy));
                    double amount = resolveEffectAmount(abilityId, resolved, override,
                            distance, rangeOverride);
                    target.setEntityPosition(
                            clamp(target.entityX() + dx / magnitude * amount,
                                    target.entitySize() / 2.0,
                                    arena.width() - target.entitySize() / 2.0),
                            clamp(target.entityY() + dy / magnitude * amount,
                                    target.entitySize() / 2.0,
                                    arena.height() - target.entitySize() / 2.0));
                }
                case PULL -> {
                    double dx = source.x() - target.entityX();
                    double dy = source.y() - target.entityY();
                    double magnitude = Math.max(.001, Math.hypot(dx, dy));
                    double amount = resolveEffectAmount(abilityId, resolved, override,
                            distance, rangeOverride);
                    target.setEntityPosition(
                            clamp(target.entityX() + dx / magnitude * amount,
                                    target.entitySize() / 2.0,
                                    arena.width() - target.entitySize() / 2.0),
                            clamp(target.entityY() + dy / magnitude * amount,
                                    target.entitySize() / 2.0,
                                    arena.height() - target.entitySize() / 2.0));
                }
                default -> { }
            }
        }
    }

    private static AttachedAbilityContracts.Effect withDuration(AttachedAbilityContracts.Effect effect, int durationMs) {
        if (durationMs == effect.durationMs()) return effect;
        return new AttachedAbilityContracts.Effect(effect.type(), effect.subtype(), effect.amount(),
                durationMs, effect.runtimeComputed(), effect.recipient(), effect.requiresConfirmedDamage(),
                effect.mirrorsDamage(), effect.distanceMode(), effect.falloff(),
                effect.intervalMs(), effect.movementLockMs());
    }

    private static AttachedAbilityContracts.Effect withEffectOverride(
            AttachedAbilityContracts.Effect effect, AttachedAbilityContracts.EffectOverride override) {
        if (override == null) return effect;
        AttachedAbilityContracts.Falloff falloff = override.falloff() == null
                ? effect.falloff()
                : (effect.falloff() == null
                    ? override.falloff() : effect.falloff().mergedWith(override.falloff()));
        if (override.amount() != null && override.falloff() == null) falloff = null;
        return new AttachedAbilityContracts.Effect(effect.type(), effect.subtype(),
                override.amount() == null ? effect.amount() : override.amount(),
                override.durationMs() == null ? effect.durationMs() : override.durationMs(),
                effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff, effect.intervalMs(), effect.movementLockMs());
    }

    private static AttachedAbilityContracts.EffectOverride effectOverrideFor(
            AttachedAbilityContracts.Effect effect,
            Map<String, AttachedAbilityContracts.EffectOverride> overrides) {
        if (overrides == null || overrides.isEmpty()) return null;
        AttachedAbilityContracts.EffectOverride override = overrides.get(
                AttachedAbilityContracts.effectOverrideKey(effect));
        if (override != null) return override;
        return overrides.get(effect.type().name().toLowerCase());
    }

    private static double resolveEffectAmount(int abilityId,
                                              AttachedAbilityContracts.Effect effect,
                                              AttachedAbilityContracts.EffectOverride override,
                                              double distance,
                                              Double rangeOverride) {
        if (override != null && override.amount() != null
                && override.falloff() == null) return override.amount();
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(abilityId, distance,
                    effect.falloff(), rangeOverride);
        }
        if (effect.runtimeComputed()) {
            return Abilities.amountAtDistance(abilityId, distance, null, rangeOverride);
        }
        return effect.amount();
    }

    private static int resolveEffectDuration(int abilityId,
                                             AttachedAbilityContracts.Effect effect,
                                             double distance,
                                             Double rangeOverride) {
        return Abilities.durationAtDistance(abilityId, distance,
                effect.durationMs(), effect.falloff(), rangeOverride);
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

    private static <F extends AbilityEntityBot> boolean isEnemy(
            int ownerSlot, F target, List<F> bots) {
        F owner = bots.stream().filter(bot -> bot.entitySlot() == ownerSlot)
                .findFirst().orElse(null);
        return owner == null
                ? target.entitySlot() != ownerSlot
                : owner.entityTeam() != target.entityTeam();
    }

    private static boolean withinRadius(AbilityEntityBot bot, ArenaEntity source,
                                        double radius) {
        return movingCirclesIntersect(source.x(), source.y(), source.x(), source.y(),
                radius, bot.entityMovementStartX(), bot.entityMovementStartY(),
                bot.entityX(), bot.entityY(), bot.entitySize() / 2.0);
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return movingCollision(first, first.x() - first.velocityX(),
                first.y() - first.velocityY(), first.x(), first.y(), second,
                second.x() - second.velocityX(), second.y() - second.velocityY(),
                second.x(), second.y(), 0).hit();
    }

    private static boolean rayIntersectsCircle(double x, double y, double dx, double dy,
                                               double range, double cx, double cy,
                                               double radius) {
        double projection = (cx - x) * dx + (cy - y) * dy;
        if (projection < -radius || projection > range + radius) return false;
        double closestX = x + clamp(projection, 0, range) * dx;
        double closestY = y + clamp(projection, 0, range) * dy;
        return distance(cx, cy, closestX, closestY) <= radius;
    }

    private static double phaseRadius(int abilityId, AttachedAbilityContracts.AbilityPhase phase,
                                      Double radiusValue, double fallback) {
        double value = radiusValue == null ? fallback : radiusValue;
        double multiplier = phase == null || phase.hitbox() == null
                ? 1 : phase.hitbox().radiusMultiplier();
        return value * multiplier;
    }

    private static <F extends AbilityEntityBot> Map<Integer, Double> distancesBySlot(
            List<HitCandidate<F>> candidates) {
        Map<Integer, Double> distances = new HashMap<>();
        for (HitCandidate<F> candidate : candidates) {
            distances.merge(candidate.bot().entitySlot(), candidate.distance(), Math::min);
        }
        return distances;
    }

    private static double vectorBearing(double dx, double dy) {
        return normalizeDegrees(Math.toDegrees(Math.atan2(dx, -dy)));
    }

    private static double shortestDelta(double from, double to) {
        return normalizeDegrees(to - from);
    }

    private static double normalizeDegrees(double degrees) {
        double normalized = degrees % 360;
        if (normalized > 180) normalized -= 360;
        if (normalized <= -180) normalized += 360;
        return normalized;
    }

    private static double distance(double x1, double y1, double x2, double y2) {
        return Math.hypot(x1 - x2, y1 - y2);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private record HitCandidate<F extends AbilityEntityBot>(F bot, double distance) {}
    private record DispatchResult<F extends AbilityEntityBot>(ArenaEntity entity, List<F> bots) {}
    private record EntityEntry(ArenaEntity entity, EntityContracts.EntityContract contract,
                               boolean destroyedByDamage) {}
    private record TickResult(ArenaEntity entity) {}
}
