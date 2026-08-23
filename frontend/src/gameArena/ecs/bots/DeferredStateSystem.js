import { DEFERRED_STATE_CONTRACTS } from "../contracts/DeferredStateContracts.js";

/** Advances every registered delayed state transition for one bot tick. */
export function tickDeferredStates(shape, elapsedMs) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    return DEFERRED_STATE_CONTRACTS.reduce(
        (next, contract) => advanceDeferredState(next, contract, elapsed),
        shape,
    );
}

/** Applies one declarative delayed-state contract. Exported for focused contract tests. */
export function advanceDeferredState(shape, contract, elapsedMs) {
    const remainingBefore = Math.max(0, Number(shape?.[contract.remainingField] ?? 0));
    const remainingMs = Math.max(0, remainingBefore - elapsedMs);
    const completes = remainingBefore > 0 && remainingMs <= 0;
    const completionVisualMs = advanceCompletionVisual(shape, contract, elapsedMs, completes);
    const completion = completes ? resolveCompletion(shape, contract.completion) : {};
    const snapshot = completes ? clearedFields(contract.snapshotFields) : {};
    const presentation = completionVisualFields(shape, contract.completionVisualFields, remainingMs, completionVisualMs);

    return {
        ...shape,
        ...completion,
        [contract.remainingField]: remainingMs,
        ...completionVisualFieldsFor(contract, completionVisualMs),
        ...snapshot,
        ...presentation,
    };
}

function advanceCompletionVisual(shape, contract, elapsedMs, completes) {
    if (!contract.completionVisual) return 0;
    return completes
        ? Math.max(0, Number(contract.completionVisual.durationMs ?? 0))
        : Math.max(0, Number(shape?.[contract.completionVisual.timerField] ?? 0) - elapsedMs);
}

function completionVisualFieldsFor(contract, remainingMs) {
    return contract.completionVisual
        ? { [contract.completionVisual.timerField]: remainingMs }
        : {};
}

function resolveCompletion(shape, completion) {
    if (!completion || completion.type !== "restoreSnapshot") return {};

    const coordinates = Object.fromEntries(Object.entries(completion.coordinates ?? {}).map(([targetField, snapshotField]) => [
        targetField,
        Number(shape?.[snapshotField] ?? shape?.[targetField] ?? 0),
    ]));
    const health = completion.health;
    if (!health) return coordinates;

    const maximum = Number(shape?.[health.maximumField] ?? Number.POSITIVE_INFINITY);
    const snapshotHp = Number(shape?.[health.snapshotField] ?? shape?.[health.fallbackField] ?? 0);
    return {
        ...coordinates,
        [health.targetField]: Math.min(maximum, snapshotHp),
    };
}

function clearedFields(fields = []) {
    return Object.fromEntries(fields.map((field) => [field, null]));
}

function completionVisualFields(shape, fields = [], remainingMs, completionVisualMs) {
    const active = remainingMs > 0 || completionVisualMs > 0;
    return Object.fromEntries(fields.map((field) => [field, active ? shape?.[field] ?? null : null]));
}
