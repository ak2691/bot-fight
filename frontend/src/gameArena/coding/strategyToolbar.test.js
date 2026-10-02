import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildInitialArenaShapes } from "../modelPayloads/arenaShapes.js";
import { graphEdgePath } from "./graphEdgeGeometry.js";

// Source-level guards for behaviour and contracts in the code workspace and arena wiring.
// Styling, copy and layout are intentionally not pinned here.
const read = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const PANEL_PATH = "./CodingPanel.jsx";
const BOARD_PATH = "./LogicBoard.jsx";
const NODES_PATH = "./nodes/GraphNodes.jsx";
const ARENA_PATH = "../Arena.jsx";
const AUTO_PLAY_HOOK_PATH = "../hooks/useArenaAutoPlay.js";
const PIXI_CANVAS_PATH = "../pixi/PixiCanvas.jsx";

function readCodingSource() {
    return [PANEL_PATH, BOARD_PATH, NODES_PATH].map(read).join("\n");
}

test("shared graph-edge geometry preserves its cubic path and offsets both endpoints", () => {
    const edge = { fromId: "root", toId: "condition", x1: 20, y1: 30, x2: 80, y2: 60 };
    assert.equal(graphEdgePath(edge), "M 20 30 C 20 100, 80 -10, 80 60");
    assert.equal(graphEdgePath(edge, {
        root: { x: 5, y: -3 },
        condition: { x: -7, y: 11 },
    }), "M 25 27 C 25 97, 73 1, 73 71");
});

test("local building initialization creates one dummy while match initialization stays isolated", () => {
    const buildingShapes = buildInitialArenaShapes(null);
    assert.equal(buildingShapes.filter((shape) => shape.id === "opponent-model").length, 1);
    assert.equal(buildingShapes.find((shape) => shape.id === "opponent-model")?.type, "opponentModel");

    const matchShapes = buildInitialArenaShapes({
        matchId: "rated-match",
        player: { userId: "player", username: "Player", slot: 1 },
        opponent: { userId: "opponent", username: "Opponent", slot: 2 },
    });
    assert.equal(matchShapes.filter((shape) => shape.id === "opponent-model").length, 1);
    assert.equal(matchShapes.find((shape) => shape.id === "opponent-model")?.username, "Opponent");
});

test("live match arena does not append the legacy opponent model to the authoritative roster", () => {
    const arenaSource = read(ARENA_PATH);

    assert.match(arenaSource, /if \(matchContext\?\.matchId \|\| !matchContext\?\.opponent\) return;/);
    assert.match(arenaSource, /buildMatchSpawnShapes/);
});

test("preview and surrender controls exist only in live matches", () => {

});

test("puzzle play is a local preview and puzzle submission is a separate action", () => {
    const arenaSource = read(ARENA_PATH);
    const autoPlaySource = read(AUTO_PLAY_HOOK_PATH);
    const runAutoPlay = autoPlaySource.match(/const runAutoPlay = useCallback\(\(\) => \{[\s\S]*?setIsEditingArena\(false\);/);

    assert.ok(runAutoPlay);
    assert.doesNotMatch(runAutoPlay[0], /submitPuzzleAttempt\(\)/);
    assert.doesNotMatch(runAutoPlay[0], /tutorialRunRef|customVariableGoal|priorityOrderCorrect/);
    assert.match(arenaSource, /onPuzzleSubmit=\{isPuzzleMode && onPuzzleAttempt \? submitPuzzleAttempt : null\}/);
});

test("puzzle play preserves the editable setup until Reset Stats is chosen", () => {
    const arenaSource = read(ARENA_PATH);
    const autoPlaySource = read(AUTO_PLAY_HOOK_PATH);

    assert.doesNotMatch(autoPlaySource, /buildTutorialArenaShapes|buildAutoPlayStartShapes/);
    assert.match(autoPlaySource, /setShapes\(\(previousShapes\) => advanceArenaPreviewTick/);
    assert.match(arenaSource, /if \(isPuzzleMode\) \{\s*setShapes\(buildPracticeArenaShapes\([\s\S]*?puzzleArenaSetup/);
});

test("puzzle play restores drafts by puzzle without overriding loaded submissions", () => {
    const arenaSource = read(ARENA_PATH);
    const puzzleSource = read("../../pages/puzzles/PuzzlePlayPage.jsx");

    assert.match(arenaSource, /puzzleCodeOverride \?\? readPuzzleBotCodeDraft\(puzzleNumber, puzzleBotForSetup\(initialPuzzle, PUZZLE_PLAYER_TEAM\)\?\.brain/);
    assert.match(arenaSource, /savePuzzleBotCodeDraft\(puzzleNumber, sanitized\)/);
    assert.match(puzzleSource, /puzzleCodeOverride=\{activeRestoredSubmission\?\.brain \?\? null\}/);
});

test("puzzle builder play resumes its preview and keeps builder code out of storage", () => {
    const arenaSource = read(ARENA_PATH);
    const builderSource = read("../../pages/puzzles/PuzzleBuilderPage.jsx");

    assert.match(arenaSource, /if \(previousPuzzleSetupKeyRef\.current === puzzleSetupKey\) return;/);
    assert.match(arenaSource, /if \(isPuzzleMode\) \{[\s\S]*savePuzzleBotCodeDraft\(puzzleNumber, sanitized\);[\s\S]*\} else if \(!isPuzzleBuilder\) \{[\s\S]*saveStoredStrategyConfiguration\(strategyStorageKey, sanitized\);/);
    assert.match(arenaSource, /if \(!isPuzzleBuilder\) saveStoredStrategyConfiguration\(opponentStrategyStorageKey, sanitized\);/);
    assert.match(arenaSource, /setShapes\(restorePreviewBaseline\(previewBaseline\)\)/);
    assert.match(builderSource, /playerBot: requestBot\(draft\.playerBot, \{ useDefaultBrain: true \}\)/);
});

test("puzzle arenas keep bot selection and dragging enabled while paused", () => {
    const source = read(ARENA_PATH);

    assert.match(source, /const allowLockedBotEditing = isPuzzleMode \|\| isTutorialArenaIntro \|\| \(isMatchTesting && finishStatus === "BUILDING"\)/);
    assert.match(source, /stopAutoPlay\(\);\s*setIsEditingArena\(true\);/);
});

test("the visible building deadline preserves the manual submission grace window", () => {
    const arenaSource = read(ARENA_PATH);
    const panelSource = read(PANEL_PATH);

    assert.match(arenaSource, /const authoritativeRemaining = secondsRemaining\(autoSubmitDeadline\)/);
    assert.match(arenaSource, /if \(authoritativeRemaining === 0\) \{\s*clearInterval\(interval\);[\s\S]*handleFinishMatchRef\.current\?\.\(\);[\s\S]*\}/);
    assert.match(panelSource, /testingRemaining === 0 && finishStatus === "BUILDING"/);
});

test("submitted match code closes and disables the coding workspace", () => {
    const panelSource = read(PANEL_PATH);

    assert.ok(panelSource.includes("const isBotCodeLocked = isMatchTesting && ("));
    assert.ok(panelSource.includes('finishStatus === "SUBMITTING"'));
    assert.ok(panelSource.includes('finishStatus === "FINISHED"'));
    assert.ok(panelSource.includes("setIsLogicOpen(false)"));
    assert.ok(panelSource.includes("disabled={isBotCodeLocked}"));
    assert.ok(panelSource.includes("disabled={isCodeEditingLocked || isTesting || !viewingCurrentRound}"));
    assert.ok(panelSource.includes("canRemove={!isCodeEditingLocked && !isTesting && !roundDeleteLocked}"));
});

test("live match code browsing keeps opponent code private and sandbox-only", () => {
    const panelSource = read(PANEL_PATH);

    assert.match(panelSource, /Opponent code is private/);
    assert.doesNotMatch(panelSource, /onCopyParticipantToSandbox/);
});

test("conditional ability pickers use all equipped abilities and resource-aware ammo choices", () => {
    assert.match(read(PANEL_PATH), /abilityOptions: abilityDefinitionsForVariable\(variable, equipped\)/);
    assert.match(read(NODES_PATH), /new Set\(\[\.\.\.STANDARD_ABILITY_IDS, \.\.\.selected\]\)/);
});

test("running previews read bot-code edits without restarting playback", () => {
    const autoPlaySource = read(AUTO_PLAY_HOOK_PATH);
    const simulationSource = read("../modelPayloads/arenaPreviewSimulation.js");

    assert.match(autoPlaySource, /testingConfiguration: testingConfigurationRef\.current/);
    assert.match(simulationSource, /bot\.id === "main"[\s\S]*\? testingConfiguration[\s\S]*bot\.id === "opponent-model"[\s\S]*\? opponentTestingConfiguration/);
});

test("practice autoplay pauses in hidden tabs and submissions do not log brain payloads", () => {
    const arenaSource = read(ARENA_PATH);
    const autoPlaySource = read(AUTO_PLAY_HOOK_PATH);

    assert.match(autoPlaySource, /if \(!isPracticeRoom\) return undefined;[\s\S]*?document\.addEventListener\("visibilitychange", pausePracticePreviewWhenHidden\)/);
    assert.match(autoPlaySource, /if \(!document\.hidden \|\| !autoIntervalRef\.current\) return;\s*stopAutoPlay\(\);\s*setIsEditingArena\(true\)/);
    assert.doesNotMatch(arenaSource, /console\.(?:info|log)\([^)]*payload/);
});

test("editable code upgrades legacy coordinates before rendering movement controls", () => {
    const source = readCodingSource();

    assert.match(source, /activeCodeReadOnly\s*\?\s*normalizedActiveConfiguration\s*:\s*upgradeStoredStrategyCoordinates\(normalizedActiveConfiguration\)/);
});

test("Pixi hit-testing only selects bots and ignores visual effects", () => {
    const source = read(PIXI_CANVAS_PATH);

    assert.match(source, /container\.eventMode = isBotShape\(shape\) \? "static" : "none"/);
    assert.match(source, /graphics\.eventMode = "none"/);
    assert.match(source, /function beginDrag\(event, view\) \{\s*if \(!isBotShape\(view\.shape\)\) return;/);
});

test("code graph nodes can be dragged from their surfaces without stealing control clicks", () => {
    const source = readCodingSource();

    assert.match(source, /function GraphConditionNode[\s\S]*beginNodeDrag\(event, node\.id\)/);
    assert.match(source, /function GraphActionNode[\s\S]*beginNodeDrag\(event, node\.id\)/);
});

test("dragging a node never selects it or opens its panel; a tap opens it", () => {
    const board = read(BOARD_PATH);

    assert.match(board, /const DRAG_CLICK_THRESHOLD = 4;/);
    assert.match(board, /if \(draggedPastThreshold\) \{\s*dragClickSuppressedRef\.current = true;/);
    // The click that follows a drag is swallowed before any selection or panel logic.
    assert.match(board, /const selectGraphNode = [\s\S]*?if \(dragClickSuppressedRef\.current\) \{\s*dragClickSuppressedRef\.current = false;\s*return;/);
    assert.match(board, /const openPanel = Boolean\(inspector\) && !additive;/);
});

test("root conditional controls do not change graph selection", () => {
    assert.match(readCodingSource(), /const addRootConditional = \(event, node, rootNode\) => \{\s*event\.stopPropagation\(\);/);
});

test("root priority edits swap places with the root at that priority so layout keeps matching execution order", () => {
    const board = read(BOARD_PATH);

    assert.match(board, /const setRootOrder = \(rootIndex, priority\) => \{[\s\S]*swapNodePlaces\(roots, graph, nodeOffsetsRef\.current, node, target\)[\s\S]*setRootPriority\(roots, rootIndex, priority\)/);
});

test("conditionals are AND-only across the editor", () => {
    const nodes = read(NODES_PATH);
    const compact = nodes.slice(nodes.indexOf("function CompactConditionNode"), nodes.indexOf("function GraphConditionNode"));
    const inspector = nodes.slice(nodes.indexOf("function ConditionalInspectorRow"), nodes.indexOf("function LogicNodeInspector"));

    assert.doesNotMatch(compact, /"or"|OR/);
    assert.doesNotMatch(inspector, /toggleJoin|join:|Toggle AND/);
});

test("removing a conditional promotes its child branches", () => {
    const source = readCodingSource();

    assert.match(source, /removeLogicBranch\(roots, rootIndex, path\)/);
    assert.match(source, /if \(selectedConditionIds\.has\(branchId\)\) return removeFromBranches\(branch\.children, rootId\);/);
});

test("removing the final condition keeps the conditional and makes it always", () => {
    const source = readCodingSource();

    assert.doesNotMatch(source, /const currentConditions = Array\.isArray\(branch\.conditions\)/);
    assert.match(source, /onRemoveCondition=\{\(rowIndex\) => \{ setInspectedNode[\s\S]*conditions: \(current\.conditions \?\? \[\]\)\.filter\(\(_, index\) => index !== rowIndex\)/);
    assert.doesNotMatch(source, /currentConditions\.length <= 1/);
});

test("condition and action DOM identities are scoped to their root", () => {
    const source = readCodingSource();

    assert.match(source, /return `condition:\$\{branchId\}:root:\$\{rootId\}`/);
    assert.match(source, /return `action:\$\{branchId\}:\$\{actionIndex\}:root:\$\{rootId\}`/);
});

test("modulo is exposed only as a custom-variable operation", () => {
    const source = readCodingSource();

    assert.match(source, /CUSTOM_VARIABLE_OPERATIONS\.MODULO/);
    assert.doesNotMatch(source, /condition\.modulo|comparator === "modulo"|Modulo divisor/);
});

test("custom variable names are sanitised and deleting a variable in use asks first", () => {
    const modal = read("./modals/CustomVariablesModal.jsx");

    assert.match(modal, /replace\(\/\[\^A-Za-z0-9 _-\]\/g, ""\)/);
    assert.match(modal, /Used in \$\{uses\} node\$\{uses === 1 \? "" : "s"\}\. Delete anyway\?/);
});

test("raw number inputs accept digits only when asked and keep focus while the selected variable changes", () => {
    const source = read(NODES_PATH);

    assert.match(source, /digitsOnly \? event\.target\.value\.replace\(\/\[\^0-9\]\/g, ""\)/);
    assert.match(source, /digitsOnly && event\.key\.length === 1 && !\/\[0-9\]\/\.test\(event\.key\)/);
    assert.match(source, /if \(document\.activeElement !== inputRef\.current\) setDraft\(nextValue\);/);
});

test("empty-canvas pointer down commits focused inputs and dismisses configuration", () => {
    const source = readCodingSource();
    const clearFromSurface = source.slice(source.indexOf("const dismissConfigurationFromSurfacePointerDown"), source.indexOf("const selectGraphNode"));

    assert.match(clearFromSurface, /activeElement\.blur\(\)/);
    assert.match(source, /if \(event\.button === 0 && event\.target === event\.currentTarget\) dismissConfigurationFromSurfacePointerDown/);
});

test("changing an action keeps its panel open", () => {
    const board = read(BOARD_PATH);

    assert.match(board, /if \(nodePicker\.actionIndex == null\) setInspectedNode\(null\);/);
    assert.match(board, /if \(picker\.actionIndex == null\) setInspectedNode\(null\);/);
});

test("Escape closes one search or configuration layer before the code workspace", () => {
    const source = readCodingSource();
    const menuEvents = read("./utils/codeMenuEvents.js");
    const layeredClose = source.slice(source.indexOf("const closeTopLogicLayer"), source.indexOf("useDialogFocus(logicDialogRef"));

    assert.match(layeredClose, /if \(isNodeSearchOpen\)[\s\S]*setIsNodeSearchOpen\(false\);[\s\S]*return;/);
    assert.match(layeredClose, /if \(isCustomVariablesOpen\)[\s\S]*setIsCustomVariablesOpen\(false\);[\s\S]*return;/);
    assert.match(layeredClose, /setIsLogicOpen\(false\);/);
    assert.match(menuEvents, /if \(event\.key !== "Escape" \|\| OPEN_SEARCH_MENUS\.at\(-1\) !== menuEntry\) return;/);
});

test("zoom keeps the point under the cursor fixed", () => {
    const panel = read(PANEL_PATH);

    // Pan is set outside the zoom updater, from the latest values, so it is never applied twice.
    assert.doesNotMatch(panel.slice(panel.indexOf("const changeZoom"), panel.indexOf("const applyPinchZoom")), /setCanvasZoom\(\(/);
});

test("code workspace controls keep accessible names, roles and focus handling", () => {
    const panel = read(PANEL_PATH);
    const hud = read("./HudControls.jsx");

    assert.match(hud, /role="switch"/);
    assert.match(hud, /aria-checked=\{checked\}/);
    for (const label of ["Close bot code workspace", "Search roots", "Custom variables", "Add root", "Zoom in"]) {
        assert.ok(panel.includes(`aria-label="${label}"`), label);
    }
});
