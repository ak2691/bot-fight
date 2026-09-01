package com.example.botfight.simulation.geometry;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;

/** Shared entity-shape dispatch for authoritative collision callers. */
public final class EntityHitbox {
    private EntityHitbox() {}

    public static boolean isRectangle(ArenaEntity entity) {
        EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
        boolean derived = contract != null && entity.type() != null
                && contract.derived().values().stream().anyMatch(value -> entity.type().equals(value.type()));
        return !derived
                && contract != null
                && contract.collider() != null
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
        double extra = Math.max(0, padding);
        if (isRectangle(first)) {
            return DistanceCalculator.movingRectangleCollision(
                    firstStartX, firstStartY, firstEndX, firstEndY,
                    firstSize + extra * 2, firstSize + extra * 2,
                    motionAngle(first, firstStartX, firstStartY, firstEndX, firstEndY),
                    secondStartX, secondStartY, secondEndX, secondEndY,
                    secondSize / 2.0);
        }
        if (isRectangle(second)) {
            return DistanceCalculator.movingRectangleCollision(
                    secondStartX, secondStartY, secondEndX, secondEndY,
                    secondSize, secondSize,
                    motionAngle(second, secondStartX, secondStartY, secondEndX, secondEndY),
                    firstStartX, firstStartY, firstEndX, firstEndY,
                    firstSize / 2.0 + extra);
        }
        return DistanceCalculator.movingCircleCollision(
                firstStartX, firstStartY, firstEndX, firstEndY,
                firstSize / 2.0 + extra,
                secondStartX, secondStartY, secondEndX, secondEndY,
                secondSize / 2.0);
    }

    /** Resolves an entity collider against a moving circular bot collider. */
    public static DistanceCalculator.MovingCircleCollision movingAgainstCircle(
            ArenaEntity first,
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY,
            double secondRadius) {
        double firstSize = entitySize(first);
        if (isRectangle(first)) {
            return DistanceCalculator.movingRectangleCollision(
                    firstStartX, firstStartY, firstEndX, firstEndY,
                    firstSize, firstSize,
                    motionAngle(first, firstStartX, firstStartY, firstEndX, firstEndY),
                    secondStartX, secondStartY, secondEndX, secondEndY,
                    secondRadius);
        }
        return DistanceCalculator.movingCircleCollision(
                firstStartX, firstStartY, firstEndX, firstEndY, firstSize / 2.0,
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
}
