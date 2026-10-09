/** Central bot interaction policy. Target selection is intentionally separate. */
export function isAliveBot(shape) {
    return Number(shape?.hp ?? 0) > 0;
}

export function isProjectileHittable(shape) {
    return isAliveBot(shape) && shape?.projectileHittable !== false;
}

import { statusIsActive } from "../ecs/contracts/StatusContracts.js";
import { clearActiveStages } from "./AbilityState.js";

/** Incoming systems must consult this before mutating hostile state. */
export function ignoresHostileEffects(shape) {
    return !isAliveBot(shape) || statusIsActive(shape, "absolute-guard");
}

/**
 * Clears gameplay effects in place when HP crosses to zero while preserving cooldowns and preparation state.
 * Returns the bot.
 */
export function withoutBotStatuses(shape) {
    shape.statusEffects = [];
    clearActiveStages(shape);
    shape.dashRemaining = 0;
    shape.dashTrailMs = 0;
    shape.dashInitialDistance = 0;
    shape.dashStepDistance = 0;
    shape.dashDirectionX = 0;
    shape.dashDirectionY = 0;
    shape.dashOriginX = null;
    shape.dashOriginY = null;
    shape.temporalRewindMs = 0;
    shape.temporalRewindPulseMs = 0;
    shape.temporalRewindX = null;
    shape.temporalRewindY = null;
    shape.temporalRewindHp = null;
    shape.temporalRewindVisualX = null;
    shape.temporalRewindVisualY = null;
    shape.abilityVisual = null;
    shape.pendingHealing = 0;
    return shape;
}
