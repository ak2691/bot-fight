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

export function replayEntranceX(bot, progress, arenaWidth = 1_000) {
    const slotOne = Number(bot?.slot) === 1;
    const size = Number(bot?.size ?? 60);
    const targetX = Number(bot?.x ?? 0);
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

export function replayRemainingMs(durationMs, activationElapsedMs, currentElapsedMs) {
    const duration = Number(durationMs);
    const activation = Number(activationElapsedMs);
    const current = Number(currentElapsedMs);
    if (![duration, activation, current].every(Number.isFinite)) return 0;
    return Math.max(0, duration - (current - activation));
}

/** Replay consumes the same organized ability timers emitted by simulation. */
export function replayBotAbilityState(bot) {
    const abilityActiveMs = canonicalAbilityTimerMap(bot?.abilityActiveMs);
    return {
        abilityActiveMs,
        microDashActiveMs: Math.max(0, Number(bot?.microDashActiveMs ?? abilityActiveMs[19] ?? 0)),
    };
}

function canonicalAbilityTimerMap(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([rawId, timer]) => [abilityId(Number(rawId)), Math.max(0, Number(timer) || 0)])
        .filter(([id]) => id != null));
}

export function replayFrameIndexForElapsedMs(frames, elapsedMs, stepMs = 100) {
    if (!frames.length) return 0;
    const firstElapsedMs = Number(frames[0]?.elapsedMs ?? 0);
    const fixedStepMs = Math.max(1, Number(stepMs) || 100);
    const elapsedSinceFirstFrame = Math.max(0, Number(elapsedMs) - firstElapsedMs);
    return Math.min(
        frames.length - 1,
        Math.floor(elapsedSinceFirstFrame / fixedStepMs),
    );
}

export function mergeReplayFrames(currentFrames = [], incomingFrames = []) {
    if (!incomingFrames.length) return currentFrames;
    if (!currentFrames.length) return [...incomingFrames];

    const lastCurrentElapsedMs = Number(currentFrames.at(-1)?.elapsedMs ?? 0);
    const newFrames = incomingFrames.filter((frame) => Number(frame?.elapsedMs) > lastCurrentElapsedMs);
    return newFrames.length ? [...currentFrames, ...newFrames] : currentFrames;
}

export function initialReplayHandoffFrame(initialState, firstFrame, elapsedMs) {
    const firstElapsedMs = Number(firstFrame?.elapsedMs);
    if (!Number.isFinite(firstElapsedMs) || firstElapsedMs <= 0) return firstFrame ?? null;
    const alpha = Math.max(0, Math.min(1, Number(elapsedMs) / firstElapsedMs));
    const nextBots = new Map((firstFrame?.bots ?? []).map((bot) => [replayParticipantKey(bot), bot]));
    return {
        elapsedMs: Math.max(0, Number(elapsedMs) || 0),
        bots: (initialState?.bots ?? []).map((bot) => {
            const next = nextBots.get(replayParticipantKey(bot));
            if (!next) return bot;
            return {
                ...bot,
                x: interpolateNumber(bot.x, next.x, alpha),
                y: interpolateNumber(bot.y, next.y, alpha),
                rotation: interpolateDegrees(bot.rotation, next.rotation, alpha),
            };
        }),
        entities: initialState?.entities ?? [],
    };
}

function replayParticipantKey(bot) {
    if (bot?.userId != null) return `user:${bot.userId}`;
    if (bot?.slot != null) return `slot:${bot.slot}`;
    return `id:${bot?.id}`;
}

function interpolateNumber(from, to, alpha) {
    const start = Number(from) || 0;
    const end = Number(to);
    return start + ((Number.isFinite(end) ? end : start) - start) * alpha;
}

function interpolateDegrees(from, to, alpha) {
    const start = Number(from) || 0;
    const end = Number.isFinite(Number(to)) ? Number(to) : start;
    const delta = ((end - start + 540) % 360) - 180;
    return start + delta * alpha;
}

function clampedRoundWins(value) {
    return Math.max(0, Math.min(3, Number(value) || 0));
}
import { abilityId } from "../gameArena/gameconfig/AbilityRegistry.js";
