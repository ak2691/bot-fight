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
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;

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
            EntityContracts.Phase phase = phaseForEntry(entry);
            if (phase == null) continue;
            ArenaEntity current = entry.entity();
            boolean enteredPhase = false;
            if (entry.destroyedByDamage()) {
                EntityContracts.Phase destroyed = EntityContracts.phaseById(current, "destroyed");
                if (destroyed != null) {
                    current = transitionToPhase(current, destroyed);
                    phase = destroyed;
                    enteredPhase = true;
                }
            }
            List<HitCandidate<F>> candidates = phaseTargets(current, phase, bots);
            DispatchResult<F> dispatched = dispatchPhaseEvent(current, entry.contract(), phase,
                    EntityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    candidates.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                    distancesBySlot(candidates), stepMs);
            ArenaEntity nextEntity = dispatched.entity();
            bots = dispatched.bots();
            EntityContracts.Phase entered = nextEntity == null
                    ? null : EntityContracts.phaseFor(nextEntity);
            if (nextEntity != null && entry.contract().abilityId() == 11
                    && "armed".equals(phase.id()) && entered != null
                    && "active".equals(entered.id())) {
                DispatchResult<F> active = dispatchPhaseEvent(nextEntity, entry.contract(), entered,
                        EntityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                        candidates.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                        distancesBySlot(candidates), stepMs);
                nextEntity = active.entity();
                bots = active.bots();
                enteredPhase = true;
            }
            EntityContracts.Phase finalPhase = nextEntity == null
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
        EntityContracts.Phase phase = EntityContracts.phaseFor(entry.entity());
        return phase != null && phase.trigger() != null;
    }

    private static ArenaEntity advanceTriggerEntity(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            ArenaBounds arena, int stepMs) {
        EntityContracts.Phase phase = EntityContracts.phaseFor(entity);
        if (phase == null) return entity;
        EntityContracts.Phase movementPhase = phase;
        if (!entity.phaseLocked()) {
            EntityContracts.Phase previous = phaseAtElapsed(contract.phases(),
                    Math.max(0, entity.ageMs() - Math.max(0, stepMs)));
            if (previous != null && previous.startMs() <= phase.startMs()) movementPhase = previous;
        }
        EntityContracts.Movement movement = movementPhase.movement();
        String mode = movement == null ? "stopped" : movement.mode();
        boolean moving = "travel".equals(mode) || "segment".equals(mode);
        double scale = movement == null || movement.stepRatio() == 0 ? 1 : movement.stepRatio();
        double nextX = moving ? entity.x() + entity.velocityX() * scale : entity.x();
        double nextY = moving ? entity.y() + entity.velocityY() * scale : entity.y();
        if (moving && Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001) {
            double radius = entity.size() / 2.0;
            nextX = clamp(nextX, radius, arena.width() - radius);
            nextY = clamp(nextY, radius, arena.height() - radius);
        }
        String resultingMode = phase.movement() == null ? "stopped" : phase.movement().mode();
        double velocityX = "stopped".equals(resultingMode) ? 0 : entity.velocityX();
        double velocityY = "stopped".equals(resultingMode) ? 0 : entity.velocityY();
        boolean armed = entity.armed() || phase.type() == EntityContracts.PhaseType.ZONE
                || phase.type() == EntityContracts.PhaseType.SELF;
        int phaseElapsed = Math.max(0, entity.ageMs() - Math.max(0, phase.startMs()));
        int timerMs = "armed".equals(phase.id()) ? phaseElapsed : entity.timerMs();
        ArenaEntity moved = copyWithPhase(entity, nextX, nextY, velocityX, velocityY,
                entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY),
                timerMs, armed, entity.ageMs(), phase.id(), entity.phaseLocked(),
                Math.max(0, entity.visibleMs() - stepMs), entity.visualEventType(),
                Math.max(0, entity.visualEventMs() - stepMs), entity.visualEventSize());
        return withPhaseTimer(moved, moved.phaseLocked()
                ? entity.phaseTimerMs() + stepMs : phaseElapsed);
    }

    private static EntityContracts.Phase phaseAtElapsed(
            List<EntityContracts.Phase> phases, int elapsedMs) {
        if (phases == null || phases.isEmpty()) return null;
        EntityContracts.Phase selected = phases.getFirst();
        for (EntityContracts.Phase candidate : phases) {
            if (candidate.transitionOnly() || candidate.startMs() < 0
                    || candidate.startMs() > elapsedMs) continue;
            if (candidate.startMs() > selected.startMs()) selected = candidate;
        }
        return selected;
    }

    private static <F extends AbilityEntityBot> Set<String> resolveTrapTriggers(
            List<EntityEntry> entries, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, Combat<F> combat) {
        Set<String> triggered = new HashSet<>();
        for (EntityEntry entry : entries) {
            EntityContracts.Phase phase = phaseForEntry(entry);
            EntityContracts.Trigger trigger = phase == null ? null : phase.trigger();
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
                            phaseStat(entry.contract().abilityId(), phase, trigger.radius(), 0)
                                    + bot.entitySize() / 2.0));
            boolean lifetimeExpired = trigger.lifetime() != null
                    && entry.entity().ageMs() >= stat(entry.contract().abilityId(),
                    trigger.lifetime(), Integer.MAX_VALUE);
            if (lifetimeExpired || hit || contact) triggered.add(entry.entity().id());
        }
        boolean changed;
        do {
            changed = false;
            for (EntityEntry source : entries) {
                EntityContracts.Phase phase = phaseForEntry(source);
                EntityContracts.Trigger trigger = phase == null ? null : phase.trigger();
                if (!triggered.contains(source.entity().id())
                        || trigger == null || !trigger.chain()) continue;
                double radius = phaseStat(source.contract().abilityId(), phase,
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

    private static EntityContracts.Phase phaseForEntry(EntityEntry entry) {
        EntityContracts.Phase destroyed = entry.destroyedByDamage()
                ? EntityContracts.phaseById(entry.entity(), "destroyed") : null;
        return destroyed == null ? EntityContracts.phaseFor(entry.entity()) : destroyed;
    }

    private static <F extends AbilityEntityBot> boolean entityHitByCurrentAttack(
            ArenaEntity entity, List<ArenaEntity> allEntities, List<F> bots,
            ArenaBounds arena, EntityContracts.Trigger trigger, Combat<F> combat) {
        if (trigger.attackHits() && combat.entityHitByCurrentAttack(entity, bots, allEntities)) {
            return true;
        }
        return trigger.projectileOverlap() && allEntities.stream().anyMatch(candidate ->
                candidate != entity
                        && EntityContracts.phaseFor(candidate) != null
                        && EntityContracts.phaseFor(candidate).type() == EntityContracts.PhaseType.PROJECTILE
                        && overlaps(candidate, entity));
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalEntity(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            List<ArenaEntity> allEntities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        EntityContracts.Phase phase = EntityContracts.phaseFor(entity);
        if (!entity.phaseLocked()) {
            EntityContracts.Phase phaseAtTickStart = phaseAtElapsed(contract.phases(),
                    Math.max(0, entity.ageMs() - stepMs));
            if (phaseAtTickStart != null) phase = phaseAtTickStart;
        }
        if (phase == null || phase.type() == null) return new TickResult(entity);
        return switch (phase.type()) {
            case PROJECTILE, RAY, ARC, MELEE ->
                    tickCanonicalProjectile(entity, contract, phase, bots, arena, stepMs, combat);
            case ZONE, SELF ->
                    tickCanonicalZone(entity, contract, phase, bots, arena, stepMs, combat);
            case SUMMON ->
                    tickCanonicalSummon(entity, contract, phase, allEntities, bots, arena, stepMs, combat);
        };
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalProjectile(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Phase phase, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        EntityContracts.Movement movement = phase.movement();
        String mode = movement == null ? "stopped" : movement.mode();
        boolean moving = "travel".equals(mode) || "segment".equals(mode);
        double scale = movement == null || movement.stepRatio() == 0
                ? 1 : movement.stepRatio();
        double nextX = moving ? entity.x() + entity.velocityX() * scale : entity.x();
        double nextY = moving ? entity.y() + entity.velocityY() * scale : entity.y();
        if (moving && Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001) {
            double radius = entity.size() / 2.0;
            nextX = clamp(nextX, radius, arena.width() - radius);
            nextY = clamp(nextY, radius, arena.height() - radius);
        }
        double velocityX = "stopped".equals(mode) ? 0 : entity.velocityX();
        double velocityY = "stopped".equals(mode) ? 0 : entity.velocityY();
        int timer = phase.durationMs() != null && entity.phaseLocked()
                ? entity.timerMs() - stepMs
                : switch (contract.lifetime().timerMode()) {
                    case AGE -> entity.timerMs() + stepMs;
                    case REMAINING, FUSE -> entity.timerMs() - stepMs;
                    default -> entity.timerMs();
                };
        ArenaEntity moved = copyWithPhase(entity, nextX, nextY, velocityX, velocityY,
                entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY),
                timer, entity.armed(), entity.ageMs(), phase.id(), entity.phaseLocked(),
                Math.max(0, entity.visibleMs() - stepMs), entity.visualEventType(),
                Math.max(0, entity.visualEventMs() - stepMs), entity.visualEventSize());
        moved = withPhaseTimer(moved, entity.phaseLocked()
                ? entity.phaseTimerMs() + stepMs
                : Math.max(0, entity.ageMs() - Math.max(0, phase.startMs())));

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
                && phase.hit().mode() == EntityContracts.HitMode.NEAREST
                ? candidates.stream().limit(1).toList() : candidates;
        EntityContracts.Repeat repeat = phase.repeat();
        EntityContracts.PhaseEventType repeatEvent = repeat == null ? null : repeat.event();
        if (repeatEvent == null && phase.events().containsKey(EntityContracts.PhaseEventType.INTERVAL)) {
            repeatEvent = EntityContracts.PhaseEventType.INTERVAL;
        }
        EntityContracts.PhaseEvent repeatHandler = repeatEvent == null
                ? null : phase.events().get(repeatEvent);
        int intervalTimer = moved.intervalTimerMs() - stepMs;
        boolean scheduled = repeatHandler != null;
        boolean due = !scheduled || intervalTimer <= 0;
        Map<Integer, ArenaEntity> collisionSources = new HashMap<>();
        for (HitCandidate<F> candidate : selected) {
            collisionSources.put(candidate.bot().entitySlot(), entity);
        }
        DispatchResult<F> dispatched = !due
                || selected.isEmpty() && !scheduled
                ? new DispatchResult<>(moved, bots)
                : dispatchPhaseEvent(moved, contract, phase,
                scheduled ? repeatEvent : EntityContracts.PhaseEventType.COLLISION,
                bots, arena, combat,
                selected.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                distancesBySlot(selected), collisionSources, stepMs);
        if (scheduled) {
            int intervalMs = repeat.intervalMs() != null ? repeat.intervalMs()
                    : (int) Math.round(stat(contract.abilityId(),
                    repeat.interval() != null ? repeat.interval() : repeatHandler.intervalStat(),
                    stepMs));
            intervalTimer += Math.max(1, intervalMs);
        }
        ArenaEntity next = dispatched.entity();
        if (next == null) return new TickResult(null);
        EntityContracts.Phase entered = EntityContracts.phaseFor(next);
        if (entered != null && entered.type() == EntityContracts.PhaseType.ZONE
                && !entered.id().equals(phase.id())) {
            return tickCanonicalZone(next, contract, entered, dispatched.bots(),
                    arena, stepMs, combat);
        }
        boolean edge = nextX == 0 || nextX == arena.width()
                || nextY == 0 || nextY == arena.height();
        EntityContracts.PhaseEvent edgeEvent = phase.events().get(
                EntityContracts.PhaseEventType.COLLISION);
        boolean removeAtEdge = edge && edgeEvent != null
                && edgeEvent.actions().contains(EntityContracts.PhaseAction.REMOVE);
        boolean expired = phase.durationMs() != null
                && (!next.phaseLocked()
                ? next.ageMs() >= Math.max(0, phase.startMs()) + phase.durationMs()
                : next.timerMs() <= 0);
        if (!expired) {
            expired = switch (contract.lifetime().timerMode()) {
                case AGE -> next.ageMs() >= stat(contract.abilityId(),
                        contract.lifetime().duration(), Integer.MAX_VALUE);
                case REMAINING, FUSE -> next.timerMs() <= 0;
                default -> false;
            };
        }
        if (expired || removeAtEdge) {
            DispatchResult<F> ended = dispatchPhaseEvent(next, contract, phase,
                    EntityContracts.PhaseEventType.LIFETIME_END, dispatched.bots(),
                    arena, combat, List.of(), Map.of(), stepMs);
            if (ended.entity() != null) {
                EntityContracts.Phase endedPhase = EntityContracts.phaseFor(ended.entity());
                if (endedPhase != null && endedPhase.type() == EntityContracts.PhaseType.ZONE
                        && !endedPhase.id().equals(phase.id())) {
                    return tickCanonicalZone(ended.entity(), contract, endedPhase,
                            ended.bots(), arena, stepMs, combat);
                }
            }
            return new TickResult(ended.entity());
        }
        return new TickResult(withIntervalTimer(next, intervalTimer));
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalZone(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Phase phase, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        EntityContracts.Phase selected = EntityContracts.phaseFor(entity);
        ArenaEntity current = entity;
        if (!entity.phaseLocked() && selected != null
                && !selected.id().equals(entity.phaseId())) {
            if (selected.durationMs() != null) current = transitionToPhase(entity, selected);
            else current = copyWithPhase(entity, entity.x(), entity.y(), 0, 0,
                    entity.traveled(), entity.timerMs(), true, entity.ageMs(),
                    selected.id(), false, entity.visibleMs(), entity.visualEventType(),
                    entity.visualEventMs(), entity.visualEventSize());
            phase = selected;
        }
        int timer = current.phaseLocked() && phase.durationMs() != null
                ? current.timerMs() - stepMs
                : current.timerMs() - (contract.lifetime().timerMode()
                == EntityContracts.TimerMode.REMAINING ? stepMs : 0);
        ArenaEntity moved = copyWithPhase(current, current.x(), current.y(), 0, 0,
                current.traveled(), timer, true, current.ageMs(), phase.id(),
                current.phaseLocked(), Math.max(0, current.visibleMs() - stepMs), current.visualEventType(),
                Math.max(0, current.visualEventMs() - stepMs), current.visualEventSize());
        moved = withPhaseTimer(moved, current.phaseLocked()
                ? current.phaseTimerMs() + stepMs
                : Math.max(0, current.ageMs() - Math.max(0, phase.startMs())));
        List<HitCandidate<F>> candidates = phaseTargets(moved, phase, bots);
        boolean active = contract.lifetime().timerMode() != EntityContracts.TimerMode.REMAINING
                || current.timerMs() > 0;
        List<Integer> targetSlots = candidates.stream()
                .map(candidate -> candidate.bot().entitySlot()).toList();
        Map<Integer, Double> distances = distancesBySlot(candidates);
        EntityContracts.Repeat repeat = phase.repeat();
        EntityContracts.PhaseEventType repeatEvent = repeat == null ? null : repeat.event();
        if (repeatEvent == null && phase.events().containsKey(EntityContracts.PhaseEventType.INTERVAL)) {
            repeatEvent = EntityContracts.PhaseEventType.INTERVAL;
        }
        EntityContracts.PhaseEvent intervalEvent = repeatEvent == null
                ? null : phase.events().get(repeatEvent);
        DispatchResult<F> dispatched = new DispatchResult<>(moved, bots);
        int intervalTimer = moved.intervalTimerMs() - stepMs;
        if (intervalEvent != null && active) {
            int intervalMs = repeat != null && repeat.intervalMs() != null
                    ? repeat.intervalMs()
                    : (int) Math.round(stat(contract.abilityId(),
                    repeat != null && repeat.interval() != null
                            ? repeat.interval() : phaseIntervalStat(phase, intervalEvent),
                    stepMs));
            boolean canRun = current.timerMs() > 0
                    || contract.lifetime().timerMode() != EntityContracts.TimerMode.REMAINING;
            while (intervalTimer <= 0 && canRun && dispatched.entity() != null) {
                dispatched = dispatchPhaseEvent(dispatched.entity(), contract, phase,
                        repeatEvent, dispatched.bots(), arena, combat,
                        targetSlots, distances, stepMs);
                intervalTimer += Math.max(1, intervalMs);
            }
        } else if (active && phase.events().containsKey(EntityContracts.PhaseEventType.COLLISION)) {
            dispatched = dispatchPhaseEvent(moved, contract, phase,
                    EntityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    targetSlots, distances, stepMs);
        }
        if (dispatched.entity() == null) return new TickResult(null);
        ArenaEntity next = withIntervalTimer(dispatched.entity(), intervalTimer);
        boolean expired = phase.durationMs() != null && next.phaseLocked()
                && next.timerMs() <= 0
                || phase.durationMs() == null
                && contract.lifetime().timerMode() == EntityContracts.TimerMode.REMAINING
                && next.timerMs() <= 0;
        if (expired) {
            if (next.visualEventMs() > 0) return new TickResult(next);
            DispatchResult<F> ended = dispatchPhaseEvent(next, contract, phase,
                    EntityContracts.PhaseEventType.LIFETIME_END, dispatched.bots(),
                    arena, combat, List.of(), Map.of(), stepMs);
            return new TickResult(ended.entity() == next
                    && !phase.events().containsKey(EntityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalSummon(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Phase phase, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, int stepMs, Combat<F> combat) {
        int lifetime = (int) Math.round(stat(contract.abilityId(),
                contract.lifetime().duration(), Abilities.durationMs(contract.abilityId())));
        int damage = Math.max(0, combat.damageToEntity(entity, bots, allEntities));
        int hp = entity.hp() - damage;
        if (entity.ageMs() >= lifetime || hp <= 0) return new TickResult(null);
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
        EntityContracts.Movement movement = phase.movement();
        double speed = movement == null ? 0 : stat(contract.abilityId(), movement.speed(), 0);
        double size = stat(contract.abilityId(), "size", next.size());
        double desired = vectorBearing(dx, dy);
        double current = vectorBearing(next.velocityX(), next.velocityY());
        double rotation = normalizeDegrees(current
                + clamp(shortestDelta(current, desired), -8, 8));
        double radians = Math.toRadians(rotation - 90);
        double nextX = clamp(next.x() + dx / targetDistance * Math.min(speed, targetDistance),
                size / 2, arena.width() - size / 2);
        double nextY = clamp(next.y() + dy / targetDistance * Math.min(speed, targetDistance),
                size / 2, arena.height() - size / 2);
        next = copyWithPhase(next, nextX, nextY, Math.cos(radians), Math.sin(radians),
                next.traveled(), next.timerMs(), true, next.ageMs(), phase.id(), false,
                next.visibleMs(), next.visualEventType(), next.visualEventMs(),
                next.visualEventSize(), rotation);
        EntityContracts.Attack attack = phase.attack();
        if (attack != null && next.intervalTimerMs() <= 0
                && rayIntersectsCircle(next.x(), next.y(), next.velocityX(), next.velocityY(),
                stat(contract.abilityId(), attack.range(), 0), target.entityX(),
                target.entityY(), target.entitySize() / 2.0)) {
            DispatchResult<F> result = dispatchPhaseEvent(next, contract, phase,
                    EntityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    List.of(target.entitySlot()), Map.of(target.entitySlot(), targetDistance),
                    Map.of(target.entitySlot(), next), stepMs);
            next = result.entity();
            bots = result.bots();
            if (next != null) {
                next = withIntervalTimer(next, (int) Math.round(stat(
                        contract.abilityId(), attack.cooldown(), 1000)));
                next = withShotVisual(next, (int) Math.round(stat(
                        contract.abilityId(), attack.visual(), 300)));
            }
        } else {
            next = withIntervalTimer(next,
                    Math.max(0, next.intervalTimerMs() - stepMs));
        }
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> List<HitCandidate<F>> phaseTargets(
            ArenaEntity entity, EntityContracts.Phase phase, List<F> bots) {
        String radiusName = phase.hitbox() == null ? "radius" : phase.hitbox().radius();
        double radius = phaseRadius(entity.abilityId(), phase, radiusName,
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

    private static String phaseIntervalStat(EntityContracts.Phase phase,
                                            EntityContracts.PhaseEvent event) {
        EntityContracts.Persistence persistence = phase.persistence();
        return persistence != null && persistence.interval() != null
                ? persistence.interval() : event.intervalStat();
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Phase phase, EntityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances, int stepMs) {
        return dispatchPhaseEvent(entity, contract, phase, eventType, bots, arena,
                combat, targetSlots, distances, Map.of(), stepMs);
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Phase phase, EntityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances,
            Map<Integer, ArenaEntity> effectSources, int stepMs) {
        EntityContracts.PhaseEvent event = phase.events().get(eventType);
        if (event == null) return new DispatchResult<>(entity, bots);
        ArenaEntity next = entity;
        Set<EffectType> effects = event.effectTypes().isEmpty()
                ? phase.effectTypes() : event.effectTypes();
        for (EntityContracts.PhaseAction action : event.actions()) {
            if (action == EntityContracts.PhaseAction.APPLY_EFFECTS) {
                for (Integer targetSlot : targetSlots) {
                    F target = bots.stream().filter(bot -> bot.entitySlot() == targetSlot)
                            .findFirst().orElse(null);
                    if (next == null || target == null || target.entityHp() <= 0
                            || target.ignoresHostileEffects()
                            || phase.skipOwner() && target.entitySlot() == next.ownerSlot()
                            || !canHitTarget(next, targetSlot, phase, eventType, stepMs)) continue;
                    applyEntityEffects(bots, target,
                            effectSources.getOrDefault(targetSlot, next),
                            contract.abilityId(), effects, arena, combat,
                            "source", distances.getOrDefault(targetSlot, Double.NaN),
                            phase.effectOverrides(), phase.statOverrides());
                    next = recordTargetHit(next, targetSlot, stepMs);
                }
            } else if (action == EntityContracts.PhaseAction.TRANSITION) {
                EntityContracts.Phase target = EntityContracts.phaseById(next,
                        event.transitionPhaseId());
                if (target != null) next = transitionToPhase(next, target);
            } else if (action == EntityContracts.PhaseAction.EMIT_VISUAL) {
                int visibleMs = event.visibleMs() != null ? event.visibleMs()
                        : event.visibleStat() == null ? 0
                        : (int) Math.round(stat(contract.abilityId(), event.visibleStat(), 0));
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
            } else if (action == EntityContracts.PhaseAction.REMOVE) {
                next = null;
            }
            if (next == null) break;
        }
        return new DispatchResult<>(next, bots);
    }

    private static boolean canHitTarget(ArenaEntity entity, int targetSlot,
                                        EntityContracts.Phase phase,
                                        EntityContracts.PhaseEventType eventType,
                                        int stepMs) {
        EntityContracts.Persistence persistence = phase.persistence();
        if (persistence == null
                || persistence.mode() == EntityContracts.PersistenceMode.EVERY_TICK) return true;
        if (eventType == EntityContracts.PhaseEventType.INTERVAL
                || phase.repeat() != null && phase.repeat().event() == eventType) return true;
        Integer previous = entity.hitLedger().get(targetSlot);
        if (previous == null) return true;
        if (persistence.mode() == EntityContracts.PersistenceMode.ONCE) return false;
        int interval = persistence.intervalMs() != null ? persistence.intervalMs()
                : (int) Math.round(stat(entity.abilityId(), persistence.interval(), 0));
        return eventTimestampMs(entity, stepMs) - previous >= interval;
    }

    private static ArenaEntity recordTargetHit(ArenaEntity entity, int targetSlot,
                                                int stepMs) {
        EntityContracts.Phase phase = EntityContracts.phaseFor(entity);
        if (phase != null && phase.persistence() != null
                && phase.persistence().mode() == EntityContracts.PersistenceMode.EVERY_TICK) {
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
                                                  EntityContracts.Phase phase) {
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
            Set<EffectType> allowedEffects, ArenaBounds arena, Combat<F> combat,
            String knockbackDirection, double collisionDistance,
            Map<String, AbilityContracts.EffectOverride> overrides,
            Map<String, Double> statOverrides) {
        if (!isEnemy(source.ownerSlot(), target, bots)) return;
        AbilityContracts.AbilityContract contract = AbilityContracts.get(abilityId);
        for (AbilityContracts.Effect effect : contract.effects()) {
            if (!allowedEffects.isEmpty() && !allowedEffects.contains(effect.type())) continue;
            AbilityContracts.EffectOverride override = effectOverrideFor(effect, overrides);
            AbilityContracts.Effect resolved = withEffectOverride(effect, override);
            double distance = Double.isFinite(collisionDistance)
                    ? collisionDistance
                    : distance(source.x(), source.y(), target.entityX(), target.entityY());
            Double rangeOverride = phaseRange(statOverrides);
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
                    EntityContracts.Phase sourcePhase = EntityContracts.phaseFor(source);
                    if ("silence".equals(resolved.subtype())
                            && durationMs <= 0
                            && sourcePhase != null
                            && sourcePhase.type() == EntityContracts.PhaseType.ZONE) {
                        target.setZoneSilenced(true);
                    } else {
                        target.applyStatus(resolved.subtype(),
                                durationMs, source.ownerSlot());
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

    private static AbilityContracts.Effect withEffectOverride(
            AbilityContracts.Effect effect, AbilityContracts.EffectOverride override) {
        if (override == null) return effect;
        AbilityContracts.Falloff falloff = override.falloff() == null
                ? effect.falloff()
                : (effect.falloff() == null
                    ? override.falloff() : effect.falloff().mergedWith(override.falloff()));
        if (override.amount() != null && override.falloff() == null) falloff = null;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(),
                override.amount() == null ? effect.amount() : override.amount(),
                override.durationMs() == null ? effect.durationMs() : override.durationMs(),
                effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff);
    }

    private static AbilityContracts.EffectOverride effectOverrideFor(
            AbilityContracts.Effect effect,
            Map<String, AbilityContracts.EffectOverride> overrides) {
        if (overrides == null || overrides.isEmpty()) return null;
        AbilityContracts.EffectOverride override = overrides.get(
                AbilityContracts.effectOverrideKey(effect));
        if (override != null) return override;
        return overrides.get(effect.type().name().toLowerCase());
    }

    private static double resolveEffectAmount(int abilityId,
                                              AbilityContracts.Effect effect,
                                              AbilityContracts.EffectOverride override,
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
                                             AbilityContracts.Effect effect,
                                             double distance,
                                             Double rangeOverride) {
        return Abilities.durationAtDistance(abilityId, distance,
                effect.durationMs(), effect.falloff(), rangeOverride);
    }

    private static Double phaseRange(Map<String, Double> statOverrides) {
        if (statOverrides == null) return null;
        Double range = statOverrides.get("range");
        if (range != null) return range;
        return statOverrides.get("radius");
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

    private static double phaseRadius(int abilityId, EntityContracts.Phase phase,
                                      String radius, double fallback) {
        double value = phase == null || radius == null ? fallback
                : phase.statOverrides().getOrDefault(radius,
                stat(abilityId, radius, fallback));
        double multiplier = phase == null || phase.hitbox() == null
                ? 1 : phase.hitbox().radiusMultiplier();
        return value * multiplier;
    }

    private static double stat(int abilityId, String name, double fallback) {
        return EntityContracts.stat(abilityId, name, fallback);
    }

    private static double phaseStat(int abilityId, EntityContracts.Phase phase,
                                    String name, double fallback) {
        if (phase != null && name != null && phase.statOverrides().containsKey(name)) {
            return phase.statOverrides().get(name);
        }
        return stat(abilityId, name, fallback);
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
