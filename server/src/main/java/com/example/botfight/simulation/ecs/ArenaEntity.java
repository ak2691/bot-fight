package com.example.botfight.simulation.ecs;

/**
 * Canonical authoritative entity state. Flat accessors keep replay mapping
 * inexpensive while components define which systems may update each concern.
 */
public record ArenaEntity(
        String id,
        String type,
        int ownerSlot,
        double x,
        double y,
        int size,
        double velocityX,
        double velocityY,
        double traveled,
        int timerMs,
        boolean armed,
        int hp,
        int shotVisualMs,
        double damageMultiplier,
        Integer abilityId) {

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityIdForType(type));
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp, shotVisualMs, 1.0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp, 0, 1.0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed,
                "hunterDrone".equals(type) ? 50 : 0, 0, 1.0);
    }

    public Components components() {
        return new Components(
                new Transform(x, y),
                new Motion(velocityX, velocityY, traveled),
                new Lifetime(timerMs),
                new Collider(size),
                new Ownership(ownerSlot),
                hp > 0 ? new Health(hp, "hunterDrone".equals(type) ? 50 : hp) : null,
                new AbilityState(abilityId, type, armed));
    }

    public record Components(Transform transform, Motion motion, Lifetime lifetime, Collider collider,
                             Ownership ownership, Health health, AbilityState abilityState) {}
    public record Transform(double x, double y) {}
    public record Motion(double velocityX, double velocityY, double traveled) {}
    public record Lifetime(int timerMs) {}
    public record Collider(int size) {}
    public record Ownership(int ownerSlot) {}
    public record Health(int hp, int maxHp) {}
    public record AbilityState(Integer abilityId, String type, boolean armed) {}

    private static Integer abilityIdForType(String type) {
        return switch (type) {
            case "grenade", "grenadeExplosion" -> 4;
            case "fireball" -> 5;
            case "proximityMine", "mineExplosion" -> 11;
            case "silenceWave" -> 15;
            case "windburstProjectile" -> 18;
            case "gravityField", "gravityExplosion" -> 14;
            case "nullZone" -> 24;
            case "hunterDrone" -> 17;
            case "orbitalMarker", "orbitalExplosion" -> 22;
            case "temporalRewindZone" -> 21;
            default -> null;
        };
    }
}
