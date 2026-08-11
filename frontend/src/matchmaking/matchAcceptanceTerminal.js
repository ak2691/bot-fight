const MATCH_ACCEPTANCE_TERMINAL_EVENT_TYPES = new Set([
    "MATCH_ACCEPTANCE_EXPIRED",
    "MATCH_ACCEPTANCE_CANCELLED",
]);

export function isMatchAcceptanceTerminalEvent(event) {
    return MATCH_ACCEPTANCE_TERMINAL_EVENT_TYPES.has(event?.type);
}

function isSameMatch(eventMatchId, currentMatchId) {
    return eventMatchId == null
        || currentMatchId == null
        || String(eventMatchId) === String(currentMatchId);
}

export function isMatchAcceptanceTerminalEventForMatch(event, currentMatchId) {
    return isMatchAcceptanceTerminalEvent(event)
        && isSameMatch(event.matchId, currentMatchId);
}

export function isMatchAcceptanceUnavailableError(event) {
    return event?.type === "MATCH_ERROR"
        && typeof event.message === "string"
        && event.message.toLowerCase().includes("match acceptance window");
}

export function createMatchmakingTerminalRedirect(navigate) {
    let redirected = false;

    return ({ event, acceptanceActive = false, currentMatchId = null } = {}) => {
        if (redirected || !event) return false;

        const noActiveMatch = event.type === "NO_ACTIVE_MATCH";
        const expiredAcceptance = acceptanceActive
            && isMatchAcceptanceTerminalEventForMatch(event, currentMatchId);
        if (!noActiveMatch && !expiredAcceptance) return false;

        redirected = true;
        navigate("/home", { replace: true });
        return true;
    };
}
