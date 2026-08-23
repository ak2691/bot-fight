import { cloneElement, isValidElement } from "react";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { SERVER_DOWN_MESSAGE } from "./serverError.js";

export default function ActiveMatchProtectedRoute({ children }) {
    const { activeMatchStatus: status } = useMatchmaking();

    if (status.loading) {
        return <ArenaLoadingScreen />;
    }

    if (status.error) {
        return (
            <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-arena-deep px-5 text-ink-muted">
                <p role="alert" className="text-center font-mono text-xs tracking-[0.15em]">{status.error}</p>
                {status.error === SERVER_DOWN_MESSAGE && (
                    <p className="text-center font-mono text-xs tracking-[0.15em]">Refresh to try again.</p>
                )}
            </main>
        );
    }

    return isValidElement(children)
        ? cloneElement(children, {
            activeMatch: status.activeMatch === true,
            activeMatchId: status.matchId,
        })
        : children;
}
