package com.example.botfight.simulation.geometry;

/** Pure conversions between player-facing centered/Y-up and internal top-left/Y-down arena coordinates. */
public final class ArenaCoordinates {
    public static final double CENTER_X = ArenaUnits.WIDTH / 2.0;
    public static final double CENTER_Y = ArenaUnits.HEIGHT / 2.0;
    public static final double PUBLIC_MIN_X = -CENTER_X;
    public static final double PUBLIC_MAX_X = CENTER_X;
    public static final double PUBLIC_MIN_Y = -CENTER_Y;
    public static final double PUBLIC_MAX_Y = CENTER_Y;
    public static final double PUBLIC_BOT_CENTER_MIN = -CENTER_X + 30.0;
    public static final double PUBLIC_BOT_CENTER_MAX = CENTER_X - 30.0;

    private ArenaCoordinates() {}

    public static Point toInternal(double publicX, double publicY) {
        return new Point(publicX + CENTER_X, CENTER_Y - publicY);
    }

    public static Point toPublic(double internalX, double internalY) {
        return new Point(internalX - CENTER_X, CENTER_Y - internalY);
    }

    public static Offset offsetToInternal(double publicOffsetX, double publicOffsetY) {
        return new Offset(publicOffsetX, -publicOffsetY);
    }

    public static Offset offsetToPublic(double internalOffsetX, double internalOffsetY) {
        return new Offset(internalOffsetX, -internalOffsetY);
    }

    public static boolean isPublicCoordinate(double value) {
        return Double.isFinite(value) && value >= PUBLIC_MIN_X && value <= PUBLIC_MAX_X;
    }

    public static boolean isPublicBotCenterCoordinate(double value) {
        return Double.isFinite(value) && value >= PUBLIC_BOT_CENTER_MIN && value <= PUBLIC_BOT_CENTER_MAX;
    }

    public record Point(double x, double y) {}
    public record Offset(double x, double y) {}
}
