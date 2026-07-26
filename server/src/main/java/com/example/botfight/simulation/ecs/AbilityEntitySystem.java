package com.example.botfight.simulation.ecs;

import com.example.botfight.simulation.combat.AbilityContracts.EffectType;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Authoritative deterministic lifecycle and interaction system for ability entities. */
public final class AbilityEntitySystem {
    private AbilityEntitySystem() {}

    public record ShieldResult(boolean blocked, Set<EffectType> preventedEffects) {
        public static ShieldResult none() { return new ShieldResult(false, Set.of()); }
        public boolean prevents(EffectType effect) { return preventedEffects.contains(effect); }
    }

    public interface Combat<F extends AbilityEntityCombatant> {
        void damage(F fighter, int amount);
        void damageFromOwner(List<F> fighters, int ownerSlot, F target, int amount);
        int damageToEntity(ArenaEntity entity, List<F> fighters, List<ArenaEntity> entities);
        boolean entityHitByCurrentAttack(ArenaEntity entity, List<F> fighters, List<ArenaEntity> entities);
        default ShieldResult shield(F fighter, double sourceX, double sourceY, String abilityId) { return ShieldResult.none(); }
    }

    public static <F extends AbilityEntityCombatant> List<ArenaEntity> tick(
            List<ArenaEntity> entities,
            List<F> fighters,
            ArenaBounds arena,
            int stepMs,
            Combat<F> combat) {
        fighters.forEach(fighter -> fighter.setZoneSilenced(false));
        List<ArenaEntity> next = new ArrayList<>();
        tickTravelingAndPersistent(entities, fighters, arena, stepMs, combat, next);
        tickMines(entities, fighters, arena, stepMs, combat, next);
        tickMarkersAndEffects(entities, fighters, stepMs, combat, next);
        return next;
    }

    private static <F extends AbilityEntityCombatant> void tickTravelingAndPersistent(
            List<ArenaEntity> entities, List<F> fighters, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        for (ArenaEntity entity : entities) {
            if ("silenceWave".equals(entity.type())) {
                int remainingMs = entity.timerMs() - stepMs;
                double nextX = clamp(entity.x() + entity.velocityX(), 0, arena.width());
                double nextY = clamp(entity.y() + entity.velocityY(), 0, arena.height());
                boolean blocked = false;
                for (F fighter : fighters) {
                    if (fighter.entitySlot() == entity.ownerSlot()) continue;
                    if (segmentIntersectsCircle(entity.x(), entity.y(), nextX, nextY,
                            fighter.entityX(), fighter.entityY(), fighter.entitySize() / 2.0 + entity.size() / 2.0)) {
                        if (fighter.ignoresHostileEffects()) continue;
                        if (combat.shield(fighter, entity.x(), entity.y(), "silence_pulse").prevents(EffectType.DEBUFF)) {
                            blocked = true;
                            continue;
                        }
                        fighter.applySilence(2000);
                        fighter.applyStun(stepMs);
                        fighter.cancelPreparation();
                    }
                }
                boolean atEdge = nextX <= 0 || nextX >= arena.width() || nextY <= 0 || nextY >= arena.height();
                if (remainingMs > 0 && !atEdge && !blocked) next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), nextX, nextY,
                        entity.size(), entity.velocityX(), entity.velocityY(), entity.traveled() + 150, remainingMs, true));
                continue;
            }
            if ("gravityField".equals(entity.type()) || "nullZone".equals(entity.type())) {
                tickField(entity, fighters, arena, stepMs, combat, next);
                continue;
            }
            if ("hunterDrone".equals(entity.type())) tickDrone(entity, entities, fighters, arena, stepMs, combat, next);
        }
    }

    private static <F extends AbilityEntityCombatant> void tickField(
            ArenaEntity entity, List<F> fighters, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        boolean moving = entity.traveled() < 176;
        int ageMs = entity.timerMs() + stepMs;
        double x = moving ? clamp(entity.x() + entity.velocityX(), entity.size() / 2.0, arena.width() - entity.size() / 2.0) : entity.x();
        double y = moving ? clamp(entity.y() + entity.velocityY(), entity.size() / 2.0, arena.height() - entity.size() / 2.0) : entity.y();
        double traveled = moving ? entity.traveled() + Math.hypot(entity.velocityX(), entity.velocityY()) : entity.traveled();
        boolean gravityDetonates = "gravityField".equals(entity.type()) && !moving && ageMs >= 3900;
        boolean armed = !moving && !"gravityField".equals(entity.type());
        int lifetimeMs = "gravityField".equals(entity.type()) ? 4000 : 5400;
        if (ageMs >= lifetimeMs) return;
        ArenaEntity field = new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), x, y, entity.size(),
                moving ? entity.velocityX() : 0, moving ? entity.velocityY() : 0, traveled, ageMs, armed);
        if (!moving) for (F fighter : fighters) {
            double dx = x - fighter.entityX();
            double dy = y - fighter.entityY();
            double distance = Math.hypot(dx, dy);
            if (distance > entity.size() / 2.0 + fighter.entitySize() / 2.0) continue;
            if (fighter.ignoresHostileEffects()) continue;
            if ("nullZone".equals(entity.type())) fighter.setZoneSilenced(true);
            else if (!gravityDetonates && distance > 0.001) {
                fighter.setEntityPosition(
                        clamp(fighter.entityX() + dx / distance * 6, fighter.entitySize() / 2.0, arena.width() - fighter.entitySize() / 2.0),
                        clamp(fighter.entityY() + dy / distance * 6, fighter.entitySize() / 2.0, arena.height() - fighter.entitySize() / 2.0));
            } else if (gravityDetonates) {
                int band = Math.min(3, (int) Math.floor(distance / 30.0));
                if (!combat.shield(fighter, x, y, "gravity_grenade").prevents(EffectType.DAMAGE)) combat.damage(fighter, 35 - band * 5);
            }
        }
        if (!gravityDetonates) next.add(field);
        else next.add(new ArenaEntity(entity.id() + "-blast", "gravityExplosion", entity.ownerSlot(), x, y,
                entity.size(), 0, 0, 0, 300, true));
    }

    private static <F extends AbilityEntityCombatant> void tickDrone(
            ArenaEntity entity, List<ArenaEntity> entities, List<F> fighters, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        int ageMs = entity.timerMs() + stepMs;
        if (ageMs >= 6000) return;
        int hp = entity.hp() - combat.damageToEntity(entity, fighters, entities);
        if (hp <= 0) return;
        F target = fighters.stream().filter(fighter -> fighter.entitySlot() != entity.ownerSlot() && fighter.entityHp() > 0)
                .min(java.util.Comparator.comparingDouble(fighter -> Math.hypot(fighter.entityX() - entity.x(), fighter.entityY() - entity.y())))
                .orElse(null);
        double x = entity.x(), y = entity.y();
        if (target == null) {
            next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), x, y, entity.size(),
                    entity.velocityX(), entity.velocityY(), entity.traveled(), ageMs, true, hp));
            return;
        }
        double dx = target.entityX() - x, dy = target.entityY() - y, distance = Math.max(1, Math.hypot(dx, dy));
        x = clamp(x + dx / distance * Math.min(4.5, distance), 14, arena.width() - 14);
        y = clamp(y + dy / distance * Math.min(4.5, distance), 14, arena.height() - 14);
        double desired = vectorBearing(dx, dy);
        double current = vectorBearing(entity.velocityX(), entity.velocityY());
        double rotation = normalizeDegrees(current + clamp(angleDelta(current, desired), -8, 8));
        double radians = Math.toRadians(rotation - 90.0);
        double directionX = Math.cos(radians), directionY = Math.sin(radians);
        boolean fired = ageMs % 1000 < stepMs && rayIntersectsCircle(x, y, directionX, directionY, 200,
                target.entityX(), target.entityY(), target.entitySize() / 2.0);
        if (fired) {
            if (!target.ignoresHostileEffects()
                    && !combat.shield(target, x, y, "hunter_drone").prevents(EffectType.DAMAGE)) {
                combat.damageFromOwner(fighters, entity.ownerSlot(), target, 3);
            }
        }
        next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), x, y, entity.size(),
                directionX, directionY, entity.traveled(), ageMs, true, hp,
                fired ? 300 : Math.max(0, entity.shotVisualMs() - stepMs)));
    }

    private static <F extends AbilityEntityCombatant> void tickMines(
            List<ArenaEntity> entities, List<F> fighters, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        List<ArenaEntity> mines = entities.stream().filter(entity -> "proximityMine".equals(entity.type())).map(entity -> {
            boolean moving = entity.traveled() < 176;
            return moving
                    ? new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(),
                    clamp(entity.x() + entity.velocityX(), 12, arena.width() - 12),
                    clamp(entity.y() + entity.velocityY(), 12, arena.height() - 12), entity.size(),
                    entity.velocityX(), entity.velocityY(), entity.traveled() + Math.hypot(entity.velocityX(), entity.velocityY()), entity.timerMs() + stepMs, false)
                    : new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(), entity.y(), entity.size(),
                    0, 0, entity.traveled(), entity.timerMs() + stepMs, true);
        }).toList();
        Set<String> triggered = new HashSet<>();
        for (ArenaEntity mine : mines) {
            if (mine.timerMs() >= 20_000
                    || combat.entityHitByCurrentAttack(mine, fighters, entities)
                    || (mine.armed() && fighters.stream().anyMatch(fighter -> fighter.entitySlot() != mine.ownerSlot()
                    && Math.hypot(fighter.entityX() - mine.x(), fighter.entityY() - mine.y()) <= 70 + fighter.entitySize() / 2.0))) {
                triggered.add(mine.id());
            }
        }
        boolean changed;
        do {
            changed = false;
            for (ArenaEntity source : mines.stream().filter(mine -> triggered.contains(mine.id())).toList()) {
                for (ArenaEntity target : mines) {
                    if (!triggered.contains(target.id()) && Math.hypot(target.x() - source.x(), target.y() - source.y()) <= 70 + target.size() / 2.0) {
                        triggered.add(target.id());
                        changed = true;
                    }
                }
            }
        } while (changed);
        for (ArenaEntity mine : mines) {
            if (!triggered.contains(mine.id())) {
                next.add(mine);
                continue;
            }
            fighters.stream().filter(fighter -> Math.hypot(fighter.entityX() - mine.x(), fighter.entityY() - mine.y()) <= 70 + fighter.entitySize() / 2.0)
                    .forEach(fighter -> {
                        if (fighter.ignoresHostileEffects()) return;
                        if (!combat.shield(fighter, mine.x(), mine.y(), "proximity_mine").prevents(EffectType.DAMAGE)) combat.damage(fighter, 18);
                    });
            next.add(new ArenaEntity(mine.id() + "-blast", "mineExplosion", mine.ownerSlot(), mine.x(), mine.y(), 140, 0, 0, 0, 300, true));
        }
    }

    private static <F extends AbilityEntityCombatant> void tickMarkersAndEffects(
            List<ArenaEntity> entities, List<F> fighters, int stepMs, Combat<F> combat, List<ArenaEntity> next) {
        for (ArenaEntity entity : entities) {
            if (Set.of("proximityMine", "gravityField", "nullZone", "hunterDrone", "silenceWave").contains(entity.type())) continue;
            if ("orbitalMarker".equals(entity.type())) {
                int fuse = entity.timerMs() - stepMs;
                if (fuse > 0) next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(), entity.y(), entity.size(), 0, 0, 0, fuse, true));
                else {
                    fighters.forEach(fighter -> {
                        double distance = Math.hypot(fighter.entityX() - entity.x(), fighter.entityY() - entity.y());
                        if (distance <= 130 + fighter.entitySize() / 2.0 && !fighter.ignoresHostileEffects()) {
                            combat.shield(fighter, entity.x(), entity.y(), "orbital_strike");
                            combat.damage(fighter, (int) Math.round(50 * Math.max(0.25, 1 - distance / 130)));
                        }
                    });
                    next.add(new ArenaEntity(entity.id() + "-blast", "orbitalExplosion", entity.ownerSlot(), entity.x(), entity.y(), 260, 0, 0, 0, 400, true));
                }
            } else {
                int timer = entity.timerMs() - stepMs;
                if (timer > 0) next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(), entity.y(), entity.size(), 0, 0, 0, timer, true));
            }
        }
    }

    private static boolean segmentIntersectsCircle(double x1, double y1, double x2, double y2,
                                                   double cx, double cy, double radius) {
        double dx = x2 - x1, dy = y2 - y1;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared <= 0 ? 0 : clamp(((cx - x1) * dx + (cy - y1) * dy) / lengthSquared, 0, 1);
        return Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)) <= radius;
    }

    private static boolean rayIntersectsCircle(double x, double y, double dx, double dy, double range,
                                               double cx, double cy, double radius) {
        double projection = (cx - x) * dx + (cy - y) * dy;
        if (projection < -radius || projection > range + radius) return false;
        double closestX = x + Math.max(0, Math.min(range, projection)) * dx;
        double closestY = y + Math.max(0, Math.min(range, projection)) * dy;
        return Math.hypot(cx - closestX, cy - closestY) <= radius;
    }

    private static double angleDelta(double from, double to) {
        return normalizeDegrees(to - from);
    }

    private static double vectorBearing(double dx, double dy) {
        return normalizeDegrees(Math.toDegrees(Math.atan2(dx, -dy)));
    }

    private static double normalizeDegrees(double degrees) {
        double normalized = degrees % 360;
        if (normalized > 180) normalized -= 360;
        if (normalized <= -180) normalized += 360;
        return normalized;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
