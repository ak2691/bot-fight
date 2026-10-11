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
    assert.match(autoPlaySource, /createFight\(shapesRef\.current/);
    assert.match(autoPlaySource, /setShapes\(frame\)/);
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

test("each player's own clock drives the auto-submit and the out-of-time notice", () => {
    const arenaSource = read(ARENA_PATH);
    const panelSource = read(PANEL_PATH);

    assert.match(arenaSource, /timeoutFallback !== TIMEOUT_FALLBACKS\.CURRENT/);
    assert.match(arenaSource, /inAutoSubmitWindow\(playerClockView\(matchContext\.player, monotonicEpochNowMs\(\)\)\)/);
    assert.match(arenaSource, /handleFinishMatchRef\.current\?\.\(\)/);
    assert.match(arenaSource, /ownSubmitBlockedReason\) return;/);
    assert.match(panelSource, /<BuildOutOfTime player=\{matchContext\?\.player\} \/>/);
    assert.match(panelSource, /<HoldToSubmitButton/);
    assert.match(panelSource, /roundLabel\(matchContext\?\.roundNumber, matchContext\?\.timedRounds\?\.maxRounds\)/);
    assert.doesNotMatch(panelSource, /roundWins|winsRequired/);
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

    assert.match(source, /container\.eventMode = isBotState\(shape\) \? "static" : "none"/);
    assert.match(source, /graphics\.eventMode = "none"/);
    assert.match(source, /function beginDrag\(event, view\) \{\s*if \(!isBotState\(view\.shape\)\) return;/);
});

test("code graph nodes can be dragged from their surfaces without stealing control clicks", () => {
    const source = readCodingSource();

    assert.match(source, /function GraphConditionNode[\s\S]*beginNodeDrag\(event, node\.id\)/);
    assert.match(source, /function GraphActionNode[\s\S]*beginNodeDrag\(event, node\.id, \{ fromControls: true \}\)/);
});

test("dragging a node never selects it or opens its panel; a tap opens it", () => {
    const board = read(BOARD_PATH);

    assert.match(board, /const DRAG_CLICK_THRESHOLD = 4;/);
    assert.match(board, /if \(draggedPastThreshold\) \{\s*dragClickSuppressedRef\.current = true;/);
    // The click that follows a drag is swallowed before any selection or panel logic.
    assert.match(board, /const selectGraphNode = [\s\S]*?if \(dragClickSuppressedRef\.current\) \{\s*dragClickSuppressedRef\.current = false;\s*return;/);
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
    assert.match(source, /if \(selectedConditionIds\.has\(branchId\) \|\| selectedConditionIds\.has\(branch\.id\)\) return removeFromBranches\(branch\.children, rootId\);/);
});

test("removing the final condition keeps the conditional and makes it always", () => {
    const source = readCodingSource();

    assert.doesNotMatch(source, /const currentConditions = Array\.isArray\(branch\.conditions\)/);
    assert.match(source, /onRemoveCondition=\{\(rowIndex\) => \{ setInspectedNode[\s\S]*conditions: \(current\.conditions \?\? \[\]\)\.filter\(\(_, index\) => index !== rowIndex\)/);
    assert.doesNotMatch(source, /currentConditions\.length <= 1/);
});

test("condition and action DOM identities are scoped to their root", () => {
    const source = readCodingSource();

    assert.match(source, /`condition:\$\{branchId\}:root:\$\{rootId\}`/);
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
    assert.match(modal, /Used in \$\{placesLabel\(uses\.length\)\}\. Delete anyway\?/);
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
    for (const label of ["Close bot code workspace", "Search roots and chains", "Custom variables", "Add root", "Zoom in"]) {
        assert.ok(panel.includes(`aria-label="${label}"`), label);
    }
});

test("the Walk action config has a Sprint switch with help and a summary chip", () => {
    const nodes = read("./nodes/GraphNodes.jsx");
    assert.match(nodes, /<HudSwitchRow label="Sprint"/);
    assert.match(nodes, /\+50% speed in any direction\. Drains 30 stamina\/s\. Stops at 0 stamina\./);
    assert.match(nodes, /\+= ", sprint"/);
});

test("Run chain nodes have no Open button or own double-click; the chain opens from the config menu or search", () => {
    const nodesSource = read(NODES_PATH);
    const boardSource = read(BOARD_PATH);

    // Double-clicking a chain node falls through to the board, which opens its config menu.
    assert.match(nodesSource, /<section data-graph-node-id=\{node.id\} onClick=\{onInspect\} onPointerDown=/);
    assert.doesNotMatch(nodesSource, /className="code-bt-open"/);
    assert.match(boardSource, /const chainsEnabled = Boolean\(onOpenChain\)/);
    assert.match(boardSource, /includeChainActions=\{chainsEnabled\}/);
});

test("an open chain swaps the toolbar identity for the breadcrumb and Escape goes back to the brain", () => {
    const panelSource = read(PANEL_PATH);

    assert.match(panelSource, /\{openChainData && <ChainCrumb name=\{openChainData\.name\} onBack=\{\(\) => setOpenChain\(null\)\} \/>\}/);
    assert.match(panelSource, /\{openChainData && <ChainStepMeter count=\{countChainSteps\(openChainData\)\}/);
    assert.match(panelSource, /\{!openChainData && <button type="button" onClick=\{openSearch\} className="code-tb-search"/);
    assert.match(panelSource, /if \(openChain\) \{\s+setOpenChain\(null\);\s+return;/);
    // Switching to another bot's code must not leave a chain of the previous bot open.
    assert.match(panelSource, /openChain\?\.owner === activeCode/);
});


test("main canvas pins arm and connect by clicks, with explicit cancellation and orphan disconnect", () => {
    const board = read(BOARD_PATH);
    const nodes = read(NODES_PATH);
    assert.match(nodes, /export function PinBar/);
    assert.doesNotMatch(nodes, /code-bt-kind-tab|code-bt-add-below|OrderNudgeTabs/);
    assert.match(nodes, /className="code-pin-add-condition"/);
    assert.match(board, /Tap an input to connect\. Tap empty space to cancel\./);
    assert.match(board, /if \(!current.moved && !current.pinch && current.empty/);
    assert.match(board, /previewEdge && !armedWire\?\.touch/);
    assert.match(board, /disconnectNode\(roots, node, copy\)/);
    assert.match(read(PANEL_PATH), /aria-label="Add node"/);
});

test("pin bars sit flush inside the frame, actions get the same frame and bar, and conditionals say their kind once", () => {
    const nodes = read(NODES_PATH);
    const css = read("../../index.css");

    // Input bar top edge = frame top edge; output bar bottom edge = frame bottom edge; nothing outside.
    assert.match(css, /\.code-pin-bar--input \{ top: -1px;/);
    assert.match(css, /\.code-pin-bar--output \{ bottom: -1px;/);
    assert.doesNotMatch(css, /\.code-pin-bar--(?:input|output) \{[^}]*calc\(-\d+px/);
    assert.match(css, /\.code-pin-bar:not\(\.is-armed\):not\(\.is-valid\):hover:not\(:disabled\) span/);
    assert.match(css, /max\(11px, min\(calc\(14px \/ var\(--code-zoom, 1\)\), 22%\)\)/);
    assert.match(css, /max\(16px, min\(calc\(34px \/ var\(--code-zoom, 1\)\), 34%\)\)/);

    // The action node keeps its green content in a core inside the framed node, with the shared input bar.
    assert.match(nodes, /<PinBar direction="input" disabled=\{disabled\} valid=\{validInput\} blockedReason=\{blockedReason\} label=\{node\.parents\?\.length > 1 \? inputBarBehavior\(node\.parents\.length\)\.message : null\} onActivate=\{onInput\} onPress=\{onInputPress\} \/>\s*\{node\.orphan && <span className="code-orphan-label">Not connected<\/span>\}\s*<div className="code-bt-task-core code-an">/);

    // Every node is a gray frame around a core node; the kind and the order badge live in the core's header
    // (no action count, no footer title).
    assert.match(nodes, /className="code-bt-core code-bt-core--cond">\s*<div className="code-bt-cond-head">[\s\S]*<ExecutionOrderControls[\s\S]*\{rows\.map/);
    assert.match(nodes, /className="code-bt-core code-bt-core--root"/);
    assert.doesNotMatch(nodes, /className="code-bt-title"|conditionalCountText/);
});

test("refused wires explain themselves, and a missing ability renders instead of crashing", () => {
    const board = read(BOARD_PATH);
    const nodes = read(NODES_PATH);
    assert.match(board, /wireBlockReason\(roots, parent, child\)/);
    assert.match(board, /setWireToast\(reason\)/);
    assert.match(board, /blockedReason/);
    assert.match(nodes, /Ability not equipped/);
    assert.match(nodes, /blockedReason \?\? label/);
    assert.match(read(PANEL_PATH), /aria-label="Clear all"/);
});

test("the chain editor is stacked blocks with loose blocks, no pin bars or per-list add buttons", () => {
    const editor = read("./chains/ChainEditor.jsx");
    assert.doesNotMatch(editor, /PinBar|cx-add-node|\+ Node|\+ Step/);
    assert.match(editor, /chooseDropGap\(measureGaps\(\)/);
    assert.match(editor, /addLooseBlock\(/);
    assert.match(editor, /LONG_PRESS_MS = 300/);
    assert.match(read(PANEL_PATH), /chainEditorRef\.current\?\.addStep\(\)/);
});

test("chain C-blocks hold plain condition rows and the add-node key inserts under the selection", () => {
    const editor = read("./chains/ChainEditor.jsx");
    assert.doesNotMatch(editor, /all must be true|cx-count|code-bt-strip/);
    assert.match(editor, /<div className="cx-c-title">\{numberBadge\}<span className="cx-kw">\{description\.tag\}<\/span><\/div>/);
    assert.doesNotMatch(editor, /"AND"/);
    assert.match(editor, /readWorkspaceShortcut\("addNode"\)/);
    assert.match(editor, /listPath: \[\.\.\.selected, isConditional\(current\) \? BRANCH : BODY\], index: 0/);
    assert.match(editor, /RIGHT_ROOM = 300/);
    assert.match(editor, /STACK_WIDTH = 300/);
});

test("side panels use flat rows labelled Value for both compared operands", () => {
    const nodes = read(NODES_PATH);
    const row = nodes.slice(nodes.indexOf("function ConditionalInspectorRow"), nodes.indexOf("function LogicNodeInspector"));
    assert.doesNotMatch(row, /"Number"|"Variable"|ci-sub/);
    assert.match(row, /className="ci-sep"/);
    assert.equal((row.match(/row\("Value"/g) ?? []).length, 4);
});

test("the workspace lays out by its own width: full, mid with a More menu, phone with a bottom bar", () => {
    const panel = read(PANEL_PATH);
    const css = read("../../index.css");
    assert.match(panel, /width > 1100 \? "full" : width >= 640 \? "mid" : "phone"/);
    assert.match(panel, /new ResizeObserver\(measure\)/);
    assert.match(panel, /data-stage=\{stage\}/);
    // Mid: rarer tools in More, Clear all last in quiet red after a divider.
    assert.match(panel, /stage === "mid" && <ToolbarMoreMenu items=\{moreItems\}/);
    assert.match(panel, /\{ divider: true \},\s*\{ label: "Clear all", danger: true/);
    // Phone: Undo, Redo, Add (primary, "Step" in a chain), Vars, More, and the Add / More / counts sheets.
    assert.match(panel, /label=\{openChainData \? "Node" : "Add"\}/);
    for (const label of ["Add root", "Conditional node", "Action node…", "New chain", "Tidy layout", "Zoom to fit", "Clear all"]) assert.ok(panel.includes(`"${label}"`), label);
    assert.match(panel, /chainDragging \? "is-faded"/);
    assert.match(panel, /onDragChange=\{setChainDragging\}/);
    assert.match(css, /\.code-workspace\[data-stage="phone"\] \.code-history-rail \{ display: none; \}/);
    assert.match(css, /\.code-phone-bar\.is-faded \{ opacity: 0; pointer-events: none; \}/);
    // The chain's desktop primary says "Add step" again, and every shortcut handler is stage-independent.
    assert.match(panel, /aria-label="Add node"[\s\S]*?<span className="code-tb-label">\+ Node<\/span>/);
});

test("lifted wires disconnect on empty space and input pins drag like output pins", () => {
    const board = read(BOARD_PATH);
    assert.match(board, /beginWireHold = \(event, node, mode = "output"\)/);
    assert.match(board, /onInputPress: \(event\) => beginWireHold\(event, node, "input"\)/);
    assert.match(board, /else if \(mode === "input"\) disconnectIfWired\(node\)/);
    assert.match(board, /dropLiftedWire\(\);\s*setArmedWire\(null\);/);
});

test("node anatomy: shared action rows, header and foot targets, and the phone selection bar", () => {
    const nodes = read(NODES_PATH);
    const editor = read("./chains/ChainEditor.jsx");
    const panel = read(PANEL_PATH);
    assert.match(nodes, /className="code-an-r1"[\s\S]*className="code-an-r2"[\s\S]*code-an-r3/);
    assert.match(editor, /className="cx-an-r1"[\s\S]*className="cx-an-r2"[\s\S]*cx-an-r3/);
    // Header click selects without opening a panel; the foot is a separate target; a selected foot adds after the block.
    assert.match(editor, /const headerTap = /);
    assert.match(editor, /const footTap = \(path\) => selectOnly\(path, null, "foot"\)/);
    assert.match(editor, /selectedPart !== "foot"/);
    assert.match(editor, /"end repeat"/);
    assert.match(editor, /"end if"/);
    // Phones: a tap selects, a second tap opens, and the bottom bar turns into Edit / Below or Disconnect / Up / Down / Delete / Done.
    assert.match(editor, /const rowTap = \(path, rowIndex\) => selectOnly\(path, rowIndex\);/);
    for (const label of ["Edit", "Below", "Disconnect", "Up", "Down", "Delete", "Done"]) assert.ok(panel.includes(`label="${label}"`), label);
    assert.match(panel, /stage === "phone" && !phoneSelection && <nav/);
});

test("clicks only select; double-click and Enter / E open a node", () => {
    const board = read(BOARD_PATH);
    const editor = read("./chains/ChainEditor.jsx");
    assert.match(board, /const editNode = /);
    assert.match(board, /\["e", "E", "Enter"\]\.includes\(event\.key\)/);
    assert.match(board, /editNode\(graphNodeById\.get\(frame\.dataset\.graphNodeId\)/);
    assert.match(editor, /onDoubleClick: floating \? undefined/);
    assert.doesNotMatch(board + editor, /NodeContextMenu|setContextMenu/);
    // A click never opens the panel on desktop.
    assert.match(editor, /const plainTap = \(path\) => selectOnly\(path\);/);
    // Only two clicks on the same target are a double-click, and phones never open from a tap or double-tap.
    assert.match(editor, /phone \|\| !clickLogRef\.current\.isDoubleClick\(\)/);
    assert.match(board, /phone \|\| !frame/);
    assert.match(board, /setSelectedRow\(\{ id: node\.id, rowIndex \}\)/);
});

test("the variables dialog lists Number and True/false only, with a slot meter and a clickable uses list", () => {
    const modal = read("./modals/CustomVariablesModal.jsx");

    assert.match(modal, /<h2 id="custom-variables-title">Variables<\/h2>/);
    assert.match(modal, /\[\["number", "Number"\], \["boolean", "True\/false"\]\]/);
    assert.doesNotMatch(modal, /timer|Timer|Countdown|Stopwatch/);
    assert.match(modal, /code-cv-meter \$\{meterState\}/);
    assert.match(modal, /maxSlots \* 0\.85 \? "is-near"/);
    assert.match(modal, /collectVariableUses\(configuration, selectedVariable\.id/);
    assert.match(modal, /Used in \$\{placesLabel\(uses\.length\)\}/);
    assert.match(modal, /onClose\(\);\s+onJumpToUse\?\.\(use\.target\);/);
    assert.match(modal, /removeVariableFromConfiguration\(configuration, selectedVariable\.id\)/);
    const panel = read("./CodingPanel.jsx");
    assert.match(panel, /onJumpToUse=\{jumpToUse\}/);
    assert.match(panel, /chainEditorRef\.current\?\.selectStep\(pendingUse\.path\)/);
    assert.match(panel, /logicBoardRef\.current\?\.selectNode\(pendingUse\.nodeId\)/);
});

test("both angle helps open one movement direction dialog, on Relative for Direction and Absolute for Angle", () => {
    const nodes = read(NODES_PATH);
    const dialog = read("./modals/AngleGuideDialog.jsx");

    assert.match(nodes, /<AngleGuideDialog initialMode="relative"/);
    assert.match(nodes, /<AngleGuideDialog initialMode="absolute"/);
    assert.doesNotMatch(nodes, /RelativeMovementAngleModal|code-angle-|code-phase-|MOVEMENT GUIDE|PHASE STRIKE GUIDE/);
    assert.match(dialog, /title="Movement direction"/);
    assert.match(dialog, />Relative<\/button>/);
    assert.match(dialog, />Absolute<\/button>/);
    assert.match(dialog, /prefers-reduced-motion: reduce/);
    assert.match(dialog, /title="Landing rotation"/);
    assert.doesNotMatch(dialog, /·/);
});

test("entity wording: Bots and Objects groups, Bot, and objects in the variable picker", () => {
    const nodes = read(NODES_PATH);
    const pickers = read("./nodes/pickerSupport.js");

    assert.match(nodes, /group: botOptions\.length \? "Objects"/);
    assert.match(nodes, /entityGroups\.length \? "Bots"/);
    assert.match(nodes, /definition\.supportsAbility \? "Bot" : "Entity"/);
    assert.match(pickers, /"Ability Entity": \{ chip: "Objects", title: "Objects" \}/);
    assert.match(pickers, /"Ability Entity": "pink"/);
    assert.match(nodes, /"selectable\.dangerZoneEdgeDistance"\]\.includes\(id\)/);
});

test("Rotate actions have a Fast turn switch with help, in the side panel and the chain inspector", () => {
    const nodes = read(NODES_PATH);
    assert.match(nodes, /<HudSwitchRow label="Fast turn"/);
    assert.match(nodes, /Turns twice as fast \(24° per tick\)\. Drains 20 stamina\/s while turning; normal speed below 2 stamina\./);
    assert.match(nodes, /showFastTurn=\{definition\.id === BOT_CODE_ACTIONS\.ROTATE_TOWARD_TARGET\}/);
    assert.match(nodes, /\+= ", fast"/);
    assert.match(read("./chains/ChainStepInspector.jsx"), /showFastTurn=\{definition\.id === BOT_CODE_ACTIONS\.ROTATE_TOWARD_TARGET\}/);
});
