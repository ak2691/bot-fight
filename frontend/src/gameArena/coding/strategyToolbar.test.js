import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildInitialArenaShapes } from "../modelPayloads/arenaShapes.js";

const PANEL_PATH = fileURLToPath(new URL("./CodingPanel.jsx", import.meta.url));
const BOARD_PATH = fileURLToPath(new URL("./LogicBoard.jsx", import.meta.url));
const NODES_PATH = fileURLToPath(new URL("./nodes/GraphNodes.jsx", import.meta.url));
const SEARCH_PATH = fileURLToPath(new URL("./modals/SearchRootNodesModal.jsx", import.meta.url));
const ICON_PATH = fileURLToPath(new URL("./controls/MatchToolIcon.jsx", import.meta.url));
const CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));
const MENU_EVENTS_PATH = fileURLToPath(new URL("./utils/codeMenuEvents.js", import.meta.url));

function readCodingSource() {
    return [PANEL_PATH, BOARD_PATH, NODES_PATH].map((path) => readFileSync(path, "utf8")).join("\\n");
}

test("match and building toolbars expose only their supported controls", () => {
    const source = readCodingSource();

    assert.match(source, /<div className="flex flex-col items-center gap-2\.5">/);
    assert.match(source, /icon=\{isAutoPlaying \? "pause" : "play"\}/);
    assert.match(source, /isAutoPlaying \? "PAUSE" : "PLAY"/);
    assert.match(source, /icon="check"/);
    assert.match(source, /: "SUBMIT"\}/);
    assert.match(source, /: "FORFEIT"\}/);
    assert.match(source, />\s*MEASURE\s*</);
    assert.match(source, />\s*RESET STATS\s*</);
    assert.match(source, />\s*EDIT MY LOADOUT\s*</);
    assert.match(source, />\s*EDIT DUMMY LOADOUT\s*</);
    assert.doesNotMatch(source, /SPAWN OPPONENT|EDIT OPPONENT LOADOUT|SAVE POINT|LOAD POINT|RESET TO BEGINNING/);
});

test("toolbar buttons share a fixed width, show labels, and retain the existing handlers", () => {
    const source = readCodingSource();

    assert.match(source, /w-56 items-center justify-center gap-2 whitespace-nowrap/);
    assert.match(source, /\{icon && <ToolIcon name=\{icon\} \/>}<span>\{children\}<\/span>/);
    assert.match(source, /onClick=\{onAutoPlayToggle\}/);
    assert.match(source, /onClick=\{onResetArenaStats\}/);
    assert.match(source, /onClick=\{onMeasurementToggle\}/);
    assert.match(source, /onClick=\{onFinishMatch\}/);
    assert.match(source, /onClick=\{onSurrenderMatch\}/);
    assert.match(source, /onClick=\{onOpenPlayerLoadout\}/);
    assert.match(source, /onClick=\{onOpenOpponentLoadout\}/);
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

test("roots expose editable names and priorities with root-only search", () => {
    const panel = readCodingSource();
    const search = readFileSync(SEARCH_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(panel, /className="code-root-label">Root <RootNodePriorityInput/);
    assert.match(panel, /code-graph-node--root/);
    assert.doesNotMatch(panel, /kind: "code"/);
    assert.match(panel, /selectedNodeIds\.includes\(node\.id\)/);
    assert.match(panel, /value=\{rootNode\?\.name \?\? "Root"\}/);
    assert.doesNotMatch(panel, /HIGHER PRIORITY|LOWER PRIORITY/);
    assert.match(css, /\.code-graph-node--root[\s\S]*background: #2b3137/);
    assert.match(search, /const name = root\?\.name \?\? "Root"/);
    assert.match(search, /\$\{name\} \$\{label\}/);
    assert.match(search, /code-node-picker code-node-picker--roots/);
    assert.match(search, /className="code-node-search-label"/);
    assert.match(search, /code-node-search-results code-root-search-results/);
    assert.doesNotMatch(search, /beginDrag|position\.x|cursor-move/);
});

test("compact conditions own their comparator and actions summarize inspector targets", () => {
    const source = readCodingSource();

    assert.match(source, /function LogicNodeInspector/);
    assert.match(source, /aria-label="Comparator"/);
    assert.match(source, /className="code-operator-socket"/);
    assert.match(source, /className="code-action-label">\{formatActionNodeLabel\(selected\?\.label \?\? "Action"\)\}/);
    assert.doesNotMatch(source, /Move: \$\{selected\?\.label/);
    assert.match(source, /className="code-action-target">Target: \{describedTarget\}/);
    assert.match(source, /function actionNodeWidth/);
    assert.match(source, /function formatActionNodeLabel/);
    assert.match(source, /Move\|Movement\|Rotate\|Ability/);
    assert.match(source, /width: node\.width/);
    assert.match(readFileSync(CSS_PATH, "utf8"), /\.code-condition-node-remove \{[^}]*width: 30px;[^}]*box-sizing: border-box;[^}]*padding: 0;/);
    assert.match(source, /away: "Away From"/);
    assert.match(source, /away_left: "Away \+ Left of"/);
    assert.match(source, /`\$\{formatOrdinal\(ordinal\)\} \$\{order\[0\]\.toUpperCase\(\)\}/);
    assert.doesNotMatch(source, /code-action-sentence[\s\S]*<OrderedTargetPicker value=\{entry\.actionTarget/);
    assert.doesNotMatch(source, /application\/x-bot-operator|GraphVariableNode|GraphTargetNode/);
});

test("action node picker provides an auto-focused search", () => {
    const source = readCodingSource();

    assert.match(source, /function NodeKindPicker/);
    assert.match(source, /placeholder="Search actions…"/);
    assert.match(source, />＋<\/span> ADD ROOT/);
    assert.match(source, /<input autoFocus value=\{query\}/);
    assert.match(source, /filteredActions\.map/);
    assert.match(source, /className="code-node-search-label"/);
    const actionPicker = source.slice(source.indexOf("function NodeKindPicker"), source.indexOf("function VariableOperandPicker"));
    assert.doesNotMatch(actionPicker, /<small>\{action\.id\}<\/small>/);
    assert.match(actionPicker, /<strong>\{action\.label\}<\/strong><\/button>/);
});

test("a narrow action row is centered below its wider conditional", () => {
    const source = readCodingSource();
    assert.match(source, /let childX = left \+ Math\.max\(0, \(width - descendantsWidth\) \/ 2\)/);
    assert.match(source, /Object\.entries\(current\)\.filter\(\(\[nodeId\]\) => !nodeId\.startsWith\(actionNodePrefix\)/);
    assert.match(source, /const conditionalOffset = current\[conditionNodeId\] \?\? \{ x: 0, y: 0 \}/);
    assert.match(source, /next\[actionGraphNodeId\(branch\.id, actionIndex, rootId\)\] = conditionalOffset/);
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
    assert.match(css, /grid-template-columns: 34px max-content 64px max-content 26px/);
    assert.match(css, /\.code-condition-input \{[\s\S]*width: max-content/);
    assert.match(css, /\.code-condition-input \{[\s\S]*min-width: 0/);
    assert.match(css, /\.code-condition-input\.is-raw \{ width: 110px; \}/);
    assert.match(source, /const leftWidth = 39 \+ leftLength \* 5\.5/);
    assert.match(source, /const rightWidth = condition\.right\?\.type === "variable" \? 39 \+ rightLength \* 5\.5 : 110/);
    assert.match(source, /return 175 \+ leftWidth \+ rightWidth/);
    assert.match(source, /GRAPH_NODE_WIDTH, 1200/);
});

test("conditional operand icon toggles replace literals and restore raw numbers", () => {
    const source = readCodingSource();

    assert.match(source, /function ConditionalOperandBox/);
    assert.match(source, /aria-label=\{`Use a variable for input \$\{operand\}`\}/);
    assert.match(source, /function VariableOperandPicker/);
    assert.match(source, /<input autoFocus value=\{query\}/);
    assert.match(source, /right: \{ type: "variable", value: definition\.id \}/);
    assert.match(source, /onClick=\{onPickVariable\}/);
    assert.match(source, /aria-label=\{`Use a raw number for input \$\{operand\}`\}/);
    assert.match(source, /right: \{ type: "number", value: 0 \}/);
    assert.match(source, /className="code-condition-input-toggle"/);
    assert.match(source, /onClick=\{onInspectVariable\}/);
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
    assert.match(source, /<DeferredNumberInput digitsOnly data-node-drag-ignore="true" aria-label=\{`Input \$\{operand\} number`\}/);
    assert.match(numberInput, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
    assert.match(css, /\.code-condition-input\.is-raw:focus-within/);
    assert.match(css, /\.code-condition-input > input,[\s\S]*caret-color: #fff;/);
    assert.match(css, /\.code-condition-input\.is-raw > input \{ caret-color: transparent; \}/);
});

test("clicking empty canvas space deselects an active raw input", () => {
    const source = readCodingSource();
    const clearFromSurface = source.slice(source.indexOf("const clearCanvasSelectionFromSurface"), source.indexOf("const selectGraphNode"));

    assert.match(clearFromSurface, /event\.target !== event\.currentTarget/);
    assert.match(clearFromSurface, /document\.activeElement\?\.closest\?\.\("\.code-condition-input\.is-raw"\)/);
    assert.match(clearFromSurface, /document\.activeElement\.blur\(\)/);
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

    assert.match(source, /const showAlways = operand === 1 && matches\("ALWAYS", "always"\);/);
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
    assert.match(source, /commitConfiguration\(\{ \.\.\.configuration, roots: insertParentLogicBranch\(roots, node\.rootIndex, node\.path, parent\) \}\)/);
    assert.match(source, /inheritNodeOffset\(conditionGraphNodeId\(parent\.id, node\.rootId\), node\.id\)/);
    assert.match(source, /onAddChildConditional=\{\(\) =>/);
    assert.match(source, /children: \[\.\.\.\(current\.children \?\? \[\]\), child\]/);
    assert.doesNotMatch(source, /siblingIndex === 0 \? "IF" : "ELSE IF"/);
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
    assert.match(source, /useExclusiveSearchMenu\(rootRef, open, \(\) => setOpen\(false\)\)/);
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
    assert.match(css, /grid-template-columns: 34px max-content 64px max-content 26px/);
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

test("condition comparator menus omit modulo", () => {
    const source = readCodingSource();

    assert.match(source, /candidate\.id !== "modulo" && candidate\.valueTypes/);
    assert.match(source, /comparator\.id !== "modulo" && comparator\.valueTypes/);
});

test("code graph has no standalone variable, target, or connection workflow", () => {
    const source = readCodingSource();

    assert.doesNotMatch(source, /Add variable node|Add target node|setConnecting|selectConnectionSource|variableTargetPortId|graphConnectionPath/);
    assert.doesNotMatch(source, /const editorGraph|editorGraph\.|connections\.map/);
    assert.match(source, /delete clean\.editorGraph/);
    assert.doesNotMatch(source, /code-condition-inline-config/);
});
