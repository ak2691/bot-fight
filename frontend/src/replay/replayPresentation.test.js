import assert from "node:assert/strict";
import test from "node:test";
import { displayedRoundWins, initialReplayHandoffFrame, localReplaySchedule, mergeReplayFrames, replayClockSeconds, replayElapsedMs, replayEntranceProgress, replayEntranceX, replayBotAbilityState, replayFrameIndexForElapsedMs, replayRemainingMs } from "./replayPresentation.js";

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

test("replay visual timers follow authoritative frame time without presentation compression", () => {
    const frameTimes = Array.from({ length: 101 }, (_, index) => index * 100);

    assert.equal(replayRemainingMs(10_000, frameTimes[0], frameTimes[1]), 9_900);
    assert.equal(replayRemainingMs(10_000, frameTimes[0], frameTimes[10]), 9_000);
    assert.equal(replayRemainingMs(10_000, frameTimes[0], frameTimes[100]), 0);
});

test("local replay preserves the organized ability timers used by Bot Room", () => {
    assert.deepEqual(replayBotAbilityState({
        microDashActiveMs: 200,
        abilityActiveMs: { 1: 300, 3: 850, 5: 500, 6: 400, 2: 1, 19: 100 },
    }), {
        abilityActiveMs: { 1: 300, 3: 850, 5: 500, 6: 400, 2: 1, 19: 100 },
        microDashActiveMs: 200,
    });
});

test("replay does not infer one ability visual from another equipped ability", () => {
    const state = replayBotAbilityState({ abilities: [3, 5], abilityActiveMs: { 5: 500 } });
    assert.equal(state.abilityActiveMs[5], 500);
    assert.equal(state.abilityActiveMs[3] ?? 0, 0);
});

test("buffered replay frames are selected directly from the fixed simulation step", () => {
    const frames = Array.from({ length: 11 }, (_, index) => ({ elapsedMs: index * 100 }));

    assert.equal(replayFrameIndexForElapsedMs(frames, 0), 0);
    assert.equal(replayFrameIndexForElapsedMs(frames, 100), 1);
    assert.equal(replayFrameIndexForElapsedMs(frames, 900), 9);
    assert.equal(replayFrameIndexForElapsedMs(frames, 1_000), 10);
});

test("authoritative frames beginning at the first 100 ms tick use a zero-based buffer index", () => {
    const frames = Array.from({ length: 40 }, (_, index) => ({ elapsedMs: (index + 1) * 100 }));

    assert.equal(replayFrameIndexForElapsedMs(frames, 0), 0);
    assert.equal(replayFrameIndexForElapsedMs(frames, 100), 0);
    assert.equal(replayFrameIndexForElapsedMs(frames, 199), 0);
    assert.equal(replayFrameIndexForElapsedMs(frames, 200), 1);
    assert.equal(replayFrameIndexForElapsedMs(frames, 4_000), 39);
    assert.equal(replayFrameIndexForElapsedMs(frames, 4_500), 39);
});

test("replay recovery appends only frames newer than the current cursor", () => {
    assert.deepEqual(
        mergeReplayFrames(
            [{ elapsedMs: 100 }, { elapsedMs: 200 }],
            [{ elapsedMs: 200 }, { elapsedMs: 300 }],
        ),
        [{ elapsedMs: 100 }, { elapsedMs: 200 }, { elapsedMs: 300 }],
    );
});

test("the replay handoff follows the timeline between initial state and the first authoritative step", () => {
    const initialState = { bots: [{ userId: "one", x: 100, y: 200, rotation: 350 }], entities: [] };
    const firstFrame = { elapsedMs: 100, bots: [{ userId: "one", x: 120, y: 180, rotation: 10 }], entities: [] };

    assert.deepEqual(initialReplayHandoffFrame(initialState, firstFrame, 0).bots[0], initialState.bots[0]);
    assert.deepEqual(initialReplayHandoffFrame(initialState, firstFrame, 50).bots[0], {
        userId: "one", x: 110, y: 190, rotation: 360,
    });
});

test("bot entrance starts outside the arena and reaches its replay position at playback start", () => {
    const bot = { slot: 1, size: 60, x: 500 };
    assert.equal(replayEntranceProgress(20_000, 17_000), 0);
    assert.equal(replayEntranceX(bot, 0), -60);
    assert.equal(replayEntranceProgress(20_000, 20_000), 1);
    assert.equal(replayEntranceX(bot, 1), 500);
});
