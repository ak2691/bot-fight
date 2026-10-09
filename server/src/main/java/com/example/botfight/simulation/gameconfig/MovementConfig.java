package com.example.botfight.simulation.gameconfig;

import java.util.Map;

/**
 * Movement and stamina tuning, read from the shared gameplay data (shared/gameplay/movement.json), which the
 * browser's gameconfig/MovementConfig.js reads too.
 *
 * <p>The simulation ticks every 100 ms. Every {@code *_MS} value is a whole multiple of 100 and every
 * amount is a whole number applied per tick (a per-second rate is {@code perTick * 10}). Stamina is
 * always an integer.
 */
public final class MovementConfig {
    private static final GameplayData.MovementFile DATA = GameplayData.get().movement();
    private static final Map<String, Double> CONFIG = DATA.config();

    public static final int TICK_MS = DATA.tickMs();
    /** Stamina cap; a bot starts every round full. */
    public static final int STAMINA_MAX = whole("staminaMax");
    /** Stamina regained per tick (20 per second) once the regen pause has run out. */
    public static final int REGEN_PER_TICK = whole("regenPerTick");
    /** Time after any stamina spend before regeneration resumes. Only spending starts or restarts it. */
    public static final int REGEN_DELAY_MS = whole("regenDelayMs");
    /**
     * Stamina a bot gains when its weapon or ability lands on an enemy bot, once per activation (capped at
     * {@link #STAMINA_MAX}). Instant and independent of the regen pause: it never starts, ends or restarts it.
     */
    public static final int HIT_STAMINA_REFUND = whole("hitStaminaRefund");
    /** Movement speed factor while sprinting, the same in every direction. */
    public static final double SPRINT_MULTIPLIER = CONFIG.get("sprintMultiplier");
    /** Stamina drained per sprinting tick (30 per second). */
    public static final int SPRINT_DRAIN_PER_TICK = whole("sprintDrainPerTick");
    /** Rotation step factor while a Rotate action is set to fast turn. */
    public static final double FAST_TURN_MULTIPLIER = CONFIG.get("fastTurnMultiplier");
    /** Stamina drained per tick in which a fast turn actually rotates (20 per second). */
    public static final int FAST_TURN_DRAIN_PER_TICK = whole("fastTurnDrainPerTick");
    /** Stamina spent to cancel the bot's own wind-up. */
    public static final int WINDUP_CANCEL_COST = whole("windupCancelCost");

    private MovementConfig() {}

    private static int whole(String key) {
        return (int) Math.round(CONFIG.get(key));
    }
}
