import { useEffect, useState } from "react";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import PixiCanvas from "../beta/PixiCanvas";
import { PROJECTILE_WALL_LENGTH, PROJECTILE_WALL_TYPE } from "../beta/ArenaObjects";
import { decodeBotLoadout, encodeBotLoadout } from "../beta/loadout/BotLoadout";
import { AUTO_STEP_MS, DEFENSE_WALL_TYPE, ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../beta/modelPayloads/arenaConstants";
import { GUN_RANGE, MOVE_STATS } from "../beta/combat/Moves.js";
import { fighterColorRole, replayProjectileVelocity } from "../beta/pixi/pixiVisualState.js";
import { compassDegreesToRadians } from "../logic/arenaAngles.js";
import MatchToolIcon from "../beta/MatchToolIcon.jsx";
import { displayedRoundWins, replayClockSeconds, replayElapsedMs, replayEntranceProgress, replayEntranceX } from "./replayPresentation.js";

const REPLAY_FRAME_INTERPOLATION_MS = AUTO_STEP_MS;
const EMPTY_PLAYBACK = Object.freeze({
    frames: [],
    initialState: { fighters: [], obstacles: [] },
    players: [],
});

export default function SimulationReplay({ playback: playbackInput, preloadShapes = [] }) {
    const playback = playbackInput ?? EMPTY_PLAYBACK;
    const frames = playback.frames ?? [];
    const viewer = playback.player ?? null;
    const opponent = playback.opponent ?? null;
    const participants = playback.players?.length ? playback.players : [viewer, opponent].filter(Boolean);
    const playbackStartMs = playback.playbackStartsAtMs
        ?? (playback.playbackStartsAt ? new Date(playback.playbackStartsAt).getTime() : null);
    const [nowMs, setNowMs] = useState(() => monotonicEpochNowMs());
    const elapsedPlaybackMs = playbackStartMs == null ? 0 : replayElapsedMs(playbackStartMs, nowMs);
    const countdownRemainingMs = playbackStartMs == null ? 0 : Math.max(0, playbackStartMs - nowMs);
    const entranceProgress = replayEntranceProgress(playbackStartMs, nowMs);
    const finalElapsedMs = frames.length === 0 ? 0 : frames[frames.length - 1].elapsedMs ?? 0;
    const displayElapsedMs = frames.length === 0 ? 0 : Math.min(elapsedPlaybackMs, finalElapsedMs);
    const frameIndex = frames.length === 0 ? 0 : frameIndexForElapsedMs(frames, displayElapsedMs);
    const activeFrame = frames[Math.min(frameIndex, Math.max(frames.length - 1, 0))];
    const initialFighters = playback.initialState?.fighters ?? [];
    const replayFighters = countdownRemainingMs > 0 ? initialFighters : activeFrame?.fighters ?? initialFighters;
    const isForfeitResult = playback.result === "RESIGNATION_WIN" || playback.result === "DISCONNECTION_WIN";
    const winnerParticipant = participants.find((participant) => sameId(participant?.userId, playback.winnerUserId));
    const fighters = isForfeitResult && replayFighters.length === 0
        ? winnerParticipant ? [forfeitWinnerFighter(winnerParticipant)] : []
        : replayFighters;
    const obstacles = isForfeitResult ? [] : countdownRemainingMs > 0
        ? playback.initialState?.obstacles ?? []
        : activeFrame?.obstacles ?? playback.initialState?.obstacles ?? [];
    const winner = [...fighters, ...initialFighters, ...participants]
        .find((fighter) => sameId(fighter?.userId, playback.winnerUserId));
    const winnerName = winner?.username ?? "A fighter";
    const finalWinner = activeFrame?.fighters?.find((fighter) => sameId(fighter?.userId, playback.winnerUserId));
    const winnerHp = finalWinner?.hp == null ? null : Math.max(0, Math.round(finalWinner.hp));
    const hasPlaybackStarted = countdownRemainingMs <= 0;
    const hasDisplayedFinalFrame = hasPlaybackStarted && (frames.length === 0
        || elapsedPlaybackMs >= finalElapsedMs);
    const hasAuthorizedTerminalFrame = playback.batchSequence == null || playback.terminalBatch;
    const hasReachedReplayEnd = hasAuthorizedTerminalFrame && hasDisplayedFinalFrame;
    const shouldRevealResult = Boolean(playback.result)
        && hasAuthorizedTerminalFrame
        && hasDisplayedFinalFrame;
    const winnerColorRole = fighterColorRole(winner);
    const resultTitle = replayResultTitle({
        shouldRevealResult,
        hasReachedReplayEnd,
        result: playback.result,
        winnerName,
        winnerHp,
        winnerColorRole,
    });
    const replaySeconds = replayClockSeconds(activeFrame, hasPlaybackStarted);

    useEffect(() => {
        let animationFrameId = null;
        let timeoutId = null;
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            setNowMs(monotonicEpochNowMs());
            if (typeof requestAnimationFrame === "function" && !document.hidden) animationFrameId = requestAnimationFrame(tick);
            else timeoutId = setTimeout(tick, 100);
        };
        tick();
        return () => {
            cancelled = true;
            if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
            if (timeoutId != null) clearTimeout(timeoutId);
        };
    }, [playbackStartMs]);

    const activeElapsedMs = Number(activeFrame?.elapsedMs ?? 0);
    const recentFrames = frames.filter((frame) => Number(frame.elapsedMs ?? 0) >= activeElapsedMs - 200
        && Number(frame.elapsedMs ?? 0) < activeElapsedMs);
    const shapes = playbackInput
        ? replayArenaShapes(fighters, obstacles, recentFrames, entranceProgress, frames, frameIndex)
        : preloadShapes;

    return <section className="relative match-arena-shell flex h-[calc(100svh-72px)] min-h-0 overflow-hidden">
        <main className="match-arena-stage flex min-w-0 flex-1 items-center justify-center overflow-hidden p-2">
            <div className="relative flex h-full w-full items-center justify-center">
                <PixiCanvas shapes={shapes} selectedId={null} onSelectShape={() => { }} onUpdateShape={() => { }}
                    onDeselectAll={() => { }} editable={false} fillAvailable fixedLayout abilityLayout="split"
                    showMissingOpponentStatus={false} lockCamera />
            </div>
        </main>
        <ReplaySidebar
            playback={playback}
            player={viewer}
            opponent={opponent}
            replaySeconds={replaySeconds}
            countdownRemainingMs={countdownRemainingMs}
            resultTitle={resultTitle}
            shouldRevealResult={shouldRevealResult}
            hasReachedReplayEnd={hasReachedReplayEnd}
        />
    </section>;
}

function ReplaySidebar({
    playback,
    player,
    opponent,
    replaySeconds,
    countdownRemainingMs,
    resultTitle,
    shouldRevealResult,
    hasReachedReplayEnd,
}) {
    const roundWinsBeforeResult = playback.roundWinsBeforeResult;
    const revealCurrentRoundPoint = shouldRevealResult;
    const playerWins = displayedRoundWins(player, roundWinsBeforeResult, revealCurrentRoundPoint);
    const opponentWins = displayedRoundWins(opponent, roundWinsBeforeResult, revealCurrentRoundPoint);
    const statusMessage = countdownRemainingMs > 0
        ? "Fighters entering the arena."
        : shouldRevealResult ? playback.message
            : hasReachedReplayEnd ? "Waiting for the server to publish the result."
                : "Watching the submitted bot brains fight.";

    return (
        <aside className="arena-right-toolbar testing-mono h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[linear-gradient(180deg,rgba(12,22,31,.98),rgba(8,16,24,.98))] p-4 shadow-[-12px_0_30px_rgba(0,0,0,.28)]">
            <div className="space-y-4">
                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 text-[10px] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <ReplayPanelHeading icon="status">MATCH STATUS</ReplayPanelHeading>
                    <div className="flex items-center justify-between text-ink-muted">
                        <span>ROUND</span>
                        <strong className="font-interface-numeric text-ink-white">{playback.roundNumber ?? 1}/3</strong>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-ink-muted">
                        <span>REPLAY TIMER</span>
                        <strong className="font-interface-numeric text-amber-200">{formatReplayClock(replaySeconds)}</strong>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <ReplayScoreBox label="YOU" value={playerWins} tone={fighterColorRole(player)} />
                        <ReplayScoreBox label={opponent?.username ?? "OPP"} value={opponentWins} tone={fighterColorRole(opponent)} opponent />
                    </div>
                </section>

                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <ReplayPanelHeading icon="brain">ROUND REPLAY</ReplayPanelHeading>
                    <p className="mt-3 font-mono text-[9px] tracking-[0.22em] text-cyan">{playback.rulesetVersion ?? "duel-v1"}</p>
                    <p className="mt-2 break-words text-base font-bold text-ink-white" aria-live="polite">
                        {countdownRemainingMs > 0 ? "Preparing replay..." : resultTitle}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-ink-muted">{statusMessage}</p>
                </section>
            </div>
        </aside>
    );
}

function ReplayScoreBox({ label, value, tone, opponent = false }) {
    const color = tone === "pink" ? "text-fuchsia-200" : "text-cyan-200";
    return (
        <div className={`rounded border border-border-lo bg-zinc-950/50 p-2 ${opponent ? "replay-opponent-stats" : ""}`}>
            <div className={`font-interface-semibold truncate ${color}`}>{label}</div>
            <div className="font-interface-numeric mt-1 text-base text-ink-white">{value}</div>
        </div>
    );
}

function ReplayPanelHeading({ icon, children }) {
    return <span className="font-display-action mb-3 flex items-center gap-2 text-base tracking-[.09em] text-sky-300">
        <MatchToolIcon name={icon} />{children}
    </span>;
}

function formatReplayClock(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function replayResultTitle({ shouldRevealResult, hasReachedReplayEnd, result, winnerName, winnerHp, winnerColorRole }) {
    if (!shouldRevealResult) return hasReachedReplayEnd ? "Awaiting official result" : "Replay in progress";
    if (result === "DRAW") return "Fight drawn";
    if (result === "MATCH_CANCELLED") return "Match canceled";
    if (!["FIGHTER_WIN", "WIN", "RESIGNATION_WIN", "DISCONNECTION_WIN"].includes(result)) return "Simulation failed";

    const suffix = result === "RESIGNATION_WIN" ? " won by resignation"
        : result === "DISCONNECTION_WIN" ? " won by disconnect"
            : ` won the round${winnerHp == null ? "" : ` with ${winnerHp} HP`}`;
    return <>
        <span className={winnerColorRole === "pink" ? "text-fuchsia-300" : "text-cyan-300"}>{winnerName}</span>
        {suffix}
    </>;
}

function replayArenaShapes(fighters, obstacles, recentFrames = [], entranceProgress = 1, frames = [], frameIndex = 0) {
    const recentlyDamagedIds = new Set();
    for (const frame of recentFrames) {
        for (const previous of [...(frame.fighters ?? []), ...(frame.obstacles ?? [])]) {
            const current = [...fighters, ...obstacles].find((candidate) => String(candidate.id ?? candidate.userId) === String(previous.id ?? previous.userId));
            if (current && Number(current.hp ?? 0) < Number(previous.hp ?? 0)) recentlyDamagedIds.add(String(current.id ?? current.userId));
        }
    }
    const fighterShapes = fighters.map((fighter) => fighterReplayShape(
        fighter,
        recentlyDamagedIds,
        entranceProgress,
        frames,
        frameIndex,
    ));
    const previousFrame = frames[Math.max(0, frameIndex - 1)];
    const previousObstaclesById = new Map((previousFrame?.obstacles ?? [])
        .map((obstacle) => [String(obstacle.id), obstacle]));
    const obstacleShapes = obstacles.map((obstacle) => {
        const previous = previousObstaclesById.get(String(obstacle.id));
        const velocity = replayProjectileVelocity(obstacle, previous);
        return {
            ...obstacle,
            ...velocity,
            size: obstacle.size ?? 60,
            rotation: obstacle.rotation ?? 0,
            armed: obstacle.armed,
            fuseMs: obstacle.timerMs,
            remainingMs: obstacle.timerMs,
            captureBySlot: { 1: obstacle.slotOneCaptureMs ?? 0, 2: obstacle.slotTwoCaptureMs ?? 0 },
            locked: true,
            interpolationMs: REPLAY_FRAME_INTERPOLATION_MS,
            hitFlashMs: recentlyDamagedIds.has(String(obstacle.id)) ? 200 : 0,
        };
    });
    return [
        ...fighterShapes.map((fighter) => ({
            ...fighter,
            gunRayLength: fighter.gunShotActive ? replayGunRayLength(fighter, obstacleShapes) : undefined,
        })),
        ...obstacleShapes,
    ];
}

function fighterReplayShape(fighter, recentlyDamagedIds, entranceProgress, frames, frameIndex) {
    const loadoutId = String(fighter.combatLoadout ?? "").startsWith("custom:")
        ? fighter.combatLoadout
        : encodeBotLoadout({ abilities: fighter.abilities ?? [], statPoints: {} });
    const abilities = Array.isArray(fighter.abilities) && fighter.abilities.length
        ? fighter.abilities
        : decodeBotLoadout(loadoutId).abilities;
    const legacyAttackActive = Boolean(fighter.attackActive);
    const gunShotActive = fighter.gunShotActive ?? (legacyAttackActive && abilities.includes("fire_gun"));
    const swingActive = fighter.swingActive ?? (legacyAttackActive && abilities.includes("swing") && !gunShotActive);
    const fireballActive = fighter.fireballActive ?? (legacyAttackActive && abilities.includes("shoot_fireball"));
    const stunActive = fighter.stunActive ?? (legacyAttackActive && abilities.includes("stun") && !fireballActive);
    const visualOrigin = replayRayOrigin(fighter, frames, frameIndex);
    const replaySwingActiveMs = replayActiveTimer(fighter, frames, frameIndex, "swingActive", MOVE_STATS.swing.activeMs);
    const previousFighter = frames[Math.max(0, frameIndex - 1)]?.fighters
        ?.find((candidate) => String(candidate.userId) === String(fighter.userId));
    const replayVelocity = {
        velocityX: Number(fighter.x ?? 0) - Number(previousFighter?.x ?? fighter.x ?? 0),
        velocityY: Number(fighter.y ?? 0) - Number(previousFighter?.y ?? fighter.y ?? 0),
    };
    return {
        ...fighter,
        x: replayEntranceX(fighter, entranceProgress, ARENA_WIDTH_UNITS),
        id: fighter.userId != null ? `fighter-${fighter.userId}` : `fighter-slot-${fighter.slot}`,
        type: "fighter",
        size: fighter.size ?? 60,
        combatLoadout: loadoutId,
        abilities,
        maxHp: Number(fighter.maxHp ?? 100),
        swingActiveMs: swingActive ? replaySwingActiveMs : 0,
        gunShotActive,
        gunActiveMs: visualOrigin.replayGunActiveMs ?? (gunShotActive ? 100 : 0),
        fireballActiveMs: fireballActive ? 100 : 0,
        fireballCharges: Number(fighter.fireballCharges ?? 0),
        fireballReloadMs: Number(fighter.fireballReloadMs ?? 0),
        swingCooldownMs: Number(fighter.swingCooldownMs ?? fighter.attackCooldownMs ?? 0),
        blockCharges: Number(fighter.blockCharges ?? 0),
        blockCooldownMs: Number(fighter.blockCooldownMs ?? 0),
        blockRechargeMs: Number(fighter.blockRechargeMs ?? 0),
        dashCooldownMs: Number(fighter.dashCooldownMs ?? 0),
        gunCooldownMs: Number(fighter.gunCooldownMs ?? 0),
        grenadeCooldownMs: Number(fighter.grenadeCooldownMs ?? 0),
        fireballCooldownMs: Number(fighter.fireballCooldownMs ?? 0),
        stunCooldownMs: Number(fighter.stunCooldownMs ?? 0),
        stunActiveMs: stunActive ? 100 : 0,
        stunCastActive: stunActive,
        dashActiveMs: fighter.dashActive ? 100 : 0,
        microDashActiveMs: Number(fighter.abilityActiveMs?.micro_dash ?? 0),
        blockActiveMs: fighter.blockActive ? 100 : 0,
        locked: true,
        interpolationMs: entranceProgress < 1 ? 0 : REPLAY_FRAME_INTERPOLATION_MS,
        username: fighter.username,
        opponentUsername: fighter.username,
        hitFlashMs: recentlyDamagedIds.has(String(fighter.userId)) ? 200 : 0,
        ...replayVelocity,
        ...visualOrigin,
    };
}

function forfeitWinnerFighter(winner) {
    return {
        userId: winner.userId,
        username: winner.username,
        slot: winner.slot,
        x: ARENA_WIDTH_UNITS / 2,
        y: ARENA_HEIGHT_UNITS / 2,
        rotation: 0,
        hp: 100,
        maxHp: 100,
        combatLoadout: winner.selectedLoadout ?? encodeBotLoadout({ abilities: [], statPoints: {} }),
        abilities: decodeBotLoadout(winner.selectedLoadout).abilities,
    };
}

function sameId(left, right) {
    return left != null && right != null && String(left) === String(right);
}

function replayActiveTimer(fighter, frames, frameIndex, activeField, durationMs) {
    if (!fighter?.[activeField]) return 0;
    const activation = firstActiveFighter(fighter, frames, frameIndex, (candidate) => candidate?.[activeField]);
    const currentElapsedMs = Number(frames[frameIndex]?.elapsedMs ?? activation.elapsedMs);
    return Math.max(0, Number(durationMs) - (currentElapsedMs - activation.elapsedMs));
}

function replayRayOrigin(fighter, frames, frameIndex) {
    if (fighter.gunShotActive) {
        const activation = firstActiveFighter(fighter, frames, frameIndex, (candidate) => candidate.gunShotActive);
        const currentElapsedMs = Number(frames[frameIndex]?.elapsedMs ?? activation.elapsedMs);
        return {
            gunRayOriginX: Number(activation.fighter.x ?? fighter.x),
            gunRayOriginY: Number(activation.fighter.y ?? fighter.y),
            gunRayRotation: Number(activation.fighter.rotation ?? fighter.rotation ?? 0),
            replayGunActiveMs: Math.max(0, 1000 - (currentElapsedMs - activation.elapsedMs)),
        };
    }
    const ability = ["pistol_shot", "concussive_shot", "rail_shot"]
        .find((id) => Number(fighter.abilityActiveMs?.[id] ?? 0) > 0);
    if (!ability) return {};
    const activation = firstActiveFighter(fighter, frames, frameIndex,
        (candidate) => Number(candidate.abilityActiveMs?.[ability] ?? 0) > 0);
    return {
        visualOriginX: Number(activation.fighter.x ?? fighter.x),
        visualOriginY: Number(activation.fighter.y ?? fighter.y),
        visualOriginRotation: Number(activation.fighter.rotation ?? fighter.rotation ?? 0),
    };
}

function firstActiveFighter(fighter, frames, frameIndex, isActive) {
    let activationFighter = fighter;
    let elapsedMs = Number(frames[frameIndex]?.elapsedMs ?? 0);
    for (let index = Math.min(frameIndex, frames.length - 1); index >= 0; index -= 1) {
        const candidate = (frames[index]?.fighters ?? []).find((entry) => String(entry.userId) === String(fighter.userId));
        if (!candidate || !isActive(candidate)) break;
        activationFighter = candidate;
        elapsedMs = Number(frames[index]?.elapsedMs ?? elapsedMs);
    }
    return { fighter: activationFighter, elapsedMs };
}

function replayGunRayLength(fighter, obstacles) {
    const originX = Number(fighter.gunRayOriginX ?? fighter.x);
    const originY = Number(fighter.gunRayOriginY ?? fighter.y);
    const radians = compassDegreesToRadians(fighter.gunRayRotation ?? fighter.rotation);
    const directionX = Math.cos(radians);
    const directionY = Math.sin(radians);
    return obstacles.filter((wall) => wall.type === PROJECTILE_WALL_TYPE || wall.type === DEFENSE_WALL_TYPE)
        .reduce((nearest, wall) => {
            const wallRadians = compassDegreesToRadians(wall.rotation);
            const half = Number(wall.size ?? PROJECTILE_WALL_LENGTH) / 2;
            const ax = wall.x - Math.cos(wallRadians) * half;
            const ay = wall.y - Math.sin(wallRadians) * half;
            const bx = wall.x + Math.cos(wallRadians) * half;
            const by = wall.y + Math.sin(wallRadians) * half;
            const segmentX = bx - ax;
            const segmentY = by - ay;
            const denominator = directionX * segmentY - directionY * segmentX;
            if (Math.abs(denominator) < 0.000001) return nearest;
            const offsetX = ax - originX;
            const offsetY = ay - originY;
            const distance = (offsetX * segmentY - offsetY * segmentX) / denominator;
            const segmentT = (offsetX * directionY - offsetY * directionX) / denominator;
            return distance >= 0 && distance <= GUN_RANGE && segmentT >= 0 && segmentT <= 1
                ? Math.min(nearest, distance) : nearest;
        }, GUN_RANGE);
}

function frameIndexForElapsedMs(frames, elapsedMs) {
    let selectedIndex = 0;
    for (let index = 0; index < frames.length; index += 1) {
        if ((frames[index].elapsedMs ?? 0) > elapsedMs) break;
        selectedIndex = index;
    }
    return selectedIndex;
}
