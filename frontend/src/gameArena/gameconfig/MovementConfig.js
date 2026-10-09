/**
 * Movement and stamina tuning, in one place so it is easy to adjust.
 *
 * The simulation ticks every 100 ms. Every `*Ms` value is a whole multiple of 100,
 * and every amount is a whole number applied per 100 ms tick (a per-second rate is
 * `perTick * 10`). Stamina is always an integer. The server reads the same data.
 */
import { GAMEPLAY_DATA } from "./gameplayData.js";
export const MOVEMENT_TICK_MS = GAMEPLAY_DATA.movement.tickMs;

/**
 * The numbers live in shared/gameplay/movement.json:
 *   staminaMax          stamina cap; a bot starts every round full
 *   regenPerTick        stamina regained per tick (20 per second) once regenDelayMs has run out
 *   regenDelayMs        time after any stamina spend before regeneration resumes; only spending restarts it
 *   hitStaminaRefund    stamina gained when a weapon or ability lands on an enemy bot, once per activation
 *                       (capped at staminaMax); instant and independent of the regen pause
 *   sprintMultiplier    movement speed factor while sprinting
 *   sprintDrainPerTick  stamina drained per sprinting tick
 *   fastTurnMultiplier  rotation step factor while a Rotate action is set to fast turn
 *   fastTurnDrainPerTick stamina drained per tick in which a fast turn actually rotates
 *   windupCancelCost    stamina spent to cancel the bot's own wind-up
 */
export const MOVEMENT_CONFIG = GAMEPLAY_DATA.movement.config;
