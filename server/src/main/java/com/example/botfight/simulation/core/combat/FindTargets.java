package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesDistance;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCirclesIntersect;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingRectangleCollision;
import static com.example.botfight.simulation.geometry.DistanceCalculator.rayIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsSector;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentsWithinDistance;
import static com.example.botfight.simulation.geometry.EntityHitbox.movingAgainstCircle;
import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.function.Predicate;

/**
 * The one target query. Direct hits, entity collisions, traps and entity-vs-entity damage all ask it who a
 * shape touches. Mirrors the browser's {@code ecs/abilities/findTargets.js}.
 *
 * <p>Candidates are bots ({@link AbilityEntityBot}) or arena entities; the result is nearest first.
 * <ul>
 *   <li>{@link Mode#HITBOX}: a bot's trigger hitbox (ray, arc, rectangle or circle, read from the
 *       contract {@code hitbox}) fired from {@code pose}. A bot is tested over its movement this tick; an
 *       entity is a fixed point. The distance is centre to centre.</li>
 *   <li>{@link Mode#CIRCLE}: a circle of {@code options.radius} swept along {@code options.sweep}.</li>
 *   <li>{@link Mode#COLLIDER}: {@code options.source}'s own collider swept along {@code options.sweep}.</li>
 * </ul>
 * For the swept modes the distance is the closest approach during the tick.
 */
public final class FindTargets {
    private FindTargets() {}

    public enum Mode { HITBOX, CIRCLE, COLLIDER }

    public record Pose(double x, double y, double rotation) {}

    /** The start and end of a source's movement this tick. */
    public record Sweep(double startX, double startY, double endX, double endY) {
        public static Sweep stationary(double x, double y) {
            return new Sweep(x, y, x, y);
        }

        /** An entity's last step: it moved by its velocity to where it stands now. */
        public static Sweep of(ArenaEntity entity) {
            return new Sweep(entity.x() - entity.velocityX(), entity.y() - entity.velocityY(),
                    entity.x(), entity.y());
        }
    }

    public record Hit<T>(T target, double distance) {}

    /** What to sweep, and which candidates count. {@code filter} decides hostility and vulnerability. */
    public record Options(Mode mode, ArenaEntity source, Sweep sweep, double radius, Predicate<Object> filter) {
        public static Options hitbox(Predicate<Object> filter) {
            return new Options(Mode.HITBOX, null, null, 0, filter);
        }

        public static Options circle(ArenaEntity source, Sweep sweep, double radius, Predicate<Object> filter) {
            return new Options(Mode.CIRCLE, source, sweep, radius, filter);
        }

        public static Options collider(ArenaEntity source, Sweep sweep, Predicate<Object> filter) {
            return new Options(Mode.COLLIDER, source, sweep, 0, filter);
        }
    }

    /** {@code hitbox} is read in HITBOX mode only. */
    public static <T> List<Hit<T>> findTargets(Pose pose, AbilityContracts.Hitbox hitbox, Options options,
                                               Collection<? extends T> candidates) {
        List<Hit<T>> found = new ArrayList<>();
        for (T candidate : candidates) {
            if (candidate == null || options.filter() != null && !options.filter().test(candidate)) continue;
            Double distance = distance(pose, hitbox, options, candidate);
            if (distance != null) found.add(new Hit<>(candidate, distance));
        }
        found.sort(Comparator.comparingDouble(Hit::distance));
        return found;
    }

    private static Double distance(Pose pose, AbilityContracts.Hitbox hitbox, Options options, Object candidate) {
        if (options.mode() == Mode.HITBOX) return hitboxDistance(pose, hitbox, candidate);
        Sweep sweep = options.sweep();
        if (candidate instanceof AbilityEntityBot bot) {
            double botRadius = bot.entitySize() / 2.0;
            boolean hit = options.mode() == Mode.CIRCLE
                    ? movingCirclesIntersect(sweep.startX(), sweep.startY(), sweep.endX(), sweep.endY(),
                            options.radius(), bot.entityMovementStartX(), bot.entityMovementStartY(),
                            bot.entityX(), bot.entityY(), botRadius)
                    : movingAgainstCircle(options.source(), sweep.startX(), sweep.startY(),
                            sweep.endX(), sweep.endY(), bot.entityMovementStartX(),
                            bot.entityMovementStartY(), bot.entityX(), bot.entityY(), botRadius).hit();
            return hit ? movingCirclesDistance(sweep.startX(), sweep.startY(), sweep.endX(), sweep.endY(),
                    bot.entityMovementStartX(), bot.entityMovementStartY(), bot.entityX(), bot.entityY()) : null;
        }
        ArenaEntity entity = (ArenaEntity) candidate;
        Sweep path = Sweep.of(entity);
        boolean hit = movingCollision(options.source(), sweep.startX(), sweep.startY(), sweep.endX(),
                sweep.endY(), entity, path.startX(), path.startY(), path.endX(), path.endY(), 0).hit();
        return hit ? movingCirclesDistance(sweep.startX(), sweep.startY(), sweep.endX(), sweep.endY(),
                path.startX(), path.startY(), path.endX(), path.endY()) : null;
    }

    /** True when two arena entities' colliders touch during this tick. */
    public static boolean overlap(ArenaEntity first, ArenaEntity second) {
        return !findTargets(null, null, Options.collider(first, Sweep.of(first), null),
                List.of(second)).isEmpty();
    }

    // ---- a bot's trigger hitbox

    private static Double hitboxDistance(Pose pose, AbilityContracts.Hitbox hitbox, Object candidate) {
        if (hitbox == null) return null;
        boolean hit;
        double x;
        double y;
        if (candidate instanceof AbilityEntityBot bot) {
            x = bot.entityX();
            y = bot.entityY();
            hit = hitboxHits(pose, hitbox, bot.entityMovementStartX(), bot.entityMovementStartY(),
                    x, y, bot.entitySize() / 2.0, true);
        } else {
            ArenaEntity entity = (ArenaEntity) candidate;
            x = entity.x();
            y = entity.y();
            hit = hitboxHits(pose, hitbox, x, y, x, y, hitTargetSize(entity) / 2.0, false);
        }
        return hit ? Math.hypot(x - pose.x(), y - pose.y()) : null;
    }

    private static boolean hitboxHits(Pose pose, AbilityContracts.Hitbox hitbox,
                                        double startX, double startY, double endX, double endY,
                                        double targetRadius, boolean movingTarget) {
        String shape = hitbox.shape();
        if ("ray".equals(shape)) {
            double radians = compassRadians(pose.rotation());
            double directionX = Math.cos(radians);
            double directionY = Math.sin(radians);
            double width = numeric(hitbox.width(), 5);
            double reach = targetRadius + (Double.isFinite(width) && width > 0 ? width : 5) / 2.0;
            double range = numeric(hitbox.range(), 0);
            return movingTarget
                    ? segmentsWithinDistance(pose.x(), pose.y(),
                            pose.x() + directionX * range, pose.y() + directionY * range,
                            startX, startY, endX, endY, reach)
                    : rayIntersectsCircle(pose.x(), pose.y(), directionX, directionY, range, endX, endY, reach);
        }
        double padding = hitbox.includeTargetRadius() ? targetRadius : 0;
        if ("circle".equals(shape)) {
            return segmentIntersectsCircle(startX, startY, endX, endY, pose.x(), pose.y(),
                    numeric(hitbox.radius(), 0) + padding);
        }
        if ("rectangle".equals(shape)) {
            double length = numeric(hitbox.length() == null ? hitbox.range() : hitbox.length(), 0);
            double radians = compassRadians(pose.rotation());
            double centerX = pose.x() + Math.cos(radians) * length / 2.0;
            double centerY = pose.y() + Math.sin(radians) * length / 2.0;
            return movingRectangleCollision(centerX, centerY, centerX, centerY, length,
                    numeric(hitbox.width(), 60), radians, startX, startY, endX, endY, padding).hit();
        }
        if ("arc".equals(shape)) {
            return segmentIntersectsSector(pose.x(), pose.y(), startX, startY, endX, endY, pose.rotation(),
                    numeric(hitbox.range(), 0), numeric(hitbox.arc(), 0) / 2.0, padding);
        }
        return false;
    }

    /** An entity's hit size is its circle hitbox when it declares one, else its size. */
    public static double hitTargetSize(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        AbilityContracts.Hitbox hitbox = phase == null ? null : phase.hitbox();
        if (hitbox != null && "circle".equals(hitbox.shape()) && hitbox.radius() != null) {
            return Math.max(0, hitbox.radius() * hitbox.radiusMultiplier() * 2);
        }
        return entity.size();
    }

    private static double numeric(Double value, double fallback) {
        return value == null || !Double.isFinite(value) ? fallback : value;
    }
}
