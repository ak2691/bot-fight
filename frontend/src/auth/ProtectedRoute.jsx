import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { authUnavailableMessage } from "./authState";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import { isArenaPresentationGateReady } from "../gameArena/pixi/useArenaPresentationAssets.js";
import { useArenaPresentationAssetsContext } from "../gameArena/pixi/ArenaPresentationAssetsContext.js";

export default function ProtectedRoute({ children }) {
    const { isAuthenticated, isLoading, authError, refreshUser } = useAuth();
    const assets = useArenaPresentationAssetsContext();
    const location = useLocation();

    if (isLoading) {
        return <ArenaLoadingScreen />;
    }

    if (authError && !isAuthenticated) {
        return (
            <ArenaLoadingScreen
                label={authUnavailableMessage(authError)}
                onRetry={() => void refreshUser()}
            />
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (!isArenaPresentationGateReady(assets)) {
        return (
            <ArenaLoadingScreen
                label={getPresentationLoadingLabel(assets)}
                error={assets.error}
                onRetry={assets.error ? assets.retry : null}
            />
        );
    }

    return children;
}

function getPresentationLoadingLabel(assets) {
    if (assets.error) return "Unable to initialize game renderer.";
    if (!assets.rendererReady) return "Initializing game renderer...";
    return "Loading...";
}
