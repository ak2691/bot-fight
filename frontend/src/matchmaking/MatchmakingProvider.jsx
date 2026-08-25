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
import { apiUrl } from "../config/api";
import { serverErrorMessage } from "../auth/serverError.js";
import {
    getActiveMatchmakingClient,
    getEstimatedOneWayNetworkDelayMs,
} from "./stompClient";
import { MatchmakingContext } from "./matchmaking-context";

const QUEUE_ATTEMPT_BURST_LIMIT = 3;
const QUEUE_ATTEMPT_WINDOW_MS = 5000;
const ACTIVE_MATCH_REQUEST_REUSE_MS = 1_000;
const TOO_MANY_REQUESTS_MESSAGE = "Too many requests. Try again later.";
const QUEUE_ALERT_DISMISS_MS = 3_500;
const ACCEPTANCE_VISIBLE_GRACE_MS = 2_000;
const COUNTDOWN_UPDATE_INTERVAL_MS = 250;
const INITIAL_ACTIVE_MATCH_STATUS = {
    loading: true,
    activeMatch: false,
    matchId: null,
    error: null,
};

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

function queueStatusErrorMessage(error) {
    if (Number(error?.status) === 429) return TOO_MANY_REQUESTS_MESSAGE;
    if (Number(error?.status) >= 500 || !Number.isFinite(Number(error?.status))) {
        return "The active match could not be checked right now. Try again later.";
    }
    return "The active match could not be checked. Try again.";
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
    const queueStartInFlightRef = useRef(false);
    const activeMatchRequestRef = useRef(null);
    const activeMatchSnapshotRef = useRef(null);
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
    const [activeMatchStatus, setActiveMatchStatus] = useState(INITIAL_ACTIVE_MATCH_STATUS);

    useEffect(() => {
        if (!queueError) return undefined;
        const timeout = window.setTimeout(() => {
            setQueueError((current) => current === queueError ? null : current);
        }, QUEUE_ALERT_DISMISS_MS);
        return () => window.clearTimeout(timeout);
    }, [queueError]);

    const requestActiveMatchStatus = useCallback((signal) => {
        const now = Date.now();
        const inFlight = activeMatchRequestRef.current;
        if (inFlight) return inFlight.promise;

        const cached = activeMatchSnapshotRef.current;
        if (cached && now - cached.checkedAt < ACTIVE_MATCH_REQUEST_REUSE_MS) {
            return Promise.resolve(cached.result);
        }

        const promise = (async () => {
            try {
                const response = await fetch(apiUrl("/api/matches/active"), {
                    credentials: "include",
                    cache: "no-store",
                    signal,
                });
                if (!response.ok) {
                    const requestError = new Error(`active match status request failed with ${response.status}`);
                    requestError.status = response.status;
                    throw requestError;
                }
                const matchStatus = await response.json();
                return {
                    status: {
                        loading: false,
                        activeMatch: matchStatus.activeMatch === true,
                        matchId: matchStatus.matchId ?? null,
                        error: null,
                    },
                    error: null,
                };
            } catch (error) {
                if (error.name === "AbortError") throw error;
                return { status: null, error };
            }
        })();
        const trackedRequest = { promise, startedAt: now };
        activeMatchRequestRef.current = trackedRequest;
        void promise.then(
            (result) => {
                activeMatchSnapshotRef.current = { checkedAt: Date.now(), result };
                if (activeMatchRequestRef.current === trackedRequest) {
                    activeMatchRequestRef.current = null;
                }
            },
            () => {
                if (activeMatchRequestRef.current === trackedRequest) {
                    activeMatchRequestRef.current = null;
                }
            },
        );
        return promise;
    }, []);

    const refreshActiveMatchStatus = useCallback(async (signal) => {
        setActiveMatchStatus((current) => ({ ...current, loading: true, error: null }));
        try {
            const result = await requestActiveMatchStatus(signal);
            if (result.error) throw result.error;
            setActiveMatchStatus(result.status);
            return result.status;
        } catch (error) {
            if (error.name === "AbortError") return null;
            const nextStatus = {
                loading: false,
                activeMatch: false,
                matchId: null,
                error: serverErrorMessage(error),
            };
            setActiveMatchStatus(nextStatus);
            return nextStatus;
        }
    }, [requestActiveMatchStatus]);

    const verifyActiveMatchForQueue = useCallback(async () => {
        try {
            const result = await requestActiveMatchStatus();
            if (result.error) {
                return {
                    loading: false,
                    activeMatch: false,
                    matchId: null,
                    error: queueStatusErrorMessage(result.error),
                };
            }
            return result.status;
        } catch (error) {
            return {
                loading: false,
                activeMatch: false,
                matchId: null,
                error: queueStatusErrorMessage(error),
            };
        }
    }, [requestActiveMatchStatus]);

    const markActiveMatch = useCallback((matchId = null) => {
        setActiveMatchStatus({ loading: false, activeMatch: true, matchId, error: null });
    }, []);

    const clearActiveMatch = useCallback(() => {
        setActiveMatchStatus({ loading: false, activeMatch: false, matchId: null, error: null });
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            setActiveMatchStatus({ loading: false, activeMatch: false, matchId: null, error: null });
            return undefined;
        }
        const controller = new AbortController();
        void refreshActiveMatchStatus(controller.signal);
        return () => controller.abort();
    }, [isAuthenticated, refreshActiveMatchStatus]);

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
        matchmakingClientRef.current?.unsubscribeMatchmaking?.();
        matchmakingClientRef.current?.unsubscribeMatch?.();
    }, []);

    const cancelPendingAcceptance = useCallback(() => {
        const pending = pendingAcceptanceRef.current;
        const client = matchmakingClientRef.current;
        if (pending?.matchId && client) client.cancelMatch(pending.matchId);
        clearPendingAcceptance();
    }, [clearPendingAcceptance]);

    const startQueue = useCallback(async () => {
        if (queueStartInFlightRef.current) return;
        const now = Date.now();
        const recentAttempts = queueAttemptTimesRef.current.filter(
            (attemptedAt) => now - attemptedAt < QUEUE_ATTEMPT_WINDOW_MS);
        if (recentAttempts.length >= QUEUE_ATTEMPT_BURST_LIMIT) {
            setQueueError(TOO_MANY_REQUESTS_MESSAGE);
            return;
        }
        queueStartInFlightRef.current = true;
        queueAttemptTimesRef.current = [...recentAttempts, now];
        try {
            setQueueError(null);
            const status = await verifyActiveMatchForQueue();
            if (!status || status.error) {
                setQueueError(status?.error ?? "The active match could not be checked. Try again.");
                return;
            }
            if (status.activeMatch === true) {
                markActiveMatch(status.matchId);
                navigate("/match", {
                    state: {
                        activeMatchVerified: true,
                        matchId: status.matchId,
                    },
                });
                return;
            }
            setQueueError(null);
            setQueueElapsed(0);
            setQueueStartedAt(now);
            setIsQueueing(true);
        } finally {
            queueStartInFlightRef.current = false;
        }
    }, [markActiveMatch, navigate, verifyActiveMatchForQueue]);

    const cancelQueue = useCallback(() => {
        if (pendingAcceptanceRef.current) {
            cancelPendingAcceptance();
            return;
        }
        matchmakingClientRef.current?.leaveQueue?.();
        matchmakingClientRef.current?.unsubscribeMatchmaking?.();
        matchmakingClientRef.current?.unsubscribeMatch?.();
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
                    client.unsubscribeMatchmaking?.();
                    client.subscribeMatch?.();
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
                    markActiveMatch(event.matchId);
                    navigate("/match");
                }
            },
        }, { autoReconnect: true, autoJoinOnConnect: false });
        matchmakingClientRef.current = client;
        client.subscribeMatchmaking?.();
        client.resumeReconnect?.();
        void client.connect();

        return () => {
            if (matchFoundRef.current) return;
            disposed = true;
            client.leaveQueue();
            client.unsubscribeMatchmaking?.();
            client.unsubscribeMatch?.();
        };
    }, [clearPendingAcceptance, isQueueing, markActiveMatch, navigate]);

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
        matchmakingClientRef.current.subscribeMatch?.();
        matchmakingClientRef.current.acceptMatch(pending.matchId);
    }, [acceptanceState, connectionStatus]);

    const value = useMemo(() => ({
        isQueueing,
        queueElapsed,
        queueError,
        activeMatchStatus,
        refreshActiveMatchStatus,
        markActiveMatch,
        clearActiveMatch,
        startQueue,
        cancelQueue,
    }), [
        activeMatchStatus,
        cancelQueue,
        clearActiveMatch,
        isQueueing,
        markActiveMatch,
        queueElapsed,
        queueError,
        refreshActiveMatchStatus,
        startQueue,
    ]);

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
            {queueError && !pendingAcceptance && (
                <div
                    role="alert"
                    aria-live="assertive"
                    className="fixed bottom-6 left-1/2 z-[1000] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded border border-red-700 bg-red-950 px-4 py-2 text-center font-mono text-xs tracking-widest text-red-400 shadow-lg"
                >
                    {queueError}
                </div>
            )}
        </MatchmakingContext.Provider>
    );
}
