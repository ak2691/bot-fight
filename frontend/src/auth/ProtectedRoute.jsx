import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import { isArenaPresentationGateReady } from "../gameArena/pixi/useArenaPresentationAssets.js";
import { useArenaPresentationAssetsContext } from "../gameArena/pixi/ArenaPresentationAssetsContext.js";

export default function ProtectedRoute({ children }) {
    const { isAuthenticated, isLoading } = useAuth();
    const assets = useArenaPresentationAssetsContext();
    const location = useLocation();

    if (isLoading) {
        return <ArenaLoadingScreen />;
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
