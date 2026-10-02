/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import { describeCondition, summarizeCondition } from "./conditionSummary.js";
import AddIcon from "../controls/AddIcon.jsx";
import { createPortal } from "react-dom";
import {
    ACTION_TYPES,
    SELECTABLE_TYPES,
    BOT_CODE_SELECTABLES,
    CONDITION_COMPARATORS,
    STATE_VARIABLES,
    VISIBLE_STATE_VARIABLES,
    actionExecutionHead,
    actionSupportsTarget,
    createLogicBlock as createConditional,
    createExpressionCondition,
    defaultSelectableForVariable,
    defaultSelectablePairForVariable,
    abilityDefinitionsForVariable,
    normalizeConditionSelections,
    CUSTOM_NUMBER_MIN,
    CUSTOM_NUMBER_MAX,
    NUMBER_STEP,
    truncateToNumberPrecision,
    CUSTOM_VARIABLE_OPERATIONS,
    VARIABLE_TAGS,
    VARIABLE_SELECTABLE_TYPES,
    TARGET_MODES,
    SELECTABLE_DEPENDENCIES,
    SELECTABLE_IDENTITIES,
    selectableMatchesVariable,
    BOT_CODE_ACTIONS,
    MAX_CONDITIONS_PER_BRANCH,
    MAX_LOGIC_BLOCKS,
    MAX_VARIABLE_ACTION_TERMS,
    MAX_ROOT_NAME_LENGTH,
    MAX_ROOT_NODES,
    countActionSlots,
    countConditionSlots,
    canonicalBotSelectableId,
} from "../../botlogic/code/BotCode.js";
import { absoluteMovementAngle, relativeMovementAngle } from "../../botlogic/planner/arenaAngles.js";
import { MOVEMENT_DIRECTION_MAX, MOVEMENT_DIRECTION_MIN, SELECTABLE_ORDERS, SELECTABLE_OWNERS } from "../../botlogic/code/contracts/BotLogicContracts.js";
import { normalizePriority, priorityForNode } from "../../botlogic/code/configuration/identifiers.js";
import { rightOperandView, rightPairUpdates } from "../../botlogic/code/runtime/conditionEvaluator.js";
import { actionTypesForLoadout } from "../../gameconfig/CombatLoadouts.js";
import { abilityIdFromBoundary } from "../../gameconfig/AbilityCompatibility.js";
import {
    ACTION_TO_ABILITY,
    STANDARD_ABILITY_IDS,
    decodeBotLoadout,
    decodeSandboxLoadout,
} from "../../loadout/BotLoadout.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { BOT_LOGIC_TREE_V1, BOT_LOGIC_TREE_VERSION, coordinateLimitsFor } from "../../botlogic/code/configuration/constants.js";
import { getAbilityCatalogueIcon } from "../../../abilityCatalogueIcons.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import ArenaDegreesCompass from "../../../components/ArenaDegreesCompass.jsx";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import { fallbackAbilityText } from "../../status/abilityStatusPresentation.js";
import { ACTION_HEAD_TONES, actionPickerDescription, actionPickerLabel, groupedActionPickerOptions, readRecentVariableIds, rememberVariableId, splitMatch, variableCategoryLabel, variableCategoryTone } from "./pickerSupport.js";
import MatchToolIcon from "../controls/MatchToolIcon.jsx";
import { VariableOperatorGlyph, VariableOperatorPicker } from "../controls/VariableOperatorGlyph.jsx";
import { variableOperatorPresentation } from "../controls/variableOperatorPresentation.js";
import {
    ACTION_NODE_HORIZONTAL_SPACE,
    actionSelectablePickerModel,
    encodeSelectableReplacement,
    resolveSelectableTarget,
    UNAVAILABLE_TARGET_LABEL,
    variableActionSummary,
} from "./actionNodePresentation.js";

function clampNumber(value, min, max, fallback, step = NUMBER_STEP, roundDown = false, integerOnly = false) {
    void roundDown;
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return text.startsWith("-") ? min : max;
    const bounded = Math.max(min, Math.min(max, numeric));
    return integerOnly || step >= 1 ? Math.trunc(bounded) : truncateToNumberPrecision(bounded);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function DeferredNumberInput({ value, onCommit, min = CUSTOM_NUMBER_MIN, max = CUSTOM_NUMBER_MAX, fallback = 0, step = NUMBER_STEP, roundDown = false, integerOnly = false, digitsOnly = false, className = "", ...props }) {
    const [draft, setDraft] = useState(String(value ?? fallback));
    const inputRef = useRef(null);
    const externalValueRef = useRef(String(value ?? fallback));
    const allowsNegative = Number(min) < 0;
    useEffect(() => {
        const nextValue = String(value ?? fallback);
        if (nextValue === externalValueRef.current) return;
        externalValueRef.current = nextValue;
        // Preserve the existing input-focused editing behavior while syncing external values.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (document.activeElement !== inputRef.current) setDraft(nextValue);
    }, [fallback, value]);
    const commit = () => {
        const normalized = clampNumber(draft, min, max, fallback, step, roundDown, integerOnly);
        setDraft(String(normalized));
        onCommit(normalized);
    };
    return <input {...props} ref={inputRef} type="text" inputMode={allowsNegative ? "text" : digitsOnly || integerOnly || step >= 1 ? "numeric" : "decimal"} pattern={digitsOnly ? "[0-9]*" : allowsNegative ? "-?[0-9]*[.]?[0-9]*" : undefined} value={draft} onChange={(event) => setDraft(digitsOnly ? event.target.value.replace(/[^0-9]/g, "") : event.target.value)} onClick={(event) => event.currentTarget.select()} onBlur={commit} onKeyDown={(event) => {
        if ((digitsOnly && event.key.length === 1 && !/[0-9]/.test(event.key)) || (integerOnly && [".", ",", "e", "E"].includes(event.key))) {
            event.preventDefault();
            return;
        }
        if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
    }} className={className} />;
}

const GRAPH_NODE_WIDTH = 340;
// Strip text column: node width minus border, strip padding, the 84px join
// column, grid gaps and the remove button. Character widths are deliberately generous.
const CONDITION_TEXT_WIDTH = 210;
const CONDITION_TEXT_GAP = 5;
const CONDITION_TEXT_CHAR_WIDTH = 7.6;
const CONDITION_CHIP_CHAR_WIDTH = 6.8;
const CONDITION_LINE_HEIGHT = 17;
const CONDITION_LINE_GAP = 3;
const CONDITION_STRIP_PADDING = 14;
const CONDITION_STRIP_HEIGHT = 30;
const CONDITION_BODY_HEIGHT = 46;
const ROOT_NODE_WIDTH = 260;
const GRAPH_NODE_GAP = 72;
const ROOT_NODE_HEIGHT = 84;

// Height of one condition strip. The strip's text is a wrapping flex row of
// separate items (subject, entity chips, comparator, value), so simulate that
// wrap: items that do not fit start a new line, and an oversized item wraps
// within itself. Shared by buildLogicGraph and the rendered strip so the edges
// meet the node; the strip itself only uses this as a minimum height.
function conditionStripHeight(summary) {
    if (!summary) return CONDITION_STRIP_HEIGHT;
    const items = [
        { text: summary.subject, charWidth: CONDITION_TEXT_CHAR_WIDTH, padding: 0 },
        ...(summary.entities ?? []).map((text) => ({ text, charWidth: CONDITION_CHIP_CHAR_WIDTH, padding: 10 })),
        { text: summary.comparator, charWidth: CONDITION_TEXT_CHAR_WIDTH, padding: 0 },
        { text: summary.value, charWidth: CONDITION_TEXT_CHAR_WIDTH, padding: 0 },
        ...(summary.valueEntities ?? []).map((text) => ({ text, charWidth: CONDITION_CHIP_CHAR_WIDTH, padding: 10 })),
    ].filter((item) => item.text);
    let lines = 1;
    let used = 0;
    for (const item of items) {
        const width = String(item.text).length * item.charWidth + item.padding;
        if (width > CONDITION_TEXT_WIDTH) {
            if (used > 0) lines += 1;
            const own = Math.ceil(width / CONDITION_TEXT_WIDTH);
            lines += own - 1;
            used = width - (own - 1) * CONDITION_TEXT_WIDTH;
        } else if (used > 0 && used + CONDITION_TEXT_GAP + width > CONDITION_TEXT_WIDTH) {
            lines += 1;
            used = width;
        } else {
            used += (used > 0 ? CONDITION_TEXT_GAP : 0) + width;
        }
    }
    return Math.max(CONDITION_STRIP_HEIGHT, CONDITION_STRIP_PADDING + lines * CONDITION_LINE_HEIGHT + (lines - 1) * CONDITION_LINE_GAP);
}

function RootNameInput({ value, disabled, ariaLabel, onCommit }) {
    const committedValue = String(value ?? "Root");
    const [draft, setDraft] = useState(committedValue);

    useEffect(() => {
        setDraft(committedValue);
    }, [committedValue]);

    return <input
        type="text"
        maxLength={MAX_ROOT_NAME_LENGTH}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        data-node-drag-ignore="true"
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.blur();
        }}
        className="code-root-name"
    />;
}

// Action cards are fixed-width text cards, like the condition strips.
const ACTION_NODE_WIDTH = 260;
const ACTION_CHARS_PER_LINE = 30;
const ACTION_LINE_HEIGHT = 18;

function actionNodeWidth() {
    return ACTION_NODE_WIDTH;
}

function actionNodeHeight(entry, selectedLoadout, stateVariables, actionWidth, selectableTypes, customVariables, coordinateVersion) {
    const definition = actionTypesForLoadout(ACTION_TYPES, selectedLoadout).find((action) => action.id === entry.action);
    const { label, chips, expression } = describeActionParts(entry, definition, selectableTypes, coordinateVersion, customVariables, stateVariables);
    const text = [label, ...chips, expression].filter(Boolean).join("  ");
    const lines = Math.max(1, Math.ceil(text.length / ACTION_CHARS_PER_LINE));
    return 52 + lines * ACTION_LINE_HEIGHT;
}

function buildLogicGraph(roots, stateVariables = VISIBLE_STATE_VARIABLES, selectedLoadout = null, selectableTypes = SELECTABLE_TYPES, coordinateVersion = BOT_LOGIC_TREE_VERSION, customVariables = []) {
    const graph = { roots: [], conditions: [], actions: [], variables: [], targets: [], edges: [], width: 0, height: 0 };
    let forestX = 80;
    const summaryLookups = conditionSummaryLookups(stateVariables, selectableTypes);
    const measureBranch = (branch) => {
        const actions = graphBranchActions(branch);
        const childWidth = (branch.children ?? []).reduce((sum, child) => sum + measureBranch(child), 0);
        const nodeWidth = GRAPH_NODE_WIDTH;
        const actionWidth = actions.reduce((sum, entry) => sum + actionNodeWidth(entry, selectedLoadout, selectableTypes, coordinateVersion, stateVariables, customVariables) + GRAPH_NODE_GAP, 0);
        return Math.max(nodeWidth + GRAPH_NODE_GAP, actionWidth + childWidth);
    };
    const measureLevel = (branches) => Math.max(GRAPH_NODE_WIDTH + GRAPH_NODE_GAP, (branches ?? []).reduce((sum, branch) => sum + measureBranch(branch), 0));
    const addBranch = (branch, rootIndex, rootId, path, left, y, parent) => {
        const width = measureBranch(branch);
        const actions = graphBranchActions(branch);
        const descendantsWidth = actions.reduce((sum, entry) => sum + actionNodeWidth(entry, selectedLoadout, selectableTypes, coordinateVersion, stateVariables, customVariables) + GRAPH_NODE_GAP, 0)
            + (branch.children ?? []).reduce((sum, child) => sum + measureBranch(child), 0);
        const branchConditions = Array.isArray(branch.conditions) ? branch.conditions : [];
        const stripsHeight = branch.branchType === "else" || branchConditions.length === 0
            ? CONDITION_STRIP_HEIGHT
            : branchConditions.reduce((sum, entry) => sum + conditionStripHeight(summarizeConditionForNode(entry, summaryLookups)), 0);
        const conditionHeight = stripsHeight + CONDITION_BODY_HEIGHT;
        const nodeWidth = GRAPH_NODE_WIDTH;
        const condition = { id: conditionGraphNodeId(branch.id, rootId), rootId, branchId: branch.id, rootIndex, path, x: left + width / 2 - nodeWidth / 2, y, width: nodeWidth, height: conditionHeight, priority: priorityForNode(branch, (path[path.length - 1] ?? 0) + 1) };
        graph.conditions.push(condition);
        graph.edges.push({ id: `${parent.id}->${condition.id}`, fromId: parent.id, toId: condition.id, x1: parent.x + parent.width / 2, y1: parent.y + parent.height, x2: condition.x + condition.width / 2, y2: condition.y });
        // Keep the action/child row centered under its conditional when the
        // conditional is wider than its descendants (notably a lone Walk).
        let childX = left + Math.max(0, (width - descendantsWidth) / 2);
        const childY = y + conditionHeight + 70;
        actions.forEach((entry, actionIndex) => {
            const actionWidth = actionNodeWidth(entry, selectedLoadout, selectableTypes, coordinateVersion, stateVariables, customVariables);
            const action = { id: actionGraphNodeId(branch.id, actionIndex, rootId), rootId, branchId: branch.id, rootIndex, path, actionIndex, x: childX + GRAPH_NODE_GAP / 2, y: childY, width: actionWidth, height: actionNodeHeight(entry, selectedLoadout, stateVariables, actionWidth, selectableTypes, customVariables, coordinateVersion) };
            graph.actions.push(action);
            graph.edges.push({ id: `${condition.id}->${action.id}`, fromId: condition.id, toId: action.id, x1: condition.x + condition.width / 2, y1: condition.y + condition.height, x2: action.x + action.width / 2, y2: action.y });
            childX += actionWidth + GRAPH_NODE_GAP;
        });
        (branch.children ?? []).forEach((child, childIndex) => {
            const childWidth = measureBranch(child);
            addBranch(child, rootIndex, rootId, [...path, childIndex], childX, childY, condition);
            childX += childWidth;
        });
        graph.height = Math.max(graph.height, childY + 230);
        return width;
    };
    roots.forEach((root, rootIndex) => {
        const rootId = String(root?.id || `root-${rootIndex + 1}`);
        const treeWidth = measureLevel(root.branches);
        const rootGraphNode = { id: `rootNode:${rootId}`, rootId, rootIndex, x: forestX + treeWidth / 2 - ROOT_NODE_WIDTH / 2, y: 50, width: ROOT_NODE_WIDTH, height: ROOT_NODE_HEIGHT };
        graph.roots.push(rootGraphNode);
        let branchX = forestX;
        (root.branches ?? []).forEach((branch, branchIndex) => {
            branchX += addBranch(branch, rootIndex, rootId, [branchIndex], branchX, 300, rootGraphNode);
        });
        forestX += treeWidth + 140;
    });
    graph.width = forestX + 100;
    graph.height = Math.max(graph.height, 900);
    return graph;
}

function graphNodeStyle(node, offsets) {
    const offset = offsets[node.id] ?? { x: 0, y: 0 };
    return { left: node.x + offset.x, top: node.y + offset.y };
}

function conditionGraphNodeId(branchId, rootId) {
    return `condition:${branchId}:root:${rootId}`;
}

function actionGraphNodeId(branchId, actionIndex, rootId) {
    return `action:${branchId}:${actionIndex}:root:${rootId}`;
}

// Execution-order badge shared by roots and conditionals. Order comes from
// left-to-right position among siblings. `mismatch` marks a sibling group whose
// layout disagrees with the stored order (older brains), which Tidy fixes
// without changing behavior.
function ExecutionOrderControls({ rank, label, mismatch = false }) {
    return <span className="code-order-controls" data-node-drag-ignore="true">
        <span className={`code-order-badge ${mismatch ? "is-mismatched" : ""}`} aria-label={`${label} runs ${rank}${mismatch ? "; layout does not match order" : ""}`} title={mismatch ? "The left-to-right layout of these siblings does not match their order. Drag one, or use Tidy." : `Runs ${rank} among its siblings`}>{rank}</span>
    </span>;
}

// Large arrow tabs sticking out of the top-left and top-right of a selected node;
// they swap the node with its neighbour so it runs earlier or later.
function OrderNudgeTabs({ label, selected, disabled, canNudgeBack = true, canNudgeForward = true, onNudge }) {
    if (!selected || !onNudge) return null;
    const tab = (direction, side, symbol, enabled, text) => <button type="button" data-node-drag-ignore="true" className={`code-order-tab code-order-tab--${side}`} disabled={disabled || !enabled} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onNudge(direction); }} aria-label={`Run ${label} ${text}`} title={`Run ${text} (move ${side})`}><span aria-hidden="true">{symbol}</span></button>;
    return <>
        {tab(-1, "left", "◀", canNudgeBack, "earlier")}
        {tab(1, "right", "▶", canNudgeForward, "later")}
    </>;
}

function puzzleRootLabel(kind) {
    if (kind === "win") return "WIN RULE";
    if (kind === "lose") return "LOSE RULE";
    return kind === "modify" ? "MODIFY" : "RULE";
}

function GraphRootNode({ node, rootNode, nodeOffsets, disabled, canRemove, puzzleMode = false, graphConditionCount = 0, maxTotalConditions = 0, selected = false, tutorialFocus, rank = null, siblingCount = 1, orderMismatch = false, onNudge = null, onSelect = () => {}, onPointerDown = () => {}, onNameChange = () => {}, onAddConditional = () => {}, onRemove = () => {} }) {
    const order = rank ?? priorityForNode(rootNode, node.rootIndex + 1);
    const label = `Root ${order}`;
    return <section
        onClick={onSelect}
        onPointerDown={onPointerDown}
        className={`code-graph-node code-graph-node--root code-bt-node code-bt-root ${puzzleMode && rootNode?.kind ? `code-bt-root--${rootNode.kind}` : ""} absolute ${selected ? "is-selected" : ""}`}
        style={{ ...graphNodeStyle(node, nodeOffsets), width: node.width }}
    >
        {!puzzleMode && <OrderNudgeTabs label={label} selected={selected} disabled={disabled} canNudgeBack={order > 1} canNudgeForward={order < siblingCount} onNudge={onNudge} />}
        <div className="code-bt-root-top">
            <span className="code-bt-root-label">{puzzleMode ? puzzleRootLabel(rootNode?.kind) : "ROOT"}</span>
            {puzzleMode
                ? <span className="code-bt-root-name code-root-name--puzzle" aria-label={`Name for ${label}`}>{rootNode?.name ?? "Puzzle Rule"}</span>
                : <RootNameInput value={rootNode?.name} disabled={disabled} ariaLabel={`Name for ${label}`} onCommit={onNameChange} />}
            {!puzzleMode && <ExecutionOrderControls rank={order} label={label} mismatch={orderMismatch} />}
            <button type="button" data-node-drag-ignore="true" disabled={!canRemove} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(event); }} className="code-bt-x" aria-label="Remove root" title="Remove root">×</button>
        </div>
        {!puzzleMode && <div className="code-bt-root-bottom">
            <button type="button" data-node-drag-ignore="true" aria-label="Add conditional" disabled={disabled || graphConditionCount >= maxTotalConditions} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => onAddConditional(event, node, rootNode)} className={`code-bt-add-conditional ${tutorialFocus === "add-condition" && !rootNode?.branches?.length ? "tutorial-control-focus" : ""}`}>+ Conditional</button>
        </div>}
    </section>;
}

function treeBranchAt(branches, path = []) {
    let branch = branches?.[path[0]];
    for (let index = 1; branch && index < path.length; index += 1) branch = branch.children?.[path[index]];
    return branch;
}

function mapBranchAt(branches, path, updater) {
    const [head, ...tail] = path;
    return (branches ?? []).map((branch, index) => {
        if (index !== head) return branch;
        if (!tail.length) return updater(branch);
        return { ...branch, children: mapBranchAt(branch.children, tail, updater) };
    });
}

function updateTreeBranch(roots, rootIndex, path, updater) {
    return roots.map((rootNode, index) => index === rootIndex ? { ...rootNode, branches: mapBranchAt(rootNode.branches, path, updater) } : rootNode);
}

function normalizeSiblingTypes(branches) {
    return branches.map((branch, index) => ({
        ...branch,
        branchType: index === 0 ? "if" : branch.branchType === "else" ? "else" : "if",
    }));
}

function graphBranchActions(branch) {
    if (Array.isArray(branch?.actions)) return branch.actions.filter((entry) => entry.action && entry.action !== "none");
    return branch?.action && branch.action !== "none" ? [{ action: branch.action, selectable: branch.selectable ?? BOT_CODE_SELECTABLES.OPPONENT }] : [];
}

function setGraphActions(branch, actions) {
    const first = actions[0] ?? { action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT };
    return { ...branch, actions, ...first };
}

function addGraphAction(branch, selectedLoadout, requestedAction = null, customVariables = []) {
    const actions = graphBranchActions(branch);
    const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
    const usedHeads = new Set(actions.map((entry) => actionTypes.find((action) => action.id === entry.action)).filter(Boolean).map(actionExecutionHead));
    const next = actionTypes.find((action) => action.id === requestedAction)
        ?? actionTypes.find((action) => action.id !== "none" && action.id !== "variable" && !usedHeads.has(actionExecutionHead(action)));
    if (!next || (next.id !== "variable" && usedHeads.has(actionExecutionHead(next)))) return branch;
    return setGraphActions(branch, [...actions, {
        action: next.id,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        ...(next.variableAction ? {
            variableId: customVariables[0]?.id ?? "",
            operation: "set",
            ...(customVariables[0]?.valueType === "boolean"
                ? { value: false }
                : { terms: [{ operator: "set", operand: { type: "number", value: 0 } }] }),
        } : {}),
    }]);
}

function prefersFinePointer() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
}

const BASE_ABILITY_ID_SET = new Set(STANDARD_ABILITY_IDS);

function PickerSearchIcon() {
    return <svg className="pk-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function PickerAbilityIcon({ abilityId, label }) {
    const iconPath = getAbilityCatalogueIcon(abilityId);
    const [imageFailed, setImageFailed] = useState(false);
    const showFallback = !iconPath || imageFailed;
    return <span className="pk-icon" aria-hidden="true">
        {showFallback && <span className="pk-icon__text">{fallbackAbilityText(abilityId, label)}</span>}
        {iconPath && !imageFailed && <img src={iconPath} alt="" onError={() => setImageFailed(true)} />}
    </span>;
}

function PickerHints({ verb }) {
    return <span className="pk-hints"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> {verb} <kbd>esc</kbd></span>;
}

function NodeKindPicker({ selectedLoadout, onCancel, onChooseAction, title = "Add action" }) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);
    const pickerRef = useRef(null);
    const searchInputRef = useRef(null);
    const optionRefs = useRef([]);
    useExclusiveSearchMenu(pickerRef, true, onCancel);
    useEffect(() => {
        // Touch screens: opening the keyboard zooms the page, so only focus with a mouse.
        if (!prefersFinePointer()) return;
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, []);
    const actionOptions = actionTypesForLoadout(ACTION_TYPES, selectedLoadout).filter((action) => action.id !== "none");
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchingActions = actionOptions.filter((action) => !normalizedQuery || `${action.label} ${action.id}`.toLocaleLowerCase().includes(normalizedQuery));
    const groupedActions = groupedActionPickerOptions(matchingActions);
    // Keyboard navigation walks the rows in the order they are drawn.
    const filteredActions = groupedActions.flatMap((group) => group.options);
    const moveFromSearch = (event) => {
        if (event.key === "Enter" && filteredActions.length) {
            event.preventDefault();
            onChooseAction(filteredActions[0].id);
            return;
        }
        if (event.key !== "ArrowDown" || !filteredActions.length) return;
        event.preventDefault();
        setActiveIndex(0);
        optionRefs.current[0]?.focus();
    };
    const moveFromOption = (event, index) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (index + 1) % filteredActions.length;
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (index === 0) {
                setActiveIndex(-1);
                searchInputRef.current?.focus();
                return;
            }
            const nextIndex = index - 1;
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const action = filteredActions[index];
            if (action) onChooseAction(action.id);
        }
    };
    return <div ref={pickerRef} className="pk pk--action" role="dialog" aria-label={title} data-node-drag-ignore="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="pk-search"><label className="pk-search__field"><PickerSearchIcon /><span className="sr-only">Search actions</span><input ref={searchInputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); optionRefs.current = []; }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } else moveFromSearch(event); }} placeholder="Search actions…" /></label><button type="button" className="pk-close" aria-label="Close" title="Close" onClick={onCancel}>×</button></div>
        <div className="pk-list">{groupedActions.map((group) => <section className={`pk-group pk-tone--${ACTION_HEAD_TONES[group.head] ?? "neutral"}`} data-category={group.head} key={group.head}>
            <h3 className="pk-group-title"><span>{group.title}</span><span className="pk-group-hint">{group.hint ?? group.options.length}</span></h3>
            {group.options.map((action) => {
                const index = filteredActions.indexOf(action);
                const isAbility = action.head === "ability";
                const label = actionPickerLabel(action);
                const description = actionPickerDescription(action);
                return <button ref={(element) => { optionRefs.current[index] = element; }} key={action.id} tabIndex={index === activeIndex ? 0 : -1} className={`pk-row ${index === activeIndex ? "is-active" : ""}`} type="button" onKeyDown={(event) => moveFromOption(event, index)} onClick={() => onChooseAction(action.id)}>
                    {isAbility && <PickerAbilityIcon abilityId={action.abilityId} label={label} />}
                    <span className="pk-row__text"><strong className="pk-row__name">{label}</strong>{description && <small className="pk-row__desc">{description}</small>}</span>
                    {isAbility && BASE_ABILITY_ID_SET.has(action.abilityId) && <span className="pk-tag pk-tag--base">Base</span>}
                </button>;
            })}
        </section>)}{!filteredActions.length && <p className="pk-empty">No actions match “{query}”.</p>}</div>
        <div className="pk-footer"><PickerHints verb={title.startsWith("Add") ? "add" : "choose"} /></div>
    </div>;
}

function VariableOperandPicker({ operand, stateVariables, numericOnly = false, valueType = null, onChoose, onUseRawNumber = null, onClose }) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [activeIndex, setActiveIndex] = useState(-1);
    const [recentIds] = useState(readRecentVariableIds);
    const pickerRef = useRef(null);
    const searchInputRef = useRef(null);
    const optionRefs = useRef([]);
    useExclusiveSearchMenu(pickerRef, true, onClose);
    useEffect(() => {
        // Touch screens: opening the keyboard zooms the page, so only focus with a mouse.
        if (!prefersFinePointer()) return;
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, []);
    const normalized = query.trim().toLocaleLowerCase();
    const compatibleDefinitions = stateVariables.filter((variable) => valueType
        ? variable.valueType === valueType
        : (!numericOnly && operand !== 2 || variable.valueType === "number"));
    const matches = (label, id) => !normalized || `${label} ${id}`.toLocaleLowerCase().includes(normalized);
    const showAlways = operand === 1 && !numericOnly && !valueType;
    const availableCategories = groupedConditionPickerOptions(compatibleDefinitions).map((group) => group.category);
    const activeCategory = availableCategories.includes(category) ? category : "all";
    const definitions = compatibleDefinitions.filter((definition) => matches(definition.label, definition.id)
        && (activeCategory === "all" || conditionPickerCategory(definition) === activeCategory));
    const groupedDefinitions = groupedConditionPickerOptions(definitions);
    const recentDefinitions = recentIds
        .map((id) => definitions.find((definition) => definition.id === id))
        .filter(Boolean);
    const sections = [
        ...(recentDefinitions.length ? [{ key: "recent", title: "Recently used", tone: "neutral", options: recentDefinitions }] : []),
        ...groupedDefinitions.map((group) => ({ key: group.category, title: variableCategoryLabel(group.category).title, tone: variableCategoryTone(group.category), options: group.options })),
    ];
    // Keyboard navigation walks the rows in the order they are drawn.
    const rows = sections.flatMap((section) => section.options.map((definition) => ({ section: section.key, definition })));
    const choose = (id) => {
        rememberVariableId(id);
        onChoose(id);
    };
    const moveFromSearch = (event) => {
        if (event.key === "Enter" && rows.length) {
            event.preventDefault();
            choose(rows[0].definition.id);
            return;
        }
        if (event.key !== "ArrowDown" || !rows.length) return;
        event.preventDefault();
        setActiveIndex(0);
        optionRefs.current[0]?.focus();
    };
    const moveFromOption = (event, index) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (index + 1) % rows.length;
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (index === 0) {
                setActiveIndex(-1);
                searchInputRef.current?.focus();
                return;
            }
            const nextIndex = index - 1;
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const row = rows[index];
            if (row) choose(row.definition.id);
        }
    };
    const title = "Add variable";
    let rowIndex = -1;
    return <div ref={pickerRef} className="pk pk--variable" role="dialog" aria-label={title} data-node-drag-ignore="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="pk-search"><label className="pk-search__field"><PickerSearchIcon /><span className="sr-only">Search variables</span><input ref={searchInputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); optionRefs.current = []; }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } else moveFromSearch(event); }} placeholder="Search variables…" /></label><button type="button" className="pk-close" aria-label="Close" title="Close" onClick={onClose}>×</button></div>
        {availableCategories.length > 1 && <div className="pk-chips" role="group" aria-label="Variable categories">
            {["all", ...availableCategories].map((id) => <button key={id} type="button" className={`pk-chip ${id === activeCategory ? "is-active" : ""}`} aria-pressed={id === activeCategory} onClick={() => { setCategory(id); setActiveIndex(-1); optionRefs.current = []; }}>{id === "all" ? "All" : variableCategoryLabel(id).chip}</button>)}
        </div>}
        <div className="pk-list">{sections.map((section) => <section className={`pk-group pk-tone--${section.tone}`} data-category={section.key} key={section.key}>
            <h3 className="pk-group-title"><span>{section.title}</span><span className="pk-group-hint">{section.options.length}</span></h3>
            {section.options.map((definition) => {
                rowIndex += 1;
                const index = rowIndex;
                const description = definition.description || (String(definition.id).startsWith("custom.") ? "Your custom variable" : "");
                const isBoolean = definition.valueType === "boolean";
                return <button ref={(element) => { optionRefs.current[index] = element; }} key={`${section.key}:${definition.id}`} tabIndex={index === activeIndex ? 0 : -1} className={`pk-row ${index === activeIndex ? "is-active" : ""}`} type="button" onKeyDown={(event) => moveFromOption(event, index)} onClick={() => choose(definition.id)}>
                    <span className="pk-row__text"><strong className="pk-row__name">{splitMatch(definition.label, query).map((part, partIndex) => part.match ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>)}</strong>{description && <small className="pk-row__desc">{description}</small>}</span>
                    <span className={`pk-tag ${isBoolean ? "pk-tag--boolean" : "pk-tag--number"}`}>{isBoolean ? "True/false" : "Number"}</span>
                </button>;
            })}
        </section>)}{!definitions.length && <p className="pk-empty">No variables match “{query}”.</p>}</div>
        <div className="pk-footer">
            <PickerHints verb="choose" />
            {operand === 2 && onUseRawNumber && <button type="button" className="pk-footer-button" onClick={onUseRawNumber}>Raw input</button>}
            {showAlways && <button type="button" className="pk-footer-button" onClick={() => onChoose("always")} title="Always (no condition)">Always</button>}
        </div>
    </div>;
}

function SelectableToken({ value, selectableTypes = SELECTABLE_TYPES }) {
    const presentation = resolveSelectableTarget(value, selectableTypes);
    if (!presentation.available) {
        return <span className="code-config-token code-config-token--unavailable" title={presentation.tooltip} aria-label={presentation.description}>{UNAVAILABLE_TARGET_LABEL}</span>;
    }
    if (presentation.kind === "entity") {
        return <span className="code-config-entity-signature" title={presentation.tooltip} aria-label={presentation.description}>
            <AbilityToken abilityId={presentation.definition.abilityId} label={presentation.abilityLabel} />
            {presentation.ownerLabel && <span className={`code-config-token code-config-token--${presentation.ownerTone}`}>{presentation.ownerLabel}</span>}
            <span className="code-config-token code-config-token--order"><span aria-hidden="true">{presentation.orderBadge[0]}</span>{presentation.ordinal}</span>
        </span>;
    }
    const side = presentation.ownerTone;
    return <span className={`code-config-token code-config-token--${side}`} title={presentation.tooltip} aria-label={presentation.description}>
        {presentation.orderBadge && <span className="code-config-token-order"><span aria-hidden="true">{presentation.orderBadge[0]}</span>{presentation.ordinal}</span>}
        {presentation.compactLabel}
    </span>;
}

function coordinateCenter(version) {
    return version === BOT_LOGIC_TREE_V1 ? ARENA_WIDTH_UNITS / 2 : 0;
}

function CoordinateToken({ x, y, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    void coordinateVersion;
    return <span className="code-config-token code-config-token--coordinate"><span aria-hidden="true">⌖</span>{Number(x)}, {Number(y)}</span>;
}

function AngleToken({ value, absolute = false }) {
    return <span className={`code-config-token code-config-token--angle ${absolute ? "is-absolute" : ""}`} title={absolute ? "Absolute arena angle" : "Angle relative to target"}><span aria-hidden="true">↟</span>{Number(value) || 0}°</span>;
}

function AbilityToken({ abilityId, label = "Ability" }) {
    const iconPath = getAbilityCatalogueIcon(abilityId);
    return iconPath ? <span className="code-config-ability" title={label}><img src={iconPath} alt="" aria-hidden="true" /></span> : null;
}

function VariableConfigurationSignature({ definition, condition: sourceCondition, operand, selectableTypes = SELECTABLE_TYPES, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    if (!definition) return null;
    const condition = operand === 2 && definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR ? rightOperandView(sourceCondition) : sourceCondition;
    const parts = [];
    if (definition.supportsAbility && condition.ability != null) {
        const ability = definition.abilityOptions?.find((candidate) => String(candidate.id) === String(condition.ability));
        parts.push(<AbilityToken key="ability" abilityId={condition.ability} label={ability?.label ?? "Selected ability"} />);
    }
    if (definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
        const defaults = defaultSelectablePairForVariable(definition, selectableTypes);
        parts.push(<SelectableToken key="first" value={condition.selectable1 ?? defaults[0]} selectableTypes={selectableTypes} />);
        parts.push(<span key="arrow" className="code-config-relation" aria-hidden="true">→</span>);
        const mode = conditionTargetMode(condition, definition);
        if (mode === TARGET_MODES.COORDINATES) parts.push(<CoordinateToken key="coordinates" x={condition.targetX ?? coordinateCenter(coordinateVersion)} y={condition.targetY ?? coordinateCenter(coordinateVersion)} coordinateVersion={coordinateVersion} />);
        else if (mode === TARGET_MODES.ANGLE) parts.push(<AngleToken key="angle" value={condition.targetAngle ?? 0} absolute />);
        else parts.push(<SelectableToken key="second" value={condition.selectable2 ?? condition.selectable ?? defaults[1]} selectableTypes={selectableTypes} />);
    } else if (definition.supportsSelectable) {
        const field = operand === 1 ? "leftSelectable" : "rightSelectable";
        parts.push(<SelectableToken key="entity" value={condition[field] ?? defaultSelectableForVariable(definition, selectableTypes)} selectableTypes={selectableTypes} />);
    }
    return parts.length ? <span className="code-variable-signature">{parts}</span> : null;
}

function ConditionalOperandBox({ operand, condition, stateVariables, selectableTypes = SELECTABLE_TYPES, disabled, selected, onPickVariable, onInspectVariable, onOpenVariablePicker, onNumberChange, onBooleanChange, numberDefinition = null, tutorialFocus = false, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    const variableDefinition = operand === 1
        ? stateVariables.find((variable) => variable.id === condition.left)
            ?? STATE_VARIABLES.find((variable) => variable.id === condition.left)
        : condition.right?.type === "variable"
            ? stateVariables.find((variable) => variable.id === condition.right.value)
                ?? STATE_VARIABLES.find((variable) => variable.id === condition.right.value)
            : null;
    const variableLabel = variableDefinition?.label;
    const rawBoolean = operand === 2 && condition.right?.type === "boolean";
    const rawNumber = operand === 2 && condition.right?.type === "number";
    const numberSuffix = numberDefinition?.suffix;
    const signedNumber = Number(numberDefinition?.min) < 0
        || numberSuffix === "deg"
        || numberDefinition?.tags?.includes(VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER);
    const numberStep = numberDefinition?.step ?? NUMBER_STEP;
    const integerNumber = numberStep >= 1;
    return <div className={`code-condition-input ${variableLabel ? "is-variable" : "is-raw"} ${tutorialFocus ? "tutorial-control-focus" : ""}`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        {variableLabel ? <button type="button" className={`code-condition-input-value ${selected ? "is-selected" : ""}`} onClick={onOpenVariablePicker ?? onInspectVariable} aria-label={`Configure ${variableLabel}`}><span className="code-condition-input-copy"><span className="code-condition-input-label">{variableLabel}{operand === 2 && variableDefinition.suffix && <span className="code-condition-input-unit">{variableDefinition.suffix}</span>}</span><VariableConfigurationSignature definition={variableDefinition} condition={condition} operand={operand} selectableTypes={selectableTypes} coordinateVersion={coordinateVersion} /></span></button>
            : rawBoolean ? <select data-node-drag-ignore="true" aria-label={`Input ${operand} boolean value`} disabled={disabled} value={String(condition.right.value)} onChange={(event) => onBooleanChange(event.target.value === "true")} className="code-operator-socket code-condition-boolean-input"><option value="true">TRUE</option><option value="false">FALSE</option></select>
            : rawNumber ? <><DeferredNumberInput digitsOnly={integerNumber && !signedNumber} integerOnly={integerNumber} data-node-drag-ignore="true" aria-label={`Input ${operand} number`} disabled={disabled} min={numberDefinition?.min ?? CUSTOM_NUMBER_MIN} max={numberDefinition?.max ?? CUSTOM_NUMBER_MAX} step={numberStep} value={condition.right.value} onCommit={onNumberChange} />{numberSuffix && <span className="code-condition-input-unit">{numberSuffix}</span>}</>
            : <span className="code-condition-input-placeholder">INPUT {operand}</span>}
        <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onPickVariable} aria-label={`Edit input ${operand}`} title="Edit input"><span aria-hidden="true">✎</span></button>
    </div>;
}

const ACTION_CHANNEL_LABELS = Object.freeze({ movement: "MOVE", rotation: "TURN", ability: "ABILITY", variable: "VARIABLE" });

// Variable names on conditional nodes are capped so a strip stays compact; the
// full sentence is still in the strip tooltip and the config panel.
const CONDITION_NODE_LABEL_LIMIT = 20;

function truncateNodeLabel(text) {
    const value = String(text ?? "");
    return value.length > CONDITION_NODE_LABEL_LIMIT ? `${value.slice(0, CONDITION_NODE_LABEL_LIMIT - 1).trimEnd()}…` : value;
}

function summarizeConditionForNode(condition, lookups) {
    const summary = summarizeCondition(condition, lookups);
    return { ...summary, subject: truncateNodeLabel(summary.subject), value: truncateNodeLabel(summary.value) };
}

function conditionSummaryLookups(stateVariables, selectableTypes) {
    const abilityLabel = (id) => {
        for (const variable of stateVariables ?? []) {
            const option = (variable.abilityOptions ?? []).find((ability) => ability.id === id);
            if (option) return option.label;
        }
        return String(id ?? "Ability");
    };
    return {
        variable: (id) => (stateVariables ?? []).find((variable) => variable.id === id)
            ?? STATE_VARIABLES.find((variable) => variable.id === id)
            ?? null,
        selectable: (id) => formatSelectableLabel(id, selectableTypes),
        ability: abilityLabel,
    };
}

function actionCountLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

// "1 action", "2 actions · 1 branch", "no actions"; zero branches are omitted.
function conditionalCountText(actionCount, childCount) {
    if (actionCount === 0 && childCount === 0) return "no actions";
    const parts = [];
    if (actionCount > 0) parts.push(actionCountLabel(actionCount, "action"));
    if (childCount > 0) parts.push(actionCountLabel(childCount, "branch", "branches"));
    return parts.join(" · ");
}

// Compact, read-only conditional: one decorator strip per condition row and a
// body row holding the title, counts, order controls and the "+" menu. All
// editing happens in the side panel.
function CompactConditionNode({ node, branch, disabled, canRemove, canAddAction, canAddCondition, maxConditions = MAX_CONDITIONS_PER_BRANCH, stateVariables, defaultVariable, selectableTypes, nodeOffsets, beginNodeDrag, selected, puzzleMode = false, puzzleLabel = "Conditional", rank = null, siblingCount = 1, orderMismatch = false, onNudge = null, onSelect, onRemoveCondition, onChange, onRemove, onAddChildConditional, onAddAction, onEditCondition, activeConditionIndex = null, tutorialFocus }) {
    const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
    const isElse = branch.branchType === "else";
    const [menuOpen, setMenuOpen] = useState(false);
    const rootRef = useRef(null);
    const lookups = conditionSummaryLookups(stateVariables, selectableTypes);
    const order = rank ?? priorityForNode(branch, (node.path?.[node.path.length - 1] ?? 0) + 1);
    const kindWord = puzzleMode ? "IF" : conditionalKindLabel(branch, order);
    const actionCount = graphBranchActions(branch).length;
    const childCount = (branch.children ?? []).length;
    const addCondition = () => onChange({ conditions: [...conditions, createExpressionCondition(defaultVariable, selectableTypes)] });
    const title = puzzleMode ? puzzleLabel : "Conditional";
    const addActionFocus = tutorialFocus === "add-action" && actionCount === 0;
    // Puzzle conditionals only take conditions, so they get no child / action plus.
    const hideAddBelow = puzzleMode;
    const canAddJoined = !disabled && canAddCondition && conditions.length < maxConditions;

    useEffect(() => {
        if (!menuOpen) return undefined;
        const onPointerDown = (event) => { if (!rootRef.current?.contains(event.target)) setMenuOpen(false); };
        const onKeyDown = (event) => { if (event.key === "Escape") setMenuOpen(false); };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [menuOpen]);

    const stopDrag = (event) => event.stopPropagation();
    const menuItem = (label, onActivate, itemDisabled = false) => <button type="button" role="menuitem" data-node-drag-ignore="true" className="code-bt-menu-item" disabled={itemDisabled} onPointerDown={stopDrag} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onActivate(); }}>{label}</button>;
    const strips = isElse
        ? [{ key: "else", body: <span className="code-bt-strip-muted">Otherwise</span>, muted: true }]
        : conditions.length === 0
            ? [{ key: "always", body: <span className="code-bt-subject">Always</span> }]
            : conditions.map((condition, index) => {
                const summary = summarizeConditionForNode(condition, lookups);
                return {
                    key: `${index}-${condition.type}`,
                    index,
                                        title: describeCondition(condition, lookups),
                    height: conditionStripHeight(summary),
                    body: <>
                            <span className="code-bt-subject">{summary.subject}</span>
                        {summary.entities.map((entity, entityIndex) => <span className="code-bt-entity" key={entityIndex}>{entity}</span>)}
                        {summary.comparator && <span className="code-bt-comparator">{summary.comparator}</span>}
                        {summary.value && <span className="code-bt-value">{summary.value}</span>}
                        {summary.valueEntities.map((entity, entityIndex) => <span className="code-bt-entity" key={`value-${entityIndex}`}>{entity}</span>)}
                    </>,
                };
            });

    return <section ref={rootRef} onClick={onSelect} onPointerDown={(event) => beginNodeDrag(event, node.id)} className={`code-graph-node code-graph-node--conditional code-bt-node code-bt-cond ${menuOpen ? "is-menu-open" : ""} absolute ${selected ? "is-inspected" : ""}`} style={{ ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <span className="code-bt-kind-tab">{kindWord}</span>
        <OrderNudgeTabs label={`Conditional ${order}`} selected={selected} disabled={disabled} canNudgeBack={!isElse && order > 1} canNudgeForward={!isElse && order < siblingCount} onNudge={onNudge} />
        {strips.map((strip, stripPosition) => <div key={strip.key} className={`code-bt-strip ${strip.muted ? "is-else" : ""} ${strip.index != null && onEditCondition && selected ? "is-clickable" : ""} ${strip.index != null && activeConditionIndex === strip.index ? "is-active" : ""} ${tutorialFocus === "add-condition" && stripPosition === 0 ? "tutorial-control-focus" : ""}`} title={strip.title} onClick={strip.index != null && onEditCondition && selected ? (event) => onEditCondition(event, strip.index) : undefined} style={strip.height ? { minHeight: strip.height } : undefined}>
            <span className="code-bt-strip-text">{strip.body}</span>
            {strip.index != null && !disabled && <button type="button" data-node-drag-ignore="true" className="code-bt-x" onPointerDown={stopDrag} onClick={(event) => { event.stopPropagation(); onRemoveCondition(strip.index); }} aria-label={`Remove condition ${strip.index + 1}`} title="Remove condition">×</button>}
        </div>)}
        {selected && !isElse && !disabled && <div className="code-bt-add-condition" data-node-drag-ignore="true"><button type="button" data-node-drag-ignore="true" className="code-bt-add-condition-button" disabled={!canAddJoined} onPointerDown={stopDrag} onClick={(event) => { event.stopPropagation(); addCondition(); }} aria-label="Add condition" title="Add a condition">+</button></div>}
        <div className="code-bt-body">
            <span className="code-bt-title">{title}</span>
            {!puzzleMode && <span className="code-bt-count">{conditionalCountText(actionCount, childCount)}</span>}
            <ExecutionOrderControls rank={order} label={`Conditional ${order}`} mismatch={orderMismatch} />
            <span className="code-bt-body-actions">
                <button type="button" data-node-drag-ignore="true" className="code-bt-x" disabled={!canRemove || disabled} onPointerDown={stopDrag} onClick={(event) => { event.stopPropagation(); onRemove(); }} aria-label="Remove conditional node" title="Remove conditional node">×</button>
            </span>
        </div>
        {selected && !hideAddBelow && <div className="code-bt-add-below" data-node-drag-ignore="true">
            <button type="button" data-node-drag-ignore="true" className={`code-bt-plus ${addActionFocus ? "tutorial-control-focus" : ""}`} aria-label="Add to conditional" aria-haspopup="menu" aria-expanded={menuOpen} disabled={disabled} onPointerDown={stopDrag} onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}>+</button>
            {menuOpen && <div className="code-bt-menu" role="menu" data-node-drag-ignore="true" onPointerDown={stopDrag} onClick={(event) => event.stopPropagation()}>
                {menuItem("Add conditional", () => onAddChildConditional(), disabled || !canAddCondition)}
                {menuItem("Add action", () => onAddAction(), disabled || !canAddAction)}
            </div>}
        </div>}
    </section>;
}

function GraphConditionNode({ node, branch, disabled, canRemove, canAddAction, canAddCondition, maxConditions = MAX_CONDITIONS_PER_BRANCH, stateVariables, defaultVariable, selectableTypes, nodeOffsets, beginNodeDrag, selected, standalone = false, puzzleMode = false, puzzleLabel = "Conditional", rank = null, siblingCount = 1, orderMismatch = false, onNudge = null, onSelect, onPickVariable, onOpenVariablePicker, onInspectVariable, onRemoveCondition, onEditCondition, activeConditionIndex, inspectedVariable, onChange, onRemove, onAddChildConditional, onAddAction, tutorialFocus, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
    const updateCondition = (rowIndex, updater) => onChange({ conditions: conditions.map((condition, index) => index === rowIndex ? updater(condition) : condition) });
    const toggleConditionJoin = (rowIndex) => updateCondition(rowIndex, (current) => {
        if (current.join !== "or") return { ...current, join: "or" };
        const next = { ...current };
        delete next.join;
        return next;
    });
    const addJoinedCondition = (join) => onChange({ conditions: [...conditions, { ...createExpressionCondition(defaultVariable, selectableTypes), ...(join === "or" ? { join: "or" } : {}) }] });
    if (!standalone) return <CompactConditionNode {...{ node, branch, disabled, canRemove, canAddAction, canAddCondition, maxConditions, stateVariables, defaultVariable, selectableTypes, nodeOffsets, beginNodeDrag, selected, puzzleMode, puzzleLabel, rank, siblingCount, orderMismatch, onNudge, onSelect, onRemoveCondition, onChange, onRemove, onAddChildConditional, onAddAction, onEditCondition, activeConditionIndex, tutorialFocus }} />;
    return <section onClick={onSelect} onPointerDown={(event) => { if (!standalone) beginNodeDrag(event, node.id); }} className={`code-graph-node code-graph-node--conditional ${standalone ? "relative w-full" : "absolute"} rounded-sm border bg-zinc-950 shadow-2xl ${selected ? "is-inspected" : ""}`} style={standalone ? { width: "100%" } : { ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <header className="code-compact-header code-node-header--conditional">
            {standalone || puzzleMode ? <span className="min-w-0 flex-1 truncate text-sky-100">{puzzleLabel}</span> : <><span className="code-node-badge">{node.path.length}</span><span className="min-w-0 flex flex-1 items-center gap-1 truncate text-sky-100">{<span className={`code-branch-kind ${branch.branchType === "else" ? "is-else" : ""}`}>{conditionalKindLabel(branch, rank ?? priorityForNode(branch, (node.path[node.path.length - 1] ?? 0) + 1))}</span>} <ExecutionOrderControls rank={rank ?? priorityForNode(branch, (node.path[node.path.length - 1] ?? 0) + 1)} label={`Conditional ${rank ?? priorityForNode(branch, (node.path[node.path.length - 1] ?? 0) + 1)}`} selected={selected} disabled={disabled} mismatch={orderMismatch} canNudgeBack={branch.branchType !== "else" && (rank ?? 1) > 1} canNudgeForward={branch.branchType !== "else" && (rank ?? 1) < siblingCount} onNudge={onNudge} /></span></>}
        </header>
        <><div className="space-y-2 p-3">
            {conditions.map((condition, index) => {
                const leftDefinition = stateVariables.find((variable) => variable.id === condition.left)
                    ?? STATE_VARIABLES.find((variable) => variable.id === condition.left)
                    ?? defaultVariable;
                const comparators = CONDITION_COMPARATORS.filter((candidate) => candidate.valueTypes.includes(leftDefinition.valueType));
                const comparator = comparators.some((candidate) => candidate.id === condition.comparator) ? condition.comparator : comparators[0]?.id ?? "eq";
                return <div key={`${index}-${condition.type}`} className="code-compact-condition-wrap">
                    <div className="code-compact-condition">
                    {index === 0
                        ? <span data-node-drag-ignore="true" className="code-condition-prefix font-mono text-[9px] text-amber-200">IF</span>
                        : <button type="button" data-node-drag-ignore="true" disabled={disabled} className="code-condition-prefix code-condition-join-toggle font-mono text-[9px] text-amber-200" aria-label={`Change ${condition.join === "or" ? "OR" : "AND"} to ${condition.join === "or" ? "AND" : "OR"}`} title="Toggle AND / OR" onClick={(event) => { event.stopPropagation(); toggleConditionJoin(index); }}>{condition.join === "or" ? "OR" : "AND"}</button>}
                    {condition.type === "always" ? <div className="code-condition-input is-variable col-span-3" data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><button type="button" className="code-condition-input-value" disabled={disabled} onClick={() => onPickVariable(index, 1)} aria-label={`Configure ALWAYS for condition ${index + 1}`}><span className="code-condition-input-copy"><span className="code-condition-input-label">ALWAYS</span></span></button><button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={() => onPickVariable(index, 1)} aria-label={`Edit input 1 for condition ${index + 1}`} title="Edit input"><span aria-hidden="true">✎</span></button></div> : <><ConditionalOperandBox operand={1} condition={condition} stateVariables={stateVariables} selectableTypes={selectableTypes} disabled={disabled} selected={inspectedVariable?.rowIndex === index && inspectedVariable?.operand === 1} onPickVariable={() => onPickVariable(index, 1)} onOpenVariablePicker={onOpenVariablePicker ? () => onOpenVariablePicker(index, 1) : null} onInspectVariable={() => onInspectVariable(index, 1)} tutorialFocus={tutorialFocus === "add-condition" && index === 0} coordinateVersion={coordinateVersion} /><select data-node-drag-ignore="true" aria-label="Comparator" disabled={disabled} value={comparator} onClick={(event) => event.stopPropagation()} onChange={(event) => updateCondition(index, (current) => ({ ...current, comparator: event.target.value }))} className="code-operator-socket">{comparators.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select><ConditionalOperandBox operand={2} condition={condition} stateVariables={stateVariables} selectableTypes={selectableTypes} numberDefinition={leftDefinition} disabled={disabled} selected={inspectedVariable?.rowIndex === index && inspectedVariable?.operand === 2} onPickVariable={() => onPickVariable(index, 2)} onOpenVariablePicker={onOpenVariablePicker ? () => onOpenVariablePicker(index, 2) : null} onInspectVariable={() => onInspectVariable(index, 2)} onNumberChange={(value) => updateCondition(index, (current) => ({ ...current, right: { type: "number", value } }))} onBooleanChange={(value) => updateCondition(index, (current) => ({ ...current, right: { type: "boolean", value } }))} coordinateVersion={coordinateVersion} /></>}
                    <button type="button" data-node-drag-ignore="true" className="code-condition-row-remove" disabled={disabled} onClick={(event) => { event.stopPropagation(); onRemoveCondition(index); }} aria-label={`Remove condition ${index + 1}`} title="Remove condition">×</button>
                    </div>
                </div>;
            })}
        </div>
        <footer className="code-compact-footer">
            <button type="button" data-node-drag-ignore="true" aria-label="Add AND condition" disabled={disabled || !canAddCondition || conditions.length >= maxConditions} onClick={(event) => { event.stopPropagation(); addJoinedCondition("and"); }}><AddIcon /> AND</button>
            <button type="button" data-node-drag-ignore="true" aria-label="Add OR condition" disabled={disabled || !canAddCondition || conditions.length >= maxConditions} onClick={(event) => { event.stopPropagation(); addJoinedCondition("or"); }}><AddIcon /> OR</button>
            {!standalone && !puzzleMode && <><button type="button" data-node-drag-ignore="true" aria-label="Add IF child conditional" className="code-conditional-add-button" disabled={disabled || !canAddCondition} onClick={(event) => { event.stopPropagation(); onAddChildConditional(); }}><AddIcon /> IF</button>
                <button type="button" data-node-drag-ignore="true" aria-label="Add action" className={`code-action-add-button ${tutorialFocus === "add-action" && !graphBranchActions(branch).length ? "tutorial-control-focus" : ""}`} disabled={disabled || !canAddAction} onClick={(event) => { event.stopPropagation(); onAddAction(); }}><AddIcon /> ACTION</button>
                <button type="button" data-node-drag-ignore="true" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-condition-node-remove" aria-label="Remove conditional node" title="Remove conditional node">×</button></>}
            {!standalone && puzzleMode && <button type="button" data-node-drag-ignore="true" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-condition-node-remove" aria-label="Remove puzzle condition" title="Remove puzzle condition">×</button>}
        </footer></>
    </section>;
}

/** IF for the first sibling in execution order, ELSE IF after it, ELSE for the fallback. */
function conditionalKindLabel(branch, rank) {
    if (branch?.branchType === "else") return "ELSE";
    return rank <= 1 ? "IF" : "ELSE IF";
}

function PuzzleConditionNode({ title, conditions = [], stateVariables = VISIBLE_STATE_VARIABLES, defaultVariable = VISIBLE_STATE_VARIABLES[0], selectableTypes = SELECTABLE_TYPES, maxConditions = MAX_CONDITIONS_PER_BRANCH, onChange, onRemoveCondition }) {
    const [operandPicker, setOperandPicker] = useState(null);
    const [inspectedVariable, setInspectedVariable] = useState(null);
    const node = { id: `puzzle-condition:${title}`, rootId: `puzzle-condition:${title}`, rootIndex: 0, path: [0], width: 0 };
    const branch = { id: `puzzle-condition-branch:${title}`, branchType: "if", priority: 1, conditions, actions: [], children: [] };
    const graph = { conditions: [node], actions: [] };
    const roots = [{ branches: [branch] }];

    const updateConditions = (nextConditions) => {
        if (Array.isArray(nextConditions)) onChange?.(nextConditions);
    };
    const openVariablePicker = (rowIndex, operand) => {
        setInspectedVariable(null);
        setOperandPicker({ rowIndex, operand });
    };
    const chooseOperandVariable = (variableId) => {
        if (!operandPicker) return;
        const { rowIndex, operand } = operandPicker;
        if (operand === 1 && variableId === "always") {
            updateConditions(conditions.map((condition, index) => index === rowIndex
                ? { type: "always", ...(condition.join === "or" ? { join: "or" } : {}) }
                : condition));
            setOperandPicker(null);
            return;
        }
        const definition = stateVariables.find((variable) => variable.id === variableId)
            ?? STATE_VARIABLES.find((variable) => variable.id === variableId);
        if (!definition || (operand === 2 && definition.valueType !== "number")) return;
        updateConditions(conditions.map((condition, index) => {
            if (index !== rowIndex) return condition;
            if (operand === 2) {
                return {
                    ...condition,
                    right: { type: "variable", value: definition.id },
                    ...(definition.supportsSelectable ? { rightSelectable: defaultSelectableForVariable(definition, selectableTypes) } : {}),
                };
            }
            const replacement = createExpressionCondition(definition, selectableTypes);
            const keepRight = definition.valueType === "number" && ["number", "variable"].includes(condition.right?.type)
                ? condition.right
                : definition.valueType === "boolean" && condition.right?.type === "boolean" ? condition.right : replacement.right;
            return { ...replacement, ...(condition.join === "or" ? { join: "or" } : {}), right: keepRight };
        }));
        setOperandPicker(null);
    };
    const updateBranch = (_rootIndex, _path, updater) => {
        const nextBranch = updater(branch);
        updateConditions(nextBranch.conditions);
    };
    const removeCondition = (rowIndex) => {
        setInspectedVariable(null);
        setOperandPicker(null);
        onRemoveCondition?.(rowIndex);
        if (!onRemoveCondition) updateConditions(conditions.filter((_, index) => index !== rowIndex));
    };

    return <div className="relative overflow-visible">
        <GraphConditionNode
            node={node}
            branch={branch}
            disabled={false}
            canRemove={false}
            canAddAction={false}
            canAddCondition={conditions.length < maxConditions}
            maxConditions={maxConditions}
            stateVariables={stateVariables}
            defaultVariable={defaultVariable}
            selectableTypes={selectableTypes}
            nodeOffsets={{}}
            beginNodeDrag={() => {}}
            selected={false}
            standalone
            puzzleLabel={title}
            onSelect={() => {}}
            onPriorityChange={() => {}}
            onPickVariable={openVariablePicker}
            onInspectVariable={(rowIndex, operand) => { setOperandPicker(null); setInspectedVariable({ kind: "condition-variable", id: node.id, rowIndex, operand }); }}
            onRemoveCondition={removeCondition}
            inspectedVariable={inspectedVariable}
            onChange={({ conditions: nextConditions }) => updateConditions(nextConditions)}
            onRemove={() => {}}
            onAddChildConditional={() => {}}
            onAddAction={() => {}}
        />
        {operandPicker && <VariableOperandPicker operand={operandPicker.operand} stateVariables={stateVariables} numericOnly={operandPicker.operand === 2} onChoose={chooseOperandVariable} onUseRawNumber={operandPicker.operand === 2 ? () => { updateConditions(conditions.map((condition, index) => { if (index !== operandPicker.rowIndex) return condition; const next = { ...condition, right: { type: "number", value: 0 } }; delete next.rightSelectable; return next; })); setOperandPicker(null); } : null} onClose={() => setOperandPicker(null)} />}
        {inspectedVariable && <LogicNodeInspector
            inspectedNode={inspectedVariable}
            graph={graph}
            roots={roots}
            stateVariables={stateVariables}
            selectableTypes={selectableTypes}
            selectedLoadout={null}
            customVariables={[]}
            disabled={false}
            canRemove={false}
            canAddAction={false}
            onClose={() => setInspectedVariable(null)}
            updateBranch={updateBranch}
            onChangeConditionVariable={openVariablePicker}
            onDismissOperandPicker={() => setOperandPicker(null)}
        />}
    </div>;
}

function VariableActionExpression({ entry, customVariables, stateVariables, selectableTypes }) {
    const target = customVariables.find((variable) => variable.id === entry.variableId);
    if (!target) return null;
    const terms = target.valueType === "boolean"
        ? [{ operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: entry.operand ?? { type: "boolean", value: entry.value ?? false } }]
        : variableActionTerms(entry);
    return <span className="code-variable-action-expression" aria-label={`Expression for ${target.name}`}>
        {terms.map((term, index) => {
            const operand = term.operand ?? { type: target.valueType, value: target.valueType === "boolean" ? false : 0 };
            const definition = operand.type === "variable" ? stateVariables.find((variable) => variable.id === operand.value) : null;
            const operation = term?.operator ?? (index === 0 ? CUSTOM_VARIABLE_OPERATIONS.SET : CUSTOM_VARIABLE_OPERATIONS.ADD);
            const operator = variableOperatorPresentation(operation);
            const rawValue = String(operand.value ?? 0).toUpperCase();
            return <span className="code-variable-expression-term" key={`expression-${index}`}><span className="code-variable-expression-operator" role="img" aria-label={operator.label}><VariableOperatorGlyph operation={operation} /></span>{definition ? <span className="code-variable-expression-variable"><span>{definition.label}</span><VariableConfigurationSignature definition={definition} condition={{ ...operand, rightSelectable: operand.selectable }} operand={2} selectableTypes={selectableTypes} /></span> : <span className="code-config-token code-config-token--coordinate">{rawValue}</span>}</span>;
        })}
    </span>;
}

// Plain-language parts of an action card: the label, boxed target chips, and
// (for custom-variable actions) the expression text.
function describeActionParts(entry, definition, selectableTypes, coordinateVersion, customVariables = [], stateVariables = []) {
    const label = formatActionNodeLabel(definition?.label ?? "Action");
    const chips = [];
    const mode = actionTargetMode(entry, definition);
    const targetText = () => mode === "coordinates"
        ? `(${Number(entry.targetX ?? coordinateCenter(coordinateVersion))}, ${Number(entry.targetY ?? coordinateCenter(coordinateVersion))})`
        : formatSelectableLabel(entry.selectable ?? BOT_CODE_SELECTABLES.OPPONENT, selectableTypes);
    if (mode === "absolute" && definition?.movementConfig) chips.push(`${absoluteMovementAngle(entry.movementDirection)}° absolute`);
    else if (mode === "angle") chips.push(`${Number(entry.targetAngle ?? 0)}° absolute`);
    else if (mode) chips.push(definition?.movementConfig ? `${relativeMovementAngle(entry.movementDirection)}° from ${targetText()}` : targetText());
    let expression = null;
    let title = label;
    if (definition?.variableAction) {
        const target = customVariables.find((variable) => variable.id === entry.variableId);
        if (target) {
            const terms = target.valueType === "boolean"
                ? [{ operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: entry.operand ?? { type: "boolean", value: entry.value ?? false } }]
                : variableActionTerms(entry);
            title = target.name;
            expression = `= ${variableActionSummary({ target, terms, stateVariables })}`;
        }
    }
    return { label: title, chips, expression };
}

function GraphActionNode({ node, entry, disabled, selectedLoadout, selectableTypes, stateVariables = [], customVariables = [], nodeOffsets, beginNodeDrag, selectedNode, onInspect, onRemove, canRemove = true, puzzleMode = false, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const channel = selected ? actionExecutionHead(selected) : "none";
    const { label, chips, expression } = describeActionParts(entry, selected, selectableTypes, coordinateVersion, customVariables, stateVariables);
    return <section onClick={onInspect} onPointerDown={(event) => beginNodeDrag(event, node.id)} className={`code-graph-node code-graph-node--action code-bt-node code-bt-task absolute ${selectedNode ? "is-inspected" : ""}`} style={{ ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <div className="code-bt-task-body">
            {channel && channel !== "none" && <span className={`code-bt-channel code-bt-channel--${String(channel).toLowerCase()}`}>{ACTION_CHANNEL_LABELS[channel] ?? String(channel).toUpperCase()}</span>}
            <span className="code-bt-task-line">
                <span className="code-action-label" title={label}>{label}</span>
                {chips.map((chip, index) => <span className="code-bt-entity" key={index}>{chip}</span>)}
                {expression && <span className="code-bt-value code-bt-value--summary" title={expression}>{expression}</span>}
            </span>
        </div>
        {(!puzzleMode || canRemove) && <button type="button" data-node-drag-ignore="true" disabled={disabled || (puzzleMode && !canRemove)} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-bt-x code-bt-x--corner" aria-label="Remove action" title="Remove action">×</button>}
    </section>;
}

function selectablePairConfigurationNote(definition) {
    if (definition.id === "selectable.distance") return "Distance compares the first entity to either a selected entity or an absolute arena coordinate.";
    if (definition.id === "selectable.absoluteBearing") return "Direction To is the arena heading, as a signed angle, from the first entity toward the target.";
    return "Angle To is how far off the first entity's facing is from the target, from 0 to 180 degrees. Near 0 means it is facing the target.";
}

const COMPARATOR_SYMBOLS = Object.freeze({ lt: "<", lte: "≤", eq: "=", neq: "≠", gte: "≥", gt: ">" });

function conditionVariableDefinition(stateVariables, id) {
    return stateVariables.find((variable) => variable.id === id)
        ?? STATE_VARIABLES.find((variable) => variable.id === id)
        ?? null;
}

// Small info-icon toggle that keeps explanatory paragraphs out of the way until asked for.
function InfoHint({ text, label = "About this setting" }) {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    return <span className="code-info-hint">
        <button type="button" className="code-info-hint-button" aria-label={label} aria-expanded={open} title={label} onClick={() => setOpen((current) => !current)}><img src="/assets/arena-toolbar/info-circle-icon.png" alt="" aria-hidden="true" className="info-circle-icon code-info-hint-icon" /></button>
        {open && <small className="code-info-hint-text">{text}</small>}
    </span>;
}

// One condition, opened from its strip on the node. It reads top to bottom:
// the variable, the comparator, what it is compared to, then the settings fields.
function ConditionalInspectorRow({ condition, index, stateVariables, defaultVariable, selectableTypes, selectableAbilityIds, disabled, coordinateVersion, onPickOperand, onRowChange }) {
    const isAlways = condition.type === "always";
    const leftDefinition = isAlways ? null : conditionVariableDefinition(stateVariables, condition.left) ?? defaultVariable;
    const rightDefinition = condition.right?.type === "variable" ? conditionVariableDefinition(stateVariables, condition.right.value) : null;
    const updateOperand = (operand, updates) => onRowChange((item) => {
        const next = { ...item, ...updates };
        const definition = operand === 1 ? leftDefinition : rightDefinition;
        const scoped = variableWithSelectableOptions(definition, next, operand, selectableAbilityIds);
        const normalized = normalizeConditionSelections(next, scoped, rightDefinition);
        return {
            ...next,
            ...(scoped.supportsAbility && normalized.ability != null ? { ability: normalized.ability } : {}),
            ...(scoped.supportsStatusEffect && normalized.statusEffect != null ? { statusEffect: normalized.statusEffect } : {}),
        };
    });
    const hasSettings = (definition) => Boolean(definition && (definition.supportsSelectable || definition.supportsAbility || definition.supportsStatusEffect));
    const comparators = leftDefinition ? CONDITION_COMPARATORS.filter((candidate) => candidate.valueTypes.includes(leftDefinition.valueType)) : [];
    const comparator = comparators.some((candidate) => candidate.id === condition.comparator) ? condition.comparator : comparators[0]?.id ?? "eq";
    const numberDefinition = leftDefinition;
    const numberSuffix = numberDefinition?.suffix;
    const signedNumber = Number(numberDefinition?.min) < 0
        || numberSuffix === "deg"
        || numberDefinition?.tags?.includes(VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER);
    const numberStep = numberDefinition?.step ?? NUMBER_STEP;
    const integerNumber = numberStep >= 1;
    const isNumber = leftDefinition?.valueType === "number";
    const right = condition.right;
    const leftHasSettings = hasSettings(leftDefinition);
    const rightHasSettings = right?.type === "variable" && hasSettings(rightDefinition);
    return <div className="code-cond-row" data-condition-row={index}>
        <div className={`code-cond-compare ${isAlways ? "is-always" : ""}`}>
            <button type="button" className="code-cond-variable" disabled={disabled} onClick={() => onPickOperand(index, 1)} aria-label={`Change variable for condition ${index + 1}`}>
                <span className="code-cond-variable-label">{isAlways ? "Always" : leftDefinition.label}</span>
                <span className="code-cond-change" aria-hidden="true">▾</span>
            </button>
            {!isAlways && <>
                <select className="code-cond-comparator" aria-label="Comparator" disabled={disabled} value={comparator} onChange={(event) => onRowChange((item) => ({ ...item, comparator: event.target.value }))}>{comparators.map((candidate) => <option key={candidate.id} value={candidate.id}>{COMPARATOR_SYMBOLS[candidate.id] ?? candidate.label}</option>)}</select>
                <div className="code-cond-right">
                    {right?.type === "boolean" && <select className="code-cond-value-select" aria-label="Boolean value" disabled={disabled} value={String(right.value)} onChange={(event) => onRowChange((item) => ({ ...item, right: { type: "boolean", value: event.target.value === "true" } }))}><option value="true">true</option><option value="false">false</option></select>}
                    {right?.type === "number" && <div className="code-cond-number"><DeferredNumberInput digitsOnly={integerNumber && !signedNumber} integerOnly={integerNumber} aria-label="Compare to number" disabled={disabled} min={numberDefinition?.min ?? CUSTOM_NUMBER_MIN} max={numberDefinition?.max ?? CUSTOM_NUMBER_MAX} step={numberStep} value={right.value} onCommit={(value) => onRowChange((item) => ({ ...item, right: { type: "number", value } }))} />{numberSuffix && <span className="code-cond-unit">{numberSuffix}</span>}</div>}
                    {right?.type === "variable" && <button type="button" className="code-cond-variable" disabled={disabled} onClick={() => onPickOperand(index, 2)} aria-label={`Change compared variable for condition ${index + 1}`}>
                        <span className="code-cond-variable-label">{rightDefinition?.label ?? "Choose variable"}</span>
                        <span className="code-cond-change" aria-hidden="true">▾</span>
                    </button>}
                    {(isNumber || right?.type === "boolean") && <div className="code-va-segmented code-va-segmented--small code-cond-kind" role="group" aria-label={`Compare condition ${index + 1} to`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()}>
                        <button type="button" disabled={disabled} aria-pressed={right?.type !== "variable"} className={right?.type !== "variable" ? "is-active" : ""} onClick={() => { if (right?.type === "variable") onRowChange((item) => { const next = { ...item, right: { type: "number", value: 0 } }; delete next.rightSelectable; return next; }); }}>{isNumber ? "Num" : "T/F"}</button>
                        <button type="button" disabled={disabled || !isNumber} aria-pressed={right?.type === "variable"} className={right?.type === "variable" ? "is-active" : ""} onClick={() => onPickOperand(index, 2)} aria-label="Compare to a variable" title={isNumber ? "Compare to a variable" : "Boolean conditions compare to true or false"}>Var</button>
                    </div>}
                </div>
            </>}
        </div>
        {!isAlways && <>
            {(leftHasSettings || rightHasSettings) && <div className="code-cond-settings">
                {leftHasSettings && <>
                    <p className="code-cond-settings-caption">Settings for {leftDefinition.label}</p>
                    <ConditionOperandFields definition={leftDefinition} rightDefinition={rightDefinition} condition={condition} operand={1} selectableTypes={selectableTypes} selectableAbilityIds={selectableAbilityIds} disabled={disabled} coordinateVersion={coordinateVersion} onUpdate={(updates) => updateOperand(1, updates)} />
                </>}
                {rightHasSettings && <>
                    <p className="code-cond-settings-caption">Settings for {rightDefinition.label}</p>
                    <ConditionOperandFields definition={rightDefinition} rightDefinition={rightDefinition} condition={condition} operand={2} selectableTypes={selectableTypes} selectableAbilityIds={selectableAbilityIds} disabled={disabled} coordinateVersion={coordinateVersion} onUpdate={(updates) => updateOperand(2, updates)} />
                </>}
            </div>}
        </>}
    </div>;
}

function LogicNodeInspector({ inspectedNode, graph, roots, stateVariables, selectableTypes, selectableAbilityIds = null, selectedLoadout, customVariables, disabled, canRemove, canAddAction, defaultVariable = null, onClose, updateBranch, onPickConditionOperand, onChangeAction, onPickActionOperand, onInspectActionOperand, onDismissOperandPicker, onChangeConditionVariable, className = "", focusEnabled = true, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, enabled: focusEnabled });
    const panel = (eyebrow, title, body, removeLabel = "", onRemove = null) => <aside ref={dialogRef} className={`code-inspector ${className}`} data-node-drag-ignore="true" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <header className="code-inspector-header"><div><span>{eyebrow}</span><h2 className="code-inspector-title">{title}</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close inspector"><span aria-hidden="true">×</span></button></header>
        <div className="code-inspector-body" onClick={(event) => { if (event.target === event.currentTarget) onDismissOperandPicker?.(); }}>{body}</div>
        {onRemove && <footer className="code-inspector-footer"><button type="button" disabled={disabled || !canRemove} onClick={() => { onRemove(); onClose(); }}>{removeLabel}</button></footer>}
    </aside>;

    if (inspectedNode.kind === "condition-row") {
        const node = graph.conditions.find((candidate) => candidate.id === inspectedNode.id);
        const branch = node ? treeBranchAt(roots[node.rootIndex]?.branches, node.path) : null;
        const conditions = Array.isArray(branch?.conditions) ? branch.conditions : [];
        const condition = conditions[inspectedNode.rowIndex];
        if (!node || !branch || !condition) return null;
        const updateRow = (updater) => updateBranch(node.rootIndex, node.path, (current) => ({
            ...current,
            conditions: (current.conditions ?? []).map((item, index) => index === inspectedNode.rowIndex ? updater(item) : item),
        }));
        const fallbackVariable = defaultVariable ?? stateVariables[0];
        return panel("Conditional", "Condition", <ConditionalInspectorRow {...{ condition, stateVariables, selectableTypes, selectableAbilityIds, disabled, coordinateVersion }} index={inspectedNode.rowIndex} defaultVariable={fallbackVariable} onPickOperand={(rowIndex, operand) => onPickConditionOperand?.(node.rootIndex, node.path, rowIndex, operand)} onRowChange={updateRow} />);
    }

    if (inspectedNode.kind === "condition-variable") {
        const node = graph.conditions.find((candidate) => candidate.id === inspectedNode.id);
        const branch = node ? treeBranchAt(roots[node.rootIndex]?.branches, node.path) : null;
        const condition = branch?.conditions?.[inspectedNode.rowIndex];
        const variableId = inspectedNode.operand === 1 ? condition?.left : condition?.right?.type === "variable" ? condition.right.value : null;
        const definition = stateVariables.find((variable) => variable.id === variableId)
            ?? STATE_VARIABLES.find((variable) => variable.id === variableId);
        if (!node || !branch || !condition || !definition) return null;
        const rightDefinition = condition.right?.type === "variable"
            ? stateVariables.find((variable) => variable.id === condition.right.value)
                ?? STATE_VARIABLES.find((variable) => variable.id === condition.right.value)
            : null;
        const update = (updates) => updateBranch(node.rootIndex, node.path, (current) => ({
            ...current,
            conditions: (current.conditions ?? []).map((item, index) => {
                if (index !== inspectedNode.rowIndex) return item;
                const next = { ...item, ...updates };
                const scoped = variableWithSelectableOptions(definition, next, inspectedNode.operand, selectableAbilityIds);
                const normalized = normalizeConditionSelections(next, scoped, rightDefinition);
                return {
                    ...next,
                    ...(scoped.supportsAbility && normalized.ability != null ? { ability: normalized.ability } : {}),
                    ...(scoped.supportsStatusEffect && normalized.statusEffect != null ? { statusEffect: normalized.statusEffect } : {}),
                };
            }),
        }));
        return panel(`INPUT ${inspectedNode.operand} VARIABLE`, definition.label, <>
            {onChangeConditionVariable && <button type="button" onClick={() => onChangeConditionVariable(inspectedNode.rowIndex, inspectedNode.operand)} className="mb-4 min-h-9 w-full border border-cyan-700/70 bg-cyan-950/40 px-3 font-mono text-[9px] font-bold tracking-[.12em] text-cyan-200 hover:border-cyan-400 hover:bg-cyan-900/50">CHANGE VARIABLE</button>}
            <ConditionOperandFields definition={definition} rightDefinition={rightDefinition} condition={condition} operand={inspectedNode.operand} selectableTypes={selectableTypes} selectableAbilityIds={selectableAbilityIds} disabled={disabled} coordinateVersion={coordinateVersion} onUpdate={update} />
        </>);
    }

    if (inspectedNode.kind === "action") {
        const node = graph.actions.find((candidate) => candidate.id === inspectedNode.id);
        const branch = node ? treeBranchAt(roots[node.rootIndex]?.branches, node.path) : null;
        const actions = graphBranchActions(branch);
        const entry = node ? actions[node.actionIndex] : null;
        if (!node || !branch || !entry) return null;
        const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
        const definition = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
        const update = (nextEntry) => updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.map((item, index) => index === node.actionIndex ? nextEntry : item)));
        const targetMode = actionTargetMode(entry, definition);
        const needsTarget = targetMode !== null && targetMode !== "absolute";
        const channelLabel = ACTION_CHANNEL_LABELS[definition ? actionExecutionHead(definition) : "none"] ?? "";
        return panel(channelLabel ? `${sentenceCase(channelLabel)} · Action` : "Action", definition?.variableAction ? "Modify custom variable" : "Action", <div className="code-cond-row code-action-row">
            {onChangeAction && !definition?.variableAction && <button type="button" className="code-cond-variable" disabled={disabled} onClick={() => onChangeAction(node.rootIndex, node.path, node.actionIndex)} aria-label="Change action"><span className="code-cond-variable-label">{definition?.label ?? "Action"}</span><span className="code-cond-change" aria-hidden="true">▾</span></button>}
            <div className="code-cond-settings">
            {definition?.variableAction && <VariableActionControls entry={entry} variables={customVariables} stateVariables={stateVariables} selectableTypes={selectableTypes} disabled={disabled} canAddAction={canAddAction} allowRemoveAction={false} onChange={update} onPickOperand={(termIndex) => onPickActionOperand?.(node.rootIndex, node.path, node.actionIndex, termIndex)} onInspectOperand={(termIndex) => onInspectActionOperand?.(node.rootIndex, node.path, node.actionIndex, termIndex)} onRemoveAction={() => {}} />}
            {definition?.movementConfig && <MovementConfigurationControls entry={entry} disabled={disabled} onChange={update} />}
            {definition?.orientationConfig && <PhaseOrientationControls entry={entry} disabled={disabled} onChange={update} />}
            {needsTarget && <ActionTargetControls entry={entry} definition={definition} selectableTypes={selectableTypes} disabled={disabled} onChange={update} coordinateVersion={coordinateVersion} />}
            </div>
        </div>);
    }
    return null;
}

/** Entity / ability / status / target settings for one condition operand. */
function ConditionOperandFields({ definition, rightDefinition = null, condition, operand, selectableTypes, selectableAbilityIds = null, disabled, coordinateVersion = BOT_LOGIC_TREE_VERSION, onUpdate }) {
    const update = onUpdate;
    // The compared-to pair variable has its own entity/target, separate from the first variable's.
    const pairCondition = operand === 2 ? rightOperandView(condition) : condition;
    const updatePair = (updates) => update(operand === 2 ? rightPairUpdates(updates) : updates);
    const field = (label, control, hint = "") => <label className="code-inspector-field"><span>{sentenceCase(label)}</span>{control}{hint && <small>{hint}</small>}</label>;
    const selectableField = operand === 1 ? "leftSelectable" : "rightSelectable";
    const selectableOptions = selectableOptionsForDefinition(
        definition,
        selectableTypes,
        definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR ? "second" : "selectable",
    );
    const pairEntitySelectableOptions = definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
        ? selectableOptionsForDefinition(definition, selectableTypes, "first")
        : selectableOptions;
    const selectablePairDefaults = definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
        ? defaultSelectablePairForVariable(definition, selectableTypes)
        : null;
    const scopedDefinition = variableWithSelectableOptions(definition, condition, operand, selectableAbilityIds);
    const selectedCondition = normalizeConditionSelections(condition, scopedDefinition, rightDefinition);
    const abilityOptions = scopedDefinition.abilityOptions ?? [];
    const statusEffectOptions = scopedDefinition.statusEffectOptions ?? [];
    const selectablePickerLabel = selectableSelectorLabel(definition);
    return <>
            {definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
                ? <>
                    {field(selectableSelectorLabel(definition, 0), <OrderedSelectablePicker disabled={disabled} value={pairCondition.selectable1 ?? selectablePairDefaults[0]} selectableTypes={pairEntitySelectableOptions} allowOrdering={definition.selectableOrderable !== false} onChange={(selectable) => updatePair({ selectable1: selectable })} />)}
                    {definition.targetModes?.length
                        ? <ConditionTargetControls condition={pairCondition} definition={definition} selectableTypes={selectableOptions} defaultSelectable={selectablePairDefaults[1]} disabled={disabled} onChange={updatePair} coordinateVersion={coordinateVersion} />
                        : field(selectableSelectorLabel(definition, 1), <OrderedSelectablePicker disabled={disabled} value={pairCondition.selectable2 ?? pairCondition.selectable ?? selectablePairDefaults[1]} selectableTypes={selectableOptions} allowOrdering={definition.selectableOrderable !== false} onChange={(selectable) => updatePair({ selectable2: selectable })} />)}
                    <InfoHint text={selectablePairConfigurationNote(definition)} label={`About ${definition.label}`} />
                </>
                : definition.supportsSelectable && field(selectablePickerLabel, <OrderedSelectablePicker value={condition[selectableField] ?? defaultSelectableForVariable(definition, selectableTypes)} selectableTypes={selectableOptions} allowOrdering={definition.selectableOrderable !== false} onChange={(selectable) => update({ [selectableField]: selectable })} />)}
            {definition.supportsAbility && abilityOptions.length > 0 && field("Ability", <select disabled={disabled} value={selectedCondition.ability ?? abilityOptions[0].id} onChange={(event) => update({ ability: abilityIdFromBoundary(event.target.value) })}>{abilityOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}</select>)}
            {definition.supportsStatusEffect && statusEffectOptions.length > 0 && field("Status effect", <select disabled={disabled} value={selectedCondition.statusEffect ?? ""} onChange={(event) => update({ statusEffect: normalizeStatusEffectSelection(event.target.value, statusEffectOptions) })}><option value="" disabled>Choose status effect</option>{statusEffectOptions.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select>)}
            {definition.id.endsWith("edgeDistance") && <InfoHint text="Edge distance is measured from the center of the entity to the nearest arena or danger-zone boundary." label={`About ${definition.label}`} />}
            {!definition.supportsAbility && !definition.supportsStatusEffect && !definition.supportsSelectable && <p className="code-inspector-note">This variable has no additional configuration.</p>}
    </>;
}

function TutorialLogicInspector({ kind, condition = { type: "always" }, action = null, customVariables = [], selectedLoadout = null, stateVariables = VISIBLE_STATE_VARIABLES, selectableTypes = SELECTABLE_TYPES, className = "" }) {
    const branchId = `tutorial-inspector-branch-${kind}`;
    const rootId = `tutorial-inspector-root-${kind}`;
    const branch = {
        id: branchId,
        branchType: "if",
        priority: 1,
        conditions: [condition],
        actions: action ? [action] : [],
        children: [],
    };
    const root = {
        id: rootId,
        name: "Tutorial preview",
        priority: 1,
        branches: [branch],
    };
    const graph = buildLogicGraph([root], stateVariables, selectedLoadout, selectableTypes, BOT_LOGIC_TREE_VERSION, customVariables);
    const node = kind === "condition" ? graph.conditions[0] : graph.actions[0];
    if (!node) return null;
    const inspectedNode = kind === "condition"
        ? { kind: "condition-variable", id: node.id, rowIndex: 0, operand: 1 }
        : { kind: "action", id: node.id };
    return <LogicNodeInspector
        inspectedNode={inspectedNode}
        graph={graph}
        roots={[root]}
        stateVariables={stateVariables}
        selectableTypes={selectableTypes}
        selectableAbilityIds={selectableAbilityIdsForLoadouts(selectedLoadout, selectedLoadout)}
        selectedLoadout={selectedLoadout}
        customVariables={customVariables}
        disabled
        canRemove={false}
        canAddAction={false}
        onClose={() => {}}
        updateBranch={() => {}}
        onDismissOperandPicker={() => {}}
        className={`tutorial-code-inspector-preview ${className}`}
        focusEnabled={false}
    />;
}

function actionTargetMode(entry, definition) {
    if (definition?.movementConfig) {
        if (entry?.movementMode === "absolute") return "absolute";
        return entry?.movementMode === "coordinates" ? "coordinates" : "target";
    }
    if (definition?.angleTarget) {
        return ["target", "angle", "coordinates"].includes(entry?.targetMode) ? entry.targetMode : "target";
    }
    if (definition?.coordinateTarget) return entry?.targetMode === "coordinates" ? "coordinates" : "target";
    return actionSupportsTarget(definition) ? "target" : null;
}

function ActionTargetControls({ entry, definition, selectableTypes, disabled, onChange, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    const limits = coordinateLimitsFor(coordinateVersion);
    const center = coordinateCenter(coordinateVersion);
    const mode = actionTargetMode(entry, definition);
    const canChooseCoordinates = Boolean(definition?.coordinateTarget && !definition?.movementConfig);
    const modeControl = canChooseCoordinates && <TargetModeToggle
        modes={["target", "coordinates", ...(definition?.angleTarget ? ["angle"] : [])]}
        mode={mode}
        disabled={disabled}
        onSelect={(candidate) => onChange({ ...entry, targetMode: candidate })}
    />;
    if (mode === "angle") {
        return <div>
            {modeControl}
            <label className="code-inspector-field"><span className="code-movement-label-row">ANGLE <AbsoluteArenaAngleHelpButton /></span><DeferredNumberInput disabled={disabled} min={-360} max={360} value={entry.targetAngle ?? 0} fallback={0} aria-label="Absolute rotation angle" onCommit={(targetAngle) => onChange({ ...entry, targetAngle })} /><span className="code-inspector-field-unit">deg</span></label>
        </div>;
    }
    if (mode === "coordinates") {
        return <div>
            {modeControl}
            <div className="grid grid-cols-2 gap-2">
                <label className="code-inspector-field"><span>X</span><DeferredNumberInput disabled={disabled} min={limits.minimum} max={limits.maximum} value={entry.targetX ?? center} fallback={center} aria-label="Target X coordinate" onCommit={(targetX) => onChange({ ...entry, targetX })} /></label>
                <label className="code-inspector-field"><span>Y</span><DeferredNumberInput disabled={disabled} min={limits.minimum} max={limits.maximum} value={entry.targetY ?? center} fallback={center} aria-label="Target Y coordinate" onCommit={(targetY) => onChange({ ...entry, targetY })} /></label>
            </div>
        </div>;
    }
    return <div>
        {modeControl}
        <label className="code-inspector-field"><span>TARGET</span><OrderedSelectablePicker disabled={disabled} value={entry.selectable ?? BOT_CODE_SELECTABLES.OPPONENT} selectableTypes={selectableTypes} onChange={(selectable) => onChange({ ...entry, selectable, ...(definition?.movementConfig ? {} : { targetMode: "target" }) })} /></label>
        {!definition?.movementConfig && <div className="grid grid-cols-2 gap-2">
            <label className="code-inspector-field"><span>X OFFSET</span><DeferredNumberInput disabled={disabled} min={-limits.offsetMagnitude} max={limits.offsetMagnitude} value={entry.targetOffsetX ?? 0} fallback={0} aria-label="Target X offset" onCommit={(targetOffsetX) => onChange({ ...entry, targetOffsetX })} /></label>
            <label className="code-inspector-field"><span>Y OFFSET</span><DeferredNumberInput disabled={disabled} min={-limits.offsetMagnitude} max={limits.offsetMagnitude} value={entry.targetOffsetY ?? 0} fallback={0} aria-label="Target Y offset" onCommit={(targetOffsetY) => onChange({ ...entry, targetOffsetY })} /></label>
        </div>}
    </div>;
}

function conditionTargetMode(condition, definition) {
    const modes = definition?.targetModes;
    if (!Array.isArray(modes) || modes.length === 0) return TARGET_MODES.TARGET;
    const inferredMode = condition?.targetMode
        ?? (condition?.targetX != null || condition?.targetY != null
            ? TARGET_MODES.COORDINATES
            : condition?.targetAngle != null ? TARGET_MODES.ANGLE : TARGET_MODES.TARGET);
    return modes.includes(inferredMode)
        ? inferredMode
        : modes.includes(TARGET_MODES.TARGET) ? TARGET_MODES.TARGET : modes[0];
}

const CONDITION_TARGET_MODE_LABELS = Object.freeze({ [TARGET_MODES.TARGET]: "Entity", [TARGET_MODES.COORDINATES]: "Point", [TARGET_MODES.ANGLE]: "Angle" });

// "To: Entity | Point | Angle" toggle shared by conditions, movement and zone / target actions.
function TargetModeToggle({ modes, mode, disabled, onSelect }) {
    const label = (candidate) => candidate === "absolute" ? CONDITION_TARGET_MODE_LABELS[TARGET_MODES.ANGLE] : CONDITION_TARGET_MODE_LABELS[candidate];
    return <div className="code-inspector-field code-target-toggle-field" role="group" aria-label="Measure to">
        <span>To</span>
        <div className="code-segmented">
            {modes.map((candidate) => <button key={candidate} type="button" disabled={disabled} className={candidate === mode ? "is-active" : ""} aria-pressed={candidate === mode} onClick={() => onSelect(candidate)}>{label(candidate)}</button>)}
        </div>
    </div>;
}

// Sentence case so labels read the same across variables ("Facing Entity" -> "Facing entity").
function sentenceCase(label) {
    const text = String(label ?? "").trim().toLowerCase();
    return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function ConditionTargetControls({ condition, definition, selectableTypes, defaultSelectable, disabled, onChange, coordinateVersion = BOT_LOGIC_TREE_VERSION }) {
    const limits = coordinateLimitsFor(coordinateVersion);
    const center = coordinateCenter(coordinateVersion);
    const modes = [TARGET_MODES.TARGET, TARGET_MODES.COORDINATES, TARGET_MODES.ANGLE].filter((candidate) => (definition?.targetModes ?? []).includes(candidate));
    const mode = conditionTargetMode(condition, definition);
    // "To: Entity | Point" (plus Angle for variables that measure against an absolute angle).
    const modeControl = <TargetModeToggle modes={modes} mode={mode} disabled={disabled} onSelect={(candidate) => onChange({ targetMode: candidate })} />;
    if (mode === TARGET_MODES.ANGLE) {
        return <div>
            {modeControl}
            <label className="code-inspector-field"><span className="code-movement-label-row">Absolute angle <AbsoluteArenaAngleHelpButton /></span><DeferredNumberInput disabled={disabled} min={-360} max={360} value={condition.targetAngle ?? 0} fallback={0} aria-label="Target absolute angle" onCommit={(targetAngle) => onChange({ targetAngle })} /><span className="code-inspector-field-unit">deg</span></label>
        </div>;
    }
    if (mode === TARGET_MODES.COORDINATES) {
        return <div>
            {modeControl}
            <div className="grid grid-cols-2 gap-2">
                <label className="code-inspector-field"><span>X</span><DeferredNumberInput disabled={disabled} min={limits.minimum} max={limits.maximum} value={condition.targetX ?? center} fallback={center} aria-label="Target X coordinate" onCommit={(targetX) => onChange({ targetX })} /></label>
                <label className="code-inspector-field"><span>Y</span><DeferredNumberInput disabled={disabled} min={limits.minimum} max={limits.maximum} value={condition.targetY ?? center} fallback={center} aria-label="Target Y coordinate" onCommit={(targetY) => onChange({ targetY })} /></label>
            </div>
        </div>;
    }
    return <div>
        {modeControl}
        <label className="code-inspector-field"><span>Target</span><OrderedSelectablePicker disabled={disabled} value={condition.selectable2 ?? condition.selectable ?? defaultSelectable} selectableTypes={selectableTypes} allowOrdering={definition.selectableOrderable !== false} onChange={(selectable) => onChange({ selectable2: selectable, targetMode: TARGET_MODES.TARGET })} /></label>
    </div>;
}

function ActionVariableInspector({ definition, operand, selectableTypes, disabled, onChange, onClose }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose });
    if (!definition) return null;
    const selectableOptions = selectableOptionsForDefinition(definition, selectableTypes);
    const selectable = operand?.selectable ?? defaultSelectableForVariable(definition, selectableTypes);
    const update = (updates) => onChange({ ...operand, ...updates });
    return <aside ref={dialogRef} className="code-inspector code-inspector--secondary" data-node-drag-ignore="true" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <header className="code-inspector-header"><div><span>MODIFY INPUT VARIABLE</span><h2>{definition.label}</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close variable inspector"><span aria-hidden="true">×</span></button></header>
        <div className="code-inspector-body">
            <p className="code-inspector-note">Configure this action input without closing the modify custom variable action.</p>
            {definition.supportsSelectable && <label className="code-inspector-field"><span>{definition.supportsAbility ? "BOT ENTITY" : "ENTITY"}</span><OrderedSelectablePicker disabled={disabled} value={selectable} selectableTypes={selectableOptions} allowOrdering={definition.selectableOrderable !== false} onChange={(nextSelectable) => update({ selectable: nextSelectable })} /></label>}
            {definition.supportsAbility && definition.abilityOptions?.length > 0 && <label className="code-inspector-field"><span>ABILITY</span><select disabled={disabled} value={selectedAbilityOptionValue(operand?.ability, definition.abilityOptions)} onChange={(event) => update({ ability: abilityIdFromBoundary(event.target.value) })}>{definition.abilityOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}</select></label>}
            {definition.supportsStatusEffect && definition.statusEffectOptions?.length > 0 && <label className="code-inspector-field"><span>STATUS EFFECT</span><select disabled={disabled} value={selectedStatusOptionValue(operand?.statusEffect, definition.statusEffectOptions)} onChange={(event) => update({ statusEffect: normalizeStatusEffectSelection(event.target.value, definition.statusEffectOptions) })}><option value="" disabled>Choose status effect</option>{definition.statusEffectOptions.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select></label>}
            {!definition.supportsAbility && !definition.supportsStatusEffect && !definition.supportsSelectable && <p className="code-inspector-note">This variable has no additional configuration.</p>}
        </div>
    </aside>;
}

function variableActionTerms(entry) {
    if (Array.isArray(entry?.terms) && entry.terms.length) return entry.terms;
    return [{
        operator: entry?.operation ?? CUSTOM_VARIABLE_OPERATIONS.SET,
        operand: entry?.operand ?? { type: "number", value: entry?.value ?? 0 },
    }];
}

const CHANGE_OPERATIONS = Object.freeze([CUSTOM_VARIABLE_OPERATIONS.ADD, CUSTOM_VARIABLE_OPERATIONS.SUBTRACT, CUSTOM_VARIABLE_OPERATIONS.MODULO]);

function SegmentedToggle({ options, value, onChange, disabled, ariaLabel, className = "" }) {
    return <div className={`code-va-segmented ${className}`.trim()} role="group" aria-label={ariaLabel} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()}>
        {options.map((option) => <button key={option.id} type="button" disabled={disabled} aria-pressed={value === option.id} className={value === option.id ? "is-active" : ""} onClick={() => onChange(option.id)}>{option.label}</button>)}
    </div>;
}

function VariableActionControls({ entry, variables, stateVariables, selectableTypes = SELECTABLE_TYPES, disabled, canAddAction, allowRemoveAction = true, onChange, onPickOperand, onInspectOperand, onRemoveAction }) {
    const selected = variables.find((variable) => variable.id === entry.variableId) ?? variables[0];
    if (!selected) return <div className="font-mono text-[9px] text-amber-300">CREATE A CUSTOM VARIABLE FIRST</div>;
    const terms = variableActionTerms(entry);
    const isBoolean = selected.valueType === "boolean";
    const mode = (terms[0]?.operator ?? CUSTOM_VARIABLE_OPERATIONS.SET) === CUSTOM_VARIABLE_OPERATIONS.SET ? "set" : "change";
    const updateTerms = (nextTerms) => {
        const next = { ...entry, terms: nextTerms };
        delete next.operation;
        delete next.operand;
        delete next.value;
        onChange(next);
    };
    const changeVariable = (variableId) => {
        const nextVariable = variables.find((variable) => variable.id === variableId) ?? selected;
        const next = { ...entry, variableId: nextVariable.id, operation: CUSTOM_VARIABLE_OPERATIONS.SET };
        delete next.terms;
        if (nextVariable.valueType === "boolean") {
            next.value = false;
            delete next.operand;
        } else {
            next.terms = [{ operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "number", value: 0 } }];
            delete next.value;
            delete next.operand;
        }
        onChange(next);
    };
    const changeMode = (nextMode) => {
        if (nextMode === mode) return;
        const [first, ...rest] = terms;
        updateTerms([{ ...first, operator: nextMode === "set" ? CUSTOM_VARIABLE_OPERATIONS.SET : CUSTOM_VARIABLE_OPERATIONS.ADD }, ...rest]);
    };
    const removeTerm = (termIndex) => {
        if (terms.length <= 1) {
            if (allowRemoveAction) onRemoveAction();
            return;
        }
        updateTerms(terms.filter((_, index) => index !== termIndex));
    };
    const addTerm = () => {
        if (!canAddAction || terms.length >= MAX_VARIABLE_ACTION_TERMS) return;
        updateTerms([...terms, { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 0 } }]);
    };
    const summary = variableActionSummary({ target: selected, terms: isBoolean ? [{ operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: entry.operand ?? { type: "boolean", value: entry.value ?? false } }] : terms, stateVariables });
    return <div className="code-va min-w-0 space-y-3">
        <label className="code-va-field">
            <span>Variable</span>
            <select disabled={disabled} value={selected.id} onChange={(event) => changeVariable(event.target.value)} aria-label="Variable">{variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select>
        </label>
        {isBoolean
            ? <BooleanVariableActionRow entry={entry} variableName={selected.name} stateVariables={stateVariables} disabled={disabled} onChange={onChange} onPickOperand={() => onPickOperand?.(0)} onInspectOperand={() => onInspectOperand?.(0)} />
            : <>
                <SegmentedToggle ariaLabel="How to update the variable" disabled={disabled} value={mode} onChange={changeMode} options={[{ id: "change", label: "Change it" }, { id: "set", label: "Set it" }]} className="code-va-mode" />
                <p className="code-va-equation" title={mode === "change" ? `${selected.name} = ${selected.name}` : `${selected.name} =`}>{mode === "change" ? `${selected.name} = ${selected.name}` : `${selected.name} =`}</p>
                <div className="space-y-2">
                    {terms.map((term, termIndex) => {
                        const operand = term?.operand ?? { type: "number", value: 0 };
                        const operandDefinition = operand.type === "variable" ? stateVariables.find((variable) => variable.id === operand.value) : null;
                        const operation = term?.operator ?? (termIndex === 0 ? CUSTOM_VARIABLE_OPERATIONS.SET : CUSTOM_VARIABLE_OPERATIONS.ADD);
                        const updateTerm = (updates) => updateTerms(terms.map((current, index) => index === termIndex ? { ...current, ...updates } : current));
                        const showOperator = !(termIndex === 0 && mode === "set");
                        const canRemove = terms.length > 1 || allowRemoveAction;
                        return <div className={`code-va-row ${showOperator ? "" : "code-va-row--no-operator"}`} key={`variable-term-${termIndex}`}>
                            {showOperator && <VariableOperatorPicker operations={CHANGE_OPERATIONS} disabled={disabled} ariaLabel={`Variable action operator ${termIndex + 1}`} value={operation} onChange={(nextOperation) => updateTerm({ operator: nextOperation })} />}
                            <div className={`code-condition-input code-variable-action-input ${operandDefinition ? "is-variable" : "is-raw"}`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{operandDefinition ? <button type="button" className="code-condition-input-value code-variable-action-input-value" onClick={() => onInspectOperand?.(termIndex)} disabled={disabled}><span className="code-condition-input-copy"><span className="code-variable-action-input-label">{operandDefinition.label}</span><VariableConfigurationSignature definition={operandDefinition} condition={{ ...operand, rightSelectable: operand.selectable }} operand={2} selectableTypes={selectableTypes} /></span></button> : <DeferredNumberInput disabled={disabled} min={CUSTOM_NUMBER_MIN} max={CUSTOM_NUMBER_MAX} value={operand.value ?? 0} onCommit={(value) => updateTerm({ operand: { type: "number", value } })} aria-label={`Variable operand ${termIndex + 1}`} />}</div>
                            <div className="code-va-segmented code-va-segmented--small" role="group" aria-label={`Operand ${termIndex + 1} kind`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()}>
                                <button type="button" disabled={disabled} aria-pressed={!operandDefinition} className={!operandDefinition ? "is-active" : ""} onClick={() => { if (operandDefinition) updateTerm({ operand: { type: "number", value: 0 } }); }}>Num</button>
                                <button type="button" disabled={disabled} aria-pressed={Boolean(operandDefinition)} className={operandDefinition ? "is-active" : ""} onClick={() => onPickOperand?.(termIndex)} aria-label={`Use a variable for operand ${termIndex + 1}`} title="Use a variable">Var</button>
                            </div>
                            {canRemove ? <button type="button" className="code-condition-row-remove" disabled={disabled} onClick={() => removeTerm(termIndex)} aria-label={`Remove variable operand ${termIndex + 1}`}>×</button> : <span className="code-va-row__spacer" aria-hidden="true" />}
                        </div>;
                    })}
                </div>
                <button type="button" aria-label="Add operand" disabled={disabled || !canAddAction || terms.length >= MAX_VARIABLE_ACTION_TERMS} onClick={addTerm} className="code-va-add"><AddIcon /> Add term</button>
            </>}
        <p className="code-va-preview" title={`${selected.name} = ${summary}`}>Each tick: <strong>{selected.name} = {summary}</strong></p>
    </div>;
}

function BooleanVariableActionRow({ entry, variableName, stateVariables, disabled, onChange, onPickOperand, onInspectOperand }) {
    const operand = entry.operand ?? { type: "boolean", value: entry.value ?? false };
    const operandDefinition = operand.type === "variable" ? stateVariables.find((variable) => variable.id === operand.value && variable.valueType === "boolean") : null;
    const updateOperand = (nextOperand) => {
        const next = { ...entry, operation: CUSTOM_VARIABLE_OPERATIONS.SET, operand: nextOperand };
        delete next.value;
        delete next.terms;
        onChange(next);
    };
    return <>
        <p className="code-va-equation" title={`${variableName} =`}>{variableName} =</p>
        <div className="code-va-row code-va-row--boolean">
            <div className={`code-condition-input code-variable-action-input ${operandDefinition ? "is-variable" : "is-raw"}`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{operandDefinition ? <button type="button" className="code-condition-input-value code-variable-action-input-value" onClick={onInspectOperand} disabled={disabled}><span className="code-condition-input-copy"><span className="code-variable-action-input-label">{operandDefinition.label}</span><VariableConfigurationSignature definition={operandDefinition} condition={{ ...operand, rightSelectable: operand.selectable }} operand={2} /></span></button> : <select data-node-drag-ignore="true" aria-label="Boolean value" disabled={disabled} value={String(operand.value ?? false)} onChange={(event) => updateOperand({ type: "boolean", value: event.target.value === "true" })} className="code-operator-socket code-condition-boolean-input"><option value="false">False</option><option value="true">True</option></select>}</div>
            <div className="code-va-segmented code-va-segmented--small" role="group" aria-label="Boolean operand kind" data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" disabled={disabled} aria-pressed={!operandDefinition} className={!operandDefinition ? "is-active" : ""} onClick={() => { if (operandDefinition) updateOperand({ type: "boolean", value: false }); }}>T/F</button>
                <button type="button" disabled={disabled} aria-pressed={Boolean(operandDefinition)} className={operandDefinition ? "is-active" : ""} onClick={onPickOperand} aria-label="Use a variable for the boolean" title="Use a variable">Var</button>
            </div>
        </div>
    </>;
}

function MovementConfigurationControls({ entry, disabled, onChange }) {
    const [showRelativeAngleHelp, setShowRelativeAngleHelp] = useState(false);
    const mode = entry.movementMode ?? "target";
    const relativeDirection = relativeMovementAngle(entry.movementDirection);
    const absoluteDegreeDirection = absoluteMovementAngle(entry.movementDirection);
    const changeMode = (nextMode) => onChange({
        ...entry,
        movementMode: nextMode,
        movementDirection: nextMode === "absolute" ? absoluteDegreeDirection : relativeDirection,
    });
    return <div className="space-y-2">
        <TargetModeToggle modes={["target", "coordinates", "absolute"]} mode={mode} disabled={disabled} onSelect={changeMode} />
        {mode === "absolute" ? <label className="code-inspector-field"><span className="code-movement-label-row">MOVEMENT DIRECTION <AbsoluteArenaAngleHelpButton /></span>
            <div className="code-movement-angle-input">
                <DeferredNumberInput disabled={disabled} min={MOVEMENT_DIRECTION_MIN} max={MOVEMENT_DIRECTION_MAX} step={NUMBER_STEP} value={absoluteDegreeDirection} fallback={0} aria-label="Absolute arena movement direction in degrees" onCommit={(movementDirection) => onChange({ ...entry, movementDirection })} />
                <span>deg</span>
            </div>
        </label> : <div className="code-inspector-field"><span className="code-movement-label-row">MOVEMENT DIRECTION <button type="button" className="code-angle-help-button" aria-label="Explain relative movement angles" title="Explain relative movement angles" onClick={() => setShowRelativeAngleHelp(true)}>i</button></span>
            <div className="code-movement-angle-input">
                <DeferredNumberInput disabled={disabled} min={MOVEMENT_DIRECTION_MIN} max={MOVEMENT_DIRECTION_MAX} step={NUMBER_STEP} value={relativeDirection} fallback={0} aria-label="Movement direction in degrees" onCommit={(movementDirection) => onChange({ ...entry, movementDirection })} />
                <span>deg</span>
            </div>
        </div>}
        {showRelativeAngleHelp && <RelativeMovementAngleModal onClose={() => setShowRelativeAngleHelp(false)} />}
    </div>;
}

function AbsoluteArenaAngleHelpButton() {
    const [open, setOpen] = useState(false);
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose: () => setOpen(false), lockScroll: true, enabled: open });
    return <>
        <button type="button" className="code-angle-help-button" aria-label="Show arena compass degrees" title="Show arena compass degrees" onClick={(event) => { event.preventDefault(); setOpen(true); }}>i</button>
        {open && createPortal(<div className="code-angle-help-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
            <section ref={dialogRef} className="code-angle-help-dialog" role="dialog" aria-modal="true" aria-labelledby="absolute-angle-help-title" tabIndex={-1}>
                <header><div><span>MOVEMENT GUIDE</span><h2 id="absolute-angle-help-title">Arena compass degrees</h2></div><button type="button" onClick={() => setOpen(false)} className="modal-close-button" aria-label="Close arena compass guide"><span aria-hidden="true">×</span></button></header>
                <ArenaDegreesCompass className="mt-4" />
            </section>
        </div>, document.body)}
    </>;
}

function RelativeMovementAngleModal({ onClose }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true });
    const examples = [
        { angle: "0°", caption: "Toward the target", className: "is-zero" },
        { angle: "90°", caption: "Right", className: "is-ninety" },
        { angle: "180°", caption: "Away from the target", className: "is-one-eighty" },
        { angle: "270°", caption: "Left", className: "is-two-seventy" },
    ];
    return createPortal(<div className="code-angle-help-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="code-angle-help-dialog" role="dialog" aria-modal="true" aria-labelledby="relative-angle-help-title" tabIndex={-1}>
            <header><div><span>MOVEMENT GUIDE</span><h2 id="relative-angle-help-title">Relative movement angles</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close relative movement angle guide"><span aria-hidden="true">×</span></button></header>
            <p>Angles are measured from the moving bot’s line to its target. It is completely relative based on that line.</p>
            <div className="code-angle-help-grid">{examples.map((example) => <article key={example.angle}><RelativeAngleDiagram className={example.className} /><strong>{example.angle}</strong><span>{example.caption}</span></article>)}</div>
            <div className="code-angle-help-relative-example"><RelativeAngleDiagram className="is-zero is-vertical" /><div><strong>Same angle, different positions</strong><p>Both diagrams show 0°. Whether the target is beside or above the bot, 0° always points directly toward it.</p></div></div>
            <small>Negative angles also work: −90° is equivalent to 270°.</small>
        </section>
    </div>, document.body);
}

function RelativeAngleDiagram({ className = "" }) {
    return <svg className={`code-angle-diagram ${className}`} viewBox="0 0 180 100" aria-hidden="true">
        <defs><marker id={`relative-angle-arrow-${className.replaceAll(" ", "-")}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
        <line className="code-angle-target-line" x1="42" y1="50" x2="138" y2="50" />
        <circle className="code-angle-bot" cx="42" cy="50" r="13" />
        <circle className="code-angle-target" cx="138" cy="50" r="13" />
        <line className="code-angle-move-arrow" x1="42" y1="50" x2="78" y2="50" markerEnd={`url(#relative-angle-arrow-${className.replaceAll(" ", "-")})`} />
        <text x="42" y="54">BOT</text><text x="138" y="54">TGT</text>
    </svg>;
}

function PhaseOrientationControls({ entry, disabled, onChange }) {
    const [showPhaseStrikeHelp, setShowPhaseStrikeHelp] = useState(false);
    const relativeDirection = Number.isFinite(Number(entry.phaseFacingMode)) ? Number(entry.phaseFacingMode) : 0;
    return <div className="code-inspector-field">
        <span className="code-movement-label-row">LANDING ROTATION (RELATIVE) <button type="button" className="code-angle-help-button" aria-label="Explain Phase Strike landing rotation" title="Explain Phase Strike landing rotation" onClick={() => setShowPhaseStrikeHelp(true)}>i</button></span>
        <div className="code-movement-angle-input">
            <DeferredNumberInput disabled={disabled} min={MOVEMENT_DIRECTION_MIN} max={MOVEMENT_DIRECTION_MAX} step={NUMBER_STEP} value={relativeDirection} fallback={0} aria-label="Phase Strike landing rotation relative to its activation facing in degrees" onCommit={(phaseFacingMode) => onChange({ ...entry, phaseFacingMode })} />
            <span>deg</span>
        </div>
        {showPhaseStrikeHelp && <PhaseStrikeLandingModal onClose={() => setShowPhaseStrikeHelp(false)} />}
    </div>;
}

function PhaseStrikeLandingModal({ onClose }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true });
    return createPortal(<div className="code-angle-help-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="code-angle-help-dialog" role="dialog" aria-modal="true" aria-labelledby="phase-strike-landing-help-title" tabIndex={-1}>
            <header><div><span>PHASE STRIKE GUIDE</span><h2 id="phase-strike-landing-help-title">Landing rotation</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close Phase Strike landing rotation guide"><span aria-hidden="true">×</span></button></header>
            <p>At 180°, Phase Strike travels forward from the activation facing, phases through the target, then lands behind it facing back toward where it came from.</p>
            <PhaseStrikeLandingDiagram />
            <div className="code-angle-help-relative-example"><div><strong>THE ROTATION HAPPENS AFTER THE HIT</strong><p>The travel direction comes from the bot’s original facing. The landing rotation is applied only after the bot reaches the far side of the target. For other values, the bot rotates by this value relative to the facing it had when the ability started.</p></div></div>
        </section>
    </div>, document.body);
}

function PhaseStrikeLandingDiagram() {
    return <svg className="code-phase-strike-diagram" viewBox="0 0 560 210" role="img" aria-label="Phase Strike at 180 degrees: the bot faces and hits the target, phases through it, then lands behind the target facing backward">
        <defs>
            <marker id="phase-strike-travel-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
            <marker id="phase-strike-facing-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
        </defs>
        <rect className="code-phase-panel" x="8" y="10" width="260" height="190" rx="3" />
        <rect className="code-phase-panel" x="292" y="10" width="260" height="190" rx="3" />
        <text className="code-phase-panel-label" x="138" y="32">BEFORE HIT</text>
        <text className="code-phase-panel-label" x="422" y="32">AFTER HIT · 180°</text>

        <line className="code-phase-lane" x1="34" y1="105" x2="242" y2="105" />
        <circle className="code-angle-bot" cx="70" cy="105" r="19" />
        <circle className="code-angle-target" cx="212" cy="105" r="19" />
        <line className="code-phase-facing" x1="70" y1="105" x2="105" y2="105" markerEnd="url(#phase-strike-facing-arrow)" />
        <line className="code-phase-travel" x1="91" y1="105" x2="190" y2="105" markerEnd="url(#phase-strike-travel-arrow)" />
        <text className="code-phase-entity-label" x="70" y="109">BOT</text>
        <text className="code-phase-entity-label" x="212" y="109">TGT</text>
        <text className="code-phase-caption" x="138" y="158">faces target · hits forward</text>

        <line className="code-phase-lane" x1="318" y1="105" x2="526" y2="105" />
        <line className="code-phase-trail" x1="318" y1="105" x2="478" y2="105" markerEnd="url(#phase-strike-travel-arrow)" />
        <circle className="code-angle-target" cx="406" cy="105" r="19" />
        <circle className="code-angle-bot" cx="490" cy="105" r="19" />
        <line className="code-phase-facing" x1="490" y1="105" x2="455" y2="105" markerEnd="url(#phase-strike-facing-arrow)" />
        <text className="code-phase-entity-label" x="406" y="109">TGT</text>
        <text className="code-phase-entity-label" x="490" y="109">BOT</text>
        <text className="code-phase-caption" x="422" y="158">lands behind · faces back</text>
    </svg>;
}

function newTreeBranch(branchType, defaultVariable, priority = 1) {
    const conditional = createConditional("always", "none");
    return {
        ...conditional,
        branchType,
        priority: normalizePriority(priority),
        conditions: branchType === "else" ? [] : [createExpressionCondition(defaultVariable)],
        actions: [],
        children: [],
    };
}

function nextBranchPriority(branches) {
    return (branches ?? []).reduce((highest, branch, index) => Math.max(highest, priorityForNode(branch, index + 1)), 0) + 1;
}

const CONDITION_PICKER_CATEGORY_ORDER = Object.freeze([
    "Basic",
    "Health & Combat",
    "Abilities & Status",
    "Position & Movement",
    "Rotation",
    "Ability Entity",
    "Match",
    "Custom Variables",
    "Other",
]);

function conditionPickerCategory(option) {
    const id = String(option?.id ?? "");
    if (id === "always") return "Basic";
    if (option?.group === "Custom Variables" || id.startsWith("custom.")) return "Custom Variables";
    if (option?.supportsAbility || option?.supportsStatusEffect) return "Abilities & Status";
    if (option?.group === "Ability Entity" || /\.(exists|count|age)$/.test(id)) return "Ability Entity";
    if (option?.group === "General") return "Match";
    if (option?.group === "Rotation") return "Rotation";
    if (option?.group === "Movement"
        || ["selectable.x", "selectable.y", "selectable.distance"].includes(id)
        || id.endsWith("edgeDistance")) return "Position & Movement";
    if (/(hp|damage|alive)/.test(id)) return "Health & Combat";
    return "Other";
}

function groupedConditionPickerOptions(options) {
    const groups = new Map();
    options.forEach((option) => {
        const category = conditionPickerCategory(option);
        const group = groups.get(category) ?? [];
        group.push(option);
        groups.set(category, group);
    });
    return CONDITION_PICKER_CATEGORY_ORDER
        .map((category) => ({ category, options: groups.get(category) ?? [] }))
        .filter((group) => group.options.length > 0);
}

function sanitizeConfigurationConditions(configuration, conditionTypes, defaultCondition, selectableTypes = null, stateVariables = STATE_VARIABLES, selectableAbilityIds = null) {
    const allowedIds = new Set(conditionTypes.map((condition) => condition.id));
    const sanitizeConditions = (conditions) => {
        if (!Array.isArray(conditions)) return conditions;
        let changed = false;
        const nextConditions = conditions.map((condition) => {
            if (condition?.type === "expression") {
                const leftDefinition = stateVariables.find((variable) => variable.id === condition.left)
                    ?? STATE_VARIABLES.find((variable) => variable.id === condition.left);
                const rightDefinition = condition.right?.type === "variable"
                    ? stateVariables.find((variable) => variable.id === condition.right.value)
                        ?? STATE_VARIABLES.find((variable) => variable.id === condition.right.value)
                    : null;
                const scopedLeftDefinition = variableWithSelectableOptions(leftDefinition, condition, 1, selectableAbilityIds);
                const scopedRightDefinition = variableWithSelectableOptions(rightDefinition, condition, 2, selectableAbilityIds);
                let nextCondition = normalizeConditionSelections(condition, scopedLeftDefinition, scopedRightDefinition);
                if (leftDefinition?.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
                    nextCondition = sanitizeExpressionSelectablePair(nextCondition, leftDefinition, selectableTypes);
                } else if (leftDefinition?.supportsSelectable) {
                    nextCondition = sanitizeExpressionSelectable(nextCondition, "leftSelectable", leftDefinition, selectableTypes);
                }
                if (rightDefinition?.supportsSelectable) {
                    nextCondition = sanitizeExpressionSelectable(nextCondition, "rightSelectable", rightDefinition, selectableTypes);
                }
                changed ||= nextCondition !== condition;
                return nextCondition;
            }
            if (allowedIds.has(condition?.type)) return condition;
            changed = true;
            return createDefaultCondition(defaultCondition, selectableTypes);
        });
        return changed ? nextConditions : conditions;
    };
    const sanitizeBranches = (branches) => {
        let branchChanged = false;
        const next = branches.map((branch) => {
            const conditions = sanitizeConditions(branch?.conditions);
            const children = Array.isArray(branch?.children) ? sanitizeBranches(branch.children) : branch?.children;
            if (conditions !== branch?.conditions || children !== branch?.children) {
                branchChanged = true;
                return { ...branch, conditions, children };
            }
            return branch;
        });
        return branchChanged ? next : branches;
    };

    let changed = false;
    const roots = Array.isArray(configuration?.roots)
        ? configuration.roots.map((rootNode) => {
            const branches = sanitizeBranches(rootNode.branches ?? []);
            if (branches !== rootNode.branches) {
                changed = true;
                return { ...rootNode, branches };
            }
            return rootNode;
        })
        : configuration?.roots;

    return changed ? { ...configuration, roots: roots } : configuration;
}

function sanitizeExpressionSelectable(condition, field, definition, selectableTypes) {
    if (!Array.isArray(selectableTypes)) return condition;
    const options = selectableOptionsForDefinition(definition, selectableTypes);
    if (!options.length) return condition;
    const requested = condition[field] ?? condition.selectable;
    const canonicalRequested = canonicalBotSelectableId(requested);
    const baseRequested = canonicalRequested.split(":")[0];
    if (options.some((selectable) => selectable.id === baseRequested)) {
        const normalized = definition.selectableOrderable === false ? baseRequested : canonicalRequested;
        return normalized === condition[field] ? condition : { ...condition, [field]: normalized };
    }
    const fallback = options.find((selectable) => selectableHasIdentity(selectable, SELECTABLE_IDENTITIES.ABILITY_ENTITY))?.id ?? options[0]?.id;
    return fallback && fallback !== condition[field] ? { ...condition, [field]: fallback } : condition;
}

function sanitizeExpressionSelectablePair(condition, definition, selectableTypes) {
    if (!Array.isArray(selectableTypes)) return condition;
    const firstOptions = selectableOptionsForDefinition(definition, selectableTypes, "first");
    const secondOptions = selectableOptionsForDefinition(definition, selectableTypes, "second");
    if (!firstOptions.length || !secondOptions.length) return condition;
    const defaults = defaultSelectablePairForVariable(definition, selectableTypes);
    const valid = (value, fallback, options) => {
        const [base, order, ordinalText] = canonicalBotSelectableId(value ?? fallback).split(":");
        const selected = options.find((selectable) => selectable.id === base);
        if (!selected) return fallback;
        if (selectableHasIdentity(selected, SELECTABLE_IDENTITIES.BOT) || definition.selectableOrderable === false) return base;
        if (!SELECTABLE_ORDERS.includes(order)) return base;
        const ordinal = Math.max(1, Math.min(100, Number(ordinalText) || 1));
        return `${base}:${order}:${ordinal}`;
    };
    const selectable1 = valid(condition.selectable1, defaults[0], firstOptions);
    const selectable2 = valid(condition.selectable2 ?? condition.selectable, defaults[1], secondOptions);
    if (condition.selectable1 === selectable1 && condition.selectable2 === selectable2) return condition;
    return { ...condition, selectable1, selectable2 };
}

function ScoreBox({ label, value, tone }) {
    const color = tone === "red" ? "text-[#ff7166]" : "text-[#57b8ff]";
    return (
        <div className="rounded border border-border-lo bg-zinc-950/50 p-2">
            <div className={`font-interface-semibold truncate ${color}`}>{label}</div>
            <div className="font-interface-numeric mt-1 text-base text-ink-white">{value}</div>
        </div>
    );
}

function PanelHeading({ icon, children }) {
    return <span className="font-display flex items-center gap-2 text-base tracking-[.09em] text-sky-300">{icon && <ToolIcon name={icon} />}{children}</span>;
}

function ToolIcon({ name }) {
    return <MatchToolIcon name={name} />;
}

function CodeTab({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`code-tab ${active ? "is-active" : ""}`}
        >
            {children}
        </button>
    );
}

function countActions(configuration) {
    return countActionSlots(configuration);
}

function countLogicConditions(configuration) {
    return countConditionSlots(configuration);
}

function createDefaultCondition(definition, selectableTypes = SELECTABLE_TYPES) {
    if (definition.id === "expression") {
        return createExpressionCondition("selectable.distance", selectableTypes);
    }
    return {
        type: definition.id,
        ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
        ...(definition.supportsSelectable ? { selectable: defaultSelectableForVariable(definition, selectableTypes) } : {}),
    };
}

function abilityIdsForConfiguration(configuration) {
    const encoded = String(configuration);
    const selected = encoded.startsWith("sandbox:") ? decodeSandboxLoadout(encoded).abilities
        : encoded.startsWith("custom:") ? decodeBotLoadout(encoded).abilities : [];
    return new Set([...STANDARD_ABILITY_IDS, ...selected]);
}

function selectableTypesForLoadouts(ownLoadout, opponentLoadout, roster = null) {
    const ownAbilities = abilityIdsForConfiguration(ownLoadout), opponentAbilities = abilityIdsForConfiguration(opponentLoadout);
    return SELECTABLE_TYPES
        .filter((selectable) => {
            if (selectable.role === "teammate" || selectable.role === "opponent") {
                const availableCount = selectable.role === "teammate"
                    ? roster?.teammateCount
                    : roster?.opponentCount;
                if (Number.isFinite(Number(availableCount))) {
                    if (Number(selectable.botIndex) > Number(availableCount)) return false;
                }
            }
            if (!selectable.abilityId) return true;
            const loadouts = selectable.role === "teammate"
                ? roster?.teammateLoadouts
                : selectable.role === "opponent" ? roster?.opponentLoadouts : null;
            if (Array.isArray(loadouts)) {
                const loadout = loadouts[Number(selectable.botIndex) - 1];
                if (loadout != null) return abilityIdsForConfiguration(loadout).has(selectable.abilityId);
            }
            return (selectable.owner === "my" ? ownAbilities : opponentAbilities).has(selectable.abilityId);
        });
}

function selectableAbilityIdsForLoadouts(ownLoadout, opponentLoadout, roster = null) {
    const result = {
        [BOT_CODE_SELECTABLES.MY]: [...abilityIdsForConfiguration(ownLoadout)],
        [BOT_CODE_SELECTABLES.OPPONENT]: [...abilityIdsForConfiguration(opponentLoadout)],
    };
    for (const selectable of SELECTABLE_TYPES) {
        if (!selectable.role || !Number.isFinite(Number(selectable.botIndex))) continue;
        const loadouts = selectable.role === "teammate"
            ? roster?.teammateLoadouts
            : roster?.opponentLoadouts;
        const loadout = Array.isArray(loadouts)
            ? loadouts[Number(selectable.botIndex) - 1]
            : null;
        if (loadout != null) result[selectable.id] = [...abilityIdsForConfiguration(loadout)];
    }
    return result;
}

function selectableOwnerLabel(selectable) {
    const bot = SELECTABLE_TYPES.find((candidate) => candidate.id === selectable?.botSelector);
    if (bot?.label) return bot.label;
    const label = String(selectable?.label ?? "");
    const marker = label.lastIndexOf(" by ");
    return marker >= 0 ? label.slice(marker + 4) : selectable?.botSelector ?? "Owner";
}

function entitySelectableGroups(selectableTypes = SELECTABLE_TYPES) {
    const groups = [];
    const groupsByEntityType = new Map();
    for (const selectable of selectableTypes ?? []) {
        if (selectable?.kind !== "entity") continue;
        const entityType = String(selectable.entityType ?? "").trim();
        if (!entityType) continue;
        let group = groupsByEntityType.get(entityType);
        if (!group) {
            group = {
                entityType,
                label: String(selectable.label ?? entityType).replace(/\s+by\s+.+$/, ""),
                baseId: null,
                owners: [],
            };
            groupsByEntityType.set(entityType, group);
            groups.push(group);
        }
        if (selectable.owner === SELECTABLE_OWNERS.NONE) {
            group.baseId = selectable.id;
            continue;
        }
        if (!selectable.botSelector || group.owners.some((owner) => owner.id === selectable.botSelector)) continue;
        group.owners.push({
            id: selectable.botSelector,
            label: selectableOwnerLabel(selectable),
            selectableId: selectable.id,
        });
    }
    return groups;
}

function selectableOrderLabel(order) {
    return order.charAt(0).toUpperCase() + order.slice(1);
}

function OrderedSelectablePicker({ value = BOT_CODE_SELECTABLES.OPPONENT, selectableTypes = SELECTABLE_TYPES, disabled = false, allowOrdering = true, onChange }) {
    const availableSelectableTypes = Array.isArray(selectableTypes) ? selectableTypes : SELECTABLE_TYPES;
    const pickerModel = actionSelectablePickerModel(value, availableSelectableTypes);
    const targetPresentation = pickerModel.target;
    if (!targetPresentation.available) {
        const options = pickerModel.replacementOptions;
        return <div className="code-selectable-picker is-unavailable">
            <div className="code-selectable-picker-unavailable" role="status" aria-live="polite">
                <strong>{pickerModel.statusLabel}</strong>
                <small>{pickerModel.statusMessage}</small>
            </div>
            <div className="code-selectable-picker-control">
                <span>REPLACEMENT TARGET</span>
                <select className="code-selectable-picker-entity" disabled={disabled || options.length === 0} aria-label="Replacement target" value={pickerModel.selectValue} onChange={(event) => {
                    const replacement = encodeSelectableReplacement(event.target.value, availableSelectableTypes);
                    if (replacement != null) onChange(replacement);
                }}>
                    <option value="" disabled>{pickerModel.replacementPlaceholder}</option>
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
        </div>;
    }
    const baseValue = targetPresentation.baseId;
    const base = baseValue;
    const order = targetPresentation.order ?? SELECTABLE_ORDERS[0];
    const ordinal = targetPresentation.ordinal;
    const entityGroups = entitySelectableGroups(availableSelectableTypes);
    const selectedSelectable = targetPresentation.definition;
    const selectedEntityGroup = selectedSelectable?.kind === "entity"
        ? entityGroups.find((group) => group.entityType === selectedSelectable.entityType)
        : null;
    const botOptions = availableSelectableTypes.filter((selectable) => selectable.kind === "bot");
    const ownerOptions = selectedEntityGroup?.owners ?? [];
    const selectedOwner = ownerOptions.find((owner) => owner.selectableId === base) ?? ownerOptions[0];
    const ordered = allowOrdering && Boolean(selectedEntityGroup);
    const encode = (nextBase, nextOrder = order, nextOrdinal = ordinal) => !allowOrdering || selectableHasIdentity(availableSelectableTypes.find((selectable) => selectable.id === nextBase), SELECTABLE_IDENTITIES.BOT)
        ? nextBase
        : `${nextBase}:${nextOrder}:${Math.max(1, Math.min(100, Number(nextOrdinal) || 1))}`;
    const encodeEntity = (entityType, ownerId = selectedOwner?.id, nextOrder = order, nextOrdinal = ordinal) => {
        const group = entityGroups.find((candidate) => candidate.entityType === entityType);
        const owner = group?.owners.find((candidate) => candidate.id === ownerId) ?? group?.owners[0];
        const nextBase = owner?.selectableId ?? group?.baseId ?? entityType;
        return encode(nextBase, nextOrder, nextOrdinal);
    };
    const handlePrimaryChange = (nextValue) => {
        const entityGroup = entityGroups.find((group) => group.entityType === nextValue);
        onChange(entityGroup ? encodeEntity(nextValue) : encode(nextValue));
    };
    const selectableValue = selectedEntityGroup?.entityType ?? base;
    const entityOptions = entityGroups.map((group) => <option key={group.entityType} value={group.entityType}>{group.label}</option>);
    const botOptionElements = botOptions.map((selectable) => <option key={selectable.id} value={selectable.id}>{selectable.label.replace(/^Closest /, "")}</option>);
    const primaryOptions = botOptions.length > 0 && entityOptions.length > 0
        ? <><optgroup label="Bots">{botOptionElements}</optgroup><optgroup label="Entities">{entityOptions}</optgroup></>
        : <>{botOptionElements}{entityOptions}</>;
    return <div className={`code-selectable-picker ${ordered ? "is-ordered" : ""}`}>
        {selectedEntityGroup
            ? <>
                <div className="code-selectable-picker-entity-row">
                    <div className="code-selectable-picker-control">
                        <span>ABILITY NAME</span>
                        <select disabled={disabled} aria-label="Selectable entity" value={selectableValue} onChange={(event) => handlePrimaryChange(event.target.value)} className="code-selectable-picker-entity">{primaryOptions}</select>
                    </div>
                    {ownerOptions.length > 0 && <div className="code-selectable-picker-control">
                        <span>BY</span>
                        <select disabled={disabled} aria-label="Selectable owner" value={selectedOwner?.id ?? ""} onChange={(event) => onChange(encodeEntity(selectedEntityGroup.entityType, event.target.value))} className="code-selectable-picker-owner">{ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select>
                    </div>}
                </div>
            </>
            : <select disabled={disabled} aria-label="Selectable" value={selectableValue} onChange={(event) => handlePrimaryChange(event.target.value)} className="code-selectable-picker-entity">
                {primaryOptions}
            </select>}
        {ordered && <div className="code-selectable-picker-order">
            <div className="code-selectable-picker-control">
                <span>ATTRIBUTE</span>
                <select disabled={disabled} aria-label="Selectable ordering" value={order} onChange={(event) => onChange(encode(selectedOwner?.selectableId ?? base, event.target.value))}>{SELECTABLE_ORDERS.map((option) => <option key={option} value={option}>{selectableOrderLabel(option)}</option>)}</select>
            </div>
            <div className="code-selectable-picker-control">
                <span>ORDER #</span>
                <DeferredNumberInput disabled={disabled} aria-label="Selectable ordinal" min={1} max={100} value={ordinal} fallback={1} onCommit={(value) => onChange(encode(selectedOwner?.selectableId ?? base, order, value))} />
            </div>
        </div>}
        {ordered && <small className="code-selectable-picker-note">Closest 1 means the 1st closest entity. It chooses the closest entity to you.</small>}
    </div>;
}

function formatSelectableLabel(value, selectableTypes = SELECTABLE_TYPES) {
    return resolveSelectableTarget(value, selectableTypes).description;
}

function formatActionNodeLabel(label) {
    return label.replace(/^(?:Move|Movement|Rotate|Ability):\s*/, "");
}

function selectableOptionsForDefinition(definition, selectableTypes = SELECTABLE_TYPES, selectorRole = "selectable") {
    const pairSlot = selectorRole === "first" || selectorRole === "entity" ? 0
        : selectorRole === "second" ? 1 : null;
    return selectableTypes.filter((selectable) => selectableMatchesVariable(selectable, definition, pairSlot));
}

function selectableHasIdentity(selectable, identity) {
    return selectable?.selectableIdentities?.includes(identity) ?? false;
}

function selectableSelectorLabel(definition, pairSlot = null) {
    if (definition?.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
        return definition.selectableSelectorLabels?.[pairSlot] ?? "Entity";
    }
    if (definition?.supportsAbility) return "Bot Entity";
    return "Entity";
}

function variableWithSelectableOptions(definition, condition, operand, selectableAbilityIds) {
    if (!definition || !definition.selectableDependency) return definition;
    const selectableId = abilitySelectableIdForVariable(definition, condition, operand);
    const selectableAbilities = abilityIdsForSelectable(selectableAbilityIds, selectableId);
    if (!selectableAbilities) return definition;

    const available = new Set(selectableAbilities);
    const visibleAbilityIds = Array.isArray(definition.abilityOptions) && definition.abilityOptions.length
        ? new Set(definition.abilityOptions.map((ability) => ability.id))
        : null;
    const abilityOptions = definition.selectableDependency === SELECTABLE_DEPENDENCIES.ABILITY_LOADOUT
        ? abilityDefinitionsForVariable(definition, available)
            .filter((ability) => !visibleAbilityIds || visibleAbilityIds.has(ability.id))
        : definition.abilityOptions;
    return {
        ...definition,
        ...(definition.selectableDependency === SELECTABLE_DEPENDENCIES.ABILITY_LOADOUT ? { abilityOptions } : {}),
    };
}

function abilitySelectableIdForVariable(definition, condition, operand) {
    const selected = operand === 2
        ? condition?.rightSelectable ?? condition?.selectable
        : condition?.leftSelectable ?? condition?.selectable;
    return String(selected ?? definition?.defaultSelectable ?? BOT_CODE_SELECTABLES.MY).split(":")[0];
}

function abilityIdsForSelectable(selectableAbilityIds, selectableId) {
    if (!selectableAbilityIds || !selectableId) return null;
    const configured = selectableAbilityIds[selectableId]
        ?? selectableAbilityIds[canonicalBotSelectableId(selectableId)];
    if (configured instanceof Set) return configured;
    if (Array.isArray(configured)) return configured;
    return null;
}

function selectedAbilityOptionValue(value, options = []) {
    const selected = abilityIdFromBoundary(value);
    return options.some((option) => option.id === selected) ? selected : options[0]?.id ?? "";
}

function selectedStatusOptionValue(value, options = []) {
    const selected = String(value ?? "").trim().toLowerCase();
    return options.find((option) => option.id === selected || option.label.toLowerCase() === selected)?.id
        ?? options[0]?.id ?? "";
}

function normalizeStatusEffectSelection(value, options = []) {
    return selectedStatusOptionValue(value, options);
}

function formatClock(value) {
    if (value == null) return "--:--";
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export {
    DeferredNumberInput,
    buildLogicGraph,
    graphNodeStyle,
    treeBranchAt,
    mapBranchAt,
    updateTreeBranch,
    normalizeSiblingTypes,
    graphBranchActions,
    setGraphActions,
    addGraphAction,
    NodeKindPicker,
    VariableOperandPicker,
    variableActionTerms,
    VariableActionControls,
    VariableActionExpression,
    ConditionalOperandBox,
    ActionVariableInspector,
    GraphRootNode,
    GraphConditionNode,
    PuzzleConditionNode,
    GraphActionNode,
    LogicNodeInspector,
    conditionalKindLabel,
    TutorialLogicInspector,
    conditionGraphNodeId,
    actionGraphNodeId,
    newTreeBranch,
    nextBranchPriority,
    countActions,
    countLogicConditions,
    abilityIdsForConfiguration,
    selectableAbilityIdsForLoadouts,
    selectableTypesForLoadouts,
    sanitizeConfigurationConditions,
    PanelHeading,
    ScoreBox,
    ToolIcon,
    CodeTab,
    formatClock,
    clamp,
};

export { graphEdgePath } from "../graphEdgeGeometry.js";
