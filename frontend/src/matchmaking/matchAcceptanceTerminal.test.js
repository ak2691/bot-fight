import assert from "node:assert/strict";
import test from "node:test";
import {
    createMatchmakingTerminalRedirect,
    isMatchAcceptanceTerminalEvent,
    isMatchAcceptanceTerminalEventForMatch,
    isMatchAcceptanceUnavailableError,
} from "./matchAcceptanceTerminal.js";

test("an expired no-acceptance event replaces the acceptance page once", () => {
    const navigations = [];
    const redirect = createMatchmakingTerminalRedirect((...args) => navigations.push(args));
    const event = {
        type: "MATCH_ACCEPTANCE_EXPIRED",
        status: "MATCH_ACCEPT",
        matchId: "pending-match",
        acceptedByMe: false,
        otherPlayerAccepted: false,
    };

    assert.equal(redirect({
        event,
        acceptanceActive: true,
        currentMatchId: "pending-match",
    }), true);
    assert.equal(redirect({
        event,
        acceptanceActive: true,
        currentMatchId: "pending-match",
    }), false);
    assert.deepEqual(navigations, [["/home", { replace: true }]]);
});

test("nonterminal or stale acceptance events do not redirect", () => {
    const navigations = [];
    const redirect = createMatchmakingTerminalRedirect((...args) => navigations.push(args));

    assert.equal(isMatchAcceptanceTerminalEvent({ type: "MATCH_FOUND" }), false);
    assert.equal(redirect({
        event: { type: "MATCH_FOUND", status: "MATCH_ACCEPT", matchId: "pending-match" },
        acceptanceActive: true,
        currentMatchId: "pending-match",
    }), false);
    assert.equal(redirect({
        event: { type: "MATCH_ACCEPTED", status: "MATCH_ACCEPT", matchId: "pending-match", acceptedByMe: true },
        acceptanceActive: true,
        currentMatchId: "pending-match",
    }), false);
    assert.equal(redirect({
        event: { type: "MATCH_ACCEPTANCE_EXPIRED", status: "MATCH_ACCEPT", matchId: "old-match" },
        acceptanceActive: true,
        currentMatchId: "pending-match",
    }), false);
    assert.equal(redirect({
        event: { type: "MATCH_ACCEPTANCE_EXPIRED", status: "MATCH_ACCEPT", matchId: "pending-match" },
        acceptanceActive: false,
        currentMatchId: "pending-match",
    }), false);
    assert.equal(redirect({
        event: { type: "MATCH_STARTED", status: "LOADOUT_SELECT", matchId: "pending-match" },
        acceptanceActive: false,
        currentMatchId: "pending-match",
    }), false);
    assert.deepEqual(navigations, []);
});

test("terminal acceptance events match the displayed pending match even if the active flag was reset", () => {
    const expired = {
        type: "MATCH_ACCEPTANCE_EXPIRED",
        status: "MATCH_ACCEPT",
        matchId: "pending-match",
    };

    assert.equal(isMatchAcceptanceTerminalEventForMatch(expired, "pending-match"), true);
    assert.equal(isMatchAcceptanceTerminalEventForMatch(expired, "different-match"), false);
    assert.equal(isMatchAcceptanceTerminalEventForMatch({ type: "MATCH_FOUND" }, "pending-match"), false);
});

test("a late accept rejection is recognized as an unavailable acceptance window", () => {
    assert.equal(isMatchAcceptanceUnavailableError({
        type: "MATCH_ERROR",
        message: "The match acceptance window is no longer available.",
    }), true);
    assert.equal(isMatchAcceptanceUnavailableError({
        type: "MATCH_ERROR",
        message: "The queue request was rejected.",
    }), false);
});

test("NO_ACTIVE_MATCH retains its terminal home redirect", () => {
    const navigations = [];
    const redirect = createMatchmakingTerminalRedirect((...args) => navigations.push(args));

    assert.equal(redirect({ event: { type: "NO_ACTIVE_MATCH" } }), true);
    assert.equal(redirect({ event: { type: "NO_ACTIVE_MATCH" } }), false);
    assert.deepEqual(navigations, [["/home", { replace: true }]]);
});
