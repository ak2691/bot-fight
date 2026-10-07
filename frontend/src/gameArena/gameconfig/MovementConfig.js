/**
 * Movement and stamina tuning, in one place so it is easy to adjust.
 *
 * The simulation ticks every 100 ms. Every `*Ms` value is a whole multiple of 100,
 * and every amount is a whole number applied per 100 ms tick (a per-second rate is
 * `perTick * 10`). Stamina is always an integer. The server mirrors these numbers.
 */
export const MOVEMENT_TICK_MS = 100;

export const MOVEMENT_CONFIG = Object.freeze({
    /** Stamina cap; a bot starts every round full. */
    staminaMax: 100,
    /** Stamina regained per tick (20 per second) once regenDelayMs has run out. */
    regenPerTick: 2,
    /** Time after any stamina spend before regeneration resumes. Only spending starts or restarts it. */
    regenDelayMs: 500,
    /**
     * Stamina a bot gains when its weapon or ability lands on an enemy bot, once per activation (capped at
     * staminaMax). It is instant and independent of the regen pause: it never starts, ends or restarts it.
     */
    hitStaminaRefund: 10,
    /** Movement speed factor while sprinting, the same in every direction. */
    sprintMultiplier: 1.5,
    /** Stamina drained per sprinting tick (30 per second). */
    sprintDrainPerTick: 3,
    /** Rotation step factor while a Rotate action is set to fast turn. */
    fastTurnMultiplier: 2,
    /** Stamina drained per tick in which a fast turn actually rotates (20 per second). */
    fastTurnDrainPerTick: 2,
    /** Stamina spent by Dash, which no longer has a fixed cooldown. */
    dashCost: 30,
    /** Gap after a Dash starts before the next one can start. */
    dashGapMs: 300,
    /** Stamina spent to cancel the bot's own wind-up. */
    windupCancelCost: 25,
});

export const DASH_ABILITY_ID = 19;
