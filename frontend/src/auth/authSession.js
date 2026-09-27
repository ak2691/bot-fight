export const AUTHENTICATION_LOST_EVENT = "botfight:authentication-lost";
export const AUTH_SESSION_VALID = "VALID";
export const AUTH_SESSION_INVALID = "INVALID";
export const AUTH_SESSION_TEMPORARY_FAILURE = "TEMPORARY_FAILURE";

const AUTH_PROBE_TIMEOUT_MS = 5_000;
let authenticationProbeInFlight = null;

export function subscribeToAuthenticationLoss(handler) {
    if (typeof window === "undefined" || typeof handler !== "function") {
        return () => {};
    }
    window.addEventListener(AUTHENTICATION_LOST_EVENT, handler);
    return () => window.removeEventListener(AUTHENTICATION_LOST_EVENT, handler);
}

export function dispatchAuthenticationLoss() {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new Event(AUTHENTICATION_LOST_EVENT));
}

/**
 * Checks whether the HTTP session still identifies a user. Temporary failures
 * are deliberately inconclusive so they cannot turn backend outages into logouts.
 */
export function probeCurrentAuthentication({
    fetchImpl = globalThis.fetch,
    url = "/api/auth/me",
    timeoutMs = AUTH_PROBE_TIMEOUT_MS,
} = {}) {
    if (authenticationProbeInFlight) return authenticationProbeInFlight;

    const request = (async () => {
        if (typeof fetchImpl !== "function") return AUTH_SESSION_TEMPORARY_FAILURE;
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timeout = controller == null
            ? null
            : setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, {
                method: "GET",
                credentials: "include",
                headers: { Accept: "application/json" },
                ...(controller ? { signal: controller.signal } : {}),
            });
            if (Number(response?.status) === 401) return AUTH_SESSION_INVALID;
            if (!response?.ok) return AUTH_SESSION_TEMPORARY_FAILURE;

            const body = await response.json().catch(() => null);
            if (body?.guest === true || body?.authenticated === true) return AUTH_SESSION_VALID;
            if (body?.authenticated === false) return AUTH_SESSION_INVALID;
            return AUTH_SESSION_TEMPORARY_FAILURE;
        } catch {
            return AUTH_SESSION_TEMPORARY_FAILURE;
        } finally {
            if (timeout != null) clearTimeout(timeout);
        }
    })();

    let trackedRequest;
    trackedRequest = request.finally(() => {
        if (authenticationProbeInFlight === trackedRequest) {
            authenticationProbeInFlight = null;
        }
    });
    authenticationProbeInFlight = trackedRequest;
    return trackedRequest;
}
