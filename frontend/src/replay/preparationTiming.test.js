import assert from "node:assert/strict";
import test from "node:test";
import { phaseDeadlineTimingForEvent, preparationTimingForEvent } from "./preparationTiming.js";

test("preparation timing uses the relative server countdown and quarter-second remaining time", () => {
    const timing = preparationTimingForEvent({
        matchId: "match-1",
        roundNumber: 2,
        simulationPreparingDurationMs: 3_000,
    }, 7_250, 250);

    assert.deepEqual(timing, {
        matchId: "match-1",
        roundNumber: 2,
        serverNow: null,
        localNowMs: 7_250,
        estimatedOneWayDelayMs: 250,
        serverIntervalMs: null,
        serverIntervalSeconds: null,
        preparingEndsAtServerTime: null,
        preparingEndsAtServerMs: null,
        rawSecondsRemaining: 2.75,
        secondsRemaining: 2.75,
    });
});

test("submission/loading timing is explicit until the server publishes the preparation end", () => {
    assert.deepEqual(preparationTimingForEvent({ type: "SIMULATION_LOADING" }, 7_250), {
        matchId: null,
        roundNumber: null,
        serverNow: null,
        localNowMs: 7_250,
        estimatedOneWayDelayMs: 0,
        serverIntervalMs: null,
        serverIntervalSeconds: null,
        preparingEndsAtServerTime: null,
        preparingEndsAtServerMs: null,
        rawSecondsRemaining: null,
        secondsRemaining: null,
    });
});

test("does not ceil a nearly-finished three-second countdown to four seconds", () => {
    const timing = preparationTimingForEvent({ simulationPreparingDurationMs: 3_010 }, 0);

    assert.equal(timing.rawSecondsRemaining, 3.01);
    assert.equal(timing.secondsRemaining, 3);
});

test("reports the estimated one-way network delay", () => {
    const timing = preparationTimingForEvent(
        { serverNow: "2026-07-30T12:00:00.000Z" },
        Date.parse("2026-07-30T12:00:00.000Z"),
        25,
    );

    assert.equal(timing.estimatedOneWayDelayMs, 25);
});

test("phase deadline timing preserves a signed late transition measurement", () => {
    const timing = phaseDeadlineTimingForEvent({
        matchId: "match-1",
        roundNumber: 3,
        serverNow: "2026-07-30T12:00:00.000Z",
        buildingEndsAt: "2026-07-30T12:00:30.000Z",
        buildingEndsAtMs: 29_800,
    }, "buildingEndsAt", "buildingEndsAtMs", 31_000, 250);

    assert.equal(timing.serverIntervalSeconds, 30);
    assert.equal(timing.signedSecondsRemaining, -1.2);
    assert.equal(timing.secondsRemaining, 0);
    assert.equal(timing.estimatedOneWayDelayMs, 250);
});
