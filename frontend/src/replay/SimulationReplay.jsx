import { abilityStateFromLegacy } from "../../../shared/engine/gameconfig/AbilityState.js";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import PixiCanvas from "../gameArena/pixi/PixiCanvas";
import { decodeBotLoadout, encodeBotLoadout } from "../../../shared/engine/loadout/BotLoadout.js";
import { AUTO_STEP_MS, BASE_BOT_HP, ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../../shared/engine/modelPayloads/arenaConstants.js";
import { closingZoneWarningShape } from "../../../shared/engine/ecs/entities/ClosingZoneSystem.js";
import { finalTeamHp, matchEndReason, roundLabel, teamHpFromBots } from "../gameArena/coding/matchHud.js";
import { formatHp } from "../../../shared/engine/gameconfig/visualState.js";
import { normalizeReplayObstacleShape } from "../gameArena/pixi/pixiVisualState.js";
import MatchToolIcon from "../gameArena/coding/controls/MatchToolIcon.jsx";
import BotLogo from "../components/BotLogo.jsx";
import { matchModeLabel } from "../matchmaking/matchModes.js";
import { eloChangeTone, eloChangeValue } from "../pages/profile/profileMatchFormat.js";
import { centeredTeamPosition, initialReplayHandoffFrame, interpolateReplayFrame, replayAbilitiesFor, replayDamageEvents, replayElapsedMs, replayEntranceProgress, replayEntranceX, replayFrameIndexForElapsedMs, replayRatingChanges, replayRemainingSeconds, replayResultVisibility, replayShapeKey, replayFrameBots, replayFrameEntities } from "./replayPresentation.js";
import { createBotState } from "../../../shared/engine/modelPayloads/botState.js";

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

export default function SimulationReplay({
    playback: playbackInput,
    preloadShapes = [],
    onCancel = null,
    cancelLabel = "CANCEL REPLAY",
    isCustomMatch = false,
    isFinalMatchResult = false,
    onReturnToLobby = null,
    mode = null,
    onHome = null,
    onQueueAgain = null,
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
    const initialBots = useMemo(() => replayFrameBots(playback.initialState), [playback.initialState]);
    const rawReplayBots = countdownRemainingMs > 0 ? initialBots : renderFrame ? replayFrameBots(renderFrame) : initialBots;
    // The Java rollback mode still carries static metadata separately; native worker bots need no conversion.
    const replayBots = useMemo(() => rawReplayBots.map((bot) => bot.kind === "bot" ? bot : createBotState({
        ...staticBotsBySlot.get(Number(bot.slot)), ...participantsBySlot.get(Number(bot.slot)), ...bot,
        id: `bot-slot-${bot.slot}`, type: "bot",
        abilityState: abilityStateFromLegacy({ ...staticBotsBySlot.get(Number(bot.slot)), ...bot }),
    })), [participantsBySlot, rawReplayBots, staticBotsBySlot]);
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
        ? replayFrameEntities(playback.initialState)
        : replayFrameEntities(renderFrame ?? playback.initialState),
    [countdownRemainingMs, isForfeitResult, playback.initialState, renderFrame]);
    const winner = [...bots, ...initialBots, ...participants]
        .find((bot) => sameId(bot?.userId, playback.winnerUserId));
    const winnerTeamNumber = winner ? participantTeamNumber(winner) : null;
    const hasPlaybackStarted = countdownRemainingMs <= 0;
    const hasDisplayedFinalFrame = hasPlaybackStarted && (frames.length === 0
        || elapsedPlaybackMs >= finalElapsedMs);
    const hasAuthorizedTerminalFrame = playback.batchSequence == null || playback.terminalBatch;
    const hasReachedReplayEnd = hasAuthorizedTerminalFrame && hasDisplayedFinalFrame;
    const resultRevealReceived = playback.resultRevealReceived === true;
    const roundResultRevealReceived = playback.roundResultRevealReceived === true;
    const { matchResultRevealed } = replayResultVisibility({
        result: playback.result,
        hasAuthorizedTerminalFrame,
        hasDisplayedFinalFrame,
        roundResultRevealReceived,
        resultRevealReceived,
    });
    const ratingChanges = replayRatingChanges(playback, matchResultRevealed, viewer?.username);

    const segmentMs = (Number(playback.timedRounds?.segmentSeconds) > 0 ? Number(playback.timedRounds.segmentSeconds) : 15) * 1000;
    const replaySeconds = replayRemainingSeconds(segmentMs, displayElapsedMs);

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
    const zoneNextDiameterUnits = playback.timedRounds?.zoneNextDiameterUnits;
    const nativeFrames = playback.initialState?.shapes != null;
    const shapes = useMemo(() => {
        if (!playbackInput) return preloadShapes;
        const replayShapes = replayArenaShapes(bots, entities, recentFrames, entranceProgress, frameIndex, isInitialHandoff, viewerUserId, nativeFrames);
        const warning = isForfeitResult ? null : closingZoneWarningShape(zoneNextDiameterUnits, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS);
        return warning ? [...replayShapes, warning] : replayShapes;
    }, [bots, entities, entranceProgress, frameIndex, isForfeitResult, isInitialHandoff, nativeFrames, playbackInput, preloadShapes, recentFrames, viewerUserId, zoneNextDiameterUnits]);
    const liveTeamHp = useMemo(() => teamHpFromBots(bots), [bots]);

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
            liveTeamHp={liveTeamHp}
            countdownRemainingMs={countdownRemainingMs}
            matchResultRevealed={matchResultRevealed}
            hasReachedReplayEnd={hasReachedReplayEnd}
            winnerTeamNumber={winnerTeamNumber}
            onCancel={onCancel}
            cancelLabel={cancelLabel}
            isCustomMatch={isCustomMatch}
            isFinalMatchResult={isFinalMatchResult}
            onReturnToLobby={onReturnToLobby}
            ratingChanges={ratingChanges}
            mode={mode}
            finalElapsedMs={finalElapsedMs}
            onHome={onHome}
            onQueueAgain={onQueueAgain}
        />
    </section>;
}

const WIN_RESULTS = ["BOT_WIN", "WIN", "RESIGNATION_WIN", "DISCONNECTION_WIN"];

function ReplaySidebar({
    playback,
    player,
    opponent,
    participants,
    replaySeconds,
    liveTeamHp,
    countdownRemainingMs,
    matchResultRevealed,
    hasReachedReplayEnd,
    winnerTeamNumber,
    onCancel,
    cancelLabel,
    isCustomMatch,
    isFinalMatchResult,
    onReturnToLobby,
    ratingChanges,
    mode = null,
    finalElapsedMs = 0,
    onHome = null,
    onQueueAgain = null,
}) {
    const roundParticipants = participants.length > 0 ? participants : [player, opponent].filter(Boolean);
    const maxRounds = playback.timedRounds?.maxRounds;
    const finalHp = finalTeamHp(playback.timedRounds);
    const roundResultTitle = replayRoundResultTitle({ hasReachedReplayEnd });
    const statusMessage = countdownRemainingMs > 0
        ? "Bots entering the arena."
        : matchResultRevealed ? "Official match result confirmed."
            : hasReachedReplayEnd ? "Segment complete."
                : "Watching the submitted bots fight.";

    return (
        <aside className="arena-toolbar-panel arena-right-toolbar h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[linear-gradient(180deg,rgba(12,22,31,.98),rgba(8,16,24,.98))] p-4 shadow-[-12px_0_30px_rgba(0,0,0,.28)]">
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
                {matchResultRevealed ? (
                    <MatchFinishedCard
                        playback={playback}
                        player={player}
                        participants={roundParticipants}
                        mode={mode}
                        isCustomMatch={isCustomMatch}
                        finalHp={finalHp}
                        winnerTeamNumber={winnerTeamNumber}
                        finalElapsedMs={finalElapsedMs}
                        ratingChanges={ratingChanges}
                        onHome={onHome}
                        onQueueAgain={onQueueAgain}
                        onReturnToLobby={isCustomMatch && isFinalMatchResult ? onReturnToLobby : null}
                        isFinalMatchResult={isFinalMatchResult}
                    />
                ) : (
                    <>
                        <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 text-[10px] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                            <ReplayPanelHeading icon="status">Match status</ReplayPanelHeading>
                            <div className="flex items-center justify-between text-ink-muted">
                                <span>Round</span>
                                <strong className="font-interface-numeric text-ink-white">{roundLabel(playback.roundNumber, maxRounds)}</strong>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-ink-muted">
                                <span>Segment time left</span>
                                <strong className="font-interface-numeric text-amber-200">{formatReplayClock(replaySeconds)}</strong>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <ReplayScoreBox label="Blue HP" value={formatHp(liveTeamHp.blue)} tone="blue" />
                                <ReplayScoreBox label="Red HP" value={formatHp(liveTeamHp.red)} tone="red" opponent />
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                            <ReplayPanelHeading icon="bot">Replay</ReplayPanelHeading>
                            <p className="mt-2 break-words text-base font-bold text-ink-white" aria-live="polite">
                                {countdownRemainingMs > 0 ? "Preparing replay..." : roundResultTitle}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-ink-muted">{statusMessage}</p>
                        </section>
                    </>
                )}
            </div>
        </aside>
    );
}

function MatchFinishedCard({
    playback,
    player,
    participants,
    mode,
    isCustomMatch,
    finalHp,
    winnerTeamNumber,
    ratingChanges,
    onHome,
    onQueueAgain,
    onReturnToLobby,
    isFinalMatchResult,
}) {
    const result = playback.result;
    const cancelled = result === "MATCH_CANCELLED";
    const failed = !cancelled && result !== "DRAW" && !WIN_RESULTS.includes(result);
    const viewerTeam = participantTeamNumber(player);
    const draw = result === "DRAW";
    const viewerWon = WIN_RESULTS.includes(result) && Number(winnerTeamNumber) === viewerTeam;
    const outcome = cancelled ? "cancelled" : failed ? "failed" : draw ? "draw" : viewerWon ? "victory" : "defeat";
    const tone = {
        victory: { title: "VICTORY", text: "text-emerald-300", box: "border-emerald-500/40 bg-emerald-950/40" },
        defeat: { title: "DEFEAT", text: "text-rose-300", box: "border-rose-500/40 bg-rose-950/30" },
        draw: { title: "DRAW", text: "text-slate-200", box: "border-slate-500/40 bg-slate-800/40" },
        cancelled: { title: "MATCH CANCELED", text: "text-slate-200", box: "border-slate-500/40 bg-slate-800/40" },
        failed: { title: "SIMULATION FAILED", text: "text-amber-300", box: "border-amber-500/40 bg-amber-950/30" },
    }[outcome];
    const modeName = isCustomMatch || String(mode ?? "").toUpperCase() === "CUSTOM"
        ? "Custom match"
        : `Ranked ${matchModeLabel(mode)}`;
    const reason = matchEndReason({ result, hpDecision: playback.timedRounds?.hpDecision });
    const forfeitText = result === "RESIGNATION_WIN"
        ? viewerWon ? "opponent forfeited" : "you forfeited"
        : result === "DISCONNECTION_WIN"
            ? viewerWon ? "opponent disconnected" : "you disconnected"
            : reason;
    const subtitle = cancelled || failed ? modeName : `${modeName}, ${forfeitText}`;
    const teamNames = (teamNumber) => participants
        .filter((participant) => participantTeamNumber(participant) === teamNumber)
        .map((participant) => participant.username)
        .filter(Boolean);
    const blueNames = teamNames(1);
    const redNames = teamNames(2);
    const teamRows = [
        { key: "blue", label: "BLUE", names: blueNames, fallback: "Blue Team", score: finalHp ? formatHp(finalHp.blue) : null, isViewer: viewerTeam === 1, band: "bg-[#0c2a3a]", tag: "text-sky-300", pill: "bg-sky-400/15 text-sky-200" },
        { key: "red", label: "RED", names: redNames, fallback: "Red Team", score: finalHp ? formatHp(finalHp.red) : null, isViewer: viewerTeam === 2, band: "bg-[#3a1418]", tag: "text-rose-300", pill: "bg-rose-400/15 text-rose-200" },
    ];

    return (
        <div className="space-y-3 font-interface" aria-label="MATCH RESULT">
            <section className={`rounded-xl border px-3 py-4 text-center ${tone.box}`}>
                <h2 className={`font-display text-3xl font-bold ${tone.text}`} aria-live="polite">{tone.title}</h2>
                <p className="mt-1 text-[11px] text-slate-400">{subtitle}</p>
                {!cancelled && !failed && (
                    <div className="mt-3 space-y-2 text-left">
                        {teamRows.map((row) => {
                            const names = row.names.length ? row.names : [row.fallback];
                            const viewerIndex = row.isViewer ? Math.max(0, names.indexOf(player?.username)) : -1;
                            return (
                                <div key={row.key} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${row.band}`}>
                                    <span className={`w-10 shrink-0 font-['Chakra_Petch'] text-xs font-bold tracking-wider ${row.tag}`}>{row.label}</span>
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        {names.map((name, nameIndex) => (
                                            <p key={`${row.key}-${name}`} className="min-w-0 font-['Chakra_Petch'] text-[13px] font-semibold text-white [overflow-wrap:anywhere] sm:text-sm">
                                                {name}
                                                {nameIndex === viewerIndex && <span className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[11px] font-semibold ${row.pill}`}>You</span>}
                                            </p>
                                        ))}
                                    </div>
                                    {row.score != null && <p className="shrink-0 font-display text-xl font-bold text-white" aria-label={`${row.label} HP`}>{row.score} <span className="text-xs font-semibold text-slate-400">HP</span></p>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <RatingCard playback={playback} player={player} mode={mode} isCustomMatch={isCustomMatch} ratingChanges={ratingChanges} cancelled={cancelled || failed} isFinalMatchResult={isFinalMatchResult} />

            <div className="space-y-2">
                {onReturnToLobby ? (
                    <button type="button" onClick={onReturnToLobby} className="flex min-h-12 w-full items-center justify-center rounded-xl border-b-[3px] border-[#1f6b3f] bg-[#2fa866] font-display text-base font-bold text-white hover:bg-[#38bd74]">
                        RETURN TO LOBBY
                    </button>
                ) : !isCustomMatch && onQueueAgain && (
                    <button type="button" onClick={onQueueAgain} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-b-[3px] border-[#1f6b3f] bg-[#2fa866] font-display text-base font-bold text-white hover:bg-[#38bd74]">
                        QUEUE AGAIN
                    </button>
                )}
                {onHome && (
                    <button type="button" onClick={onHome} className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[#262c33] bg-[#12181d] text-sm font-semibold text-slate-200 hover:border-slate-500">
                        Home
                    </button>
                )}
            </div>
        </div>
    );
}

// Rating changes ride on the final MATCH_RESULT_READY event, so there is nothing to wait for once it
// has arrived: no rating in it means the match was not rated (guests, custom, cancelled).
function RatingCard({ playback, player, mode, isCustomMatch, ratingChanges, cancelled, isFinalMatchResult }) {
    const ranked = !isCustomMatch && ["ONES", "TWOS"].includes(String(mode ?? "").toUpperCase());
    const change = ratingChanges.find((entry) => entry.username === player?.username) ?? null;

    const modeText = String(mode ?? "").toUpperCase() === "TWOS" ? "2v2 ELO" : "1v1 ELO";
    if (!change) {
        const pending = ranked && !cancelled && !isFinalMatchResult && playback.result !== "MATCH_CANCELLED";
        return (
            <section className="rounded-xl border border-[#262c33] bg-[#0f1418] px-3 py-3 text-xs text-slate-400" aria-label="ELO">
                {pending ? "Rating updating…" : "Not rated"}
            </section>
        );
    }
    const delta = eloChangeValue({ ratingBefore: change.before, ratingAfter: change.after });
    const toneName = eloChangeTone({ ratingBefore: change.before, ratingAfter: change.after });
    const deltaColor = toneName === "up" ? "text-emerald-400" : toneName === "down" ? "text-rose-400" : "text-slate-300";
    return (
        <section className="flex items-center justify-between gap-3 rounded-xl border border-[#262c33] bg-[#0f1418] px-3 py-3" aria-label="ELO changes">
            <div>
                <p className="text-[10px] text-slate-500">{modeText}</p>
                <p className="font-display text-lg font-bold text-white">{change.before} <span className="text-slate-500">&rarr;</span> <span className="text-cyan-300">{change.after}</span></p>
            </div>
            <p className={`font-display text-3xl font-bold ${deltaColor}`}>{delta > 0 ? "+" : delta < 0 ? "−" : ""}{Math.abs(delta)}</p>
        </section>
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
    return <span className="font-display mb-3 flex items-center gap-2 text-base tracking-[.09em] text-sky-300">
        {icon === "bot" ? <BotLogo className="h-5 w-5 object-contain" /> : <MatchToolIcon name={icon} />}{children}
    </span>;
}

function formatReplayClock(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// Between segments there is no round winner: the fight carries on, so a segment only ends or continues.
function replayRoundResultTitle({ hasReachedReplayEnd }) {
    return hasReachedReplayEnd ? "Segment complete" : "Replay in progress";
}

function replayArenaShapes(bots, entities, recentFrames = [], entranceProgress = 1, frameIndex = 0, initialHandoff = false, viewerUserId = null, nativeFrames = false) {
    const damageEvents = replayDamageEvents(bots, entities, recentFrames);
    const replayPhase = entranceProgress < 1 ? "preparing" : initialHandoff ? "handoff" : "playback";
    const decorate = (shape) => ({
        ...shape, locked: true, interpolationMs: 0, replayFrameIndex: frameIndex, replayPhase,
        hitFlashMs: damageEvents.has(replayShapeKey(shape)) ? 200 : 0,
        hitParticleEvent: damageEvents.get(replayShapeKey(shape)) ?? null,
    });
    return [
        ...bots.map((bot) => ({ ...decorate(bot),
            x: replayEntranceX(bot, entranceProgress, ARENA_WIDTH_UNITS),
            isCurrentUser: viewerUserId != null ? sameId(bot.userId, viewerUserId) : bot.isCurrentUser,
        })),
        ...entities.map((entity) => decorate(nativeFrames ? entity : normalizeReplayObstacleShape(entity, null, { interpolationMs: 0 }))),
    ];
}

function forfeitWinnerBot(winner, teamIndex, teamSize, viewerUserId) {
    const loadout = winner.selectedLoadout ?? winner.combatLoadout ?? encodeBotLoadout({ abilities: [] });
    const position = centeredTeamPosition(teamIndex, teamSize, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS);
    return createBotState({
        id: `bot-${winner.userId}`, type: "bot",
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
    });
}

function sameId(left, right) {
    return left != null && right != null && String(left) === String(right);
}
