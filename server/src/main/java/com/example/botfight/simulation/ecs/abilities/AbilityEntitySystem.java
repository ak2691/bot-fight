package com.example.botfight.simulation.ecs.abilities;

import com.example.botfight.simulation.core.combat.AbilityVerbs;
import com.example.botfight.simulation.core.combat.Effects;
import com.example.botfight.simulation.core.combat.FindTargets;
import com.example.botfight.simulation.core.orchestration.CombatLog;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.HitStagger;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
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
        boolean entityHitByCurrentAttack(ArenaEntity entity, List<F> bots,
                                         List<ArenaEntity> entities);

        /** Applies collision effects to one HP-bearing entity. */
        default ArenaEntity applyEffectsToEntity(ArenaEntity entity, List<F> bots,
                                                  List<ArenaEntity> entities,
                                                  ArenaBounds arena, int stepMs) {
            return entity;
        }

        /** Notes that the owner's ability landed on an enemy bot this tick (Time Since Hit). */
        default void recordEnemyHit(List<F> bots, int ownerSlot, int abilityId, String entityId) {}

        /** The owner's damage multiplier for the statuses it applies, or null when the owner is gone. */
        default Double ownerDamageMultiplier(List<F> bots, int ownerSlot) {
            return 1.0;
        }

        /**
         * A fresh entity id for an entity that another entity spawns, remembering which activation made it; null
         * when the owner is gone. The default numbers them after the parent.
         */
        default String spawnEntityId(List<F> bots, int ownerSlot, String idPrefix, String parentEntityId) {
            return idPrefix + "-" + parentEntityId + "-" + System.nanoTime();
        }

        /** Whether the owner's ability is still in its active stage (a bound entity lives only that long). */
        default boolean castActive(List<F> bots, int ownerSlot, int abilityId) {
            return true;
        }

        /** The owner's pose {x, y, rotation}, or null when the owner is gone. */
        default double[] ownerPose(List<F> bots, int ownerSlot) {
            return null;
        }
    }

    /** Entities that a spawn verb inside an entity event creates wait here and join the world after the tick. */
    private static final ThreadLocal<List<ArenaEntity>> SPAWN_QUEUE = new ThreadLocal<>();

    public static boolean isAbilityEntity(ArenaEntity entity) {
        AbilityContracts.EntityContract contract = AbilityContracts.forEntity(entity);
        return contract != null && !contract.phases().isEmpty();
    }

    public static <F extends AbilityEntityBot> List<ArenaEntity> tick(
            List<ArenaEntity> entities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        List<ArenaEntity> spawned = new ArrayList<>();
        List<ArenaEntity> previousQueue = SPAWN_QUEUE.get();
        SPAWN_QUEUE.set(spawned);
        try {
            List<ArenaEntity> next = tickWorld(entities, bots, arena, stepMs, combat);
            if (spawned.isEmpty()) return next;
            List<ArenaEntity> all = new ArrayList<>(next);
            spawned.stream().map(ArenaEntity::settleTickMetrics).forEach(all::add);
            return all;
        } finally {
            SPAWN_QUEUE.set(previousQueue);
        }
    }

    private static <F extends AbilityEntityBot> List<ArenaEntity> tickWorld(
            List<ArenaEntity> entities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        List<ArenaEntity> tickEntities = bindEntitiesToOwners(entities, bots, combat).stream()
                .map(ArenaEntity::beginTickMetrics).toList();
        bots.forEach(AbilityEntityBot::clearZonePresence);
        Run<F> run = new Run<>(tickEntities, bots, arena, stepMs, combat);
        Set<String> removedByEntityCollision = entityCollisionRemovalIds(tickEntities, bots);

        List<ArenaEntity> next = new ArrayList<>();
        List<ArenaEntity> triggerGroup = tickEntities.stream().filter(AbilityEntitySystem::hasTrigger).toList();
        Set<String> triggerIds = new HashSet<>(triggerGroup.stream().map(ArenaEntity::id).toList());
        settleTriggerEntities(run, triggerGroup, removedByEntityCollision, next);
        for (ArenaEntity entity : tickEntities) {
            if (triggerIds.contains(entity.id()) || removedByEntityCollision.contains(entity.id())) continue;
            AbilityContracts.EntityContract contract = AbilityContracts.forEntity(entity);
            if (contract == null || contract.phases().isEmpty()) {
                next.add(entity);
                continue;
            }
            ArenaEntity settled = tickEntity(entity, run, false);
            if (settled != null) next.add(settled);
        }
        return next.stream().map(ArenaEntity::settleTickMetrics).toList();
    }

    // ---- the entity tick

    /** What one stage of the tick shares: the entities as the tick began, and the bots as events change them. */
    private static final class Run<F extends AbilityEntityBot> {
        final List<ArenaEntity> entities;
        final ArenaBounds arena;
        final int stepMs;
        final Combat<F> combat;
        List<F> bots;

        Run(List<ArenaEntity> entities, List<F> bots, ArenaBounds arena, int stepMs, Combat<F> combat) {
            this.entities = entities;
            this.bots = bots;
            this.arena = arena;
            this.stepMs = stepMs;
            this.combat = combat;
        }
    }

    /** An entity after its clocks ran and the world's impacts reached it, before it reacts. */
    private record Advanced(ArenaEntity entity, AbilityContracts.AbilityPhase phase, int timerBefore,
                            int damage, boolean killed) {}

    /** Where an entity went this tick; {@code seeking} entities carry the enemy they chase. */
    private record Move<F extends AbilityEntityBot>(ArenaEntity before, ArenaEntity entity,
                                                    double startX, double startY, double endX, double endY,
                                                    boolean hitEdge, boolean seeking, F target) {}

    private record Entered(ArenaEntity entity, boolean entered) {}

    /**
     * One entity, one tick: advance (clocks, incoming impacts), then settle (incoming events, movement, due
     * events, lifetime end, phase entry). Nothing dispatches on what kind of entity it is; a trap is a phase
     * with a trigger, a summon is seek movement plus a schedule event. Returns null when the entity is gone.
     */
    private static <F extends AbilityEntityBot> ArenaEntity tickEntity(
            ArenaEntity entity, Run<F> run, boolean triggered) {
        Advanced advanced = advance(entity, run);
        return advanced.entity() == null ? null : settle(advanced, run, triggered);
    }

    private static boolean hasTrigger(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        return phase != null && phase.trigger() != null;
    }

    /**
     * Entities in a phase with a trigger settle first and together: a chain trigger sets off its neighbours, so
     * every one of them advances before any of them reacts. Their results lead the tick's entity list.
     */
    private static <F extends AbilityEntityBot> void settleTriggerEntities(
            Run<F> run, List<ArenaEntity> group, Set<String> removed, List<ArenaEntity> next) {
        List<Advanced> entries = new ArrayList<>();
        for (ArenaEntity source : group) {
            if (removed.contains(source.id())) continue;
            Advanced advanced = advance(source, run);
            if (advanced.entity() == null) continue;
            if (advanced.phase().health() != null && advanced.entity().hp() <= 0 && !advanced.killed()) continue;
            entries.add(advanced);
        }
        Set<String> triggered = resolveTriggers(entries, run);
        for (Advanced advanced : entries) {
            ArenaEntity settled = settle(advanced, run, triggered.contains(advanced.entity().id()));
            if (settled == null) continue;
            // A phase entered here counts the entry tick as its first tick.
            next.add(settled.phaseId() != null && !settled.phaseId().equals(advanced.phase().id())
                    ? consumeEnteredPhaseTick(settled, run.stepMs) : settled);
        }
    }

    private static ArenaEntity consumeEnteredPhaseTick(ArenaEntity entity, int stepMs) {
        ArenaEntity consumed = copyWithPhase(entity, entity.x(), entity.y(),
                entity.velocityX(), entity.velocityY(), entity.traveled(),
                entity.timerMs() - Math.max(0, stepMs), entity.armed(), entity.ageMs(),
                entity.phaseId(), entity.phaseLocked());
        return withPhaseTimer(consumed, entity.phaseTimerMs() + Math.max(0, stepMs));
    }

    /** The trigger group's ids that fire this tick: a hit, a bot in reach, or a chain from a neighbour that fired. */
    private static <F extends AbilityEntityBot> Set<String> resolveTriggers(List<Advanced> entries, Run<F> run) {
        Set<String> fired = new HashSet<>();
        Set<String> killed = new HashSet<>();
        for (Advanced advanced : entries) {
            ArenaEntity trap = advanced.entity();
            if (advanced.killed()) {
                killed.add(trap.id());
                continue;
            }
            AbilityContracts.Trigger trigger = advanced.phase().trigger();
            boolean hit = entityHitByCurrentAttack(trap, run.entities, run.bots, run.arena, trigger, run.combat);
            boolean contact = trigger.botContact() && !FindTargets.findTargets(null, null,
                    FindTargets.Options.circle(trap, FindTargets.Sweep.of(trap),
                            triggerRadius(trigger),
                            bot -> isEnemy(trap.ownerSlot(), (AbilityEntityBot) bot, run.bots)), run.bots).isEmpty();
            if (hit || contact) fired.add(trap.id());
        }
        boolean changed;
        do {
            changed = false;
            for (Advanced source : entries) {
                AbilityContracts.Trigger trigger = source.phase().trigger();
                if (!fired.contains(source.entity().id()) || !trigger.chain()) continue;
                double radius = triggerRadius(trigger);
                for (Advanced target : entries) {
                    if (fired.contains(target.entity().id()) || killed.contains(target.entity().id())
                            || !java.util.Objects.equals(target.entity().abilityId(), source.entity().abilityId())
                            || distance(target.entity().x(), target.entity().y(),
                            source.entity().x(), source.entity().y()) > radius) continue;
                    fired.add(target.entity().id());
                    changed = true;
                }
            }
        } while (changed);
        return fired;
    }

    /**
     * Advances the clocks and lets the world's impacts reach an entity that has health. An entity that
     * statuses or impacts removed comes back with a null entity.
     */
    private static <F extends AbilityEntityBot> Advanced advance(ArenaEntity source, Run<F> run) {
        AbilityContracts.EntityContract contract = AbilityContracts.forEntity(source);
        ArenaEntity entity = clearEntityPresenceStatuses(source);
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        int previousHp = Math.max(0, entity.hp());
        int timerBefore = entity.timerMs();
        entity = tickSummonStatuses(entity, run.stepMs);
        boolean armed = entity.armed() || phase.type() == AbilityContracts.PhaseType.ZONE
                || phase.type() == AbilityContracts.PhaseType.SUMMON;
        entity = copyWithPhase(entity, entity.x(), entity.y(), entity.velocityX(), entity.velocityY(),
                entity.traveled(), timerAfter(entity, contract, phase, run.stepMs), armed, entity.ageMs(),
                phase.id(), entity.phaseLocked());
        // A phase with a schedule event is timed by that schedule (a summon's shots), so it has no phase clock.
        if (phase.on().get(AbilityContracts.PhaseEventType.SCHEDULE) == null) {
            entity = withPhaseTimer(entity, entity.phaseTimerMs() + run.stepMs);
        }
        entity = withIntervalTimer(entity, Math.max(0, entity.intervalTimerMs() - run.stepMs));
        int damage = 0;
        boolean killed = false;
        if (phase.health() != null) {
            ArenaEntity effected = run.combat.applyEffectsToEntity(
                    entity, run.bots, run.entities, run.arena, run.stepMs);
            if (effected == null) return new Advanced(null, phase, timerBefore, 0, false);
            int hp = Math.max(0, effected.hp());
            damage = Math.max(0, previousHp - effected.hp());
            killed = previousHp > 0 && hp <= 0 && damage > 0;
            entity = effected.withHp(hp);
        }
        return new Advanced(entity, phase, timerBefore, damage, killed);
    }

    /** The entity timer after one tick: counts up for an age-timed projectile, down for a fuse or an area. */
    private static int timerAfter(ArenaEntity entity, AbilityContracts.EntityContract contract,
                                  AbilityContracts.AbilityPhase phase, int stepMs) {
        AbilityContracts.TimerMode mode = contract.lifetime().timerMode();
        return switch (phase.type()) {
            case PROJECTILE -> switch (mode) {
                case AGE -> entity.timerMs() + stepMs;
                case REMAINING, FUSE -> entity.timerMs() - stepMs;
                default -> entity.timerMs();
            };
            case ZONE -> phase.trigger() != null || phase.durationMs() != null
                    || mode == AbilityContracts.TimerMode.REMAINING
                    ? entity.timerMs() - stepMs : entity.timerMs();
            case SUMMON -> entity.timerMs();
        };
    }

    private static <F extends AbilityEntityBot> ArenaEntity settle(
            Advanced advanced, Run<F> run, boolean triggered) {
        AbilityContracts.EntityContract contract = AbilityContracts.forEntity(advanced.entity());
        ArenaEntity entity = advanced.entity();
        AbilityContracts.AbilityPhase phase = advanced.phase();

        // Incoming impacts raise hit and killed. An entity with no killed handler dies when its health runs out.
        if (advanced.damage() > 0) {
            AbilityContracts.PhaseEventType type = advanced.killed()
                    ? AbilityContracts.PhaseEventType.KILLED : AbilityContracts.PhaseEventType.HIT;
            AbilityContracts.PhaseEvent handler = phase.on().get(type);
            if (advanced.killed() && handler == null) return null;
            if (handler != null) entity = fire(run, entity, phase, type, List.of(), Map.of(), -1).entity();
            if (entity == null) return null;
            AbilityContracts.AbilityPhase incomingPhase = AbilityContracts.phaseFor(entity);
            if (entity.hp() <= 0 && (incomingPhase == null || incomingPhase.health() != null)) return null;
            Entered entered = enterPhase(run, entity, phase, handler, type);
            if (entered.entered()) return entered.entity();
            phase = incomingPhase == null ? phase : incomingPhase;
        }
        if (entity.hp() <= 0 && phase.health() != null) return null;

        Move<F> move = moveEntity(entity, phase, run);
        entity = move.entity();

        // Due events. Collision runs while the entity had life left when the tick began.
        AbilityContracts.PhaseEvent collisionEvent = phase.on().get(AbilityContracts.PhaseEventType.COLLISION);
        if (collisionEvent != null) {
            boolean alive = contract.lifetime().timerMode() != AbilityContracts.TimerMode.REMAINING
                    || advanced.timerBefore() > 0;
            Entered collided = collisionEventStep(run, contract, entity, phase, move, alive);
            if (collided.entered() || collided.entity() == null) return collided.entity();
            entity = collided.entity();
        }
        if (triggered) {
            List<HitCandidate<F>> targets = phaseTargets(entity, phase, run.bots,
                    AbilityContracts.PhaseEventType.TRIGGER);
            DispatchResult<F> result = fire(run, entity, phase, AbilityContracts.PhaseEventType.TRIGGER,
                    targets, Map.of(), -1);
            return enterPhase(run, result.entity(), phase,
                    phase.on().get(AbilityContracts.PhaseEventType.TRIGGER),
                    AbilityContracts.PhaseEventType.TRIGGER).entity();
        }
        // A timer event does not fire on the entity's last tick, nor while a seeking entity has nothing to chase.
        AbilityContracts.PhaseEvent scheduled = phase.on().get(AbilityContracts.PhaseEventType.SCHEDULE);
        if (scheduled != null && !(move.seeking() && move.target() == null)) {
            int intervalMs = scheduled.schedule().intervalMs() == null ? 1_000 : scheduled.schedule().intervalMs();
            if (!summonCanExecute(entity)) entity = withIntervalTimer(entity, Math.max(1, intervalMs));
            if (!lifeExpired(entity, contract) && entity.intervalTimerMs() <= 0) {
                DispatchResult<F> result = fire(run, entity, phase, AbilityContracts.PhaseEventType.SCHEDULE,
                        List.of(), Map.of(), move.target() == null ? -1 : move.target().entitySlot());
                entity = result.entity();
                if (entity == null) return null;
                if (result.hitConnected() || !scheduled.waitForHit()) {
                    entity = withIntervalTimer(entity, Math.max(1, intervalMs));
                }
                Entered entered = enterPhase(run, entity, phase, scheduled,
                        AbilityContracts.PhaseEventType.SCHEDULE);
                if (entered.entered()) return entered.entity();
            }
        }

        // Lifetime end: the phase ran its duration, the entity ran out of life, or a projectile left the arena.
        boolean phaseExpired = phase.durationMs() != null && entity.phaseTimerMs() >= phase.durationMs();
        boolean removeAtEdge = move.hitEdge() && collisionEvent != null
                && collisionEvent.has(AbilityContracts.RemoveVerb.class);
        if (!phaseExpired && !lifeExpired(entity, contract) && !removeAtEdge) return entity;
        AbilityContracts.PhaseEvent lifetimeEnd = phase.on().get(AbilityContracts.PhaseEventType.LIFETIME_END);
        ArenaEntity ended = fire(run, entity, phase, AbilityContracts.PhaseEventType.LIFETIME_END,
                List.of(), Map.of(), -1).entity();
        if (ended == entity && lifetimeEnd == null) return null;
        return enterPhase(run, ended, phase, lifetimeEnd, AbilityContracts.PhaseEventType.LIFETIME_END).entity();
    }

    /** The entity has lived through its contract's whole lifetime, whatever its phase clock says. */
    private static boolean lifeExpired(ArenaEntity entity, AbilityContracts.EntityContract contract) {
        return switch (contract.lifetime().timerMode()) {
            case AGE -> entity.ageMs() >= contract.lifetime().duration();
            case REMAINING, FUSE -> entity.timerMs() <= 0;
            default -> false;
        };
    }

    /** Runs one event through the verb executor and carries the bots it changed into the run. */
    private static <F extends AbilityEntityBot> DispatchResult<F> fire(
            Run<F> run, ArenaEntity entity, AbilityContracts.AbilityPhase phase,
            AbilityContracts.PhaseEventType type, List<HitCandidate<F>> targets,
            Map<Integer, ArenaEntity> effectSources, int seekTargetSlot) {
        DispatchResult<F> result = dispatchPhaseEvent(entity, AbilityContracts.forEntity(entity), phase, type,
                run.bots, run.arena, run.combat,
                targets.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                distancesBySlot(targets), effectSources, run.stepMs, seekTargetSlot);
        run.bots = result.bots();
        return result;
    }

    /**
     * Phase entry. When an event moved the entity into another phase, that phase's collision runs once at its
     * position (unless the event opted out), and the once-collision counts as run. A phase a kill moved the
     * entity into keeps its schedule fresh, so its first scheduled collision still runs next tick. This is the
     * only place the entered phase's collision check lives.
     */
    private static <F extends AbilityEntityBot> Entered enterPhase(
            Run<F> run, ArenaEntity entity, AbilityContracts.AbilityPhase from,
            AbilityContracts.PhaseEvent event, AbilityContracts.PhaseEventType type) {
        AbilityContracts.AbilityPhase entered = entity == null ? null : AbilityContracts.phaseFor(entity);
        if (entered == null || entered.id().equals(from.id())) return new Entered(entity, false);
        AbilityContracts.PhaseEvent collision = entered.on().get(AbilityContracts.PhaseEventType.COLLISION);
        if (event != null && !event.recheckCollisionOnTransition()
                || collision == null || !collision.has(AbilityContracts.ApplyEffectsVerb.class)) {
            return new Entered(entity, true);
        }
        // An area a collision opens counts the entry tick on its timer.
        if (type == AbilityContracts.PhaseEventType.COLLISION && entered.type() == AbilityContracts.PhaseType.ZONE) {
            entity = copyWithPhase(entity, entity.x(), entity.y(), entity.velocityX(), entity.velocityY(),
                    entity.traveled(), timerAfter(entity, AbilityContracts.forEntity(entity), entered, run.stepMs),
                    entity.armed(), entity.ageMs(), entity.phaseId(), entity.phaseLocked());
        }
        List<HitCandidate<F>> targets = phaseTargets(entity, entered, run.bots);
        ArenaEntity result = fire(run, entity, entered, AbilityContracts.PhaseEventType.COLLISION,
                targets, Map.of(), -1).entity();
        boolean marks = type != AbilityContracts.PhaseEventType.KILLED;
        return new Entered(result != null && marks
                ? markScheduledEvent(result, AbilityContracts.PhaseEventType.COLLISION) : result, true);
    }

    /** The collision event when it is due: targets found along the entity's move, then the event once per check. */
    private static <F extends AbilityEntityBot> Entered collisionEventStep(
            Run<F> run, AbilityContracts.EntityContract contract, ArenaEntity entity,
            AbilityContracts.AbilityPhase phase, Move<F> move, boolean alive) {
        AbilityContracts.PhaseEvent event = phase.on().get(AbilityContracts.PhaseEventType.COLLISION);
        EventScheduleResult schedule = eventSchedule(
                entity, phase, AbilityContracts.PhaseEventType.COLLISION, run.stepMs);
        ArenaEntity next = entity;
        if (alive && schedule.checks() > 0) {
            boolean body = phase.type() == AbilityContracts.PhaseType.PROJECTILE;
            List<HitCandidate<F>> candidates = body
                    ? bodyTargets(run, entity, phase, event, move) : phaseTargets(entity, phase, run.bots);
            List<HitCandidate<F>> selected = body && event.nearestOnly()
                    ? candidates.stream().limit(1).toList() : candidates;
            boolean hasTargets = !selected.isEmpty() || body && touchesHpEntity(run, entity, event);
            boolean emitsVisual = event.has(AbilityContracts.EmitVisualVerb.class);
            Map<Integer, ArenaEntity> sources = new HashMap<>();
            if (body) selected.forEach(candidate -> sources.put(candidate.bot().entitySlot(), move.before()));
            for (int check = 0; check < schedule.checks() && next != null; check++) {
                if (!hasTargets && !emitsVisual) continue;
                next = fire(run, next, phase, AbilityContracts.PhaseEventType.COLLISION, selected, sources, -1)
                        .entity();
                Entered entered = enterPhase(run, next, phase, event, AbilityContracts.PhaseEventType.COLLISION);
                if (entered.entered()) return entered;
            }
        }
        if (next == null) return new Entered(null, false);
        return new Entered(withEventScheduleState(next, AbilityContracts.PhaseEventType.COLLISION,
                schedule.state()), false);
    }

    /** A projectile collides as its body: its collider swept along the move, nearest first. */
    private static <F extends AbilityEntityBot> List<HitCandidate<F>> bodyTargets(
            Run<F> run, ArenaEntity entity, AbilityContracts.AbilityPhase phase,
            AbilityContracts.PhaseEvent event, Move<F> move) {
        if (!eventTargetsKind(event, AbilityContracts.TargetKind.BOT)) return List.of();
        return FindTargets.<F>findTargets(null, null,
                FindTargets.Options.collider(entity,
                        new FindTargets.Sweep(move.startX(), move.startY(), move.endX(), move.endY()),
                        botFilter(move.before(), run.bots)), run.bots).stream()
                .map(hit -> new HitCandidate<>(hit.target(), hit.distance())).toList();
    }

    /** Whether a projectile overlaps an HP-bearing entity its collision event names. */
    private static <F extends AbilityEntityBot> boolean touchesHpEntity(
            Run<F> run, ArenaEntity entity, AbilityContracts.PhaseEvent event) {
        return run.entities.stream().anyMatch(target -> {
            AbilityContracts.AbilityPhase targetPhase = AbilityContracts.phaseFor(target);
            boolean summonTarget = AbilityContracts.isSummon(target);
            return !target.id().equals(entity.id())
                    && target.hp() > 0
                    && AbilityContracts.eventTargetsEntity(event, summonTarget)
                    && (allowsFriendlyDamage(targetPhase) || entityOwnersAreHostile(entity, target, run.bots))
                    && overlaps(entity, target);
        });
    }

    // ---- movement

    /**
     * Moves an entity by its phase's movement mode and returns the sweep it covered. {@code straight} follows its
     * heading (backward on request) inside the arena, {@code static} stays, and {@code seek} turns toward the
     * nearest living enemy and closes on it. {@code followOwner} poses are set earlier, when the entity binds to
     * its owner.
     */
    private static <F extends AbilityEntityBot> Move<F> moveEntity(
            ArenaEntity entity, AbilityContracts.AbilityPhase phase, Run<F> run) {
        AbilityContracts.PhaseMovement movement = phase.movement();
        if (movement != null && movement.mode() == AbilityContracts.MovementMode.SEEK) {
            return seekEntity(entity, phase, movement, run);
        }
        double speed = movement == null ? 0 : movement.speed();
        boolean moving = speed > 0;
        double magnitude = Math.hypot(entity.velocityX(), entity.velocityY());
        double baseX;
        double baseY;
        boolean backwards = movement != null && "backward".equals(movement.direction());
        if (magnitude > 0.001) {
            baseX = entity.velocityX() / magnitude;
            baseY = entity.velocityY() / magnitude;
        } else if (backwards) {
            double radians = Math.toRadians(entity.rotation() - 90.0);
            baseX = Math.cos(radians);
            baseY = Math.sin(radians);
        } else {
            // An entity with no heading has nowhere to go until a phase gives it one.
            baseX = 0;
            baseY = 0;
        }
        double directionX = backwards ? -baseX : baseX;
        double directionY = backwards ? -baseY : baseY;
        double endX = moving ? clamp(entity.x() + directionX * speed, 0, run.arena.width()) : entity.x();
        double endY = moving ? clamp(entity.y() + directionY * speed, 0, run.arena.height()) : entity.y();
        ArenaEntity moved = copyWithPhase(entity, endX, endY, moving ? directionX * speed : 0,
                moving ? directionY * speed : 0, entity.traveled() + distance(entity.x(), entity.y(), endX, endY),
                entity.timerMs(), entity.armed(), entity.ageMs(), entity.phaseId(), entity.phaseLocked());
        boolean hitEdge = endX == 0 || endX == run.arena.width() || endY == 0 || endY == run.arena.height();
        return new Move<>(entity, moved, entity.x(), entity.y(), endX, endY, hitEdge, false, null);
    }

    private static <F extends AbilityEntityBot> Move<F> seekEntity(
            ArenaEntity entity, AbilityContracts.AbilityPhase phase,
            AbilityContracts.PhaseMovement movement, Run<F> run) {
        F target = run.bots.stream()
                .filter(bot -> isEnemy(entity.ownerSlot(), bot, run.bots) && bot.entityHp() > 0)
                .min(Comparator.comparingDouble(bot -> distance(
                        bot.entityX(), bot.entityY(), entity.x(), entity.y())))
                .orElse(null);
        if (target == null) {
            return new Move<>(entity, entity, entity.x(), entity.y(), entity.x(), entity.y(), false, true, null);
        }
        double dx = target.entityX() - entity.x();
        double dy = target.entityY() - entity.y();
        double targetDistance = Math.max(1, Math.hypot(dx, dy));
        double speed = summonCanMove(entity) ? movement.speed() * summonMovementMultiplier(entity) : 0;
        double size = movement.size() <= 0 ? entity.size() : movement.size();
        double desired = vectorBearing(dx, dy);
        double current = vectorBearing(entity.velocityX(), entity.velocityY());
        double turn = (movement.turnDegrees() <= 0 ? 8 : movement.turnDegrees()) * summonRotationMultiplier(entity);
        double rotation = normalizeDegrees(current + clamp(shortestDelta(current, desired), -turn, turn));
        double radians = Math.toRadians(rotation - 90);
        double endX = clamp(entity.x() + dx / targetDistance * Math.min(speed, targetDistance),
                size / 2, run.arena.width() - size / 2);
        double endY = clamp(entity.y() + dy / targetDistance * Math.min(speed, targetDistance),
                size / 2, run.arena.height() - size / 2);
        ArenaEntity moved = copyWithPhase(entity, endX, endY, Math.cos(radians), Math.sin(radians),
                entity.traveled(), entity.timerMs(), entity.armed(), entity.ageMs(), entity.phaseId(),
                entity.phaseLocked(), rotation);
        return new Move<>(entity, moved, entity.x(), entity.y(), endX, endY, false, true, target);
    }

    private static <F extends AbilityEntityBot> Set<String> entityCollisionRemovalIds(
            List<ArenaEntity> entities, List<F> bots) {
        Set<String> removed = new HashSet<>();
        List<ArenaEntity> damageableTargets = entities.stream()
                .filter(entity -> {
                    AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
                    return phase != null && phase.health() != null && entity.hp() > 0;
                })
                .toList();
        for (ArenaEntity source : entities) {
            AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(source);
            AbilityContracts.PhaseEvent collision = phase == null ? null
                    : phase.on().get(AbilityContracts.PhaseEventType.COLLISION);
            if (!phaseHasEventEffect(phase, AbilityContracts.PhaseEventType.COLLISION, EffectType.DAMAGE)
                    || collision == null
                    || !collision.has(AbilityContracts.RemoveVerb.class)) continue;
            boolean hitDamageableTarget = damageableTargets.stream().anyMatch(target -> {
                AbilityContracts.AbilityPhase targetPhase = AbilityContracts.phaseFor(target);
                boolean summonTarget = AbilityContracts.isSummon(target);
                return !source.id().equals(target.id())
                        && (allowsFriendlyDamage(targetPhase)
                            || entityOwnersAreHostile(source, target, bots))
                        && AbilityContracts.eventTargetsEntity(collision, summonTarget)
                        && phase.effects().stream().anyMatch(effect ->
                                effect.type() == EffectType.DAMAGE
                                        && AbilityContracts.effectTargetsEntity(effect, summonTarget))
                        && overlaps(source, target);
            });
            if (hitDamageableTarget) removed.add(source.id());
        }
        return removed;
    }

    private static boolean phaseHasEventEffect(
            AbilityContracts.AbilityPhase phase,
            AbilityContracts.PhaseEventType eventType,
            EffectType effectType) {
        AbilityContracts.PhaseEvent event = phase == null ? null
                : phase.on().get(eventType);
        if (event == null || !event.has(AbilityContracts.ApplyEffectsVerb.class)) {
            return false;
        }
        return event.applyEffects().stream().anyMatch(effect -> effect.type() == effectType);
    }

    private static boolean eventTargetsKind(AbilityContracts.PhaseEvent event,
                                            AbilityContracts.TargetKind targetKind) {
        List<AbilityContracts.TargetKind> targetKinds = event == null
                ? List.of() : event.targets();
        return targetKinds.isEmpty()
                ? targetKind == AbilityContracts.TargetKind.BOT
                : targetKinds.contains(targetKind);
    }

    private static <F extends AbilityEntityBot> boolean entityHitByCurrentAttack(
            ArenaEntity entity, List<ArenaEntity> allEntities, List<F> bots,
            ArenaBounds arena, AbilityContracts.Trigger trigger, Combat<F> combat) {
        if (trigger.attackHits() && combat.entityHitByCurrentAttack(entity, bots, allEntities)) {
            return true;
        }
        return trigger.projectileOverlap() && allEntities.stream().anyMatch(candidate ->
                candidate != entity
                        && AbilityContracts.phaseFor(candidate) != null
                        && AbilityContracts.phaseFor(candidate).type() == AbilityContracts.PhaseType.PROJECTILE
                        && overlaps(candidate, entity));
    }

    private static ArenaEntity tickSummonStatuses(ArenaEntity entity, int stepMs) {
        if (entity.statusEffects().isEmpty()) return entity;
        int step = Math.max(0, stepMs);
        int hp = Math.max(0, entity.hp());
        int damage = 0;
        List<ArenaEntity.EntityStatus> nextStatuses = new ArrayList<>();
        List<Integer> movementLocks = new ArrayList<>();
        for (ArenaEntity.EntityStatus status : entity.statusEffects()) {
            if (status.presence()) {
                nextStatuses.add(status);
                continue;
            }
            int remainingBefore = Math.max(0, status.remainingMs());
            int activeStep = Math.min(step, remainingBefore);
            int interval = Math.max(0, status.intervalMs());
            int elapsed = Math.max(0, status.tickElapsedMs()) + activeStep;
            if (interval > 0 && activeStep > 0 && elapsed >= interval) {
                int ticks = elapsed / interval;
                elapsed -= ticks * interval;
                int tickDamage = Math.max(0, (int) Math.round(status.amount()));
                int applied = Math.min(hp, tickDamage * ticks);
                hp -= applied;
                damage += applied;
                if (status.movementLockMs() > 0) movementLocks.add(status.movementLockMs());
            }
            int remaining = remainingBefore - step;
            if (remaining > 0) {
                nextStatuses.add(new ArenaEntity.EntityStatus(status.type(), remaining,
                        interval, elapsed, status.amount(), status.movementLockMs()));
            }
        }
        ArenaEntity next = entity.withHp(hp).withStatusEffects(nextStatuses)
                .withDamageTakenThisTick(damage);
        for (Integer lockMs : movementLocks) {
            next = upsertSummonStatus(next, new ArenaEntity.EntityStatus(
                    "stun", lockMs, 0, 0, 0, 0));
        }
        return next;
    }

    private static boolean summonCanMove(ArenaEntity entity) {
        return !summonStatusActive(entity, "stun")
                && !summonStatusActive(entity, "interrupt");
    }

    private static boolean summonCanExecute(ArenaEntity entity) {
        return summonCanMove(entity) && !summonStatusActive(entity, "silence");
    }

    private static double summonMovementMultiplier(ArenaEntity entity) {
        return summonStatusActive(entity, "slow") ? HitStagger.CONCUSSIVE_MOVEMENT_MULTIPLIER : 1.0;
    }

    private static double summonRotationMultiplier(ArenaEntity entity) {
        return summonStatusActive(entity, "slow") ? HitStagger.CONCUSSIVE_ROTATION_MULTIPLIER : 1.0;
    }

    private static boolean summonStatusActive(ArenaEntity entity, String type) {
        return entity.statusEffects().stream().anyMatch(status ->
                type.equalsIgnoreCase(status.type())
                        && (status.presence() || status.remainingMs() > 0));
    }

    private static ArenaEntity upsertSummonStatus(ArenaEntity entity,
                                                   ArenaEntity.EntityStatus incoming) {
        List<ArenaEntity.EntityStatus> statuses = new ArrayList<>(entity.statusEffects());
        int index = -1;
        for (int i = 0; i < statuses.size(); i += 1) {
            if (incoming.type().equalsIgnoreCase(statuses.get(i).type())) {
                index = i;
                break;
            }
        }
        if (index < 0) {
            statuses.add(incoming);
        } else {
            ArenaEntity.EntityStatus current = statuses.get(index);
            statuses.set(index, new ArenaEntity.EntityStatus(current.type(),
                    Math.max(current.remainingMs(), incoming.remainingMs()),
                    Math.max(current.intervalMs(), incoming.intervalMs()),
                    current.tickElapsedMs(), Math.max(current.amount(), incoming.amount()),
                    Math.max(current.movementLockMs(), incoming.movementLockMs()),
                    current.presence() || incoming.presence()));
        }
        return entity.withStatusEffects(statuses);
    }

    private static ArenaEntity clearEntityPresenceStatuses(ArenaEntity entity) {
        if (entity.statusEffects().isEmpty()) return entity;
        List<ArenaEntity.EntityStatus> remaining = entity.statusEffects().stream()
                .filter(status -> !status.presence()).toList();
        return remaining.size() == entity.statusEffects().size()
                ? entity : entity.withStatusEffects(remaining);
    }

    private static <F extends AbilityEntityBot> List<HitCandidate<F>> phaseTargets(
            ArenaEntity entity, AbilityContracts.AbilityPhase phase, List<F> bots) {
        return phaseTargets(entity, phase, bots, AbilityContracts.PhaseEventType.COLLISION);
    }

    private static <F extends AbilityEntityBot> List<HitCandidate<F>> phaseTargets(
            ArenaEntity entity, AbilityContracts.AbilityPhase phase, List<F> bots,
            AbilityContracts.PhaseEventType eventType) {
        AbilityContracts.PhaseEvent event = phase.on().get(eventType);
        if (event == null) return List.of();
        if (!eventTargetsKind(event,
                AbilityContracts.TargetKind.BOT)) {
            return List.of();
        }
        // A trigger event reaches as far as the trigger radius and nothing else; any other event uses the hitbox.
        double radius = eventType == AbilityContracts.PhaseEventType.TRIGGER
                ? triggerRadius(phase.trigger())
                : phaseRadius(entity.abilityId(), phase, phase.hitbox() == null ? null : phase.hitbox().radius(),
                        entity.size() / 2.0);
        return FindTargets.<F>findTargets(null, null,
                FindTargets.Options.circle(entity, FindTargets.Sweep.stationary(entity.x(), entity.y()), radius,
                        candidate -> {
                            AbilityEntityBot bot = (AbilityEntityBot) candidate;
                            return botFilter(entity, bots).test(bot)
                                    && (!phase.skipOwner() || bot.entitySlot() != entity.ownerSlot());
                        }), bots).stream()
                .map(hit -> new HitCandidate<>(hit.target(), hit.distance())).toList();
    }

    /** A bot the entity can hurt: an enemy that is alive and not immune. */
    private static <F extends AbilityEntityBot> java.util.function.Predicate<Object> botFilter(
            ArenaEntity entity, List<F> bots) {
        return candidate -> {
            AbilityEntityBot bot = (AbilityEntityBot) candidate;
            return isEnemy(entity.ownerSlot(), bot, bots)
                    && bot.entityHp() > 0 && !bot.ignoresHostileEffects();
        };
    }

    private static EventScheduleResult eventSchedule(
            ArenaEntity entity, AbilityContracts.AbilityPhase phase,
            AbilityContracts.PhaseEventType eventType, int stepMs) {
        AbilityContracts.PhaseEvent handler = phase.on().get(eventType);
        String key = eventType.name().toLowerCase(Locale.ROOT);
        ArenaEntity.EventScheduleState previous = entity.eventScheduleState().get(key);
        if (previous == null) previous = new ArenaEntity.EventScheduleState(0, 0, false);
        if (handler == null) return new EventScheduleResult(0, previous);

        AbilityContracts.EventSchedule schedule = handler.schedule();
        AbilityContracts.EventScheduleMode mode = schedule == null
                ? eventType == AbilityContracts.PhaseEventType.COLLISION
                        ? AbilityContracts.EventScheduleMode.CONTINUOUS
                        : AbilityContracts.EventScheduleMode.ONCE
                : schedule.mode();
        if (mode == AbilityContracts.EventScheduleMode.CONTINUOUS) {
            int checks = eventType == AbilityContracts.PhaseEventType.COLLISION
                    ? 1 : previous.occurrences() > 0 ? 0 : 1;
            return new EventScheduleResult(checks,
                    checks == 0 ? previous
                            : new ArenaEntity.EventScheduleState(0,
                                    previous.occurrences() + checks, true));
        }
        if (mode == AbilityContracts.EventScheduleMode.ONCE) {
            int checks = previous.occurrences() > 0 ? 0 : 1;
            return new EventScheduleResult(checks,
                    new ArenaEntity.EventScheduleState(0,
                            previous.occurrences() + checks, true));
        }

        int intervalMs = Math.max(1, schedule.intervalMs() == null ? stepMs : schedule.intervalMs());
        int maxOccurrences = schedule.count() == null ? Integer.MAX_VALUE : schedule.count();
        if (previous.occurrences() >= maxOccurrences) {
            return new EventScheduleResult(0,
                    new ArenaEntity.EventScheduleState(0, previous.occurrences(), true));
        }
        int timerMs = previous.initialized()
                ? previous.timerMs() - Math.max(0, stepMs)
                : (schedule.startImmediately() ? 0 : intervalMs) - Math.max(0, stepMs);
        int checks = 0;
        while (timerMs <= 0 && checks < 100
                && previous.occurrences() + checks < maxOccurrences) {
            checks += 1;
            timerMs += intervalMs;
        }
        return new EventScheduleResult(checks,
                new ArenaEntity.EventScheduleState(timerMs,
                        previous.occurrences() + checks, true));
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, AbilityContracts.EntityContract contract,
            AbilityContracts.AbilityPhase phase, AbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances, int stepMs) {
        return dispatchPhaseEvent(entity, contract, phase, eventType, bots, arena,
                combat, targetSlots, distances, Map.of(), stepMs);
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, AbilityContracts.EntityContract contract,
            AbilityContracts.AbilityPhase phase, AbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances,
            Map<Integer, ArenaEntity> effectSources, int stepMs) {
        return dispatchPhaseEvent(entity, contract, phase, eventType, bots, arena, combat, targetSlots,
                distances, effectSources, stepMs, -1);
    }

    /**
     * Runs one event of an entity's phase through the verb executor. {@code seekTargetSlot} is the bot the entity
     * is chasing, which an aimed {@code hit} verb (a summon's shot) is limited to.
     */
    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, AbilityContracts.EntityContract contract,
            AbilityContracts.AbilityPhase phase, AbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances,
            Map<Integer, ArenaEntity> effectSources, int stepMs, int seekTargetSlot) {
        AbilityContracts.PhaseEvent event = phase.on().get(eventType);
        if (event == null) return new DispatchResult<>(entity, bots, false);
        EntityHost<F> host = new EntityHost<>(entity, contract, phase, eventType, event, bots, arena, combat,
                targetSlots, distances, effectSources, stepMs, seekTargetSlot);
        AbilityVerbs.run(event.verbs(), host);
        return new DispatchResult<>(host.next, bots, host.hitConnected);
    }

    /** Where an entity event's verbs run: the entity, the bots its event reaches, and the world's combat. */
    private static final class EntityHost<F extends AbilityEntityBot> implements AbilityVerbs.Host {
        private final ArenaEntity entity;
        private final AbilityContracts.EntityContract contract;
        private final AbilityContracts.AbilityPhase phase;
        private final AbilityContracts.PhaseEventType eventType;
        private final AbilityContracts.PhaseEvent event;
        private final List<F> bots;
        private final ArenaBounds arena;
        private final Combat<F> combat;
        private final List<Integer> targetSlots;
        private final Map<Integer, Double> distances;
        private final Map<Integer, ArenaEntity> effectSources;
        private final int stepMs;
        private final int seekTargetSlot;
        ArenaEntity next;
        boolean hitConnected;

        EntityHost(ArenaEntity entity, AbilityContracts.EntityContract contract,
                   AbilityContracts.AbilityPhase phase, AbilityContracts.PhaseEventType eventType,
                   AbilityContracts.PhaseEvent event, List<F> bots, ArenaBounds arena, Combat<F> combat,
                   List<Integer> targetSlots, Map<Integer, Double> distances,
                   Map<Integer, ArenaEntity> effectSources, int stepMs, int seekTargetSlot) {
            this.entity = entity;
            this.contract = contract;
            this.phase = phase;
            this.eventType = eventType;
            this.event = event;
            this.bots = bots;
            this.arena = arena;
            this.combat = combat;
            this.targetSlots = targetSlots;
            this.distances = distances;
            this.effectSources = effectSources;
            this.stepMs = stepMs;
            this.seekTargetSlot = seekTargetSlot;
            this.next = entity;
        }

        @Override
        public boolean finished() {
            return next == null;
        }

        @Override
        public void applyEffects(AbilityContracts.ApplyEffectsVerb verb) {
            if (!eventTargetsKind(event, AbilityContracts.TargetKind.BOT)) return;
            List<Integer> slots = verb.ownerTarget() ? List.of(entity.ownerSlot()) : targetSlots;
            for (Integer targetSlot : slots) {
                F target = bots.stream().filter(bot -> bot.entitySlot() == targetSlot)
                        .findFirst().orElse(null);
                if (next == null || target == null || target.entityHp() <= 0
                        || target.ignoresHostileEffects()
                        || phase.skipOwner() && target.entitySlot() == next.ownerSlot()
                        || !canApplyToTarget(next, targetSlot, event.targetPolicy(), stepMs)) continue;
                applyEntityEffects(bots, target,
                        effectSources.getOrDefault(targetSlot, next),
                        contract.abilityId(), verb.effects(), arena, combat,
                        verb.pullDirection() == null ? "source" : verb.pullDirection(),
                        distances.getOrDefault(targetSlot, Double.NaN),
                        Effects.phaseRange(phase), phase.type() == AbilityContracts.PhaseType.ZONE);
                next = recordTargetApplication(next, targetSlot, event.targetPolicy(), stepMs);
            }
        }

        @Override
        public void transition(AbilityContracts.TransitionVerb verb) {
            AbilityContracts.AbilityPhase target = AbilityContracts.phaseById(next, verb.to());
            if (target != null) next = transitionToPhase(next, target);
        }

        @Override
        public void emitVisual(AbilityContracts.EmitVisualVerb verb) {
            // The authoritative runtime records only that the allowlisted event occurred. Visual type, size, and
            // duration are resolved by the browser contract from this semantic event.
            next = next.withEvent(eventType.name().toLowerCase(Locale.ROOT), phase.id());
        }

        @Override
        public void remove(AbilityContracts.RemoveVerb verb) {
            next = null;
        }

        @Override
        public void spawn(AbilityContracts.SpawnVerb verb) {
            AbilityContracts.EntityContract definition = AbilityContracts.get(entity.abilityId())
                    .entities().get(verb.entity());
            List<ArenaEntity> queue = SPAWN_QUEUE.get();
            if (definition == null || queue == null || next == null) return;
            String idPrefix = !definition.phases().isEmpty()
                    && definition.phases().getFirst().type() == AbilityContracts.PhaseType.PROJECTILE
                            ? definition.runtimeType() : "ability";
            // The new entity spawns from the pose of the entity that spawned it; the bot stays its owner.
            for (AbilityEntityFactory.Placement placement : AbilityEntityFactory.placements(verb.pattern())) {
                String id = combat.spawnEntityId(bots, entity.ownerSlot(), idPrefix, entity.id());
                if (id == null) return;
                queue.add(AbilityEntityFactory.create(id, definition, entity.ownerSlot(), next.x(), next.y(),
                        next.size(), next.rotation(), next.damageMultiplier(), Double.NaN, Double.NaN,
                        arena.width(), arena.height(), placement));
            }
        }

        /**
         * A hit verb inside an entity event (a summon's shot): the hitbox is fired from the entity's pose plus the
         * verb's origin, against living enemy bots. Records whether anything was hit for a waitForHit timer.
         */
        @Override
        public void hit(AbilityContracts.HitVerb verb) {
            if (!verb.targets().contains(AbilityContracts.TargetKind.BOT) || next == null) return;
            AbilityContracts.Hitbox hitbox = verb.hitbox();
            AbilitySpawnTransform pose = abilitySpawnTransform(next,
                    verb.origin() == null ? new AbilityContracts.Spawn(0, 0, false, 0,
                            AbilityContracts.RotationSpace.OWNER, 0, 500, 400) : verb.origin(), next.rotation());
            Double range = Effects.hitboxRange(hitbox);
            List<F> candidates = bots.stream()
                    .filter(bot -> isEnemy(next.ownerSlot(), bot, bots) && bot.entityHp() > 0)
                    .filter(bot -> !"seekTarget".equals(verb.aim()) || bot.entitySlot() == seekTargetSlot)
                    .toList();
            List<F> found = candidates.stream()
                    .filter(bot -> range != null && rayIntersectsCircle(pose.x(), pose.y(), pose.directionX(),
                            pose.directionY(), range, bot.entityX(), bot.entityY(), bot.entitySize() / 2.0))
                    .sorted(Comparator.comparingDouble(bot -> distance(bot.entityX(), bot.entityY(), pose.x(), pose.y())))
                    .toList();
            if (verb.nearestOnly()) found = found.stream().limit(1).toList();
            if (found.isEmpty()) return;
            hitConnected = true;
            for (F target : found) {
                if (target.ignoresHostileEffects()) continue;
                applyEntityEffects(bots, target, next, entity.abilityId(), verb.effects(), arena, combat,
                        verb.pullDirection() == null ? "source" : verb.pullDirection(),
                        distance(target.entityX(), target.entityY(), pose.x(), pose.y()), range,
                        false);
            }
            if (verb.visual() != null && verb.visual().visibleMs() != null) {
                next = next.withEvent(eventType.name().toLowerCase(Locale.ROOT), phase.id());
            }
        }
    }

    private static boolean canApplyToTarget(ArenaEntity entity, int targetSlot,
                                             AbilityContracts.TargetPolicy targetPolicy,
                                            int stepMs) {
        if (targetPolicy == null
                || targetPolicy.mode() == AbilityContracts.TargetPolicyMode.EVERY_TICK) return true;
        Integer previous = entity.hitLedger().get(targetSlot);
        if (previous == null) return true;
        if (targetPolicy.mode() == AbilityContracts.TargetPolicyMode.ONCE) return false;
        int interval = targetPolicy.intervalMs() != null ? targetPolicy.intervalMs() : stepMs;
        return eventTimestampMs(entity, stepMs) - previous >= interval;
    }

    private static ArenaEntity recordTargetApplication(ArenaEntity entity, int targetSlot,
                                                        AbilityContracts.TargetPolicy targetPolicy,
                                                       int stepMs) {
        if (targetPolicy == null
                || targetPolicy.mode() == AbilityContracts.TargetPolicyMode.EVERY_TICK) {
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
                                                  AbilityContracts.AbilityPhase phase) {
        ArenaEntity transitioned = copyWithPhase(entity, entity.x(), entity.y(), 0, 0,
                entity.traveled(), entity.timerMs(), true, entity.ageMs(), phase.id(), true,
                entity.rotation());
        return withEventScheduleState(withPhaseTimer(transitioned.withHitLedger(
                Map.of()), 0), Map.of());
    }

    private static ArenaEntity withEventScheduleState(
            ArenaEntity entity, AbilityContracts.PhaseEventType eventType,
            ArenaEntity.EventScheduleState state) {
        Map<String, ArenaEntity.EventScheduleState> next = new HashMap<>(entity.eventScheduleState());
        next.put(eventType.name().toLowerCase(Locale.ROOT), state);
        return entity.withEventScheduleState(next);
    }

    private static ArenaEntity withEventScheduleState(
            ArenaEntity entity, Map<String, ArenaEntity.EventScheduleState> state) {
        return entity.withEventScheduleState(state);
    }

    private static ArenaEntity markScheduledEvent(
            ArenaEntity entity, AbilityContracts.PhaseEventType eventType) {
        String key = eventType.name().toLowerCase(Locale.ROOT);
        ArenaEntity.EventScheduleState previous = entity.eventScheduleState().get(key);
        int occurrences = previous == null ? 1 : Math.max(1, previous.occurrences());
        return withEventScheduleState(entity, eventType,
                new ArenaEntity.EventScheduleState(
                        previous == null ? 0 : previous.timerMs(), occurrences, true));
    }

    private static ArenaEntity withIntervalTimer(ArenaEntity entity, int timer) {
        return entity.withIntervalTimerMs(timer);
    }


    private static ArenaEntity withPhaseTimer(ArenaEntity entity, int phaseTimerMs) {
        return new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(),
                entity.y(), entity.size(), entity.velocityX(), entity.velocityY(),
                entity.traveled(), entity.timerMs(), entity.armed(), entity.hp(),
                entity.damageMultiplier(), entity.abilityId(),
                entity.intervalTimerMs(), phaseTimerMs, entity.ageMs(),
                entity.tickStartHp(), entity.damageTakenThisTick(),
                entity.damageTakenLastTick(), entity.hpNetChangeLastTick(), entity.rotation(),
                entity.hitLedger(), entity.phaseId(), entity.phaseLocked(),
                entity.statusEffects(), entity.eventSequence(), entity.eventType(),
                entity.eventScheduleState(), entity.eventPhaseId(), entity.entityKey(), entity.bindToCast(),
                entity.patternAngle(), entity.patternLateral());
    }

    private static ArenaEntity copyWithPhase(ArenaEntity source, double x, double y,
                                             double velocityX, double velocityY,
                                             double traveled, int timerMs, boolean armed,
                                             int ageMs, String phaseId, boolean phaseLocked) {
        return copyWithPhase(source, x, y, velocityX, velocityY, traveled, timerMs,
                armed, ageMs, phaseId, phaseLocked, source.rotation());
    }

    private static ArenaEntity copyWithPhase(ArenaEntity source, double x, double y,
                                             double velocityX, double velocityY,
                                             double traveled, int timerMs, boolean armed,
                                             int ageMs, String phaseId, boolean phaseLocked,
                                             double rotation) {
        return new ArenaEntity(source.id(), source.type(), source.ownerSlot(), x, y,
                source.size(), velocityX, velocityY, traveled, timerMs, armed, source.hp(),
                source.damageMultiplier(), source.abilityId(),
                source.intervalTimerMs(), source.phaseTimerMs(), ageMs,
                source.tickStartHp(), source.damageTakenThisTick(),
                source.damageTakenLastTick(), source.hpNetChangeLastTick(), rotation,
                source.hitLedger(), phaseId, phaseLocked, source.statusEffects(),
                source.eventSequence(), source.eventType(), source.eventScheduleState(),
                source.eventPhaseId(), source.entityKey(), source.bindToCast(),
                source.patternAngle(), source.patternLateral());
    }

    private static <F extends AbilityEntityBot> void applyEntityEffects(
            List<F> bots, F target, ArenaEntity source, int abilityId,
            List<AbilityContracts.Effect> declaredEffects, ArenaBounds arena, Combat<F> combat,
            String pullDirection, double collisionDistance, Double range, boolean zoneSource) {
        if (!isEnemy(source.ownerSlot(), target, bots)) return;
        Integer previousAbility = CombatLog.setAbility(abilityId);
        try {
            Effects.Context ctx = new Effects.Context();
            ctx.abilityId = abilityId;
            ctx.range = range;
            ctx.ownerSlot = source.ownerSlot();
            ctx.sourceX = source.x();
            ctx.sourceY = source.y();
            ctx.damageMultiplier = source.damageMultiplier();
            ctx.fromEntity = true;
            ctx.zoneSource = zoneSource;
            ctx.arena = arena;
            ctx.fixedDistance = Double.isFinite(collisionDistance) ? collisionDistance : null;
            if ("owner".equals(pullDirection)) {
                bots.stream().filter(bot -> bot.entitySlot() == source.ownerSlot()).findFirst()
                        .ifPresent(owner -> {
                            ctx.pullX = owner.entityX();
                            ctx.pullY = owner.entityY();
                        });
            }
            ctx.bot = target;
            ctx.host = new Effects.Host() {
                @Override
                public void damage(AbilityEntityBot damaged, double amount, int ownerSlot,
                                   double fromX, double fromY) {
                    combat.damageFromOwner(bots, ownerSlot, target, amount, fromX, fromY);
                }

                @Override
                public Double ownerDamageMultiplier(int ownerSlot) {
                    return combat.ownerDamageMultiplier(bots, ownerSlot);
                }
            };
            boolean landedOnEnemy = false;
            for (AbilityContracts.Effect effect : declaredEffects) {
                if (!AbilityContracts.effectTargetsBot(effect)) continue;
                if (Effects.ENEMY_HIT_EFFECT_TYPES.contains(effect.type())
                        && target.entityHp() > 0 && !target.ignoresHostileEffects()) {
                    landedOnEnemy = true;
                }
                Effects.apply(effect, ctx);
            }
            if (landedOnEnemy) combat.recordEnemyHit(bots, source.ownerSlot(), abilityId, source.id());
        } finally {
            CombatLog.setAbility(previousAbility);
        }
    }

    private static boolean isEnemy(
            int ownerSlot, AbilityEntityBot target, List<? extends AbilityEntityBot> bots) {
        AbilityEntityBot owner = bots.stream().filter(bot -> bot.entitySlot() == ownerSlot)
                .findFirst().orElse(null);
        return owner == null
                ? target.entitySlot() != ownerSlot
                : owner.entityTeam() != target.entityTeam();
    }

    private static boolean allowsFriendlyDamage(AbilityContracts.AbilityPhase phase) {
        return phase != null && phase.health() != null
                && phase.health().allowFriendlyDamage();
    }

    private static <F extends AbilityEntityBot> boolean entityOwnersAreHostile(
            ArenaEntity source, ArenaEntity target, List<F> bots) {
        F sourceOwner = bots.stream()
                .filter(bot -> bot.entitySlot() == source.ownerSlot()).findFirst().orElse(null);
        F targetOwner = bots.stream()
                .filter(bot -> bot.entitySlot() == target.ownerSlot()).findFirst().orElse(null);
        return sourceOwner != null && targetOwner != null
                ? sourceOwner.entityTeam() != targetOwner.entityTeam()
                : source.ownerSlot() != target.ownerSlot();
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return FindTargets.overlap(first, second);
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

    private static AbilitySpawnTransform abilitySpawnTransform(
            ArenaEntity entity, AbilityContracts.Spawn spawn, double ownerRotation) {
        double radians = Math.toRadians(ownerRotation - 90.0);
        double rightRadians = Math.toRadians(ownerRotation);
        double forwardX = Math.cos(radians);
        double forwardY = Math.sin(radians);
        double rightX = Math.cos(rightRadians);
        double rightY = Math.sin(rightRadians);
        double x = entity.x() + rightX * spawn.offsetX() + forwardX * spawn.offsetY();
        double y = entity.y() + rightY * spawn.offsetX() + forwardY * spawn.offsetY();
        double abilityRotation = spawn.rotationSpace() == AbilityContracts.RotationSpace.WORLD
                ? spawn.rotation() : ownerRotation + spawn.rotation();
        double abilityRadians = Math.toRadians(abilityRotation - 90.0);
        return new AbilitySpawnTransform(x, y, Math.cos(abilityRadians), Math.sin(abilityRadians));
    }

    /**
     * {@code trigger.radius} is the only radius a trigger uses, for detection, chains and trigger targets. The
     * phase hitbox (radius and radiusMultiplier) is the entity's body and never widens or narrows a trigger.
     */
    private static double triggerRadius(AbilityContracts.Trigger trigger) {
        return trigger == null || trigger.radius() == null ? 0 : trigger.radius();
    }

    private static double phaseRadius(int abilityId, AbilityContracts.AbilityPhase phase,
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

    /**
     * First stage of the entity tick. An entity bound to its cast ends as soon as the ability that spawned it
     * leaves its active stage (it finished or was interrupted); an entity that follows its owner takes the
     * owner's pose plus its spawn offset.
     */
    private static <F extends AbilityEntityBot> List<ArenaEntity> bindEntitiesToOwners(
            List<ArenaEntity> entities, List<F> bots, Combat<F> combat) {
        List<ArenaEntity> kept = new ArrayList<>();
        for (ArenaEntity entity : entities) {
            if (entity.bindToCast() && entity.abilityId() != null
                    && !combat.castActive(bots, entity.ownerSlot(), entity.abilityId())) continue;
            AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
            AbilityContracts.EntityContract definition = AbilityContracts.forEntity(entity);
            double[] owner = phase != null && phase.movement() != null
                    && phase.movement().mode() == AbilityContracts.MovementMode.FOLLOW_OWNER
                    ? combat.ownerPose(bots, entity.ownerSlot()) : null;
            if (owner == null || definition == null) {
                kept.add(entity);
                continue;
            }
            AbilityContracts.Spawn spawn = definition.spawn();
            double ownerRotation = owner[2];
            double forwardRadians = Math.toRadians(ownerRotation - 90.0);
            double rightRadians = Math.toRadians(ownerRotation);
            double localX = spawn.offsetX() + entity.patternLateral();
            double x = owner[0] + Math.cos(rightRadians) * localX + Math.cos(forwardRadians) * spawn.offsetY();
            double y = owner[1] + Math.sin(rightRadians) * localX + Math.sin(forwardRadians) * spawn.offsetY();
            double rotation = (spawn.rotationSpace() == AbilityContracts.RotationSpace.WORLD
                    ? spawn.rotation() : ownerRotation + spawn.rotation()) + entity.patternAngle();
            kept.add(entity.withPose(x, y, x - entity.x(), y - entity.y(), rotation));
        }
        return kept;
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
    private record AbilitySpawnTransform(double x, double y, double directionX, double directionY) {}
    private record EventScheduleResult(int checks,
                                       ArenaEntity.EventScheduleState state) {}
    private record DispatchResult<F extends AbilityEntityBot>(ArenaEntity entity, List<F> bots, boolean hitConnected) {
        DispatchResult(ArenaEntity entity, List<F> bots) {
            this(entity, bots, false);
        }
    }
}
