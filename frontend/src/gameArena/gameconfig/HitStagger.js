export const HIT_STAGGER_DURATION_MS = 300;
export const HIT_STAGGER_MOVEMENT_MULTIPLIER = 0.85;
export const HIT_STAGGER_ROTATION_MULTIPLIER = 0.85;

export const CONCUSSIVE_SHOT_SLOW_DURATION_MS = 2000;
export const CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER = 0.60;

export function effectiveMovementSpeedMultiplier(shape) {
    return Number(shape?.slowedMs ?? 0) > 0
        ? CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER
        : Number(shape?.hitStaggerMs ?? 0) > 0
            ? HIT_STAGGER_MOVEMENT_MULTIPLIER
            : 1;
}

