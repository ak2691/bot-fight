import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import MatchAcceptanceModal from "./MatchAcceptanceModal.jsx";
import {
    isMatchAcceptanceTerminalEventForMatch,
    isMatchAcceptanceUnavailableError,
} from "./matchAcceptanceTerminal.js";
import {
    acceptanceEventForClient,
    acceptanceStateForEvent,
    acceptanceVisibleStartMs,
} from "./matchAcceptance.js";
import { monotonicEpochNowMs } from "./networkDelayEstimator.js";
import { relativeLocalDeadlineMs } from "./relativeMatchTiming.js";
import {
    disconnectActiveMatchmakingClient,
    getActiveMatchmakingClient,
    getEstimatedOneWayNetworkDelayMs,
} from "./stompClient";
import { MatchmakingContext } from "./matchmaking-context";

const QUEUE_ATTEMPT_BURST_LIMIT = 3;
const QUEUE_ATTEMPT_WINDOW_MS = 5000;
const ACCEPTANCE_VISIBLE_GRACE_MS = 2_000;
const COUNTDOWN_UPDATE_INTERVAL_MS = 250;

function secondsRemaining(deadlineMs, nowMs = monotonicEpochNowMs()) {
    if (deadlineMs == null) return 0;
    return Math.max(0, Math.ceil((Number(deadlineMs) - Number(nowMs)) / 1000));
}

function localAcceptanceDeadlineForEvent(event, visibleGraceMs = ACCEPTANCE_VISIBLE_GRACE_MS) {
    return relativeLocalDeadlineMs({
        deadlineServerTime: event?.matchAcceptanceEndsAt,
        serverTransmitTime: event?.serverNow,
        localReceiveTimeMs: monotonicEpochNowMs(),
        estimatedOneWayDelayMs: getEstimatedOneWayNetworkDelayMs(),
        visibleGraceMs,
    });
}

export default function MatchmakingProvider({ children }) {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const matchFoundRef = useRef(false);
    const matchmakingClientRef = useRef(null);
    const pendingAcceptanceRef = useRef(null);
    const acceptanceActiveRef = useRef(false);
    const acceptanceDeadlineRef = useRef(null);
    const acceptanceAuthoritativeDeadlineRef = useRef(null);
    const acceptanceStartDeadlineRef = useRef(null);
    const acceptanceSubmitPendingRef = useRef(false);
    const queueAttemptTimesRef = useRef([]);
    const [isQueueing, setIsQueueing] = useState(false);
    const [queueStartedAt, setQueueStartedAt] = useState(null);
    const [queueElapsed, setQueueElapsed] = useState(0);
    const [queueError, setQueueError] = useState(null);
    const [pendingAcceptance, setPendingAcceptance] = useState(null);
    const [acceptanceState, setAcceptanceState] = useState("READY");
    const [acceptanceRemaining, setAcceptanceRemaining] = useState(0);
    const [, setAcceptanceNowMs] = useState(() => monotonicEpochNowMs());
    const [acceptanceDeadlineMs, setAcceptanceDeadlineMs] = useState(null);
    const [acceptanceAuthoritativeRemaining, setAcceptanceAuthoritativeRemaining] = useState(0);
    const [acceptanceAuthoritativeDeadlineMs, setAcceptanceAuthoritativeDeadlineMs] = useState(null);
    const [acceptanceStartDeadlineMs, setAcceptanceStartDeadlineMs] = useState(null);
    const [acceptanceError, setAcceptanceError] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState("IDLE");

    const clearPendingAcceptance = useCallback((message = null) => {
        pendingAcceptanceRef.current = null;
        acceptanceActiveRef.current = false;
        acceptanceDeadlineRef.current = null;
        acceptanceAuthoritativeDeadlineRef.current = null;
        acceptanceStartDeadlineRef.current = null;
        acceptanceSubmitPendingRef.current = false;
        matchFoundRef.current = false;
        matchmakingClientRef.current?.setHandlers();
        setPendingAcceptance(null);
        setAcceptanceState("READY");
        setAcceptanceRemaining(0);
        setAcceptanceNowMs(monotonicEpochNowMs());
        setAcceptanceDeadlineMs(null);
        setAcceptanceAuthoritativeRemaining(0);
        setAcceptanceAuthoritativeDeadlineMs(null);
        setAcceptanceStartDeadlineMs(null);
        setAcceptanceError(null);
        setQueueStartedAt(null);
        setQueueElapsed(0);
        setIsQueueing(false);
        setConnectionStatus("IDLE");
        if (message) setQueueError(message);
        void disconnectActiveMatchmakingClient(matchmakingClientRef.current);
    }, []);

    const cancelPendingAcceptance = useCallback(() => {
        const pending = pendingAcceptanceRef.current;
        const client = matchmakingClientRef.current;
        if (pending?.matchId && client) client.cancelMatch(pending.matchId);
        clearPendingAcceptance();
    }, [clearPendingAcceptance]);

    const startQueue = useCallback(() => {
        const now = Date.now();
        const recentAttempts = queueAttemptTimesRef.current.filter(
            (attemptedAt) => now - attemptedAt < QUEUE_ATTEMPT_WINDOW_MS);
        if (recentAttempts.length >= QUEUE_ATTEMPT_BURST_LIMIT) {
            setQueueError("Too many matchmaking attempts. Please wait before trying again.");
            return;
        }
        queueAttemptTimesRef.current = [...recentAttempts, now];
        setQueueError(null);
        setQueueElapsed(0);
        setQueueStartedAt(now);
        setIsQueueing(true);
    }, []);

    const cancelQueue = useCallback(() => {
        if (pendingAcceptanceRef.current) {
            cancelPendingAcceptance();
            return;
        }
        setQueueError(null);
        setQueueElapsed(0);
        setQueueStartedAt(null);
        setIsQueueing(false);
    }, [cancelPendingAcceptance]);

    useEffect(() => {
        if (!isAuthenticated && isQueueing) {
            window.queueMicrotask(cancelQueue);
        }
    }, [cancelQueue, isAuthenticated, isQueueing]);

    useEffect(() => {
        if (!isQueueing || queueStartedAt == null) return undefined;
        const updateElapsed = () => {
            setQueueElapsed(Math.max(0, Math.floor((Date.now() - queueStartedAt) / 1000)));
        };
        updateElapsed();
        const interval = window.setInterval(updateElapsed, 250);
        return () => window.clearInterval(interval);
    }, [isQueueing, queueStartedAt]);

    useEffect(() => {
        if (!pendingAcceptance) return undefined;
        const updateRemaining = () => {
            const nowMs = monotonicEpochNowMs();
            setAcceptanceNowMs(nowMs);
            setAcceptanceRemaining(secondsRemaining(acceptanceDeadlineRef.current, nowMs));
            setAcceptanceAuthoritativeRemaining(
                secondsRemaining(acceptanceAuthoritativeDeadlineRef.current, nowMs),
            );
        };
        updateRemaining();
        const interval = window.setInterval(updateRemaining, COUNTDOWN_UPDATE_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [pendingAcceptance]);

    useEffect(() => {
        if (!pendingAcceptance || acceptanceAuthoritativeDeadlineMs == null) return undefined;
        const delayMs = Math.max(0, Number(acceptanceAuthoritativeDeadlineMs) - monotonicEpochNowMs());
        const timeout = window.setTimeout(() => {
            if (acceptanceAuthoritativeDeadlineRef.current === acceptanceAuthoritativeDeadlineMs) {
                clearPendingAcceptance();
            }
        }, delayMs);
        return () => window.clearTimeout(timeout);
    }, [acceptanceAuthoritativeDeadlineMs, clearPendingAcceptance, pendingAcceptance]);

    useEffect(() => {
        if (!isQueueing) return undefined;

        let disposed = false;
        matchFoundRef.current = false;
        matchmakingClientRef.current = null;

        const updatePendingAcceptance = (rawEvent) => {
            const event = acceptanceEventForClient(rawEvent);
            if (!event) return;
            const previous = pendingAcceptanceRef.current;
            const samePendingMatch = previous?.matchId
                && String(previous.matchId) === String(event.matchId);
            const measuredDeadlineMs = localAcceptanceDeadlineForEvent(event);
            const measuredAuthoritativeDeadlineMs = localAcceptanceDeadlineForEvent(event, 0);
            const nextDeadlineMs = samePendingMatch && acceptanceDeadlineRef.current != null
                ? acceptanceDeadlineRef.current
                : measuredDeadlineMs;
            const nextAuthoritativeDeadlineMs = samePendingMatch
                && acceptanceAuthoritativeDeadlineRef.current != null
                ? acceptanceAuthoritativeDeadlineRef.current
                : measuredAuthoritativeDeadlineMs;
            const nextStartDeadlineMs = samePendingMatch && acceptanceStartDeadlineRef.current != null
                ? acceptanceStartDeadlineRef.current
                : acceptanceVisibleStartMs(nextDeadlineMs);
            const nowMs = monotonicEpochNowMs();

            pendingAcceptanceRef.current = event;
            acceptanceActiveRef.current = true;
            acceptanceDeadlineRef.current = nextDeadlineMs;
            acceptanceAuthoritativeDeadlineRef.current = nextAuthoritativeDeadlineMs;
            acceptanceStartDeadlineRef.current = nextStartDeadlineMs;
            setPendingAcceptance(event);
            setAcceptanceState(acceptanceStateForEvent(event));
            setAcceptanceNowMs(nowMs);
            setAcceptanceDeadlineMs(nextDeadlineMs);
            setAcceptanceAuthoritativeDeadlineMs(nextAuthoritativeDeadlineMs);
            setAcceptanceStartDeadlineMs(nextStartDeadlineMs);
            setAcceptanceRemaining(secondsRemaining(nextDeadlineMs, nowMs));
            setAcceptanceAuthoritativeRemaining(secondsRemaining(nextAuthoritativeDeadlineMs, nowMs));
            setAcceptanceError(null);
        };

        const client = getActiveMatchmakingClient({
            onStatus: (status) => {
                if (disposed) return;
                setConnectionStatus(status);
                if (status === "ERROR" || status === "CLOSED") {
                    if (acceptanceActiveRef.current) {
                        acceptanceSubmitPendingRef.current = false;
                        setAcceptanceState(acceptanceStateForEvent(pendingAcceptanceRef.current));
                        setAcceptanceError("Connection lost. Reconnecting...");
                        return;
                    }
                    if (matchFoundRef.current) return;
                    setQueueError("Matchmaking connection lost. Try again.");
                    setQueueStartedAt(null);
                    setIsQueueing(false);
                    return;
                }
                if (status === "CONNECTED") {
                    if (acceptanceActiveRef.current) client.resumeMatch();
                    else if (!matchFoundRef.current) client.joinQueue();
                }
            },
            onEvent: (event) => {
                if (disposed) return;
                if (event.type === "MATCH_ERROR") {
                    if (acceptanceActiveRef.current) {
                        if (isMatchAcceptanceUnavailableError(event)) {
                            clearPendingAcceptance();
                            return;
                        }
                        acceptanceSubmitPendingRef.current = false;
                        setAcceptanceState(acceptanceStateForEvent(pendingAcceptanceRef.current));
                        setAcceptanceError(event.message ?? "The match request was rejected.");
                        return;
                    }
                    setQueueError(event.message ?? "The queue request was rejected.");
                    setQueueStartedAt(null);
                    setIsQueueing(false);
                    return;
                }
                const pending = pendingAcceptanceRef.current;
                if (pending
                    && isMatchAcceptanceTerminalEventForMatch(event, pending.matchId)) {
                    clearPendingAcceptance(event.message ?? "The match acceptance window has closed.");
                    return;
                }
                if (event.type === "MATCH_FOUND" && event.status === "MATCH_ACCEPT") {
                    matchFoundRef.current = true;
                    updatePendingAcceptance(event);
                    setQueueStartedAt(null);
                    setQueueElapsed(0);
                    setQueueError(null);
                    return;
                }
                if (event.type === "MATCH_ACCEPTED" && event.status === "MATCH_ACCEPT") {
                    if (!acceptanceActiveRef.current
                        || !pending?.matchId
                        || String(event.matchId) !== String(pending.matchId)) return;
                    updatePendingAcceptance(event);
                    acceptanceSubmitPendingRef.current = false;
                    return;
                }
                if (event.type === "MATCH_STARTED" && event.status === "LOADOUT_SELECT") {
                    // Only this authoritative transition may introduce participant data.
                    client.setHandlers();
                    matchFoundRef.current = true;
                    pendingAcceptanceRef.current = null;
                    acceptanceActiveRef.current = false;
                    acceptanceDeadlineRef.current = null;
                    acceptanceAuthoritativeDeadlineRef.current = null;
                    acceptanceStartDeadlineRef.current = null;
                    acceptanceSubmitPendingRef.current = false;
                    setPendingAcceptance(null);
                    setAcceptanceState("READY");
                    setAcceptanceRemaining(0);
                    setAcceptanceDeadlineMs(null);
                    setAcceptanceAuthoritativeRemaining(0);
                    setAcceptanceAuthoritativeDeadlineMs(null);
                    setAcceptanceStartDeadlineMs(null);
                    setAcceptanceError(null);
                    setQueueStartedAt(null);
                    setQueueElapsed(0);
                    setIsQueueing(false);
                    navigate("/matchmaking", { state: { matchEvent: event } });
                }
            },
        }, { autoReconnect: true, autoJoinOnConnect: false });
        matchmakingClientRef.current = client;
        void client.connect();

        return () => {
            if (matchFoundRef.current) return;
            disposed = true;
            client.leaveQueue();
            void disconnectActiveMatchmakingClient(client);
        };
    }, [clearPendingAcceptance, isQueueing, navigate]);

    const acceptPendingMatch = useCallback(() => {
        const pending = pendingAcceptanceRef.current;
        if (acceptanceSubmitPendingRef.current
            || acceptanceState !== "READY"
            || connectionStatus !== "CONNECTED"
            || acceptanceAuthoritativeDeadlineRef.current == null
            || monotonicEpochNowMs() >= acceptanceAuthoritativeDeadlineRef.current
            || !pending?.matchId
            || !matchmakingClientRef.current) return;
        acceptanceSubmitPendingRef.current = true;
        setAcceptanceError(null);
        setAcceptanceState("ACCEPTING");
        matchmakingClientRef.current.acceptMatch(pending.matchId);
    }, [acceptanceState, connectionStatus]);

    const value = useMemo(() => ({
        isQueueing,
        queueElapsed,
        queueError,
        startQueue,
        cancelQueue,
    }), [cancelQueue, isQueueing, queueElapsed, queueError, startQueue]);

    return (
        <MatchmakingContext.Provider value={value}>
            {children}
            {pendingAcceptance && (
                <MatchAcceptanceModal
                    remaining={acceptanceRemaining}
                    authoritativeRemaining={acceptanceAuthoritativeRemaining}
                    deadlineMs={acceptanceDeadlineMs}
                    visibleStartMs={acceptanceStartDeadlineMs}
                    acceptanceState={acceptanceState}
                    otherPlayerAccepted={pendingAcceptance.otherPlayerAccepted === true}
                    connectionStatus={connectionStatus}
                    error={acceptanceError}
                    onAccept={acceptPendingMatch}
                    onClose={cancelPendingAcceptance}
                />
            )}
        </MatchmakingContext.Provider>
    );
}
