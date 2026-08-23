package com.example.botfight.simulation.geometry;

/** Pure distance and intersection calculations for the arena coordinate system. */
public final class DistanceCalculator {
    private DistanceCalculator() {}

    public static double between(double firstX, double firstY, double secondX, double secondY) {
        return Math.hypot(secondX - firstX, secondY - firstY);
    }

    public static boolean rayIntersectsCircle(
            double originX, double originY, double directionX, double directionY,
            double range, double circleX, double circleY, double radius) {
        double offsetX = circleX - originX;
        double offsetY = circleY - originY;
        double projection = offsetX * directionX + offsetY * directionY;
        double perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
        if (projection < -radius || perpendicularSquared > radius * radius) return false;
        double entryDistance = projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared));
        return Math.max(0, entryDistance) <= range;
    }

    public static boolean segmentIntersectsCircle(
            double startX, double startY, double endX, double endY,
            double circleX, double circleY, double radius) {
        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0
                ? clamp(((circleX - startX) * dx + (circleY - startY) * dy) / lengthSquared, 0, 1)
                : 0;
        return between(circleX, circleY, startX + dx * t, startY + dy * t) <= radius;
    }

    /** Returns whether two circular colliders overlap at any point in one tick. */
    public static boolean movingCirclesIntersect(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double firstRadius, double secondStartX, double secondStartY,
            double secondEndX, double secondEndY, double secondRadius) {
        return segmentIntersectsCircle(
                firstStartX - secondStartX, firstStartY - secondStartY,
                firstEndX - secondEndX, firstEndY - secondEndY,
                0, 0, firstRadius + secondRadius);
    }

    /** Returns the closest center-to-center distance during one tick. */
    public static double movingCirclesDistance(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY) {
        double startX = firstStartX - secondStartX;
        double startY = firstStartY - secondStartY;
        double dx = firstEndX - secondEndX - startX;
        double dy = firstEndY - secondEndY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0
                ? clamp(-(startX * dx + startY * dy) / lengthSquared, 0, 1)
                : 0;
        return Math.hypot(startX + dx * t, startY + dy * t);
    }

    /**
     * Resolves one generic moving-circle hit. A hit at the final pose is an
     * ordinary contact; otherwise the movement paths are treated as swept
     * hitboxes. Callers provide movement paths, so teleports must pass the same
     * point for start and end.
     */
    public static MovingCircleCollision movingCircleCollision(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double firstRadius, double secondStartX, double secondStartY,
            double secondEndX, double secondEndY, double secondRadius) {
        double collisionRadius = firstRadius + secondRadius;
        double endDistance = between(firstEndX, firstEndY, secondEndX, secondEndY);
        if (endDistance <= collisionRadius) return new MovingCircleCollision(true, false, endDistance);
        double distance = movingCirclesDistance(firstStartX, firstStartY, firstEndX, firstEndY,
                secondStartX, secondStartY, secondEndX, secondEndY);
        return new MovingCircleCollision(distance <= collisionRadius, true, distance);
    }

    public record MovingCircleCollision(boolean hit, boolean swept, double distance) {}

    /** Returns whether two line segments come within the supplied distance. */
    public static boolean segmentsWithinDistance(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY,
            double maxDistance) {
        if (segmentsIntersect(firstStartX, firstStartY, firstEndX, firstEndY,
                secondStartX, secondStartY, secondEndX, secondEndY)) return true;
        return Math.min(
                pointToSegmentDistance(firstStartX, firstStartY, secondStartX, secondStartY, secondEndX, secondEndY),
                Math.min(
                        pointToSegmentDistance(firstEndX, firstEndY, secondStartX, secondStartY, secondEndX, secondEndY),
                        Math.min(
                                pointToSegmentDistance(secondStartX, secondStartY, firstStartX, firstStartY, firstEndX, firstEndY),
                                pointToSegmentDistance(secondEndX, secondEndY, firstStartX, firstStartY, firstEndX, firstEndY))))
                <= maxDistance;
    }

    private static double pointToSegmentDistance(double pointX, double pointY,
                                                 double startX, double startY,
                                                 double endX, double endY) {
        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0
                ? clamp(((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared, 0, 1)
                : 0;
        return between(pointX, pointY, startX + dx * t, startY + dy * t);
    }

    private static boolean segmentsIntersect(double firstStartX, double firstStartY,
                                             double firstEndX, double firstEndY,
                                             double secondStartX, double secondStartY,
                                             double secondEndX, double secondEndY) {
        double first = orientation(firstStartX, firstStartY, firstEndX, firstEndY, secondStartX, secondStartY);
        double second = orientation(firstStartX, firstStartY, firstEndX, firstEndY, secondEndX, secondEndY);
        double third = orientation(secondStartX, secondStartY, secondEndX, secondEndY, firstStartX, firstStartY);
        double fourth = orientation(secondStartX, secondStartY, secondEndX, secondEndY, firstEndX, firstEndY);
        double epsilon = 1e-9;
        return ((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
                && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))
                || Math.abs(first) <= epsilon && onSegment(firstStartX, firstStartY, firstEndX, firstEndY, secondStartX, secondStartY)
                || Math.abs(second) <= epsilon && onSegment(firstStartX, firstStartY, firstEndX, firstEndY, secondEndX, secondEndY)
                || Math.abs(third) <= epsilon && onSegment(secondStartX, secondStartY, secondEndX, secondEndY, firstStartX, firstStartY)
                || Math.abs(fourth) <= epsilon && onSegment(secondStartX, secondStartY, secondEndX, secondEndY, firstEndX, firstEndY);
    }

    private static double orientation(double startX, double startY, double endX, double endY,
                                      double pointX, double pointY) {
        return (endX - startX) * (pointY - startY) - (endY - startY) * (pointX - startX);
    }

    private static boolean onSegment(double startX, double startY, double endX, double endY,
                                     double pointX, double pointY) {
        return pointX >= Math.min(startX, endX) - 1e-9 && pointX <= Math.max(startX, endX) + 1e-9
                && pointY >= Math.min(startY, endY) - 1e-9 && pointY <= Math.max(startY, endY) + 1e-9;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
