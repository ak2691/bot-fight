import assert from "node:assert/strict";
import test from "node:test";

import { normalizePuzzleCustomVariables } from "./puzzleLogicNormalization.js";

test("puzzle variables are submitted with canonical brain names and initial values", () => {
    const variables = normalizePuzzleCustomVariables({
        customVariables: [
            { id: "custom.puzzle.count", label: "Count", valueType: "number", defaultValue: 2 },
            { id: "custom.puzzle.ready", label: "Ready", valueType: "boolean", defaultValue: true },
        ],
    });

    assert.deepEqual(variables, [
        { id: "custom.puzzle.count", name: "Count", valueType: "number", initialValue: 2 },
        { id: "custom.puzzle.ready", name: "Ready", valueType: "boolean", initialValue: true },
    ]);
});

test("puzzle variable normalization preserves canonical editor fields", () => {
    const variables = normalizePuzzleCustomVariables({
        customVariables: [
            { id: "custom.puzzle.score", name: "Score", valueType: "number", initialValue: 4 },
        ],
    });

    assert.deepEqual(variables, [
        { id: "custom.puzzle.score", name: "Score", valueType: "number", initialValue: 4 },
    ]);
});

test("puzzle variable normalization produces valid unique server names", () => {
    const variables = normalizePuzzleCustomVariables({
        customVariables: [
            { id: "custom.puzzle.first", name: "1st/value", valueType: "number", initialValue: 0 },
            { id: "custom.puzzle.second", name: "1st/value", valueType: "number", initialValue: 0 },
        ],
    });

    assert.deepEqual(variables.map(({ name }) => name), ["Variable 1stvalue", "Variable 1stvalue 2"]);
});

test("puzzle variable normalization removes unsupported punctuation without splitting words", () => {
    const variables = normalizePuzzleCustomVariables({
        customVariables: [
            { id: "custom.puzzle.player_lap", name: "Player's Lap", valueType: "number", initialValue: 0 },
            { id: "custom.puzzle.opponent_lap", name: "Opponent's Lap", valueType: "number", initialValue: 0 },
        ],
    });

    assert.deepEqual(variables.map(({ name }) => name), ["Players Lap", "Opponents Lap"]);
});
