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
