import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import PixiCanvas from "../gameArena/pixi/PixiCanvas";
import { PROJECTILE_WALL_LENGTH, PROJECTILE_WALL_TYPE } from "../gameArena/ArenaObjects";
import { decodeBotLoadout, encodeBotLoadout } from "../gameArena/loadout/BotLoadout";
import { AUTO_STEP_MS, BASE_BOT_HP, DEFENSE_WALL_TYPE, ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../gameArena/modelPayloads/arenaConstants";
import { MATCH_DURATION_MS } from "../gameArena/gameconfig/ArenaHazardConfig.js";
import { ABILITY_STATS } from "../gameArena/gameconfig/Abilities.js";
import { botColorRole, normalizeReplayObstacleShape } from "../gameArena/pixi/pixiVisualState.js";
import { compassDegreesToRadians } from "../gameArena/botlogic/planner/arenaAngles.js";
import MatchToolIcon from "../gameArena/coding/controls/MatchToolIcon.jsx";
import BotLogo from "../components/BotLogo.jsx";
import { centeredTeamPosition, displayedRoundWins, hydrateReplayBot, initialReplayHandoffFrame, interpolateReplayFrame, replayAbilitiesFor, replayAbilityTarget, replayAbilityVisual, replayBotAbilityState, replayElapsedMs, replayEntranceProgress, replayEntranceX, replayFrameIndexForElapsedMs, replayRayOrigin, replayRatingChanges, replayRemainingSeconds, replayResultVisibility, replayShapeKey } from "./replayPresentation.js";

const EMPTY_LIST = Object.freeze([]);
const NOOP = () => { };
const EMPTY_PLAYBACK = Object.freeze({
    frames: EMPTY_LIST,
    initialState: { bots: EMPTY_LIST, entities: EMPTY_LIST },
    players: EMPTY_LIST,
});

function participantTeamNumber(participant) {
    const explicitTeam = Number(participant?.teamNumber);
    return Number.isFinite(explicitTeam) && explicitTeam > 0
        ? explicitTeam
        : Number(participant?.slot) === 1 ? 1 : 2;
}

function teamLabel(teamNumber) {
    return Number(teamNumber) === 2 ? "Red Team" : "Blue Team";
}

function roundWinsForTeam(participants, teamNumber, roundWinsBeforeResult, revealCurrentRoundPoint) {
    return participants
        .filter((participant) => participantTeamNumber(participant) === teamNumber)
        .reduce((highest, participant) => Math.max(
            highest,
            displayedRoundWins(participant, roundWinsBeforeResult, revealCurrentRoundPoint),
        ), 0);
}

export default function SimulationReplay({
    playback: playbackInput,
    preloadShapes = [],
    onCancel = null,
    cancelLabel = "CANCEL REPLAY",
    isCustomMatch = false,
    isFinalMatchResult = false,
    onReturnToLobby = null,
}) {
    useLayoutEffect(() => {
        if (typeof window !== "undefined") window.scrollTo(0, 0);
    }, []);

    const playback = playbackInput ?? EMPTY_PLAYBACK;
    const frames = playback.frames ?? EMPTY_LIST;
    const viewer = playback.player ?? null;
    const opponent = playback.opponent ?? null;
    const participants = useMemo(() => playback.players?.length
        ? playback.players
        : [viewer, opponent].filter(Boolean), [opponent, playback.players, viewer]);
    const participantsBySlot = useMemo(() => new Map(
        participants
            .filter((participant) => participant?.slot != null)
            .map((participant) => [Number(participant.slot), participant]),
    ), [participants]);
    const staticBotsBySlot = useMemo(() => new Map(
        (playback.initialState?.bots ?? [])
            .filter((bot) => bot?.slot != null)
            .map((bot) => [Number(bot.slot), bot]),
    ), [playback.initialState?.bots]);
    const playbackStartMs = playback.playbackStartsAtMs
        ?? (playback.playbackStartsAt ? new Date(playback.playbackStartsAt).getTime() : null);
    const [nowMs, setNowMs] = useState(() => monotonicEpochNowMs());
    const elapsedPlaybackMs = playbackStartMs == null ? 0 : replayElapsedMs(playbackStartMs, nowMs);
    const countdownRemainingMs = playbackStartMs == null ? 0 : Math.max(0, playbackStartMs - nowMs);
    const entranceProgress = replayEntranceProgress(playbackStartMs, nowMs);
    const finalElapsedMs = frames.length === 0 ? 0 : frames[frames.length - 1].elapsedMs ?? 0;
    const displayElapsedMs = frames.length === 0 ? 0 : Math.min(elapsedPlaybackMs, finalElapsedMs);
    const frameIndex = frames.length === 0
        ? 0
        : replayFrameIndexForElapsedMs(frames, displayElapsedMs, AUTO_STEP_MS);
    const firstFrameElapsedMs = Number(frames[0]?.elapsedMs ?? 0);
    const isInitialHandoff = countdownRemainingMs <= 0
        && firstFrameElapsedMs > 0
        && displayElapsedMs < firstFrameElapsedMs;
    const activeFrame = isInitialHandoff
        ? initialReplayHandoffFrame(playback.initialState, frames[0], displayElapsedMs)
        : frames[Math.min(frameIndex, Math.max(frames.length - 1, 0))];
    const nextFrame = isInitialHandoff ? null : frames[frameIndex + 1];
    const renderFrame = useMemo(() => interpolateReplayFrame(activeFrame, nextFrame, displayElapsedMs), [activeFrame, displayElapsedMs, nextFrame]);
    const initialBots = useMemo(() => (playback.initialState?.bots ?? EMPTY_LIST)
        .map((bot) => hydrateReplayBot(
            bot,
            staticBotsBySlot.get(Number(bot?.slot)),
            participantsBySlot.get(Number(bot?.slot)),
        )), [participantsBySlot, playback.initialState?.bots, staticBotsBySlot]);
    const rawReplayBots = countdownRemainingMs > 0 ? initialBots : renderFrame?.bots ?? initialBots;
    const replayBots = useMemo(() => rawReplayBots.map((bot) => hydrateReplayBot(
        bot,
        staticBotsBySlot.get(Number(bot?.slot)),
        participantsBySlot.get(Number(bot?.slot)),
    )), [participantsBySlot, rawReplayBots, staticBotsBySlot]);
    const isForfeitResult = playback.result === "RESIGNATION_WIN" || playback.result === "DISCONNECTION_WIN";
    const winnerParticipant = useMemo(() => participants
        .find((participant) => sameId(participant?.userId, playback.winnerUserId)),
    [participants, playback.winnerUserId]);
    const winnerTeamParticipants = useMemo(() => {
        if (!winnerParticipant) return EMPTY_LIST;
        const seen = new Set();
        return participants
            .filter((participant) => participantTeamNumber(participant) === participantTeamNumber(winnerParticipant))
            .sort((first, second) => Number(first?.slot ?? 0) - Number(second?.slot ?? 0))
            .filter((participant) => {
                const key = participant?.userId != null
                    ? `user:${participant.userId}`
                    : participant?.slot != null ? `slot:${participant.slot}` : null;
                if (key == null || seen.has(key)) return key == null;
                seen.add(key);
                return true;
            });
    }, [participants, winnerParticipant]);
    const forfeitParticipants = useMemo(() => winnerTeamParticipants.length > 0
        ? winnerTeamParticipants
        : winnerParticipant ? [winnerParticipant] : EMPTY_LIST,
    [winnerParticipant, winnerTeamParticipants]);
    const viewerUserId = viewer?.userId ?? null;
    const bots = useMemo(() => {
        if (!isForfeitResult || forfeitParticipants.length === 0) return replayBots;
        return forfeitParticipants.map((participant, index) => forfeitWinnerBot(
            participant,
            index,
            forfeitParticipants.length,
            viewerUserId,
        ));
    }, [forfeitParticipants, isForfeitResult, replayBots, viewerUserId]);
    const entities = useMemo(() => isForfeitResult ? EMPTY_LIST : countdownRemainingMs > 0
        ? playback.initialState?.entities ?? []
        : renderFrame?.entities ?? playback.initialState?.entities ?? EMPTY_LIST,
    [countdownRemainingMs, isForfeitResult, playback.initialState?.entities, renderFrame?.entities]);
    const winner = [...bots, ...initialBots, ...participants]
        .find((bot) => sameId(bot?.userId, playback.winnerUserId));
    const winnerTeamNumber = winner ? participantTeamNumber(winner) : null;
    const winnerTeamLabel = teamLabel(winnerTeamNumber);
    const hasPlaybackStarted = countdownRemainingMs <= 0;
    const hasDisplayedFinalFrame = hasPlaybackStarted && (frames.length === 0
        || elapsedPlaybackMs >= finalElapsedMs);
    const hasAuthorizedTerminalFrame = playback.batchSequence == null || playback.terminalBatch;
    const hasReachedReplayEnd = hasAuthorizedTerminalFrame && hasDisplayedFinalFrame;
    const resultRevealReceived = playback.resultRevealReceived === true;
    const roundResultRevealReceived = playback.roundResultRevealReceived === true;
    const { roundResultRevealed, matchResultRevealed } = replayResultVisibility({
        result: playback.result,
        hasAuthorizedTerminalFrame,
        hasDisplayedFinalFrame,
        roundResultRevealReceived,
        resultRevealReceived,
    });
    const ratingChanges = replayRatingChanges(playback, matchResultRevealed, viewer?.username);

    const winnerColorRole = botColorRole(winner);
    const replaySeconds = replayRemainingSeconds(MATCH_DURATION_MS, displayElapsedMs);

    useEffect(() => {
        let animationFrameId = null;
        let timeoutId = null;
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            setNowMs(monotonicEpochNowMs());
            if (typeof requestAnimationFrame === "function" && !document.hidden) {
                animationFrameId = requestAnimationFrame(tick);
            } else {
                timeoutId = setTimeout(tick, AUTO_STEP_MS);
            }
        };
        tick();
        return () => {
            cancelled = true;
            if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
            if (timeoutId != null) clearTimeout(timeoutId);
        };
    }, [playbackStartMs]);

    const activeElapsedMs = Number(activeFrame?.elapsedMs ?? 0);
    // The replay used to scan every buffered frame and rebuild every shape on
    // each requestAnimationFrame. That work grew throughout the match and
    // eventually monopolized the main thread. Only the two preceding fixed
    // steps can contribute to the 200 ms damage window.
    const recentFrames = useMemo(() => {
        const initialFrame = frameIndex === 0 ? [{
            elapsedMs: activeElapsedMs - AUTO_STEP_MS,
            bots: initialBots,
            entities: playback.initialState?.entities ?? [],
        }] : [];
        const previousTwo = frameIndex > 1
            ? [frames[frameIndex - 2], frames[frameIndex - 1]]
            : frameIndex > 0 ? [frames[frameIndex - 1]] : EMPTY_LIST;
        return [...initialFrame, ...previousTwo];
    }, [activeElapsedMs, frameIndex, frames, initialBots, playback.initialState?.entities]);
    const shapes = useMemo(() => playbackInput
        ? replayArenaShapes(bots, entities, recentFrames, entranceProgress, frames, frameIndex, isInitialHandoff, viewerUserId)
        : preloadShapes, [bots, entities, entranceProgress, frameIndex, frames, isInitialHandoff, playbackInput, preloadShapes, recentFrames, viewerUserId]);

    return <section className="arena-content-shell relative match-arena-shell flex h-[calc(100svh-72px)] min-h-0 overflow-hidden">
        <main className="arena-stage-main match-arena-stage flex min-w-0 flex-1 items-center justify-center overflow-hidden p-2">
            <div className="arena-stage-frame relative flex h-full w-full items-center justify-center">
                <PixiCanvas shapes={shapes} selectedId={null} onSelectShape={NOOP} onUpdateShape={NOOP}
                    onDeselectAll={NOOP} editable={false} fillAvailable fixedLayout abilityLayout="split"
                    showMissingOpponentStatus={false} showParticipantNumbers lockCamera />
            </div>
        </main>
        <ReplaySidebar
            playback={playback}
            player={viewer}
            opponent={opponent}
            participants={participants}
            replaySeconds={replaySeconds}
            countdownRemainingMs={countdownRemainingMs}
            roundResultRevealed={roundResultRevealed}
            matchResultRevealed={matchResultRevealed}
            hasReachedReplayEnd={hasReachedReplayEnd}
            winnerTeamLabel={winnerTeamLabel}
            winnerTeamNumber={winnerTeamNumber}
            winnerColorRole={winnerColorRole}
            onCancel={onCancel}
            cancelLabel={cancelLabel}
            isCustomMatch={isCustomMatch}
            isFinalMatchResult={isFinalMatchResult}
            onReturnToLobby={onReturnToLobby}
            ratingChanges={ratingChanges}
        />
    </section>;
}

function ReplaySidebar({
    playback,
    player,
    opponent,
    participants,
    replaySeconds,
    countdownRemainingMs,
    roundResultRevealed,
    matchResultRevealed,
    hasReachedReplayEnd,
    winnerTeamLabel,
    winnerTeamNumber,
    winnerColorRole,
    onCancel,
    cancelLabel,
    isCustomMatch,
    isFinalMatchResult,
    onReturnToLobby,
    ratingChanges,
}) {
    const roundWinsBeforeResult = playback.roundWinsBeforeResult;
    const revealCurrentRoundPoint = roundResultRevealed || matchResultRevealed;
    const roundParticipants = participants.length > 0 ? participants : [player, opponent].filter(Boolean);
    const blueTeamWins = roundWinsForTeam(roundParticipants, 1, roundWinsBeforeResult, revealCurrentRoundPoint);
    const redTeamWins = roundWinsForTeam(roundParticipants, 2, roundWinsBeforeResult, revealCurrentRoundPoint);
    const roundResultTitle = replayRoundResultTitle({
        roundResultRevealed,
        hasReachedReplayEnd,
        result: playback.result,
        winnerTeamLabel,
        winnerColorRole,
    });
    const matchResultTitle = replayMatchResultTitle({
        matchResultRevealed,
        result: playback.result,
        winnerTeamLabel,
        winnerTeamNumber,
        winnerColorRole,
        blueTeamWins,
        redTeamWins,
    });
    const statusMessage = countdownRemainingMs > 0
        ? "Bots entering the arena."
        : matchResultRevealed ? "Official match result confirmed."
            : roundResultRevealed ? "Round result confirmed."
                : hasReachedReplayEnd ? "Waiting for the round result."
                : "Watching the submitted bots fight.";

    return (
        <aside className="arena-toolbar-panel arena-right-toolbar testing-mono h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[linear-gradient(180deg,rgba(12,22,31,.98),rgba(8,16,24,.98))] p-4 shadow-[-12px_0_30px_rgba(0,0,0,.28)]">
            <div className="space-y-4">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="gray-button-surface w-full border border-fuchsia-500/70 px-3 py-2 text-left font-mono text-[9px] font-bold tracking-widest text-fuchsia-200"
                    >
                        {cancelLabel}
                    </button>
                )}
                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 text-[10px] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <ReplayPanelHeading icon="status">MATCH STATUS</ReplayPanelHeading>
                    <div className="flex items-center justify-between text-ink-muted">
                        <span>ROUND</span>
                        <strong className="font-interface-numeric text-ink-white">{playback.roundNumber ?? 1}/3</strong>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-ink-muted">
                        <span>TIME REMAINING</span>
                        <strong className="font-interface-numeric text-amber-200">{formatReplayClock(replaySeconds)}</strong>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <ReplayScoreBox label="BLUE TEAM" value={blueTeamWins} tone="blue" />
                        <ReplayScoreBox label="RED TEAM" value={redTeamWins} tone="red" opponent />
                    </div>
                </section>

                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <ReplayPanelHeading icon="bot">ROUND REPLAY</ReplayPanelHeading>
                    <p className="mt-2 break-words text-base font-bold text-ink-white" aria-live="polite">
                        {countdownRemainingMs > 0 ? "Preparing replay..." : roundResultTitle}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-ink-muted">{statusMessage}</p>
                </section>
                {matchResultRevealed && (
                    <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]" aria-label="MATCH RESULT">
                        <ReplayPanelHeading icon="status">MATCH RESULT</ReplayPanelHeading>
                        <p className="mt-2 break-words text-base font-bold text-ink-white" aria-live="polite">
                            {matchResultTitle}
                        </p>
                        {ratingChanges.length > 0 && (
                            <div className="mt-4 border-t border-slate-700/70 pt-3" aria-label="ELO changes">
                                <span className="text-[10px] font-bold tracking-[.18em] text-ink-muted">ELO CHANGES</span>
                                <div className="mt-2 space-y-2">
                                    {ratingChanges.map((change, index) => (
                                        <div
                                            key={`${change.username}-${index}`}
                                            className="flex items-center justify-between gap-3 text-sm"
                                        >
                                            <span className="min-w-0 truncate font-semibold text-ink-white">
                                                {change.username}
                                            </span>
                                            <span className="shrink-0 font-interface-numeric font-bold tracking-[.04em] text-ink-white">
                                                {change.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                )}
                {isCustomMatch && isFinalMatchResult && matchResultRevealed && onReturnToLobby && (
                    <button
                        type="button"
                        onClick={onReturnToLobby}
                        className="gray-button-surface w-full border border-cyan-400/70 px-3 py-3 font-mono text-[10px] font-bold tracking-[.18em] text-cyan-100 hover:bg-cyan-950/40"
                    >
                        RETURN TO LOBBY
                    </button>
                )}
            </div>
        </aside>
    );
}

function ReplayScoreBox({ label, value, tone, opponent = false }) {
    const color = tone === "red" ? "text-[#ff7166]" : "text-[#57b8ff]";
    return (
        <div className={`rounded border border-border-lo bg-zinc-950/50 p-2 ${opponent ? "replay-opponent-stats" : ""}`}>
            <div className={`font-interface-semibold truncate ${color}`}>{label}</div>
            <div className="font-interface-numeric mt-1 text-base text-ink-white">{value}</div>
        </div>
    );
}

function ReplayPanelHeading({ icon, children }) {
    return <span className="font-display-action mb-3 flex items-center gap-2 text-base tracking-[.09em] text-sky-300">
        {icon === "bot" ? <BotLogo className="h-5 w-5 object-contain" /> : <MatchToolIcon name={icon} />}{children}
    </span>;
}

function formatReplayClock(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function replayRoundResultTitle({ roundResultRevealed, hasReachedReplayEnd, result, winnerTeamLabel, winnerColorRole }) {
    if (!roundResultRevealed) return hasReachedReplayEnd ? "Awaiting round result" : "Replay in progress";
    if (result === "DRAW") return "Round drawn.";
    if (result === "MATCH_CANCELLED") return "Match canceled.";
    if (!["BOT_WIN", "WIN", "RESIGNATION_WIN", "DISCONNECTION_WIN"].includes(result)) return "Simulation failed.";

    const suffix = result === "RESIGNATION_WIN" ? " wins by forfeit."
        : result === "DISCONNECTION_WIN" ? " wins by disconnect."
            : " wins the round.";
    return <>
        <span className={winnerColorRole === "red" ? "text-[#ff7166]" : "text-[#57b8ff]"}>{winnerTeamLabel}</span>
        {suffix}
    </>;
}

function replayMatchResultTitle({
    matchResultRevealed,
    result,
    winnerTeamLabel,
    winnerTeamNumber,
    winnerColorRole,
    blueTeamWins,
    redTeamWins,
}) {
    if (!matchResultRevealed) return null;
    if (result === "DRAW") return `Match drawn ${blueTeamWins}-${redTeamWins}.`;
    if (result === "MATCH_CANCELLED") return "Match canceled.";
    if (!["BOT_WIN", "WIN", "RESIGNATION_WIN", "DISCONNECTION_WIN"].includes(result)) return "Simulation failed.";

    const winnerScore = winnerTeamNumber === 2 ? redTeamWins : blueTeamWins;
    const loserScore = winnerTeamNumber === 2 ? blueTeamWins : redTeamWins;
    const outcome = result === "RESIGNATION_WIN" ? "wins the match by forfeit"
        : result === "DISCONNECTION_WIN" ? "wins the match by disconnect"
            : "wins the match";
    return <>
        <span className={winnerColorRole === "red" ? "text-[#ff7166]" : "text-[#57b8ff]"}>{winnerTeamLabel}</span>
        {` ${outcome} ${winnerScore}-${loserScore}.`}
    </>;
}

function replayArenaShapes(bots, entities, recentFrames = [], entranceProgress = 1, frames = [], frameIndex = 0, initialHandoff = false, viewerUserId = null) {
    const damageEvents = new Map();
    for (const frame of recentFrames) {
        for (const previous of [...(frame.bots ?? []), ...(frame.entities ?? [])]) {
            const previousKey = replayShapeKey(previous);
            const current = previousKey == null ? null : [...bots, ...entities].find((candidate) => replayShapeKey(candidate) === previousKey);
            if (current && Number(current.hp ?? 0) < Number(previous.hp ?? 0)) {
                damageEvents.set(previousKey, `${Number(frame.elapsedMs ?? 0)}:${previousKey}`);
            }
        }
    }
    // Replay transforms are already interpolated against the authoritative
    // timeline before reaching Pixi. A second renderer-side interpolation
    // would introduce a one-step lag, especially at batch boundaries.
    const interpolationMs = 0;
    const replayPhase = entranceProgress < 1 ? "preparing" : initialHandoff ? "handoff" : "playback";
    const botShapes = bots.map((bot) => botReplayShape(
        bot,
        damageEvents,
        entranceProgress,
        frames,
        frameIndex,
        interpolationMs,
        replayPhase,
        viewerUserId,
    ));
    const previousFrame = frames[Math.max(0, frameIndex - 1)];
    const nextFrame = frames[Math.min(frames.length - 1, frameIndex + 1)];
    const previousEntitiesById = new Map((previousFrame?.entities ?? [])
        .map((entity) => [String(entity.id), entity]));
    const nextEntitiesById = new Map((nextFrame?.entities ?? [])
        .map((entity) => [String(entity.id), entity]));
    const entityShapes = entities.map((entity) => {
        const previous = previousEntitiesById.get(String(entity.id));
        return normalizeReplayObstacleShape(entity, previous, {
            interpolationMs,
            hitFlashMs: damageEvents.has(replayShapeKey(entity)) ? 200 : 0,
            hitParticleEvent: damageEvents.get(replayShapeKey(entity)) ?? null,
            replayFrameIndex: frameIndex,
            replayPhase,
            nextObstacle: nextEntitiesById.get(String(entity.id)),
        });
    });
    return [
        ...botShapes.map((bot) => ({
            ...bot,
            gunRayLength: Number(bot.abilityActiveMs?.[3] ?? 0) > 0 ? replayGunRayLength(bot, entityShapes) : undefined,
        })),
        ...entityShapes,
    ];
}

function botReplayShape(bot, damageEvents, entranceProgress, frames, frameIndex = 0, interpolationMs = 0, replayPhase = "playback", viewerUserId = null) {
    const loadoutId = String(bot.combatLoadout ?? "").startsWith("custom:")
        ? bot.combatLoadout
        : encodeBotLoadout({ abilities: bot.abilities ?? [] });
    const abilities = replayAbilitiesFor(
        Array.isArray(bot.abilities) && bot.abilities.length
            ? bot.abilities
            : decodeBotLoadout(loadoutId).abilities,
    );
    const abilityState = replayBotAbilityState(bot);
    const abilityVisual = replayPhase === "playback"
        ? replayAbilityVisual(bot, frames, frameIndex)
        : null;
    const abilityTarget = replayAbilityTarget(bot, frames, frameIndex);
    const visualOrigin = replayRayOrigin(bot, frames, frameIndex);
    const previousBots = frames[Math.max(0, frameIndex - 1)]?.bots ?? EMPTY_LIST;
    const previousBot = previousBots.find((candidate) => replayShapeKey(candidate) === replayShapeKey(bot));
    const replayVelocity = {
        velocityX: Number(bot.x ?? 0) - Number(previousBot?.x ?? bot.x ?? 0),
        velocityY: Number(bot.y ?? 0) - Number(previousBot?.y ?? bot.y ?? 0),
    };
    return {
        ...bot,
        x: replayEntranceX(bot, entranceProgress, ARENA_WIDTH_UNITS),
        id: bot.userId != null ? `bot-${bot.userId}` : `bot-slot-${bot.slot}`,
        type: "bot",
        size: bot.size ?? 60,
        combatLoadout: loadoutId,
        abilities,
        maxHp: Number(bot.maxHp ?? BASE_BOT_HP),
        abilityActiveMs: abilityState.abilityActiveMs,
        abilityVisual,
        triggeredAbility: bot.triggeredAbility ?? null,
        dashActiveMs: abilityState.dashActiveMs,
        abilityCooldowns: { ...(bot.abilityCooldowns ?? {}) },
        abilityCharges: { ...(bot.abilityCharges ?? {}) },
        abilityRechargeMs: { ...(bot.abilityRechargeMs ?? {}) },
        locked: true,
        interpolationMs,
        username: bot.username,
        opponentUsername: bot.username,
        hitFlashMs: damageEvents.has(replayShapeKey(bot)) ? 200 : 0,
        hitParticleEvent: damageEvents.get(replayShapeKey(bot)) ?? null,
        replayFrameIndex: frameIndex,
        replayPhase,
        isCurrentUser: viewerUserId != null
            ? sameId(bot.userId, viewerUserId)
            : bot.isCurrentUser === true,
        ...replayVelocity,
        ...abilityTarget,
        ...visualOrigin,
    };
}

function forfeitWinnerBot(winner, teamIndex, teamSize, viewerUserId) {
    const loadout = winner.selectedLoadout ?? winner.combatLoadout ?? encodeBotLoadout({ abilities: [] });
    const position = centeredTeamPosition(teamIndex, teamSize, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS);
    return {
        userId: winner.userId,
        username: winner.username,
        slot: winner.slot,
        teamNumber: participantTeamNumber(winner),
        isCurrentUser: sameId(winner.userId, viewerUserId),
        ...position,
        hp: BASE_BOT_HP,
        maxHp: BASE_BOT_HP,
        combatLoadout: loadout,
        abilities: replayAbilitiesFor(decodeBotLoadout(loadout).abilities),
    };
}

function sameId(left, right) {
    return left != null && right != null && String(left) === String(right);
}

function replayGunRayLength(bot, entities) {
    const originX = Number(bot.gunRayOriginX ?? bot.x);
    const originY = Number(bot.gunRayOriginY ?? bot.y);
    const radians = compassDegreesToRadians(bot.gunRayRotation ?? bot.rotation);
    const directionX = Math.cos(radians);
    const directionY = Math.sin(radians);
    return entities.filter((wall) => wall.type === PROJECTILE_WALL_TYPE || wall.type === DEFENSE_WALL_TYPE)
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
            return distance >= 0 && distance <= ABILITY_STATS[3].range && segmentT >= 0 && segmentT <= 1
                ? Math.min(nearest, distance) : nearest;
        }, ABILITY_STATS[3].range);
}
