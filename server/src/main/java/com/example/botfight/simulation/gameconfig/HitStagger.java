package com.example.botfight.simulation.gameconfig;

/** Shared cross-runtime tuning for the universal successful-damage stagger. */
public final class HitStagger {
    private HitStagger() {}

    public static final int DURATION_MS = 300;
    public static final double MOVEMENT_MULTIPLIER = 0.85;
    public static final double ROTATION_MULTIPLIER = 0.85;

    // The slow status (shared/gameplay/statuses.json) is x0.5 movement and rotation.
    private static final GameplayData.StatusEffectData SLOW_MODIFIER = GameplayData.get().statuses().statuses()
            .get("slow").effects().stream()
            .filter(effect -> "movement_modifier".equals(effect.type())).findFirst().orElseThrow();
    public static final double CONCUSSIVE_MOVEMENT_MULTIPLIER = SLOW_MODIFIER.movementMultiplier();
    public static final double CONCUSSIVE_ROTATION_MULTIPLIER = SLOW_MODIFIER.rotationMultiplier();
}
