import { decodeBotLoadout, STANDARD_ABILITY_IDS } from "../gameArena/loadout/BotLoadout.js";
import { BASE_BOT_HP } from "../gameArena/modelPayloads/arenaConstants.js";
import { COMBAT_VISUAL_ABILITY_IDS, combatVisualDurationMs } from "../gameArena/gameconfig/visualState.js";

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

/** Replay consumes the same organized ability timers emitted by simulation. */
export function replayBotAbilityState(bot) {
    const abilityActiveMs = canonicalAbilityTimerMap(bot?.abilityActiveMs);
    return {
        abilityActiveMs,
        dashActiveMs: Math.max(0, Number(bot?.dashActiveMs ?? abilityActiveMs[19] ?? 0)),
    };
}

/** Recreates the Bot Room's transient direct-ability visual from its trigger. */
export function replayAbilityVisual(bot, frames = [], frameIndex = 0) {
    if (!frames.length) return null;
    const currentIndex = Math.min(Math.max(0, Number(frameIndex) || 0), frames.length - 1);
    const currentElapsedMs = Number(frames[currentIndex]?.elapsedMs);
    if (!Number.isFinite(currentElapsedMs)) return null;

    for (let index = currentIndex; index >= 0; index -= 1) {
        const candidate = replayBotAtFrame(frames[index], bot);
        const ability = Number(candidate?.triggeredAbility);
        if (!COMBAT_VISUAL_ABILITY_IDS.includes(ability)) continue;

        const activationElapsedMs = Number(frames[index]?.elapsedMs);
        if (!Number.isFinite(activationElapsedMs)) return null;
        const remainingMs = replayRemainingMs(
            combatVisualDurationMs(ability),
            activationElapsedMs,
            currentElapsedMs,
        );
        if (remainingMs <= 0) return null;

        return {
            ability,
            ms: remainingMs,
            x: finiteValue(candidate?.visualOriginX, candidate?.x, bot?.x),
            y: finiteValue(candidate?.visualOriginY, candidate?.y, bot?.y),
            rotation: finiteValue(candidate?.visualOriginRotation, candidate?.rotation, bot?.rotation, 0),
        };
    }
    return null;
}

/** Carries a lock-on target through the active frames after its one-tick trigger. */
export function replayAbilityTarget(bot, frames = [], frameIndex = 0) {
    if (Number(bot?.abilityActiveMs?.[20] ?? 0) <= 0) return {};
    const currentIndex = Math.min(Math.max(0, Number(frameIndex) || 0), Math.max(0, frames.length - 1));
    for (let index = currentIndex; index >= 0; index -= 1) {
        const candidate = replayBotAtFrame(frames[index], bot);
        if (Number(candidate?.triggeredAbility) !== 20) continue;
        const x = Number(candidate?.abilityTargetX);
        const y = Number(candidate?.abilityTargetY);
        if (Number.isFinite(x) && Number.isFinite(y)) return { abilityTargetX: x, abilityTargetY: y };
    }
    const x = Number(bot?.abilityTargetX);
    const y = Number(bot?.abilityTargetY);
    return Number.isFinite(x) && Number.isFinite(y)
        ? { abilityTargetX: x, abilityTargetY: y }
        : {};
}

/** Rehydrates compact slot-based replay state with one-time match metadata. */
export function hydrateReplayBot(bot, staticBot = null, participant = null) {
    const source = bot ?? {};
    const initial = staticBot ?? {};
    const loadout = participant?.selectedLoadout
        ?? source.combatLoadout
        ?? initial.combatLoadout
        ?? "custom:";
    const abilityCooldowns = source.abilityCooldowns ?? {};
    const configuredAbilities = source.abilities
        ?? initial.abilities
        ?? decodeBotLoadout(loadout).abilities;
    const abilities = replayAbilitiesFor(configuredAbilities);

    return {
        ...initial,
        ...source,
        userId: source.userId ?? initial.userId ?? participant?.userId,
        username: source.username ?? initial.username ?? participant?.username,
        slot: source.slot ?? initial.slot ?? participant?.slot,
        teamNumber: source.teamNumber ?? initial.teamNumber ?? participant?.teamNumber,
        maxHp: source.maxHp ?? initial.maxHp ?? BASE_BOT_HP,
        combatLoadout: loadout,
        abilities,
        abilityCooldowns,
        abilityActiveMs: source.abilityActiveMs ?? {},
        abilityCharges: source.abilityCharges ?? {},
        abilityRechargeMs: source.abilityRechargeMs ?? {},
    };
}

export function replayAbilitiesFor(abilities) {
    const standardAbilities = new Set(STANDARD_ABILITY_IDS);
    const selected = [...new Set(Array.isArray(abilities) ? abilities : [])]
        .filter((abilityId) => !standardAbilities.has(abilityId));
    return [...STANDARD_ABILITY_IDS, ...selected];
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
    if (shape?.slot != null) return `slot:${shape.slot}`;
    if (shape?.userId != null) return `user:${shape.userId}`;
    if (shape?.id != null) return `id:${shape.id}`;
    return null;
}

/** Keeps a replayed gun ray at the position and facing where that shot began. */
export function replayRayOrigin(bot, frames = [], frameIndex = 0) {
    if (Number(bot?.abilityActiveMs?.[3] ?? 0) > 0) {
        const activationBot = replayGunActivationBot(bot, frames, frameIndex);
        return {
            gunRayOriginX: finiteValue(activationBot?.visualOriginX, activationBot?.gunRayOriginX, activationBot?.x, bot.x),
            gunRayOriginY: finiteValue(activationBot?.visualOriginY, activationBot?.gunRayOriginY, activationBot?.y, bot.y),
            gunRayRotation: finiteValue(activationBot?.visualOriginRotation, activationBot?.gunRayRotation, activationBot?.rotation, bot.rotation, 0),
            replayGunActiveMs: Number(bot.abilityActiveMs[3]),
        };
    }
    const ability = Number(bot?.abilityActiveMs?.[12] ?? 0) > 0 ? 12
        : Number(bot?.abilityActiveMs?.[9] ?? 0) > 0 ? 9
            : Number(bot?.abilityActiveMs?.[13] ?? 0) > 0 ? 13
                : Number(bot?.abilityActiveMs?.[8] ?? 0) > 0 ? 8 : null;
    if (!ability) return {};
    return {
        visualOriginX: Number(bot.x),
        visualOriginY: Number(bot.y),
        visualOriginRotation: Number(bot.rotation ?? 0),
    };
}

function replayGunActivationBot(bot, frames, frameIndex) {
    const currentIndex = Math.min(Math.max(0, Number(frameIndex) || 0), Math.max(0, frames.length - 1));
    for (let index = currentIndex; index >= 0; index -= 1) {
        const candidate = replayBotAtFrame(frames[index], bot);
        if (Number(candidate?.triggeredAbility) === 3) return candidate;
    }
    let activationBot = replayBotAtFrame(frames[currentIndex], bot) ?? bot;
    for (let index = currentIndex; index > 0; index -= 1) {
        const current = replayBotAtFrame(frames[index], bot) ?? activationBot;
        const previous = replayBotAtFrame(frames[index - 1], bot);
        if (!previous || Number(previous.abilityActiveMs?.[3] ?? 0) <= 0) break;
        // The active timer stays positive across the whole shot, and the next
        // shot can begin as soon as its cooldown expires. A timer reset marks
        // a new shot even when there is no inactive frame between them.
        if (replayTimerReset(current, previous, 3)) break;
        activationBot = previous;
    }
    return activationBot;
}

function replayTimerReset(current, previous, abilityId) {
    const activeNow = Number(current?.abilityActiveMs?.[abilityId] ?? 0);
    const activeBefore = Number(previous?.abilityActiveMs?.[abilityId] ?? 0);
    const cooldownNow = Number(current?.abilityCooldowns?.[abilityId] ?? 0);
    const cooldownBefore = Number(previous?.abilityCooldowns?.[abilityId] ?? 0);
    return activeNow > activeBefore || cooldownNow > cooldownBefore;
}

function replayBotAtFrame(frame, bot) {
    const key = replayShapeKey(bot);
    return (frame?.bots ?? []).find((candidate) => replayShapeKey(candidate) === key) ?? null;
}

function finiteValue(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return 0;
}

/**
 * Interpolates only presentation transforms between authoritative frames.
 * Gameplay state, timers, HP, and effects remain sourced from the current
 * authoritative frame.
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
            rotation: interpolateDegrees(shape.rotation, next.rotation, alpha),
        };
    });
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
    if (bot?.slot != null) return `slot:${bot.slot}`;
    if (bot?.userId != null) return `user:${bot.userId}`;
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
