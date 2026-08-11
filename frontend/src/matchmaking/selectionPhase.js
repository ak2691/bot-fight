export function selectionPhaseForEvent(event) {
    // Match acceptance uses a temporary pending-match ID. It is not a loadout
    // selection phase, and the persisted match created after both players
    // accept has a different ID. Tracking the acceptance event here would
    // make the real MATCH_STARTED event look like a stale event from another
    // match and prevent the selection UI from opening.
    if (!event?.matchId || event.roundNumber == null || event.status === "MATCH_ACCEPT") return null;

    const roundNumber = Number(event.roundNumber);
    if (!Number.isInteger(roundNumber)) return null;

    return {
        key: selectionPhaseKey(event),
        matchId: String(event.matchId),
        roundNumber,
    };
}

export function selectionPhaseKey(event) {
    if (!event?.matchId || event.roundNumber == null || !event.loadoutSelectionEndsAt) return null;
    return `${event.matchId}:${event.roundNumber}:${event.loadoutSelectionEndsAt}`;
}

export function isSelectionPhaseStale(incomingPhase, activePhase) {
    if (!incomingPhase || !activePhase) return false;
    if (incomingPhase.matchId !== activePhase.matchId) return true;
    if (incomingPhase.roundNumber < activePhase.roundNumber) return true;
    return incomingPhase.roundNumber === activePhase.roundNumber
        && Boolean(incomingPhase.key)
        && Boolean(activePhase.key)
        && incomingPhase.key !== activePhase.key;
}

export function isSelectionEventForActivePhase(event, activePhase) {
    if (!activePhase) return true;

    const eventPhase = selectionPhaseForEvent(event);
    if (!eventPhase || eventPhase.matchId !== activePhase.matchId
        || eventPhase.roundNumber !== activePhase.roundNumber) {
        return false;
    }
    return !activePhase.key || !eventPhase.key || activePhase.key === eventPhase.key;
}

export function isOlderMatchRoundEvent(event, activeEvent) {
    const eventPhase = selectionPhaseForEvent(event);
    const activePhase = selectionPhaseForEvent(activeEvent);
    return Boolean(eventPhase && activePhase)
        && eventPhase.matchId === activePhase.matchId
        && eventPhase.roundNumber < activePhase.roundNumber;
}
