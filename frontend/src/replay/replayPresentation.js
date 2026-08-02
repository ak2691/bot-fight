export const REPLAY_PREPARATION_MS = 3_000;

export function localReplaySchedule(playbackStartsAtMs, resultRevealsAtMs) {
    const serverStartMs = Number(playbackStartsAtMs);
    const serverRevealMs = Number(resultRevealsAtMs);

    return {
        playbackStartsAtMs: Number.isFinite(serverStartMs) ? serverStartMs : playbackStartsAtMs,
        resultRevealsAtMs: Number.isFinite(serverRevealMs) ? serverRevealMs : resultRevealsAtMs,
    };
}

export function replayElapsedMs(playbackStartsAtMs, nowMs) {
    const startMs = Number(playbackStartsAtMs);
    const currentMs = Number(nowMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(currentMs)) return 0;
    return Math.max(0, currentMs - startMs);
}

export function replayEntranceProgress(playbackStartsAtMs, nowMs, preparationMs = REPLAY_PREPARATION_MS) {
    const startMs = Number(playbackStartsAtMs);
    const currentMs = Number(nowMs);
    const durationMs = Number(preparationMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(currentMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        return 1;
    }
    return Math.max(0, Math.min(1, 1 - Math.max(0, startMs - currentMs) / durationMs));
}

export function replayEntranceX(fighter, progress, arenaWidth = 1_000) {
    const slotOne = Number(fighter?.slot) === 1;
    const size = Number(fighter?.size ?? 60);
    const targetX = Number(fighter?.x ?? 0);
    const outsideX = slotOne ? -size : arenaWidth + size;
    const easedProgress = 1 - Math.pow(1 - Math.max(0, Math.min(1, Number(progress) || 0)), 3);
    return outsideX + (targetX - outsideX) * easedProgress;
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
