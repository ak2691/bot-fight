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
