package com.example.botfight.simulation.ecs.entities;

import java.util.List;
import java.util.Map;

/**
 * Canonical authoritative entity state. Presentation metadata is intentionally
 * not part of this state; clients derive visuals from semantic events and
 * gameplay phase clocks.
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
        List<EntityStatus> statusEffects,
        int eventSequence,
        String eventType,
        Map<String, EventScheduleState> eventScheduleState) {

    public ArenaEntity {
        hitLedger = hitLedger == null ? Map.of() : Map.copyOf(hitLedger);
        statusEffects = statusEffects == null ? List.of() : List.copyOf(statusEffects);
        eventScheduleState = eventScheduleState == null ? Map.of() : Map.copyOf(eventScheduleState);
        ageMs = Math.max(0, ageMs);
        eventSequence = Math.max(0, eventSequence);
    }

    /** Source-compatible full constructor for entities without scheduler state. */
    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, double damageMultiplier,
                       Integer abilityId, int intervalTimerMs, int phaseTimerMs, int ageMs,
                       double tickStartHp, double damageTakenThisTick,
                       double damageTakenLastTick, double hpNetChangeLastTick,
                       double rotation, Map<Integer, Integer> hitLedger,
                       String phaseId, boolean phaseLocked, List<EntityStatus> statusEffects,
                       int eventSequence, String eventType) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, intervalTimerMs, phaseTimerMs,
                ageMs, tickStartHp, damageTakenThisTick, damageTakenLastTick,
                hpNetChangeLastTick, rotation, hitLedger, phaseId, phaseLocked,
                statusEffects, eventSequence, eventType, Map.of());
    }

    /** Compatibility constructor for the former collision-specific state. */
    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, double damageMultiplier,
                       Integer abilityId, int intervalTimerMs, int ignoredLegacyScheduleTimerMs,
                       boolean ignoredLegacyPhaseEntryFlag, int phaseTimerMs, int ageMs,
                       double tickStartHp, double damageTakenThisTick,
                       double damageTakenLastTick, double hpNetChangeLastTick,
                       double rotation, Map<Integer, Integer> hitLedger,
                       String phaseId, boolean phaseLocked, List<EntityStatus> statusEffects,
                       int eventSequence, String eventType) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, intervalTimerMs,
                phaseTimerMs, ageMs, tickStartHp, damageTakenThisTick,
                damageTakenLastTick, hpNetChangeLastTick, rotation, hitLedger, phaseId,
                phaseLocked, statusEffects, eventSequence, eventType, Map.of());
    }

    /** Compatibility constructor for callers that do not carry entity statuses. */
    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, double damageMultiplier,
                       Integer abilityId, int intervalTimerMs, int phaseTimerMs, int ageMs,
                       double tickStartHp, double damageTakenThisTick, double damageTakenLastTick,
                       double hpNetChangeLastTick, double rotation, Map<Integer, Integer> hitLedger,
                       String phaseId, boolean phaseLocked) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, intervalTimerMs, phaseTimerMs, ageMs,
                tickStartHp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                rotation, hitLedger, phaseId, phaseLocked, List.of(), 0, null);
    }

    /** Compatibility constructor for callers that carry statuses but not event metadata. */
    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, double damageMultiplier,
                       Integer abilityId, int intervalTimerMs, int phaseTimerMs, int ageMs,
                       double tickStartHp, double damageTakenThisTick, double damageTakenLastTick,
                       double hpNetChangeLastTick, double rotation, Map<Integer, Integer> hitLedger,
                       String phaseId, boolean phaseLocked, List<EntityStatus> statusEffects) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, intervalTimerMs, phaseTimerMs, ageMs,
                tickStartHp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                rotation, hitLedger, phaseId, phaseLocked, statusEffects, 0, null);
    }

    /*
     * Source-compatible constructors for older simulation callers. The former
     * visual arguments are deliberately ignored and no longer become entity
     * state or replay fields.
     */
    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, int ignoredShotVisualMs, double damageMultiplier) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityIdForType(type), 0, 0, false, 0, 0,
                0.0, 0.0, 0.0, 0.0, 0.0, Map.of(), null, false, List.of(), 0, null);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, int ignoredShotVisualMs, double damageMultiplier,
                       Integer abilityId) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, 0, 0, false, 0, 0,
                0.0, 0.0, 0.0, 0.0, 0.0, Map.of(), null, false, List.of(), 0, null);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, int ignoredShotVisualMs, double damageMultiplier,
                       Integer abilityId, int intervalTimerMs, int phaseTimerMs) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, intervalTimerMs, phaseTimerMs, 0,
                0.0, 0.0, 0.0, 0.0, 0.0, Map.of(), null, false, List.of(), 0, null);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, int ignoredShotVisualMs, double damageMultiplier,
                       Integer abilityId, int intervalTimerMs, double rotation) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, damageMultiplier, abilityId, intervalTimerMs, 0, 0,
                0.0, 0.0, 0.0, 0.0, rotation, Map.of(), null, false, List.of(), 0, null);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp, int ignoredShotVisualMs) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, ignoredShotVisualMs, 1.0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed, int hp) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, hp, 0, 1.0);
    }

    public ArenaEntity(String id, String type, int ownerSlot, double x, double y, int size,
                       double velocityX, double velocityY, double traveled, int timerMs,
                       boolean armed) {
        this(id, type, ownerSlot, x, y, size, velocityX, velocityY, traveled, timerMs,
                armed, maxHealthForType(type), 0, 1.0);
    }

    public Components components() {
        return new Components(
                new Transform(x, y, rotation),
                new Motion(velocityX, velocityY, traveled),
                new Lifetime(timerMs),
                new Ownership(ownerSlot),
                hp > 0 ? new Health(hp, maxHealthForType(type) > 0 ? maxHealthForType(type) : hp) : null,
                new AbilityState(abilityId, type, armed, intervalTimerMs, phaseTimerMs,
                        phaseId, phaseLocked));
    }

    public ArenaEntity withHitLedger(Map<Integer, Integer> nextHitLedger) {
        return copy(nextHitLedger, phaseId, phaseLocked, statusEffects, eventSequence, eventType,
                ageMs, hp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity withAgeMs(int nextAgeMs) {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence, eventType,
                Math.max(0, nextAgeMs), hp, damageTakenThisTick, damageTakenLastTick,
                hpNetChangeLastTick, x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity withPhase(String nextPhaseId, boolean nextPhaseLocked) {
        return copy(hitLedger, nextPhaseId, nextPhaseLocked, statusEffects, eventSequence,
                eventType, ageMs, hp, damageTakenThisTick, damageTakenLastTick,
                hpNetChangeLastTick, x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity withHp(int nextHp) {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence, eventType,
                ageMs, Math.max(0, nextHp), damageTakenThisTick, damageTakenLastTick,
                hpNetChangeLastTick, x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity withDamageTakenThisTick(double damage) {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence, eventType,
                ageMs, hp, damageTakenThisTick + Math.max(0, damage), damageTakenLastTick,
                hpNetChangeLastTick, x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity beginTickMetrics() {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence, null,
                ageMs, hp, 0, damageTakenLastTick, hpNetChangeLastTick,
                x, y, velocityX, velocityY, rotation).withTickStartHp(hp);
    }

    /** Records that an allowlisted simulation event occurred; it carries no visual metadata. */
    public ArenaEntity withEvent(String type) {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence + 1, type,
                ageMs, hp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                x, y, velocityX, velocityY, rotation);
    }

    /** Preserves semantic event metadata across component updates. */
    public ArenaEntity withEventState(String nextEventType, int nextEventSequence) {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, Math.max(0, nextEventSequence),
                nextEventType, ageMs, hp, damageTakenThisTick, damageTakenLastTick,
                hpNetChangeLastTick, x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity settleTickMetrics() {
        double netChange = Double.isFinite(tickStartHp) ? hp - tickStartHp : 0;
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence, eventType,
                ageMs, hp, 0, damageTakenThisTick, netChange,
                x, y, velocityX, velocityY, rotation).withTickStartHp(hp);
    }

    public ArenaEntity withStatusEffects(List<EntityStatus> nextStatusEffects) {
        return copy(hitLedger, phaseId, phaseLocked, nextStatusEffects, eventSequence, eventType,
                ageMs, hp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                x, y, velocityX, velocityY, rotation);
    }

    public ArenaEntity withEventScheduleState(
            Map<String, EventScheduleState> nextEventScheduleState) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY,
                traveled, timerMs, armed, hp, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs,
                tickStartHp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                rotation, hitLedger, phaseId, phaseLocked, statusEffects, eventSequence,
                eventType, nextEventScheduleState);
    }

    public ArenaEntity withPosition(double nextX, double nextY,
                                    double nextVelocityX, double nextVelocityY) {
        return copy(hitLedger, phaseId, phaseLocked, statusEffects, eventSequence, eventType,
                ageMs, hp, damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                nextX, nextY, nextVelocityX, nextVelocityY, rotation);
    }

    private ArenaEntity copy(Map<Integer, Integer> nextHitLedger, String nextPhaseId,
                             boolean nextPhaseLocked, List<EntityStatus> nextStatusEffects,
                             int nextEventSequence, String nextEventType, int nextAgeMs,
                             int nextHp, double nextDamageTakenThisTick,
                             double nextDamageTakenLastTick, double nextHpNetChangeLastTick,
                             double nextX, double nextY, double nextVelocityX,
                             double nextVelocityY, double nextRotation) {
        return new ArenaEntity(id, type, ownerSlot, nextX, nextY, size,
                nextVelocityX, nextVelocityY, traveled, timerMs, armed, nextHp,
                damageMultiplier, abilityId, intervalTimerMs, phaseTimerMs, nextAgeMs,
                tickStartHp, nextDamageTakenThisTick, nextDamageTakenLastTick,
                nextHpNetChangeLastTick, nextRotation, nextHitLedger, nextPhaseId,
                nextPhaseLocked, nextStatusEffects, nextEventSequence, nextEventType,
                eventScheduleState);
    }

    private ArenaEntity withTickStartHp(double nextTickStartHp) {
        return new ArenaEntity(id, type, ownerSlot, x, y, size, velocityX, velocityY,
                traveled, timerMs, armed, hp, damageMultiplier, abilityId,
                intervalTimerMs, phaseTimerMs, ageMs, nextTickStartHp,
                damageTakenThisTick, damageTakenLastTick, hpNetChangeLastTick,
                rotation, hitLedger, phaseId, phaseLocked, statusEffects,
                eventSequence, eventType, eventScheduleState);
    }

    public record EntityStatus(String type, int remainingMs, int intervalMs,
                               int tickElapsedMs, double amount, int movementLockMs,
                               boolean presence) {
        public EntityStatus(String type, int remainingMs, int intervalMs,
                            int tickElapsedMs, double amount, int movementLockMs) {
            this(type, remainingMs, intervalMs, tickElapsedMs, amount, movementLockMs, false);
        }

        public EntityStatus {
            type = type == null ? "" : type;
            remainingMs = Math.max(0, remainingMs);
            intervalMs = Math.max(0, intervalMs);
            tickElapsedMs = Math.max(0, tickElapsedMs);
            amount = Math.max(0, amount);
            movementLockMs = Math.max(0, movementLockMs);
        }
    }

    public record EventScheduleState(int timerMs, int occurrences, boolean initialized) {
        public EventScheduleState {
            timerMs = Math.max(0, timerMs);
            occurrences = Math.max(0, occurrences);
        }
    }

    public record Components(Transform transform, Motion motion, Lifetime lifetime,
                             Ownership ownership, Health health, AbilityState abilityState) {}
    public record Transform(double x, double y, double rotation) {}
    public record Motion(double velocityX, double velocityY, double traveled) {}
    public record Lifetime(int timerMs) {}
    public record Ownership(int ownerSlot) {}
    public record Health(int hp, int maxHp) {}
    public record AbilityState(Integer abilityId, String type, boolean armed, int intervalTimerMs,
                                int phaseTimerMs, String phaseId, boolean phaseLocked) {
        public AbilityState(Integer abilityId, String type, boolean armed, int intervalTimerMs,
                            int phaseTimerMs) {
            this(abilityId, type, armed, intervalTimerMs, phaseTimerMs, null, false);
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
