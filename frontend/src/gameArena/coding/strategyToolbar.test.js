import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildInitialArenaShapes } from "../modelPayloads/arenaShapes.js";

const PANEL_PATH = fileURLToPath(new URL("./CodingPanel.jsx", import.meta.url));
const ARENA_PATH = fileURLToPath(new URL("../Arena.jsx", import.meta.url));
const PUZZLE_PLAY_PATH = fileURLToPath(new URL("../../pages/puzzles/PuzzlePlayPage.jsx", import.meta.url));
const PUZZLE_LOGIC_WORKSPACE_PATH = fileURLToPath(new URL("../../pages/puzzles/PuzzleLogicWorkspace.jsx", import.meta.url));
const BOARD_PATH = fileURLToPath(new URL("./LogicBoard.jsx", import.meta.url));
const NODES_PATH = fileURLToPath(new URL("./nodes/GraphNodes.jsx", import.meta.url));
const CUSTOM_VARIABLES_MODAL_PATH = fileURLToPath(new URL("./modals/CustomVariablesModal.jsx", import.meta.url));
const SEARCH_PATH = fileURLToPath(new URL("./modals/SearchRootNodesModal.jsx", import.meta.url));
const ICON_PATH = fileURLToPath(new URL("./controls/MatchToolIcon.jsx", import.meta.url));
const CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));
const MENU_EVENTS_PATH = fileURLToPath(new URL("./utils/codeMenuEvents.js", import.meta.url));

function readCodingSource() {
    return [PANEL_PATH, BOARD_PATH, NODES_PATH].map((path) => readFileSync(path, "utf8")).join("\\n");
}

test("match and building toolbars expose only their supported controls", () => {
    const source = readCodingSource();
    const matchControlsStart = source.indexOf("{isMatchTesting && (");
    const matchControlsEnd = source.indexOf("{!isMatchTesting &&", matchControlsStart);
    const matchControls = source.slice(matchControlsStart, matchControlsEnd);

    assert.match(source, /<div className="flex flex-col items-center gap-2\.5">/);
    assert.match(source, /icon=\{isAutoPlaying \? "pause" : "play"\}/);
    assert.match(source, /isAutoPlaying \? "PAUSE" : "PLAY"/);
    assert.match(source, /icon="check"/);
    assert.match(source, /: "SUBMIT"\}/);
    assert.match(source, /: "FORFEIT"\}/);
    assert.match(source, /onPuzzleSubmit = null/);
    assert.match(source, /onClick=\{onPuzzleSubmit\}/);
    assert.match(source, /isPuzzleSubmitting \? "SUBMITTING" : "SUBMIT PUZZLE"/);
    assert.match(source, />\s*MEASURE\s*</);
    assert.match(source, />\s*RESET STATS\s*</);
    assert.match(source, />\s*EDIT MY LOADOUT\s*</);
    assert.match(source, />\s*EDIT DUMMY LOADOUT\s*</);
    assert.ok(matchControls.indexOf("RESET STATS") < matchControls.indexOf("onFinishMatch"));
    assert.match(matchControls, /onFinishMatch[\s\S]*tone="green"/);
    assert.match(matchControls, /onSurrenderMatch[\s\S]*tone="red"/);
    assert.doesNotMatch(source, /SPAWN OPPONENT|EDIT OPPONENT LOADOUT|SAVE POINT|LOAD POINT|RESET TO BEGINNING/);
});

test("puzzle play is a local preview and puzzle submission is a separate action", () => {
    const arenaSource = readFileSync(ARENA_PATH, "utf8");
    const runAutoPlay = arenaSource.match(/const runAutoPlay = \(\) => \{[\s\S]*?const customVariableGoal/);

    assert.ok(runAutoPlay);
    assert.doesNotMatch(runAutoPlay[0], /submitPuzzleAttempt\(\)/);
    assert.match(arenaSource, /onPuzzleSubmit=\{isPuzzleMode && onPuzzleAttempt \? submitPuzzleAttempt : null\}/);
});

test("puzzle play restores drafts by puzzle without overriding loaded submissions", () => {
    const arenaSource = readFileSync(ARENA_PATH, "utf8");
    const puzzleSource = readFileSync(PUZZLE_PLAY_PATH, "utf8");

    assert.match(arenaSource, /puzzleCodeOverride \?\? readPuzzleBotCodeDraft\(puzzleNumber, initialPuzzle\?\.playerBot\?\.brain/);
    assert.match(arenaSource, /savePuzzleBotCodeDraft\(puzzleNumber, sanitized\)/);
    assert.match(puzzleSource, /key=\{`\$\{puzzleNumber\}:\$\{activeRestoredSubmission\?\.id \?\? "puzzle-default"\}`\}/);
    assert.match(puzzleSource, /puzzleNumber=\{puzzleNumber\}/);
    assert.match(puzzleSource, /puzzleCodeOverride=\{activeRestoredSubmission\?\.brain \?\? null\}/);
});

test("puzzle builder play resumes its preview and keeps builder code out of storage", () => {
    const arenaSource = readFileSync(ARENA_PATH, "utf8");
    const builderSource = readFileSync(fileURLToPath(new URL("../../pages/puzzles/PuzzleBuilderPage.jsx", import.meta.url)), "utf8");

    assert.match(arenaSource, /const puzzleSetupKey = JSON\.stringify\(\[/);
    assert.match(arenaSource, /if \(previousPuzzleSetupKeyRef\.current === puzzleSetupKey\) return;/);
    assert.match(arenaSource, /if \(isPuzzleMode\) \{[\s\S]*savePuzzleBotCodeDraft\(puzzleNumber, sanitized\);[\s\S]*\} else if \(!isPuzzleBuilder\) \{[\s\S]*saveStoredStrategyConfiguration\(strategyStorageKey, sanitized\);/);
    assert.match(arenaSource, /if \(!isPuzzleBuilder\) saveStoredStrategyConfiguration\(opponentStrategyStorageKey, sanitized\);/);
    assert.match(arenaSource, /if \(!isPuzzleBuilder\) return resetBotShape\(shape\);\s*const configuration/);
    assert.match(builderSource, /playerBot: requestBot\(draft\.playerBot, \{ useDefaultBrain: true \}\)/);
});

test("the visible building deadline preserves the manual submission grace window", () => {
    const arenaSource = readFileSync(ARENA_PATH, "utf8");
    const panelSource = readFileSync(PANEL_PATH, "utf8");

    assert.match(arenaSource, /const authoritativeRemaining = secondsRemaining\(autoSubmitDeadline\)/);
    assert.match(arenaSource, /if \(authoritativeRemaining === 0\) \{\s*clearInterval\(interval\);[\s\S]*handleFinishMatchRef\.current\?\.\(\);[\s\S]*\}/);
    assert.match(arenaSource, /autoFinishDeadlineRef/);
    assert.match(panelSource, /testingRemaining === 0 && finishStatus === "BUILDING"/);
    assert.match(panelSource, /PREPARING REPLAY · YOU CAN STILL SUBMIT/);
});

test("submitted match code closes and disables the coding workspace", () => {
    const panelSource = readFileSync(PANEL_PATH, "utf8");

    assert.ok(panelSource.includes("const isBotCodeLocked = isMatchTesting && ("));
    assert.ok(panelSource.includes('finishStatus === "SUBMITTING"'));
    assert.ok(panelSource.includes('finishStatus === "FINISHED"'));
    assert.ok(panelSource.includes("setIsLogicOpen(false)"));
    assert.ok(panelSource.includes("disabled={isBotCodeLocked}"));
    assert.ok(panelSource.includes("disabled={isBotCodeLocked || isTesting || !viewingCurrentRound}"));
    assert.ok(panelSource.includes("canRemove={!isBotCodeLocked && !isTesting && !roundDeleteLocked}"));
});

test("conditional ability pickers use all equipped abilities and resource-aware ammo choices", () => {
    const panelSource = readFileSync(PANEL_PATH, "utf8");
    const graphSource = readFileSync(NODES_PATH, "utf8");

    assert.match(panelSource, /abilityOptions: abilityDefinitionsForVariable\(variable, equipped\)/);
    assert.match(graphSource, /new Set\(\[\.\.\.STANDARD_ABILITY_IDS, \.\.\.selected\]\)/);
});

test("toolbar buttons share the blueprint surface, show labels, and retain the existing handlers", () => {
    const source = readCodingSource();

    assert.match(source, /className=\{`arena-toolbar-button \$\{tones\[tone\]/);
    assert.match(readFileSync(CSS_PATH, "utf8"), /\.arena-toolbar-button \{/);
    assert.match(source, /\{icon && <ToolIcon name=\{icon\} \/>}<span>\{children\}<\/span>/);
    assert.match(source, /onClick=\{onAutoPlayToggle\}/);
    assert.match(source, /onClick=\{onResetArenaStats\}/);
    assert.match(source, /onClick=\{onMeasurementToggle\}/);
    assert.match(source, /onClick=\{onFinishMatch\}/);
    assert.match(source, /onClick=\{onSurrenderMatch\}/);
    assert.match(source, /onClick=\{onOpenPlayerLoadout\}/);
    assert.match(source, /onClick=\{onOpenOpponentLoadout\}/);
    assert.match(source, /onOpenPuzzleSubmissions/);
    assert.match(source, />PREVIOUS SUBMISSIONS</);
    assert.match(readFileSync(ICON_PATH, "utf8"), /pause: <><path/);
});

test("code graph nodes can be dragged from their surfaces without stealing control clicks", () => {
    const source = readCodingSource();

    assert.equal(source.includes("event.target?.closest?.("), true);
    assert.match(source, /\[data-node-drag-ignore\]/);
    assert.match(source, /<section key=\{node\.id\} onClick=\{\(event\) => selectGraphNode\(event, node\.id\)\}/);
    assert.match(source, /function GraphConditionNode[\s\S]*beginNodeDrag\(event, node\.id\)/);
    assert.match(source, /function GraphActionNode[\s\S]*beginNodeDrag\(event, node\.id\)/);
    assert.match(source, /selectedNodeIds\.includes\(key\)/);
    assert.match(source, /onPointerDown=\{beginMarquee\}/);
    assert.match(source, /window\.addEventListener\("keydown"/);
    assert.match(source, /data-node-drag-ignore="true" className="code-condition-prefix/);
});

test("arena and puzzle code workspaces share compact controls and pinch zoom", () => {
    const panelSource = readFileSync(PANEL_PATH, "utf8");
    const boardSource = readFileSync(BOARD_PATH, "utf8");
    const puzzleWorkspaceSource = readFileSync(PUZZLE_LOGIC_WORKSPACE_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(panelSource, /onPinchZoom=\{applyPinchZoom\}/);
    assert.match(puzzleWorkspaceSource, /className="code-workspace-overlay fixed/);
    assert.match(puzzleWorkspaceSource, /onPinchZoom=\{applyPinchZoom\}/);
    assert.match(boardSource, /const handleTouchPointerDown = \(event\) =>/);
    assert.match(boardSource, /onPointerDown=\{handleBoardPointerDown\}/);
    assert.match(boardSource, /onPinchZoom\(nextZoom, nextPan\)/);
    assert.match(css, /\.code-workspace-overlay > \.code-workspace[\s\S]*height: min\(90dvh, 820px\);/);
    assert.match(css, /\.code-toolbar-actions \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 2;/);
    assert.match(css, /\.code-custom-variables-dialog > header > div:last-child > button:first-child[\s\S]*grid-column: 1 \/ -1;/);
    assert.match(css, /\.code-workspace-coach \{[\s\S]*background: #07111b;/);
    assert.match(css, /\.tutorial-guide-panel \{[\s\S]*height: 26rem;[\s\S]*display: flex;[\s\S]*overflow: hidden;/);
    assert.match(css, /\.tutorial-guide-content \{[\s\S]*flex: 1 1 auto;[\s\S]*overflow-y: auto;/);
});

test("overlapping graph nodes keep delete controls in the same stacking context", () => {
    const source = readCodingSource();
    const css = readFileSync(CSS_PATH, "utf8");
    const conditionalNode = source.slice(source.indexOf("function GraphConditionNode"), source.indexOf("function PuzzleConditionNode"));
    const actionNode = source.slice(source.indexOf("function GraphActionNode"), source.indexOf("function LogicNodeInspector"));

    assert.match(conditionalNode, /className="code-condition-node-remove"/);
    assert.match(actionNode, /className="code-compact-remove code-condition-node-remove"/);
    assert.match(css, /\.code-graph-node \{\s*cursor: grab;\s*isolation: isolate;/);
    assert.match(css, /\.code-condition-node-remove \{[^}]*z-index: 2/);
});

test("roots expose editable names and priorities with root-only search", () => {
    const panel = readCodingSource();
    const search = readFileSync(SEARCH_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(panel, /className="code-root-label">Root <RootNodePriorityInput/);
    assert.match(panel, /code-graph-node--root/);
    assert.doesNotMatch(panel, /kind: "code"/);
    assert.match(panel, /selectedNodeIds\.includes\(node\.id\)/);
    assert.match(panel, /function RootNameInput/);
    assert.match(panel, /maxLength=\{MAX_ROOT_NAME_LENGTH\}/);
    assert.match(panel, /onChange=\{\(event\) => setDraft\(event\.target\.value\)\}/);
    assert.match(panel, /onBlur=\{\(\) => onCommit\(draft\)\}/);
    assert.doesNotMatch(panel, /HIGHER PRIORITY|LOWER PRIORITY/);
    assert.match(css, /\.code-graph-node--root[\s\S]*background: #2b3137/);
    assert.match(search, /const name = root\?\.name \?\? "Root"/);
    assert.match(search, /\$\{name\} \$\{label\}/);
    assert.match(search, /const orderedNodes = \[\.\.\.nodes\]\.sort/);
    assert.match(search, /const matchingNodes = orderedNodes\.filter/);
    assert.match(search, /rootPriority\(roots, first\) - rootPriority\(roots, second\)/);
    assert.match(search, /code-node-picker code-node-picker--roots/);
    assert.match(search, /className="code-node-search-label"/);
    assert.match(search, /code-node-search-results code-root-search-results/);
    assert.match(search, /className=\{`code-root-search-row/);
    assert.match(search, /role="button"/);
    assert.match(search, /onClick=\{\(\) => selectNode\(node\)\}/);
    assert.doesNotMatch(search, /search-root-node-option/);
    assert.doesNotMatch(search, /beginDrag|position\.x|cursor-move/);
});

test("compact conditions own their comparator and actions summarize inspector targets", () => {
    const source = readCodingSource();

    assert.match(source, /function LogicNodeInspector/);
    assert.match(source, /aria-label="Comparator"/);
    assert.doesNotMatch(source, /KeyboardDropdown/);
    assert.match(source, /className="code-operator-socket"/);
    assert.match(source, /className="code-action-label">\{formatActionNodeLabel\(selected\?\.label \?\? "Action"\)\}/);
    assert.doesNotMatch(source, /Move: \$\{selected\?\.label/);
    assert.match(source, /className="code-action-target">Target: \{describedTarget\}/);
    assert.match(source, /function actionNodeWidth/);
    assert.match(source, /function formatActionNodeLabel/);
    assert.match(source, /Move\|Movement\|Rotate\|Ability/);
    assert.match(source, /width: node\.width/);
    assert.match(readFileSync(CSS_PATH, "utf8"), /\.code-condition-node-remove \{[^}]*width: 30px;[^}]*box-sizing: border-box;[^}]*padding: 0;/);
    assert.match(source, /relativeMovementAngle/);
    assert.match(source, /deg from/);
    assert.match(source, /" deg from "/);
    assert.match(source, /targetAngle \?\? 0\)} deg\)/);
    assert.match(source, /`\$\{formatOrdinal\(ordinal\)\} \$\{order\[0\]\.toUpperCase\(\)\}/);
    assert.doesNotMatch(source, /code-action-sentence[\s\S]*<OrderedTargetPicker value=\{entry\.actionTarget/);
    assert.doesNotMatch(source, /application\/x-bot-operator|GraphVariableNode|GraphTargetNode/);
});

test("boolean condition inputs use the comparator socket styling", () => {
    const source = readFileSync(NODES_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(source, /boolean value[\s\S]*className="code-operator-socket code-condition-boolean-input"/);
    assert.match(css, /\.code-condition-input > select\.code-condition-boolean-input[\s\S]*color: #bae6fd/);
});

test("action target inspectors switch to coordinates and preserve target offsets", () => {
    const source = readFileSync(NODES_PATH, "utf8");

    assert.match(source, /function actionTargetMode\(entry, definition\)/);
    assert.match(source, /entry\?\.movementMode === "coordinates" \? "coordinates" : "target"/);
    assert.match(source, /function ActionTargetControls/);
    assert.match(source, /<option value="coordinates">\{definition\?\.angleTarget \? "Absolute coordinates" : "Relative to coordinates"\}<\/option>/);
    assert.match(source, /X COORDINATE/);
    assert.match(source, /Y COORDINATE/);
    assert.match(source, /targetOffsetX/);
    assert.match(source, /targetOffsetY/);
    assert.match(source, /formatCoordinateTargetLabel/);
    assert.match(source, /<span>deg<\/span>/);
    assert.match(source, /0 deg = toward/);
    const movementControls = source.slice(source.indexOf("function MovementConfigurationControls"), source.indexOf("function PhaseOrientationControls"));
    assert.doesNotMatch(movementControls, /targetOffsetX|targetOffsetY/);
});

test("action node picker provides an auto-focused search", () => {
    const source = readCodingSource();

    assert.match(source, /function NodeKindPicker/);
    assert.match(source, /placeholder="Search actions…"/);
    assert.match(source, />＋<\/span> ADD ROOT/);
    assert.match(source, /<input ref=\{searchInputRef\} autoFocus value=\{query\}/);
    assert.match(source, /filteredActions\.map/);
    assert.match(source, /className="code-node-search-label"/);
    const actionPicker = source.slice(source.indexOf("function NodeKindPicker"), source.indexOf("function VariableOperandPicker"));
    assert.doesNotMatch(actionPicker, /<small>\{action\.id\}<\/small>/);
    assert.match(actionPicker, /<strong>\{action\.label\}<\/strong><\/button>/);
});

test("inserted nodes use explicit placements without auto-adjusting existing nodes", () => {
    const source = readCodingSource();
    assert.match(source, /let childX = left \+ Math\.max\(0, \(width - descendantsWidth\) \/ 2\)/);
    assert.match(source, /const commitConfiguration = \(nextConfiguration, preserveGraphPositions = true, positionOverrides = \{\}\)/);
    assert.match(source, /Object\.entries\(positionOverrides\)\.forEach/);
    assert.match(source, /positionInsertedGraphNode\(condition, previousAction, nextAction, nodeOffsetsRef\.current, CONDITION_TO_CHILD_GAP\)/);
    assert.doesNotMatch(source, /actionNodePrefix/);
});

test("variable and action searches share a wheel-contained picker design", () => {
    const source = readCodingSource();

    assert.match(source, /const title = "ADD VARIABLE INPUT"/);
    assert.equal(source.match(/className="code-node-search-label"/g)?.length, 2);
    assert.equal(source.match(/className="code-node-search-results"/g)?.length, 2);
    assert.ok((source.match(/onWheel=\{\(event\) => event\.stopPropagation\(\)\}/g)?.length ?? 0) >= 2);
    assert.doesNotMatch(source, /code-variable-search/);
});

test("condition graph wiring follows the rendered node bottom", () => {
    const source = readCodingSource();

    assert.match(source, /const ROOT_NODE_HEIGHT = 144;/);
    assert.match(source, /height: ROOT_NODE_HEIGHT/);
    assert.match(source, /const conditionHeight = 94 \+ Math\.max\(1,[\s\S]*\* 42/);
    assert.match(source, /childY = y \+ conditionHeight \+ 70/);
});

test("conditional nodes expand to fit complete variable names", () => {
    const source = readCodingSource();
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(source, /function conditionNodeWidth\(branch, stateVariables\)/);
    assert.match(source, /width: node\.width/);
    assert.match(css, /grid-template-columns: 34px max-content 64px max-content 30px/);
    assert.match(css, /\.code-condition-input \{[\s\S]*width: max-content/);
    assert.match(css, /\.code-condition-input \{[\s\S]*min-width: 0/);
    assert.match(css, /\.code-condition-input\.is-raw \{ width: 110px; \}/);
    assert.match(source, /const leftWidth = 39 \+ leftLength \* 5\.5/);
    assert.match(source, /const rightWidth = condition\.right\?\.type === "variable"[\s\S]*: 110/);
    assert.doesNotMatch(source, /condition\.right\?\.type === "range"/);
    assert.match(source, /return 175 \+ leftWidth \+ rightWidth/);
    assert.match(source, /GRAPH_NODE_WIDTH, 1200/);
});

test("conditional operand icon toggles replace literals and restore raw numbers", () => {
    const source = readCodingSource();

    assert.match(source, /function ConditionalOperandBox/);
    assert.match(source, /aria-label=\{`Use a variable for input \$\{operand\}`\}/);
    assert.match(source, /function VariableOperandPicker/);
    assert.match(source, /<input ref=\{searchInputRef\} autoFocus value=\{query\}/);
    assert.match(source, /right: \{ type: "variable", value: definition\.id \}/);
    assert.match(source, /onClick=\{onPickVariable\}/);
    assert.match(source, /aria-label=\{`Use a raw number for input \$\{operand\}`\}/);
    assert.match(source, /right: \{ type: "number", value: 0 \}/);
    assert.match(source, /className="code-condition-input-toggle"/);
    assert.match(source, /onClick=\{onOpenVariablePicker \?\? onInspectVariable\}/);
    assert.doesNotMatch(source, /onChooseExisting|ON YOUR CANVAS/);
});

test("raw number inputs keep their DOM focus when the selected variable changes", () => {
    const source = readCodingSource();

    assert.match(source, /const externalValueRef = useRef\(String\(value \?\? fallback\)\);/);
    assert.match(source, /if \(document\.activeElement !== inputRef\.current\) setDraft\(nextValue\);/);
    assert.doesNotMatch(source, /<DeferredNumberInput key=\{leftDefinition\.id\}/);
});

test("raw number inputs accept digits only and retain the original caret presentation", () => {
    const source = readCodingSource();
    const css = readFileSync(CSS_PATH, "utf8");
    const numberInput = readFileSync(NODES_PATH, "utf8");

    assert.match(numberInput, /pattern=\{digitsOnly \? "\[0-9\]\*" : undefined\}/);
    assert.match(numberInput, /digitsOnly \? event\.target\.value\.replace\(\/\[\^0-9\]\/g, ""\)/);
    assert.match(numberInput, /digitsOnly && event\.key\.length === 1 && !\/\[0-9\]\/\.test\(event\.key\)/);
    assert.match(source, /<DeferredNumberInput digitsOnly=\{integerNumber && !signedNumber\} integerOnly=\{integerNumber\} data-node-drag-ignore="true" aria-label=\{`Input \$\{operand\} number`\}/);
    assert.match(numberInput, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
    assert.match(css, /\.code-condition-input\.is-raw:focus-within/);
    assert.match(css, /\.code-condition-input > input,[\s\S]*caret-color: #fff;/);
    assert.match(css, /\.code-condition-input\.is-raw > input \{ caret-color: transparent; \}/);
});

test("clicking empty canvas space deselects an active raw input", () => {
    const source = readCodingSource();
    const clearFromSurface = source.slice(source.indexOf("const clearCanvasSelectionFromSurface"), source.indexOf("const selectGraphNode"));

    assert.match(clearFromSurface, /event\.target !== event\.currentTarget/);
    assert.match(clearFromSurface, /document\.activeElement\?\.closest\?\.\("\.code-condition-input\.is-raw, \.code-root-name"\)/);
    assert.match(clearFromSurface, /document\.activeElement\.blur\(\)/);
});

test("variable condition searches render visual category headings", () => {
    const source = readFileSync(NODES_PATH, "utf8");

    assert.match(source, /const groupedDefinitions = groupedConditionPickerOptions\(definitions\);/);
    assert.match(source, /className="code-node-search-group"/);
    assert.match(source, /className="code-node-search-group-title"/);
    assert.match(source, /group\.options\.map/);
});

test("condition and action DOM identities are scoped to their root", () => {
    const source = readCodingSource();

    assert.match(source, /conditionGraphNodeId\(branch\.id, rootId\)/);
    assert.match(source, /actionGraphNodeId\(branch\.id, actionIndex, rootId\)/);
    assert.match(source, /return `condition:\$\{branchId\}:root:\$\{rootId\}`/);
    assert.match(source, /return `action:\$\{branchId\}:\$\{actionIndex\}:root:\$\{rootId\}`/);
});

test("each condition row has its own remove control", () => {
    const source = readCodingSource();

    assert.match(source, /onRemoveCondition=\{\(rowIndex\)/);
    assert.match(source, /aria-label=\{`Remove condition \$\{index \+ 1\}`\}/);
    assert.match(source, /conditions: \(current\.conditions \?\? \[\]\)\.filter/);
});

test("ALWAYS is offered from the variable operand picker", () => {
    const source = readCodingSource();

    assert.match(source, /const showAlways = operand === 1 && !numericOnly && matches\("ALWAYS", "always"\);/);
    assert.match(source, /id: "always", label: "ALWAYS", valueType: "boolean"/);
    assert.match(source, /operandPicker\.operand === 1 && variableId === "always"/);
    assert.match(source, /\? \{ type: "always", \.\.\.\(condition\.join === "or" \? \{ join: "or" \} : \{\}\) \}/);
    assert.match(source, /Choose a variable for condition/);
});

test("action and variable pickers use flush classic dropdown rows", () => {
    const source = readCodingSource();
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(source, /code-node-picker code-node-picker--action/);
    assert.match(source, /code-node-picker code-node-picker--variable/);
    assert.doesNotMatch(source, /code-node-picker code-node-picker--(?:action|variable)[^\n]*rounded/);
    assert.match(source, /className="code-conditional-add-button"/);
    assert.equal((source.match(/className="code-conditional-add-button"/g) ?? []).length, 2);
    assert.match(source, /code-action-add-button/);
    assert.match(css, /\.code-node-picker--action \{ border-color: rgba\(148, 163, 184, \.52\); background-color: #15191d; \}/);
    assert.match(css, /\.code-node-picker--variable \{ border-color: rgba\(148, 163, 184, \.52\); background-color: #15191d; \}/);
    assert.match(css, /\.code-node-search-results \{ display: grid; max-height: 300px; gap: 0; margin-top: 6px; overflow-y: auto; border: 1px solid rgba\(148, 163, 184, \.52\); background: rgba\(9, 11, 13, \.96\); padding: 4px 0; \}/);
    assert.match(css, /\.code-node-search-results button \{ display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-radius: 0; background: transparent; padding: 9px 10px; text-align: left; \}/);
    assert.match(css, /\.code-node-search-results button:hover \{ border-color: transparent; background: rgba\(203, 213, 225, \.16\); \}/);
    assert.doesNotMatch(css, /\.code-node-picker--(?:action|variable) \.code-node-search-results button \{/);
    assert.match(css, /\.code-compact-footer > button\.code-conditional-add-button \{ border-color: rgba\(125, 211, 252, \.62\); background: #081933; color: #bfdbfe; \}/);
    assert.match(css, /\.code-compact-footer > button\.code-action-add-button \{ border-color: #c084fc; background: #581c87; color: #fae8ff; \}/);
    assert.doesNotMatch(css, /\.code-compact-footer > button\.code-action-add-button[^\n]*linear-gradient/);
});

test("conditional nodes show depth and add a parent conditional", () => {
    const source = readCodingSource();

    assert.match(source, /<span className="code-node-badge">\{node\.path\.length\}<\/span>/);
    assert.match(source, /const nextRoots = insertParentLogicBranch\(roots, node\.rootIndex, node\.path, parent\);/);
    assert.match(source, /const nextGraph = buildLogicGraph\(nextRoots, stateVariables, selectedLoadout, targetTypes\);/);
    assert.match(source, /positionOverrides\[nextParent\.id\]/);
    assert.match(source, /const mappedPath = \[\.\.\.candidate\.path\.slice\(0, node\.path\.length\), 0/);
    assert.match(source, /onAddChildConditional=\{\(\) =>/);
    assert.match(source, /children: \[\.\.\.\(current\.children \?\? \[\]\), child\]/);
    assert.match(source, /positionInsertedGraphNode\(node, previousChild, nextChild, nodeOffsetsRef\.current, CONDITION_TO_CHILD_GAP\)/);
    assert.doesNotMatch(source, /siblingIndex === 0 \? "IF" : "ELSE IF"/);
});

test("root conditional controls do not change graph selection", () => {
    const source = readCodingSource();

    assert.match(source, /const addRootConditional = \(event, node, rootNode\) => \{\s*event\.stopPropagation\(\);/);
    assert.match(source, /onClick=\{\(event\) => addRootConditional\(event, node, rootNode\)\}/);
});

test("removing a conditional promotes its child branches", () => {
    const source = readCodingSource();

    assert.match(source, /removeLogicBranch\(roots, rootIndex, path\)/);
    assert.match(source, /if \(selectedConditionIds\.has\(branchId\)\) return removeFromBranches\(branch\.children, rootId\);/);
});

test("search and configuration menus are exclusive and close on Escape", () => {
    const source = readCodingSource();

    assert.match(source, /isExternalConfigurationOpen = false/);
    assert.match(source, /onCloseExternalConfiguration/);
    assert.match(source, /if \(!isSearchOpen\) return;/);
    assert.match(source, /if \(!isExternalConfigurationOpen\) return;/);
    assert.match(source, /useDialogFocus\(dialogRef, \{ onClose \}\)/);
    assert.match(source, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); event\.stopPropagation\(\);/);
    assert.match(source, /useExclusiveSearchMenu\(pickerRef, true, onClose\)/);
    assert.match(source, /onSearchCloseRef\.current\?\.\(\);/);
    assert.match(source, /onCloseExternalConfigurationRef\.current\?\.\(\);/);
});

test("Escape closes one search or configuration layer before the code workspace", () => {
    const source = readCodingSource();
    const menuEvents = readFileSync(MENU_EVENTS_PATH, "utf8");
    const layeredClose = source.slice(source.indexOf("const closeTopLogicLayer"), source.indexOf("useDialogFocus(logicDialogRef"));
    const actionPicker = source.slice(source.indexOf("function NodeKindPicker"), source.indexOf("function VariableOperandPicker"));
    const variablePicker = source.slice(source.indexOf("function VariableOperandPicker"), source.indexOf("function ConditionalOperandBox"));

    assert.match(layeredClose, /if \(isNodeSearchOpen\)[\s\S]*setIsNodeSearchOpen\(false\);[\s\S]*return;/);
    assert.match(layeredClose, /if \(isCustomVariablesOpen\)[\s\S]*setIsCustomVariablesOpen\(false\);[\s\S]*return;/);
    assert.match(layeredClose, /setIsLogicOpen\(false\);/);
    assert.match(source, /onClose: closeTopLogicLayer/);
    assert.match(actionPicker, /event\.preventDefault\(\); event\.stopPropagation\(\); onCancel\(\);/);
    assert.match(variablePicker, /event\.preventDefault\(\); event\.stopPropagation\(\); onClose\(\);/);
    assert.match(menuEvents, /OPEN_SEARCH_MENUS\.push\(menuEntry\)/);
    assert.match(menuEvents, /if \(event\.key !== "Escape" \|\| OPEN_SEARCH_MENUS\.at\(-1\) !== menuEntry\) return;/);
    assert.match(menuEvents, /window\.addEventListener\("keydown", closeOnEscape, true\)/);
    assert.match(menuEvents, /window\.removeEventListener\("keydown", closeOnEscape, true\)/);
    assert.match(menuEvents, /OPEN_SEARCH_MENUS\.splice\(entryIndex, 1\)/);
    assert.match(menuEvents, /const returnFocusTarget = menu\?\.parentElement\?\.closest\?\.\('\[role="dialog"\]'\)/);
    assert.match(menuEvents, /returnFocusTarget\.focus\(\{ preventScroll: true \}\)/);
    const customVariables = readFileSync(fileURLToPath(new URL("./modals/CustomVariablesModal.jsx", import.meta.url)), "utf8");
    assert.match(customVariables, /useExclusiveSearchMenu\(dialogRef, true, onClose\)/);
});

test("removing the final condition removes its conditional node", () => {
    const source = readCodingSource();

    assert.match(source, /const currentConditions = Array\.isArray\(branch\.conditions\) \? branch\.conditions : \[\];/);
    assert.match(source, /if \(currentConditions\.length <= 1\) \{[\s\S]*removeBranch\(node\.rootIndex, node\.path\);/);
    assert.match(source, /setSelectedNodeIds\(\(current\) => current\.filter\(\(id\) => id !== node\.id\)\);/);
});

test("condition variable chips open detailed configuration in the inspector", () => {
    const source = readCodingSource();
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(source, /kind: "condition-variable"/);
    assert.match(source, /if \(inspectedNode\.kind === "condition-variable"\)/);
    assert.match(source, /definition\.supportsTarget && field\("Target"/);
    assert.doesNotMatch(source, /code-condition-inline-config/);
    assert.match(css, /grid-template-columns: 34px max-content 64px max-content 30px/);
    assert.match(css, /\.code-operator-socket \{ min-width: 64px/);
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

test("modulo is exposed only as a custom-variable operation", () => {
    const source = readCodingSource();

    assert.match(source, /<option value=\{CUSTOM_VARIABLE_OPERATIONS\.MODULO\}>%<\/option>/);
    assert.doesNotMatch(source, /condition\.modulo|comparator === "modulo"|Modulo divisor/);
});

test("custom variable configuration only defines variables and starting values", () => {
    const source = readFileSync(CUSTOM_VARIABLES_MODAL_PATH, "utf8");

    assert.doesNotMatch(source, /BooleanVariableConditions|ModalConditionOperand|\+ AND|\+ OR/);
    assert.match(source, /valueType: event\.target\.value/);
    assert.match(source, /STARTING VALUE/);
    assert.match(source, /arena-toolbar-button arena-toolbar-button--red code-custom-variable-delete-button/);
});

test("modify custom variables use conditional-style operands and layered inspectors", () => {
    const source = readCodingSource();
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(source, /function VariableActionControls/);
    assert.match(source, /code-condition-input-toggle/);
    assert.match(source, /terms\.map\(\(term, termIndex\)/);
    assert.match(source, /updateTerms\(\[\.\.\.terms/);
    assert.match(source, /code-variable-action-input-value/);
    assert.match(source, /code-variable-action-input-label/);
    assert.match(source, /code-variable-action-input/);
    assert.doesNotMatch(source, /operandDefinition\.suffix/);
    assert.doesNotMatch(source, /function addVariableAction/);
    assert.match(source, /function ActionVariableInspector/);
    assert.match(source, /className="code-condition-row-remove"/);
    assert.match(source, /kind: "action"/);
    assert.match(source, /setActionOperandInspector/);
    assert.match(source, /onDismissOperandPicker/);
    assert.match(css, /\.code-inspector--secondary/);
    assert.match(css, /\.code-variable-action-operator \{ min-width: 68px/);
    assert.match(css, /\.code-inspector-body \.code-condition-input > input/);
    assert.match(css, /\.code-variable-action-input-value[\s\S]*text-overflow: ellipsis/);
    assert.match(css, /\.code-variable-action-input-label[\s\S]*text-overflow: ellipsis/);
    assert.match(css, /\.code-condition-input\.code-variable-action-input[\s\S]*width: 100%[\s\S]*max-width: 100%/);
    assert.match(css, /\.code-compact-condition[\s\S]*grid-template-columns: 34px max-content 64px max-content 30px/);
    assert.match(css, /\.code-variable-action-row[\s\S]*grid-template-columns: minmax\(68px, 76px\) minmax\(0, 1fr\) 30px/);
    assert.match(css, /\.code-condition-row-remove[\s\S]*width: 30px[\s\S]*height: 30px[\s\S]*margin-left: 0/);
    assert.match(css, /\.code-inspector-header button \{ color: #94a3b8; font-size: 28px; \}/);
    assert.match(css, /\.code-inspector-header button > span \{ color: inherit; font: inherit; letter-spacing: 0; \}/);
    assert.match(css, /\.code-condition-row-remove:hover:not\(:disabled\)[\s\S]*rgba\(127, 29, 29, \.38\)/);
});

test("code graph has no standalone variable, target, or connection workflow", () => {
    const source = readCodingSource();

    assert.doesNotMatch(source, /Add variable node|Add target node|setConnecting|selectConnectionSource|variableTargetPortId|graphConnectionPath/);
    assert.doesNotMatch(source, /const editorGraph|editorGraph\.|connections\.map/);
    assert.match(source, /delete clean\.editorGraph/);
    assert.doesNotMatch(source, /code-condition-inline-config/);
});
