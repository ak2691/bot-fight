import { Navigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import { puzzlesVisibleTo } from "../config/featureFlags.js";

/** The public puzzle pages send everyone but admins home while puzzles are hidden. */
export default function PuzzlesRoute({ children }) {
    const { user, isLoading } = useAuth();
    if (isLoading) return <ArenaLoadingScreen />;
    if (!puzzlesVisibleTo(user)) return <Navigate to="/home" replace />;
    return children;
}
