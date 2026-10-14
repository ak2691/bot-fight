import assert from "node:assert/strict";
import test from "node:test";
import { simulateMatch } from "../simulateMatch.js";
import { createMatchBots, prepareMatchBrains, resolveMatchArena } from "../botSetup.js";
import { createStatePayloadFactory } from "../../modelPayloads/strategyStatePayload.js";
import { buildDeterministicLogicAction } from "../../botlogic/planner/ArenaActionPlanner.js";

const COUNTER = "custom.puzzle.counter";

// Slash (ability 1) every tick the opponent is in reach, as in simulateMatch.test.js.
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

// Player (slot 1, team 1) and opponent (slot 2, team 2), as the puzzle attempt builds them.
function duel({ playerBrain = idleBrain, opponentHp = null } = {}) {
    return [
        bot({ slot: 1, userId: "alpha", teamNumber: 1, x: 600, y: 150, brain: playerBrain }),
        bot({ slot: 2, userId: "bravo", teamNumber: 2, x: 600, y: 1050, brain: idleBrain, initialHp: opponentHp }),
    ];
}

// Mirrors PuzzleAttemptService: the arena runs for max(100, timeLimitMs).
function puzzleRequest(puzzle, bots) {
    return {
        matchId: "puzzle-1",
        rulesetVersion: "duel-v1",
        seed: "puzzle-1",
        arena: { width: 1200, height: 1200, durationMs: Math.max(100, puzzle.timeLimitMs), initialElapsedMs: 0 },
        bots,
        puzzle: { initialElapsedMs: 0, ...puzzle },
    };
}

const expression = (left, comparator, value, leftSelectable) => ({
    type: "expression",
    left,
    ...(leftSelectable ? { leftSelectable } : {}),
    comparator,
    right: { type: "number", value },
});

// The opponent is knocked out when its HP drops below 1.
const opponentKnockedOut = expression("selectable.hp", "lt", 1, "opponent_1");

const logicConfiguration = ({ customVariables = [], roots = [] } = {}) => ({
    version: "bot-logic-tree-v2",
    customVariables,
    roots,
});

const root = (id, kind, branches) => ({ id, name: id, kind, branches });
const branch = (id, conditions, actions = []) => ({ id, conditions, actions, children: [] });

const counterVariable = { id: COUNTER, name: "Counter", valueType: "number", initialValue: 0 };
const countEveryTick = root("count", "modify", [
    branch("count-if", [{ type: "always" }], [{ action: "variable", variableId: COUNTER, operation: "add", value: 1 }]),
]);

test("a knockout that satisfies a win rule is solved at the tick it happens", () => {
    const puzzle = {
        logicConfiguration: logicConfiguration({
            roots: [root("win", "win", [branch("win-if", [opponentKnockedOut])])],
        }),
        winConditions: [],
        loseConditions: [],
        timeLimitMs: 30_000,
    };
    const result = simulateMatch(puzzleRequest(puzzle, duel({ playerBrain: slashBrain, opponentHp: 10 })));

    assert.equal(result.puzzle.status, "solved");
    assert.ok(result.puzzle.elapsedMs >= 100 && result.puzzle.elapsedMs < 30_000,
        `expected a KO before the limit, got ${result.puzzle.elapsedMs}`);
    assert.equal(result.puzzle.elapsedMs, result.endElapsedMs);
    assert.deepEqual(result.replay.frames, []);
});

test("a lose rule that fires first marks the attempt failed", () => {
    const puzzle = {
        logicConfiguration: logicConfiguration({
            customVariables: [counterVariable],
            roots: [
                countEveryTick,
                root("win", "win", [branch("win-if", [expression(COUNTER, "gte", 99)])]),
                root("lose", "lose", [branch("lose-if", [expression(COUNTER, "gte", 3)])]),
            ],
        }),
        winConditions: [],
        loseConditions: [],
        timeLimitMs: 5_000,
    };
    const result = simulateMatch(puzzleRequest(puzzle, duel()));

    assert.equal(result.puzzle.status, "failed");
    assert.equal(result.puzzle.elapsedMs, 300);
    assert.equal(result.replay.result, "DRAW");
});

test("running out of the time limit is failed with the limit's elapsed time", () => {
    const puzzle = {
        logicConfiguration: logicConfiguration({
            roots: [root("win", "win", [branch("win-if", [opponentKnockedOut])])],
        }),
        winConditions: [],
        loseConditions: [],
        timeLimitMs: 1_000,
    };
    const result = simulateMatch(puzzleRequest(puzzle, duel()));

    assert.equal(result.puzzle.status, "failed");
    assert.equal(result.puzzle.elapsedMs, 1_000);
    assert.equal(result.endElapsedMs, 1_000);
    assert.equal(result.replay.frames.length, 0);
});

test("a counter that modify rules increment every tick reaches its win threshold", () => {
    // The player keeps a slash brain, so the counter also crosses action planning every tick.
    const puzzle = {
        logicConfiguration: logicConfiguration({
            customVariables: [counterVariable],
            roots: [
                countEveryTick,
                root("win", "win", [branch("win-if", [expression(COUNTER, "gte", 5)])]),
            ],
        }),
        winConditions: [],
        loseConditions: [],
        timeLimitMs: 5_000,
    };
    const result = simulateMatch(puzzleRequest(puzzle, duel({ playerBrain: slashBrain, opponentHp: 150 })));

    assert.equal(result.puzzle.status, "solved");
    assert.equal(result.puzzle.elapsedMs, 500);
});

test("a win and a lose that both hold on the same tick is solved", () => {
    const puzzle = {
        logicConfiguration: logicConfiguration({
            customVariables: [counterVariable],
            roots: [
                countEveryTick,
                root("win", "win", [branch("win-if", [expression(COUNTER, "gte", 2)])]),
                root("lose", "lose", [branch("lose-if", [expression(COUNTER, "gte", 2)])]),
            ],
        }),
        winConditions: [],
        loseConditions: [],
        timeLimitMs: 5_000,
    };
    const result = simulateMatch(puzzleRequest(puzzle, duel()));

    assert.equal(result.puzzle.status, "solved");
    assert.equal(result.puzzle.elapsedMs, 200);
});

test("legacy flat win and lose conditions are used when there is no logic configuration", () => {
    const won = simulateMatch(puzzleRequest({
        winConditions: [opponentKnockedOut],
        loseConditions: [],
        timeLimitMs: 30_000,
    }, duel({ playerBrain: slashBrain, opponentHp: 10 })));
    assert.equal(won.puzzle.status, "solved");

    const lost = simulateMatch(puzzleRequest({
        winConditions: [],
        loseConditions: [{ type: "always" }],
        timeLimitMs: 5_000,
    }, duel()));
    assert.equal(lost.puzzle.status, "failed");
    assert.equal(lost.puzzle.elapsedMs, 100);
});

test("requests without a puzzle keep the match output unchanged", () => {
    const plain = simulateMatch({
        matchId: "match-1",
        rulesetVersion: "duel-v1",
        seed: "seed-1",
        arena: { width: 1200, height: 1200, durationMs: 1000, initialElapsedMs: 0 },
        bots: duel(),
    });
    assert.equal("puzzle" in plain, false);
    assert.equal(plain.replay.frames.length, 10);
    assert.equal(plain.replay.result, "DRAW");

    const nullPuzzle = simulateMatch({
        matchId: "match-1",
        rulesetVersion: "duel-v1",
        seed: "seed-1",
        arena: { width: 1200, height: 1200, durationMs: 1000, initialElapsedMs: 0 },
        bots: duel(),
        puzzle: null,
    });
    assert.equal("puzzle" in nullPuzzle, false);
    assert.equal(JSON.stringify(nullPuzzle.replay), JSON.stringify(plain.replay));
});

test("puzzle variables written to the player survive the next tick's action planning", () => {
    const request = {
        matchId: "match-1",
        rulesetVersion: "duel-v1",
        seed: "seed-1",
        arena: { width: 1200, height: 1200, durationMs: 1000, initialElapsedMs: 0 },
        bots: duel({ playerBrain: slashBrain }),
    };
    const arena = resolveMatchArena(request);
    const shapes = createMatchBots(request, arena);
    const player = shapes.find((shape) => shape.id === "bot-1");
    player.customVariables = { [COUNTER]: 3 };

    const payload = createStatePayloadFactory(shapes).forActor(player.combatLoadout, player.id);
    const configuration = prepareMatchBrains(request).get("bot-1").configuration;
    const action = buildDeterministicLogicAction(configuration, payload);

    assert.equal(action.customVariables[COUNTER], 3);
});
