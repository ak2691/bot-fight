import { modifierFor } from "../ecs/contracts/StatusContracts.js";
import { MODIFIER_STATS } from "./vocabulary.js";

export const HIT_STAGGER_DURATION_MS = 300;

/** The movement speed factor of the active modifiers (slow and hit-stagger numbers live in statuses.json). */
export function effectiveMovementSpeedMultiplier(shape) {
    return modifierFor(shape, MODIFIER_STATS.MOVE_SPEED).multiply;
}

/** The turn speed factor of the active modifiers. */
export function effectiveRotationSpeedMultiplier(shape) {
    return modifierFor(shape, MODIFIER_STATS.TURN_SPEED).multiply;
}

