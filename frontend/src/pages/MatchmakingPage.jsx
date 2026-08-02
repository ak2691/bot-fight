import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BetaModel from "../beta/BetaModel";
import AppNavbar from "../components/AppNavbar";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import PixiCanvas from "../beta/PixiCanvas";
import SimulationReplay from "../replay/SimulationReplay";
import { matchReplayArenaLifecycle } from "../replay/arenaLifecycle.js";
import { phaseDeadlineTimingForEvent, preparationTimingForEvent } from "../replay/preparationTiming.js";
import {
    ASSAULT_BOOST_TYPE,
    BUFF_PICKUP_SIZE,
    CENTER_OBJECTIVE_SIZE,
    MOBILITY_BOOST_TYPE,
    PROJECTILE_WALL_LENGTH,
    PROJECTILE_WALL_THICKNESS,
    PROJECTILE_WALL_TYPE,
    TEMPO_BOOST_TYPE,
    VANGUARD_BEACON_TYPE,
    isBoostType,
} from "../beta/ArenaObjects";
import { BOT_ABILITIES, DEFAULT_BOT_LOADOUT, MAX_EQUIPPED_ABILITIES, ROUND_ABILITY_DRAFT, STAT_POINT_BUDGET_PER_ROUND, botStatsForLoadout, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout } from "../beta/loadout/BotLoadout";
import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    DISPLAY_ARENA_MAX_SIZE,
    DUEL_SLOT_ONE_X,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_X,
    DUEL_SLOT_TWO_Y,
    CORE_HP,
    CORE_TYPE,
    DEFENSE_WALL_TYPE,
    WALL_CORE_HP,
    WALL_CORE_TYPE,
    HEALTH_PACK_SIZE,
    PLAYER_OBJECT_PLACEMENT_LIMIT,
    BOOST_PLACEMENT_LIMIT,
    UTILITY_PLACEMENT_LIMIT,
} from "../beta/modelPayloads/arenaConstants";
import { MAIN_SHAPE, buildCoreShapes } from "../beta/modelPayloads/arenaShapes";
import {
    disconnectActiveMatchmakingClient,
    getEstimatedOneWayNetworkDelayMs,
    getActiveMatchmakingClient,
    getNetworkDelaySample,
} from "../matchmaking/stompClient";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import { relativeLocalDeadlineMs } from "../matchmaking/relativeMatchTiming.js";
import MatchChat from "../matchmaking/MatchChat";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { localReplaySchedule } from "../replay/replayPresentation.js";

const SUBMISSION_GRACE_MS = 2000;
const COUNTDOWN_UPDATE_INTERVAL_MS = 250;

function LoadoutStatIcon({ stat }) {
    const commonProps = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 1.7,
    };

    if (stat === "maxHp") {
        return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="M12 21s7-3.3 7-9.5V5.8L12 3 5 5.8v5.7C5 17.7 12 21 12 21Z" /><path d="M9 11.5h6M12 8.5v6" /></svg>;
    }
    if (stat === "moveSpeed") {
        return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="M8 3h5l-1 5 2 4 5 2.5c1.2.6 1.6 2 .9 3.2-.4.8-1.2 1.3-2.1 1.3H7l-2-2 2-3V8l1-5Z" /><path d="M7 14h5M4 20h14" /></svg>;
    }
    if (stat === "attackDamage") {
        return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="m14.5 3 6.5 6.5-8 8-2.5-.5-.5-2.5 8-8L14.5 3Z" /><path d="m10.5 16.5-5 5-3-3 5-5M15.5 5.5l3 3" /></svg>;
    }
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="m13 2-7 11h5l-1 9 8-12h-5V2Z" /></svg>;
}

function secondsRemaining(countdownEndsAt, maximum = Number.POSITIVE_INFINITY) {
    if (!countdownEndsAt) return 0;
    return Math.min(maximum, Math.max(0, Math.ceil((countdownEndsAt - monotonicEpochNowMs()) / 1000)));
}

function visibleLoadoutSelectionDeadlineMs(deadlineMs, estimatedOneWayDelayMs = 0) {
    if (deadlineMs == null) return deadlineMs;
    const oneWayDelay = Number(estimatedOneWayDelayMs);
    return Number(deadlineMs)
        + (Number.isFinite(oneWayDelay) ? Math.max(0, oneWayDelay) : 0)
        - SUBMISSION_GRACE_MS;
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
            SUBMISSION_GRACE_MS,
        ),
        loadoutSelectionEndsAtMs: toLocalDeadlineMs(
            event.loadoutSelectionEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
        ),
        objectPlacementEndsAtMs: toLocalDeadlineMs(
            event.objectPlacementEndsAt,
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
        testingEndsAtMs: toLocalDeadlineMs(
            event.testingEndsAt,
            event.serverNow,
            localNowMs,
            estimatedOneWayDelayMs,
            SUBMISSION_GRACE_MS,
        ),
        playbackStartsAtMs: event.type === "SIMULATION_PREPARING"
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

export default function MatchmakingPage() {
    const navigate = useNavigate();
    const { clearFoundMatch } = useMatchmaking();
    const location = useLocation();
    const initialMatchEventPayload = location.state?.matchEvent ?? null;
    const initialMatchEvent = initialMatchEventPayload
        ? normalizeEventTimes(initialMatchEventPayload, null)
        : null;
    const clientRef = useRef(null);
    const playbackRef = useRef(null);
    const matchEventRef = useRef(null);
    const matchAcceptanceDeadlineRef = useRef(null);
    const loadoutSelectionDeadlineRef = useRef(null);
    const matchAcceptanceSubmitPendingRef = useRef(false);
    const loadoutSubmitPendingRef = useRef(false);
    const placementSubmittedRef = useRef(false);
    const placementSubmitPendingRef = useRef(false);
    const initialQueueStatus = initialMatchEvent?.status === "MATCH_ACCEPT"
        ? "MATCH_ACCEPT"
        : initialMatchEvent?.status === "LOADOUT_SELECT" ? "LOADOUT_SELECT" : "CONNECTING";
    const queueStatusRef = useRef(initialQueueStatus);
    const [socketStatus, setSocketStatus] = useState("IDLE");
    const [queueStatus, setQueueStatus] = useState(initialQueueStatus);
    const [matchEvent, setMatchEvent] = useState(initialMatchEvent);
    const [playback, setPlayback] = useState(null);
    const [remaining, setRemaining] = useState(0);
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

    const acceptanceStateForEvent = (event) => {
        if (!event?.acceptedUserId) return "READY";
        return String(event.acceptedUserId) === String(event.player?.userId)
            ? "WAITING"
            : "READY";
    };

    useEffect(() => {
        clearFoundMatch();
    }, [clearFoundMatch]);

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

    useEffect(() => {
        async function startMatchmakingClient() {
            if (initialMatchEventPayload) {
                const initialEstimatedOneWayDelayMs = getEstimatedOneWayNetworkDelayMs();
                const normalizedInitialEvent = normalizeEventTimes(
                    initialMatchEventPayload,
                    initialEstimatedOneWayDelayMs,
                );
                setCurrentMatchEvent(normalizedInitialEvent);
                if (normalizedInitialEvent.status === "MATCH_ACCEPT") {
                    matchAcceptanceDeadlineRef.current = normalizedInitialEvent.matchAcceptanceEndsAtMs;
                    setMatchAcceptanceState(acceptanceStateForEvent(normalizedInitialEvent));
                    setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
                } else if (normalizedInitialEvent.status === "LOADOUT_SELECT") {
                    loadoutSelectionDeadlineRef.current = visibleLoadoutSelectionDeadlineMs(
                        normalizedInitialEvent.loadoutSelectionEndsAtMs,
                        initialEstimatedOneWayDelayMs,
                    );
                    setRemaining(secondsRemaining(loadoutSelectionDeadlineRef.current));
                }
            }

            const client = getActiveMatchmakingClient({
                onChatEvent: (event) => {
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
                },
                onStatus: (status) => {
                    setSocketStatus(status);
                    if (status === "ERROR" || status === "CLOSED") {
                        if (intentionalSocketCloseRef.current) return;
                        matchAcceptanceSubmitPendingRef.current = false;
                        setMatchAcceptanceState("READY");
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
                },
                onEvent: (rawEvent, eventReceivedAtMs = monotonicEpochNowMs()) => {
                    const timedPhaseStarts = [
                        "MATCH_FOUND",
                        "MATCH_ACCEPTED",
                        "MATCH_STARTED",
                        "MATCH_LOADOUT_SELECTION_READY",
                        "BOT_TESTING_SESSION_READY",
                        "MATCH_ROUND_READY",
                        "PLAYER_RECONNECTED",
                        "SIMULATION_PREPARING",
                        "MATCH_RESULT_READY",
                    ];
                    const networkDelaySample = getNetworkDelaySample();
                    const estimatedOneWayDelayMs = getEstimatedOneWayNetworkDelayMs();
                    if (timedPhaseStarts.includes(rawEvent.type)) {
                        console.info("[match timing] network delay estimate", {
                            phase: rawEvent.type,
                            eventReceivedAtMs,
                            eventServerTransmitTime: rawEvent.serverNow ?? null,
                            networkDelayMs: networkDelaySample?.networkDelayMs ?? null,
                            estimatedOneWayDelayMs,
                            bestNetworkDelayMs: networkDelaySample?.bestNetworkDelayMs ?? null,
                            selectedSampleCount: networkDelaySample?.selectedSampleCount ?? null,
                        });
                    }
                    const event = normalizeEventTimes(
                        rawEvent,
                        estimatedOneWayDelayMs,
                        eventReceivedAtMs,
                    );
                    const logPhaseDeadline = (label, phase, deadlineServerField, deadlineLocalField) => {
                        const transitionProcessedAtMs = monotonicEpochNowMs();
                        console.info(label, {
                            ...phaseDeadlineTimingForEvent(
                                event,
                                deadlineServerField,
                                deadlineLocalField,
                                transitionProcessedAtMs,
                                estimatedOneWayDelayMs,
                            ),
                            phase,
                            eventType: event.type,
                            eventReceivedAtMs,
                            transitionProcessedAtMs,
                            transitionDelayAfterReceiptMs:
                                Math.max(0, transitionProcessedAtMs - eventReceivedAtMs),
                        });
                    };
                    const enterTestingRoomAtDeadline = () => {
                        logPhaseDeadline(
                            "[match timing] testing countdown",
                            "TESTING",
                            "testingEndsAt",
                            "testingEndsAtMs",
                        );
                        updateQueueStatus("PREP");
                    };
                    const eventServerNowMs = event.serverNow
                        ? eventReceivedAtMs - estimatedOneWayDelayMs
                        : eventReceivedAtMs;
                    if (event.disconnectedUserId
                        && event.disconnectEndsAtMs != null
                        && eventServerNowMs >= disconnectNoticeResetAtRef.current) {
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
                    if (event.type === "NO_ACTIVE_MATCH") {
                        navigate("/home", { replace: true });
                        return;
                    }
                    if (event.type === "QUEUE_WAITING") {
                        updateQueueStatus("WAITING");
                    }
                    if (event.type === "MATCH_FOUND" && event.status === "MATCH_ACCEPT") {
                        if (queueStatusRef.current !== "MATCH_ACCEPT"
                            && queueStatusRef.current !== "CONNECTING") return;
                        matchAcceptanceDeadlineRef.current = event.matchAcceptanceEndsAtMs;
                        setCurrentMatchEvent(event);
                        setMatchAcceptanceState(acceptanceStateForEvent(event));
                        setMatchAcceptanceError(null);
                        matchAcceptanceSubmitPendingRef.current = false;
                        updateQueueStatus("MATCH_ACCEPT");
                        setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
                        return;
                    }
                    if (event.type === "MATCH_ACCEPTED" && event.status === "MATCH_ACCEPT") {
                        if (queueStatusRef.current !== "MATCH_ACCEPT") return;
                        matchAcceptanceDeadlineRef.current = event.matchAcceptanceEndsAtMs;
                        setCurrentMatchEvent(event);
                        setMatchAcceptanceState(acceptanceStateForEvent(event));
                        setMatchAcceptanceError(null);
                        matchAcceptanceSubmitPendingRef.current = false;
                        updateQueueStatus("MATCH_ACCEPT");
                        setRemaining(secondsRemaining(matchAcceptanceDeadlineRef.current));
                        return;
                    }
                    if (event.type === "MATCH_ACCEPTANCE_EXPIRED"
                        || event.type === "MATCH_ACCEPTANCE_CANCELLED") {
                        if (queueStatusRef.current !== "MATCH_ACCEPT") return;
                        navigate("/home", { replace: true });
                        return;
                    }
                    if (event.type === "MATCH_STARTED"
                        || (event.type === "MATCH_FOUND" && event.status !== "MATCH_ACCEPT")) {
                        matchAcceptanceDeadlineRef.current = null;
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
                        if (event.status === "LOADOUT_SELECT") {
                            logPhaseDeadline(
                                "[match timing] ability selection countdown",
                                "LOADOUT_SELECT",
                                "loadoutSelectionEndsAt",
                                "loadoutSelectionEndsAtMs",
                            );
                        }
                        setCurrentMatchEvent(event);
                        if (event.status === "LOADOUT_SELECT") updateQueueStatus("LOADOUT_SELECT");
                        else if (event.status === "PREP") enterTestingRoomAtDeadline();
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
                        logPhaseDeadline(
                            "[match timing] ability selection countdown",
                            "LOADOUT_SELECT",
                            "loadoutSelectionEndsAt",
                            "loadoutSelectionEndsAtMs",
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
                    if (event.type === "BOT_TESTING_SESSION_READY") {
                        loadoutSubmitPendingRef.current = false;
                        setLoadoutSubmitPending(false);
                        loadoutSelectionDeadlineRef.current = null;
                        setCurrentMatchEvent(event);
                        enterTestingRoomAtDeadline();
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
                        if (event.status === "LOADOUT_SELECT") {
                            logPhaseDeadline(
                                "[match timing] ability selection countdown",
                                "LOADOUT_SELECT",
                                "loadoutSelectionEndsAt",
                                "loadoutSelectionEndsAtMs",
                            );
                        }
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
                        setLoadoutChoice(decodeBotLoadout(event.player?.selectedLoadout));
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
                    if (event.type === "MATCH_ERROR") {
                        matchAcceptanceSubmitPendingRef.current = false;
                        setMatchAcceptanceState("READY");
                        setMatchAcceptanceError(event.message ?? "The server rejected the match action.");
                        loadoutSubmitPendingRef.current = false;
                        setLoadoutSubmitPending(false);
                        setFinishPending(false);
                        setSurrenderPending(false);
                        setHasFinished(false);
                        setFinishError(event.message ?? "The server rejected the bot submission. Review the bot and try again.");
                        if (queueStatusRef.current !== "MATCH_ACCEPT") {
                            updateQueueStatus("TESTING");
                        }
                    }
                    if (event.type === "SIMULATION_PREPARING") {
                        const timing = preparationTimingForEvent(
                            event,
                            monotonicEpochNowMs(),
                            estimatedOneWayDelayMs,
                        );
                        console.info(
                            "[match timing] preparation countdown",
                            {
                                ...timing,
                                rawPreparationSeconds: timing.rawSecondsRemaining,
                                roundedPreparationSeconds: timing.secondsRemaining,
                                phase: event.type,
                            },
                        );
                        setCurrentMatchEvent(event);
                        const localSchedule = localReplaySchedule(
                            event.playbackStartsAtMs,
                            event.resultRevealsAtMs,
                        );
                        const roundWinsBeforeResult = Object.fromEntries(
                            (event.players ?? [event.player, event.opponent].filter(Boolean))
                                .filter((participant) => participant?.userId != null)
                                .map((participant) => [String(participant.userId), Number(participant.roundWins) || 0])
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
                        setPlayback((currentPlayback) => {
                            if (!currentPlayback) return currentPlayback;
                            const incomingSequence = Number(event.playback?.batchSequence);
                            const currentSequence = Number(currentPlayback.batchSequence);
                            const incomingBatchIsStale = Number.isFinite(incomingSequence)
                                && Number.isFinite(currentSequence)
                                && incomingSequence < currentSequence;
                            const framesByTick = new Map(
                                [...(currentPlayback.frames ?? []), ...(event.playback?.frames ?? [])]
                                    .map((frame) => [`${frame.tick ?? ""}:${frame.elapsedMs ?? ""}`, frame])
                            );
                            const nextPlayback = {
                                ...currentPlayback,
                                player: event.playback?.terminalBatch
                                    ? event.player ?? currentPlayback.player
                                    : currentPlayback.player,
                                opponent: event.playback?.terminalBatch
                                    ? event.opponent ?? currentPlayback.opponent
                                    : currentPlayback.opponent,
                                players: event.playback?.terminalBatch && event.players?.length
                                    ? event.players
                                    : currentPlayback.players,
                                frames: [...framesByTick.values()]
                                    .sort((left, right) => Number(left.elapsedMs ?? 0) - Number(right.elapsedMs ?? 0)),
                                batchSequence: incomingBatchIsStale
                                    ? currentPlayback.batchSequence
                                    : event.playback?.batchSequence ?? currentPlayback.batchSequence,
                                replayCursorElapsedMs: incomingBatchIsStale
                                    ? currentPlayback.replayCursorElapsedMs
                                    : event.playback?.replayCursorElapsedMs
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
                        if (event.playback?.result === "DISCONNECTION_WIN") {
                            setDisconnectNotice(null);
                            setDisconnectRemaining(0);
                        }
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
                },
            });

            clientRef.current = client;
            if (closeSocketAfterChatRef.current) {
                void disconnectActiveMatchmakingClient(client);
                return;
            }
            client.connect();
        }

        void startMatchmakingClient();

        return () => {
            loadoutSelectionDeadlineRef.current = null;
            if (chatNoticeTimeoutRef.current != null) clearTimeout(chatNoticeTimeoutRef.current);
            const activeClient = clientRef.current;
            clientRef.current = null;
            activeClient?.setHandlers();
            void disconnectActiveMatchmakingClient(activeClient);
        };
    }, [initialMatchEventPayload, navigate]);

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
            const deadlineRef = queueStatus === "MATCH_ACCEPT"
                ? matchAcceptanceDeadlineRef
                : loadoutSelectionDeadlineRef;
            const nextRemaining = secondsRemaining(deadlineRef.current);
            setRemaining(nextRemaining);
        }, COUNTDOWN_UPDATE_INTERVAL_MS);
        const deadlineRef = queueStatus === "MATCH_ACCEPT"
            ? matchAcceptanceDeadlineRef
            : loadoutSelectionDeadlineRef;
        setRemaining(secondsRemaining(deadlineRef.current));

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
            || socketStatus !== "CONNECTED") return;
        setMatchAcceptanceError(null);
        matchAcceptanceSubmitPendingRef.current = true;
        setMatchAcceptanceState("ACCEPTING");
        clientRef.current?.acceptMatch(matchEventRef.current.matchId);
    };

    const sendChatMessage = (message) => {
        if (!matchEventRef.current?.matchId || chatClosed || socketStatus !== "CONNECTED") return;
        clientRef.current?.sendChat(matchEventRef.current.matchId, message);
    };

    const opponent = matchEvent?.opponent ?? null;
    const chat = matchEvent?.matchId && queueStatus !== "MATCH_ACCEPT" ? (
        <MatchChat
            messages={chatMessages}
            minimized={chatMinimized}
            onMinimizedChange={(next) => {
                setChatMinimized(next);
                if (!next) setChatMessages((current) => current.map((message) => ({ ...message, unread: false })));
            }}
            onSend={sendChatMessage}
            disabled={chatClosed || socketStatus !== "CONNECTED"}
            rateLimitNotice={chatRateLimitNotice}
            closedNotice={chatClosedNotice}
            currentUsername={matchEvent?.player?.username}
        />
    ) : null;
    const matchContext = useMemo(() => ({
        matchId: matchEvent?.matchId,
        simulationSeed: matchEvent?.simulationSeed,
        player: matchEvent?.player,
        opponent,
        players: matchEvent?.players ?? [],
        testingEndsAt: matchEvent?.testingEndsAt,
        testingEndsAtMs: matchEvent?.testingEndsAtMs,
        roundReadyAt: matchEvent?.roundReadyAt,
        roundReadyAtMs: matchEvent?.roundReadyAtMs,
        matchChatEndsAt: matchEvent?.matchChatEndsAt,
        matchChatEndsAtMs: matchEvent?.matchChatEndsAtMs,
        objectPlacementEndsAt: matchEvent?.objectPlacementEndsAt,
        objectPlacementEndsAtMs: matchEvent?.objectPlacementEndsAtMs,
        rulesetVersion: matchEvent?.rulesetVersion,
        roundNumber: matchEvent?.roundNumber,
        winsRequired: matchEvent?.winsRequired,
        obstacles: matchEvent?.obstacles ?? [],
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
        matchEvent?.testingEndsAt,
        matchEvent?.testingEndsAtMs,
        matchEvent?.roundReadyAt,
        matchEvent?.roundReadyAtMs,
        matchEvent?.matchChatEndsAt,
        matchEvent?.matchChatEndsAtMs,
        matchEvent?.objectPlacementEndsAt,
        matchEvent?.objectPlacementEndsAtMs,
        matchEvent?.rulesetVersion,
        matchEvent?.roundNumber,
        matchEvent?.winsRequired,
        matchEvent?.obstacles,
        matchEvent?.roundBrains,
        matchEvent?.previousRoundWon,
        matchEvent?.roundBlockLimit,
        matchEvent?.message,
        matchEvent?.status,
        matchEvent?.opponent?.selectedLoadout,
        loadoutChoice,
    ]);

    if (queueStatus === "SIMULATION_LOADING") {
        return <ArenaLoadingScreen />;
    }

    if (queueStatus === "MATCH_ACCEPT") {
        const opponentAccepted = Boolean(
            matchEvent?.acceptedUserId
            && matchEvent?.player?.userId
            && String(matchEvent.acceptedUserId) !== String(matchEvent.player.userId));
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={exitToHome} disconnectNotice={disconnectNotice} disconnectRemaining={disconnectRemaining} />
                <MatchAcceptanceScreen
                    player={matchEvent?.player}
                    opponent={opponent}
                    remaining={remaining}
                    acceptanceState={matchAcceptanceState}
                    opponentAccepted={opponentAccepted}
                    error={matchAcceptanceError}
                    onAccept={acceptMatch}
                />
            </main>
        );
    }

    const replayArena = matchReplayArenaLifecycle(queueStatus, playback);
    if (replayArena.mounted) {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={exitToHome} disconnectNotice={disconnectNotice} disconnectRemaining={disconnectRemaining} />
                <SimulationReplay
                    key={replayArena.key}
                    playback={playback}
                    preloadShapes={arenaPreloadShapes(matchEvent)}
                />
                {chat}
            </main>
        );
    }

    if (queueStatus === "LOADOUT_SELECT") {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={exitToHome} disconnectNotice={disconnectNotice} disconnectRemaining={disconnectRemaining} />
                <LoadoutSelectScreen
                    loadout={loadoutChoice}
                    onChange={setLoadoutChoice}
                    onLockLoadout={lockLoadout}
                    submitting={loadoutSubmitPending}
                    player={matchEvent?.player}
                    opponent={opponent}
                    roundNumber={matchEvent?.roundNumber ?? 1}
                    abilityOffers={matchEvent?.abilityOffers ?? []}
                    remaining={remaining}
                />
                {chat}
            </main>
        );
    }

    if (queueStatus === "PREP" || queueStatus === "WAITING_FOR_FINISH" || queueStatus === "READY_FOR_PLAYBACK") {
        return (
            <>
                <BetaModel
                    matchContext={matchContext}
                    finishStatus={hasSurrendered
                        ? "SURRENDERED"
                        : surrenderPending
                            ? "SURRENDERING"
                            : hasFinished
                                ? "FINISHED"
                                : finishPending
                                    ? "SUBMITTING"
                                    : "TESTING"}
                    finishError={finishError}
                    onFinishMatch={finishMatch}
                    onSurrenderMatch={surrenderMatch}
                    onExit={exitToHome}
                />
                <DisconnectNotice notice={disconnectNotice} remaining={disconnectRemaining} />
                {chat}
            </>
        );
    }

    return null;
}

function buildPreparationPlayback(event) {
    const playback = event.playback;
    if (!playback?.initialState?.fighters?.length) return null;
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
                id: `fighter-${participant.userId}`,
                type: "fighter",
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

function MatchAcceptanceScreen({
    player,
    opponent,
    remaining,
    acceptanceState,
    opponentAccepted,
    error,
    onAccept,
}) {
    const closing = remaining === 0;
    const statusMessage = acceptanceState === "WAITING"
        ? "Waiting for the other player."
        : acceptanceState === "ACCEPTING"
            ? "Accepting..."
            : opponentAccepted
                ? "Your opponent accepted. Accept to enter the match."
                : "Both players must accept before the match starts.";
    const buttonLabel = acceptanceState === "WAITING"
        ? "WAITING FOR PLAYER"
        : acceptanceState === "ACCEPTING"
            ? "ACCEPTING..."
            : "ACCEPT MATCH";

    return (
        <section className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-10">
            <div className="w-full max-w-2xl rounded border border-cyan-800/70 bg-[#081522]/85 p-8 text-center shadow-[0_20px_80px_rgba(8,47,73,.25)]">
                <p className="font-mono text-xs tracking-[0.3em] text-cyan-300">MATCH FOUND</p>
                <h1 className="mt-4 text-4xl font-bold uppercase tracking-wide text-white">Ready to fight?</h1>
                <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-4 font-mono">
                    <div className="rounded border border-cyan-700/60 bg-cyan-950/25 px-4 py-5 text-cyan-100">
                        <div className="text-[10px] tracking-widest text-cyan-300/80">YOU</div>
                        <div className="mt-2 truncate text-lg font-bold">{player?.username ?? "YOU"}</div>
                    </div>
                    <div className="text-sm tracking-[0.3em] text-fuchsia-300">VS</div>
                    <div className="rounded border border-fuchsia-700/60 bg-fuchsia-950/20 px-4 py-5 text-fuchsia-100">
                        <div className="text-[10px] tracking-widest text-fuchsia-300/80">OPPONENT</div>
                        <div className="mt-2 truncate text-lg font-bold">{opponent?.username ?? "OPPONENT"}</div>
                    </div>
                </div>
                <div className="mt-8 font-mono text-[10px] tracking-[0.25em] text-slate-400">ACCEPTANCE WINDOW</div>
                <div className={`mt-2 font-mono text-5xl font-bold ${closing ? "text-amber-300" : "text-cyan-300"}`}>
                    {closing ? "CLOSING..." : remaining}
                </div>
                <p className="mt-5 text-sm text-slate-300">{statusMessage}</p>
                {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
                <button
                    type="button"
                    onClick={onAccept}
                    disabled={acceptanceState !== "READY"}
                    className="mt-7 h-12 min-w-56 rounded border border-cyan-500/80 bg-cyan-950/35 px-6 font-mono text-xs font-bold tracking-[0.18em] text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-900/40 disabled:cursor-wait disabled:opacity-55"
                >
                    {buttonLabel}
                </button>
            </div>
        </section>
    );
}

function LoadoutSelectScreen({ loadout, onChange, onLockLoadout, player, opponent, remaining, roundNumber, abilityOffers, submitting }) {
    const playerLocked = Boolean(player?.loadoutSelected);
    const opponentLocked = Boolean(opponent?.loadoutSelected);
    const normalized = normalizedBotLoadout(loadout);
    const inheritedLoadout = decodeBotLoadout(player?.selectedLoadout);
    const inheritedAbilities = playerLocked
        ? normalized.abilities
        : Number(roundNumber) > 1 ? inheritedLoadout.abilities : [];
    const inheritedAbilityIds = new Set(inheritedAbilities);
    const draftedAbilities = normalized.abilities.filter((ability) => !inheritedAbilityIds.has(ability));
    const draftedAbilityIds = new Set(draftedAbilities);
    const draftRule = ROUND_ABILITY_DRAFT[Math.max(1, Number(roundNumber) || 1)] ?? { offered: 0, picks: 0 };
    const offeredAbilityIds = new Set(Array.isArray(abilityOffers) ? abilityOffers : []);
    const spent = Object.values(normalized.statPoints).reduce((sum, value) => sum + value, 0);
    const roundBudget = STAT_POINT_BUDGET_PER_ROUND * Math.max(1, Number(roundNumber) || 1);
    const stats = botStatsForLoadout(normalized);
    const hasAllDraftPicks = draftedAbilities.length >= draftRule.picks;
    const toggleAbility = (id) => {
        if (inheritedAbilityIds.has(id) || !offeredAbilityIds.has(id)) return;
        const abilities = draftedAbilityIds.has(id)
            ? normalized.abilities.filter((ability) => ability !== id)
            : draftedAbilities.length < draftRule.picks ? [...normalized.abilities, id] : normalized.abilities;
        onChange(normalizedBotLoadout({ ...normalized, abilities }));
    };
    const changePoint = (key, delta) => {
        if (delta > 0 && spent >= roundBudget) return;
        onChange(normalizedBotLoadout({ ...normalized, statPoints: { ...normalized.statPoints, [key]: Math.max(0, normalized.statPoints[key] + delta) } }));
    };

    return (
        <section className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-[radial-gradient(circle_at_50%_25%,rgba(8,79,116,0.16),transparent_48%)] px-4 py-8 sm:px-6">
            <div className="w-full max-w-[1080px]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs tracking-[0.25em] text-cyan">ROUND LOADOUT</p>
                        <h1 className="mt-2 font-display-action text-5xl uppercase tracking-wide text-white sm:text-6xl">Build your bot</h1>
                        <p className="mt-2 text-sm text-ink-muted">Choose {draftRule.picks} from your {draftRule.offered} random Round {roundNumber} offers. Your previous picks stay equipped.</p>
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-[10px] tracking-[0.22em] text-cyan">ROUND TIMER</div>
                        <div className="mt-1 font-mono text-5xl font-bold text-cyan-300 [text-shadow:0_0_22px_rgba(34,211,238,0.24)]">{remaining}</div>
                    </div>
                </div>
                {remaining === 0 && (
                    <div role="status" aria-live="polite" className="mt-4 flex items-center gap-3 rounded border border-cyan-900/60 bg-cyan-950/15 px-4 py-3 font-mono text-[10px] tracking-widest text-cyan-200/80">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300/80" aria-hidden="true" />
                        <span>PREPARING TESTING SESSION · FINALIZING LOADOUTS</span>
                    </div>
                )}
                <div className="mt-6 grid gap-6 lg:grid-cols-[1.45fr_1fr]">
                    <div>
                        <div className="mb-4 grid grid-cols-3 gap-3" aria-label="Ability slots">
                            {Array.from({ length: MAX_EQUIPPED_ABILITIES }, (_, index) => {
                                const abilityId = normalized.abilities[index];
                                const ability = BOT_ABILITIES.find((candidate) => candidate.id === abilityId);
                                const isDraft = draftedAbilityIds.has(abilityId);
                                return <button type="button" key={index} disabled={!isDraft || playerLocked} onClick={isDraft ? () => toggleAbility(abilityId) : undefined} aria-label={isDraft ? `Remove ${ability?.label} from slot ${index + 1}` : `Ability slot ${index + 1}${ability ? `: ${ability.label}` : ": empty"}`} className={`min-h-20 rounded border border-b-cyan-500/80 p-3 text-left transition-colors disabled:opacity-100 ${ability ? isDraft ? "cursor-pointer border-cyan-700/70 bg-cyan-950/25 hover:border-red-300" : "cursor-default border-green-900/60 bg-green-950/15" : "cursor-default border-slate-700/70 bg-[#07111c]/65"}`}><div className="flex items-center justify-between gap-2 font-mono text-[9px] tracking-widest text-cyan-300/80"><span>SLOT {index + 1}</span><span className="flex h-4 w-4 items-center justify-center rounded-full border border-cyan-400 text-[10px]" aria-hidden="true">✓</span></div><div className="mt-2 truncate text-xs font-bold text-ink-white">{ability?.label ?? "EMPTY"}</div></button>;
                            })}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {BOT_ABILITIES.filter((ability) => offeredAbilityIds.has(ability.id)).map((ability) => {
                                const active = draftedAbilityIds.has(ability.id);
                                const unavailable = playerLocked || (!active && hasAllDraftPicks);
                                return (
                                    <button
                                        key={ability.id}
                                        type="button"
                                        disabled={unavailable}
                                        aria-pressed={active}
                                        onClick={() => toggleAbility(ability.id)}
                                        className={`min-h-24 rounded border p-4 text-left transition ${
                                            active
                                                ? "-translate-y-1 cursor-pointer border-cyan-400 bg-cyan-950/35 shadow-[0_8px_24px_rgba(8,145,178,0.12)] hover:border-cyan-300"
                                                : unavailable
                                                    ? "cursor-not-allowed border-slate-800 bg-slate-950/45 opacity-35 saturate-0"
                                                    : "cursor-pointer border-slate-700/75 bg-[#091522]/85 hover:border-cyan-700 hover:bg-cyan-950/15"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2 font-mono text-xs tracking-widest text-ink-white">
                                            <span>{active ? "SELECTED — " : ""}{ability.label}</span>
                                            <span className="text-[8px] text-cyan">{ability.kind.toUpperCase()}</span>
                                        </div>
                                        <p className={`mt-2 text-xs ${unavailable ? "text-slate-600" : "text-ink-muted"}`}>{ability.summary}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="rounded border border-slate-700/70 bg-[#081522]/75 p-6 shadow-[inset_0_0_35px_rgba(8,47,73,0.1)]">
                        <div className="font-mono text-xs tracking-widest text-cyan">STAT POINTS {spent}/{roundBudget}</div>
                        {[ ["maxHp", "HP", stats.maxHp], ["moveSpeed", "MOVE", stats.moveSpeed], ["attackDamage", "DAMAGE", `${stats.attackDamagePercent}%`], ["attackSpeed", "ATTACK SPEED", `${stats.attackSpeedPercent}%`] ].map(([key,label,value]) => (
                            <div key={key} className="mt-6 grid grid-cols-[28px_1fr_auto] items-center gap-4">
                                <span className="text-cyan-300"><LoadoutStatIcon stat={key} /></span>
                                <span className="font-mono text-[10px] tracking-widest text-slate-300">{label}</span>
                                <div className="flex items-center gap-3">
                                    <button type="button" aria-label={`Decrease ${label}`} disabled={playerLocked || normalized.statPoints[key] <= 0} onClick={() => changePoint(key,-1)} className="h-10 w-10 rounded border border-slate-700 text-lg text-slate-300 transition hover:border-cyan-700 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-30">−</button>
                                    <span className="w-14 text-center font-mono text-sm text-white">{value}</span>
                                    <button type="button" aria-label={`Increase ${label}`} disabled={playerLocked || spent >= roundBudget} onClick={() => changePoint(key,1)} className="h-10 w-10 rounded border border-cyan-800 text-lg text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-30">+</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700/70 bg-[#081522]/75 p-4">
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">
                        <span className="mr-3 text-cyan">●</span>
                        YOU: <span className={playerLocked ? "text-green-300" : "text-amber-200"}>{playerLocked ? "LOCKED" : "CHOOSING"}</span>
                        <span className="mx-3 text-border-hi">/</span>
                        {opponent?.username ?? "OPP"}: <span className={opponentLocked ? "text-green-300" : "text-amber-200"}>{opponentLocked ? "LOCKED" : "CHOOSING"}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onLockLoadout}
                        disabled={submitting || playerLocked || normalized.abilities.length > MAX_EQUIPPED_ABILITIES}
                        className="h-11 min-w-52 rounded border border-cyan-600/80 bg-cyan-950/25 px-5 font-mono text-[11px] font-bold tracking-[0.16em] text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {submitting
                            ? "LOCKING LOADOUT"
                            : playerLocked
                            ? "LOADOUT LOCKED"
                            : draftedAbilities.length === draftRule.picks
                                ? "LOCK LOADOUT"
                                : `LOCK + AUTO-PICK ${draftRule.picks - draftedAbilities.length}`}
                    </button>
                </div>
            </div>
        </section>
    );
}

const PLACEABLE_OBJECTS = Object.freeze([
    { type: ASSAULT_BOOST_TYPE, label: "Assault Boost", category: "boost" },
    { type: TEMPO_BOOST_TYPE, label: "Tempo Boost", category: "boost" },
    { type: MOBILITY_BOOST_TYPE, label: "Mobility Boost", category: "boost" },
    { type: "healthPack", label: "Health Pack", category: "utility" },
    { type: PROJECTILE_WALL_TYPE, label: "Healing Projectile Wall", category: "utility" },
]);

function ObjectPlacementScreen({
    player,
    placedObjects = [],
    confirmedObjects = [],
    remaining,
    onSubmit,
    submitted,
    submitting,
    roundNumber,
}) {
    const placementSide = player?.slot === 2 ? "bottom" : "top";
    const spawnY = player?.slot === 2 ? DUEL_SLOT_TWO_Y : DUEL_SLOT_ONE_Y;
    const spawnRotation = player?.slot === 2 ? 270 : 90;
    const [selectedType, setSelectedType] = useState("healthPack");
    const [selectedId, setSelectedId] = useState(null);
    const [objects, setObjects] = useState([]);
    if (player?.slot !== 2) {
        return <section className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6">
            <div className="border border-emerald-800/70 bg-arena-panel px-10 py-12 text-center shadow-2xl">
                <p className="font-mono text-xs tracking-[0.3em] text-emerald-300">DEFENDER</p>
                <h1 className="mt-4 text-2xl font-bold text-ink-white">Waiting for attacker to choose objects</h1>
                <p className="mt-3 font-mono text-sm text-ink-muted">{remaining}s remaining</p>
            </div>
        </section>;
    }
    const playerShape = {
        ...MAIN_SHAPE,
        x: player?.slot === 2 ? DUEL_SLOT_TWO_X : DUEL_SLOT_ONE_X,
        y: spawnY,
        rotation: spawnRotation,
        combatLoadout: player?.selectedLoadout ?? "melee",
        locked: true,
    };
    const serverObjects = confirmedObjects.map((object, index) => ({
        ...object,
        id: object.id ?? `placement-${index + 1}`,
    }));
    const visibleObjects = submitted ? serverObjects : objects;
    const localObjects = visibleObjects.map((object) => ({
        ...object,
        locked: submitted,
    }));
    const neutralObjects = placedObjects
        .filter((object) => isNeutralMatchObject(object))
        .map((object) => ({
            id: object.id,
            type: object.type,
            x: Number.isFinite(Number(object.x)) ? Number(object.x) : ARENA_WIDTH_UNITS / 2,
            y: Number.isFinite(Number(object.y)) ? Number(object.y) : ARENA_HEIGHT_UNITS / 2,
            size: Number.isFinite(Number(object.size))
                ? Number(object.size)
                : object.type === VANGUARD_BEACON_TYPE
                    ? CENTER_OBJECTIVE_SIZE
                    : BUFF_PICKUP_SIZE,
            rotation: Number(object.rotation) || 0,
            hp: Number(object.hp ?? 0),
            locked: true,
        }));
    const shapes = [...buildCoreShapes(), playerShape, ...neutralObjects, ...localObjects];
    const maxObjects = PLAYER_OBJECT_PLACEMENT_LIMIT;
    const ownPlacedCount = visibleObjects.length;
    const remainingSlots = maxObjects - ownPlacedCount;
    const boostCount = visibleObjects.filter((object) => isBoostType(object.type)).length;
    const utilityCount = ownPlacedCount - boostCount;

    const addObject = () => {
        const selectedIsBoost = isBoostType(selectedType);
        if (submitted || ownPlacedCount >= maxObjects
            || (selectedIsBoost ? boostCount >= BOOST_PLACEMENT_LIMIT : utilityCount >= UTILITY_PLACEMENT_LIMIT)) return;
        const size = selectedType === "healthPack"
            ? HEALTH_PACK_SIZE
            : isBoostType(selectedType) ? BUFF_PICKUP_SIZE : PROJECTILE_WALL_LENGTH;
        const bounds = placementBounds(placementSide, size);
        const index = objects.length;
        const object = {
            id: `placement-${index + 1}`,
            type: selectedType,
            x: ARENA_WIDTH_UNITS * (0.3 + index * 0.2),
            y: (bounds.minY + bounds.maxY) / 2,
            size,
            rotation: selectedType === "healthPack" ? 0 : 0,
        };
        const clamped = clampPlacementObject(object, placementSide);
        setObjects((current) => [...current, clamped]);
        setSelectedId(clamped.id);
    };
    const updateObject = (id, updates) => {
        if (submitted) return;
        setObjects((current) => current.map((object) => (
            object.id === id ? clampPlacementObject({ ...object, ...updates }, placementSide) : object
        )));
    };
    const submit = () => {
        if (submitted) return;
        onSubmit(objects.map((object, index) => ({
            id: `p${player?.slot ?? 1}_object_${index + 1}`,
            type: object.type,
            x: object.x,
            y: object.y,
            size: object.size,
            rotation: object.rotation ?? 0,
        })));
    };

    return (
        <section className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center gap-5 px-6 py-5">
            <div className="flex w-full max-w-[1900px] items-end justify-between gap-4">
                <div>
                    <p className="font-mono text-xs tracking-[0.25em] text-cyan">{roundNumber === 3 ? "SIDES SWITCHED · NEW ATTACKER" : "ROUND OBJECT SETUP"}</p>
                    <h1 className="mt-2 text-2xl font-bold text-ink-white">Place two boosts and two utilities</h1>
                    <p className="mt-2 text-sm text-ink-muted">
                        Your side is the highlighted third. Center objectives are locked for this round.
                    </p>
                </div>
                <div className="font-mono text-5xl font-bold text-ink-white">{remaining}</div>
            </div>
            <div className="grid w-full max-w-[1900px] gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <PixiCanvas
                    shapes={shapes}
                    selectedId={selectedId}
                    onSelectShape={(id) => id !== "main" && setSelectedId(id)}
                    onUpdateShape={updateObject}
                    onDeselectAll={() => setSelectedId(null)}
                    editable={!submitted}
                    placementSide={placementSide}
                />
                <aside className="border border-border-lo bg-arena-panel p-4">
                    <div className="mb-4 border border-border-lo bg-zinc-950/70 p-3">
                        <div className="font-mono text-[10px] tracking-widest text-ink-muted">ROUND CENTER</div>
                        <div className="mt-2 space-y-1.5 font-mono text-[10px] tracking-widest">
                            {neutralObjects.length > 0 ? neutralObjects.map((object) => (
                                <div key={object.id} className="flex justify-between gap-3 text-ink-muted">
                                    <span>{object.id === "object_center" ? "CENTER" : object.id === "object_buff_1" ? "LEFT" : "RIGHT"}</span>
                                    <span className="text-ink-white">{object.type}</span>
                                </div>
                            )) : (
                                <div className="text-ink-muted">CENTER OBJECTS LOADING</div>
                            )}
                        </div>
                    </div>
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">BOOSTS {boostCount}/{BOOST_PLACEMENT_LIMIT} · UTILITIES {utilityCount}/{UTILITY_PLACEMENT_LIMIT}</div>
                    <div className="mt-3 grid gap-2">
                        {PLACEABLE_OBJECTS.map((object) => (
                            <button
                                key={object.type}
                                type="button"
                                disabled={submitted || (object.category === "boost" ? boostCount >= BOOST_PLACEMENT_LIMIT : utilityCount >= UTILITY_PLACEMENT_LIMIT)}
                                onClick={() => setSelectedType(object.type)}
                                className={`h-10 rounded border px-3 text-left font-mono text-[10px] tracking-widest ${selectedType === object.type
                                    ? "border-cyan-400 bg-cyan-950/40 text-cyan-100"
                                    : "border-border-lo bg-zinc-950 text-ink-muted hover:text-ink-white"} disabled:opacity-40`}
                            >
                                {object.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={addObject}
                        disabled={submitted || remainingSlots <= 0}
                        className="mt-4 h-10 w-full rounded border border-dashed border-cyan-700/70 bg-zinc-950 font-mono text-[10px] tracking-widest text-cyan-200 disabled:opacity-35"
                    >
                        ADD OBJECT ({remainingSlots} LEFT)
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (!selectedId || submitted) return;
                            setObjects((current) => current.filter((object) => object.id !== selectedId));
                            setSelectedId(null);
                        }}
                        disabled={!selectedId || submitted}
                        className="mt-2 h-10 w-full rounded border border-red-800/70 bg-red-950/30 font-mono text-[10px] tracking-widest text-red-300 disabled:opacity-35"
                    >
                        DELETE SELECTED
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitted || submitting}
                        className="mt-6 h-11 w-full rounded border border-green-700/70 bg-green-900/30 font-mono text-[11px] font-bold tracking-widest text-green-200 hover:bg-green-900/50 disabled:opacity-45"
                    >
                        {submitted ? "OBJECTS SUBMITTED" : submitting ? "SUBMITTING OBJECTS" : "SUBMIT OBJECTS"}
                    </button>
                </aside>
            </div>
        </section>
    );
}

function placementBounds(side, size) {
    const radius = size / 2;
    return side === "bottom"
        ? { minY: (ARENA_HEIGHT_UNITS * 2) / 3 + radius, maxY: ARENA_HEIGHT_UNITS - radius }
        : { minY: radius, maxY: ARENA_HEIGHT_UNITS / 3 - radius };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clampPlacementObject(object, side) {
    const size = object.size ?? (object.type === "healthPack"
        ? HEALTH_PACK_SIZE
        : isBoostType(object.type) ? BUFF_PICKUP_SIZE : PROJECTILE_WALL_LENGTH);
    const radius = size / 2;
    const bounds = placementBounds(side, size);
    const x = clamp(Number(object.x) || ARENA_WIDTH_UNITS / 2, radius, ARENA_WIDTH_UNITS - radius);
    const y = clamp(Number(object.y) || bounds.minY, bounds.minY, Math.max(bounds.minY, bounds.maxY));
    return {
        ...object,
        size,
        x,
        y,
        rotation: object.type === "healthPack" || isBoostType(object.type)
            ? 0
            : Math.round(Number(object.rotation ?? 0) / 45) * 45,
    };
}

function isNeutralMatchObject(object) {
    return object?.id === "object_center"
        || object?.type === VANGUARD_BEACON_TYPE;
}
function MatchHeader({ onExit, disconnectNotice, disconnectRemaining }) {
    return (
        <>
        <AppNavbar onHome={onExit} />
        <DisconnectNotice notice={disconnectNotice} remaining={disconnectRemaining} />
        </>
    );
}

function DisconnectNotice({ notice, remaining }) {
    if (!notice) return null;
    return (
        <aside role="alert" className="fixed inset-x-4 top-16 z-[100] mx-auto max-w-xl rounded-xl border border-amber-400/60 bg-[#171208f2] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,.5)] backdrop-blur">
            <div className="flex items-center gap-4">
                <div className="grid h-11 w-11 flex-none place-items-center rounded-full border border-amber-400/50 font-mono text-lg font-bold text-amber-300">
                    {notice.endsAtMs ? remaining : "!"}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-bold tracking-[.18em] text-amber-300">CONNECTION INTERRUPTED</p>
                    <p className="mt-1 text-sm leading-5 text-slate-200">{notice.message}</p>
                </div>
                {notice.self && (
                    <button type="button" onClick={() => window.location.reload()} className="flex-none border border-cyan-400/50 bg-cyan-950/30 px-3 py-2 text-xs font-bold text-cyan-200">
                        Reconnect
                    </button>
                )}
            </div>
        </aside>
    );
}
