import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const builderSource = readFileSync(fileURLToPath(new URL("./PuzzleBuilderPage.jsx", import.meta.url)), "utf8");
const workspaceSource = readFileSync(fileURLToPath(new URL("./PuzzleLogicWorkspace.jsx", import.meta.url)), "utf8");
const listSource = readFileSync(fileURLToPath(new URL("./PuzzleListPage.jsx", import.meta.url)), "utf8");
const apiSource = readFileSync(fileURLToPath(new URL("../../puzzles/puzzleApi.js", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../../App.jsx", import.meta.url)), "utf8");
const globalStyles = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");
const controllerSource = readFileSync(fileURLToPath(new URL("../../../../server/src/main/java/com/example/botfight/controller/AdminPuzzleController.java", import.meta.url)), "utf8");

test("admin puzzle editing loads and saves through the existing builder route", () => {
    assert.match(builderSource, /useParams/);
    assert.match(builderSource, /fetchAdminPuzzle/);
    assert.match(builderSource, /updatePuzzle\(puzzleNumber, payload\)/);
    assert.match(builderSource, /puzzleDraftFromAdminResponse/);
    assert.match(builderSource, /Puzzle #\$\{saved\.puzzleNumber\} \$\{isEditing \? "updated" : "saved"\}/);
    assert.match(appSource, /path="\/admin\/puzzles\/:puzzleNumber\/edit"/);
    assert.match(listSource, /navigate\(`\/admin\/puzzles\/\$\{encodeURIComponent\(puzzle\.number\)\}\/edit`\)/);
});

test("admin puzzle updates use PUT and expose no delete endpoint", () => {
    assert.match(apiSource, /ADMIN_PUZZLES_ENDPOINT\}\/:?\$\{encodeURIComponent\(puzzleNumber\)\}/);
    assert.match(apiSource, /method: "PUT"/);
    assert.match(controllerSource, /@PutMapping\("\/\{puzzleNumber\}"\)/);
    assert.doesNotMatch(controllerSource, /DeleteMapping/);
});

test("admins can trigger the one-shot stored JSON priority migration from edit mode", () => {
    assert.match(apiSource, /migratePuzzleTreePriorities/);
    assert.match(apiSource, /migrate-tree-priorities/);
    assert.match(builderSource, /migratePuzzleTreePriorities/);
    assert.match(builderSource, /UPDATE DB JSON/);
    assert.match(controllerSource, /@PostMapping\("\/migrate-tree-priorities"\)/);
});

test("puzzle save canonicalizes both rule conditions and staged bot brains", () => {
    assert.match(workspaceSource, /normalizeConditions\(branch\.conditions, customVariables, SELECTABLE_TYPES\)/);
    assert.match(workspaceSource, /branches: normalizePuzzleBranches\(root\?\.branches, normalizedKind/);
    assert.match(builderSource, /const normalizedLogic = normalizePuzzleLogic\(draft\.puzzleLogic\)/);
    assert.match(builderSource, /winConditions: flattenPuzzleConditions\(normalizedLogic, "win"\)/);
    assert.match(builderSource, /opponentBot: requestBot\(draft\.opponentBot\)/);
});

test("the puzzle list uses mapped responsive decorative pieces and the charcoal palette", () => {
    const decorationItems = listSource.match(/^\s+\{ id: "[^"]+", (?:top|bottom):/gm) ?? [];
    assert.ok(decorationItems.length >= 18);
    assert.match(listSource, /<PuzzleDecorationLayer \/>/);
    assert.match(listSource, /DECORATIVE_PUZZLE_PIECES\.map\(\(piece\) =>/);
    assert.match(listSource, /\["top", "right", "bottom", "left"\]/);
    assert.match(listSource, /filter\(\(edge\) => piece\[edge\] !== undefined\)/);
    assert.match(globalStyles, /\.puzzle-page \{[\s\S]*background: #181b1c;[\s\S]*color: #f2f4f5;/);
    assert.match(globalStyles, /\.puzzle-page-decorations \{[\s\S]*position: fixed;[\s\S]*inset: 0;[\s\S]*overflow: hidden;[\s\S]*pointer-events: none;[\s\S]*z-index: 0;/);
    assert.match(globalStyles, /\.puzzle-page-decoration-piece \{[\s\S]*stroke: rgba\(130, 145, 150, \.55\);/);
    assert.match(globalStyles, /\.puzzle-page-decoration-piece:nth-child\(n \+ 13\)/);
    assert.match(globalStyles, /\.puzzle-page-decoration-piece:nth-child\(n \+ 7\)/);
    const progressStatStyles = globalStyles.slice(globalStyles.indexOf(".puzzle-progress-stat {"), globalStyles.indexOf(".puzzle-progress-label {"));
    assert.match(progressStatStyles, /border: 1px solid #465158;[\s\S]*border-radius: 12px;[\s\S]*padding: 1rem 1.25rem;/);
    assert.doesNotMatch(progressStatStyles, /border-left/);
    assert.doesNotMatch(listSource, /AVAILABLE/);
    assert.match(globalStyles, /\.puzzle-list-frame \{[\s\S]*border: 1px solid #343c42;[\s\S]*background: #151a1d;/);
    assert.match(globalStyles, /\.puzzle-list-row:hover \{[\s\S]*background: #1b2226;/);
    assert.doesNotMatch(globalStyles.slice(globalStyles.indexOf(".puzzle-page {"), globalStyles.indexOf(".info-circle-icon")), /gradient/);
});
