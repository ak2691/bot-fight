import { ROTATION_STEP_DEG } from "../modelPayloads/arenaConstants.js";
import { DASH_ABILITY_ID, MOVEMENT_CONFIG } from "./MovementConfig.js";

/**
 * Pure stamina helpers shared by action execution, ability readiness and the
 * logic state payload. Shapes without stamina fields behave as a full, idle bot,
 * so older shapes keep working and are only rewritten once stamina is used.
 */

function wholeMs(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 0;
}

export function initialMovementState() {
    return {
        stamina: MOVEMENT_CONFIG.staminaMax,
        staminaRegenDelayMs: 0,
        exhaustedMs: 0,
        sprinting: false,
        fastTurning: false,
        dashGapMs: 0,
    };
}

export function botStamina(shape) {
    const value = shape?.stamina == null ? MOVEMENT_CONFIG.staminaMax : Math.trunc(Number(shape.stamina));
    return Number.isFinite(value) ? Math.max(0, Math.min(MOVEMENT_CONFIG.staminaMax, value)) : MOVEMENT_CONFIG.staminaMax;
}

export function botExhausted(shape) {
    // Compact server replay frames carry a plain `exhausted` flag instead of the timer.
    return wholeMs(shape?.exhaustedMs) > 0 || shape?.exhausted === true;
}

export function botSprinting(shape) {
    return shape?.sprinting === true;
}

export function botFastTurning(shape) {
    return shape?.fastTurning === true;
}

/**
 * Fast turn needs the drain in stamina and no exhaustion. It is judged on the state the previous
 * tick left (what the planner saw), exactly like sprint.
 */
export function canFastTurn(shape) {
    return botStamina(shape) >= MOVEMENT_CONFIG.fastTurnDrainPerTick && !botExhausted(shape);
}

/** Largest turn per tick (before status multipliers) the bot may make: doubled only when a fast turn will really apply. */
export function rotationStepDeg(shape, fastTurn) {
    return ROTATION_STEP_DEG * (fastTurn === true && canFastTurn(shape) ? MOVEMENT_CONFIG.fastTurnMultiplier : 1);
}

/**
 * Start-of-tick timers: lockouts count down and, once both are over, stamina regenerates.
 * Spending later in the same tick sets the lockouts fresh, so a spend in tick N gives
 * N+1..N+8 of no regeneration and regeneration from N+9.
 */
export function advanceStaminaTimers(shape, elapsedMs) {
    const elapsed = wholeMs(elapsedMs);
    const delay = wholeMs(shape?.staminaRegenDelayMs);
    const exhausted = wholeMs(shape?.exhaustedMs);
    const dashGap = wholeMs(shape?.dashGapMs);
    const stamina = botStamina(shape);
    const regenerates = delay <= 0 && exhausted <= 0 && stamina < MOVEMENT_CONFIG.staminaMax;
    if (delay <= 0 && exhausted <= 0 && dashGap <= 0 && !regenerates) return shape;
    return {
        ...shape,
        stamina: regenerates ? Math.min(MOVEMENT_CONFIG.staminaMax, stamina + MOVEMENT_CONFIG.regenPerTick) : stamina,
        staminaRegenDelayMs: Math.max(0, delay - elapsed),
        exhaustedMs: Math.max(0, exhausted - elapsed),
        dashGapMs: Math.max(0, dashGap - elapsed),
    };
}

/** Spends stamina (never below 0), restarts the regeneration delay and starts exhaustion at 0. */
export function spendStamina(shape, amount) {
    const before = botStamina(shape);
    const stamina = Math.max(0, before - Math.max(0, Math.trunc(Number(amount) || 0)));
    return {
        ...shape,
        stamina,
        staminaRegenDelayMs: MOVEMENT_CONFIG.regenDelayMs,
        exhaustedMs: stamina === 0 && before > 0 ? MOVEMENT_CONFIG.exhaustionMs : wholeMs(shape?.exhaustedMs),
    };
}

export function dashReady(shape) {
    return botStamina(shape) >= MOVEMENT_CONFIG.dashCost && wholeMs(shape?.dashGapMs) <= 0;
}

/** Time until Dash can start again, assuming no further stamina is spent. */
export function dashWaitMs(shape) {
    const gap = wholeMs(shape?.dashGapMs);
    const missing = MOVEMENT_CONFIG.dashCost - botStamina(shape);
    if (missing <= 0) return gap;
    const lockout = Math.max(wholeMs(shape?.staminaRegenDelayMs), wholeMs(shape?.exhaustedMs));
    const regenMs = Math.ceil(missing / MOVEMENT_CONFIG.regenPerTick) * 100;
    return Math.max(gap, lockout + regenMs);
}

/** Dash pays stamina and starts its gap instead of a cooldown. */
export function spendDash(shape) {
    return { ...spendStamina(shape, MOVEMENT_CONFIG.dashCost), dashGapMs: MOVEMENT_CONFIG.dashGapMs };
}

/** Stamina-side readiness: only Dash is gated, on stamina and its gap. */
export function abilityStaminaReady(shape, abilityId) {
    return Number(abilityId) !== DASH_ABILITY_ID || dashReady(shape);
}

export function canCancelWindup(shape) {
    return shape?.preparingAbility != null
        && wholeMs(shape?.preparingMs) > 0
        && botStamina(shape) >= MOVEMENT_CONFIG.windupCancelCost;
}

/** Clears the wind-up without a cooldown or used charge and pays stamina. */
export function cancelWindup(shape) {
    const paid = spendStamina(shape, MOVEMENT_CONFIG.windupCancelCost);
    return {
        ...paid,
        preparingAbility: null,
        preparingMs: 0,
        preparingTargetX: null,
        preparingTargetY: null,
    };
}

export function withFastTurning(shape, fastTurning) {
    return Boolean(shape?.fastTurning) === fastTurning ? shape : { ...shape, fastTurning };
}

export function withSprinting(shape, sprinting) {
    return Boolean(shape?.sprinting) === sprinting ? shape : { ...shape, sprinting };
}
