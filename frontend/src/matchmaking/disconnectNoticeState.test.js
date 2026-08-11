import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalMatchEvent, shouldShowDisconnectNotice } from "./disconnectNoticeState.js";

const disconnectEvent = {
    type: "PLAYER_DISCONNECTED",
    disconnectedUserId: "player-2",
    disconnectEndsAtMs: 30_000,
};

test("active disconnect events can show the grace notice", () => {
    assert.equal(shouldShowDisconnectNotice({
        event: disconnectEvent,
        terminalMatch: false,
        eventServerNowMs: 10_000,
    }), true);
});

test("terminal result events clear and block disconnect notices", () => {
    const terminalEvent = {
        type: "MATCH_RESULT_READY",
        playback: { status: "COMPLETED", result: "DRAW" },
    };

    assert.equal(isTerminalMatchEvent(terminalEvent), true);
    assert.equal(shouldShowDisconnectNotice({
        event: disconnectEvent,
        terminalMatch: true,
        eventServerNowMs: 10_000,
    }), false);
});

test("server-authored terminal replay events block stale disconnect events", () => {
    const terminalReplayEvent = {
        type: "SIMULATION_PREPARING",
        matchTerminal: true,
        playback: { status: "COMPLETED", result: "BOT_WIN" },
    };

    assert.equal(isTerminalMatchEvent(terminalReplayEvent), true);
    assert.equal(shouldShowDisconnectNotice({
        event: disconnectEvent,
        terminalMatch: isTerminalMatchEvent(terminalReplayEvent),
        eventServerNowMs: 40_000,
    }), false);
});
