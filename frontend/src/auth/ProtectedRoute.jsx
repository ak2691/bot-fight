import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { authUnavailableMessage } from "./authState";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";
import FatalRecoveryScreen from "../components/FatalRecoveryScreen.jsx";
import { isUnsupportedWebGL } from "./fatalRecovery.js";
import { isArenaPresentationGateReady } from "../gameArena/pixi/useArenaPresentationAssets.js";
import { useArenaPresentationAssetsContext } from "../gameArena/pixi/ArenaPresentationAssetsContext.js";

export default function ProtectedRoute({ children, allowGuest = false }) {
    const { isAuthenticated, isGuest, isLoading, authError } = useAuth();
    const hasAccess = isAuthenticated || (allowGuest && isGuest);
    const assets = useArenaPresentationAssetsContext();
    const location = useLocation();

    if (isLoading) {
        return <ArenaLoadingScreen />;
    }

    if (authError && !isAuthenticated && !(allowGuest && isGuest)) {
        return (
            <FatalRecoveryScreen
                title="Unable to verify your session"
                message={`${authUnavailableMessage(authError)} Refresh the page to check again.`}
            />
        );
    }

    if (!hasAccess) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (!isArenaPresentationGateReady(assets)) {
        if (assets.error) {
            const unsupported = isUnsupportedWebGL(assets.error);
            return (
                <FatalRecoveryScreen
                    title={unsupported ? "WebGL is unavailable" : "The game renderer could not load"}
                    message={unsupported
                        ? "This browser or device does not support the WebGL graphics needed by the game. Try a browser or device with WebGL support."
                        : "The game renderer could not be loaded. Refresh the page to load the current application files."}
                    showRefresh={!unsupported}
                />
            );
        }
        return (
            <ArenaLoadingScreen
                label={getPresentationLoadingLabel(assets)}
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
