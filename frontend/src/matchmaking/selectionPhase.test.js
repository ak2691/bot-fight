import assert from "node:assert/strict";
import test from "node:test";
import {
    isOlderMatchRoundEvent,
    isSelectionEventForActivePhase,
    isSelectionPhaseStale,
    selectionPhaseForEvent,
} from "./selectionPhase.js";

const roundOneEvent = {
    matchId: "match-1",
    roundNumber: 1,
    loadoutSelectionEndsAt: "2026-08-05T12:01:02.000Z",
};

const roundTwoEvent = {
    matchId: "match-1",
    roundNumber: 2,
    loadoutSelectionEndsAt: "2026-08-05T12:05:02.000Z",
};

test("match acceptance does not become the active loadout selection phase", () => {
    const acceptanceEvent = {
        type: "MATCH_FOUND",
        status: "MATCH_ACCEPT",
        matchId: "pending-match",
        roundNumber: 1,
    };
    const matchStartedEvent = {
        ...roundOneEvent,
        type: "MATCH_STARTED",
        status: "LOADOUT_SELECT",
    };

    const acceptancePhase = selectionPhaseForEvent(acceptanceEvent);
    const startedPhase = selectionPhaseForEvent(matchStartedEvent);

    assert.equal(acceptancePhase, null);
    assert.equal(isSelectionPhaseStale(startedPhase, acceptancePhase), false);
});

test("round-one lock events cannot lock the fresh round-two selection phase", () => {
    const roundTwoPhase = selectionPhaseForEvent(roundTwoEvent);
    const roundOneLock = { ...roundOneEvent, type: "MATCH_LOADOUT_SELECTED" };
    const roundTwoLock = { ...roundTwoEvent, type: "MATCH_LOADOUT_SELECTED" };

    assert.equal(isSelectionPhaseStale(selectionPhaseForEvent(roundOneEvent), roundTwoPhase), true);
    assert.equal(isSelectionEventForActivePhase(roundOneLock, roundTwoPhase), false);
    assert.equal(isSelectionEventForActivePhase(roundTwoLock, roundTwoPhase), true);
});

test("selection locks from another match are ignored even when the round matches", () => {
    const activePhase = selectionPhaseForEvent(roundTwoEvent);
    const otherMatchLock = {
        ...roundTwoEvent,
        matchId: "match-2",
        type: "MATCH_LOADOUT_SELECTED",
    };

    assert.equal(isSelectionEventForActivePhase(otherMatchLock, activePhase), false);
});

test("a delayed prior-round result cannot replace the active selection round", () => {
    const delayedRoundOneResult = {
        ...roundOneEvent,
        type: "MATCH_RESULT_READY",
    };

    assert.equal(isOlderMatchRoundEvent(delayedRoundOneResult, roundTwoEvent), true);
    assert.equal(isOlderMatchRoundEvent(roundTwoEvent, delayedRoundOneResult), false);
});
