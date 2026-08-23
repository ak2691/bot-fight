import { statusEffectFor, statusEffectValue, statusIsActive, STATUS_EFFECT_APPLICATIONS } from "../ecs/contracts/StatusContracts.js";

export const HIT_STAGGER_DURATION_MS = 300;
export const HIT_STAGGER_MOVEMENT_MULTIPLIER = 0.85;
export const HIT_STAGGER_ROTATION_MULTIPLIER = 0.85;

export const CONCUSSIVE_SHOT_SLOW_DURATION_MS = 1000;
export const CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER = 0.50;
export const CONCUSSIVE_ROTATION_MULTIPLIER = 0.50;

export function effectiveMovementSpeedMultiplier(shape) {
    if (statusIsActive(shape, "slow") && statusEffectFor(shape, "slow")?.effects
        ?.some((effect) => effect.type === STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER)) {
        return statusEffectValue(shape, "slow", STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER, "movementMultiplier", CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER);
    }
    return statusIsActive(shape, "hit-stagger")
        ? statusEffectValue(shape, "hit-stagger", STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER,
            "movementMultiplier", HIT_STAGGER_MOVEMENT_MULTIPLIER)
        : 1;
}

export function effectiveRotationSpeedMultiplier(shape) {
    if (statusIsActive(shape, "slow") && statusEffectFor(shape, "slow")?.effects
        ?.some((effect) => effect.type === STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER)) {
        return statusEffectValue(shape, "slow", STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER, "rotationMultiplier", CONCUSSIVE_ROTATION_MULTIPLIER);
    }
    return statusIsActive(shape, "hit-stagger")
        ? statusEffectValue(shape, "hit-stagger", STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER,
            "rotationMultiplier", HIT_STAGGER_ROTATION_MULTIPLIER)
        : 1;
}

