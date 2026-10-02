import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const builderSource = readFileSync(fileURLToPath(new URL("./PuzzleBuilderPage.jsx", import.meta.url)), "utf8");
const workspaceSource = readFileSync(fileURLToPath(new URL("./PuzzleLogicWorkspace.jsx", import.meta.url)), "utf8");
const apiSource = readFileSync(fileURLToPath(new URL("../../puzzles/puzzleApi.js", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../../App.jsx", import.meta.url)), "utf8");
const controllerSource = readFileSync(fileURLToPath(new URL("../../../../server/src/main/java/com/example/botfight/controller/AdminPuzzleController.java", import.meta.url)), "utf8");

test("admin puzzle editing loads and saves through the existing builder route", () => {
    assert.match(builderSource, /updatePuzzle\(puzzleNumber, payload\)/);
    assert.match(appSource, /path="\/admin\/puzzles\/:puzzleNumber\/edit"/);
});

test("admin puzzle updates use PUT and expose no delete endpoint", () => {
    assert.match(apiSource, /method: "PUT"/);
    assert.match(controllerSource, /@PutMapping\("\/\{puzzleNumber\}"\)/);
    assert.doesNotMatch(controllerSource, /DeleteMapping/);
});

test("puzzle save canonicalizes both rule conditions and staged bot brains", () => {
    assert.match(workspaceSource, /const normalizedBranch = stripLegacyActionFields\(branch\)/);
});

