package com.example.botfight.simulation.combat;

import java.util.List;
import java.util.Map;

/** Authoritative definitions for repeatable duel-v1 moves. */
public final class Moves {
    private Moves() {}

    public static final Map<String, MoveDefinition> CATALOG = Map.of(
            "swing", new MoveDefinition(1_000, 400, 20, 92, 50, 0, 0, List.of(), null),
            "block", new MoveDefinition(0, 0, 0, 0, 0, 5, 5_000, List.of(), null),
            "dash", new MoveDefinition(4_500, 1_000, 0, 400, 0, 0, 0, List.of(), null),
            "fire_gun", new MoveDefinition(1_000, 1_000, 0, 700, 0, 10, 3_000,
                    List.of(new DamageAnchor(100, 15), new DamageAnchor(300, 10), new DamageAnchor(500, 5), new DamageAnchor(700, 2)), null),
            "shoot_fireball", new MoveDefinition((int) Math.round(60_000.0 / 90.0), (int) Math.round(60_000.0 / 90.0), 15, 400, 0, 4, 3_000, List.of(), new DamageOverTime(2, 1_000, 5_000)));

    public static MoveDefinition definition(String id) {
        MoveDefinition definition = CATALOG.get(id);
        if (definition == null) throw new IllegalArgumentException("unknown move: " + id);
        return definition;
    }

    public record MoveDefinition(
            int cooldownMs,
            int activeMs,
            int damage,
            double range,
            double arcDegrees,
            int charges,
            int rechargeMs,
            List<DamageAnchor> damageFalloff,
            DamageOverTime damageOverTime) {}

    public record DamageAnchor(double distance, int damage) {}
    public record DamageOverTime(int damage, int tickMs, int durationMs) {}
}
