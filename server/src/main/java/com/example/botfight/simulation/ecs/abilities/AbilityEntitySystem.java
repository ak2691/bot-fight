package com.example.botfight.simulation.ecs.abilities;

import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesDistance;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesIntersect;
import static com.example.botfight.simulation.geometry.EntityHitbox.movingAgainstCircle;
import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;

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

        /** Applies collision effects to one HP-bearing entity. */
        default ArenaEntity applyEffectsToEntity(ArenaEntity entity, List<F> bots,
                                                  List<ArenaEntity> entities,
                                                  ArenaBounds arena, int stepMs) {
            return entity;
        }

        /** Applies a contract-owned status through the host simulation's canonical status builder. */
        default void applyStatus(List<F> bots, int ownerSlot, F target, int abilityId,
                                 AbilityContracts.Effect effect) {
            target.applyStatus(effect.subtype(), effect.durationMs(), ownerSlot);
        }
    }

    public static boolean isAbilityEntity(ArenaEntity entity) {
        AbilityContracts.AbilityContract contract = AbilityContracts.forEntity(entity);
        return contract != null && !contract.phases().isEmpty();
    }

    public static <F extends AbilityEntityBot> List<ArenaEntity> tick(
            List<ArenaEntity> entities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        List<ArenaEntity> tickEntities = entities.stream()
                .map(ArenaEntity::beginTickMetrics).toList();
        bots.forEach(bot -> bot.setZoneSilenced(false));
        List<EntityEntry> traps = tickEntities.stream()
                .map(entity -> new EntityEntry(entity, AbilityContracts.forEntity(entity), false))
                .filter(entry -> entry.contract() != null
                        && entry.contract().category() == AbilityContracts.Category.TRAP
                        && hasTriggerPhase(entry))
                .toList();
        List<ArenaEntity> next = new ArrayList<>();
        Set<String> trapIds = new HashSet<>(traps.stream()
                .map(entry -> entry.entity().id()).toList());
        List<F> botsAtTickStart = bots;
        Set<String> removedByEntityCollision = entityCollisionRemovalIds(tickEntities);
        List<EntityEntry> movedTraps = traps.stream()
                .filter(entry -> !removedByEntityCollision.contains(entry.entity().id()))
                .map(entry -> {
            ArenaEntity moved = advanceTriggerEntity(entry.entity(), entry.contract(), arena, stepMs);
            boolean killedByDamage = false;
            AbilityContracts.AbilityPhase currentPhase = AbilityContracts.phaseFor(moved);
            if (currentPhase != null && currentPhase.health() != null) {
                int damage = Math.max(0, combat.damageToEntity(moved, botsAtTickStart, tickEntities));
                int previousHp = Math.max(0, moved.hp());
                int hp = Math.max(0, previousHp - damage);
                killedByDamage = previousHp > 0 && hp <= 0 && damage > 0;
                moved = moved.withHp(hp).withDamageTakenThisTick(
                        Math.max(0, moved.damageTakenThisTick()) + damage);
            }
            return new EntityEntry(moved, entry.contract(), killedByDamage);
        }).filter(entry -> AbilityContracts.phaseFor(entry.entity()) == null
                || AbilityContracts.phaseFor(entry.entity()).health() == null
                || entry.entity().hp() > 0 || entry.killedByDamage()).toList();
        Map<String, AbilityContracts.PhaseEventType> triggerEvents =
                resolveTrapTriggers(movedTraps, tickEntities, bots, arena, combat);

        for (EntityEntry entry : movedTraps) {
            ArenaEntity current = entry.entity();
            AbilityContracts.AbilityPhase phase = phaseForEntry(entry);
            if (phase == null) continue;
            String initialPhaseId = phase.id();
            boolean enteredPhase = false;
            AbilityContracts.PhaseEventType incomingEvent = entry.killedByDamage()
                    ? AbilityContracts.PhaseEventType.KILLED
                    : current.damageTakenThisTick() > 0
                            ? AbilityContracts.PhaseEventType.HIT : null;
            if (incomingEvent != null) {
                AbilityContracts.PhaseEvent handler = phase.events().get(incomingEvent);
                if (incomingEvent == AbilityContracts.PhaseEventType.KILLED && handler == null) {
                    current = null;
                } else {
                    DispatchResult<F> incoming = dispatchPhaseEvent(current, entry.contract(), phase,
                            incomingEvent, bots, arena, combat, List.of(), Map.of(), stepMs);
                    current = incoming.entity();
                    bots = incoming.bots();
                }
            }
            if (current == null) continue;
            phase = AbilityContracts.phaseFor(current);
            if (phase == null) continue;
            enteredPhase = !initialPhaseId.equals(phase.id());
            AbilityContracts.PhaseEventType triggerEvent = triggerEvents.get(entry.entity().id());
            if (triggerEvent == null) {
                next.add(current);
                continue;
            }
            List<HitCandidate<F>> candidates = phaseTargets(current, phase, bots);
            AbilityContracts.PhaseEventType eventType = entry.killedByDamage()
                    ? AbilityContracts.PhaseEventType.COLLISION : triggerEvent;
            DispatchResult<F> dispatched = dispatchPhaseEvent(current, entry.contract(), phase,
                    eventType, bots, arena, combat,
                    candidates.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                    distancesBySlot(candidates), stepMs);
            ArenaEntity nextEntity = dispatched.entity();
            bots = dispatched.bots();
            AbilityContracts.AbilityPhase entered = nextEntity == null
                    ? null : AbilityContracts.phaseFor(nextEntity);
            if (nextEntity != null && eventType != AbilityContracts.PhaseEventType.COLLISION
                    && entered != null && !entered.id().equals(phase.id())
                    && entered.events().containsKey(AbilityContracts.PhaseEventType.COLLISION)) {
                List<HitCandidate<F>> enteredCandidates = phaseTargets(nextEntity, entered, bots);
                DispatchResult<F> active = dispatchPhaseEvent(nextEntity, entry.contract(), entered,
                        AbilityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                        enteredCandidates.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                        distancesBySlot(enteredCandidates), stepMs);
                nextEntity = active.entity();
                bots = active.bots();
                enteredPhase = true;
            }
            AbilityContracts.AbilityPhase finalPhase = nextEntity == null
                    ? null : AbilityContracts.phaseFor(nextEntity);
            if (nextEntity != null && finalPhase != null && !phase.id().equals(finalPhase.id())) {
                enteredPhase = true;
            }
            if (nextEntity != null && enteredPhase) {
                nextEntity = consumeEnteredPhaseTick(nextEntity, stepMs);
            }
            if (nextEntity != null) next.add(nextEntity);
        }

        for (ArenaEntity entity : tickEntities) {
            if (trapIds.contains(entity.id()) || removedByEntityCollision.contains(entity.id())) continue;
            AbilityContracts.AbilityContract contract = AbilityContracts.forEntity(entity);
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
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entry.entity());
        return phase != null && phase.trigger() != null;
    }

    private static Set<String> entityCollisionRemovalIds(List<ArenaEntity> entities) {
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
                    : phase.events().get(AbilityContracts.PhaseEventType.COLLISION);
            if (!phaseHasEventEffect(phase, AbilityContracts.PhaseEventType.COLLISION, EffectType.DAMAGE)
                    || collision == null
                    || !collision.actions().contains(AbilityContracts.PhaseAction.REMOVE)) continue;
            boolean hitDamageableTarget = damageableTargets.stream().anyMatch(target -> {
                AbilityContracts.AbilityPhase targetPhase = AbilityContracts.phaseFor(target);
                boolean summonTarget = targetPhase != null
                        && targetPhase.type() == AbilityContracts.PhaseType.SUMMON;
                return !source.id().equals(target.id())
                        && source.ownerSlot() != target.ownerSlot()
                        && eventCanAffectHpEntity(collision, summonTarget)
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
                : phase.events().get(eventType);
        if (event == null || !event.actions().contains(AbilityContracts.PhaseAction.APPLY_EFFECTS)) {
            return false;
        }
        Set<EffectType> allowed = event.effectTypes().isEmpty()
                ? phase.effectTypes() : event.effectTypes();
        return allowed.contains(effectType);
    }

    private static boolean eventTargetsKind(AbilityContracts.PhaseEvent event,
                                            AbilityContracts.TargetKind targetKind) {
        List<AbilityContracts.TargetKind> targetKinds = event == null
                ? List.of() : event.targetKinds();
        return targetKinds.isEmpty()
                ? targetKind == AbilityContracts.TargetKind.BOT
                : targetKinds.contains(targetKind);
    }

    private static boolean eventCanAffectHpEntity(AbilityContracts.PhaseEvent event,
                                                   boolean summonTarget) {
        return event != null && (eventTargetsKind(event, AbilityContracts.TargetKind.HP_ENTITY)
                || summonTarget && eventTargetsKind(event, AbilityContracts.TargetKind.BOT));
    }

    private static ArenaEntity advanceTriggerEntity(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            ArenaBounds arena, int stepMs) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        if (phase == null) return entity;
        AbilityContracts.PhaseMovement movement = phase.movement();
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
        boolean armed = entity.armed() || phase.type() == AbilityContracts.PhaseType.ZONE
                || phase.type() == AbilityContracts.PhaseType.SELF;
        int timerMs = entity.timerMs() - stepMs;
        ArenaEntity moved = copyWithPhase(entity, nextX, nextY, velocityX, velocityY,
                entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY),
                timerMs, armed, entity.ageMs(), phase.id(), entity.phaseLocked(),
                Math.max(0, entity.visibleMs() - stepMs), entity.visualEventType(),
                Math.max(0, entity.visualEventMs() - stepMs), entity.visualEventSize());
        return withPhaseTimer(moved, entity.phaseTimerMs() + stepMs);
    }

    private static <F extends AbilityEntityBot> Map<String, AbilityContracts.PhaseEventType> resolveTrapTriggers(
            List<EntityEntry> entries, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, Combat<F> combat) {
        Map<String, AbilityContracts.PhaseEventType> triggerEvents = new HashMap<>();
        for (EntityEntry entry : entries) {
            AbilityContracts.AbilityPhase phase = phaseForEntry(entry);
            AbilityContracts.Trigger trigger = phase == null ? null : phase.trigger();
            if (entry.killedByDamage()) {
                triggerEvents.put(entry.entity().id(),
                        AbilityContracts.PhaseEventType.COLLISION);
                continue;
            }
            if (trigger == null) continue;
            boolean hit = entityHitByCurrentAttack(entry.entity(), allEntities, bots, arena,
                    trigger, combat);
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
            if (hit || contact) {
                triggerEvents.put(entry.entity().id(),
                        AbilityContracts.PhaseEventType.TRIGGER);
            } else if (lifetimeExpired) {
                triggerEvents.put(entry.entity().id(),
                        AbilityContracts.PhaseEventType.LIFETIME_END);
            }
        }
        boolean changed;
        do {
            changed = false;
            for (EntityEntry source : entries) {
                AbilityContracts.AbilityPhase phase = phaseForEntry(source);
                AbilityContracts.Trigger trigger = phase == null ? null : phase.trigger();
                if (triggerEvents.get(source.entity().id())
                        != AbilityContracts.PhaseEventType.TRIGGER
                        || trigger == null || !trigger.chain()) continue;
                double radius = phaseRadius(source.contract().abilityId(), phase,
                        trigger.radius(), 0);
                for (EntityEntry target : entries) {
                    if (triggerEvents.containsKey(target.entity().id())
                            || target.contract().abilityId() != source.contract().abilityId()
                            || distance(target.entity().x(), target.entity().y(),
                            source.entity().x(), source.entity().y()) > radius) continue;
                    triggerEvents.put(target.entity().id(),
                            AbilityContracts.PhaseEventType.TRIGGER);
                    changed = true;
                }
            }
        } while (changed);
        return triggerEvents;
    }

    private static AbilityContracts.AbilityPhase phaseForEntry(EntityEntry entry) {
        return AbilityContracts.phaseFor(entry.entity());
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

    private static <F extends AbilityEntityBot> TickResult tickCanonicalEntity(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            List<ArenaEntity> allEntities, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        entity = clearEntityPresenceStatuses(entity);
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        if (phase == null || phase.type() == null) return new TickResult(entity);
        if (phase.health() != null && phase.type() != AbilityContracts.PhaseType.SUMMON) {
            IncomingEntityResult<F> incoming = applyIncomingEntityEffects(entity, contract, phase,
                    allEntities, bots, arena, stepMs, combat);
            if (incoming.entity() == null) return new TickResult(null);
            entity = incoming.entity();
            bots = incoming.bots();
            phase = AbilityContracts.phaseFor(entity);
            if (phase == null || phase.type() == null) return new TickResult(entity);
        }
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

    private static <F extends AbilityEntityBot> IncomingEntityResult<F> applyIncomingEntityEffects(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            AbilityContracts.AbilityPhase phase, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, int stepMs, Combat<F> combat) {
        int previousHp = Math.max(0, entity.hp());
        ArenaEntity next = combat.applyEffectsToEntity(entity, bots, allEntities, arena, stepMs);
        int damage = Math.max(0, previousHp - (next == null ? 0 : next.hp()));
        if (next == null || damage <= 0) return new IncomingEntityResult<>(next, bots);

        AbilityContracts.PhaseEventType eventType = next.hp() <= 0
                ? AbilityContracts.PhaseEventType.KILLED : AbilityContracts.PhaseEventType.HIT;
        AbilityContracts.PhaseEvent event = phase.events().get(eventType);
        if (event == null && eventType == AbilityContracts.PhaseEventType.KILLED) {
            return new IncomingEntityResult<>(null, bots);
        }
        if (event != null) {
            DispatchResult<F> dispatched = dispatchPhaseEvent(next, contract, phase, eventType,
                    bots, arena, combat, List.of(), Map.of(), stepMs);
            next = dispatched.entity();
            bots = dispatched.bots();
        }
        return next == null || next.hp() <= 0
                ? new IncomingEntityResult<>(null, bots)
                : new IncomingEntityResult<>(next, bots);
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalProjectile(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            AbilityContracts.AbilityPhase phase, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        AbilityContracts.PhaseMovement movement = phase.movement();
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
        List<HitCandidate<F>> candidates = eventTargetsKind(
                phase.events().get(AbilityContracts.PhaseEventType.COLLISION),
                AbilityContracts.TargetKind.BOT) ? bots.stream()
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
                .sorted(Comparator.comparingDouble(HitCandidate::distance)).toList() : List.of();
        List<HitCandidate<F>> selected = phase.hit() != null
                && phase.hit().mode() == AbilityContracts.HitMode.NEAREST
                ? candidates.stream().limit(1).toList() : candidates;
        AbilityContracts.Execution execution = phase.execution();
        AbilityContracts.PhaseEventType executionEvent = execution == null ? null : execution.event();
        if (executionEvent == null && phase.events().containsKey(AbilityContracts.PhaseEventType.INTERVAL)) {
            executionEvent = AbilityContracts.PhaseEventType.INTERVAL;
        }
        AbilityContracts.PhaseEvent executionHandler = executionEvent == null
                ? null : phase.events().get(executionEvent);
        int intervalTimer = moved.intervalTimerMs() - stepMs;
        boolean scheduled = executionHandler != null;
        int intervalMs = !scheduled ? 0 : execution != null && execution.intervalMs() != null
                ? execution.intervalMs()
                : executionHandler.intervalMs() == null ? stepMs : executionHandler.intervalMs();
        if (scheduled && execution != null && !execution.startImmediately() && entity.phaseTimerMs() == 0) {
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
                scheduled ? executionEvent : AbilityContracts.PhaseEventType.COLLISION,
                bots, arena, combat,
                selected.stream().map(candidate -> candidate.bot().entitySlot()).toList(),
                distancesBySlot(selected), collisionSources, stepMs);
        if (scheduled && due) {
            intervalTimer += Math.max(1, intervalMs);
        }
        ArenaEntity next = dispatched.entity();
        if (next == null) return new TickResult(null);
        AbilityContracts.AbilityPhase entered = AbilityContracts.phaseFor(next);
        if (entered != null && entered.type() == AbilityContracts.PhaseType.ZONE
                && !entered.id().equals(phase.id())) {
            return tickCanonicalZone(next, contract, entered, dispatched.bots(),
                    arena, stepMs, combat);
        }
        boolean edge = nextX == 0 || nextX == arena.width()
                || nextY == 0 || nextY == arena.height();
        AbilityContracts.PhaseEvent edgeEvent = phase.events().get(
                AbilityContracts.PhaseEventType.COLLISION);
        boolean removeAtEdge = edge && edgeEvent != null
                && edgeEvent.actions().contains(AbilityContracts.PhaseAction.REMOVE);
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
                    AbilityContracts.PhaseEventType.LIFETIME_END, dispatched.bots(),
                    arena, combat, List.of(), Map.of(), stepMs);
            return new TickResult(ended.entity() == next
                    && !phase.events().containsKey(AbilityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        return new TickResult(withIntervalTimer(next, intervalTimer));
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalZone(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            AbilityContracts.AbilityPhase phase, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        ArenaEntity current = entity;
        int timer = current.timerMs() - (phase.durationMs() != null
                || contract.lifetime().timerMode() == AbilityContracts.TimerMode.REMAINING
                ? stepMs : 0);
        ArenaEntity moved = copyWithPhase(current, current.x(), current.y(), 0, 0,
                current.traveled(), timer, true, current.ageMs(), phase.id(),
                current.phaseLocked(), Math.max(0, current.visibleMs() - stepMs), current.visualEventType(),
                Math.max(0, current.visualEventMs() - stepMs), current.visualEventSize());
        moved = withPhaseTimer(moved, current.phaseTimerMs() + stepMs);
        List<HitCandidate<F>> candidates = phaseTargets(moved, phase, bots);
        boolean active = contract.lifetime().timerMode() != AbilityContracts.TimerMode.REMAINING
                || current.timerMs() > 0;
        List<Integer> targetSlots = candidates.stream()
                .map(candidate -> candidate.bot().entitySlot()).toList();
        Map<Integer, Double> distances = distancesBySlot(candidates);
        AbilityContracts.Execution execution = phase.execution();
        AbilityContracts.PhaseEventType executionEvent = execution == null ? null : execution.event();
        if (executionEvent == null && phase.events().containsKey(AbilityContracts.PhaseEventType.INTERVAL)) {
            executionEvent = AbilityContracts.PhaseEventType.INTERVAL;
        }
        AbilityContracts.PhaseEvent intervalEvent = executionEvent == null
                ? null : phase.events().get(executionEvent);
        DispatchResult<F> dispatched = new DispatchResult<>(moved, bots);
        int intervalTimer = moved.intervalTimerMs() - stepMs;
        if (intervalEvent != null && active) {
            int intervalMs = execution != null && execution.intervalMs() != null
                    ? execution.intervalMs()
                    : intervalEvent.intervalMs() == null ? stepMs : intervalEvent.intervalMs();
            if (execution != null && !execution.startImmediately()
                    && current.phaseTimerMs() == 0) {
                intervalTimer = intervalMs - stepMs;
            }
            boolean canRun = current.timerMs() > 0
                    || contract.lifetime().timerMode() != AbilityContracts.TimerMode.REMAINING;
            while (intervalTimer <= 0 && canRun && dispatched.entity() != null) {
                dispatched = dispatchPhaseEvent(dispatched.entity(), contract, phase,
                        executionEvent, dispatched.bots(), arena, combat,
                        targetSlots, distances, stepMs);
                intervalTimer += Math.max(1, intervalMs);
            }
        } else if (active && phase.events().containsKey(AbilityContracts.PhaseEventType.COLLISION)) {
            dispatched = dispatchPhaseEvent(moved, contract, phase,
                    AbilityContracts.PhaseEventType.COLLISION, bots, arena, combat,
                    targetSlots, distances, stepMs);
        }
        if (dispatched.entity() == null) return new TickResult(null);
        ArenaEntity next = withIntervalTimer(dispatched.entity(), intervalTimer);
        boolean expired = phase.durationMs() != null
                && next.phaseTimerMs() >= phase.durationMs()
                || phase.durationMs() == null
                && contract.lifetime().timerMode() == AbilityContracts.TimerMode.REMAINING
                && next.timerMs() <= 0;
        if (expired) {
            if (next.visualEventMs() > 0) return new TickResult(next);
            DispatchResult<F> ended = dispatchPhaseEvent(next, contract, phase,
                    AbilityContracts.PhaseEventType.LIFETIME_END, dispatched.bots(),
                    arena, combat, List.of(), Map.of(), stepMs);
            AbilityContracts.AbilityPhase entered = ended.entity() == null
                    ? null : AbilityContracts.phaseFor(ended.entity());
            if (entered != null && !entered.id().equals(phase.id())) {
                AbilityContracts.PhaseEvent collision = entered.events().get(
                        AbilityContracts.PhaseEventType.COLLISION);
                if (collision != null && collision.actions().contains(
                        AbilityContracts.PhaseAction.APPLY_EFFECTS)) {
                    List<HitCandidate<F>> enteredCandidates = phaseTargets(
                            ended.entity(), entered, ended.bots());
                    return new TickResult(dispatchPhaseEvent(ended.entity(), contract,
                            entered, AbilityContracts.PhaseEventType.COLLISION,
                            ended.bots(), arena, combat,
                            enteredCandidates.stream().map(candidate ->
                                    candidate.bot().entitySlot()).toList(),
                            distancesBySlot(enteredCandidates), stepMs).entity());
                }
            }
            return new TickResult(ended.entity() == next
                    && !phase.events().containsKey(AbilityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> TickResult tickCanonicalSummon(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            AbilityContracts.AbilityPhase phase, List<ArenaEntity> allEntities,
            List<F> bots, ArenaBounds arena, int stepMs, Combat<F> combat) {
        int lifetime = contract.lifetime().duration();
        int previousHp = Math.max(0, entity.hp());
        ArenaEntity statusTicked = tickSummonStatuses(entity, stepMs);
        ArenaEntity effected = phase.health() == null
                ? statusTicked : combat.applyEffectsToEntity(statusTicked, bots, allEntities, arena, stepMs);
        int damage = Math.max(0, previousHp - (effected == null ? 0 : effected.hp()));
        boolean legacyDamage = false;
        if (phase.health() != null && damage == 0) {
            damage = Math.max(0, combat.damageToEntity(entity, bots, allEntities));
            effected = entity.withHp(Math.max(0, previousHp - damage));
            legacyDamage = damage > 0;
        }
        int hp = Math.max(0, effected == null ? 0 : effected.hp());
        boolean killedByDamage = previousHp > 0 && hp <= 0 && damage > 0;
        ArenaEntity next = copyWithPhase(effected, effected.x(), effected.y(),
                effected.velocityX(), effected.velocityY(), effected.traveled(), effected.timerMs(),
                true, effected.ageMs(), phase.id(), false, Math.max(0, effected.visibleMs() - stepMs),
                effected.visualEventType(), Math.max(0, effected.visualEventMs() - stepMs),
                effected.visualEventSize()).withHp(hp);
        if (legacyDamage) next = next.withDamageTakenThisTick(damage);
        next = withShotVisual(next, Math.max(0, next.shotVisualMs() - stepMs));
        next = withIntervalTimer(next, Math.max(0, next.intervalTimerMs() - stepMs));
        List<F> currentBots = bots;
        if (damage > 0) {
            AbilityContracts.PhaseEventType incomingEvent = killedByDamage
                    ? AbilityContracts.PhaseEventType.KILLED
                    : AbilityContracts.PhaseEventType.HIT;
            AbilityContracts.PhaseEvent handler = phase.events().get(incomingEvent);
            if (killedByDamage && handler == null) return new TickResult(null);
            if (handler != null) {
                DispatchResult<F> incoming = dispatchPhaseEvent(next, contract, phase,
                        incomingEvent, currentBots, arena, combat,
                        List.of(), Map.of(), stepMs);
                next = incoming.entity();
                currentBots = incoming.bots();
            }
            if (next == null) return new TickResult(null);
            AbilityContracts.AbilityPhase incomingPhase = AbilityContracts.phaseFor(next);
            if (hp <= 0 && (incomingPhase == null || incomingPhase.health() != null)) {
                return new TickResult(null);
            }
            phase = incomingPhase == null ? phase : incomingPhase;
        }
        if (next == null) return new TickResult(null);
        if (hp <= 0 && phase.health() != null) return new TickResult(null);
        if (next.ageMs() >= lifetime) {
            DispatchResult<F> ended = dispatchPhaseEvent(next, contract, phase,
                    AbilityContracts.PhaseEventType.LIFETIME_END, currentBots, arena, combat,
                    List.of(), Map.of(), stepMs);
            return new TickResult(ended.entity() == next
                    && !phase.events().containsKey(AbilityContracts.PhaseEventType.LIFETIME_END)
                    ? null : ended.entity());
        }
        final List<F> summonBots = currentBots;
        final ArenaEntity summon = next;
        F target = summonBots.stream()
                .filter(bot -> isEnemy(summon.ownerSlot(), bot, summonBots) && bot.entityHp() > 0)
                .min(Comparator.comparingDouble(bot -> distance(
                        bot.entityX(), bot.entityY(), summon.x(), summon.y())))
                .orElse(null);
        if (target == null) return new TickResult(summon);
        double dx = target.entityX() - next.x();
        double dy = target.entityY() - next.y();
        double targetDistance = Math.max(1, Math.hypot(dx, dy));
        AbilityContracts.PhaseMovement movement = phase.movement();
        double speed = summonCanMove(next)
                ? (movement == null ? 0 : movement.speed()) * summonMovementMultiplier(next)
                : 0;
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
        AbilityContracts.AbilityPhase abilityPhase = AbilityContracts.entityAbilityPhaseFor(next);
        AbilityContracts.Spawn abilitySpawn = AbilityContracts.entityAbilitySpawnFor(next);
        AbilitySpawnTransform abilityTransform = abilitySpawnTransform(next, abilitySpawn, rotation);
        AbilityContracts.Execution execution = phase.execution();
        if (!summonCanExecute(next) && execution != null && execution.intervalMs() != null) {
            next = withIntervalTimer(next, Math.max(1, execution.intervalMs()));
        }
        Double abilityRange = abilityPhase == null ? null : phaseRange(abilityPhase);
        if (execution != null && execution.abilityId() != null && abilityPhase != null
                && abilityRange != null && next.intervalTimerMs() <= 0
                && rayIntersectsCircle(abilityTransform.x(), abilityTransform.y(),
                abilityTransform.directionX(), abilityTransform.directionY(),
                abilityRange, target.entityX(),
                target.entityY(), target.entitySize() / 2.0)) {
            DispatchResult<F> result = dispatchPhaseEvent(next, contract, abilityPhase,
                    AbilityContracts.PhaseEventType.COLLISION, currentBots, arena, combat,
                    List.of(target.entitySlot()), Map.of(target.entitySlot(),
                            distance(target.entityX(), target.entityY(), abilityTransform.x(), abilityTransform.y())),
                    Map.of(target.entitySlot(), next), stepMs);
            next = result.entity();
            currentBots = result.bots();
            if (next != null) {
                int intervalMs = execution.intervalMs() == null ? 1_000 : execution.intervalMs();
                int visualMs = abilityPhase.visual() == null
                        ? abilityPhase.durationMs() == null ? 300 : abilityPhase.durationMs()
                        : abilityPhase.visual().visibleMs() == null
                                ? 300 : abilityPhase.visual().visibleMs();
                next = withIntervalTimer(next, Math.max(1, intervalMs));
                next = withShotVisual(next, Math.max(0, visualMs - stepMs));
            }
        }
        return new TickResult(next);
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
        return summonStatusActive(entity, "slow") ? .85 : 1.0;
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
        AbilityContracts.PhaseEventType targetEventType = phase.execution() == null
                ? phase.events().containsKey(AbilityContracts.PhaseEventType.INTERVAL)
                        ? AbilityContracts.PhaseEventType.INTERVAL
                        : AbilityContracts.PhaseEventType.COLLISION
                : phase.execution().event();
        if (!eventTargetsKind(phase.events().get(targetEventType), AbilityContracts.TargetKind.BOT)) {
            return List.of();
        }
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
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            AbilityContracts.AbilityPhase phase, AbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances, int stepMs) {
        return dispatchPhaseEvent(entity, contract, phase, eventType, bots, arena,
                combat, targetSlots, distances, Map.of(), stepMs);
    }

    private static <F extends AbilityEntityBot> DispatchResult<F> dispatchPhaseEvent(
            ArenaEntity entity, AbilityContracts.AbilityContract contract,
            AbilityContracts.AbilityPhase phase, AbilityContracts.PhaseEventType eventType,
            List<F> bots, ArenaBounds arena, Combat<F> combat,
            List<Integer> targetSlots, Map<Integer, Double> distances,
            Map<Integer, ArenaEntity> effectSources, int stepMs) {
        AbilityContracts.PhaseEvent event = phase.events().get(eventType);
        if (event == null) return new DispatchResult<>(entity, bots);
        ArenaEntity next = entity;
        Set<EffectType> effects = event.effectTypes().isEmpty()
                ? phase.effects().stream().map(AbilityContracts.Effect::type)
                        .collect(java.util.stream.Collectors.toUnmodifiableSet())
                : event.effectTypes();
        for (AbilityContracts.PhaseAction action : event.actions()) {
            if (action == AbilityContracts.PhaseAction.APPLY_EFFECTS) {
                if (!eventTargetsKind(event, AbilityContracts.TargetKind.BOT)) continue;
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
                            phase.effectOverrides(), phaseRange(phase), event.statusTypes());
                    next = recordTargetApplication(next, targetSlot, event.targetPolicy(), stepMs);
                }
            } else if (action == AbilityContracts.PhaseAction.TRANSITION) {
                AbilityContracts.AbilityPhase target = AbilityContracts.phaseById(next,
                        event.transition() == null ? null : event.transition().to());
                if (target != null) next = transitionToPhase(next, target);
            } else if (action == AbilityContracts.PhaseAction.EMIT_VISUAL) {
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
            } else if (action == AbilityContracts.PhaseAction.REMOVE) {
                next = null;
            }
            if (next == null) break;
        }
        return new DispatchResult<>(next, bots);
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
                entity.visualEventSize(), entity.statusEffects());
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
                entity.visualEventSize(), entity.statusEffects());
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
                entity.visualEventSize(), entity.statusEffects());
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
                Math.max(0, visualEventSize), source.statusEffects());
    }

    private static <F extends AbilityEntityBot> void applyEntityEffects(
            List<F> bots, F target, ArenaEntity source, int abilityId,
            List<AbilityContracts.Effect> declaredEffects,
            Set<EffectType> allowedEffects, ArenaBounds arena, Combat<F> combat,
            String knockbackDirection, double collisionDistance,
            Map<String, AbilityContracts.EffectOverride> overrides,
            Double rangeOverride, Set<String> statusTypes) {
        if (!isEnemy(source.ownerSlot(), target, bots)) return;
        for (AbilityContracts.Effect effect : declaredEffects) {
            if (!allowedEffects.isEmpty() && !allowedEffects.contains(effect.type())) continue;
            if (effect.type() == EffectType.STATUS && !statusTypes.isEmpty()
                    && statusTypes.stream().noneMatch(statusType ->
                            statusType.equalsIgnoreCase(effect.subtype()))) continue;
            AbilityContracts.EffectOverride override = effectOverrideFor(effect, overrides);
            AbilityContracts.Effect resolved = withEffectOverride(effect, override);
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
                    AbilityContracts.AbilityPhase sourcePhase = AbilityContracts.phaseFor(source);
                    if ("silence".equals(resolved.subtype())
                            && durationMs <= 0
                            && sourcePhase != null
                            && sourcePhase.type() == AbilityContracts.PhaseType.ZONE) {
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

    private static AbilityContracts.Effect withDuration(AbilityContracts.Effect effect, int durationMs) {
        if (durationMs == effect.durationMs()) return effect;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(), effect.amount(),
                durationMs, effect.runtimeComputed(), effect.recipient(), effect.requiresConfirmedDamage(),
                effect.mirrorsDamage(), effect.distanceMode(), effect.falloff(),
                effect.intervalMs(), effect.movementLockMs());
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
                effect.distanceMode(), falloff, effect.intervalMs(), effect.movementLockMs());
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

    private static Double phaseRange(AbilityContracts.AbilityPhase phase) {
        if (phase == null) return null;
        AbilityContracts.Hitbox hitbox = phase.hitbox();
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
        double abilityRotation = spawn.rotation() == AbilityContracts.RotationMode.ZERO
                ? 0 : ownerRotation;
        double abilityRadians = Math.toRadians(abilityRotation - 90.0);
        return new AbilitySpawnTransform(x, y, Math.cos(abilityRadians), Math.sin(abilityRadians));
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
    private record DispatchResult<F extends AbilityEntityBot>(ArenaEntity entity, List<F> bots) {}
    private record IncomingEntityResult<F extends AbilityEntityBot>(ArenaEntity entity, List<F> bots) {}
    private record EntityEntry(ArenaEntity entity, AbilityContracts.AbilityContract contract,
                               boolean killedByDamage) {}
    private record TickResult(ArenaEntity entity) {}
}
