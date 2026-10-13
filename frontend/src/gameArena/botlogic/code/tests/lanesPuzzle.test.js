import assert from "node:assert/strict";
import test from "node:test";
import { brainRuleErrors } from "../../../../../../shared/engine/botlogic/code/configuration/brainRules.js";
import { simulateFight } from "../../../../../../shared/engine/simulateFight.js";

// Lanes brains in puzzle runs: the player's lanes brain keeps its custom variables across ticks, the puzzle's win
// and lose rules read them after every tick, and puzzle budgets count lanes cards, switches and conditions.

const LANES = "bot-logic-lanes-v1";
const MATCH_ID = "11111111-1111-4111-8111-111111111111";
const uuid = (slot) => `00000000-0000-4000-8000-00000000000${slot}`;
const numberIs = (left, comparator, value) => ({ type: "expression", left, comparator, right: { type: "number", value } });
const card = (id, action, conditions = []) => ({ id, conditions, action });

/** A lanes brain whose variables section adds one to custom.ticks every tick. */
function ticksBrain(extra = {}) {
    return {
        version: LANES,
        modes: [{
            id: "main", name: "Main",
            variables: [card("tick", { action: "variable", variableId: "custom.ticks", terms: [{ operator: "add", operand: { type: "number", value: 1 } }] })],
        }],
        shared: {},
        customVariables: [{ id: "custom.ticks", name: "Ticks", valueType: "number", initialValue: 0 }],
        ...extra,
    };
}

function puzzleRequest(playerBrain, winValue, timeLimitMs = 2000) {
    return {
        matchId: MATCH_ID,
        rulesetVersion: "duel-v3",
        seed: 3,
        arena: { width: 1200, height: 1200, durationMs: timeLimitMs },
        segments: null,
        bots: [
            { userId: uuid(1), username: "player", slot: 1, x: 300, y: 600, rotation: 90, size: 60, selectedLoadout: "custom",
                teamNumber: 1, brain: { ...playerBrain, loadout: { abilities: [] } } },
            { userId: uuid(2), username: "enemy", slot: 2, x: 900, y: 600, rotation: 270, size: 60, selectedLoadout: "custom",
                teamNumber: 2, brain: { version: "bot-logic-tree-v2", roots: [], customVariables: [], loadout: { abilities: [] } } },
        ],
        puzzle: {
            timeLimitMs,
            logicConfiguration: {
                version: "bot-logic-tree-v2",
                customVariables: [],
                roots: [{ kind: "win", branches: [{ conditions: [numberIs("custom.ticks", "gte", winValue)] }] }],
            },
        },
    };
}

test("a lanes player brain's variables drive puzzle win rules tick by tick", () => {
    const solved = simulateFight(puzzleRequest(ticksBrain(), 5));
    assert.equal(solved.result.puzzleStatus, "solved");
    // Five variable writes at 100 ms each: the win is seen on the fifth tick, not the first or the timeout.
    assert.equal(solved.result.segmentEndMs, 500);
    assert.deepEqual(simulateFight(puzzleRequest(ticksBrain(), 5)), solved, "the run is deterministic");
    assert.equal(simulateFight(puzzleRequest(ticksBrain(), 50)).result.puzzleStatus, "failed");
});

test("a lanes brain with no variable cards never reaches a puzzle variable win", () => {
    const idle = { version: LANES, modes: [{ id: "main", name: "Main" }], shared: {},
        customVariables: [{ id: "custom.ticks", name: "Ticks", valueType: "number", initialValue: 0 }] };
    assert.equal(simulateFight(puzzleRequest(idle, 1, 500)).result.puzzleStatus, "failed");
});

test("lanes brains count cards, switches and conditions against puzzle limits", () => {
    const brain = {
        version: LANES,
        modes: [
            { id: "main", name: "Main", switches: [{ id: "go", to: "other", conditions: [numberIs("custom.ticks", "gte", 3)] }],
                variables: [card("a", { action: "variable", variableId: "custom.ticks", value: 1 })] },
            { id: "other", name: "Other" },
        ],
        shared: {},
        customVariables: [{ id: "custom.ticks", name: "Ticks", valueType: "number", initialValue: 0 }],
        loadout: { abilities: [] },
    };
    // One card and one switch make two entries, against a limit of one. The switch's one condition is the only condition.
    assert.deepEqual(brainRuleErrors(brain, { puzzleConstraints: { maxActionNodes: 1, maxConditionNodes: 1, maxCustomVariables: 5 } }),
        ["Brain uses 2 cards and switches; puzzle allows 1."]);
    assert.deepEqual(brainRuleErrors(brain, { puzzleConstraints: { maxActionNodes: 2, maxConditionNodes: 0, maxCustomVariables: 5 } }),
        ["Brain uses 1 condition nodes; puzzle allows 0."]);
    assert.deepEqual(brainRuleErrors(brain, { puzzleConstraints: { maxActionNodes: 2, maxConditionNodes: 1, maxCustomVariables: 5, reservePuzzleNamespace: true } }), []);
});
