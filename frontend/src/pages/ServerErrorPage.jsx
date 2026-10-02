import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErrorPanel from "../components/ErrorPanel.jsx";
import { apiUrl } from "../config/api";
import { useAuth } from "../auth/auth-context.js";
import {
    defaultAuthRoute,
    isServerErrorStatus,
    SERVER_DOWN_MESSAGE,
    serverErrorMessage,
} from "../auth/serverError.js";

const INITIAL_STATUS = { checking: true, message: null, status: null };
const SERVER_RETRY_INTERVAL_MS = 5_000;

export default function ServerErrorPage() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const [status, setStatus] = useState(INITIAL_STATUS);

    const probeServer = useCallback(async (signal) => {
        try {
            const response = await fetch(apiUrl("/api/auth/me"), {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                signal,
            });

            if (isServerErrorStatus(response.status)) {
                return { kind: "error", message: SERVER_DOWN_MESSAGE, status: response.status };
            }

            const user = await response.json().catch(() => null);
            return { kind: "healthy", user };
        } catch (error) {
            if (error?.name === "AbortError") return { kind: "aborted" };
            return { kind: "error", message: serverErrorMessage(error), status: null };
        }
    }, []);

    const applyProbeResult = useCallback((result) => {
        if (!result || result.kind === "aborted") return;
        if (result.kind === "healthy") {
            navigate(defaultAuthRoute(result.user), { replace: true });
            return;
        }
        setStatus({
            checking: false,
            message: result.message ?? SERVER_DOWN_MESSAGE,
            status: result.status ?? null,
        });
    }, [navigate]);

    useEffect(() => {
        const controller = new AbortController();
        void probeServer(controller.signal).then((result) => {
            if (!controller.signal.aborted) applyProbeResult(result);
        });
        const interval = window.setInterval(() => {
            void probeServer(controller.signal).then((result) => {
                if (!controller.signal.aborted) applyProbeResult(result);
            });
        }, SERVER_RETRY_INTERVAL_MS);
        return () => {
            controller.abort();
            window.clearInterval(interval);
        };
    }, [applyProbeResult, probeServer]);

    if (status.checking) {
        return (
            <ErrorPanel
                kind="connection"
                tone="neutral"
                title="Checking server status"
                message="Verifying that the service is still unavailable."
                secondaryLabel={isAuthenticated ? "Go home" : "Back to login"}
                secondaryTo={isAuthenticated ? "/home" : "/login"}
            />
        );
    }

    return (
        <ErrorPanel
            kind="connection"
            title="Can't reach the server"
            message={status.message ?? SERVER_DOWN_MESSAGE}
            primaryLabel="Try again"
            onPrimary={() => window.location.reload()}
            secondaryLabel={isAuthenticated ? "Go home" : "Back to login"}
            secondaryTo={isAuthenticated ? "/home" : "/login"}
            errorRef={status.status != null ? `HTTP ${status.status}` : null}
        >
            <p className="max-w-[340px] text-xs leading-5 text-slate-500">
                We will send you back automatically when the server is healthy again.
            </p>
        </ErrorPanel>
    );
}
