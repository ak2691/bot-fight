package com.example.botfight.simulation.geometry;

/** Pure compass-angle calculations shared by authoritative simulation systems. */
public final class AngleCalculator {
    private AngleCalculator() {}

    public static double compassBearing(double fromX, double fromY, double toX, double toY) {
        return normalizeDegrees(Math.toDegrees(Math.atan2(toX - fromX, fromY - toY)));
    }

    public static double compassRadians(double compassDegrees) {
        return Math.toRadians(compassDegrees - 90.0);
    }

    public static double vectorBearing(double dx, double dy) {
        return normalizeDegrees(Math.toDegrees(Math.atan2(dx, -dy)));
    }

    public static double clockwiseDelta(double from, double to) {
        return normalizeDegrees(to - from);
    }

    public static double shortestDelta(double from, double to) {
        return ((to - from + 540.0) % 360.0) - 180.0;
    }

    public static double normalizeDegrees(double value) {
        return ((value % 360.0) + 360.0) % 360.0;
    }

    public static double normalizeRelativeDegrees(double value) {
        double normalized = normalizeDegrees(value);
        return normalized > 180.0 ? normalized - 360.0 : normalized;
    }
}
