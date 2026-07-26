package com.example.botfight.simulation.ecs;

public final class AbilityEntityFactory {
    private AbilityEntityFactory() {}

    public static ArenaEntity proximityMine(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        return new ArenaEntity(id, "proximityMine", ownerSlot, x, y, 24,
                Math.cos(radians) * 22, Math.sin(radians) * 22, 0, 0, false);
    }

    public static ArenaEntity silenceWave(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        return new ArenaEntity(id, "silenceWave", ownerSlot, x, y, 225,
                Math.cos(radians) * 150, Math.sin(radians) * 150, 0, 10_000, true);
    }

    public static ArenaEntity gravityField(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        return new ArenaEntity(id, "gravityField", ownerSlot, x, y, 240,
                Math.cos(radians) * 22, Math.sin(radians) * 22, 0, 0, false);
    }

    public static ArenaEntity nullZone(String id, int ownerSlot, double x, double y) {
        return new ArenaEntity(id, "nullZone", ownerSlot, x, y, 300, 0, 0, 176, 0, true);
    }

    public static ArenaEntity hunterDrone(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        return new ArenaEntity(id, "hunterDrone", ownerSlot, x, y, 28,
                Math.cos(radians), Math.sin(radians), 0, 0, true, 50);
    }

    public static ArenaEntity orbitalMarker(String id, int ownerSlot, double x, double y) {
        return new ArenaEntity(id, "orbitalMarker", ownerSlot, x, y, 260, 0, 0, 0, 1500, true);
    }

    public static ArenaEntity temporalRewindZone(String id, int ownerSlot, double x, double y) {
        // The entity system ticks later in the activation frame (50 ms).
        return new ArenaEntity(id, "temporalRewindZone", ownerSlot, x, y, 90, 0, 0, 0, 3050, true);
    }

    private static double compassRadians(double degrees) {
        return Math.toRadians(degrees - 90.0);
    }
}
