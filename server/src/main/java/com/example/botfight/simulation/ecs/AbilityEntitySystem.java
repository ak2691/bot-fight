package com.example.botfight.simulation.ecs;

import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;

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

    public interface Combat<F extends AbilityEntityBot> {
        void damage(F bot, int amount);
        void damageFromOwner(List<F> bots, int ownerSlot, F target, int amount);
        int damageToEntity(ArenaEntity entity, List<F> bots, List<ArenaEntity> entities);
        boolean entityHitByCurrentAttack(ArenaEntity entity, List<F> bots, List<ArenaEntity> entities);
        default ShieldResult shield(F bot, double sourceX, double sourceY, int abilityId) { return ShieldResult.none(); }
    }

    public static <F extends AbilityEntityBot> List<ArenaEntity> tick(
            List<ArenaEntity> entities,
            List<F> bots,
            ArenaBounds arena,
            int stepMs,
            Combat<F> combat) {
        bots.forEach(bot -> bot.setZoneSilenced(false));
        List<ArenaEntity> next = new ArrayList<>();
        tickTravelingAndPersistent(entities, bots, arena, stepMs, combat, next);
        tickMines(entities, bots, arena, stepMs, combat, next);
        tickMarkersAndEffects(entities, bots, stepMs, combat, next);
        return next;
    }

    private static <F extends AbilityEntityBot> void tickTravelingAndPersistent(
            List<ArenaEntity> entities, List<F> bots, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        for (ArenaEntity entity : entities) {
            if ("silenceWave".equals(entity.type())) {
                int remainingMs = entity.timerMs() - stepMs;
                double nextX = clamp(entity.x() + entity.velocityX(), 0, arena.width());
                double nextY = clamp(entity.y() + entity.velocityY(), 0, arena.height());
                boolean blocked = false;
                for (F bot : bots) {
                    if (bot.entitySlot() == entity.ownerSlot()) continue;
                    if (segmentIntersectsCircle(entity.x(), entity.y(), nextX, nextY,
                            bot.entityX(), bot.entityY(), bot.entitySize() / 2.0 + entity.size() / 2.0)) {
                        if (bot.ignoresHostileEffects()) continue;
                        if (combat.shield(bot, entity.x(), entity.y(), 15).prevents(EffectType.DEBUFF)) {
                            blocked = true;
                            continue;
                        }
                        bot.applySilence(AbilityContracts.effectDurationMs(15, "silence"));
                        bot.applyStun(stepMs);
                        bot.cancelPreparation();
                    }
                }
                boolean atEdge = nextX <= 0 || nextX >= arena.width() || nextY <= 0 || nextY >= arena.height();
                if (remainingMs > 0 && !atEdge && !blocked) next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), nextX, nextY,
                        entity.size(), entity.velocityX(), entity.velocityY(), entity.traveled()
                                + Abilities.stat(15, "speed", 150), remainingMs, true));
                continue;
            }
            if ("windburstProjectile".equals(entity.type())) {
                tickWindburstProjectile(entity, bots, arena, stepMs, combat, next);
                continue;
            }
            if ("gravityField".equals(entity.type()) || "nullZone".equals(entity.type())) {
                tickField(entity, bots, arena, stepMs, combat, next);
                continue;
            }
            if ("hunterDrone".equals(entity.type())) tickDrone(entity, entities, bots, arena, stepMs, combat, next);
        }
    }

    private static <F extends AbilityEntityBot> void tickWindburstProjectile(
            ArenaEntity entity, List<F> bots, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        double speed = Abilities.stat(18, "speed", 44);
        double maxRange = Abilities.range(18);
        double stepScale = Math.max(0, stepMs) / 100.0;
        double stepDistance = Math.min(Math.max(0, maxRange - entity.traveled()), speed * stepScale);
        double nextX = clamp(entity.x() + entity.velocityX() * stepScale, 0, arena.width());
        double nextY = clamp(entity.y() + entity.velocityY() * stepScale, 0, arena.height());
        F target = bots.stream()
                .filter(bot -> bot.entitySlot() != entity.ownerSlot()
                        && bot.entityHp() > 0
                        && !bot.ignoresHostileEffects())
                .filter(bot -> segmentIntersectsCircle(entity.x(), entity.y(), nextX, nextY,
                        bot.entityX(), bot.entityY(), bot.entitySize() / 2.0 + entity.size() / 2.0))
                .min(java.util.Comparator.comparingDouble(bot -> Math.hypot(bot.entityX() - entity.x(), bot.entityY() - entity.y())))
                .orElse(null);
        if (target != null) {
            ShieldResult shield = combat.shield(target, entity.x(), entity.y(), 18);
            if (!shield.prevents(EffectType.DAMAGE)) {
                combat.damageFromOwner(bots, entity.ownerSlot(), target,
                        (int) Math.round(AbilityContracts.effectAmount(18, EffectType.DAMAGE)
                                * Math.max(0, entity.damageMultiplier())));
            }
            if (!shield.prevents(EffectType.KNOCKBACK)) {
                double velocityLength = Math.max(0.001, Math.hypot(entity.velocityX(), entity.velocityY()));
                double knockback = AbilityContracts.get(18).effects().stream()
                        .filter(effect -> effect.type() == EffectType.KNOCKBACK)
                        .mapToDouble(AbilityContracts.Effect::amount)
                        .findFirst()
                        .orElseThrow();
                target.setEntityPosition(
                        clamp(target.entityX() + entity.velocityX() / velocityLength * knockback,
                                target.entitySize() / 2.0, arena.width() - target.entitySize() / 2.0),
                        clamp(target.entityY() + entity.velocityY() / velocityLength * knockback,
                                target.entitySize() / 2.0, arena.height() - target.entitySize() / 2.0));
            }
            return;
        }
        double traveled = entity.traveled() + stepDistance;
        int remainingMs = entity.timerMs() - stepMs;
        boolean atEdge = nextX <= 0 || nextX >= arena.width() || nextY <= 0 || nextY >= arena.height();
        if (stepDistance <= 0 || traveled >= maxRange || remainingMs <= 0 || atEdge) return;
        next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), nextX, nextY, entity.size(),
                entity.velocityX(), entity.velocityY(), traveled, remainingMs, true, entity.hp(),
                entity.shotVisualMs(), entity.damageMultiplier()));
    }

    private static <F extends AbilityEntityBot> void tickField(
            ArenaEntity entity, List<F> bots, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        double travelDistance = Abilities.stat(14, "travelDistance", 176);
        boolean moving = entity.traveled() < travelDistance;
        int ageMs = entity.timerMs() + stepMs;
        double x = moving ? clamp(entity.x() + entity.velocityX(), entity.size() / 2.0, arena.width() - entity.size() / 2.0) : entity.x();
        double y = moving ? clamp(entity.y() + entity.velocityY(), entity.size() / 2.0, arena.height() - entity.size() / 2.0) : entity.y();
        double traveled = moving ? entity.traveled() + Math.hypot(entity.velocityX(), entity.velocityY()) : entity.traveled();
        boolean gravityDetonates = "gravityField".equals(entity.type()) && !moving
                && ageMs >= Abilities.stat(14, "fuseMs", 3_900);
        boolean armed = !moving && !"gravityField".equals(entity.type());
        int lifetimeMs = "gravityField".equals(entity.type())
                ? (int) Abilities.stat(14, "lifetimeMs", 4_000)
                : (int) Abilities.stat(24, "lifetimeMs", 5_400);
        if (ageMs >= lifetimeMs) return;
        ArenaEntity field = new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), x, y, entity.size(),
                moving ? entity.velocityX() : 0, moving ? entity.velocityY() : 0, traveled, ageMs, armed);
        if (!moving) for (F bot : bots) {
            double dx = x - bot.entityX();
            double dy = y - bot.entityY();
            double distance = Math.hypot(dx, dy);
            if (distance > entity.size() / 2.0) continue;
            if (bot.ignoresHostileEffects()) continue;
            if ("nullZone".equals(entity.type())) bot.setZoneSilenced(true);
            else if (!gravityDetonates && distance > 0.001) {
                double pull = AbilityContracts.effectAmount(14, EffectType.PULL);
                bot.setEntityPosition(
                        clamp(bot.entityX() + dx / distance * pull, bot.entitySize() / 2.0, arena.width() - bot.entitySize() / 2.0),
                        clamp(bot.entityY() + dy / distance * pull, bot.entitySize() / 2.0, arena.height() - bot.entitySize() / 2.0));
            } else if (gravityDetonates) {
                if (!combat.shield(bot, x, y, 14).prevents(EffectType.DAMAGE)) {
                    combat.damageFromOwner(bots, entity.ownerSlot(), bot,
                            Abilities.damageAtDistance(14, distance));
                }
            }
        }
        if (!gravityDetonates) next.add(field);
        else next.add(new ArenaEntity(entity.id() + "-blast", "gravityExplosion", entity.ownerSlot(), x, y,
                entity.size(), 0, 0, 0, 300, true));
    }

    private static <F extends AbilityEntityBot> void tickDrone(
            ArenaEntity entity, List<ArenaEntity> entities, List<F> bots, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        int ageMs = entity.timerMs() + stepMs;
        if (ageMs >= Abilities.stat(17, "durationMs", 6_000)) return;
        int hp = entity.hp() - combat.damageToEntity(entity, bots, entities);
        if (hp <= 0) return;
        F target = bots.stream().filter(bot -> bot.entitySlot() != entity.ownerSlot() && bot.entityHp() > 0)
                .min(java.util.Comparator.comparingDouble(bot -> Math.hypot(bot.entityX() - entity.x(), bot.entityY() - entity.y())))
                .orElse(null);
        double x = entity.x(), y = entity.y();
        if (target == null) {
            next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), x, y, entity.size(),
                    entity.velocityX(), entity.velocityY(), entity.traveled(), ageMs, true, hp));
            return;
        }
        double dx = target.entityX() - x, dy = target.entityY() - y, distance = Math.max(1, Math.hypot(dx, dy));
        double moveSpeed = Abilities.stat(17, "moveSpeed", 4.5);
        double halfSize = Abilities.stat(17, "size", 28) / 2.0;
        x = clamp(x + dx / distance * Math.min(moveSpeed, distance), halfSize, arena.width() - halfSize);
        y = clamp(y + dy / distance * Math.min(moveSpeed, distance), halfSize, arena.height() - halfSize);
        double desired = vectorBearing(dx, dy);
        double current = vectorBearing(entity.velocityX(), entity.velocityY());
        double rotation = normalizeDegrees(current + clamp(angleDelta(current, desired), -8, 8));
        double radians = Math.toRadians(rotation - 90.0);
        double directionX = Math.cos(radians), directionY = Math.sin(radians);
        int shotCooldownMs = (int) Abilities.stat(17, "shotCooldownMs", 1_000);
        boolean fired = (entity.timerMs() <= 0 || ageMs % shotCooldownMs < stepMs)
                && rayIntersectsCircle(x, y, directionX, directionY,
                Abilities.stat(17, "range", 200),
                target.entityX(), target.entityY(), target.entitySize() / 2.0);
        if (fired) {
            if (!target.ignoresHostileEffects()
                    && !combat.shield(target, x, y, 17).prevents(EffectType.DAMAGE)) {
                combat.damageFromOwner(bots, entity.ownerSlot(), target,
                        (int) Math.round(AbilityContracts.effectAmount(17, EffectType.DAMAGE)));
            }
        }
        next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), x, y, entity.size(),
                directionX, directionY, entity.traveled(), ageMs, true, hp,
                fired ? (int) Abilities.stat(17, "shotVisualMs", 300)
                        : Math.max(0, entity.shotVisualMs() - stepMs)));
    }

    private static <F extends AbilityEntityBot> void tickMines(
            List<ArenaEntity> entities, List<F> bots, ArenaBounds arena, int stepMs,
            Combat<F> combat, List<ArenaEntity> next) {
        List<ArenaEntity> mines = entities.stream().filter(entity -> "proximityMine".equals(entity.type())).map(entity -> {
            double mineRadius = Abilities.range(11);
            int mineSize = (int) Abilities.stat(11, "size", 24);
            boolean moving = entity.traveled() < mineRadius * 2;
            return moving
                    ? new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(),
                    clamp(entity.x() + entity.velocityX(), mineSize / 2.0, arena.width() - mineSize / 2.0),
                    clamp(entity.y() + entity.velocityY(), mineSize / 2.0, arena.height() - mineSize / 2.0), entity.size(),
                    entity.velocityX(), entity.velocityY(), entity.traveled() + Math.hypot(entity.velocityX(), entity.velocityY()), entity.timerMs() + stepMs, false)
                    : new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(), entity.y(), entity.size(),
                    0, 0, entity.traveled(), entity.timerMs() + stepMs, true);
        }).toList();
        Set<String> triggered = new HashSet<>();
        for (ArenaEntity mine : mines) {
            if (mine.timerMs() >= Abilities.stat(11, "lifetimeMs", 20_000)
                    || combat.entityHitByCurrentAttack(mine, bots, entities)
                    || (mine.armed() && bots.stream().anyMatch(bot -> bot.entitySlot() != mine.ownerSlot()
                    && Math.hypot(bot.entityX() - mine.x(), bot.entityY() - mine.y()) <= Abilities.range(11)))) {
                triggered.add(mine.id());
            }
        }
        boolean changed;
        do {
            changed = false;
            for (ArenaEntity source : mines.stream().filter(mine -> triggered.contains(mine.id())).toList()) {
                for (ArenaEntity target : mines) {
                    if (!triggered.contains(target.id()) && Math.hypot(target.x() - source.x(), target.y() - source.y()) <= Abilities.range(11)) {
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
            bots.stream().filter(bot -> Math.hypot(bot.entityX() - mine.x(), bot.entityY() - mine.y()) <= Abilities.range(11))
                    .forEach(bot -> {
                        if (bot.ignoresHostileEffects()) return;
                        if (!combat.shield(bot, mine.x(), mine.y(), 11).prevents(EffectType.DAMAGE)) {
                            combat.damageFromOwner(bots, mine.ownerSlot(), bot,
                                    (int) Math.round(AbilityContracts.effectAmount(11, EffectType.DAMAGE)));
                        }
                    });
            next.add(new ArenaEntity(mine.id() + "-blast", "mineExplosion", mine.ownerSlot(), mine.x(), mine.y(),
                    (int) (Abilities.range(11) * 2), 0, 0, 0,
                    (int) Abilities.stat(11, "explosionVisibleMs", 300), true));
        }
    }

    private static <F extends AbilityEntityBot> void tickMarkersAndEffects(
            List<ArenaEntity> entities, List<F> bots, int stepMs, Combat<F> combat, List<ArenaEntity> next) {
        for (ArenaEntity entity : entities) {
            if (Set.of("proximityMine", "gravityField", "nullZone", "hunterDrone", "silenceWave", "windburstProjectile").contains(entity.type())) continue;
            if ("orbitalMarker".equals(entity.type())) {
                int fuse = entity.timerMs() - stepMs;
                if (fuse > 0) next.add(new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(), entity.y(), entity.size(), 0, 0, 0, fuse, true));
                else {
                    bots.forEach(bot -> {
                        double distance = Math.hypot(bot.entityX() - entity.x(), bot.entityY() - entity.y());
                        if (distance <= Abilities.range(22) && !bot.ignoresHostileEffects()) {
                            combat.shield(bot, entity.x(), entity.y(), 22);
                            combat.damageFromOwner(bots, entity.ownerSlot(), bot,
                                    Abilities.damageAtDistance(22, distance));
                        }
                    });
                    next.add(new ArenaEntity(entity.id() + "-blast", "orbitalExplosion", entity.ownerSlot(), entity.x(), entity.y(),
                            (int) Abilities.stat(22, "markerSize", 260), 0, 0, 0,
                            (int) Abilities.stat(22, "explosionVisibleMs", 400), true));
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
