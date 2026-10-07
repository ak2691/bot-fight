/** How long the submit button must be held, in ms, before it fires. */
export const HOLD_TO_SUBMIT_MS = 600;

/** Fill fraction (0 to 1) of a hold that began `startedAtMs` ago. */
export function holdProgress(startedAtMs, nowMs, holdMs = HOLD_TO_SUBMIT_MS) {
    if (startedAtMs == null) return 0;
    return Math.max(0, Math.min(1, (Number(nowMs) - Number(startedAtMs)) / holdMs));
}

/** The first reason a brain cannot be submitted, or null when it can. */
export function submitBlockedReason(validation) {
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];
    return errors.length > 0 ? String(errors[0]) : null;
}
