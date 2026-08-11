package com.example.botfight.simulation.gameconfig;

import java.util.List;
import java.util.Map;

/** Authoritative numeric definitions for every duel-v1 ability. */
public final class Abilities {
    private Abilities() {}

    public enum ActivationModel { IMMEDIATE, CHANNELLED, CONFIGURED }
    public enum ResourceModel { NONE, REGENERATE, RELOAD_WHEN_EMPTY }
    public enum FalloffMode { CONTINUOUS, STEPPED }

    public static final Map<Integer, AbilityDefinition> CATALOG = Map.ofEntries(
            Map.entry(1, new AbilityDefinition(1_000, 0, 400, 400, 20, 92, 120,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(2, new AbilityDefinition(0, 0, 0, 0, 0, 0, 180,
                    5, 5_000, 2_000, ActivationModel.CHANNELLED, ResourceModel.REGENERATE,
                    FalloffMode.CONTINUOUS, List.of(), null, Map.of("shield", 1.0))),
            Map.entry(3, new AbilityDefinition(1_000, 0, 1_000, 1_000, 0, 700, 0,
                    10, 3_000, 0, ActivationModel.IMMEDIATE, ResourceModel.RELOAD_WHEN_EMPTY,
                    FalloffMode.CONTINUOUS,
                    List.of(new DamageAnchor(100, 15), new DamageAnchor(300, 10),
                            new DamageAnchor(500, 5), new DamageAnchor(700, 2)), null, Map.of())),
            Map.entry(4, new AbilityDefinition(12_000, 0, 0, 100, 0, 70, 0,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.STEPPED,
                    List.of(new DamageAnchor(0, 50), new DamageAnchor(8, 45),
                            new DamageAnchor(22, 40), new DamageAnchor(36, 35),
                            new DamageAnchor(50, 30), new DamageAnchor(64, 25)), null,
                    Map.of("size", 12.0, "speed", 32.0, "deceleration", 1.6,
                            "fuseMs", 1_000.0, "explosionVisibleMs", 200.0))),
            Map.entry(5, new AbilityDefinition(
                    (int) Math.round(60_000.0 / 90.0), 0, (int) Math.round(60_000.0 / 90.0),
                    (int) Math.round(60_000.0 / 90.0), 15, 400, 0, 4, 3_000, 0,
                    ActivationModel.IMMEDIATE, ResourceModel.RELOAD_WHEN_EMPTY, FalloffMode.CONTINUOUS,
                    List.of(), new DamageOverTime(2, 1_000, 5_000), Map.of("size", 30.0, "speed", 36.0))),
            Map.entry(6, new AbilityDefinition(10_000, 400, 0, 1_200, 5, 184, 100,
                    0, 0, 0, ActivationModel.IMMEDIATE, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(7, new AbilityDefinition(5_000, 300, 400, 400, 30, 115, 150,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("bleedTickMs", 1_000.0))),
            Map.entry(8, new AbilityDefinition(8_000, 0, 500, 500, 20, 110, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(9, new AbilityDefinition(7_000, 500, 300, 300, 8, 500, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(10, new AbilityDefinition(12_000, 800, 300, 300, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(11, new AbilityDefinition(10_000, 0, 0, 0, 18, 87.5, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.STEPPED,
                    List.of(new DamageAnchor(0, 18)), null,
                    Map.of("size", 24.0, "speed", 22.0, "triggerRadius", 87.5,
                            "lifetimeMs", 20_000.0, "explosionVisibleMs", 300.0))),
            Map.entry(12, new AbilityDefinition(700, 0, 300, 300, 0, 500, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.STEPPED,
                    List.of(new DamageAnchor(0, 8), new DamageAnchor(166.67, 6),
                            new DamageAnchor(333.33, 4)), null, Map.of())),
            Map.entry(13, new AbilityDefinition(11_000, 900, 300, 300, 40, 900, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("shockTickMs", 1_000.0, "movementLockMs", 300.0))),
            Map.entry(14, new AbilityDefinition(13_000, 0, 2_000, 2_000, 0, 120, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.STEPPED,
                    List.of(new DamageAnchor(0, 35), new DamageAnchor(30, 30),
                            new DamageAnchor(60, 25), new DamageAnchor(90, 20)), null,
                    Map.of("fieldSize", 240.0, "speed", 22.0, "travelDistance", 176.0,
                            "fuseMs", 3_900.0, "lifetimeMs", 4_000.0, "explosionVisibleMs", 300.0))),
            Map.entry(15, new AbilityDefinition(12_000, 1_000, 2_000, 2_000, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("projectileSize", 225.0, "speed", 150.0, "lifetimeMs", 10_000.0))),
            Map.entry(16, new AbilityDefinition(13_000, 0, 4_000, 4_000, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(17, new AbilityDefinition(14_000, 0, 6_000, 6_000, 3, 200, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("size", 28.0, "durationMs", 6_000.0, "moveSpeed", 4.5,
                            "range", 200.0, "shotCooldownMs", 1_000.0, "shotVisualMs", 300.0, "hp", 50.0))),
            Map.entry(18, new AbilityDefinition(7_000, 1_000, 500, 500, 15, 220, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("size", 24.0, "speed", 44.0, "range", 220.0))),
            Map.entry(19, new AbilityDefinition(1_500, 0, 200, 200, 0, 150, 0,
                    1, 1_500, 0, ActivationModel.CONFIGURED, ResourceModel.REGENERATE,
                    FalloffMode.CONTINUOUS, List.of(), null,
                    Map.of("distance", 150.0, "stepDistance", 75.0, "activeMs", 200.0, "trailMs", 300.0))),
            Map.entry(20, new AbilityDefinition(10_000, 200, 200, 200, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(21, new AbilityDefinition(18_000, 0, 0, 0, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("delayMs", 3_000.0, "pulseMs", 400.0, "zoneSize", 90.0))),
            Map.entry(22, new AbilityDefinition(18_000, 0, 0, 0, 0, 130, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(new DamageAnchor(0, 50), new DamageAnchor(130, 13)), null,
                    Map.of("markerSize", 260.0, "delayMs", 1_500.0,
                            "explosionVisibleMs", 400.0, "radius", 130.0))),
            Map.entry(23, new AbilityDefinition(17_000, 0, 1_500, 1_500, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of())),
            Map.entry(24, new AbilityDefinition(18_000, 1_500, 5_000, 5_000, 0, 0, 0,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("radius", 150.0, "fieldSize", 300.0, "lifetimeMs", 5_400.0))),
            Map.entry(25, new AbilityDefinition(1_800, 0, 300, 300, 14, 100, 90,
                    0, 0, 0, ActivationModel.CONFIGURED, ResourceModel.NONE, FalloffMode.CONTINUOUS,
                    List.of(), null, Map.of("passThroughDistance", 50.0)))
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

    public static int damageAtDistance(int id, double distance) {
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
                if (ability.falloffMode() == FalloffMode.STEPPED) return near.damage();
                double t = (distance - near.distance()) / (far.distance() - near.distance());
                return (int) Math.round(near.damage() + (far.damage() - near.damage()) * t);
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

    public record DamageAnchor(double distance, int damage) {}
    public record DamageOverTime(int damage, int tickMs, int durationMs) {}
}
