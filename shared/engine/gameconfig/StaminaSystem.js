import { ROTATION_STEP_DEG } from "../modelPayloads/arenaConstants.js";
import { MOVEMENT_CONFIG } from "./MovementConfig.js";
import { abilityStaminaCost } from "./AbilityChannels.js";
import { clearWindup, isWindingUp, preparingRemainingMs } from "./AbilityState.js";
import { botRef, logCombat } from "../ecs/combatLog.js";
import { modifierFor } from "../ecs/contracts/StatusContracts.js";
import { MODIFIER_STATS } from "./vocabulary.js";

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
        sprinting: false,
        fastTurning: false,
    };
}

export function botStamina(shape) {
    const value = shape?.stamina == null ? MOVEMENT_CONFIG.staminaMax : Math.trunc(Number(shape.stamina));
    return Number.isFinite(value) ? Math.max(0, Math.min(MOVEMENT_CONFIG.staminaMax, value)) : MOVEMENT_CONFIG.staminaMax;
}

export function botSprinting(shape) {
    return shape?.sprinting === true;
}

export function botFastTurning(shape) {
    return shape?.fastTurning === true;
}

/**
 * Fast turn needs the drain in stamina; at 0 stamina it simply cannot run until the bot refills. It is
 * judged on the state the previous tick left (what the planner saw), exactly like sprint.
 */
export function canFastTurn(shape) {
    return botStamina(shape) >= staminaCostFor(shape, MOVEMENT_CONFIG.fastTurnDrainPerTick);
}

/** A stamina cost after the bot's staminaCost modifiers (rounded up). Every cost goes through here. */
export function staminaCostFor(shape, baseCost) {
    return Math.ceil(Number(baseCost) * modifierFor(shape, MODIFIER_STATS.STAMINA_COST).multiply);
}

/** Largest turn per tick (before status multipliers) the bot may make: doubled only when a fast turn will really apply. */
export function rotationStepDeg(shape, fastTurn) {
    return ROTATION_STEP_DEG * (fastTurn === true && canFastTurn(shape) ? MOVEMENT_CONFIG.fastTurnMultiplier : 1);
}

/**
 * Start-of-tick timers: the regen pause counts down and, once the pause is over, stamina
 * regenerates. Spending later in the same tick sets the pause fresh, so a spend in tick N gives N+1..N+5
 * of no regeneration and regeneration from N+6. A hit refund (see settleAbilityHits) never touches it.
 */
export function advanceStaminaTimers(shape, elapsedMs) {
    const elapsed = wholeMs(elapsedMs);
    const delay = wholeMs(shape?.staminaRegenDelayMs);
    const stamina = botStamina(shape);
    const regenerates = delay <= 0 && stamina < MOVEMENT_CONFIG.staminaMax;
    if (delay <= 0 && !regenerates) return shape;
    shape.stamina = regenerates ? Math.min(MOVEMENT_CONFIG.staminaMax, stamina + MOVEMENT_CONFIG.regenPerTick) : stamina;
    shape.staminaRegenDelayMs = Math.max(0, delay - elapsed);
    return shape;
}

/** Spends stamina (never below 0) and restarts the regeneration pause. Only a spend does that; a zero cost is no spend. */
export function spendStamina(shape, amount) {
    const before = botStamina(shape);
    const cost = Math.max(0, Math.trunc(Number(amount) || 0));
    if (cost === 0) return shape;
    const stamina = Math.max(0, before - cost);
    if (cost > 0) logCombat("stamina", { target: botRef(shape), effect: "spend", amount: cost });
    shape.stamina = stamina;
    shape.staminaRegenDelayMs = MOVEMENT_CONFIG.regenDelayMs;
    return shape;
}

/** Adds refunded stamina (capped at the maximum) without touching the regeneration pause. */
export function refundStamina(shape, amount) {
    const gain = Math.max(0, Math.trunc(Number(amount) || 0));
    if (gain === 0) return shape;
    logCombat("stamina", { target: botRef(shape), effect: "refund", amount: gain });
    shape.stamina = Math.min(MOVEMENT_CONFIG.staminaMax, botStamina(shape) + gain);
    return shape;
}

/**
 * Time until the bot can afford an ability's stamina cost, assuming no further stamina is spent: what is left
 * of the regeneration pause, then the ticks of regeneration. 0 when the ability costs nothing or is affordable.
 */
export function staminaWaitMs(shape, abilityId) {
    const missing = staminaCostFor(shape, abilityStaminaCost(abilityId)) - botStamina(shape);
    if (missing <= 0) return 0;
    const lockout = wholeMs(shape?.staminaRegenDelayMs);
    return lockout + Math.ceil(missing / MOVEMENT_CONFIG.regenPerTick) * 100;
}

/** Stamina-side readiness: the bot must have enough stamina to pay the ability's cost (0 for most). */
export function abilityStaminaReady(shape, abilityId) {
    return botStamina(shape) >= staminaCostFor(shape, abilityStaminaCost(abilityId));
}

/** Pays the stamina an activation of the ability costs; an ability with no cost leaves stamina and the pause alone. */
export function spendAbilityStamina(shape, abilityId) {
    return spendStamina(shape, staminaCostFor(shape, abilityStaminaCost(abilityId)));
}

export function canCancelWindup(shape) {
    return isWindingUp(shape)
        && preparingRemainingMs(shape) > 0
        && botStamina(shape) >= staminaCostFor(shape, MOVEMENT_CONFIG.windupCancelCost);
}

/** Clears the wind-up without a cooldown or used charge and pays stamina. */
export function cancelWindup(shape) {
    return clearWindup(spendStamina(shape, staminaCostFor(shape, MOVEMENT_CONFIG.windupCancelCost)));
}

export function withFastTurning(shape, fastTurning) {
    if (Boolean(shape?.fastTurning) !== fastTurning) shape.fastTurning = fastTurning;
    return shape;
}

export function withSprinting(shape, sprinting) {
    if (Boolean(shape?.sprinting) !== sprinting) shape.sprinting = sprinting;
    return shape;
}
