const LIFECYCLE_COMPONENTS = Object.freeze([
    Object.freeze({ field: "matchElapsedMs", mode: "accumulate", maximum: 99_999_000 }),
    Object.freeze({ field: "hitFlashMs", mode: "countdown" }),
    Object.freeze({ field: "abilityVisual", mode: "nestedCountdown", timerField: "ms" }),
    Object.freeze({ field: "triggeredAbility", mode: "reset", value: null }),
    Object.freeze({ field: "abilitySpawn", mode: "reset", value: null }),
    Object.freeze({ field: "entityHitIds", mode: "reset", value: [] }),
    Object.freeze({ field: "damageTakenThisTick", mode: "reset", value: 0 }),
]);

const DEAD_COMPONENTS = Object.freeze({
    dashActiveMs: 0,
    dashRemaining: 0,
    movementVelocityX: 0,
    movementVelocityY: 0,
    velocityX: 0,
    velocityY: 0,
});

/** Advances bot lifecycle/presentation fields and clears per-tick transient state. */
export function tickBotLifecycle(shape, elapsedMs) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const updates = Object.fromEntries(LIFECYCLE_COMPONENTS.map((component) => [
        component.field,
        advanceLifecycleComponent(shape, component, elapsed),
    ]));
    const next = { ...shape, ...updates };
    return Number(next.hp ?? 0) > 0
        ? next
        : { ...next, ...DEAD_COMPONENTS };
}

function advanceLifecycleComponent(shape, component, elapsedMs) {
    const value = shape?.[component.field];
    if (component.mode === "accumulate") {
        return Math.min(component.maximum, Math.max(0, Number(value ?? 0) + elapsedMs));
    }
    if (component.mode === "countdown") {
        return Math.max(0, Number(value ?? 0) - elapsedMs);
    }
    if (component.mode === "nestedCountdown") {
        return value ? { ...value, [component.timerField]: Math.max(0, Number(value[component.timerField] ?? 0) - elapsedMs) } : null;
    }
    return Array.isArray(component.value) ? [...component.value] : component.value;
}
