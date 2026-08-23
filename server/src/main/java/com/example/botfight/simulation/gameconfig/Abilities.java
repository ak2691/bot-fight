package com.example.botfight.simulation.gameconfig;

import java.util.List;
import java.util.Map;

/** Authoritative numeric definitions for every duel-v1 ability. */
public final class Abilities {
    private Abilities() {}

    public enum ActivationModel { IMMEDIATE, CHANNELLED, CONFIGURED }
    public enum ResourceModel { NONE, REGENERATE, RELOAD_WHEN_EMPTY, FIXED, HP }
    public enum FalloffMode { CONTINUOUS }

    // activeMs is the browser's effective post-activation action lock. The
    // browser falls back to max(300, durationMs/visualMs) when it omits the
    // field, so those resolved values are stored explicitly here. cooldownMs
    // is the recovery phase after activeMs.
    public static final Map<Integer, AbilityDefinition> CATALOG = Map.ofEntries(
            Map.entry(1, new AbilityDefinition(600, 0, 400, 0, 20, 92, 120,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(3, new AbilityDefinition(1_000, 0, 500, 0, 0, 700, 0,
                    6, 5_000, 0, ActivationModel.IMMEDIATE, ResourceModel.RELOAD_WHEN_EMPTY,
                    FalloffMode.CONTINUOUS,
                    linearFalloff(15, 2, 100, 700), null, Map.of())),
            Map.entry(4, new AbilityDefinition(12_000, 0, 1, 0, 0, 70, 0,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    linearFalloff(40, 25, 0, 64), null,
                    Map.of("size", 12.0, "speed", 32.0, "deceleration", 1.6,
                            "throwRange", 336.0,
                            "fuseMs", 1_000.0, "explosionVisibleMs", 200.0))),
            Map.entry(5, new AbilityDefinition(
                    300, 0, 500, 1_200, 15, fixedStepRange(36, 1_200), 0, 4, 5_000, 0,
                    ActivationModel.IMMEDIATE, ResourceModel.RELOAD_WHEN_EMPTY, FalloffMode.CONTINUOUS,
                    List.of(), new DamageOverTime(2), Map.of("size", 30.0, "speed", 36.0))),
            Map.entry(6, new AbilityDefinition(9_600, 400, 1_200, 1_200, 5, 184, 100,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(7, new AbilityDefinition(4_600, 300, 400, 0, 30, 115, 150,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(8, new AbilityDefinition(10_000, 0, 500, 0, 20, 110, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(9, new AbilityDefinition(6_700, 500, 300, 0, 20, 500, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(10, new AbilityDefinition(11_700, 800, 300, 0, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(11, new AbilityDefinition(10_000, 0, 300, 20_800, 20, 87.5, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(new DamageAnchor(0, 20)), null,
                    Map.of("size", 24.0, "speed", 22.0, "throwRange", 176.0,
                            "triggerRadius", 87.5, "explosionVisibleMs", 300.0))),
            Map.entry(12, new AbilityDefinition(400, 0, 300, 0, 0, 500, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    linearFalloff(8, 4, 0, 333.33), null, Map.of())),
            Map.entry(13, new AbilityDefinition(10_700, 900, 300, 0, 40, 900, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("movementLockMs", 300.0))),
            Map.entry(14, new AbilityDefinition(11_000, 0, 2_000, 7_000, 0, 120, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    linearFalloff(35, 20, 0, 90), null,
                     Map.of("zoneSize", 240.0, "speed", 22.0,
                            "pullPerTick", 6.0, "explosionVisibleMs", 300.0))),
            Map.entry(15, new AbilityDefinition(10_000, 1_000, 2_000, 1_200, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("projectileSize", 225.0, "speed", 150.0))),
            Map.entry(16, new AbilityDefinition(9_000, 500, 0, 4_000, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(17, new AbilityDefinition(8_000, 0, 300, 6_000, 3, 200, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("size", 28.0, "moveSpeed", 4.5,
                            "range", 200.0, "shotCooldownMs", 1_000.0, "shotVisualMs", 300.0, "hp", 50.0))),
            Map.entry(18, new AbilityDefinition(7_000, 300, 500, 500, 15, fixedStepRange(44, 500), 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("size", 24.0, "speed", 44.0, "range", 220.0))),
            Map.entry(19, new AbilityDefinition(1_300, 0, 200, 200, 0, 150, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE,
                    FalloffMode.CONTINUOUS, List.of(), null,
                    Map.of("distance", 150.0, "stepDistance", 75.0, "activeMs", 200.0, "trailMs", 300.0))),
            Map.entry(20, new AbilityDefinition(9_800, 200, 200, 0, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(21, new AbilityDefinition(18_000, 0, 300, 3_100, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("delayMs", 3_000.0, "intervalMs", 400.0, "zoneSize", 90.0))),
            Map.entry(22, new AbilityDefinition(18_000, 500, 0, 1_500, 15, 130, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null,
                    Map.of("markerSize", 260.0, "intervalMs", 500.0,
                            "explosionVisibleMs", 400.0, "radius", 130.0))),
            Map.entry(23, new AbilityDefinition(15_500, 500, 0, 1_500, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(24, new AbilityDefinition(13_000, 1_500, 300, 5_000, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                     List.of(), null, Map.of("radius", 150.0, "zoneSize", 300.0))),
            Map.entry(25, new AbilityDefinition(1_500, 0, 300, 0, 14, 100, 90,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("passThroughDistance", 50.0))),
            Map.entry(26, new AbilityDefinition(8_700, 0, 300, 0, 10, 120, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("knockback", 60.0))),
            Map.entry(27, new AbilityDefinition(18_000, 0, 300, 1_300, 0, 140, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    linearFalloff(35, 15, 0, 140), null,
                    Map.of("zoneSize", 280.0, "pullPerTick", 10.0, "explosionVisibleMs", 400.0))),
            Map.entry(28, new AbilityDefinition(7_700, 300, 300, 1_100, 10, fixedStepRange(42, 1_100), 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("pullPerTick", 100.0,
                            "size", 18.0, "speed", 42.0))),
            Map.entry(29, new AbilityDefinition(10_000, 0, 300, 16_000, 15, 75, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("interruptMs", 150.0,
                            "triggerRadius", 75.0, "size", 24.0, "hp", 20.0,
                            "explosionVisibleMs", 300.0))),
            Map.entry(30, new AbilityDefinition(8_000, 300, 300, 0, 15, 600, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("interruptMs", 250.0))),
            Map.entry(31, new AbilityDefinition(9_000, 0, 300, 6_000, 2, 200, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("hp", 50.0, "size", 28.0,
                            "moveSpeed", 4.5, "range", 200.0, "shotCooldownMs", 1_000.0,
                            "shotVisualMs", 300.0, "turnStepDegrees", 8.0, "knockback", 35.0))),
            Map.entry(32, new AbilityDefinition(10_000, 300, 300, 0, 0, 500, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    linearFalloff(25, 15, 0, 500), null,
                    Map.of("maxDamage", 25.0, "minDamage", 15.0,
                            "damageFalloffStart", 0.0, "damageFalloffEnd", 500.0))),
            Map.entry(33, new AbilityDefinition(12_000, 500, 0, 4_000, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("cooldownRecoveryPercent", 50.0,
                    "cooldownRecoveryMultiplier", 0.5, "visualMs", 300.0))),
            Map.entry(34, new AbilityDefinition(500, 0, 200, 0, 5, 80, 60,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of()))
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
    public static double arcDegrees(int id) { return definition(id).arcDegrees(); }
    public static boolean isImmediateActivation(int id) {
        return definition(id).activationModel() == ActivationModel.IMMEDIATE;
    }
    public static int projectileSize(int id) { return (int) stat(id, "size", 0); }
    public static double projectileSpeed(int id) { return stat(id, "speed", 0); }
    public static double projectileDecelerationPerTick(int id) { return stat(id, "deceleration", 0); }
    public static int projectileFuseMs(int id) { return (int) stat(id, "fuseMs", 0); }
    public static int projectileVisualMs(int id) { return (int) stat(id, "explosionVisibleMs", 0); }
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

    private static List<DamageAnchor> linearFalloff(int maxDamage, int minDamage,
                                                     double startDistance, double endDistance) {
        return List.of(new DamageAnchor(startDistance, maxDamage), new DamageAnchor(endDistance, minDamage));
    }

    private static double fixedStepRange(double displacementPerTick, double durationMs) {
        return displacementPerTick * durationMs / 100.0;
    }

    public static double damageAtDistance(int id, double distance) {
        AbilityDefinition ability = definition(id);
        List<DamageAnchor> values = ability.damageFalloff();
        if (values.isEmpty()) return ability.damage();
        if (!Double.isFinite(distance) || distance > ability.range()) return 0;
        if (distance <= values.getFirst().distance()) return values.getFirst().damage();
        if (distance >= values.getLast().distance()) return values.getLast().damage();
        for (int index = 1; index < values.size(); index++) {
            DamageAnchor near = values.get(index - 1);
            DamageAnchor far = values.get(index);
            if (distance <= far.distance()) {
                double t = (distance - near.distance()) / (far.distance() - near.distance());
                return roundCombatValue(near.damage() + (far.damage() - near.damage()) * t);
            }
        }
        return 0;
    }


    public record AbilityDefinition(
            int cooldownMs,
            int windupMs,
            int activeMs,
            int durationMs,
            int damage,
            double range,
            double arcDegrees,
            int charges,
            int rechargeMs,
            int reuseCooldownMs,
            ActivationModel activationModel,
            ResourceModel resourceModel,
            FalloffMode falloffMode,
            List<DamageAnchor> damageFalloff,
            DamageOverTime damageOverTime,
            Map<String, Double> stats) {}

    public record DamageAnchor(double distance, double damage) {}

    private static double roundCombatValue(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
    /** Damage payload only; status duration and interval belong to STATUS_CATALOG. */
    public record DamageOverTime(int damage) {}
    public record StatusDefinition(int durationMs, int intervalMs) {}
}
