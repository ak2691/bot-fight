import { useAuth } from "../auth/auth-context.js";
import ErrorPanel from "./ErrorPanel.jsx";
import { inferErrorKind } from "./errorKind.js";

export default function FatalRecoveryScreen({
    title = "Unable to load this page",
    message = "Refresh the page to continue.",
    showRefresh = true,
    compact = false,
    kind = null,
    errorRef = null,
}) {
    const { isAuthenticated } = useAuth();
    const destination = isAuthenticated ? "/home" : "/login";
    const destinationLabel = isAuthenticated ? "Go home" : "Back to login";

    return (
        <ErrorPanel
            kind={kind ?? inferErrorKind(`${title} ${message}`)}
            title={title}
            message={message}
            primaryLabel={showRefresh ? "Try again" : null}
            onPrimary={() => window.location.reload()}
            secondaryLabel={destinationLabel}
            secondaryTo={destination}
            errorRef={errorRef}
            compact={compact}
        />
    );
}
