package com.example.botfight.simulation.geometry;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;

/** Shared entity-shape dispatch for authoritative collision callers. */
public final class EntityHitbox {
    private EntityHitbox() {}

    public static boolean isRectangle(ArenaEntity entity) {
        EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        if (phase != null && phase.hitbox() != null) {
            return "rectangle".equals(phase.hitbox().shape());
        }
        return contract != null && contract.collider() != null
                && contract.collider().shape() == EntityContracts.ColliderShape.RECTANGLE;
    }

    public static DistanceCalculator.MovingCircleCollision movingCollision(
            ArenaEntity first,
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            ArenaEntity second,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY,
            double padding) {
        double firstSize = entitySize(first);
        double secondSize = entitySize(second);
        double firstWidth = rectangleWidth(first);
        double secondWidth = rectangleWidth(second);
        double firstLength = rectangleLength(first);
        double secondLength = rectangleLength(second);
        double extra = Math.max(0, padding);
        if (isRectangle(first)) {
            return DistanceCalculator.movingRectangleCollision(
                    firstStartX, firstStartY, firstEndX, firstEndY,
                    firstLength + extra * 2, firstWidth + extra * 2,
                    motionAngle(first, firstStartX, firstStartY, firstEndX, firstEndY),
                    secondStartX, secondStartY, secondEndX, secondEndY,
                    secondSize / 2.0);
        }
        if (isRectangle(second)) {
            return DistanceCalculator.movingRectangleCollision(
                    secondStartX, secondStartY, secondEndX, secondEndY,
                    secondLength, secondWidth,
                    motionAngle(second, secondStartX, secondStartY, secondEndX, secondEndY),
                    firstStartX, firstStartY, firstEndX, firstEndY,
                    firstSize / 2.0 + extra);
        }
        return DistanceCalculator.movingCircleCollision(
                firstStartX, firstStartY, firstEndX, firstEndY,
                circleRadius(first) + extra,
                secondStartX, secondStartY, secondEndX, secondEndY,
                circleRadius(second));
    }

    /** Resolves an entity collider against a moving circular bot collider. */
    public static DistanceCalculator.MovingCircleCollision movingAgainstCircle(
            ArenaEntity first,
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY,
            double secondRadius) {
        if (isRectangle(first)) {
            return DistanceCalculator.movingRectangleCollision(
                    firstStartX, firstStartY, firstEndX, firstEndY,
                    rectangleLength(first), rectangleWidth(first),
                    motionAngle(first, firstStartX, firstStartY, firstEndX, firstEndY),
                    secondStartX, secondStartY, secondEndX, secondEndY,
                    secondRadius);
        }
        return DistanceCalculator.movingCircleCollision(
                firstStartX, firstStartY, firstEndX, firstEndY, circleRadius(first),
                secondStartX, secondStartY, secondEndX, secondEndY, secondRadius);
    }

    private static double motionAngle(ArenaEntity entity,
                                      double startX, double startY,
                                      double endX, double endY) {
        double pathX = endX - startX;
        double pathY = endY - startY;
        if (Math.hypot(pathX, pathY) > 0.001) return Math.atan2(pathY, pathX);
        if (Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001) {
            return Math.atan2(entity.velocityY(), entity.velocityX());
        }
        return Math.toRadians(entity.rotation() - 90.0);
    }

    private static double entitySize(ArenaEntity entity) {
        return Math.max(0, entity == null ? 0 : entity.size());
    }

    private static double rectangleLength(ArenaEntity entity) {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        AttachedAbilityContracts.Hitbox hitbox = phase == null ? null : phase.hitbox();
        if (hitbox != null && hitbox.length() != null) {
            return hitbox.length();
        }
        return entitySize(entity);
    }

    private static double rectangleWidth(ArenaEntity entity) {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        AttachedAbilityContracts.Hitbox hitbox = phase == null ? null : phase.hitbox();
        if (hitbox != null && hitbox.width() != null) {
            return hitbox.width();
        }
        return entitySize(entity);
    }

    private static double circleRadius(ArenaEntity entity) {
        EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.phaseFor(entity);
        AttachedAbilityContracts.Hitbox hitbox = phase == null ? null : phase.hitbox();
        if (contract != null && hitbox != null
                && "circle".equals(hitbox.shape())
                && hitbox.radius() != null) {
            return hitbox.radius() * hitbox.radiusMultiplier();
        }
        return entitySize(entity) / 2.0;
    }
}
