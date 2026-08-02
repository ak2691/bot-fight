import assert from "node:assert/strict";
import test from "node:test";
import { displayedRoundWins, localReplaySchedule, replayClockSeconds, replayElapsedMs, replayEntranceProgress, replayEntranceX } from "./replayPresentation.js";

test("replay schedule preserves the server deadlines when the ready event arrives late", () => {
    assert.deepEqual(localReplaySchedule(10_000, 30_000, 9_000), {
        playbackStartsAtMs: 10_000,
        resultRevealsAtMs: 30_000,
    });
});

test("replay schedule keeps both absolute server deadlines", () => {
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

test("replay elapsed time starts at zero at the shared playback deadline", () => {
    assert.equal(replayElapsedMs(20_000, 19_999), 0);
    assert.equal(replayElapsedMs(20_000, 20_000), 0);
    assert.equal(replayElapsedMs(20_000, 20_750), 750);
});

test("fighter entrance starts outside the arena and reaches its replay position at playback start", () => {
    const fighter = { slot: 1, size: 60, x: 500 };
    assert.equal(replayEntranceProgress(20_000, 17_000), 0);
    assert.equal(replayEntranceX(fighter, 0), -60);
    assert.equal(replayEntranceProgress(20_000, 20_000), 1);
    assert.equal(replayEntranceX(fighter, 1), 500);
});
