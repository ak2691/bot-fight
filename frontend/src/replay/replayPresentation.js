import { STANDARD_ABILITY_IDS } from "../../../shared/engine/loadout/BotLoadout.js";

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
    const explicitTeam = Number(bot?.teamNumber);
    const teamOne = Number.isFinite(explicitTeam)
        ? explicitTeam === 1
        : Number(bot?.slot) === 1;
    const size = Number(bot?.size ?? 60);
    const targetX = Number(bot?.x ?? 0);
    const outsideX = teamOne ? -size : arenaWidth + size;
    const easedProgress = 1 - Math.pow(1 - Math.max(0, Math.min(1, Number(progress) || 0)), 3);
    return outsideX + (targetX - outsideX) * easedProgress;
}

/** Keeps a forfeiting team in the same evenly spaced horizontal formation as a match spawn. */
export function centeredTeamPosition(teamIndex, teamSize, arenaWidth = 1_000, arenaHeight = 1_000) {
    const safeIndex = Math.max(0, Number(teamIndex) || 0);
    const safeSize = Math.max(1, Number(teamSize) || 1);
    return {
        x: Number(arenaWidth) * (safeIndex + 1) / (safeSize + 1),
        y: Number(arenaHeight) / 2,
        rotation: 0,
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

export function replayResultRevealReached(resultRevealsAtMs, nowMs) {
    const revealMs = Number(resultRevealsAtMs);
    if (!Number.isFinite(revealMs)) return true;
    const currentMs = Number(nowMs);
    return Number.isFinite(currentMs) && currentMs >= revealMs;
}

export function replayResultVisibility({
    result,
    hasAuthorizedTerminalFrame = false,
    hasDisplayedFinalFrame = false,
    roundResultRevealReceived = false,
    resultRevealReceived = false,
} = {}) {
    const replayFinished = Boolean(hasAuthorizedTerminalFrame && hasDisplayedFinalFrame);
    const hasRoundResult = Boolean(result)
        && replayFinished
        && (roundResultRevealReceived || resultRevealReceived);
    const hasMatchResult = Boolean(result)
        && replayFinished
        && resultRevealReceived;
    return {
        roundResultRevealed: hasRoundResult,
        matchResultRevealed: hasMatchResult,
    };
}

export function replayRatingChange(playback, resultRevealReceived = false) {
    if (!resultRevealReceived) return null;
    if (playback?.ratingBefore == null || playback?.ratingAfter == null) return null;
    const before = Number(playback?.ratingBefore);
    const after = Number(playback?.ratingAfter);
    if (!Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < 0) {
        return null;
    }
    const delta = after - before;
    return {
        before,
        after,
        delta,
        label: String(before) + " → " + String(after) + " ("
            + (delta >= 0 ? "+" : "") + String(delta) + ")",
    };
}

export function replayRatingChanges(playback, resultRevealReceived = false, fallbackUsername = null) {
    if (!resultRevealReceived) return [];
    const changes = (Array.isArray(playback?.ratingChanges) ? playback.ratingChanges : [])
        .map((change) => {
            const username = String(change?.username ?? "").trim();
            const before = Number(change?.before);
            const after = Number(change?.after);
            if (!username || !Number.isInteger(before) || !Number.isInteger(after)
                || before < 0 || after < 0) return null;
            const delta = after - before;
            return {
                username,
                before,
                after,
                delta,
                label: String(before) + " → " + String(after) + " ("
                    + (delta >= 0 ? "+" : "") + String(delta) + ")",
            };
        })
        .filter(Boolean);
    if (changes.length > 0) return changes;

    const currentPlayerChange = replayRatingChange(playback, true);
    return currentPlayerChange && String(fallbackUsername ?? "").trim()
        ? [{ username: String(fallbackUsername).trim(), ...currentPlayerChange }]
        : [];
}

export function replayRemainingSeconds(durationMs, elapsedMs) {
    const duration = Number(durationMs);
    const elapsed = Number(elapsedMs);
    if (!Number.isFinite(duration) || !Number.isFinite(elapsed)) return 0;
    return Math.max(0, Math.ceil((duration - Math.max(0, elapsed)) / 1000));
}

export function replayRemainingMs(durationMs, activationElapsedMs, currentElapsedMs) {
    const duration = Number(durationMs);
    const activation = Number(activationElapsedMs);
    const current = Number(currentElapsedMs);
    if (![duration, activation, current].every(Number.isFinite)) return 0;
    return Math.max(0, duration - (current - activation));
}

export function replayAbilitiesFor(abilities) {
    const standardAbilities = new Set(STANDARD_ABILITY_IDS);
    const selected = [...new Set(Array.isArray(abilities) ? abilities : [])]
        .filter((abilityId) => !standardAbilities.has(abilityId));
    return [...STANDARD_ABILITY_IDS, ...selected];
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

    const framesByElapsed = new Map();
    for (const frame of [...currentFrames, ...incomingFrames]) {
        const elapsedMs = Number(frame?.elapsedMs);
        if (Number.isFinite(elapsedMs) && !framesByElapsed.has(elapsedMs)) {
            framesByElapsed.set(elapsedMs, frame);
        }
    }
    return [...framesByElapsed.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, frame]) => frame);
}

/** Compact authoritative bots are identified by their stable match slot. */
export function replayShapeKey(shape) {
    const slot = shape?.slot;
    if (slot != null) return `slot:${slot}`;
    const userId = shape?.userId;
    if (userId != null) return `user:${userId}`;
    const id = shape?.id;
    if (id != null) return `id:${id}`;
    return null;
}

/** Matches recent replay damage against the current shapes in one indexed pass. */
export function replayDamageEvents(bots, entities, recentFrames = []) {
    const currentShapesByKey = new Map();
    for (const shape of [...bots, ...entities]) {
        const key = replayShapeKey(shape);
        if (key != null && !currentShapesByKey.has(key)) currentShapesByKey.set(key, shape);
    }

    const damageEvents = new Map();
    for (const frame of recentFrames) {
        for (const previous of replayFrameShapes(frame)) {
            const previousKey = replayShapeKey(previous);
            const current = previousKey == null ? null : currentShapesByKey.get(previousKey);
            if (current && Number(current.hp ?? 0) < Number(previous.hp ?? 0)) {
                damageEvents.set(previousKey, `${Number(frame.elapsedMs ?? 0)}:${previousKey}`);
            }
        }
    }
    return damageEvents;
}

/**
 * Interpolates only presentation positions between authoritative frames.
 * Rotation, gameplay state, timers, HP, and effects remain sourced from the
 * current authoritative frame.
 */
export function interpolateReplayFrame(frame, nextFrame, elapsedMs) {
    if (!frame || !nextFrame) return frame;
    const currentElapsedMs = Number(frame.elapsedMs);
    const nextElapsedMs = Number(nextFrame.elapsedMs);
    const durationMs = nextElapsedMs - currentElapsedMs;
    if (!Number.isFinite(currentElapsedMs) || !Number.isFinite(nextElapsedMs) || durationMs <= 0) return frame;
    const alpha = Math.max(0, Math.min(1, (Number(elapsedMs) - currentElapsedMs) / durationMs));
    if (alpha <= 0) return frame;
    return {
        ...frame,
        ...(frame.shapes ? { shapes: interpolateFrameShapes(frame.shapes, nextFrame.shapes, replayShapeKey, alpha) } : {}),
        bots: interpolateFrameShapes(frame.bots, nextFrame.bots, replayParticipantKey, alpha),
        entities: interpolateFrameShapes(frame.entities, nextFrame.entities, (entity) => `id:${entity?.id}`, alpha),
    };
}

function interpolateFrameShapes(shapes, nextShapes, keyFor, alpha) {
    const nextByKey = new Map((nextShapes ?? []).map((shape) => [keyFor(shape), shape]));
    return (shapes ?? []).map((shape) => {
        const next = nextByKey.get(keyFor(shape));
        if (!next) return shape;
        return {
            ...shape,
            x: interpolateNumber(shape.x, next.x, alpha),
            y: interpolateNumber(shape.y, next.y, alpha),
        };
    });
}

export function initialReplayHandoffFrame(initialState, firstFrame, elapsedMs) {
    if (initialState?.shapes) return interpolateReplayFrame({ elapsedMs: 0, shapes: initialState.shapes }, firstFrame, elapsedMs);
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
            };
        }),
        entities: initialState?.entities ?? [],
    };
}

function replayParticipantKey(bot) {
    if (bot?.slot != null) return `slot:${bot.slot}`;
    if (bot?.userId != null) return `user:${bot.userId}`;
    return `id:${bot?.id}`;
}

function interpolateNumber(from, to, alpha) {
    const start = Number(from) || 0;
    const end = Number(to);
    return start + ((Number.isFinite(end) ? end : start) - start) * alpha;
}

function clampedRoundWins(value) {
    return Math.max(0, Math.min(3, Number(value) || 0));
}

/** Engine frames already contain the complete practice-room render state. */
export function replayFrameShapes(frame) {
    return frame?.shapes ?? [...(frame?.bots ?? []), ...(frame?.entities ?? [])];
}
export function replayFrameBots(frame) {
    return replayFrameShapes(frame).filter((shape) => shape.kind === "bot" || shape.slot != null);
}
export function replayFrameEntities(frame) {
    return replayFrameShapes(frame).filter((shape) => shape.kind !== "bot" && shape.slot == null);
}
