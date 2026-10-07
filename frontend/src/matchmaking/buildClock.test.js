import assert from "node:assert/strict";
import test from "node:test";
import {
    AUTO_SUBMIT_LEAD_MS,
    clockTone,
    formatClockMs,
    inAutoSubmitWindow,
    normalizeTimeoutFallback,
    playerClockView,
    withPlayerClockDeadlines,
} from "./buildClock.js";

const serverNow = "2026-01-01T00:00:00.000Z";

test("player build deadlines use the delay-adjusted relative normalization", () => {
    const event = {
        serverNow,
        players: [
            { userId: "a", buildEndsAt: "2026-01-01T00:05:00.000Z", clockRemainingMs: 300000 },
            { userId: "b", buildEndsAt: null, clockRemainingMs: 120000, finished: true },
        ],
    };
    const normalized = withPlayerClockDeadlines(event, null, 40, 1_000_000);
    assert.equal(normalized.players[0].buildEndsAtMs, 1_000_000 + 300_000 - 40);
    assert.equal(normalized.players[1].buildEndsAtMs, null);
});

test("an unchanged deadline keeps its first local value so a running clock does not jitter", () => {
    const first = withPlayerClockDeadlines({
        serverNow,
        players: [{ userId: "a", buildEndsAt: "2026-01-01T00:05:00.000Z" }],
    }, null, 0, 1_000_000);
    const second = withPlayerClockDeadlines({
        serverNow: "2026-01-01T00:00:30.000Z",
        players: [{ userId: "a", buildEndsAt: "2026-01-01T00:05:00.000Z" }],
    }, first, 0, 1_090_000);
    assert.equal(second.players[0].buildEndsAtMs, first.players[0].buildEndsAtMs);
});

test("a submitted player's clock is frozen and everyone else counts down", () => {
    const running = playerClockView({ buildEndsAtMs: 10_000, clockRemainingMs: 99_000 }, 4_000);
    assert.deepEqual(running, { submitted: false, running: true, remainingMs: 6_000 });
    assert.equal(playerClockView({ buildEndsAtMs: 10_000 }, 12_000).remainingMs, 0);
    const frozen = playerClockView({ buildEndsAtMs: null, clockRemainingMs: 91_000, finished: true }, 4_000);
    assert.deepEqual(frozen, { submitted: true, running: false, remainingMs: 91_000 });
});

test("clock text rounds up and turns amber under 30 s and red under 10 s", () => {
    assert.equal(formatClockMs(300_000), "5:00");
    assert.equal(formatClockMs(29_001), "0:30");
    assert.equal(formatClockMs(0), "0:00");
    assert.equal(clockTone(30_000), "normal");
    assert.equal(clockTone(29_999), "amber");
    assert.equal(clockTone(9_999), "red");
});

test("auto-submit starts 1.5 s before the clock ends, only while the clock runs", () => {
    assert.equal(AUTO_SUBMIT_LEAD_MS, 1_500);
    assert.equal(inAutoSubmitWindow({ running: true, remainingMs: 1_500 }), true);
    assert.equal(inAutoSubmitWindow({ running: true, remainingMs: 1_501 }), false);
    assert.equal(inAutoSubmitWindow({ running: false, remainingMs: 0 }), false);
});

test("timeout fallback defaults to the current code", () => {
    assert.equal(normalizeTimeoutFallback(undefined), "CURRENT");
    assert.equal(normalizeTimeoutFallback("previous"), "PREVIOUS");
    assert.equal(normalizeTimeoutFallback("anything"), "CURRENT");
});
