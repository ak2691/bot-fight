import { cloneElement, isValidElement } from "react";
import { Navigate } from "react-router-dom";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import FatalRecoveryScreen from "../components/FatalRecoveryScreen.jsx";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { SERVER_DOWN_MESSAGE } from "./serverError.js";

export default function ActiveMatchProtectedRoute({ children }) {
    const { activeMatchStatus: status } = useMatchmaking();

    if (status.loading) {
        return <ArenaLoadingScreen />;
    }

    if (status.error) {
        if (status.error === SERVER_DOWN_MESSAGE) return <Navigate to="/error" replace />;
        return <FatalRecoveryScreen message={status.error} />;
    }

    return isValidElement(children)
        ? cloneElement(children, {
            activeMatch: status.activeMatch === true,
            activeMatchId: status.matchId,
        })
        : children;
}
