import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
    fileURLToPath(new URL("./HomePage.jsx", import.meta.url)),
    "utf8",
);
const puzzleBuilderSource = readFileSync(
    fileURLToPath(new URL("../puzzles/PuzzleBuilderPage.jsx", import.meta.url)),
    "utf8",
);
const codingPanelSource = readFileSync(
    fileURLToPath(new URL("../../gameArena/coding/CodingPanel.jsx", import.meta.url)),
    "utf8",
);
const puzzleLogicWorkspaceSource = readFileSync(
    fileURLToPath(new URL("../puzzles/PuzzleLogicWorkspace.jsx", import.meta.url)),
    "utf8",
);

test("an active match turns the ranked block into a rejoin button", () => {
    const block = readFileSync(fileURLToPath(new URL("./RankedMatchBlock.jsx", import.meta.url)), "utf8");
    assert.match(block, /navigate\("\/match", \{\s*state:/s);
});
test("the home page queues in place without a queue route", () => {
    assert.doesNotMatch(source, /navigate\("\/queue"\)|cancelQueue/);
});
test("the home practice-room action uses the stable practice route", () => {
    const block = readFileSync(fileURLToPath(new URL("./RankedMatchBlock.jsx", import.meta.url)), "utf8");
    assert.match(block, /navigate\("\/practice"\)/);
});

test("v1 puzzle compatibility remains silent in the editor", () => {
    assert.doesNotMatch(codingPanelSource, /LEGACY BRAIN/);
    assert.doesNotMatch(puzzleLogicWorkspaceSource, /LEGACY PUZZLE LOGIC/);
    assert.match(puzzleLogicWorkspaceSource, /version: configuration\.version \?\? BOT_LOGIC_TREE_V1/);
});

test("the puzzle builder starts positions in the shared arena setup instead of an inline stats editor", () => {
    assert.match(puzzleBuilderSource, /<ArenaSetup/);
    assert.doesNotMatch(puzzleBuilderSource, /PuzzleStartingStatsEditor|SAVE STARTING STATS|SAVE OPPONENT CODE/);
});
