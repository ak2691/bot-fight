package com.example.botfight.simulation.ecs.entities;

import java.util.Map;

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
        int intervalTimerMs,
        int phaseTimerMs,
        int ageMs,
        double tickStartHp,
        double damageTakenThisTick,
        double damageTakenLastTick,
        double hpNetChangeLastTick,
        double rotation,
        Map<Integer, Integer> hitLedger,
        String phaseId,
        boolean phaseLocked,
        int visibleMs,
        String visualEventType,
        int visualEventMs,
        int visualEventSize) {

    public ArenaEntity {
        hitLedger = hitLedger == null ? Map.of() : Map.copyOf(hitLedger);
        ageMs = Math.max(0, ageMs);
        visibleMs = Math.max(0, visibleMs);
        visualEventMs = Math.max(0, visualEventMs);
        if (visualEventMs == 0) {
            visualEventType = null;
            visualEventSize = 0;
        } else {
            visualEventSize = Math.max(0, visualEventSize);
        }
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityIdForType(type), 0, 0, 0, 0, 0, 0, 0,
                0.0, Map.of(), null, false, 0, null, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, 0, 0, 0, 0, 0, 0, 0,
                0.0, Map.of(), null, false, 0, null, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId,
                       int intervalTimerMs, int phaseTimerMs) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, intervalTimerMs, phaseTimerMs, 0, 0, 0, 0, 0,
                0.0, Map.of(), null, false, 0, null, 0, 0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs, boolean armed, int hp,
                       int shotVisualMs, double damageMultiplier, Integer abilityId,
                       int intervalTimerMs, double rotation) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs, armed, hp,
                shotVisualMs, damageMultiplier, abilityId, intervalTimerMs, 0, 0, 0, 0, 0, 0,
                rotation, Map.of(), null, false, 0, null, 0, 0);
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
                new AbilityState(abilityId, type, armed, intervalTimerMs, phaseTimerMs,
                        phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize));
    }

    public ArenaEntity withHitLedger(Map<Integer, Integer> nextHitLedger) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs, tickStartHp, damageTakenThisTick,
                damageTakenLastTick, hpNetChangeLastTick, rotation,
                nextHitLedger, phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize);
    }

    public ArenaEntity withAgeMs(int nextAgeMs) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, Math.max(0, nextAgeMs), tickStartHp,
                damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick, rotation,
                hitLedger, phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize);
    }

    public ArenaEntity withHp(int nextHp) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, Math.max(0, nextHp), shotVisualMs, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs, tickStartHp, damageTakenThisTick,
                damageTakenLastTick, hpNetChangeLastTick, rotation,
                hitLedger, phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize);
    }

    public ArenaEntity withDamageTakenThisTick(double damage) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs, tickStartHp,
                damageTakenThisTick + Math.max(0, damage), damageTakenLastTick, hpNetChangeLastTick, rotation,
                hitLedger, phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize);
    }

    public ArenaEntity beginTickMetrics() {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs, hp, 0, damageTakenLastTick, hpNetChangeLastTick, rotation,
                hitLedger, phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize);
    }

    public ArenaEntity settleTickMetrics() {
        double netChange = Double.isFinite(tickStartHp) ? hp - tickStartHp : 0;
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled,
                timerMs, armed, hp, shotVisualMs, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs, hp, 0, damageTakenThisTick, netChange, rotation,
                hitLedger, phaseId, phaseLocked, visibleMs, visualEventType, visualEventMs, visualEventSize);
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
                                int phaseTimerMs, String phaseId, boolean phaseLocked, int visibleMs,
                                String visualEventType, int visualEventMs, int visualEventSize) {
        public AbilityState(Integer abilityId, String type, boolean armed, int intervalTimerMs,
                            int phaseTimerMs) {
            this(abilityId, type, armed, intervalTimerMs, phaseTimerMs, null, false, 0, null, 0, 0);
        }
    }

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
