package com.example.botfight.simulation.gameconfig;

/**
 * Movement and stamina tuning, mirrored by the browser's gameconfig/MovementConfig.js.
 *
 * <p>The simulation ticks every 100 ms. Every {@code *_MS} value is a whole multiple of 100 and every
 * amount is a whole number applied per tick (a per-second rate is {@code perTick * 10}). Stamina is
 * always an integer.
 */
public final class MovementConfig {
    public static final int TICK_MS = 100;
    /** Stamina cap; a bot starts every round full. */
    public static final int STAMINA_MAX = 100;
    /** Stamina regained per tick (20 per second) once the regen delay and exhaustion have run out. */
    public static final int REGEN_PER_TICK = 2;
    /** Time after any stamina spend before regeneration resumes. */
    public static final int REGEN_DELAY_MS = 800;
    /** Time with no regeneration after stamina hits 0. There is no movement slowdown. */
    public static final int EXHAUSTION_MS = 1_500;
    /** Movement speed factor while sprinting, the same in every direction. */
    public static final double SPRINT_MULTIPLIER = 1.5;
    /** Stamina drained per sprinting tick (30 per second). */
    public static final int SPRINT_DRAIN_PER_TICK = 3;
    /** Rotation step factor while a Rotate action is set to fast turn. */
    public static final double FAST_TURN_MULTIPLIER = 2.0;
    /** Stamina drained per tick in which a fast turn actually rotates (20 per second). */
    public static final int FAST_TURN_DRAIN_PER_TICK = 2;
    /** Stamina spent by Dash, which has no fixed cooldown. */
    public static final int DASH_COST = 30;
    /** Gap after a Dash starts before the next one can start. */
    public static final int DASH_GAP_MS = 300;
    /** Stamina spent to cancel the bot's own wind-up. */
    public static final int WINDUP_CANCEL_COST = 25;
    public static final int DASH_ABILITY_ID = 19;

    private MovementConfig() {}
}
