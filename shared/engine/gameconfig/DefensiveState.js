/** Central bot interaction policy. Target selection is intentionally separate. */
export function isAliveBot(shape) {
    return Number(shape?.hp ?? 0) > 0;
}

import { hasActiveEffect, statusEffectsFor } from "../ecs/contracts/StatusContracts.js";
import { clearActiveStages } from "./AbilityState.js";

/** Incoming systems must consult this before mutating hostile state. */
export function ignoresHostileEffects(shape) {
    return !isAliveBot(shape) || hasActiveEffect(shape, "damage_immunity");
}

/**
 * A bot that ignores hostile effects still takes an attack's damage when it holds a hit reaction (a parry): its immunity
 * blocks the damage, and the reaction sees the hit. Its other hostile effects stay blocked.
 */
export function reactsToBlockedHits(shape) {
    return isAliveBot(shape) && statusEffectsFor(shape).some((status) => status.on?.hit != null
        && (status.mode === "presence" || status.remainingMs > 0));
}

/**
 * Clears gameplay effects in place when HP crosses to zero while preserving cooldowns and preparation state.
 * Returns the bot.
 */
export function withoutBotStatuses(shape) {
    shape.statusEffects = [];
    clearActiveStages(shape);
    shape.dashRemaining = 0;
    shape.moveAbilityId = null;
    shape.dashInitialDistance = 0;
    shape.dashStepDistance = 0;
    shape.dashDirectionX = 0;
    shape.dashDirectionY = 0;
    shape.dashOriginX = null;
    shape.dashOriginY = null;
    shape.rewindPulseMs = 0;
    shape.abilityVisual = null;
    shape.pendingHealing = 0;
    return shape;
}
