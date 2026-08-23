import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "./auth/AuthLayout";
import { apiUrl } from "../config/api";
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
            <AuthLayout title="Checking server status" subtitle="Verifying that the service is still unavailable.">
                <p role="status" className="text-center text-sm text-ink-muted">
                    One moment...
                </p>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout title="Server unavailable" subtitle="The service encountered an unexpected error.">
            <div className="space-y-4 text-center">
                <p role="alert" className="text-sm text-red-300">
                    {status.message ?? SERVER_DOWN_MESSAGE}
                </p>
                {(status.message ?? SERVER_DOWN_MESSAGE) === SERVER_DOWN_MESSAGE && (
                    <p className="text-sm leading-6 text-ink-muted">
                        Refresh to try again.
                    </p>
                )}
                <p className="text-sm leading-6 text-ink-muted">
                    We will send you back automatically when the server is healthy again.
                </p>
                <Link
                    to="/login"
                    className="block text-sm text-cyan-300 hover:text-cyan-100"
                >
                    Return to login
                </Link>
            </div>
        </AuthLayout>
    );
}
