package com.example.botfight.simulation.ecs;

import com.example.botfight.simulation.gameconfig.Abilities;

public final class AbilityEntityFactory {
    private AbilityEntityFactory() {}

    public static ArenaEntity proximityMine(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        int size = (int) Abilities.stat(11, "size", 24);
        double speed = Abilities.stat(11, "speed", 22);
        return new ArenaEntity(id, "proximityMine", ownerSlot, x, y, size,
                Math.cos(radians) * speed, Math.sin(radians) * speed, 0, 0, false);
    }

    public static ArenaEntity silenceWave(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        int size = (int) Abilities.stat(15, "projectileSize", 225);
        double speed = Abilities.stat(15, "speed", 150);
        int lifetimeMs = (int) Abilities.stat(15, "lifetimeMs", 10_000);
        return new ArenaEntity(id, "silenceWave", ownerSlot, x, y, size,
                Math.cos(radians) * speed, Math.sin(radians) * speed, 0, lifetimeMs, true);
    }

    public static ArenaEntity windburst(String id, int ownerSlot, double x, double y, double rotation,
                                        double ownerSize, double damageMultiplier) {
        double radians = compassRadians(rotation);
        double projectileSize = Abilities.stat(18, "size", 24);
        double projectileSpeed = Abilities.stat(18, "speed", 44);
        double spawnOffset = ownerSize / 2.0 + projectileSize / 2.0 + 2;
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        return new ArenaEntity(id, "windburstProjectile", ownerSlot,
                x + directionX * spawnOffset, y + directionY * spawnOffset, (int) projectileSize,
                directionX * projectileSpeed, directionY * projectileSpeed, 0,
                Abilities.durationMs(18), true, 0, 0, damageMultiplier);
    }

    public static ArenaEntity gravityField(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        int size = (int) Abilities.stat(14, "fieldSize", 240);
        double speed = Abilities.stat(14, "speed", 22);
        return new ArenaEntity(id, "gravityField", ownerSlot, x, y, size,
                Math.cos(radians) * speed, Math.sin(radians) * speed, 0, 0, false);
    }

    public static ArenaEntity nullZone(String id, int ownerSlot, double x, double y) {
        int size = (int) Abilities.stat(24, "fieldSize", 300);
        return new ArenaEntity(id, "nullZone", ownerSlot, x, y, size, 0, 0, 176, 0, true);
    }

    public static ArenaEntity hunterDrone(String id, int ownerSlot, double x, double y, double rotation) {
        double radians = compassRadians(rotation);
        int size = (int) Abilities.stat(17, "size", 28);
        return new ArenaEntity(id, "hunterDrone", ownerSlot, x, y, size,
                Math.cos(radians), Math.sin(radians), 0, 0, true, 50);
    }

    public static ArenaEntity orbitalMarker(String id, int ownerSlot, double x, double y) {
        // The entity is spawned before the entity system advances. Add one
        // 100 ms arena tick so the 1.5 s delay resolves when a 1.5 s guard
        // becomes inactive, matching the browser preview.
        int size = (int) Abilities.stat(22, "markerSize", 260);
        int delayMs = (int) Abilities.stat(22, "delayMs", 1_500);
        return new ArenaEntity(id, "orbitalMarker", ownerSlot, x, y, size, 0, 0, 0, delayMs + 100, true);
    }

    public static ArenaEntity temporalRewindZone(String id, int ownerSlot, double x, double y) {
        // The entity system ticks later in the activation frame (50 ms).
        int size = (int) Abilities.stat(21, "zoneSize", 90);
        int delayMs = (int) Abilities.stat(21, "delayMs", 3_000);
        return new ArenaEntity(id, "temporalRewindZone", ownerSlot, x, y, size, 0, 0, 0, delayMs + 50, true);
    }

    private static double compassRadians(double degrees) {
        return Math.toRadians(degrees - 90.0);
    }
}
