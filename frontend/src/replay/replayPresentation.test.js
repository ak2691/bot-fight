import assert from "node:assert/strict";
import test from "node:test";
import { displayedRoundWins, localReplaySchedule, replayClockSeconds } from "./replayPresentation.js";

test("replay schedule preserves a full local preload countdown when the ready event arrives late", () => {
    assert.deepEqual(localReplaySchedule(10_000, 30_000, 9_000), {
        playbackStartsAtMs: 12_000,
        resultRevealsAtMs: 32_000,
    });
});

test("replay schedule keeps a server start that already has enough preload time", () => {
    assert.deepEqual(localReplaySchedule(15_000, 30_000, 9_000), {
        playbackStartsAtMs: 15_000,
        resultRevealsAtMs: 30_000,
    });
});

test("replay score retains both pre-round totals until the result is displayed", () => {
    const before = { "player-1": 1, "player-2": 0 };
    assert.equal(displayedRoundWins({ userId: "player-1", roundWins: 1 }, before, false), 1);
    assert.equal(displayedRoundWins({ userId: "player-2", roundWins: 1 }, before, false), 0);
});

test("replay score uses authoritative updated totals once the result is displayed", () => {
    const before = { "player-1": 1, "player-2": 0 };
    assert.equal(displayedRoundWins({ userId: "player-2", roundWins: 1 }, before, true), 1);
});

test("replay clock follows the active payload frame and stays at zero before playback", () => {
    assert.equal(replayClockSeconds({ elapsedMs: 12_900 }), 12);
    assert.equal(replayClockSeconds({ elapsedMs: 12_900 }, false), 0);
    assert.equal(replayClockSeconds({ elapsedMs: -100 }), 0);
});
