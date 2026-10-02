import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const builder = read("./PuzzleBuilderPage.jsx");

test("save still goes through the existing create and update calls with the same payload fields", () => {
    assert.match(builder, /await updatePuzzle\(puzzleNumber, payload\)/);
    assert.match(builder, /await savePuzzle\(payload\)/);
    for (const field of ["name:", "description:", "initialElapsedMs:", "timeLimitMs:", "maxActionNodes:", "maxConditionNodes:", "maxCustomVariables:", "hideOpponentCode:", "published:", "logicConfiguration:", "bots:"]) {
        assert.ok(builder.includes(field), field);
    }
});

