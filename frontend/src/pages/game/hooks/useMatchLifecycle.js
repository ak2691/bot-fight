import { useEffect, useMemo, useRef, useState } from "react";
import {
    ARENA_WIDTH_UNITS,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_Y,
} from "../../../gameArena/modelPayloads/arenaConstants";
import { decodeBotLoadout, DEFAULT_BOT_LOADOUT, encodeBotLoadout, normalizedBotLoadout } from "../../../gameArena/loadout/BotLoadout";
import { loadoutForFreshRound } from "../../../matchmaking/loadoutDraft.js";
import {
    disconnectActiveMatchmakingClient,
    getEstimatedOneWayNetworkDelayMs,
} from "../../../matchmaking/stompClient";
import { monotonicEpochNowMs } from "../../../matchmaking/networkDelayEstimator.js";
import {
    relativeLocalDeadlineMs,
    visibleLoadoutSelectionDeadlineMs,
} from "../../../matchmaking/relativeMatchTiming.js";
import {
    isOlderMatchRoundEvent,
    isSelectionEventForActivePhase,
    isSelectionPhaseStale,
    selectionPhaseForEvent,
} from "../../../matchmaking/selectionPhase.js";
import { isTerminalMatchEvent, shouldShowDisconnectNotice } from "../../../matchmaking/disconnectNoticeState.js";
import {
    createMatchmakingTerminalRedirect,
    isMatchAcceptanceUnavailableError,
} from "../../../matchmaking/matchAcceptanceTerminal.js";
import {
    acceptanceEventForClient,
    acceptanceStateForEvent,
    acceptanceVisibleStartMs,
    MATCH_ACCEPTANCE_SUBMISSION_GRACE_MS,
} from "../../../matchmaking/matchAcceptance.js";
import { localReplaySchedule, mergeReplayFrames } from "../../../replay/replayPresentation.js";
import useMatchmakingSocket from "./useMatchmakingSocket.js";

const COUNTDOWN_UPDATE_INTERVAL_MS = 250;

function secondsRemaining(countdownEndsAt, maximum = Number.POSITIVE_INFINITY) {
    if (!countdownEndsAt) return 0;
    return Math.min(maximum, Math.max(0, Math.ceil((countdownEndsAt - monotonicEpochNowMs()) / 1000)));
}

function toLocalDeadlineMs(
    targetTime,
    serverNowTime,
    localNowMs = monotonicEpochNowMs(),
    estimatedOneWayDelayMs = 0,
    visibleGraceMs = 0,
) {
    if (!targetTime) return null;

    return relativeLocalDeadlineMs({
        deadlineServerTime: targetTime,
        serverTransmitTime: serverNowTime,
        localReceiveTimeMs: localNowMs,
        estimatedOneWayDelayMs,
        visibleGraceMs,
    });
}

function toLocalDurationDeadlineMs(durationMs, localNowMs, estimatedOneWayDelayMs = 0) {
    const duration = Number(durationMs);
    const oneWayDelay = Number(estimatedOneWayDelayMs);
    if (!Number.isFinite(duration) || !Number.isFinite(Number(localNowMs))) return null;
    return Number(localNowMs) + Math.max(0, duration - (Number.isFinite(oneWayDelay) ? Math.max(0, oneWayDelay) : 0));
}

function normalizeEventTimes(event, estimatedOneWayDelayMs, localNowMs = monotonicEpochNowMs()) {
    return {
        ...event,
        matchAcceptanceEndsAtMs: toLocalDeadlineMs(
            event.matchAcceptanceEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
            MATCH_ACCEPTANCE_SUBMISSION_GRACE_MS,
        ),
        matchAcceptanceAuthoritativeEndsAtMs: toLocalDeadlineMs(
            event.matchAcceptanceEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        loadoutSelectionEndsAtMs: toLocalDeadlineMs(
            event.loadoutSelectionEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        entityPlacementEndsAtMs: toLocalDeadlineMs(
            event.entityPlacementEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        countdownEndsAtMs: toLocalDeadlineMs(
            event.countdownEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        buildingEndsAtMs: toLocalDeadlineMs(
            event.buildingEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
            2_000,
        ),
        playbackStartsAtMs: event.type === "SIMULATION_PREPARING" && (!event.playbackStartsAt || !event.serverNow)
            ? toLocalDurationDeadlineMs(
                event.simulationPreparingDurationMs,
                localNowMs,
                estimatedOneWayDelayMs,
            )
            : toLocalDeadlineMs(
                event.playbackStartsAt,
                event.serverNow,
                localNowMs,
                estimatedOneWayDelayMs,
            ),
        resultRevealsAtMs: toLocalDeadlineMs(
            event.resultRevealsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        roundReadyAtMs: toLocalDeadlineMs(
            event.roundReadyAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        matchChatEndsAtMs: toLocalDeadlineMs(
            event.matchChatEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        disconnectEndsAtMs: toLocalDeadlineMs(
            event.disconnectEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
    };
}

export function useMatchLifecycle({ initialRouteMatchEvent, navigate }) {
    const initialMatchEventPayload = useMemo(() => {
        if (!initialRouteMatchEvent) return null;
        const normalized = normalizeEventTimes(initialRouteMatchEvent, null);
        return normalized.status === "MATCH_ACCEPT"
            ? acceptanceEventForClient(normalized)
            : normalized;
    }, [initialRouteMatchEvent]);
    const initialMatchEvent = initialMatchEventPayload;
    const clientRef = useRef(null);
    const playbackRef = useRef(null);
    const matchEventRef = useRef(null);
    const matchAcceptanceDeadlineRef = useRef(null);
    const matchAcceptanceAuthoritativeDeadlineRef = useRef(null);
    const matchAcceptanceStartDeadlineRef = useRef(null);
    const loadoutSelectionDeadlineRef = useRef(null);
    const matchAcceptanceSubmitPendingRef = useRef(false);
    const loadoutSubmitPendingRef = useRef(false);
    const placementSubmittedRef = useRef(false);
    const placementSubmitPendingRef = useRef(false);
    const initialQueueStatus = initialMatchEvent?.status === "MATCH_ACCEPT"
        ? "MATCH_ACCEPT"
        : initialMatchEvent?.status === "LOADOUT_SELECT" ? "LOADOUT_SELECT" : "CONNECTING";
    const queueStatusRef = useRef(initialQueueStatus);
    const [queueStatus, setQueueStatus] = useState(initialQueueStatus);
    const [matchEvent, setMatchEvent] = useState(initialMatchEvent);
    const [playback, setPlayback] = useState(null);
    const [remaining, setRemaining] = useState(0);
    const [matchAcceptanceDeadlineMs, setMatchAcceptanceDeadlineMs] = useState(null);
    const [matchAcceptanceAuthoritativeRemaining, setMatchAcceptanceAuthoritativeRemaining] = useState(0);
    const [matchAcceptanceStartDeadlineMs, setMatchAcceptanceStartDeadlineMs] = useState(null);
    const [matchAcceptanceState, setMatchAcceptanceState] = useState("READY");
    const [matchAcceptanceError, setMatchAcceptanceError] = useState(null);
    const [loadoutSubmitPending, setLoadoutSubmitPending] = useState(false);
    const [hasFinished, setHasFinished] = useState(false);
    const [finishPending, setFinishPending] = useState(false);
    const [hasSurrendered, setHasSurrendered] = useState(false);
    const [surrenderPending, setSurrenderPending] = useState(false);
    const [finishError, setFinishError] = useState(null);
    const [disconnectNotice, setDisconnectNotice] = useState(null);
    const [disconnectRemaining, setDisconnectRemaining] = useState(0);
    const [, setPlacementSubmitPending] = useState(false);
    const [, setConfirmedPlacementObjects] = useState([]);
    const [loadoutChoice, setLoadoutChoice] = useState(() => normalizedBotLoadout(DEFAULT_BOT_LOADOUT));
    const [chatMessages, setChatMessages] = useState([]);
    const [chatMinimized, setChatMinimized] = useState(true);
    const [chatRateLimitNotice, setChatRateLimitNotice] = useState(null);
    const [chatClosed, setChatClosed] = useState(false);
    const [chatClosedNotice, setChatClosedNotice] = useState(null);
    const chatMinimizedRef = useRef(false);
    const chatNoticeTimeoutRef = useRef(null);
    const intentionalSocketCloseRef = useRef(false);
    const closeSocketAfterChatRef = useRef(false);
    const disconnectNoticeResetAtRef = useRef(0);
    const loadoutSelectionPhaseRef = useRef(selectionPhaseForEvent(initialMatchEvent));
    const terminalMatchRef = useRef(isTerminalMatchEvent(initialMatchEvent));
    const redirectToHomeForTerminalEvent = useMemo(
        () => createMatchmakingTerminalRedirect(navigate),
        [navigate],
    );

    useEffect(() => {
        playbackRef.current = playback;
    }, [playback]);

    useEffect(() => {
        chatMinimizedRef.current = chatMinimized;
    }, [chatMinimized]);

    const updateQueueStatus = (status) => {
        queueStatusRef.current = status;
        setQueueStatus(status);
    };
    const setCurrentMatchEvent = (event) => {
        matchEventRef.current = event;
        setMatchEvent(event);
    };
    const exitToHome = () => {
        navigate("/home");
    };

    /* The route can arrive with an already-authoritative match event whose local deadlines need hydration. */
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (initialMatchEventPayload) {
            const initialEstimatedOneWayDelayMs = getEstimatedOneWayNetworkDelayMs();
            const normalizedInitialEvent = normalizeEventTimes(
                initialMatchEventPayload,
                initialEstimatedOneWayDelayMs,
            );
            setCurrentMatchEvent(normalizedInitialEvent);
            if (normalizedInitialEvent.status === "MATCH_ACCEPT") {
                matchAcceptanceDeadlineRef.current = normalizedInitialEvent.matchAcceptanceEndsAtMs;
                matchAcceptanceAuthoritativeDeadlineRef.current = normalizedInitialEvent.matchAcceptanceAuthoritativeEndsAtMs;
                matchAcceptanceStartDeadlineRef.current = acceptanceVisibleStartMs(
                    normalizedInitialEvent.matchAcceptanceEndsAtMs,
                );
                setMatchAcceptanceDeadlineMs(normalizedInitialEvent.matchAcceptanceEndsAtMs);
                setMatchAcceptanceStartDeadlineMs(matchAcceptanceStartDeadlineRef.current);
                setMatchAcceptanceState(acceptanceStateForEvent(normalizedInitialEvent));
                setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
                setMatchAcceptanceAuthoritativeRemaining(
                    secondsRemaining(matchAcceptanceAuthoritativeDeadlineRef.current),
                );
            } else if (normalizedInitialEvent.status === "LOADOUT_SELECT") {
                loadoutSelectionDeadlineRef.current = visibleLoadoutSelectionDeadlineMs(
                    normalizedInitialEvent.loadoutSelectionEndsAtMs,
                    initialEstimatedOneWayDelayMs,
                );
                setRemaining(secondsRemaining(loadoutSelectionDeadlineRef.current));
            }
        }
    }, [initialMatchEventPayload]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const handleChatEvent = (event) => {
        if (event.matchId && matchEventRef.current?.matchId
            && String(event.matchId) !== String(matchEventRef.current.matchId)) return;
        if (event.type === "MATCH_CHAT_RATE_LIMITED") {
            setChatRateLimitNotice(event.message ?? "You are sending messages too quickly.");
            if (chatNoticeTimeoutRef.current != null) clearTimeout(chatNoticeTimeoutRef.current);
            chatNoticeTimeoutRef.current = setTimeout(() => setChatRateLimitNotice(null), 2500);
            return;
        }
        if (event.type === "MATCH_CHAT_CLOSED") {
            setChatClosed(true);
            setChatClosedNotice(event.message ?? "Match chat is now closed.");
            intentionalSocketCloseRef.current = true;
            closeSocketAfterChatRef.current = true;
            const activeClient = clientRef.current;
            if (activeClient) void disconnectActiveMatchmakingClient(activeClient);
            return;
        }
        if (event.type !== "MATCH_CHAT_MESSAGE") return;
        setChatMessages((current) => current.some((message) => message.messageId === event.messageId)
            ? current
            : [...current, { ...event, unread: chatMinimizedRef.current }].slice(-100));
    };

    const handleSocketStatus = (status) => {
        if (status === "ERROR" || status === "CLOSED") {
            if (intentionalSocketCloseRef.current) return;
            if (terminalMatchRef.current) return;
            matchAcceptanceSubmitPendingRef.current = false;
            setMatchAcceptanceState(queueStatusRef.current === "MATCH_ACCEPT"
                ? acceptanceStateForEvent(matchEventRef.current)
                : "READY");
            if (queueStatusRef.current === "MATCH_ACCEPT") {
                setMatchAcceptanceError("Connection lost. Reconnecting...");
            }
            loadoutSubmitPendingRef.current = false;
            setLoadoutSubmitPending(false);
            placementSubmitPendingRef.current = false;
            setPlacementSubmitPending(false);
            setFinishPending(false);
            setSurrenderPending(false);
            if (matchEventRef.current?.matchId) {
                setDisconnectNotice({
                    endsAtMs: null,
                    message: "Connection lost. Reconnect now to remain in the match.",
                    self: true,
                });
                setDisconnectRemaining(null);
            }
        }
    };

    const handleMatchEvent = (rawEvent, eventReceivedAtMs = monotonicEpochNowMs()) => {
        const estimatedOneWayDelayMs = getEstimatedOneWayNetworkDelayMs();
        const event = normalizeEventTimes(
            rawEvent,
            estimatedOneWayDelayMs,
            eventReceivedAtMs,
        );
        if (isOlderMatchRoundEvent(event, matchEventRef.current)) return;
        const isSelectionPhaseStart = (
            event.type === "MATCH_STARTED"
            || event.type === "MATCH_LOADOUT_SELECTION_READY"
            || event.type === "MATCH_ROUND_READY"
            || (event.type === "MATCH_FOUND" && event.status === "LOADOUT_SELECT")
        ) && event.status === "LOADOUT_SELECT";
        if (isSelectionPhaseStart) {
            const incomingPhase = selectionPhaseForEvent(event);
            if (isSelectionPhaseStale(incomingPhase, loadoutSelectionPhaseRef.current)) return;
            if (incomingPhase) loadoutSelectionPhaseRef.current = incomingPhase;
        }
        if ((event.type === "MATCH_LOADOUT_SELECTED"
            || event.type === "BOT_BUILDING_SESSION_READY")
            && !isSelectionEventForActivePhase(event, loadoutSelectionPhaseRef.current)) return;
        if (redirectToHomeForTerminalEvent({
            event,
            acceptanceActive: queueStatusRef.current === "MATCH_ACCEPT",
            currentMatchId: matchEventRef.current?.matchId ?? initialMatchEventPayload?.matchId,
        })) {
            return;
        }
        const enterBuildingRoomAtDeadline = () => {
            updateQueueStatus("PREP");
        };
        const eventServerNowMs = event.serverNow
            ? eventReceivedAtMs - estimatedOneWayDelayMs
            : eventReceivedAtMs;
        const terminalEvent = isTerminalMatchEvent(event);
        if (terminalEvent) {
            terminalMatchRef.current = true;
            disconnectNoticeResetAtRef.current = Number.POSITIVE_INFINITY;
            setDisconnectNotice(null);
            setDisconnectRemaining(0);
        } else if (event.type === "MATCH_FOUND" || event.type === "MATCH_STARTED") {
            terminalMatchRef.current = false;
            disconnectNoticeResetAtRef.current = 0;
            setDisconnectNotice(null);
            setDisconnectRemaining(0);
        }
        if (shouldShowDisconnectNotice({
            event,
            terminalMatch: terminalMatchRef.current,
            eventServerNowMs,
            resetAtMs: disconnectNoticeResetAtRef.current,
        })) {
            const self = Boolean(event.player?.userId)
                && String(event.disconnectedUserId) === String(event.player.userId);
            setDisconnectNotice({
                endsAtMs: event.disconnectEndsAtMs,
                message: self
                    ? "Connection lost. Reconnect within 30 seconds or the match will be forfeited."
                    : `${event.opponent?.username ?? "Your opponent"} disconnected. They have 30 seconds to return.`,
                self,
            });
            setDisconnectRemaining(secondsRemaining(event.disconnectEndsAtMs, 30));
        }
        if (event.type === "QUEUE_WAITING") {
            updateQueueStatus("WAITING");
        }
        if (event.type === "MATCH_FOUND" && event.status === "MATCH_ACCEPT") {
            if (queueStatusRef.current !== "MATCH_ACCEPT"
                && queueStatusRef.current !== "CONNECTING") return;
            const acceptanceEvent = acceptanceEventForClient(event);
            const samePendingMatch = matchEventRef.current?.matchId
                && String(matchEventRef.current.matchId) === String(acceptanceEvent.matchId);
            if (!samePendingMatch || matchAcceptanceDeadlineRef.current == null) {
                matchAcceptanceDeadlineRef.current = event.matchAcceptanceEndsAtMs;
                matchAcceptanceAuthoritativeDeadlineRef.current = event.matchAcceptanceAuthoritativeEndsAtMs;
                matchAcceptanceStartDeadlineRef.current = acceptanceVisibleStartMs(
                    event.matchAcceptanceEndsAtMs,
                );
                setMatchAcceptanceDeadlineMs(matchAcceptanceDeadlineRef.current);
                setMatchAcceptanceStartDeadlineMs(matchAcceptanceStartDeadlineRef.current);
            }
            setCurrentMatchEvent(acceptanceEvent);
            setMatchAcceptanceState(acceptanceStateForEvent(acceptanceEvent));
            setMatchAcceptanceError(null);
            matchAcceptanceSubmitPendingRef.current = false;
            updateQueueStatus("MATCH_ACCEPT");
            setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
            setMatchAcceptanceAuthoritativeRemaining(
                secondsRemaining(matchAcceptanceAuthoritativeDeadlineRef.current),
            );
            return;
        }
        if (event.type === "MATCH_ACCEPTED" && event.status === "MATCH_ACCEPT") {
            if (queueStatusRef.current !== "MATCH_ACCEPT") return;
            const acceptanceEvent = acceptanceEventForClient(event);
            setCurrentMatchEvent(acceptanceEvent);
            setMatchAcceptanceState(acceptanceStateForEvent(acceptanceEvent));
            setMatchAcceptanceError(null);
            matchAcceptanceSubmitPendingRef.current = false;
            updateQueueStatus("MATCH_ACCEPT");
            setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
            setMatchAcceptanceAuthoritativeRemaining(
                secondsRemaining(matchAcceptanceAuthoritativeDeadlineRef.current),
            );
            return;
        }
        if (event.type === "MATCH_STARTED"
            || (event.type === "MATCH_FOUND" && event.status !== "MATCH_ACCEPT")) {
            matchAcceptanceDeadlineRef.current = null;
            matchAcceptanceAuthoritativeDeadlineRef.current = null;
            matchAcceptanceStartDeadlineRef.current = null;
            setMatchAcceptanceDeadlineMs(null);
            setMatchAcceptanceAuthoritativeRemaining(0);
            setMatchAcceptanceStartDeadlineMs(null);
            setMatchAcceptanceState("READY");
            setMatchAcceptanceError(null);
            matchAcceptanceSubmitPendingRef.current = false;
            loadoutSubmitPendingRef.current = false;
            setLoadoutSubmitPending(false);
            loadoutSelectionDeadlineRef.current = event.status === "LOADOUT_SELECT"
                ? visibleLoadoutSelectionDeadlineMs(
                    event.loadoutSelectionEndsAtMs,
                    estimatedOneWayDelayMs,
                )
                : null;
            setCurrentMatchEvent(event);
            if (event.status === "LOADOUT_SELECT") updateQueueStatus("LOADOUT_SELECT");
            else if (event.status === "PREP") enterBuildingRoomAtDeadline();
            else updateQueueStatus(event.status);
            setRemaining(event.status === "LOADOUT_SELECT"
                ? secondsRemaining(loadoutSelectionDeadlineRef.current)
                : 0);
            setLoadoutChoice(decodeBotLoadout(event.player?.selectedLoadout));
            playbackRef.current = null;
            setPlayback(null);
            setHasFinished(false);
            setFinishPending(false);
            setFinishError(null);
            setHasSurrendered(false);
            setSurrenderPending(false);
            setChatClosed(false);
            setChatClosedNotice(null);
            setChatMessages([]);
            placementSubmittedRef.current = false;
            placementSubmitPendingRef.current = false;
            setPlacementSubmitPending(false);
            setConfirmedPlacementObjects([]);
        }
        if (event.type === "MATCH_LOADOUT_SELECTION_READY") {
            loadoutSubmitPendingRef.current = false;
            setLoadoutSubmitPending(false);
            loadoutSelectionDeadlineRef.current = visibleLoadoutSelectionDeadlineMs(
                event.loadoutSelectionEndsAtMs,
                estimatedOneWayDelayMs,
            );
            setCurrentMatchEvent(event);
            updateQueueStatus("LOADOUT_SELECT");
            setRemaining(secondsRemaining(loadoutSelectionDeadlineRef.current));
        }
        if (event.type === "MATCH_LOADOUT_SELECTED") {
            setCurrentMatchEvent(event);
            updateQueueStatus("LOADOUT_SELECT");
            if (event.player?.loadoutSelected) {
                loadoutSubmitPendingRef.current = false;
                setLoadoutSubmitPending(false);
                setLoadoutChoice(decodeBotLoadout(event.player.selectedLoadout));
            }
        }
        if (event.type === "BOT_BUILDING_SESSION_READY") {
            loadoutSubmitPendingRef.current = false;
            setLoadoutSubmitPending(false);
            loadoutSelectionDeadlineRef.current = null;
            setCurrentMatchEvent(event);
            enterBuildingRoomAtDeadline();
            setRemaining(0);
            setLoadoutChoice(decodeBotLoadout(event.player?.selectedLoadout));
            placementSubmitPendingRef.current = false;
            setPlacementSubmitPending(false);
        }
        if (event.type === "MATCH_ROUND_READY") {
            loadoutSubmitPendingRef.current = false;
            setLoadoutSubmitPending(false);
            loadoutSelectionDeadlineRef.current = visibleLoadoutSelectionDeadlineMs(
                event.loadoutSelectionEndsAtMs,
                estimatedOneWayDelayMs,
            );
            setCurrentMatchEvent(event);
            playbackRef.current = null;
            setPlayback(null);
            updateQueueStatus(event.status === "LOADOUT_SELECT" ? "LOADOUT_SELECT" : "PREP");
            setRemaining(event.status === "LOADOUT_SELECT"
                ? secondsRemaining(loadoutSelectionDeadlineRef.current)
                : 0);
            setHasFinished(false);
            setFinishPending(false);
            setHasSurrendered(false);
            setSurrenderPending(false);
            setLoadoutChoice(loadoutForFreshRound(
                decodeBotLoadout(event.player?.selectedLoadout),
                event.roundNumber,
            ));
            placementSubmittedRef.current = false;
            placementSubmitPendingRef.current = false;
            setPlacementSubmitPending(false);
            setConfirmedPlacementObjects([]);
        }
        if (event.type === "PLAYER_FINISHED") {
            setCurrentMatchEvent(event);
            updateQueueStatus(event.status);
            if (event.player?.finished) {
                setHasFinished(true);
                setFinishPending(false);
            }
        }
        if (event.type === "PLAYER_RECONNECTED") {
            disconnectNoticeResetAtRef.current = eventServerNowMs;
            setDisconnectNotice(null);
            setDisconnectRemaining(0);
            const playbackStartsAtMs = event.playbackStartsAtMs;
            if (playbackStartsAtMs != null
                && playbackStartsAtMs > monotonicEpochNowMs()) {
                setCurrentMatchEvent(event);
                const preparationPlayback = buildPreparationPlayback(event);
                if (preparationPlayback && !playbackRef.current) {
                    playbackRef.current = preparationPlayback;
                    setPlayback(preparationPlayback);
                    updateQueueStatus("PLAYBACK");
                }
            }
        }
        if (event.type === "SIMULATION_LOADING") {
            setCurrentMatchEvent(event);
            playbackRef.current = null;
            setPlayback(null);
            updateQueueStatus("SIMULATION_LOADING");
            setRemaining(0);
        }
        if (isMatchAcceptanceUnavailableError(event)) {
            matchAcceptanceSubmitPendingRef.current = false;
            setMatchAcceptanceError(event.message ?? "The match acceptance window is no longer available.");
            updateQueueStatus("WAITING");
            return;
        }
        if (event.type === "MATCH_ERROR") {
            matchAcceptanceSubmitPendingRef.current = false;
            setMatchAcceptanceState(queueStatusRef.current === "MATCH_ACCEPT"
                ? acceptanceStateForEvent(matchEventRef.current)
                : "READY");
            setMatchAcceptanceError(event.message ?? "The server rejected the match action.");
            loadoutSubmitPendingRef.current = false;
            setLoadoutSubmitPending(false);
            setFinishPending(false);
            setSurrenderPending(false);
            setHasFinished(false);
            setFinishError(event.message ?? "The server rejected the bot submission. Review the bot and try again.");
        }
        if (event.type === "SIMULATION_PREPARING") {
            setCurrentMatchEvent(event);
            const localSchedule = localReplaySchedule(
                event.playbackStartsAtMs,
                event.resultRevealsAtMs,
            );
            const roundWinsBeforeResult = Object.fromEntries(
                (event.players ?? [event.player, event.opponent].filter(Boolean))
                    .filter((participant) => participant?.userId != null)
                    .map((participant) => {
                        const wonCurrentRound = event.playback?.winnerUserId != null
                            && String(participant.userId) === String(event.playback.winnerUserId);
                        return [
                            String(participant.userId),
                            Math.max(0, (Number(participant.roundWins) || 0) - (wonCurrentRound ? 1 : 0)),
                        ];
                    })
            );
            const nextPlayback = buildPreparationPlayback(event);
            if (nextPlayback) {
                Object.assign(nextPlayback, {
                    roundWinsBeforeResult,
                    playbackStartsAtMs: localSchedule.playbackStartsAtMs,
                    resultRevealsAt: event.resultRevealsAt,
                    resultRevealsAtMs: localSchedule.resultRevealsAtMs,
                    roundReadyAt: event.roundReadyAt,
                    roundReadyAtMs: event.roundReadyAtMs,
                    matchChatEndsAt: event.matchChatEndsAt,
                    matchChatEndsAtMs: event.matchChatEndsAtMs,
                });
                playbackRef.current = nextPlayback;
                setPlayback(nextPlayback);
                updateQueueStatus("PLAYBACK");
                placementSubmittedRef.current = false;
                placementSubmitPendingRef.current = false;
                setPlacementSubmitPending(false);
            }
        }
        if (event.type === "MATCH_REPLAY_BATCH") {
            if (playbackRef.current?.roundNumber != null
                && event.roundNumber != null
                && Number(playbackRef.current.roundNumber) !== Number(event.roundNumber)) return;
            setPlayback((currentPlayback) => {
                if (!currentPlayback) return currentPlayback;
                const incomingSequence = Number(event.playback?.batchSequence);
                const currentSequence = Number(currentPlayback.batchSequence);
                const incomingBatchIsStale = Number.isFinite(incomingSequence)
                    && Number.isFinite(currentSequence)
                    && incomingSequence <= currentSequence;
                if (incomingBatchIsStale) return currentPlayback;
                const nextPlayback = {
                    ...currentPlayback,
                    player: event.playback?.terminalBatch ? event.player ?? currentPlayback.player : currentPlayback.player,
                    opponent: event.playback?.terminalBatch ? event.opponent ?? currentPlayback.opponent : currentPlayback.opponent,
                    players: event.playback?.terminalBatch && event.players?.length
                        ? event.players
                        : currentPlayback.players,
                    frames: mergeReplayFrames(currentPlayback.frames, event.playback?.frames),
                    batchSequence: event.playback?.batchSequence ?? currentPlayback.batchSequence,
                    replayCursorElapsedMs: event.playback?.replayCursorElapsedMs
                        ?? currentPlayback.replayCursorElapsedMs,
                    terminalBatch: Boolean(event.playback?.terminalBatch || currentPlayback.terminalBatch),
                    status: event.playback?.status ?? currentPlayback.status,
                    result: event.playback?.result ?? currentPlayback.result,
                    winnerUserId: event.playback?.winnerUserId ?? currentPlayback.winnerUserId,
                    message: event.playback?.message ?? currentPlayback.message,
                };
                playbackRef.current = nextPlayback;
                return nextPlayback;
            });
        }
        if (event.type === "MATCH_RESULT_READY") {
            setSurrenderPending(false);
            if (event.playback?.result === "RESIGNATION_WIN"
                && event.playback?.winnerUserId
                && event.player?.userId
                && String(event.playback.winnerUserId) !== String(event.player.userId)) {
                setHasSurrendered(true);
            }
            setCurrentMatchEvent(event);
            setDisconnectNotice(null);
            setDisconnectRemaining(0);
            setPlayback((currentPlayback) => {
                const isDisconnectResult = event.playback?.result === "DISCONNECTION_WIN";
                const nextPlayback = isDisconnectResult
                    ? {
                        ...(event.playback ?? {}),
                        player: event.player,
                        opponent: event.opponent,
                        players: event.players,
                        roundNumber: event.roundNumber,
                        winsRequired: event.winsRequired,
                        playbackStartsAt: event.playbackStartsAt,
                        playbackStartsAtMs: event.playbackStartsAtMs,
                        resultRevealsAt: event.resultRevealsAt,
                        resultRevealsAtMs: event.resultRevealsAtMs,
                        roundReadyAt: event.roundReadyAt,
                        roundReadyAtMs: event.roundReadyAtMs,
                        matchChatEndsAt: event.matchChatEndsAt,
                        matchChatEndsAtMs: event.matchChatEndsAtMs,
                    }
                    : {
                    ...(event.playback ?? {}),
                    ...(currentPlayback ?? {}),
                    playbackStartsAt: event.playbackStartsAt ?? currentPlayback?.playbackStartsAt,
                    playbackStartsAtMs: currentPlayback?.playbackStartsAtMs ?? event.playbackStartsAtMs,
                    resultRevealsAt: event.resultRevealsAt ?? currentPlayback?.resultRevealsAt,
                    resultRevealsAtMs: currentPlayback?.resultRevealsAtMs ?? event.resultRevealsAtMs,
                    roundReadyAt: event.roundReadyAt ?? currentPlayback?.roundReadyAt,
                    roundReadyAtMs: currentPlayback?.roundReadyAtMs ?? event.roundReadyAtMs,
                    matchChatEndsAt: event.matchChatEndsAt ?? currentPlayback?.matchChatEndsAt,
                    matchChatEndsAtMs: currentPlayback?.matchChatEndsAtMs ?? event.matchChatEndsAtMs,
                    status: event.playback?.status ?? currentPlayback?.status,
                    result: event.playback?.result ?? currentPlayback?.result,
                    winnerUserId: event.playback?.winnerUserId ?? currentPlayback?.winnerUserId,
                    message: event.playback?.message ?? event.message ?? currentPlayback?.message,
                    player: event.player ?? currentPlayback?.player,
                    opponent: event.opponent ?? currentPlayback?.opponent,
                    players: event.players ?? currentPlayback?.players,
                    roundNumber: event.roundNumber ?? currentPlayback?.roundNumber,
                    winsRequired: event.winsRequired ?? currentPlayback?.winsRequired,
                };
                playbackRef.current = nextPlayback;
                return nextPlayback;
            });
        }
    };

    const { socketStatus } = useMatchmakingSocket({
        clientRef,
        closeSocketAfterChatRef,
        onChatEvent: handleChatEvent,
        onStatus: handleSocketStatus,
        onEvent: handleMatchEvent,
    });

    useEffect(() => {
        if (queueStatus === "WAITING") {
            navigate("/home", { replace: true });
        }
    }, [navigate, queueStatus]);

    useEffect(() => {
        if (!disconnectNotice?.endsAtMs) return;
        const update = () => setDisconnectRemaining(secondsRemaining(disconnectNotice.endsAtMs, 30));
        update();
        const interval = setInterval(update, 100);
        return () => clearInterval(interval);
    }, [disconnectNotice]);

    useEffect(() => {
        if (queueStatus !== "MATCH_ACCEPT" && queueStatus !== "LOADOUT_SELECT") return;

        const interval = setInterval(() => {
            if (queueStatus === "MATCH_ACCEPT") {
                const nowMs = monotonicEpochNowMs();
                setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
                setMatchAcceptanceAuthoritativeRemaining(
                    secondsRemaining(matchAcceptanceAuthoritativeDeadlineRef.current, nowMs),
                );
                if (matchAcceptanceAuthoritativeDeadlineRef.current != null
                    && nowMs >= matchAcceptanceAuthoritativeDeadlineRef.current) {
                    updateQueueStatus("WAITING");
                }
                return;
            }
            setRemaining(secondsRemaining(loadoutSelectionDeadlineRef.current));
        }, COUNTDOWN_UPDATE_INTERVAL_MS);
        if (queueStatus === "MATCH_ACCEPT") {
            const nowMs = monotonicEpochNowMs();
            setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current, nowMs));
            setMatchAcceptanceAuthoritativeRemaining(
                secondsRemaining(matchAcceptanceAuthoritativeDeadlineRef.current, nowMs),
            );
        } else {
            setRemaining(secondsRemaining(loadoutSelectionDeadlineRef.current));
        }

        return () => clearInterval(interval);
    }, [queueStatus]);

    const finishMatch = () => {
        if (finishPending || hasFinished || socketStatus !== "CONNECTED") return;
        setFinishError(null);
        setFinishPending(true);
    };

    const surrenderMatch = () => {
        if (surrenderPending || hasSurrendered || socketStatus !== "CONNECTED") return;
        setSurrenderPending(true);
        clientRef.current?.surrender();
    };

    const lockLoadout = () => {
        if (loadoutSubmitPending || matchEvent?.player?.loadoutSelected || socketStatus !== "CONNECTED") return;
        loadoutSubmitPendingRef.current = true;
        setLoadoutSubmitPending(true);
        clientRef.current?.selectLoadout(encodeBotLoadout(loadoutChoice));
    };

    const acceptMatch = () => {
        if (matchAcceptanceState !== "READY"
            || !matchEventRef.current?.matchId
            || socketStatus !== "CONNECTED"
            || matchAcceptanceAuthoritativeDeadlineRef.current == null
            || monotonicEpochNowMs() >= matchAcceptanceAuthoritativeDeadlineRef.current) return;
        setMatchAcceptanceError(null);
        matchAcceptanceSubmitPendingRef.current = true;
        setMatchAcceptanceState("ACCEPTING");
        clientRef.current?.acceptMatch(matchEventRef.current.matchId);
    };

    const cancelAcceptance = () => {
        if (matchEventRef.current?.matchId) {
            clientRef.current?.cancelMatch(matchEventRef.current.matchId);
        }
        exitToHome();
    };

    const sendChatMessage = (message) => {
        if (!matchEventRef.current?.matchId || chatClosed || socketStatus !== "CONNECTED") return;
        clientRef.current?.sendChat(matchEventRef.current.matchId, message);
    };

    const opponent = matchEvent?.opponent ?? null;
    const handleChatMinimizedChange = (next) => {
        setChatMinimized(next);
        if (!next) setChatMessages((current) => current.map((message) => ({ ...message, unread: false })));
    };

    const matchContext = useMemo(() => ({
        matchId: matchEvent?.matchId,
        simulationSeed: matchEvent?.simulationSeed,
        player: matchEvent?.player,
        opponent,
        players: matchEvent?.players ?? [],
        buildingEndsAt: matchEvent?.buildingEndsAt,
        buildingEndsAtMs: matchEvent?.buildingEndsAtMs,
        roundReadyAt: matchEvent?.roundReadyAt,
        roundReadyAtMs: matchEvent?.roundReadyAtMs,
        matchChatEndsAt: matchEvent?.matchChatEndsAt,
        matchChatEndsAtMs: matchEvent?.matchChatEndsAtMs,
        entityPlacementEndsAt: matchEvent?.entityPlacementEndsAt,
        entityPlacementEndsAtMs: matchEvent?.entityPlacementEndsAtMs,
        rulesetVersion: matchEvent?.rulesetVersion,
        roundNumber: matchEvent?.roundNumber,
        winsRequired: matchEvent?.winsRequired,
        arenaEntities: matchEvent?.arenaEntities ?? [],
        roundBrains: matchEvent?.roundBrains ?? [],
        previousRoundWon: matchEvent?.previousRoundWon ?? null,
        roundBlockLimit: matchEvent?.roundBlockLimit ?? 10,
        message: matchEvent?.message,
        status: matchEvent?.status,
        loadout: loadoutChoice,
        opponentLoadout: decodeBotLoadout(matchEvent?.opponent?.selectedLoadout),
    }), [
        matchEvent?.matchId,
        matchEvent?.simulationSeed,
        matchEvent?.player,
        opponent,
        matchEvent?.players,
        matchEvent?.buildingEndsAt,
        matchEvent?.buildingEndsAtMs,
        matchEvent?.roundReadyAt,
        matchEvent?.roundReadyAtMs,
        matchEvent?.matchChatEndsAt,
        matchEvent?.matchChatEndsAtMs,
        matchEvent?.entityPlacementEndsAt,
        matchEvent?.entityPlacementEndsAtMs,
        matchEvent?.rulesetVersion,
        matchEvent?.roundNumber,
        matchEvent?.winsRequired,
        matchEvent?.arenaEntities,
        matchEvent?.roundBrains,
        matchEvent?.previousRoundWon,
        matchEvent?.roundBlockLimit,
        matchEvent?.message,
        matchEvent?.status,
        matchEvent?.opponent?.selectedLoadout,
        loadoutChoice,
    ]);

    useEffect(() => () => {
        loadoutSelectionDeadlineRef.current = null;
        if (chatNoticeTimeoutRef.current != null) clearTimeout(chatNoticeTimeoutRef.current);
    }, []);

    return {
        queueStatus,
        socketStatus,
        matchEvent,
        playback,
        matchContext,
        remaining,
        matchAcceptanceDeadlineMs,
        matchAcceptanceAuthoritativeRemaining,
        matchAcceptanceStartDeadlineMs,
        matchAcceptanceState,
        matchAcceptanceError,
        loadoutChoice,
        setLoadoutChoice,
        loadoutSubmitPending,
        hasFinished,
        finishPending,
        hasSurrendered,
        surrenderPending,
        finishError,
        disconnectNotice,
        disconnectRemaining,
        chatMessages,
        chatMinimized,
        chatRateLimitNotice,
        chatClosed,
        chatClosedNotice,
        handleChatMinimizedChange,
        finishMatch,
        surrenderMatch,
        lockLoadout,
        acceptMatch,
        cancelAcceptance,
        sendChatMessage,
        exitToHome,
        preloadShapes: arenaPreloadShapes(matchEvent),
    };

}


function buildPreparationPlayback(event) {
    const playback = event.playback;
    if (!playback?.initialState?.bots?.length) return null;
    const participants = Array.isArray(event.players) && event.players.length > 0
        ? event.players
        : [event.player, event.opponent].filter(Boolean);
    return {
        ...playback,
        matchId: event.matchId,
        rulesetVersion: event.rulesetVersion,
        player: event.player ?? playback.player,
        opponent: event.opponent ?? playback.opponent,
        players: participants,
        roundNumber: event.roundNumber,
        winsRequired: event.winsRequired,
        playbackStartsAt: event.playbackStartsAt,
        playbackStartsAtMs: event.playbackStartsAtMs,
    };
}

function arenaPreloadShapes(event) {
    return [event?.player, event?.opponent]
        .filter((participant) => participant?.userId != null)
        .map((participant) => {
            const loadout = decodeBotLoadout(participant.selectedLoadout);
            const slotOne = Number(participant.slot) === 1;
            return {
                id: `bot-${participant.userId}`,
                type: "bot",
                userId: participant.userId,
                username: participant.username,
                opponentUsername: participant.username,
                slot: participant.slot,
                x: slotOne ? -60 : ARENA_WIDTH_UNITS + 60,
                y: slotOne ? DUEL_SLOT_ONE_Y : DUEL_SLOT_TWO_Y,
                rotation: slotOne ? 180 : 0,
                size: 60,
                hp: 100,
                maxHp: 100,
                combatLoadout: participant.selectedLoadout ?? "melee",
                abilities: loadout.abilities,
                locked: true,
            };
        });
}
