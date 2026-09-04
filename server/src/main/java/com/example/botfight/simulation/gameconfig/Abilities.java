package com.example.botfight.simulation.gameconfig;

import java.util.Map;

/** Authoritative numeric definitions for every duel-v1 ability. */
public final class Abilities {
    private Abilities() {}

    public enum ResourceModel { NONE, REGENERATE, RELOAD_WHEN_EMPTY, FIXED, HP }
    public enum FalloffMode { CONTINUOUS }

    // activeMs is the browser's effective post-activation action lock. The
    // browser falls back to max(300, durationMs/visualMs) when it omits the
    // field, so those resolved values are stored explicitly here. cooldownMs
    // is the recovery phase after activeMs.
    public static final Map<Integer, AbilityDefinition> CATALOG = Map.ofEntries(
            Map.entry(1, new AbilityDefinition(600, 0, 400, 0, 20, 92, 120,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("visualSize", 207.0))),
            Map.entry(3, new AbilityDefinition(1_000, 0, 500, 0, 0, 700, 0,
                    6, 5_000, 0, ResourceModel.RELOAD_WHEN_EMPTY,
                    FalloffMode.CONTINUOUS,
                    falloff(15, 5, 100, 700), null, Map.of("hitboxWidth", 5.0, "visualSize", 16.0))),
            Map.entry(4, new AbilityDefinition(12_000, 0, 1, 0, 0, 70, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    falloff(40, 25, 0, 64), null,
                    Map.of("radius", 70.0, "hitboxWidth", 12.0, "speed", 32.0,
                            "fuseMs", 1_000.0, "visibleMs", 200.0))),
            Map.entry(5, new AbilityDefinition(
                    300, 0, 500, 1_200, 15, fixedStepRange(36, 1_200), 0, 4, 5_000, 0,
                    ResourceModel.RELOAD_WHEN_EMPTY, FalloffMode.CONTINUOUS,
                    null, new DamageOverTime(2), Map.of("hitboxWidth", 30.0, "speed", 36.0, "visualSize", 30.0))),
            Map.entry(6, new AbilityDefinition(9_600, 200, 100, 1_200, 10, 184, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("hitboxWidth", 80.0, "visualSize", 60.0))),
            Map.entry(7, new AbilityDefinition(4_600, 300, 400, 0, 30, 115, 150,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("visualSize", 220.8))),
            Map.entry(8, new AbilityDefinition(10_000, 0, 500, 0, 20, 110, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("radius", 110.0, "visualSize", 220.0))),
            Map.entry(9, new AbilityDefinition(6_700, 500, 300, 0, 20, 500, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("hitboxWidth", 5.0, "visualSize", 76.0))),
            Map.entry(10, new AbilityDefinition(11_700, 800, 300, 0, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("visualSize", 12.0))),
            Map.entry(11, new AbilityDefinition(10_000, 0, 300, 20_800, 25, 87.5, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null,
                    Map.of("size", 24.0, "speed", 22.0, "radius", 87.5,
                            "visibleMs", 300.0))),
            Map.entry(12, new AbilityDefinition(400, 0, 300, 0, 0, 500, 0,
                    10, 3_000, 0, ResourceModel.RELOAD_WHEN_EMPTY, FalloffMode.CONTINUOUS,
                    falloff(8, 4, 0, 333.33), null, Map.of("hitboxWidth", 5.0, "visualSize", 14.0))),
            Map.entry(13, new AbilityDefinition(10_700, 900, 300, 0, 40, 900, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("movementLockMs", 300.0, "hitboxWidth", 5.0, "visualSize", 100.0))),
            Map.entry(14, new AbilityDefinition(11_000, 0, 2_000, 7_000, 0, 120, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    falloff(35, 20, 0, 90), null,
                     Map.of("radius", 120.0, "speed", 22.0,
                            "pullPerTick", 6.0, "visibleMs", 300.0))),
            Map.entry(15, new AbilityDefinition(10_000, 1_000, 2_000, 1_200, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("size", 225.0, "visualSize", 225.0, "hitboxWidth", 150.0, "hitboxLength", 190.0, "speed", 150.0))),
            Map.entry(16, new AbilityDefinition(9_000, 500, 0, 4_000, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("visualSize", 80.0))),
            Map.entry(17, new AbilityDefinition(8_000, 0, 300, 6_000, 5, 200, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("size", 28.0, "visualSize", 28.0, "speed", 4.5,
                            "range", 200.0, "shotCooldownMs", 1_000.0, "shotVisualMs", 300.0, "hp", 50.0))),
            Map.entry(18, new AbilityDefinition(7_000, 300, 500, 500, 20, fixedStepRange(44, 500), 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("size", 24.0, "visualSize", 24.0, "hitboxWidth", 80.0, "hitboxLength", 115.0, "speed", 44.0, "range", 220.0,
                            "knockback", 200.0))),
            Map.entry(19, new AbilityDefinition(1_800, 0, 200, 200, 0, 150, 0,
                    0, 0, 0, ResourceModel.NONE,
                    FalloffMode.CONTINUOUS, null, null,
                    Map.of("distance", 150.0, "speed", 75.0, "activeMs", 200.0, "trailMs", 300.0, "visualSize", 114.0))),
            Map.entry(20, new AbilityDefinition(9_800, 200, 200, 0, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("visualSize", 48.0))),
            Map.entry(21, new AbilityDefinition(18_000, 0, 300, 3_100, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("delayMs", 3_000.0, "intervalMs", 400.0, "radius", 45.0, "visualSize", 90.0))),
            Map.entry(22, new AbilityDefinition(18_000, 500, 0, 1_500, 15, 130, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null,
                    Map.of("intervalMs", 500.0, "visualSize", 260.0,
                            "visibleMs", 400.0, "radius", 130.0))),
            Map.entry(23, new AbilityDefinition(15_500, 500, 0, 1_500, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("visualSize", 80.0))),
            Map.entry(24, new AbilityDefinition(13_000, 1_000, 300, 5_000, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                     null, null, Map.of("radius", 150.0, "visualSize", 300.0))),
            Map.entry(25, new AbilityDefinition(1_500, 0, 300, 0, 15, 100, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("hitboxWidth", 60.0, "visualSize", 100.0))),
            Map.entry(26, new AbilityDefinition(8_700, 0, 300, 0, 15, 120, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("knockback", 60.0))),
            Map.entry(27, new AbilityDefinition(18_000, 0, 300, 1_300, 0, 140, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    falloff(35, 15, 0, 140), null,
                    Map.of("radius", 140.0, "pullPerTick", 10.0, "visibleMs", 400.0))),
            Map.entry(28, new AbilityDefinition(7_700, 300, 300, 1_100, 10, fixedStepRange(42, 1_100), 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("pullPerTick", 100.0,
                            "hitboxWidth", 18.0, "speed", 42.0))),
            Map.entry(29, new AbilityDefinition(10_000, 0, 300, 16_000, 15, 75, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("interruptMs", 150.0,
                            "radius", 75.0, "size", 24.0, "hp", 20.0,
                            "visibleMs", 300.0))),
            Map.entry(30, new AbilityDefinition(8_000, 200, 300, 0, 15, 600, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("interruptMs", 250.0, "hitboxWidth", 8.0))),
            Map.entry(31, new AbilityDefinition(9_000, 0, 300, 6_000, 3, 200, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("hp", 50.0, "size", 28.0, "visualSize", 28.0,
                            "speed", 4.5, "range", 200.0, "shotCooldownMs", 1_000.0,
                            "shotVisualMs", 300.0, "turnStepDegrees", 8.0, "knockback", 40.0))),
            Map.entry(32, new AbilityDefinition(10_000, 300, 300, 0, 0, 500, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    falloff(25, 15, 0, 500), null,
                    Map.of("hitboxWidth", 10.0))),
            Map.entry(33, new AbilityDefinition(12_000, 500, 0, 4_000, 0, 0, 0,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of("cooldownRecoveryPercent", 50.0,
                    "cooldownRecoveryMultiplier", 0.5, "visualMs", 300.0))),
            Map.entry(34, new AbilityDefinition(500, 0, 200, 0, 8, 80, 30,
                    0, 0, 0, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    null, null, Map.of()))
    );

    /** Status timing belongs to the ability that creates the status instance. */
    private static final Map<Integer, Map<String, StatusDefinition>> STATUS_CATALOG = Map.ofEntries(
            Map.entry(5, Map.of("burn", new StatusDefinition(5_000, 1_000))),
            Map.entry(6, Map.of("stun", new StatusDefinition(1_200, 0))),
            Map.entry(7, Map.of("bleed", new StatusDefinition(5_000, 1_000))),
            Map.entry(9, Map.of("slow", new StatusDefinition(1_000, 0))),
            Map.entry(13, Map.of("shock", new StatusDefinition(3_000, 1_000))),
            Map.entry(15, Map.of("silence", new StatusDefinition(2_000, 0))),
            Map.entry(16, Map.of(
                    "damage_reduction", new StatusDefinition(4_000, 0),
                    "damage_reflection", new StatusDefinition(4_000, 0))),
            Map.entry(23, Map.of("damage_immunity", new StatusDefinition(1_500, 0))),
            Map.entry(26, Map.of("slow", new StatusDefinition(1_500, 0))),
            Map.entry(28, Map.of("slow", new StatusDefinition(1_200, 0))),
            Map.entry(29, Map.of("slow", new StatusDefinition(2_200, 0))),
            Map.entry(30, Map.of("slow", new StatusDefinition(2_000, 0))),
            Map.entry(33, Map.of("overclock", new StatusDefinition(4_000, 0)))
    );

    public static AbilityDefinition definition(int id) {
        AbilityDefinition definition = CATALOG.get(id);
        if (definition == null) throw new IllegalArgumentException("unknown ability: " + id);
        return definition;
    }
    public static int cooldownMs(int id) { return definition(id).cooldownMs(); }
    public static int windupMs(int id) { return definition(id).windupMs(); }
    public static int durationMs(int id) { return definition(id).durationMs(); }
    public static double range(int id) { return definition(id).range(); }
    public static double arc(int id) { return definition(id).arc(); }
    public static double radius(int id) { return stat(id, "radius", definition(id).range()); }
    public static int projectileSize(int id) { return (int) stat(id, "hitboxWidth", 0); }
    public static double projectileSpeed(int id) { return stat(id, "speed", 0); }
    public static int projectileFuseMs(int id) { return (int) stat(id, "fuseMs", 0); }
    public static int projectileVisualMs(int id) { return (int) stat(id, "visibleMs", 0); }
    public static double stat(int id, String name, double fallback) {
        return definition(id).stats().getOrDefault(name, fallback);
    }
    public static Map<String, StatusDefinition> statuses(int id) {
        return STATUS_CATALOG.getOrDefault(id, Map.of());
    }
    public static int statusDurationMs(int id, String status, int fallback) {
        return statuses(id).getOrDefault(status, new StatusDefinition(fallback, 0)).durationMs();
    }
    public static int statusIntervalMs(int id, String status, int fallback) {
        return statuses(id).getOrDefault(status, new StatusDefinition(0, fallback)).intervalMs();
    }
    public static boolean hasCharges(int id) {
        return definition(id).charges() > 0;
    }

    public static int maxCharges(int id, double maxHp) {
        return definition(id).charges();
    }

    private static AbilityContracts.Falloff falloff(double maxAmount, double minAmount,
                                                    double startDistance, double endDistance) {
        return new AbilityContracts.Falloff(minAmount, maxAmount, null, null,
                startDistance, endDistance);
    }

    private static double fixedStepRange(double displacementPerTick, double durationMs) {
        return displacementPerTick * durationMs / 100.0;
    }

    public static double amountAtDistance(int id, double distance) {
        return amountAtDistance(id, distance, null);
    }

    private static double amountAtDistance(int id, double distance, Double rangeOverride) {
        AbilityDefinition ability = definition(id);
        AbilityContracts.Falloff profile = ability.falloff();
        if (profile == null || !profile.hasAmountProfile()) return ability.damage();
        return amountAtDistance(id, distance, profile, rangeOverride);
    }

    /** Resolves a caller-supplied generic amount profile, clamped to ability range. */
    public static double amountAtDistance(int id, double distance,
                                          AbilityContracts.Falloff profile,
                                          Double rangeOverride) {
        if (profile == null || !profile.hasAmountProfile()) {
            return amountAtDistance(id, distance, rangeOverride);
        }
        double range = finitePositive(rangeOverride) ? rangeOverride : definition(id).range();
        if (!Double.isFinite(distance) || finitePositive(range) && distance > range) return 0;
        double maxAmount = profile.maxAmount() == null
                ? profile.minAmount() : profile.maxAmount();
        double minAmount = profile.minAmount() == null
                ? maxAmount : profile.minAmount();
        return resolveFalloffValue(distance, minAmount, maxAmount,
                profile.falloffStart(), profile.falloffEnd(), range);
    }

    /** Resolves a caller-supplied generic duration profile in milliseconds. */
    public static int durationAtDistance(int id, double distance, int defaultDurationMs,
                                         AbilityContracts.Falloff profile,
                                         Double rangeOverride) {
        if (profile == null || !profile.hasDurationProfile()) {
            return Math.max(0, defaultDurationMs);
        }
        double range = finitePositive(rangeOverride) ? rangeOverride : definition(id).range();
        if (!Double.isFinite(distance) || finitePositive(range) && distance > range) return 0;
        double maxDuration = profile.maxDurationMs() == null
                ? defaultDurationMs : profile.maxDurationMs();
        double minDuration = profile.minDurationMs() == null
                ? maxDuration : profile.minDurationMs();
        return Math.max(0, (int) Math.round(resolveFalloffValue(distance,
                minDuration, maxDuration, profile.falloffStart(),
                profile.falloffEnd(), range)));
    }

    private static double resolveFalloffValue(double distance, double minValue,
                                              double maxValue, double start,
                                              double end, double range) {
        if (!Double.isFinite(minValue) || !Double.isFinite(maxValue)
                || !Double.isFinite(start) || !Double.isFinite(end)) return 0;
        double maxRange = finitePositive(range) ? range : Math.max(0, end);
        double clampedStart = Math.min(Math.max(0, start), maxRange);
        double clampedEnd = Math.min(Math.max(0, end), maxRange);
        if (clampedEnd > clampedStart && minValue != maxValue) {
            double t = Math.max(0, Math.min(1,
                    (distance - clampedStart) / (clampedEnd - clampedStart)));
            return roundCombatValue(maxValue + (minValue - maxValue) * t);
        }
        return roundCombatValue(maxValue);
    }

    private static boolean finitePositive(Double value) {
        return value != null && Double.isFinite(value) && value > 0;
    }


    public record AbilityDefinition(
            int cooldownMs,
            int windupMs,
            int activeMs,
            int durationMs,
            int damage,
            double range,
            double arc,
            int charges,
            int rechargeMs,
            int reuseCooldownMs,
            ResourceModel resourceModel,
            FalloffMode falloffMode,
            AbilityContracts.Falloff falloff,
            DamageOverTime damageOverTime,
            Map<String, Double> stats) {}

    private static double roundCombatValue(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
    /** Damage payload only; status duration and interval belong to STATUS_CATALOG. */
    public record DamageOverTime(int damage) {}
    public record StatusDefinition(int durationMs, int intervalMs) {}
}
