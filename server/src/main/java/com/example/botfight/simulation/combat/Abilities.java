package com.example.botfight.simulation.combat;

import java.util.Map;

/** Authoritative definitions for cooldown abilities used by duel-v1. */
public final class Abilities {
    private Abilities() {}

    public static final Map<String, AbilityDefinition> CATALOG = Map.of(
            "throw_grenade", new AbilityDefinition(12_000, 0, 0, 0, 70, 0),
            "stun", new AbilityDefinition(10_000, 400, 5, 1_200, 184, 100));

    public static AbilityDefinition definition(String id) {
        AbilityDefinition definition = CATALOG.get(id);
        if (definition == null) throw new IllegalArgumentException("unknown ability: " + id);
        return definition;
    }

    public record AbilityDefinition(
            int cooldownMs,
            int windupMs,
            int damage,
            int durationMs,
            double range,
            double arcDegrees) {}
}
