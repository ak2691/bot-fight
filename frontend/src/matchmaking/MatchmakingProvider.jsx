import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { createMatchmakingClient } from "./stompClient";
import { MatchmakingContext } from "./matchmaking-context";

const QUEUE_ATTEMPT_BURST_LIMIT = 3;
const QUEUE_ATTEMPT_WINDOW_MS = 5000;

export default function MatchmakingProvider({ children }) {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const matchFoundRef = useRef(false);
    const queueAttemptTimesRef = useRef([]);
    const [isQueueing, setIsQueueing] = useState(false);
    const [queueStartedAt, setQueueStartedAt] = useState(null);
    const [queueElapsed, setQueueElapsed] = useState(0);
    const [queueError, setQueueError] = useState(null);
    const [foundMatch, setFoundMatch] = useState(null);

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
        setQueueError(null);
        setQueueElapsed(0);
        setQueueStartedAt(null);
        setIsQueueing(false);
    }, []);

    const clearFoundMatch = useCallback(() => {
        setFoundMatch(null);
    }, []);

    useEffect(() => {
        if (!isAuthenticated && isQueueing) {
            window.queueMicrotask(cancelQueue);
        }
    }, [cancelQueue, isAuthenticated, isQueueing]);

    useEffect(() => {
        if (!isQueueing || queueStartedAt == null) return;
        const updateElapsed = () => {
            setQueueElapsed(Math.max(0, Math.floor((Date.now() - queueStartedAt) / 1000)));
        };
        updateElapsed();
        const interval = window.setInterval(updateElapsed, 250);
        return () => window.clearInterval(interval);
    }, [isQueueing, queueStartedAt]);

    useEffect(() => {
        if (!isQueueing) return;

        let disposed = false;
        matchFoundRef.current = false;
        const client = createMatchmakingClient({
            onStatus: (status) => {
                if (disposed || matchFoundRef.current) return;
                if (status === "CONNECTED") client.joinQueue();
                if (status === "ERROR" || status === "CLOSED") {
                    setQueueError("Matchmaking connection lost. Try again.");
                    setQueueStartedAt(null);
                    setIsQueueing(false);
                }
            },
            onEvent: (event) => {
                if (disposed) return;
                if (event.type === "MATCH_ERROR") {
                    setQueueError(event.message ?? "The queue request was rejected.");
                    setQueueStartedAt(null);
                    setIsQueueing(false);
                    return;
                }
                if (event.type === "MATCH_FOUND" && event.status === "MATCH_ACCEPT") {
                    matchFoundRef.current = true;
                    setQueueStartedAt(null);
                    setQueueElapsed(0);
                    setIsQueueing(false);
                    navigate("/matchmaking", { state: { matchEvent: event } });
                    return;
                }
                if (event.type === "MATCH_FOUND" && event.status === "MATCH_FOUND") {
                    matchFoundRef.current = true;
                    setFoundMatch(event);
                    return;
                }
                if (event.type === "MATCH_LOADOUT_SELECTION_READY"
                    || (event.type === "MATCH_FOUND" && event.status === "LOADOUT_SELECT")) {
                    matchFoundRef.current = true;
                    setQueueStartedAt(null);
                    setQueueElapsed(0);
                    setIsQueueing(false);
                    navigate("/matchmaking", { state: { matchEvent: event } });
                }
            },
        });
        void client.connect();

        return () => {
            disposed = true;
            if (!matchFoundRef.current) client.leaveQueue();
            client.disconnect();
        };
    }, [isQueueing, navigate]);

    const value = useMemo(() => ({
        isQueueing,
        queueElapsed,
        queueError,
        startQueue,
        cancelQueue,
        clearFoundMatch,
    }), [cancelQueue, clearFoundMatch, isQueueing, queueElapsed, queueError, startQueue]);

    return (
        <MatchmakingContext.Provider value={value}>
            {children}
            {foundMatch && (
                <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#02060b]" role="status" aria-live="assertive">
                    <div className="border border-cyan-400/60 bg-[#07111bf2] px-10 py-8 text-center shadow-[0_0_80px_rgba(34,211,238,.22)]">
                        <p className="font-mono text-xs font-bold tracking-[.35em] text-cyan-300">MATCH FOUND</p>
                        <p className="mt-3 text-sm text-slate-300">Entering the arena...</p>
                    </div>
                </div>
            )}
        </MatchmakingContext.Provider>
    );
}
