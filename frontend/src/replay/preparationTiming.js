import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";

export function roundSecondsToQuarter(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return null;
    return Math.max(0, Math.round(Number(seconds) * 4) / 4);
}

export function phaseDeadlineTimingForEvent(
    event,
    deadlineServerField,
    deadlineLocalField,
    nowMs = monotonicEpochNowMs(),
    estimatedOneWayDelayMs = 0,
) {
    const deadlineServerTime = event?.[deadlineServerField] ?? null;
    const deadlineServerMs = deadlineServerTime
        ? new Date(deadlineServerTime).getTime()
        : null;
    const serverNowMs = event?.serverNow
        ? new Date(event.serverNow).getTime()
        : null;
    const deadlineLocalCandidate = event?.[deadlineLocalField];
    const deadlineLocalMs = deadlineLocalCandidate != null
        && Number.isFinite(Number(deadlineLocalCandidate))
        ? Number(deadlineLocalCandidate)
        : null;
    const numericOneWayDelayMs = Number(estimatedOneWayDelayMs);
    const serverIntervalMs = Number.isFinite(deadlineServerMs)
        && Number.isFinite(serverNowMs)
        ? deadlineServerMs - serverNowMs
        : null;
    const signedSecondsRemaining = Number.isFinite(deadlineLocalMs)
        ? (deadlineLocalMs - Number(nowMs)) / 1000
        : null;

    return {
        matchId: event?.matchId ?? null,
        roundNumber: event?.roundNumber ?? null,
        serverNow: event?.serverNow ?? null,
        localNowMs: Number(nowMs),
        estimatedOneWayDelayMs: Number.isFinite(numericOneWayDelayMs) ? numericOneWayDelayMs : 0,
        serverIntervalMs,
        serverIntervalSeconds: serverIntervalMs == null ? null : serverIntervalMs / 1000,
        deadlineServerField,
        deadlineServerTime,
        deadlineServerMs,
        deadlineLocalField,
        deadlineLocalMs,
        signedSecondsRemaining,
        secondsRemaining: roundSecondsToQuarter(signedSecondsRemaining),
    };
}

export function preparationTimingForEvent(event, nowMs = monotonicEpochNowMs(), estimatedOneWayDelayMs = 0) {
    const endsAtServerMs = event?.playbackStartsAt
        ? new Date(event.playbackStartsAt).getTime()
        : null;
    const serverNowMs = event?.serverNow
        ? new Date(event.serverNow).getTime()
        : null;
    const endsAtLocalMs = event?.playbackStartsAtMs != null
        && Number.isFinite(Number(event.playbackStartsAtMs))
        ? Number(event.playbackStartsAtMs)
        : Number.isFinite(Number(event?.simulationPreparingDurationMs))
            ? Number(nowMs) + Math.max(
                0,
                Number(event.simulationPreparingDurationMs)
                    - Math.max(0, Number(estimatedOneWayDelayMs) || 0),
            )
            : endsAtServerMs;
    const serverIntervalMs = Number.isFinite(endsAtServerMs)
        && Number.isFinite(serverNowMs)
        ? endsAtServerMs - serverNowMs
        : null;
    const rawSecondsRemaining = Number.isFinite(endsAtLocalMs)
        ? Math.max(0, (endsAtLocalMs - Number(nowMs)) / 1000)
        : null;
    const numericOneWayDelayMs = Number(estimatedOneWayDelayMs);

    return {
        matchId: event?.matchId ?? null,
        roundNumber: event?.roundNumber ?? null,
        serverNow: event?.serverNow ?? null,
        localNowMs: Number(nowMs),
        estimatedOneWayDelayMs: Number.isFinite(numericOneWayDelayMs) ? numericOneWayDelayMs : 0,
        serverIntervalMs,
        serverIntervalSeconds: serverIntervalMs == null ? null : serverIntervalMs / 1000,
        preparingEndsAtServerTime: event?.playbackStartsAt ?? null,
        preparingEndsAtServerMs: endsAtServerMs,
        rawSecondsRemaining,
        secondsRemaining: roundSecondsToQuarter(rawSecondsRemaining),
    };
}
