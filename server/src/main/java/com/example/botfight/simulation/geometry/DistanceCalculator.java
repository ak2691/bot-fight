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

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
