export const REPLAY_COUNTDOWN_MS = 3_000;

export function localReplaySchedule(playbackStartsAtMs, resultRevealsAtMs, receivedAtMs = Date.now()) {
    const serverStartMs = Number(playbackStartsAtMs);
    const localStartMs = Math.max(
        Number.isFinite(serverStartMs) ? serverStartMs : 0,
        Number(receivedAtMs) + REPLAY_COUNTDOWN_MS,
    );
    const shiftMs = Number.isFinite(serverStartMs) ? localStartMs - serverStartMs : 0;
    const serverRevealMs = Number(resultRevealsAtMs);

    return {
        playbackStartsAtMs: localStartMs,
        resultRevealsAtMs: Number.isFinite(serverRevealMs) ? serverRevealMs + shiftMs : resultRevealsAtMs,
    };
}

export function displayedRoundWins(participant, roundWinsBeforeResult, revealCurrentRoundPoint) {
    const wins = clampedRoundWins(participant?.roundWins);
    if (revealCurrentRoundPoint || participant?.userId == null) return wins;
    const previousWins = roundWinsBeforeResult?.[String(participant.userId)];
    return previousWins == null ? wins : clampedRoundWins(previousWins);
}

export function replayClockSeconds(frame, hasPlaybackStarted = true) {
    if (!hasPlaybackStarted) return 0;
    return Math.max(0, Math.floor((Number(frame?.elapsedMs) || 0) / 1000));
}

function clampedRoundWins(value) {
    return Math.max(0, Math.min(3, Number(value) || 0));
}
