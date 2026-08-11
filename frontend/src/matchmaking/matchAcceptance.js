export const MATCH_ACCEPTANCE_VISIBLE_DURATION_MS = 20_000;
export const MATCH_ACCEPTANCE_SUBMISSION_GRACE_MS = 2_000;

const ACCEPTANCE_EVENT_TYPES = new Set([
    "MATCH_FOUND",
    "MATCH_ACCEPTED",
    "MATCH_ACCEPTANCE_EXPIRED",
    "MATCH_ACCEPTANCE_CANCELLED",
]);

export function isMatchAcceptanceEvent(event) {
    return ACCEPTANCE_EVENT_TYPES.has(event?.type) && event?.status === "MATCH_ACCEPT";
}

/**
 * Keep acceptance state deliberately smaller than the general match event.
 * The pending match ID is an opaque, server-authorized acceptance token; no
 * participant DTO is part of this client-side representation.
 */
export function acceptanceEventForClient(event) {
    if (!isMatchAcceptanceEvent(event)) return event;
    return {
        type: event.type,
        matchId: event.matchId ?? null,
        status: "MATCH_ACCEPT",
        serverNow: event.serverNow ?? null,
        matchAcceptanceEndsAt: event.matchAcceptanceEndsAt ?? null,
        matchAcceptanceEndsAtMs: event.matchAcceptanceEndsAtMs ?? null,
        matchAcceptanceAuthoritativeEndsAtMs: event.matchAcceptanceAuthoritativeEndsAtMs ?? null,
        acceptedByMe: event.acceptedByMe === true,
        otherPlayerAccepted: event.otherPlayerAccepted === true,
        message: event.message ?? null,
    };
}

export function acceptanceStateForEvent(event) {
    return event?.acceptedByMe === true ? "WAITING" : "READY";
}

export function acceptanceVisibleStartMs(deadlineMs) {
    const numericDeadline = Number(deadlineMs);
    return Number.isFinite(numericDeadline)
        ? numericDeadline - MATCH_ACCEPTANCE_VISIBLE_DURATION_MS
        : null;
}

export function acceptanceProgressFraction({
    nowMs,
    deadlineMs,
    visibleStartMs,
} = {}) {
    const now = Number(nowMs);
    const deadline = Number(deadlineMs);
    const start = Number(visibleStartMs);
    if (!Number.isFinite(now) || !Number.isFinite(deadline) || !Number.isFinite(start)) {
        return 0;
    }
    const duration = deadline - start;
    if (duration <= 0) return now < deadline ? 1 : 0;
    return Math.max(0, Math.min(1, (deadline - now) / duration));
}

export function acceptanceAnnouncementRemaining(remaining) {
    const seconds = Math.max(0, Math.ceil(Number(remaining) || 0));
    if (seconds <= 5) return seconds;
    return Math.ceil(seconds / 5) * 5;
}
