import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const builderSource = readFileSync(fileURLToPath(new URL("./PuzzleBuilderPage.jsx", import.meta.url)), "utf8");
const puzzlePlaySource = readFileSync(fileURLToPath(new URL("./PuzzlePlayPage.jsx", import.meta.url)), "utf8");
const workspaceSource = readFileSync(fileURLToPath(new URL("./PuzzleLogicWorkspace.jsx", import.meta.url)), "utf8");
const coordinateMigrationSource = readFileSync(fileURLToPath(new URL("../../../../server/src/main/resources/db/migration/V56__version_legacy_puzzle_coordinate_logic.sql", import.meta.url)), "utf8");

test("puzzle coordinate payloads are explicit and legacy logic defaults to v1", () => {
    assert.match(builderSource, /coordinateSystemVersion: "centered-y-up-v1"/);
    assert.match(builderSource, /PUBLIC_BOT_CENTER_MIN_X/);
    assert.match(workspaceSource, /version: configuration\.version \?\? BOT_LOGIC_TREE_V1/);
    assert.match(coordinateMigrationSource, /bot-logic-tree-v1/);
    assert.match(coordinateMigrationSource, /NOT \(logic_configuration \? 'version'\)/);
});

test("puzzle information popup omits redundant submission instructions", () => {
    assert.doesNotMatch(puzzlePlaySource, /HOW SUBMISSIONS WORK/);
    assert.doesNotMatch(puzzlePlaySource, /Test your code in the browser first/);
    assert.doesNotMatch(puzzlePlaySource, /authoritative simulation and checks whether you solved the puzzle/);
});
