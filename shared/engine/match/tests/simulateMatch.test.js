import assert from "node:assert/strict";
import test from "node:test";
import { simulateMatch } from "../simulateMatch.js";
import { createMatchBots, prepareMatchBrains } from "../botSetup.js";

// Slash (ability 1) cast every tick the opponent is in reach, with the rotate and move blocks.
const slashBrain = {
    version: 2,
    customVariables: [],
    loadout: { abilities: [1] },
    roots: [
        block("r-aim", "rotate_toward_enemy", 1),
        block("r-move", "move_walk", 2, { movementMode: "target", movementDirection: 0 }),
        block("r-cast", 1, 3),
    ],
};
const idleBrain = { version: 2, customVariables: [], loadout: { abilities: [] }, roots: [] };

function block(id, action, priority, extra = {}) {
    return {
        id,
        name: id,
        priority,
        branches: [{
            id: `${id}-if`,
            branchType: "if",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [{ action, selectable: "opponent", ...extra }],
            children: [],
        }],
    };
}

function bot(overrides) {
    return {
        userId: `user-${overrides.slot}`,
        username: `Bot ${overrides.slot}`,
        slot: 1,
        x: 600,
        y: 150,
        rotation: null,
        size: 60,
        selectedLoadout: "custom:",
        brain: idleBrain,
        initialHp: null,
        teamNumber: 1,
        ...overrides,
    };
}

function request(bots, { durationMs = 1000, initialElapsedMs = 0, arena = {} } = {}) {
    return {
        matchId: "match-1",
        rulesetVersion: "duel-v1",
        seed: "seed-1",
        arena: { width: 1200, height: 1200, durationMs, initialElapsedMs, ...arena },
        bots,
    };
}

const oneVersusOne = (overrides = {}) => [
    bot({ slot: 1, userId: "alpha", teamNumber: 1, x: 600, y: 150, brain: slashBrain }),
    bot({ slot: 2, userId: "bravo", teamNumber: 2, x: 600, y: 1050, brain: idleBrain, initialHp: 10, ...overrides }),
];

test("roster errors are refused with a clear message", () => {
    const cases = [
        ["one bot", [bot({ slot: 1 })], /between two and 8 bots/],
        ["nine bots", Array.from({ length: 9 }, (_, index) => bot({ slot: index + 1, teamNumber: index + 1 })), /between two and 8 bots/],
        ["duplicate slot", [bot({ slot: 1 }), bot({ slot: 1, userId: "x", teamNumber: 2 })], /unique positive values/],
        ["slot zero", [bot({ slot: 0 }), bot({ slot: 2, teamNumber: 2 })], /unique positive values/],
        ["slot nine", [bot({ slot: 1 }), bot({ slot: 9, teamNumber: 2 })], /unique positive values/],
        ["team zero", [bot({ slot: 1, teamNumber: 0 }), bot({ slot: 2, teamNumber: 2 })], /unique positive values/],
        ["one team", [bot({ slot: 1, teamNumber: 1 }), bot({ slot: 2, teamNumber: 1 })], /at least two teams/],
    ];
    for (const [, bots, message] of cases) {
        assert.throws(() => simulateMatch(request(bots)), message);
    }
    assert.throws(
        () => simulateMatch({ ...request(oneVersusOne()), rulesetVersion: "duel-v0" }),
        /rulesetVersion must be duel-v1/,
    );
});

test("the clock must stay inside the 90 second duel and the arena must be the duel arena", () => {
    assert.throws(
        () => simulateMatch(request(oneVersusOne(), { initialElapsedMs: 89_000, durationMs: 2_000 })),
        /initialElapsedMs must leave room/,
    );
    assert.throws(
        () => simulateMatch(request(oneVersusOne(), { initialElapsedMs: -1 })),
        /initialElapsedMs must leave room/,
    );
    assert.throws(
        () => simulateMatch(request(oneVersusOne(), { arena: { width: 1000 } })),
        /arena must be 1200x1200/,
    );
});

test("a knockout ends the match early with BOT_WIN and the surviving bot as winner", () => {
    const { replay, endElapsedMs } = simulateMatch(request(oneVersusOne(), { durationMs: 90_000 }));

    assert.equal(replay.result, "BOT_WIN");
    assert.equal(replay.winnerUserId, "alpha");
    assert.equal(replay.message, "Blue Team wins.");
    assert.ok(endElapsedMs < 90_000, `expected an early end, got ${endElapsedMs}`);
    assert.equal(replay.frames.at(-1).elapsedMs, endElapsedMs);
});

test("running out of time is a draw with no winner", () => {
    const bots = [bot({ slot: 1, userId: "alpha", teamNumber: 1, x: 600, y: 150 }),
        bot({ slot: 2, userId: "bravo", teamNumber: 2, x: 600, y: 1050})];
    const { replay } = simulateMatch(request(bots, { durationMs: 1000 }));

    assert.equal(replay.result, "DRAW");
    assert.equal(replay.message, "The fight ended in a draw.");
    assert.equal("winnerUserId" in replay, false);
    assert.equal(replay.frames.length, 10);
});

test("a 2v2 match runs with all four bots in every frame", () => {
    const bots = [
        bot({ slot: 1, userId: "a1", teamNumber: 1, x: 300, y: 150 }),
        bot({ slot: 2, userId: "a2", teamNumber: 1, x: 900, y: 150 }),
        bot({ slot: 3, userId: "b1", teamNumber: 2, x: 300, y: 1050 }),
        bot({ slot: 4, userId: "b2", teamNumber: 2, x: 900, y: 1050 }),
    ];
    const { replay, bots: finalBots } = simulateMatch(request(bots, { durationMs: 1000 }));

    assert.equal(replay.initialState.bots.length, 4);
    assert.ok(replay.frames.every((frame) => frame.bots.length === 4));
    assert.equal(finalBots.length, 4);
    assert.equal(replay.result, "DRAW");
});

test("frames start at 100 ms and advance in 100 ms steps", () => {
    const { replay } = simulateMatch(request(oneVersusOne(), { durationMs: 1000 }));
    const elapsed = replay.frames.map((frame) => frame.elapsedMs);

    assert.equal(elapsed[0], 100);
    assert.deepEqual(elapsed.slice(1).map((value, index) => value - elapsed[index]), elapsed.slice(1).map(() => 100));
});

test("the same request produces identical replay JSON", () => {
    const first = JSON.stringify(simulateMatch(request(oneVersusOne(), { durationMs: 90_000 })).replay);
    const second = JSON.stringify(simulateMatch(request(oneVersusOne(), { durationMs: 90_000 })).replay);

    assert.equal(first, second);
});

test("replay JSON never contains undefined or NaN", () => {
    const { replay } = simulateMatch(request(oneVersusOne(), { durationMs: 90_000 }));
    const json = JSON.stringify(replay);

    assert.equal(json.includes("undefined"), false);
    assert.equal(json.includes("NaN"), false);
});

test("abilities come from brain.loadout only, not selectedLoadout", () => {
    const bots = [
        bot({ slot: 1, teamNumber: 1, selectedLoadout: "custom:s", brain: idleBrain }),
        bot({ slot: 2, teamNumber: 2, selectedLoadout: "custom:s", brain: idleBrain }),
    ];
    const { replay } = simulateMatch(request(bots, { durationMs: 100 }));

    assert.deepEqual(replay.initialState.bots[0].abilities, [19, 20, 34]);
    assert.deepEqual(replay.initialState.bots[1].abilities, [19, 20, 34]);
});

test("actions outside the bot's loadout never run", () => {
    // Same slash brain, but its loadout does not grant ability 1.
    const ungranted = { ...slashBrain, loadout: { abilities: [] } };
    const bots = [
        bot({ slot: 1, teamNumber: 1, brain: ungranted }),
        bot({ slot: 2, teamNumber: 2, brain: idleBrain, x: 600, y: 1050, initialHp: 10 }),
    ];
    const { replay } = simulateMatch(request(bots, { durationMs: 2000 }));

    assert.equal(replay.frames.some((frame) => frame.bots.some((state) => state.triggeredAbility === 1)), false);
    assert.equal(replay.result, "DRAW");
});

test("prepared brains are keyed by shape id and carry their own loadout", () => {
    const prepared = prepareMatchBrains(request(oneVersusOne()));

    assert.deepEqual(prepared.get("bot-2").loadout.abilities, []);
    assert.deepEqual(prepared.get("bot-1").loadout.abilities, [1]);
});

test("the closing zone uses initialElapsedMs plus the step clock", () => {
    const early = simulateMatch(request(oneVersusOne({ initialHp: null }), { durationMs: 1000 })).replay;
    const late = simulateMatch(request(oneVersusOne({ initialHp: null }), { durationMs: 1000, initialElapsedMs: 14_900 })).replay;

    assert.equal(early.frames[0].entities, undefined);
    assert.ok(late.frames[0].entities.some((entity) => entity.type === "closingZone"));
});

test("recordFrames false keeps the result and drops frames", () => {
    const full = simulateMatch(request(oneVersusOne(), { durationMs: 90_000 }));
    const lean = simulateMatch(request(oneVersusOne(), { durationMs: 90_000 }), { recordFrames: false });

    assert.deepEqual(lean.replay.frames, []);
    assert.equal(lean.replay.result, full.replay.result);
    assert.equal(lean.replay.winnerUserId, full.replay.winnerUserId);
    assert.deepEqual(lean.replay.initialState, full.replay.initialState);
});

test("afterTick can stop the loop early", () => {
    const seen = [];
    const { replay, endElapsedMs } = simulateMatch(request(oneVersusOne(), { durationMs: 90_000 }), {
        afterTick({ elapsedMs }) {
            seen.push(elapsedMs);
            return elapsedMs >= 300;
        },
    });

    assert.deepEqual(seen, [100, 200, 300]);
    assert.equal(endElapsedMs, 300);
    assert.equal(replay.result, "DRAW");
});

test("the request is not mutated", () => {
    const input = request(oneVersusOne(), { durationMs: 1000 });
    const before = JSON.stringify(input);
    simulateMatch(input);

    assert.equal(JSON.stringify(input), before);
});

test("createMatchBots clamps hp and defaults rotation like Java", () => {
    const bots = createMatchBots(request([
        bot({ slot: 1, teamNumber: 1, initialHp: 500 }),
        bot({ slot: 2, teamNumber: 2, initialHp: -5 }),
        bot({ slot: 3, teamNumber: 2, initialHp: null, rotation: 45 }),
    ], { initialElapsedMs: 4_000 }));

    assert.equal(bots[0].health.current, 150);
    assert.equal(bots[1].health.current, 0);
    assert.equal(bots[2].health.current, 150);
    assert.equal(bots[0].transform.rotation, 90);
    assert.equal(bots[1].transform.rotation, 270);
    assert.equal(bots[2].transform.rotation, 45);
    assert.equal(bots[0].matchElapsedMs, 4_000);
});

test("bot setup rejects non-finite spawn rotations", () => {
    for (const rotation of [NaN, Infinity, -Infinity, "not-a-number"]) {
        const request = {
            rulesetVersion: "duel-v1",
            bots: [
                { userId: "u1", username: "One", slot: 1, x: 300, y: 150, rotation, size: 60, brain: idleBrain, teamNumber: 1 },
                { userId: "u2", username: "Two", slot: 2, x: 900, y: 150, rotation: 0, size: 60, brain: idleBrain, teamNumber: 2 },
            ],
        };
        assert.throws(() => createMatchBots(request), /rotation must be a finite number/);
    }
});
