package com.example.botfight.simulation.gameconfig;

/** Shared cross-runtime tuning for the universal successful-damage stagger. */
public final class HitStagger {
    private HitStagger() {}

    public static final int DURATION_MS = 300;
    public static final double MOVEMENT_MULTIPLIER = 0.85;
    public static final double ROTATION_MULTIPLIER = 0.85;

    public static final int CONCUSSIVE_SLOW_DURATION_MS = 1_000;
    public static final double CONCUSSIVE_MOVEMENT_MULTIPLIER = 0.50;
    public static final double CONCUSSIVE_ROTATION_MULTIPLIER = 0.50;
}
