package com.example.botfight.simulation.ecs.abilities;

import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesDistance;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesIntersect;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCircleCollision;

import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Generic authoritative system for persistent ability entities.
 *
 * The system dispatches on contract behavior kind. It never needs a branch for
 * a named ability entity; adding another trap, segment, zone, summon, or
 * delayed zone only adds metadata to {@link EntityContracts}.
 */
public final class AbilityEntitySystem {
    private static final int RADIAL_ONCE_SENTINEL = -1;

    private AbilityEntitySystem() {}

    public record ShieldResult(boolean blocked, Set<EffectType> preventedEffects) {
        public static ShieldResult none() { return new ShieldResult(false, Set.of()); }
        public boolean prevents(EffectType effect) { return preventedEffects.contains(effect); }
    }

    public interface Combat<F extends AbilityEntityBot> {
        void damage(F bot, double amount);
        void damageFromOwner(List<F> bots, int ownerSlot, F target, double amount,
                             double sourceX, double sourceY);
        int damageToEntity(ArenaEntity entity, List<F> bots, List<ArenaEntity> entities);
        boolean entityHitByCurrentAttack(ArenaEntity entity, List<F> bots, List<ArenaEntity> entities);

        default ShieldResult shield(F bot, double sourceX, double sourceY, int abilityId) {
            return ShieldResult.none();
        }

        default ShieldResult shield(F bot, double sourceX, double sourceY, int abilityId,
                                    Integer chargeCost) {
            return shield(bot, sourceX, sourceY, abilityId);
        }
    }

    public static boolean isAbilityEntity(ArenaEntity entity) {
        return EntityContracts.manages(entity, EntityContracts.SystemType.ABILITY);
    }

    public static <F extends AbilityEntityBot> List<ArenaEntity> tick(
            List<ArenaEntity> entities,
            List<F> bots,
            ArenaBounds arena,
            int stepMs,
            Combat<F> combat) {
        resetPresenceFields(entities, bots);
        List<EntityEntry> traps = entities.stream()
                .map(entity -> {
                    EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
                    return new EntityEntry(entity, contract,
                            contract == null ? null : contract.behaviorFor(entity.type()),
                            false);
                })
                .filter(entry -> entry.contract() != null
                        && EntityContracts.systemFor(entry.entity()) == EntityContracts.SystemType.ABILITY
                        && entry.behavior() != null
                        && (entry.behavior().kind() == EntityContracts.BehaviorKind.TRAP
                        || entry.behavior().kind() == EntityContracts.BehaviorKind.PHASE))
                .toList();

        List<ArenaEntity> next = new ArrayList<>();
        Set<String> trapIds = new HashSet<>(traps.stream().map(entry -> entry.entity().id()).toList());
        List<EntityEntry> movedTraps = traps.stream()
                .map(entry -> {
                    ArenaEntity moved = advanceTravel(entry.entity(), entry.contract(), entry.behavior(), arena, stepMs);
                    boolean destroyedByDamage = false;
                    if (entry.contract().health() != null && entry.contract().collider().hittable()) {
                        int damage = Math.max(0, combat.damageToEntity(moved, bots, entities));
                        int hp = Math.max(0, moved.hp() - damage);
                        destroyedByDamage = hp <= 0 && damage > 0;
                        moved = copy(moved, moved.x(), moved.y(), moved.velocityX(), moved.velocityY(), moved.traveled(),
                                moved.timerMs(), moved.armed(), hp,
                                moved.shotVisualMs(), moved.damageMultiplier());
                    }
                    return new EntityEntry(moved, entry.contract(), entry.behavior(),
                            destroyedByDamage);
                })
                .filter(entry -> entry.contract().health() == null || entry.entity().hp() > 0
                        || entry.destroyedByDamage())
                .toList();
        Set<String> triggered = resolveTrapTriggers(movedTraps, entities, bots, arena, combat);

        List<ArenaEntity> trapEffects = new ArrayList<>();
        for (EntityEntry entry : movedTraps) {
            if (!triggered.contains(entry.entity().id())) {
                trapEffects.add(entry.entity());
                continue;
            }
            EntityContracts.Phase phase = phaseForEntry(entry);
            EntityContracts.Trigger trigger = phase == null ? entry.behavior().trigger() : phase.trigger();
            applyZoneEffects(bots, entry.entity(), entry.contract().abilityId(),
                    phase == null ? entry.behavior().effectTypes() : phase.effectTypes(),
                    phaseStat(entry.contract().abilityId(), phase, trigger.radiusStat(), 0),
                    arena, combat, false, null, "source",
                    phase == null ? Map.of() : phase.effectOverrides());
            EntityContracts.Derived explosion = phase == null || phase.explosion() == null
                    ? entry.behavior().explosion() : phase.explosion();
            if (explosion != null) {
                trapEffects.add(createDerivedEntity(entry.entity(), explosion,
                        phase == null ? Map.of() : phase.statOverrides()));
            }
        }

        next.addAll(trapEffects);
        for (ArenaEntity entity : entities) {
            if (trapIds.contains(entity.id())) continue;
            EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
            EntityContracts.Behavior behavior = contract == null ? null : contract.behaviorFor(entity.type());
            if (contract == null || EntityContracts.systemFor(entity) != EntityContracts.SystemType.ABILITY || behavior == null) {
                next.add(entity);
                continue;
            }
            TickResult result = tickBehavior(entity, contract, behavior, entities, bots, arena, stepMs, combat);
            if (result.entity() != null) next.add(result.entity());
            next.addAll(result.spawned());
        }
        return next;
    }

    private static <F extends AbilityEntityBot> void resetPresenceFields(
            List<ArenaEntity> entities, List<F> bots) {
        Set<String> fields = new HashSet<>();
        for (ArenaEntity entity : entities) {
            EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
            EntityContracts.Behavior behavior = contract == null ? null : contract.behaviorFor(entity.type());
            if (behavior != null && behavior.presenceField() != null) fields.add(behavior.presenceField());
        }
        if (fields.isEmpty()) return;
        for (F bot : bots) {
            for (String field : fields) bot.clearPresence(field);
        }
    }

    private static <F extends AbilityEntityBot> Set<String> resolveTrapTriggers(
            List<EntityEntry> entries,
            List<ArenaEntity> allEntities,
            List<F> bots,
            ArenaBounds arena,
            Combat<F> combat) {
        Set<String> triggered = new HashSet<>();
        for (EntityEntry entry : entries) {
            EntityContracts.Phase phase = phaseForEntry(entry);
            EntityContracts.Trigger trigger = phase == null ? entry.behavior().trigger() : phase.trigger();
            if (trigger == null) continue;
            // Death-gated traps ignore nonlethal attack hits. A lethal attack
            // is retained as destroyedByDamage so it can detonate this tick.
            boolean hit = entry.destroyedByDamage()
                    || (!trigger.requiresDestruction()
                    && entityHitByCurrentAttack(entry.entity(), allEntities, bots, arena, trigger, combat));
            boolean contact = trigger.botContact() && (phase != null || entry.entity().armed())
                    && bots.stream().anyMatch(bot -> bot.entitySlot() != entry.entity().ownerSlot()
                    && movingCirclesIntersect(
                    entry.entity().x() - entry.entity().velocityX(), entry.entity().y() - entry.entity().velocityY(),
                    entry.entity().x(), entry.entity().y(), 0,
                    bot.entityMovementStartX(), bot.entityMovementStartY(), bot.entityX(), bot.entityY(),
                    phaseStat(entry.contract().abilityId(), phase, trigger.radiusStat(), 0)));
            boolean armedExpired = phase != null
                    ? entry.entity().ageMs() >= Abilities.durationMs(entry.contract().abilityId())
                    : entry.entity().armed() && entry.entity().timerMs() >= stat(entry.contract().abilityId(), trigger.lifetimeStat(), Double.MAX_VALUE);
            if (armedExpired || hit || contact) triggered.add(entry.entity().id());
        }
        boolean changed;
        do {
            changed = false;
            for (EntityEntry source : entries) {
                EntityContracts.Phase phase = phaseForEntry(source);
                EntityContracts.Trigger trigger = phase == null ? source.behavior().trigger() : phase.trigger();
                if (!triggered.contains(source.entity().id()) || trigger == null || !trigger.chain()) continue;
                double radius = phaseStat(source.contract().abilityId(), phase, trigger.radiusStat(), 0);
                for (EntityEntry target : entries) {
                    if (triggered.contains(target.entity().id())
                            || target.contract().abilityId() != source.contract().abilityId()
                            || distance(target.entity().x(), target.entity().y(), source.entity().x(), source.entity().y()) > radius) continue;
                    triggered.add(target.entity().id());
                    changed = true;
                }
            }
        } while (changed);
        return triggered;
    }

    private static EntityContracts.Phase phaseForEntry(EntityEntry entry) {
        if (entry.destroyedByDamage()) {
            return entry.behavior().phases().stream()
                    .filter(phase -> "destroyed".equals(phase.id()))
                    .findFirst()
                    .orElse(activePhase(entry.entity(), entry.behavior()));
        }
        return activePhase(entry.entity(), entry.behavior());
    }

    private static <F extends AbilityEntityBot> boolean entityHitByCurrentAttack(
            ArenaEntity entity, List<ArenaEntity> allEntities, List<F> bots,
            ArenaBounds arena, EntityContracts.Trigger trigger, Combat<F> combat) {
        if (trigger.attackHits() && combat.entityHitByCurrentAttack(entity, bots, allEntities)) return true;
        if (trigger.projectileOverlap() && allEntities.stream().anyMatch(candidate -> candidate != entity
                && EntityContracts.manages(candidate, EntityContracts.SystemType.PROJECTILE)
                && overlaps(candidate, entity))) return true;
        return false;
    }

    private static <F extends AbilityEntityBot> TickResult tickBehavior(
            ArenaEntity entity,
            EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior,
            List<ArenaEntity> allEntities,
            List<F> bots,
            ArenaBounds arena,
            int stepMs,
            Combat<F> combat) {
        return switch (behavior.kind()) {
            case SEGMENT -> tickSegment(entity, contract, behavior, bots, arena, stepMs, combat);
            case ZONE -> tickZone(entity, contract, behavior, bots, arena, stepMs, combat);
            case SUMMON -> tickSummon(entity, contract, behavior, allEntities, bots, arena, stepMs, combat);
            case DELAYED_ZONE -> tickDelayedZone(entity, contract, behavior, bots, arena, stepMs, combat);
            case INTERVAL -> tickInterval(entity, contract, behavior, bots, arena, stepMs, combat);
            case LIFETIME -> tickLifetime(entity, stepMs);
            case RADIAL -> tickRadial(entity, contract, behavior, bots, arena, stepMs, combat);
            case VISUAL_ZONE -> tickVisual(entity, stepMs);
            case TRAP, PHASE -> new TickResult(entity);
        };
    }

    private static <F extends AbilityEntityBot> TickResult tickSegment(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        double scale = stepMs / 100.0;
        double nextX = clamp(entity.x() + entity.velocityX() * scale, 0, arena.width());
        double nextY = clamp(entity.y() + entity.velocityY() * scale, 0, arena.height());
        double moved = distance(entity.x(), entity.y(), nextX, nextY);
        EntityContracts.Hit hit = behavior.hit();
        Set<Integer> hitSlots = new HashSet<>(entity.hitSlots());
        List<HitCandidate<F>> candidates = bots.stream()
                .filter(bot -> bot.entitySlot() != entity.ownerSlot()
                        && !hitSlots.contains(bot.entitySlot())
                        && bot.entityHp() > 0
                        && !bot.ignoresHostileEffects())
                .map(bot -> new HitCandidate<>(bot,
                        movingCirclesDistance(entity.x(), entity.y(), nextX, nextY,
                                bot.entityMovementStartX(), bot.entityMovementStartY(), bot.entityX(), bot.entityY())))
                .filter(candidate -> movingCircleCollision(entity.x(), entity.y(), nextX, nextY,
                        entity.size() / 2.0,
                        candidate.bot().entityMovementStartX(), candidate.bot().entityMovementStartY(),
                        candidate.bot().entityX(), candidate.bot().entityY(), candidate.bot().entitySize() / 2.0).hit())
                .sorted(Comparator.comparingDouble(HitCandidate::distance))
                .toList();
        List<HitCandidate<F>> selected = hit.mode() == EntityContracts.HitMode.NEAREST
                ? candidates.stream().limit(1).toList() : candidates;
        boolean blocked = false;
        for (HitCandidate<F> candidate : selected) {
            F target = candidate.bot();
            hitSlots.add(target.entitySlot());
            ShieldResult shield = applyEntityEffects(bots, target, entity, contract.abilityId(), hit.effectTypes(),
                    arena, combat, false, null, hit.knockbackDirection(), candidate.distance(), Map.of());
            if (hit.stopOnBlocked() && !shield.preventedEffects().isEmpty()) {
                blocked = true;
                break;
            }
        }
        int remaining = entity.timerMs() - stepMs;
        double traveled = entity.traveled() + moved;
        boolean atEdge = nextX == 0 || nextX == arena.width() || nextY == 0 || nextY == arena.height();
        boolean remove = (selected.size() > 0 && hit.removeOnHit()) || blocked || remaining <= 0
                || atEdge;
        if (remove) return new TickResult(null);
        ArenaEntity next = copy(entity, nextX, nextY, entity.velocityX(), entity.velocityY(), traveled,
                remaining, entity.armed(), entity.hp(), entity.shotVisualMs(), entity.damageMultiplier())
                .withHitSlots(hitSlots);
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> TickResult tickPhasedZone(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        ArenaEntity moved = advancePhasedTravel(entity, behavior, arena, stepMs);
        EntityContracts.Phase phase = activePhase(moved, behavior);
        if (phase == null) return new TickResult(moved);
        EntityContracts.Phase previousPhase = phaseAtElapsed(behavior, Math.max(0, entity.ageMs() - stepMs));
        if (!phase.effectTypes().isEmpty()) {
            applyZoneEffects(bots, moved, contract.abilityId(), phase.effectTypes(),
                    phaseStat(contract.abilityId(), phase, behavior.radiusStat(), moved.size() / 2.0),
                    arena, combat, phase.skipShield(), null, "source", phase.effectOverrides());
        }
        boolean enteredPhase = previousPhase == null || !previousPhase.id().equals(phase.id());
        List<ArenaEntity> spawned = phase.explosion() == null || !enteredPhase
                ? List.of() : List.of(createDerivedEntity(moved, phase.explosion(), phase.statOverrides()));
        if (phase.explosion() != null && enteredPhase) return new TickResult(null, spawned);
        if (moved.ageMs() >= Abilities.durationMs(contract.abilityId())) {
            return new TickResult(null, spawned);
        }
        return new TickResult(moved, spawned);
    }

    private static <F extends AbilityEntityBot> TickResult tickZone(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        if (!behavior.phases().isEmpty()) return tickPhasedZone(entity, contract, behavior, bots, arena, stepMs, combat);
        EntityContracts.Movement movement = behavior.movement();
        double movementDuration = movement == null || movement.durationStat() == null
                ? 0 : stat(contract.abilityId(), movement.durationStat(), 0);
        boolean hasFuse = behavior.fuseStat() != null;
        int fuseDuration = hasFuse
                ? (int) Math.round(stat(contract.abilityId(), behavior.fuseStat(), 0)) : 0;
        boolean durationPhase = movementDuration > 0 && !entity.armed();
        boolean fusePhase = entity.armed() && hasFuse && entity.phaseTimerMs() < fuseDuration;
        boolean moving = durationPhase || (fusePhase && movement != null && movement.continueDuringFuse());
        boolean remainingLifetime = contract.lifetime().timerMode() == EntityContracts.TimerMode.REMAINING;
        ArenaEntity moved = durationPhase
                ? advanceTravel(entity, contract, behavior, arena, stepMs)
                : moving
                ? advanceFuseTravel(entity, arena)
                : copy(entity, entity.x(), entity.y(), 0, 0, entity.traveled(), entity.timerMs(),
                true, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier());
        int phaseTimerMs = durationPhase
                ? moved.phaseTimerMs()
                : hasFuse ? Math.min(fuseDuration, entity.phaseTimerMs() + stepMs) : 0;
        boolean active = !durationPhase && (!hasFuse || phaseTimerMs >= fuseDuration);
        int timerMs = remainingLifetime
                ? moved.timerMs() - (active ? stepMs : 0)
                : moved.timerMs();
        if (remainingLifetime && timerMs <= 0) return new TickResult(null);
        int lifetimeMs = (int) Math.round(stat(contract.abilityId(), contract.lifetime().stat(), Double.MAX_VALUE));
        if (!remainingLifetime && timerMs >= lifetimeMs) return new TickResult(null);

        ArenaEntity field = copy(moved, moved.x(), moved.y(), moved.velocityX(), moved.velocityY(), moved.traveled(),
                timerMs, moved.armed(), moved.hp(), moved.shotVisualMs(), moved.damageMultiplier(), moved.intervalTimerMs(),
                phaseTimerMs);
        if (!moving && behavior.presenceField() != null && active) {
            for (F bot : bots) {
                if (withinRadius(bot, field, field.size() / 2.0) && !bot.ignoresHostileEffects()) {
                    bot.setPresence(behavior.presenceField(), true);
                }
            }
        }
        if (!moving && !active && !behavior.preActiveEffectTypes().isEmpty()) {
            applyZoneEffects(bots, field, contract.abilityId(), behavior.preActiveEffectTypes(),
                    field.size() / 2.0, arena, combat, true, null, "source");
        }
        if (!moving && active && !behavior.activeEffectTypes().isEmpty()) {
            applyZoneEffects(bots, field, contract.abilityId(), behavior.activeEffectTypes(),
                    field.size() / 2.0, arena, combat, false, null, "source");
            if (behavior.explosion() != null) {
                return new TickResult(createDerivedEntity(field, behavior.explosion()));
            }
        }
        return new TickResult(field);
    }

    private static <F extends AbilityEntityBot> TickResult tickSummon(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<ArenaEntity> allEntities, List<F> bots,
            ArenaBounds arena, int stepMs, Combat<F> combat) {
        int ageMs = entity.timerMs() + stepMs;
        int lifetimeMs = (int) Math.round(stat(contract.abilityId(), contract.lifetime().stat(), 0));
        int hp = entity.hp() - combat.damageToEntity(entity, bots, allEntities);
        if (ageMs >= lifetimeMs || hp <= 0) return new TickResult(null);
        F target = bots.stream()
                .filter(bot -> bot.entitySlot() != entity.ownerSlot() && bot.entityHp() > 0)
                .min(Comparator.comparingDouble(bot -> distance(bot.entityX(), bot.entityY(), entity.x(), entity.y())))
                .orElse(null);
        ArenaEntity next = copy(entity, entity.x(), entity.y(), entity.velocityX(), entity.velocityY(),
                entity.traveled(), ageMs, true, hp, Math.max(0, entity.shotVisualMs() - stepMs), entity.damageMultiplier());
        if (target == null) return new TickResult(next);

        double dx = target.entityX() - next.x();
        double dy = target.entityY() - next.y();
        double distance = Math.max(1, Math.hypot(dx, dy));
        double speed = stat(contract.abilityId(), behavior.movement().mode().equals("seek") ? "moveSpeed" : null, 0);
        double size = stat(contract.abilityId(), "size", next.size());
        double desired = vectorBearing(dx, dy);
        double current = vectorBearing(next.velocityX(), next.velocityY());
        double rotation = normalizeDegrees(current + clamp(shortestDelta(current, desired), -8, 8));
        double radians = Math.toRadians(rotation - 90);
        double velocityX = Math.cos(radians);
        double velocityY = Math.sin(radians);
        double nextX = clamp(next.x() + dx / distance * Math.min(speed, distance), size / 2, arena.width() - size / 2);
        double nextY = clamp(next.y() + dy / distance * Math.min(speed, distance), size / 2, arena.height() - size / 2);
        next = copy(next, nextX, nextY, velocityX, velocityY, next.traveled(), next.timerMs(), true,
                next.hp(), next.shotVisualMs(), next.damageMultiplier());

        EntityContracts.Attack attack = behavior.attack();
        int cooldown = (int) Math.round(stat(contract.abilityId(), attack.cooldownStat(), 1000));
        boolean due = entity.timerMs() <= 0 || ageMs % Math.max(1, cooldown) < stepMs;
        boolean rayHit = rayIntersectsCircle(next.x(), next.y(), velocityX, velocityY,
                stat(contract.abilityId(), attack.rangeStat(), 0), target.entityX(), target.entityY(), target.entitySize() / 2.0);
        if (due && rayHit) {
            applyEntityEffects(bots, target, next, contract.abilityId(), attack.effectTypes(),
                    arena, combat, false, null, "source", Double.NaN, Map.of());
            next = copy(next, next.x(), next.y(), next.velocityX(), next.velocityY(), next.traveled(),
                    next.timerMs(), true, next.hp(), (int) Math.round(stat(contract.abilityId(), attack.visualStat(), 300)),
                    next.damageMultiplier());
        }
        return new TickResult(next);
    }

    private static <F extends AbilityEntityBot> TickResult tickDelayedZone(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        int fuse = entity.timerMs() - stepMs;
        if (fuse > 0) return new TickResult(copy(entity, entity.x(), entity.y(), 0, 0,
                entity.traveled(), fuse, true, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier()));
        applyZoneEffects(bots, entity, contract.abilityId(), behavior.effectTypes(),
                stat(contract.abilityId(), behavior.radiusStat(), entity.size() / 2.0),
                arena, combat, false, null, "source");
        return new TickResult(behavior.explosion() == null ? null : createDerivedEntity(entity, behavior.explosion()));
    }

    /** Applies one declarative zone action every configured interval. */
    private static <F extends AbilityEntityBot> TickResult tickInterval(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        int remaining = entity.timerMs() - stepMs;
        int interval = Math.max(1, (int) Math.round(stat(contract.abilityId(), behavior.intervalStat(), stepMs)));
        int intervalTimer = entity.intervalTimerMs() - stepMs;
        List<ArenaEntity> spawned = new ArrayList<>();
        while (intervalTimer <= 0) {
            applyZoneEffects(bots, entity, contract.abilityId(), behavior.effectTypes(),
                    stat(contract.abilityId(), behavior.radiusStat(), entity.size() / 2.0),
                    arena, combat, false, null, "source");
            if (behavior.explosion() != null) spawned.add(createDerivedEntity(entity, behavior.explosion()));
            intervalTimer += interval;
        }
        ArenaEntity next = remaining > 0
                ? copy(entity, entity.x(), entity.y(), entity.velocityX(), entity.velocityY(), entity.traveled(),
                remaining, entity.armed(), entity.hp(), entity.shotVisualMs(), entity.damageMultiplier(), intervalTimer)
                : null;
        return new TickResult(next, spawned);
    }

    private static TickResult tickLifetime(ArenaEntity entity, int stepMs) {
        int remaining = entity.timerMs() - stepMs;
        return new TickResult(remaining > 0
                ? copy(entity, entity.x(), entity.y(), entity.velocityX(), entity.velocityY(), entity.traveled(),
                remaining, entity.armed(), entity.hp(), entity.shotVisualMs(), entity.damageMultiplier())
                : null);
    }

    private static <F extends AbilityEntityBot> TickResult tickRadial(
            ArenaEntity entity, EntityContracts.EntityContract contract,
            EntityContracts.Behavior behavior, List<F> bots, ArenaBounds arena,
            int stepMs, Combat<F> combat) {
        if (!entity.hitSlots().contains(RADIAL_ONCE_SENTINEL) && !behavior.effectTypes().isEmpty()) {
            applyZoneEffects(bots, entity, contract.abilityId(), behavior.effectTypes(),
                    entity.size() / 2.0, arena, combat, false, null, "source");
        }
        Set<Integer> hitSlots = new HashSet<>(entity.hitSlots());
        hitSlots.add(RADIAL_ONCE_SENTINEL);
        int remaining = entity.timerMs() - stepMs;
        if (remaining <= 0) return new TickResult(null);
        return new TickResult(copy(entity, entity.x(), entity.y(), 0, 0, entity.traveled(), remaining,
                entity.armed(), entity.hp(), entity.shotVisualMs(), entity.damageMultiplier()).withHitSlots(hitSlots));
    }

    private static TickResult tickVisual(ArenaEntity entity, int stepMs) {
        int remaining = entity.timerMs() - stepMs;
        return new TickResult(remaining > 0
                ? copy(entity, entity.x(), entity.y(), 0, 0, entity.traveled(), remaining,
                entity.armed(), entity.hp(), entity.shotVisualMs(), entity.damageMultiplier())
                : null);
    }

    private static <F extends AbilityEntityBot> void applyZoneEffects(
            List<F> bots, ArenaEntity source, int abilityId, Set<EffectType> effectTypes,
            double radius, ArenaBounds arena, Combat<F> combat, boolean skipShield,
            Integer chargeCost, String knockbackDirection,
            Map<EffectType, EntityContracts.EffectOverride> effectOverrides) {
        for (F target : bots) {
            EntityContracts.EntityContract contract = EntityContracts.forEntity(source);
            EntityContracts.Behavior behavior = contract == null ? null : contract.behaviorFor(source.type());
            if (!withinRadius(target, source, radius) || target.ignoresHostileEffects()
                    || (behavior != null && behavior.skipOwner() && target.entitySlot() == source.ownerSlot())) continue;
            Integer resolvedChargeCost = chargeCost != null ? chargeCost
                    : shieldChargeCostForDistance(target, source, abilityId);
            applyEntityEffects(bots, target, source, abilityId, effectTypes, arena, combat,
                    skipShield, resolvedChargeCost, knockbackDirection,
                    movingCirclesDistance(source.x(), source.y(), source.x(), source.y(),
                            target.entityMovementStartX(), target.entityMovementStartY(), target.entityX(), target.entityY()),
                    effectOverrides);
        }
    }

    private static <F extends AbilityEntityBot> void applyZoneEffects(
            List<F> bots, ArenaEntity source, int abilityId, Set<EffectType> effectTypes,
            double radius, ArenaBounds arena, Combat<F> combat, boolean skipShield) {
        applyZoneEffects(bots, source, abilityId, effectTypes, radius, arena, combat,
                skipShield, null, "source", Map.of());
    }

    private static <F extends AbilityEntityBot> void applyZoneEffects(
            List<F> bots, ArenaEntity source, int abilityId, Set<EffectType> effectTypes,
            double radius, ArenaBounds arena, Combat<F> combat, boolean skipShield,
            Integer chargeCost, String knockbackDirection) {
        applyZoneEffects(bots, source, abilityId, effectTypes, radius, arena, combat,
                skipShield, chargeCost, knockbackDirection, Map.of());
    }

    private static <F extends AbilityEntityBot> ShieldResult applyEntityEffects(
            List<F> bots, F target, ArenaEntity source, int abilityId,
            Set<EffectType> allowedEffects, ArenaBounds arena, Combat<F> combat,
            boolean skipShield, Integer chargeCost, String knockbackDirection,
            double collisionDistance,
            Map<EffectType, EntityContracts.EffectOverride> effectOverrides) {
        AbilityContracts.AbilityContract contract = AbilityContracts.get(abilityId);
        ShieldResult shield = skipShield ? ShieldResult.none()
                : combat.shield(target, source.x(), source.y(), abilityId, chargeCost);
        for (AbilityContracts.Effect effect : contract.effects()) {
            if (!allowedEffects.isEmpty() && !allowedEffects.contains(effect.type())) continue;
            if (shield.prevents(effect.type())) continue;
            AbilityContracts.Effect resolvedEffect = withEffectOverride(effect,
                    effectOverrides.get(effect.type()));
            switch (resolvedEffect.type()) {
                case DAMAGE -> {
                    double distance = Double.isFinite(collisionDistance)
                            ? collisionDistance
                            : distance(source.x(), source.y(), target.entityX(), target.entityY());
                    double base = resolvedEffect.runtimeComputed()
                            ? Abilities.damageAtDistance(abilityId, distance) : resolvedEffect.amount();
                    combat.damageFromOwner(bots, source.ownerSlot(), target,
                            base * Math.max(0, source.damageMultiplier()),
                            source.x(), source.y());
                }
                case DEBUFF -> target.applyDebuff(resolvedEffect.subtype(), resolvedEffect.durationMs(), source.ownerSlot());
                case INTERRUPT -> target.applyInterrupt(resolvedEffect.durationMs());
                case KNOCKBACK -> {
                    double dx = "velocity".equals(knockbackDirection) ? source.velocityX() : target.entityX() - source.x();
                    double dy = "velocity".equals(knockbackDirection) ? source.velocityY() : target.entityY() - source.y();
                    double magnitude = Math.max(.001, Math.hypot(dx, dy));
                    double amount = resolvedEffect.amount();
                    target.setEntityPosition(
                            clamp(target.entityX() + dx / magnitude * amount, target.entitySize() / 2.0, arena.width() - target.entitySize() / 2.0),
                            clamp(target.entityY() + dy / magnitude * amount, target.entitySize() / 2.0, arena.height() - target.entitySize() / 2.0));
                }
                case PULL -> {
                    double dx = source.x() - target.entityX();
                    double dy = source.y() - target.entityY();
                    double magnitude = Math.max(.001, Math.hypot(dx, dy));
                    target.setEntityPosition(
                            clamp(target.entityX() + dx / magnitude * resolvedEffect.amount(), target.entitySize() / 2.0, arena.width() - target.entitySize() / 2.0),
                            clamp(target.entityY() + dy / magnitude * resolvedEffect.amount(), target.entitySize() / 2.0, arena.height() - target.entitySize() / 2.0));
                }
                default -> { }
            }
        }
        return shield;
    }

    private static AbilityContracts.Effect withEffectOverride(
            AbilityContracts.Effect effect, EntityContracts.EffectOverride override) {
        if (override == null) return effect;
        return new AbilityContracts.Effect(
                effect.type(),
                effect.subtype(),
                override.amount() == null ? effect.amount() : override.amount(),
                override.durationMs() == null ? effect.durationMs() : override.durationMs(),
                effect.runtimeComputed(),
                effect.recipient(),
                effect.requiresConfirmedDamage(),
                effect.mirrorsDamage());
    }

    private static ArenaEntity advanceTravel(ArenaEntity entity, EntityContracts.EntityContract contract,
                                              EntityContracts.Behavior behavior, ArenaBounds arena, int stepMs) {
        if (!behavior.phases().isEmpty()) return advancePhasedTravel(entity, behavior, arena, stepMs);
        EntityContracts.Movement movement = behavior.movement();
        if (movement != null && movement.durationStat() != null) {
            return behavior.kind() == EntityContracts.BehaviorKind.TRAP
                    ? advanceTimedTravel(entity, contract, movement, arena, stepMs)
                    : advanceTimedZoneTravel(entity, contract, movement, arena, stepMs);
        }
        int timer = behavior.kind() == EntityContracts.BehaviorKind.TRAP
                && contract.lifetime().timerMode() == EntityContracts.TimerMode.AGE
                ? entity.timerMs() + stepMs : entity.timerMs();
        return copy(entity, entity.x(), entity.y(), 0, 0, entity.traveled(), timer,
                true, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier());
    }

    /** Advances a non-trap movement phase from elapsed time, never from traveled distance. */
    private static ArenaEntity advanceTimedZoneTravel(ArenaEntity entity,
                                                       EntityContracts.EntityContract contract,
                                                       EntityContracts.Movement movement,
                                                       ArenaBounds arena,
                                                       int stepMs) {
        int elapsed = entity.phaseTimerMs() + stepMs;
        int duration = (int) Math.round(stat(contract.abilityId(), movement.durationStat(), 0));
        double radius = entity.size() / 2.0;
        double nextX = clamp(entity.x() + entity.velocityX(), radius, arena.width() - radius);
        double nextY = clamp(entity.y() + entity.velocityY(), radius, arena.height() - radius);
        double traveled = entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY);
        boolean armed = duration <= 0 || elapsed >= duration;
        return copy(entity, nextX, nextY,
                armed ? 0 : entity.velocityX(), armed ? 0 : entity.velocityY(), traveled,
                entity.timerMs(), armed, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier(),
                entity.intervalTimerMs(), armed ? 0 : elapsed);
    }

    /** Advances movement explicitly allowed to continue while a fuse counts down. */
    private static ArenaEntity advanceFuseTravel(ArenaEntity entity, ArenaBounds arena) {
        double radius = entity.size() / 2.0;
        double nextX = clamp(entity.x() + entity.velocityX(), radius, arena.width() - radius);
        double nextY = clamp(entity.y() + entity.velocityY(), radius, arena.height() - radius);
        return copy(entity, nextX, nextY, entity.velocityX(), entity.velocityY(),
                entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY),
                entity.timerMs(), true, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier());
    }

    /** Advances a thrown trap through travel duration, then its armed lifetime. */
    private static ArenaEntity advanceTimedTravel(ArenaEntity entity,
                                                   EntityContracts.EntityContract contract,
                                                   EntityContracts.Movement movement,
                                                   ArenaBounds arena,
                                                   int stepMs) {
        if (entity.armed()) {
            return copy(entity, entity.x(), entity.y(), 0, 0, entity.traveled(),
                    entity.timerMs() + stepMs, true, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier());
        }

        int elapsed = entity.timerMs() + stepMs;
        int travelDuration = (int) Math.round(stat(contract.abilityId(), movement.durationStat(), 0));
        double radius = entity.size() / 2.0;
        double nextX = clamp(entity.x() + entity.velocityX(), radius, arena.width() - radius);
        double nextY = clamp(entity.y() + entity.velocityY(), radius, arena.height() - radius);
        double traveled = entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY);
        boolean armed = travelDuration <= 0 || elapsed >= travelDuration;
        return copy(entity, nextX, nextY,
                armed ? 0 : entity.velocityX(), armed ? 0 : entity.velocityY(), traveled,
                armed ? 0 : elapsed, armed, entity.hp(), entity.shotVisualMs(), entity.damageMultiplier());
    }

    private static ArenaEntity advancePhasedTravel(ArenaEntity entity,
                                                     EntityContracts.Behavior behavior,
                                                     ArenaBounds arena,
                                                     int stepMs) {
        int elapsed = entity.ageMs();
        EntityContracts.Phase previous = phaseAtElapsed(behavior, Math.max(0, elapsed - stepMs));
        EntityContracts.Phase current = phaseAtElapsed(behavior, elapsed);
        EntityContracts.Movement movement = previous == null ? null : previous.movement();
        boolean moving = movement != null && "travel".equals(movement.mode());
        double radius = entity.size() / 2.0;
        double velocityX = entity.velocityX();
        double velocityY = entity.velocityY();
        Double speedOverride = previous == null ? null : previous.statOverrides().get("speed");
        if (moving && speedOverride != null) {
            double magnitude = Math.hypot(velocityX, velocityY);
            if (magnitude > 0) {
                velocityX *= speedOverride / magnitude;
                velocityY *= speedOverride / magnitude;
            }
        }
        double nextX = moving ? clamp(entity.x() + velocityX, radius, arena.width() - radius) : entity.x();
        double nextY = moving ? clamp(entity.y() + velocityY, radius, arena.height() - radius) : entity.y();
        double traveled = entity.traveled() + distance(entity.x(), entity.y(), nextX, nextY);
        int phaseElapsed = current == null ? 0 : Math.max(0, elapsed - current.startMs());
        boolean stopped = current != null && current.movement() != null
                && "stopped".equals(current.movement().mode());
        int timer = current != null && "armed".equals(current.id()) ? phaseElapsed : 0;
        return copy(entity, nextX, nextY, stopped ? 0 : velocityX, stopped ? 0 : velocityY,
                traveled, timer, entity.armed() || "armed".equals(current == null ? null : current.id()),
                entity.hp(), entity.shotVisualMs(), entity.damageMultiplier(), entity.intervalTimerMs(), phaseElapsed);
    }

    private static EntityContracts.Phase activePhase(ArenaEntity entity, EntityContracts.Behavior behavior) {
        if (entity.armed()) {
            EntityContracts.Phase armed = behavior.phases().stream()
                    .filter(phase -> "armed".equals(phase.id()))
                    .findFirst().orElse(null);
            if (armed != null) return armed;
        }
        return phaseAtElapsed(behavior, entity.ageMs());
    }

    private static EntityContracts.Phase phaseAtElapsed(EntityContracts.Behavior behavior, int elapsedMs) {
        EntityContracts.Phase current = null;
        for (EntityContracts.Phase phase : behavior.phases()) {
            if (phase.startMs() <= elapsedMs) current = phase;
        }
        return current;
    }

    private static ArenaEntity createDerivedEntity(ArenaEntity source, EntityContracts.Derived definition) {
        return createDerivedEntity(source, definition, Map.of());
    }

    private static ArenaEntity createDerivedEntity(ArenaEntity source, EntityContracts.Derived definition,
                                                   Map<String, Double> statOverrides) {
        double sizeStat = statOverrides.getOrDefault(definition.sizeStat(),
                stat(source.abilityId(), definition.sizeStat(), source.size()));
        int size = (int) Math.round(sizeStat * definition.sizeMultiplier());
        int timer = definition.visibleStat() == null
                ? definition.durationMs()
                : (int) Math.round(stat(source.abilityId(), definition.visibleStat(), definition.durationMs()));
        return new ArenaEntity(source.id() + "-" + definition.type(), definition.type(), source.ownerSlot(),
                source.x(), source.y(), size, 0, 0, 0, timer, true, 0, 0,
                source.damageMultiplier(), source.abilityId());
    }

    private static ArenaEntity copy(ArenaEntity source, double x, double y, double velocityX,
                                    double velocityY, double traveled, int timer, boolean armed,
                                    int hp, int shotVisualMs, double damageMultiplier) {
        return copy(source, x, y, velocityX, velocityY, traveled, timer, armed, hp, shotVisualMs,
                damageMultiplier, source.intervalTimerMs());
    }

    private static ArenaEntity copy(ArenaEntity source, double x, double y, double velocityX,
                                    double velocityY, double traveled, int timer, boolean armed,
                                    int hp, int shotVisualMs, double damageMultiplier, int intervalTimerMs) {
        return copy(source, x, y, velocityX, velocityY, traveled, timer, armed, hp, shotVisualMs,
                damageMultiplier, intervalTimerMs, source.phaseTimerMs());
    }

    private static ArenaEntity copy(ArenaEntity source, double x, double y, double velocityX,
                                    double velocityY, double traveled, int timer, boolean armed,
                                    int hp, int shotVisualMs, double damageMultiplier,
                                    int intervalTimerMs, int phaseTimerMs) {
        return new ArenaEntity(source.id(), source.type(), source.ownerSlot(), x, y, source.size(),
                velocityX, velocityY, traveled, timer, armed, hp, shotVisualMs, damageMultiplier,
                source.abilityId(), source.hitSlots(), intervalTimerMs, phaseTimerMs, source.ageMs());
    }

    private static boolean withinRadius(AbilityEntityBot bot, ArenaEntity source, double radius) {
        return movingCirclesIntersect(
                source.x(), source.y(), source.x(), source.y(), radius,
                bot.entityMovementStartX(), bot.entityMovementStartY(), bot.entityX(), bot.entityY(), 0);
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return movingCirclesIntersect(
                first.x() - first.velocityX(), first.y() - first.velocityY(), first.x(), first.y(), first.size() / 2.0,
                second.x() - second.velocityX(), second.y() - second.velocityY(), second.x(), second.y(), second.size() / 2.0);
    }

    private static boolean rayIntersectsCircle(double x, double y, double dx, double dy,
                                               double range, double cx, double cy, double radius) {
        double projection = (cx - x) * dx + (cy - y) * dy;
        if (projection < -radius || projection > range + radius) return false;
        double closestX = x + clamp(projection, 0, range) * dx;
        double closestY = y + clamp(projection, 0, range) * dy;
        return distance(cx, cy, closestX, closestY) <= radius;
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

    private static double stat(int abilityId, String name, double fallback) {
        if (name == null) return fallback;
        if ("range".equals(name)) return Abilities.range(abilityId);
        if ("durationMs".equals(name)) return Abilities.durationMs(abilityId);
        return EntityContracts.stat(abilityId, name, fallback);
    }

    private static double phaseStat(int abilityId, EntityContracts.Phase phase,
                                    String name, double fallback) {
        if (phase != null && name != null && phase.statOverrides().containsKey(name)) {
            return phase.statOverrides().get(name);
        }
        return stat(abilityId, name, fallback);
    }

    private static <F extends AbilityEntityBot> Integer shieldChargeCostForDistance(
            F target, ArenaEntity source, int abilityId) {
        AbilityContracts.ShieldInteraction policy = AbilityContracts.get(abilityId).shieldInteraction();
        if (policy.chargeCost() != AbilityContracts.ChargeCost.DISTANCE_SCALED) return null;
        double radius = Abilities.range(abilityId);
        double distance = distance(target.entityX(), target.entityY(), source.x(), source.y());
        if (radius <= 0) return 1;
        double t = clamp(distance / radius, 0, 1);
        return (int) clamp(Math.round(5 + (1 - 5) * t), 1, 5);
    }

    private static double distance(double x1, double y1, double x2, double y2) {
        return Math.hypot(x1 - x2, y1 - y2);
    }

    private record HitCandidate<F extends AbilityEntityBot>(F bot, double distance) {}

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private record EntityEntry(ArenaEntity entity, EntityContracts.EntityContract contract,
                               EntityContracts.Behavior behavior, boolean destroyedByDamage) {}

    private record TickResult(ArenaEntity entity, List<ArenaEntity> spawned) {
        private TickResult(ArenaEntity entity) { this(entity, List.of()); }
    }
}
