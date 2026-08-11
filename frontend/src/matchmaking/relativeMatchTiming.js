export const LOADOUT_SELECTION_VISIBLE_GRACE_MS = 2_000;

export function relativeLocalDeadlineMs({
    deadlineServerTime,
    serverTransmitTime,
    localReceiveTimeMs,
    estimatedOneWayDelayMs = 0,
    visibleGraceMs = 0,
} = {}) {
    const deadlineServerMs = deadlineServerTime ? new Date(deadlineServerTime).getTime() : null;
    const serverTransmitMs = serverTransmitTime ? new Date(serverTransmitTime).getTime() : null;
    const localReceiveMs = Number(localReceiveTimeMs);
    if (!Number.isFinite(deadlineServerMs)
        || !Number.isFinite(serverTransmitMs)
        || !Number.isFinite(localReceiveMs)) {
        return null;
    }
    const oneWayDelayMs = Number.isFinite(Number(estimatedOneWayDelayMs))
        ? Math.max(0, Number(estimatedOneWayDelayMs))
        : 0;
    const graceMs = Number.isFinite(Number(visibleGraceMs))
        ? Math.max(0, Number(visibleGraceMs))
        : 0;
    return localReceiveMs
        + (deadlineServerMs - serverTransmitMs)
        - oneWayDelayMs
        - graceMs;
}

export function visibleLoadoutSelectionDeadlineMs(
    localAuthoritativeDeadlineMs,
    estimatedOneWayDelayMs = 0,
) {
    if (localAuthoritativeDeadlineMs == null) return localAuthoritativeDeadlineMs;
    const oneWayDelayMs = Number(estimatedOneWayDelayMs);
    return Number(localAuthoritativeDeadlineMs)
        + (Number.isFinite(oneWayDelayMs) ? Math.max(0, oneWayDelayMs) : 0)
        - LOADOUT_SELECTION_VISIBLE_GRACE_MS;
}
