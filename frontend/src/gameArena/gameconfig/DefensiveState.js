/** Central bot interaction policy. Target selection is intentionally separate. */
export function isAliveBot(shape) {
    return Number(shape?.hp ?? 0) > 0;
}

export function isProjectileHittable(shape) {
    return isAliveBot(shape) && shape?.projectileHittable !== false;
}

import { clearPresenceStatuses, statusIsActive } from "../ecs/contracts/StatusContracts.js";

/** Incoming systems must consult this before mutating hostile state. */
export function ignoresHostileEffects(shape) {
    return !isAliveBot(shape) || statusIsActive(shape, "absolute-guard");
}

/** Clears gameplay effects when HP crosses to zero while preserving cooldowns and preparation state. */
export function withoutBotStatuses(shape) {
    return {
        ...clearPresenceStatuses({ ...shape, statusEffects: [] }),
        dashActiveMs: 0,
        dashRemaining: 0,
        dashTrailMs: 0,
        dashInitialDistance: 0,
        dashStepDistance: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        dashOriginX: null,
        dashOriginY: null,
        abilityActiveMs: {},
        temporalRewindMs: 0,
        temporalRewindPulseMs: 0,
        temporalRewindX: null,
        temporalRewindY: null,
        temporalRewindHp: null,
        temporalRewindVisualX: null,
        temporalRewindVisualY: null,
        abilityVisual: null,
        pendingHealing: 0,
    };
}
