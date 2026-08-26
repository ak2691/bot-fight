package com.example.botfight.simulation.ecs.entities;

import java.util.Set;

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
        Integer abilityId,
        Set<Integer> hitSlots,
        int intervalTimerMs,
        int phaseTimerMs,
        int ageMs,
        double tickStartHp,
        double damageTakenThisTick,
        double damageTakenLastTick,
        double hpNetChangeLastTick,
        double rotation) {

    public ArenaEntity {
        hitSlots = hitSlots == null ? Set.of() : Set.copyOf(hitSlots);
        ageMs = Math.max(0, ageMs);
    }

    /** Compatibility constructor for callers that predate authoritative entity rotation. */
    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId, Set<Integer> hitSlots,
                       int intervalTimerMs, int phaseTimerMs, int ageMs, double tickStartHp,
                       double damageTakenThisTick, double damageTakenLastTick, double hpNetChangeLastTick) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, hitSlots, intervalTimerMs, phaseTimerMs, ageMs,
                tickStartHp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick, 0.0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityIdForType(type), Set.of(), 0, 0, 0, 0, 0, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, Set.of(), 0, 0, 0, 0, 0, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId, Set<Integer> hitSlots) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, hitSlots, 0, 0, 0, 0, 0, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId, Set<Integer> hitSlots,
                       int intervalTimerMs) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, hitSlots, intervalTimerMs, 0, 0, 0, 0, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId, Set<Integer> hitSlots,
                       int intervalTimerMs, double rotation) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, hitSlots, intervalTimerMs, 0, 0, 0, 0, 0, 0, rotation);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId, Set<Integer> hitSlots,
                       int intervalTimerMs, int phaseTimerMs) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, hitSlots, intervalTimerMs, phaseTimerMs, 0, 0, 0, 0, 0);
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
                maxHealthForType(type), 0, 1.0);
    }

    public Components components() {
        return new Components(
                new Transform(x, y, rotation),
                new Motion(velocityX, velocityY, traveled),
                new Lifetime(timerMs),
                new Collider(size),
                new Ownership(ownerSlot),
                hp > 0 ? new Health(hp, maxHealthForType(type) > 0 ? maxHealthForType(type) : hp) : null,
                new AbilityState(abilityId, type, armed, intervalTimerMs, phaseTimerMs));
    }

    public ArenaEntity withHitSlots(Set<Integer> nextHitSlots) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId,
                nextHitSlots == null ? Set.of() : Set.copyOf(nextHitSlots), intervalTimerMs, phaseTimerMs, ageMs,
                tickStartHp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick, rotation);
    }

    public ArenaEntity withAgeMs(int nextAgeMs) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId, hitSlots,
                intervalTimerMs, phaseTimerMs, Math.max(0, nextAgeMs), tickStartHp,
                damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick, rotation);
    }

    public ArenaEntity withHp(int nextHp) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, Math.max(0, nextHp), shotVisualMs, damageMultiplier, abilityId, hitSlots,
                intervalTimerMs, phaseTimerMs, ageMs, tickStartHp, damageTakenThisTick,
                damageTakenLastTick, hpNetChangeLastTick, rotation);
    }

    public ArenaEntity withDamageTakenThisTick(double damage) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId, hitSlots,
                intervalTimerMs, phaseTimerMs, ageMs, tickStartHp,
                damageTakenThisTick + Math.max(0, damage), damageTakenLastTick, hpNetChangeLastTick, rotation);
    }

    public ArenaEntity beginTickMetrics() {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId, hitSlots,
                intervalTimerMs, phaseTimerMs, ageMs, hp, 0, damageTakenLastTick, hpNetChangeLastTick, rotation);
    }

    public ArenaEntity settleTickMetrics() {
        double netChange = Double.isFinite(tickStartHp) ? hp - tickStartHp : 0;
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId, hitSlots,
                intervalTimerMs, phaseTimerMs, ageMs, hp, 0, damageTakenThisTick, netChange, rotation);
    }

    public record Components(Transform transform, Motion motion, Lifetime lifetime, Collider collider,
                             Ownership ownership, Health health, AbilityState abilityState) {}
    public record Transform(double x, double y, double rotation) {}
    public record Motion(double velocityX, double velocityY, double traveled) {}
    public record Lifetime(int timerMs) {}
    public record Collider(int size) {}
    public record Ownership(int ownerSlot) {}
    public record Health(int hp, int maxHp) {}
    public record AbilityState(Integer abilityId, String type, boolean armed, int intervalTimerMs,
                                int phaseTimerMs) {}

    private static Integer abilityIdForType(String type) {
        return switch (type) {
            case "grenade", "grenadeExplosion" -> 4;
            case "fireball" -> 5;
            case "proximityMine", "mineExplosion" -> 11;
            case "silenceWave" -> 15;
            case "windburstProjectile" -> 18;
            case "gravityZone", "gravityExplosion" -> 14;
            case "nullZone" -> 24;
            case "hunterDrone" -> 17;
            case "repellerDrone" -> 31;
            case "tetherBolt" -> 28;
            case "staticSnare", "staticSnareBurst" -> 29;
            case "orbitalMarker", "orbitalExplosion" -> 22;
            case "temporalRewindZone" -> 21;
            default -> null;
        };
    }

    private static int maxHealthForType(String type) {
        return switch (type) {
            case "hunterDrone" -> 50;
            case "repellerDrone" -> 50;
            case "staticSnare" -> 20;
            default -> 0;
        };
    }
}
