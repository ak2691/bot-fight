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

export function isOlderMatchPhaseEvent(event, activeEvent) {
    const eventPhase = selectionPhaseForEvent(event);
    const activePhase = selectionPhaseForEvent(activeEvent);
    if (!eventPhase || !activePhase
        || eventPhase.matchId !== activePhase.matchId
        || eventPhase.roundNumber !== activePhase.roundNumber) return false;
    return phaseRank(event) < phaseRank(activeEvent);
}

function phaseRank(event) {
    if (event?.type === "MATCH_RESULT_READY") return 5;
    if (event?.type === "SIMULATION_PREPARING"
        || event?.type === "MATCH_REPLAY_BATCH"
        || event?.status === "READY_FOR_PLAYBACK"
        || event?.status === "SIMULATION_PREPARING") return 4;
    if (event?.type === "SIMULATION_LOADING" || event?.status === "SIMULATION_LOADING") return 3;
    if (event?.type === "PLAYER_FINISHED" || event?.status === "WAITING_FOR_FINISH") return 2;
    if (event?.type === "MATCH_LOADOUT_SELECTED") return 1;
    if (event?.type === "BOT_BUILDING_SESSION_READY"
        || event?.status === "PREP"
        || event?.status === "OBJECT_PLACEMENT") return 2;
    return 0;
}
