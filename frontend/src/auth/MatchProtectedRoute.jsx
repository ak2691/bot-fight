import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { SERVER_DOWN_MESSAGE } from "./serverError.js";

export default function MatchProtectedRoute({ children }) {
    const { refreshActiveMatchStatus } = useMatchmaking();
    const location = useLocation();
    const cachedHandoff = location.state?.activeMatchVerified === true;
    const cachedMatchId = cachedHandoff ? location.state?.matchId ?? null : null;
    const [isRevalidating, setIsRevalidating] = useState(!cachedHandoff);
    const [routeStatus, setRouteStatus] = useState({
        loading: !cachedHandoff,
        activeMatch: cachedHandoff,
        matchId: cachedMatchId,
        error: null,
    });

    useEffect(() => {
        let mounted = true;
        if (cachedHandoff) return undefined;
        const controller = new AbortController();
        void refreshActiveMatchStatus(controller.signal)
            .then((nextStatus) => {
                if (mounted && nextStatus) setRouteStatus(nextStatus);
            })
            .finally(() => {
                if (mounted) setIsRevalidating(false);
            });
        return () => {
            mounted = false;
            controller.abort();
        };
    }, [cachedHandoff, cachedMatchId, refreshActiveMatchStatus]);

    if (isRevalidating || routeStatus.loading) {
        return <ArenaLoadingScreen />;
    }

    if (routeStatus.error) {
        return (
            <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-arena-deep px-5 text-ink-muted">
                <p role="alert" className="text-center font-mono text-xs tracking-[0.15em]">{routeStatus.error}</p>
                {routeStatus.error === SERVER_DOWN_MESSAGE && (
                    <p className="text-center font-mono text-xs tracking-[0.15em]">Refresh to try again.</p>
                )}
            </main>
        );
    }

    if (routeStatus.activeMatch !== true) {
        return <Navigate to="/home" replace />;
    }

    return children;
}
