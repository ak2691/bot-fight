import assert from "node:assert/strict";
import test from "node:test";
import { combatVisualDurationMs } from "../gameArena/gameconfig/visualState.js";
import { centeredTeamPosition, displayedRoundWins, hydrateReplayBot, initialReplayHandoffFrame, interpolateReplayFrame, localReplaySchedule, mergeReplayFrames, replayAbilitiesFor, replayAbilityTarget, replayAbilityVisual, replayClockSeconds, replayElapsedMs, replayEntranceProgress, replayEntranceX, replayBotAbilityState, replayFrameIndexForElapsedMs, replayRayOrigin, replayRatingChange, replayRatingChanges, replayRemainingMs, replayRemainingSeconds, replayResultRevealReached, replayResultVisibility, replayShapeKey } from "./replayPresentation.js";

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
        dashActiveMs: 200,
        abilityActiveMs: { 1: 300, 3: 850, 5: 500, 6: 400, 19: 100 },
    }), {
        abilityActiveMs: { 1: 300, 3: 850, 5: 500, 6: 400, 19: 100 },
        dashActiveMs: 200,
    });
});

test("replay does not infer one ability visual from another equipped ability", () => {
    const state = replayBotAbilityState({ abilities: [3, 5], abilityActiveMs: { 5: 500 } });
    assert.equal(state.abilityActiveMs[5], 500);
    assert.equal(state.abilityActiveMs[3] ?? 0, 0);
});

test("replay reconstructs direct ability visuals with the shared Bot Room duration", () => {
    const frames = [
        { elapsedMs: 100, bots: [{ slot: 1, x: 100, y: 200, rotation: 10, abilityActiveMs: {} }] },
        { elapsedMs: 200, bots: [{ slot: 1, x: 130, y: 240, rotation: 40, triggeredAbility: 16, abilityActiveMs: {} }] },
        { elapsedMs: 300, bots: [{ slot: 1, x: 170, y: 280, rotation: 90, abilityActiveMs: {} }] },
        { elapsedMs: 500, bots: [{ slot: 1, x: 220, y: 330, rotation: 120, abilityActiveMs: {} }] },
    ];

    assert.equal(combatVisualDurationMs(16), 300);
    assert.deepEqual(replayAbilityVisual(frames[1].bots[0], frames, 1), {
        ability: 16,
        ms: 300,
        x: 130,
        y: 240,
        rotation: 40,
    });
    assert.deepEqual(replayAbilityVisual(frames[2].bots[0], frames, 2), {
        ability: 16,
        ms: 200,
        x: 130,
        y: 240,
        rotation: 40,
    });
    assert.equal(replayAbilityVisual(frames[3].bots[0], frames, 3), null);
});

test("replay keeps a lock-on target after its trigger frame", () => {
    const frames = [
        { elapsedMs: 100, bots: [{ slot: 1, abilityActiveMs: {} }] },
        { elapsedMs: 200, bots: [{ slot: 1, triggeredAbility: 20, abilityActiveMs: { 20: 200 }, abilityTargetX: 720, abilityTargetY: 340 }] },
        { elapsedMs: 300, bots: [{ slot: 1, abilityActiveMs: { 20: 100 } }] },
    ];

    assert.deepEqual(replayAbilityTarget(frames[2].bots[0], frames, 2), {
        abilityTargetX: 720,
        abilityTargetY: 340,
    });
});

test("replay result stays hidden until the authoritative reveal deadline", () => {
    assert.equal(replayResultRevealReached(30_000, 29_999), false);
    assert.equal(replayResultRevealReached(30_000, 30_000), true);
    assert.equal(replayResultRevealReached(null, 0), true);
});

test("round result visibility does not depend on the official match result event", () => {
    assert.deepEqual(replayResultVisibility({
        result: "BOT_WIN",
        hasAuthorizedTerminalFrame: true,
        hasDisplayedFinalFrame: true,
        roundResultRevealReceived: true,
        resultRevealReceived: false,
    }), {
        roundResultRevealed: true,
        matchResultRevealed: false,
    });
    assert.deepEqual(replayResultVisibility({
        result: "BOT_WIN",
        hasAuthorizedTerminalFrame: true,
        hasDisplayedFinalFrame: true,
        roundResultRevealReceived: false,
        resultRevealReceived: true,
    }), {
        roundResultRevealed: true,
        matchResultRevealed: true,
    });
    assert.deepEqual(replayResultVisibility({
        result: "BOT_WIN",
        hasAuthorizedTerminalFrame: false,
        hasDisplayedFinalFrame: true,
        resultRevealReceived: true,
    }), {
        roundResultRevealed: false,
        matchResultRevealed: false,
    });
});

test("rating change stays hidden until the result reveal event is received", () => {
    const playback = { ratingBefore: 1035, ratingAfter: 1053 };

    assert.equal(replayRatingChange(playback, false), null);
    assert.deepEqual(replayRatingChange(playback, true), {
        before: 1035,
        after: 1053,
        delta: 18,
        label: "1035 → 1053 (+18)",
    });
});

test("all rated match Elo changes stay hidden until the result reveal", () => {
    const playback = {
        ratingChanges: [
            { username: "pilot", before: 1100, after: 1120 },
            { username: "teammate", before: 1000, after: 980 },
            { username: "opponent", before: 1200, after: 1180 },
        ],
    };

    assert.deepEqual(replayRatingChanges(playback, false), []);
    assert.deepEqual(replayRatingChanges(playback, true), [
        {
            username: "pilot",
            before: 1100,
            after: 1120,
            delta: 20,
            label: "1100 → 1120 (+20)",
        },
        {
            username: "teammate",
            before: 1000,
            after: 980,
            delta: -20,
            label: "1000 → 980 (-20)",
        },
        {
            username: "opponent",
            before: 1200,
            after: 1180,
            delta: -20,
            label: "1200 → 1180 (-20)",
        },
    ]);
});

test("match replay timer starts at 1:30 and counts down to zero", () => {
    assert.equal(replayRemainingSeconds(90_000, 0), 90);
    assert.equal(replayRemainingSeconds(90_000, 29_900), 61);
    assert.equal(replayRemainingSeconds(90_000, 90_000), 0);
    assert.equal(replayRemainingSeconds(90_000, 95_000), 0);
});

test("compact replay bots recover participant metadata by slot", () => {
    const bot = hydrateReplayBot(
        {
            slot: 2,
            x: 500,
            y: 700,
            rotation: 0,
            hp: 85,
            abilityCooldowns: { 3: 1000, 19: 1500, 20: 10000 },
            abilityCharges: { 3: 9 },
            abilityRechargeMs: { 3: 0 },
            abilityActiveMs: { 3: 700 },
        },
        { slot: 2, x: 500, y: 700, rotation: 0, hp: 100, maxHp: 140 },
        {
            slot: 2,
            userId: "user-2",
            username: "Opponent",
            teamNumber: 2,
            selectedLoadout: "custom:g",
        },
    );

    assert.equal(bot.userId, "user-2");
    assert.equal(bot.username, "Opponent");
    assert.equal(bot.teamNumber, 2);
    assert.equal(bot.maxHp, 140);
    assert.deepEqual(bot.abilityCooldowns, { 3: 1000, 19: 1500, 20: 10000 });
    assert.deepEqual(bot.abilityCharges, { 3: 9 });
    assert.deepEqual(bot.abilityRechargeMs, { 3: 0 });
    assert.deepEqual(bot.abilities, [19, 20, 34, 3]);
});

test("initial replay bots carry resource state before the preparation countdown ends", () => {
    const bot = hydrateReplayBot({
        slot: 1,
        x: 500,
        y: 400,
        hp: 100,
        maxHp: 100,
        abilities: [3, 5, 19, 20],
        abilityCooldowns: { 3: 0, 5: 0, 19: 1500, 20: 10000 },
        abilityCharges: { 3: 10, 5: 4 },
        abilityRechargeMs: { 3: 0, 5: 0 },
    });

    assert.deepEqual(bot.abilities, [19, 20, 34, 3, 5]);
    assert.deepEqual(bot.abilityCooldowns, { 3: 0, 5: 0, 19: 1500, 20: 10000 });
    assert.deepEqual(bot.abilityCharges, { 3: 10, 5: 4 });
    assert.deepEqual(bot.abilityRechargeMs, { 3: 0, 5: 0 });
});

test("replay status order preserves the current acquisition order", () => {
    assert.deepEqual(replayAbilitiesFor([12, 1, 3, 13]), [19, 20, 34, 12, 1, 3, 13]);
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

test("replay presentation interpolates transforms on the authoritative timeline", () => {
    const frame = {
        elapsedMs: 100,
        bots: [{ slot: 1, x: 100, y: 200, rotation: 350, hp: 100 }],
        entities: [{ id: "fireball", x: 100, y: 300, rotation: 0 }],
    };
    const nextFrame = {
        elapsedMs: 200,
        bots: [{ slot: 1, x: 200, y: 100, rotation: 10, hp: 90 }],
        entities: [{ id: "fireball", x: 200, y: 400, rotation: 20 }],
    };
    const interpolated = interpolateReplayFrame(frame, nextFrame, 150);
    assert.deepEqual(interpolated.bots[0], { slot: 1, x: 150, y: 150, rotation: 360, hp: 100 });
    assert.deepEqual(interpolated.entities[0], { id: "fireball", x: 150, y: 350, rotation: 10 });
});

test("replay damage matching remains slot-based after bot metadata hydration", () => {
    assert.equal(replayShapeKey({ slot: 1 }), replayShapeKey({ slot: 1, userId: "user-1" }));
    assert.equal(replayShapeKey({ id: "entity-1" }), replayShapeKey({ id: "entity-1", type: "fireball" }));
});

test("replay gun rays retain the activation position while the bot moves", () => {
    const frames = [
        { bots: [{ slot: 1, x: 100, y: 200, rotation: 10, abilityActiveMs: {} }] },
        { bots: [{ slot: 1, x: 130, y: 240, rotation: 40, abilityActiveMs: { 3: 900 }, abilityCooldowns: { 3: 900 } }] },
        { bots: [{ slot: 1, x: 170, y: 280, rotation: 90, abilityActiveMs: { 3: 800 }, abilityCooldowns: { 3: 800 } }] },
        { bots: [{ slot: 1, x: 220, y: 330, rotation: 120, abilityActiveMs: { 3: 1000 }, abilityCooldowns: { 3: 1000 } }] },
    ];

    assert.deepEqual(replayRayOrigin(frames[2].bots[0], frames, 2), {
        gunRayOriginX: 130,
        gunRayOriginY: 240,
        gunRayRotation: 40,
        replayGunActiveMs: 800,
    });
    assert.deepEqual(replayRayOrigin(frames[3].bots[0], frames, 3), {
        gunRayOriginX: 220,
        gunRayOriginY: 330,
        gunRayRotation: 120,
        replayGunActiveMs: 1000,
    });
});

test("replay gun rays use the one-tick activation marker during rotation", () => {
    const frames = [
        { bots: [{ slot: 1, x: 100, y: 200, rotation: 10, abilityActiveMs: {} }] },
        { bots: [{ slot: 1, x: 130, y: 240, rotation: 40, abilityActiveMs: { 3: 900 }, abilityCooldowns: { 3: 900 }, triggeredAbility: 3 }] },
        { bots: [{ slot: 1, x: 170, y: 280, rotation: 90, abilityActiveMs: { 3: 800 }, abilityCooldowns: { 3: 800 } }] },
    ];

    assert.deepEqual(replayRayOrigin(frames[2].bots[0], frames, 2), {
        gunRayOriginX: 130,
        gunRayOriginY: 240,
        gunRayRotation: 40,
        replayGunActiveMs: 800,
    });
});

test("replay gun rays prefer the authoritative activation pose when it is supplied", () => {
    const frames = [
        { bots: [{ slot: 1, x: 100, y: 200, rotation: 10, abilityActiveMs: {} }] },
        { bots: [{ slot: 1, x: 130, y: 240, rotation: 40, abilityActiveMs: { 3: 900 }, triggeredAbility: 3, visualOriginX: 125, visualOriginY: 235, visualOriginRotation: 35 }] },
        { bots: [{ slot: 1, x: 170, y: 280, rotation: 90, abilityActiveMs: { 3: 800 } }] },
    ];

    assert.deepEqual(replayRayOrigin(frames[2].bots[0], frames, 2), {
        gunRayOriginX: 125,
        gunRayOriginY: 235,
        gunRayRotation: 35,
        replayGunActiveMs: 800,
    });
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

test("replay recovery orders frames when batches arrive out of order", () => {
    assert.deepEqual(
        mergeReplayFrames(
            [{ elapsedMs: 100 }, { elapsedMs: 300 }],
            [{ elapsedMs: 200 }, { elapsedMs: 400 }],
        ),
        [{ elapsedMs: 100 }, { elapsedMs: 200 }, { elapsedMs: 300 }, { elapsedMs: 400 }],
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

test("team replay entrances use team sides rather than treating every non-slot-one bot as an opponent", () => {
    assert.equal(replayEntranceX({ slot: 2, teamNumber: 1, size: 60, x: 500 }, 0), -60);
    assert.equal(replayEntranceX({ slot: 3, teamNumber: 2, size: 60, x: 500 }, 0), 1_060);
});

test("forfeit team formation keeps match-spawn spacing while centering the winners", () => {
    assert.deepEqual(centeredTeamPosition(0, 1), { x: 500, y: 500, rotation: 0 });
    assert.deepEqual(centeredTeamPosition(0, 2), { x: 1_000 / 3, y: 500, rotation: 0 });
    assert.deepEqual(centeredTeamPosition(1, 2), { x: 2_000 / 3, y: 500, rotation: 0 });
});
