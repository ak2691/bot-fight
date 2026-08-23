export function isTerminalMatchEvent(event) {
    return event?.type === "MATCH_RESULT_READY";
}

export function shouldShowDisconnectNotice({
    event,
    terminalMatch,
    eventServerNowMs,
    resetAtMs = 0,
}) {
    return !terminalMatch
        && event?.disconnectedUserId != null
        && event?.disconnectEndsAtMs != null
        && eventServerNowMs >= resetAtMs;
}
