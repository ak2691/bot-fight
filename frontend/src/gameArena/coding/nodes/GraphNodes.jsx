/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import {
    ACTION_TYPES,
    TARGET_TYPES,
    CONDITION_COMPARATORS,
    STATE_VARIABLES,
    actionExecutionHead,
    actionSupportsTarget,
    createLogicBlock as createConditional,
    createExpressionCondition,
    defaultTargetForVariable,
    normalizeConditionSelections,
    CUSTOM_NUMBER_MIN,
    CUSTOM_NUMBER_MAX,
    NUMBER_STEP,
    truncateToNumberPrecision,
    CUSTOM_VARIABLE_OPERATIONS,
    VARIABLE_TAGS,
    TARGET_CAPABILITIES,
    BOT_CODE_ACTIONS,
    MAX_CONDITIONS_PER_BRANCH,
    MAX_LOGIC_BLOCKS,
    MAX_VARIABLE_ACTION_TERMS,
    countActionSlots,
    countConditionSlots,
} from "../../botlogic/code/BotCode.js";
import { absoluteMovementAngle, relativeMovementAngle } from "../../botlogic/planner/arenaAngles.js";
import { MOVEMENT_DIRECTION_MAX, MOVEMENT_DIRECTION_MIN } from "../../botlogic/code/contracts/BotLogicContracts.js";
import { actionTypesForLoadout } from "../../gameconfig/CombatLoadouts.js";
import { abilityIdFromBoundary } from "../../gameconfig/AbilityCompatibility.js";
import { STANDARD_ABILITY_IDS, decodeBotLoadout, decodeSandboxLoadout } from "../../loadout/BotLoadout.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import RootNodePriorityInput from "../controls/RootNodePriorityInput.jsx";
import MatchToolIcon from "../controls/MatchToolIcon.jsx";

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

function DeferredNumberInput({ value, onCommit, min = CUSTOM_NUMBER_MIN, max = CUSTOM_NUMBER_MAX, fallback = 0, step = NUMBER_STEP, roundDown = false, integerOnly = false, digitsOnly = false, ...props }) {
    const [draft, setDraft] = useState(String(value ?? fallback));
    const inputRef = useRef(null);
    const externalValueRef = useRef(String(value ?? fallback));
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
    return <input {...props} ref={inputRef} type="text" inputMode={digitsOnly || integerOnly || step >= 1 ? "numeric" : "decimal"} pattern={digitsOnly ? "[0-9]*" : undefined} value={draft} onChange={(event) => setDraft(digitsOnly ? event.target.value.replace(/[^0-9]/g, "") : event.target.value)} onClick={(event) => event.currentTarget.select()} onBlur={commit} onKeyDown={(event) => {
        if ((digitsOnly && event.key.length === 1 && !/[0-9]/.test(event.key)) || (integerOnly && [".", ",", "e", "E"].includes(event.key))) {
            event.preventDefault();
            return;
        }
        if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
    }} />;
}

const GRAPH_NODE_WIDTH = 380;
const GRAPH_NODE_GAP = 72;
const ROOT_NODE_HEIGHT = 144;

function conditionNodeWidth(branch, stateVariables) {
    const labelFor = (id) => stateVariables.find((variable) => variable.id === id)?.label ?? id ?? "Input";
    return clamp(Math.max(...(branch.conditions ?? []).map((condition) => {
        if (condition.type === "always") return GRAPH_NODE_WIDTH;
        const leftLength = labelFor(condition.left).length;
        const rightLength = condition.right?.type === "variable"
            ? labelFor(condition.right.value).length
            : 8;
        const leftWidth = 39 + leftLength * 5.5;
        const rightWidth = condition.right?.type === "variable"
            ? 39 + rightLength * 5.5
            : 110;
        return 175 + leftWidth + rightWidth;
    }), GRAPH_NODE_WIDTH), GRAPH_NODE_WIDTH, 1200);
}

function actionNodeWidth(entry, selectedLoadout, targetTypes) {
    const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const describedTarget = formatActionTargetLabel(entry, selected, targetTypes);
    const actionLabel = formatActionNodeLabel(selected?.label ?? "Action");
    if (!describedTarget) return Math.max(160, Math.ceil(actionLabel.length * 6.6 + 63));
    return Math.max(160, Math.ceil(Math.max(actionLabel.length, `Target: ${describedTarget}`.length) * 6.6 + 63));
}

function buildLogicGraph(roots, stateVariables = STATE_VARIABLES, selectedLoadout = null, targetTypes = TARGET_TYPES) {
    const graph = { roots: [], conditions: [], actions: [], variables: [], targets: [], edges: [], width: 0, height: 0 };
    let forestX = 80;
    const measureBranch = (branch) => {
        const actions = graphBranchActions(branch);
        const childWidth = (branch.children ?? []).reduce((sum, child) => sum + measureBranch(child), 0);
        const nodeWidth = conditionNodeWidth(branch, stateVariables);
        const actionWidth = actions.reduce((sum, entry) => sum + actionNodeWidth(entry, selectedLoadout, targetTypes) + GRAPH_NODE_GAP, 0);
        return Math.max(nodeWidth + GRAPH_NODE_GAP, actionWidth + childWidth);
    };
    const measureLevel = (branches) => Math.max(GRAPH_NODE_WIDTH + GRAPH_NODE_GAP, (branches ?? []).reduce((sum, branch) => sum + measureBranch(branch), 0));
    const addBranch = (branch, rootIndex, rootId, path, left, y, parent) => {
        const width = measureBranch(branch);
        const actions = graphBranchActions(branch);
        const descendantsWidth = actions.reduce((sum, entry) => sum + actionNodeWidth(entry, selectedLoadout, targetTypes) + GRAPH_NODE_GAP, 0)
            + (branch.children ?? []).reduce((sum, child) => sum + measureBranch(child), 0);
        const conditionHeight = 94 + Math.max(1, Array.isArray(branch.conditions) ? branch.conditions.length : 1) * 42;
        const nodeWidth = conditionNodeWidth(branch, stateVariables);
        const condition = { id: conditionGraphNodeId(branch.id, rootId), rootId, branchId: branch.id, rootIndex, path, x: left + width / 2 - nodeWidth / 2, y, width: nodeWidth, height: conditionHeight, priority: Number(branch.createdOrder) + 1 };
        graph.conditions.push(condition);
        graph.edges.push({ id: `${parent.id}->${condition.id}`, fromId: parent.id, toId: condition.id, x1: parent.x + parent.width / 2, y1: parent.y + parent.height, x2: condition.x + condition.width / 2, y2: condition.y });
        // Keep the action/child row centered under its conditional when the
        // conditional is wider than its descendants (notably a lone Walk).
        let childX = left + Math.max(0, (width - descendantsWidth) / 2);
        const childY = y + conditionHeight + 70;
        actions.forEach((entry, actionIndex) => {
            const actionWidth = actionNodeWidth(entry, selectedLoadout, targetTypes);
            const action = { id: actionGraphNodeId(branch.id, actionIndex, rootId), rootId, branchId: branch.id, rootIndex, path, actionIndex, x: childX + GRAPH_NODE_GAP / 2, y: childY, width: actionWidth, height: 54 };
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
        const rootGraphNode = { id: `rootNode:${rootId}`, rootId, rootIndex, x: forestX + treeWidth / 2 - 150, y: 50, width: 300, height: ROOT_NODE_HEIGHT };
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

function graphEdgePath(edge, offsets) {
    const from = offsets[edge.fromId] ?? { x: 0, y: 0 };
    const to = offsets[edge.toId] ?? { x: 0, y: 0 };
    const x1 = edge.x1 + from.x;
    const y1 = edge.y1 + from.y;
    const x2 = edge.x2 + to.x;
    const y2 = edge.y2 + to.y;
    return `M ${x1} ${y1} C ${x1} ${y1 + 70}, ${x2} ${y2 - 70}, ${x2} ${y2}`;
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
    return branch?.action && branch.action !== "none" ? [{ action: branch.action, actionTarget: branch.actionTarget ?? "opponent" }] : [];
}

function setGraphActions(branch, actions) {
    const first = actions[0] ?? { action: "none", actionTarget: "opponent" };
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
        actionTarget: "opponent",
        ...(next.variableAction ? {
            variableId: customVariables[0]?.id ?? "",
            operation: "set",
            ...(customVariables[0]?.valueType === "boolean"
                ? { value: false }
                : { terms: [{ operator: "set", operand: { type: "number", value: 0 } }] }),
        } : {}),
    }]);
}

function NodeKindPicker({ selectedLoadout, onCancel, onChooseAction }) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);
    const pickerRef = useRef(null);
    const searchInputRef = useRef(null);
    const optionRefs = useRef([]);
    useExclusiveSearchMenu(pickerRef, true, onCancel);
    useEffect(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, []);
    const actionOptions = actionTypesForLoadout(ACTION_TYPES, selectedLoadout).filter((action) => action.id !== "none");
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredActions = actionOptions.filter((action) => !normalizedQuery || `${action.label} ${action.id}`.toLocaleLowerCase().includes(normalizedQuery));
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
    const title = "ADD ACTION NODE";
    return <div ref={pickerRef} className="code-node-picker code-node-picker--action absolute left-20 top-4 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl" role="dialog" aria-label={title} data-node-drag-ignore="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3"><strong className="tracking-[.12em] text-cyan-200">{title}</strong><button type="button" onClick={onCancel} className="modal-close-button" aria-label={`Close ${title}`}><span aria-hidden="true">×</span></button></div>
        <label className="code-node-search-label"><span className="sr-only">Search actions</span><input ref={searchInputRef} autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); optionRefs.current = []; }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } else moveFromSearch(event); }} placeholder="Search actions…" /></label>
        <div className="code-node-search-results">{filteredActions.map((action, index) => <button ref={(element) => { optionRefs.current[index] = element; }} key={action.id} tabIndex={index === activeIndex ? 0 : -1} className={index === activeIndex ? "is-keyboard-active" : ""} type="button" onKeyDown={(event) => moveFromOption(event, index)} onClick={() => onChooseAction(action.id)}><strong>{action.label}</strong></button>)}{!filteredActions.length && <p>No actions match “{query}”.</p>}</div>
    </div>;
}

function VariableOperandPicker({ operand, stateVariables, numericOnly = false, onChoose, onClose }) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);
    const pickerRef = useRef(null);
    const searchInputRef = useRef(null);
    const optionRefs = useRef([]);
    useExclusiveSearchMenu(pickerRef, true, onClose);
    useEffect(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, []);
    const normalized = query.trim().toLocaleLowerCase();
    const compatibleDefinitions = stateVariables.filter((variable) => !numericOnly && operand !== 2 || variable.valueType === "number");
    const matches = (label, id) => !normalized || `${label} ${id}`.toLocaleLowerCase().includes(normalized);
    const showAlways = operand === 1 && !numericOnly && matches("ALWAYS", "always");
    const definitions = [
        ...(showAlways ? [{ id: "always", label: "ALWAYS", valueType: "boolean" }] : []),
        ...compatibleDefinitions.filter((definition) => matches(definition.label, definition.id)),
    ];
    const groupedDefinitions = groupedConditionPickerOptions(definitions);
    const moveFromSearch = (event) => {
        if (event.key === "Enter" && definitions.length) {
            event.preventDefault();
            onChoose(definitions[0].id);
            return;
        }
        if (event.key !== "ArrowDown" || !definitions.length) return;
        event.preventDefault();
        setActiveIndex(0);
        optionRefs.current[0]?.focus();
    };
    const moveFromOption = (event, index) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (index + 1) % definitions.length;
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
            const definition = definitions[index];
            if (definition) onChoose(definition.id);
        }
    };
    const title = "ADD VARIABLE INPUT";
    return <div ref={pickerRef} className="code-node-picker code-node-picker--variable absolute left-20 top-4 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl" role="dialog" aria-label={title} data-node-drag-ignore="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3"><strong className="tracking-[.12em] text-cyan-200">{title}</strong><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close variable search"><span aria-hidden="true">×</span></button></div>
        <label className="code-node-search-label"><span className="sr-only">Search variables</span><input ref={searchInputRef} autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); optionRefs.current = []; }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } else moveFromSearch(event); }} placeholder="Search variables…" /></label>
        <div className="code-node-search-results">{groupedDefinitions.map((group) => <section className="code-node-search-group" key={group.category}><h3 className="code-node-search-group-title">{group.category}</h3>{group.options.map((definition) => { const index = definitions.indexOf(definition); return <button ref={(element) => { optionRefs.current[index] = element; }} key={definition.id} tabIndex={index === activeIndex ? 0 : -1} className={index === activeIndex ? "is-keyboard-active" : ""} type="button" onKeyDown={(event) => moveFromOption(event, index)} onClick={() => onChoose(definition.id)}><strong>{definition.label}</strong><small>{definition.valueType === "boolean" ? "TRUE / FALSE" : "NUMBER"}</small></button>; })}</section>)}{!definitions.length && <p>No variables match “{query}”.</p>}</div>
    </div>;
}

function ConditionalOperandBox({ operand, condition, stateVariables, disabled, selected, onPickVariable, onInspectVariable, onOpenVariablePicker, onUseRawNumber, onNumberChange, onBooleanChange, numberDefinition = null, tutorialFocus = false }) {
    const variableDefinition = operand === 1
        ? stateVariables.find((variable) => variable.id === condition.left)
        : condition.right?.type === "variable" ? stateVariables.find((variable) => variable.id === condition.right.value) : null;
    const variableLabel = variableDefinition?.label;
    const rawBoolean = operand === 2 && condition.right?.type === "boolean";
    const rawNumber = operand === 2 && condition.right?.type === "number";
    const numberSuffix = numberDefinition?.suffix;
    const signedNumber = numberSuffix === "deg" || numberDefinition?.tags?.includes(VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER);
    const numberStep = numberDefinition?.step ?? NUMBER_STEP;
    const integerNumber = numberStep >= 1;
    return <div className={`code-condition-input ${variableLabel ? "is-variable" : "is-raw"} ${tutorialFocus ? "tutorial-control-focus" : ""}`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        {variableLabel ? <button type="button" className={`code-condition-input-value ${selected ? "is-selected" : ""}`} onClick={onOpenVariablePicker ?? onInspectVariable} aria-label={`Configure ${variableLabel}`}>{variableLabel}{operand === 2 && variableDefinition.suffix && <span className="code-condition-input-unit">{variableDefinition.suffix}</span>}</button>
            : rawBoolean ? <select data-node-drag-ignore="true" aria-label={`Input ${operand} boolean value`} disabled={disabled} value={String(condition.right.value)} onChange={(event) => onBooleanChange(event.target.value === "true")} className="code-operator-socket code-condition-boolean-input"><option value="true">TRUE</option><option value="false">FALSE</option></select>
            : rawNumber ? <><DeferredNumberInput digitsOnly={integerNumber && !signedNumber} integerOnly={integerNumber} data-node-drag-ignore="true" aria-label={`Input ${operand} number`} disabled={disabled} min={numberDefinition?.min ?? CUSTOM_NUMBER_MIN} max={numberDefinition?.max ?? CUSTOM_NUMBER_MAX} step={numberStep} value={condition.right.value} onCommit={onNumberChange} />{numberSuffix && <span className="code-condition-input-unit">{numberSuffix}</span>}</>
            : <span className="code-condition-input-placeholder">INPUT {operand}</span>}
        {variableLabel && operand === 2
            ? <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onUseRawNumber} aria-label={`Use a raw number for input ${operand}`} title="Use a raw number"><span aria-hidden="true">−</span></button>
            : <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onPickVariable} aria-label={`Use a variable for input ${operand}`} title="Choose a variable"><span aria-hidden="true">+</span></button>}
    </div>;
}

function GraphConditionNode({ node, branch, disabled, canRemove, canAddAction, canAddCondition, maxConditions = MAX_CONDITIONS_PER_BRANCH, stateVariables, defaultVariable, targetTypes, nodeOffsets, beginNodeDrag, selected, standalone = false, puzzleMode = false, puzzleLabel = "Conditional", onSelect, onPriorityChange, onPickVariable, onOpenVariablePicker, onInspectVariable, onUseRawNumber, onRemoveCondition, inspectedVariable, onChange, onRemove, onAddParentConditional, onAddChildConditional, onAddAction, tutorialFocus }) {
    const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
    const updateCondition = (rowIndex, updater) => onChange({ conditions: conditions.map((condition, index) => index === rowIndex ? updater(condition) : condition) });
    const addJoinedCondition = (join) => onChange({ conditions: [...conditions, { ...createExpressionCondition(defaultVariable, targetTypes), ...(join === "or" ? { join: "or" } : {}) }] });
    return <section onClick={onSelect} onPointerDown={(event) => { if (!standalone) beginNodeDrag(event, node.id); }} className={`code-graph-node code-graph-node--conditional ${standalone ? "relative w-full" : "absolute"} rounded-sm border bg-zinc-950 shadow-2xl ${selected ? "is-inspected" : ""}`} style={standalone ? { width: "100%" } : { ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <header className="code-compact-header code-node-header--conditional">
            {standalone || puzzleMode ? <span className="min-w-0 flex-1 truncate text-sky-100">{puzzleLabel}</span> : <><span className="code-node-badge">{node.path.length}</span><span className="min-w-0 flex flex-1 items-center gap-1 truncate text-sky-100">Conditional <RootNodePriorityInput priority={Number(branch.createdOrder) + 1} max={MAX_LOGIC_BLOCKS} disabled={disabled} onCommit={onPriorityChange} ariaLabel={`Priority for Conditional ${Number(branch.createdOrder) + 1}`} className="code-conditional-priority" /></span><button type="button" data-node-drag-ignore="true" className="code-conditional-add-button" disabled={disabled || !canAddCondition} onClick={(event) => { event.stopPropagation(); onAddParentConditional(); }}>+IF</button></>}
        </header>
        <div className="space-y-2 p-3">
            {conditions.map((condition, index) => {
                const leftDefinition = stateVariables.find((variable) => variable.id === condition.left) ?? defaultVariable;
                const comparators = CONDITION_COMPARATORS.filter((candidate) => candidate.valueTypes.includes(leftDefinition.valueType));
                const comparator = comparators.some((candidate) => candidate.id === condition.comparator) ? condition.comparator : comparators[0]?.id ?? "eq";
                return <div key={`${index}-${condition.type}`} className="code-compact-condition-wrap">
                    <div className="code-compact-condition">
                    <span data-node-drag-ignore="true" className="code-condition-prefix font-mono text-[9px] text-amber-200">{index ? (condition.join === "or" ? "OR" : "AND") : "IF"}</span>
                    {condition.type === "always" ? <button type="button" data-node-drag-ignore="true" className="code-condition-socket col-span-3" disabled={disabled} onClick={(event) => { event.stopPropagation(); onPickVariable(index, 1); }} aria-label={`Choose a variable for condition ${index + 1}`}>ALWAYS</button> : <><ConditionalOperandBox operand={1} condition={condition} stateVariables={stateVariables} disabled={disabled} selected={inspectedVariable?.rowIndex === index && inspectedVariable?.operand === 1} onPickVariable={() => onPickVariable(index, 1)} onOpenVariablePicker={onOpenVariablePicker ? () => onOpenVariablePicker(index, 1) : null} onInspectVariable={() => onInspectVariable(index, 1)} tutorialFocus={tutorialFocus === "add-condition" && index === 0} /><select data-node-drag-ignore="true" aria-label="Comparator" disabled={disabled} value={comparator} onClick={(event) => event.stopPropagation()} onChange={(event) => updateCondition(index, (current) => ({ ...current, comparator: event.target.value }))} className="code-operator-socket">{comparators.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select><ConditionalOperandBox operand={2} condition={condition} stateVariables={stateVariables} numberDefinition={leftDefinition} disabled={disabled} selected={inspectedVariable?.rowIndex === index && inspectedVariable?.operand === 2} onPickVariable={() => onPickVariable(index, 2)} onOpenVariablePicker={onOpenVariablePicker ? () => onOpenVariablePicker(index, 2) : null} onInspectVariable={() => onInspectVariable(index, 2)} onUseRawNumber={() => onUseRawNumber(index)} onNumberChange={(value) => updateCondition(index, (current) => ({ ...current, right: { type: "number", value } }))} onBooleanChange={(value) => updateCondition(index, (current) => ({ ...current, right: { type: "boolean", value } }))} /></>}
                    <button type="button" data-node-drag-ignore="true" className="code-condition-row-remove" disabled={disabled} onClick={(event) => { event.stopPropagation(); onRemoveCondition(index); }} aria-label={`Remove condition ${index + 1}`} title="Remove condition">×</button>
                    </div>
                </div>;
            })}
        </div>
        <footer className="code-compact-footer">
            <button type="button" data-node-drag-ignore="true" disabled={disabled || !canAddCondition || conditions.length >= maxConditions} onClick={(event) => { event.stopPropagation(); addJoinedCondition("and"); }}>+ AND</button>
            <button type="button" data-node-drag-ignore="true" disabled={disabled || !canAddCondition || conditions.length >= maxConditions} onClick={(event) => { event.stopPropagation(); addJoinedCondition("or"); }}>+ OR</button>
            {!standalone && !puzzleMode && <><button type="button" data-node-drag-ignore="true" className="code-conditional-add-button" disabled={disabled || !canAddCondition} onClick={(event) => { event.stopPropagation(); onAddChildConditional(); }}>+ IF</button>
                <button type="button" data-node-drag-ignore="true" className={`code-action-add-button ${tutorialFocus === "add-action" && !graphBranchActions(branch).length ? "tutorial-control-focus" : ""}`} disabled={disabled || !canAddAction} onClick={(event) => { event.stopPropagation(); onAddAction(); }}>+ ACTION</button>
                <button type="button" data-node-drag-ignore="true" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-condition-node-remove" aria-label="Remove conditional node" title="Remove conditional node">×</button></>}
            {!standalone && puzzleMode && <button type="button" data-node-drag-ignore="true" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-condition-node-remove" aria-label="Remove puzzle condition" title="Remove puzzle condition">×</button>}
        </footer>
    </section>;
}

function PuzzleConditionNode({ title, conditions = [], stateVariables = STATE_VARIABLES, defaultVariable = STATE_VARIABLES[0], targetTypes = TARGET_TYPES, maxConditions = MAX_CONDITIONS_PER_BRANCH, onChange, onRemoveCondition }) {
    const [operandPicker, setOperandPicker] = useState(null);
    const [inspectedVariable, setInspectedVariable] = useState(null);
    const node = { id: `puzzle-condition:${title}`, rootId: `puzzle-condition:${title}`, rootIndex: 0, path: [0], width: 0 };
    const branch = { id: `puzzle-condition-branch:${title}`, branchType: "if", createdOrder: 0, conditions, actions: [], children: [] };
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
        const definition = stateVariables.find((variable) => variable.id === variableId);
        if (!definition || (operand === 2 && definition.valueType !== "number")) return;
        updateConditions(conditions.map((condition, index) => {
            if (index !== rowIndex) return condition;
            if (operand === 2) {
                return {
                    ...condition,
                    right: { type: "variable", value: definition.id },
                    ...(definition.supportsTarget ? { rightTarget: defaultTargetForVariable(definition, targetTypes) } : {}),
                };
            }
            const replacement = createExpressionCondition(definition, targetTypes);
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
            targetTypes={targetTypes}
            nodeOffsets={{}}
            beginNodeDrag={() => {}}
            selected={false}
            standalone
            puzzleLabel={title}
            onSelect={() => {}}
            onPriorityChange={() => {}}
            onPickVariable={openVariablePicker}
            onInspectVariable={(rowIndex, operand) => { setOperandPicker(null); setInspectedVariable({ kind: "condition-variable", id: node.id, rowIndex, operand }); }}
            onUseRawNumber={(rowIndex) => updateConditions(conditions.map((condition, index) => {
                if (index !== rowIndex) return condition;
                const next = { ...condition, right: { type: "number", value: 0 } };
                delete next.rightTarget;
                return next;
            }))}
            onRemoveCondition={removeCondition}
            inspectedVariable={inspectedVariable}
            onChange={({ conditions: nextConditions }) => updateConditions(nextConditions)}
            onRemove={() => {}}
            onAddParentConditional={() => {}}
            onAddChildConditional={() => {}}
            onAddAction={() => {}}
        />
        {operandPicker && <VariableOperandPicker operand={operandPicker.operand} stateVariables={stateVariables} numericOnly={operandPicker.operand === 2} onChoose={chooseOperandVariable} onClose={() => setOperandPicker(null)} />}
        {inspectedVariable && <LogicNodeInspector
            inspectedNode={inspectedVariable}
            graph={graph}
            roots={roots}
            stateVariables={stateVariables}
            targetTypes={targetTypes}
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

function GraphActionNode({ node, entry, disabled, selectedLoadout, targetTypes, nodeOffsets, beginNodeDrag, selectedNode, onInspect, onRemove, canRemove = true, puzzleMode = false }) {
    const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const describedTarget = formatActionTargetLabel(entry, selected, targetTypes);
    return <section onClick={onInspect} onPointerDown={(event) => beginNodeDrag(event, node.id)} className={`code-graph-node code-graph-node--action absolute rounded-sm border shadow-2xl ${selectedNode ? "is-inspected" : ""}`} style={{ ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <header className="code-action-bar code-node-header--action">
            <span className="code-action-label">{formatActionNodeLabel(selected?.label ?? "Action")}</span>
            {describedTarget && <span className="code-action-target">Target: {describedTarget}</span>}
        </header>
        {(!puzzleMode || canRemove) && <button type="button" data-node-drag-ignore="true" disabled={disabled || (puzzleMode && !canRemove)} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-compact-remove code-condition-node-remove" aria-label="Remove action">×</button>}
    </section>;
}

function LogicNodeInspector({ inspectedNode, graph, roots, stateVariables, targetTypes, selectedLoadout, customVariables, disabled, canRemove, canAddAction, puzzleMode = false, onClose, updateBranch, onPickActionOperand, onInspectActionOperand, onDismissOperandPicker, onChangeConditionVariable, onRemoveAction }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose });
    const panel = (eyebrow, title, body, removeLabel = "", onRemove = null) => <aside ref={dialogRef} className="code-inspector" data-node-drag-ignore="true" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
        <header className="code-inspector-header"><div><span>{eyebrow}</span><h2>{title}</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close inspector"><span aria-hidden="true">×</span></button></header>
        <div className="code-inspector-body" onClick={(event) => { if (event.target === event.currentTarget) onDismissOperandPicker?.(); }}>{body}</div>
        {onRemove && <footer className="code-inspector-footer"><button type="button" disabled={disabled || !canRemove} onClick={() => { onRemove(); onClose(); }}>{removeLabel}</button></footer>}
    </aside>;
    const field = (label, control, hint = "") => <label className="code-inspector-field"><span>{label}</span>{control}{hint && <small>{hint}</small>}</label>;

    if (inspectedNode.kind === "condition-variable") {
        const node = graph.conditions.find((candidate) => candidate.id === inspectedNode.id);
        const branch = node ? treeBranchAt(roots[node.rootIndex]?.branches, node.path) : null;
        const condition = branch?.conditions?.[inspectedNode.rowIndex];
        const variableId = inspectedNode.operand === 1 ? condition?.left : condition?.right?.type === "variable" ? condition.right.value : null;
        const definition = stateVariables.find((variable) => variable.id === variableId);
        if (!node || !branch || !condition || !definition) return null;
        const update = (updates) => updateBranch(node.rootIndex, node.path, (current) => ({
            ...current,
            conditions: (current.conditions ?? []).map((item, index) => index === inspectedNode.rowIndex ? { ...item, ...updates } : item),
        }));
        const targetField = inspectedNode.operand === 1 ? "leftTarget" : "rightTarget";
        const targetOptions = targetOptionsForDefinition(definition, targetTypes);
        const rightDefinition = condition.right?.type === "variable"
            ? stateVariables.find((variable) => variable.id === condition.right.value)
                ?? STATE_VARIABLES.find((variable) => variable.id === condition.right.value)
            : null;
        const selectedCondition = normalizeConditionSelections(condition, definition, rightDefinition);
        return panel(`INPUT ${inspectedNode.operand} VARIABLE`, definition.label, <>
            <p className="code-inspector-note">Configure this variable without adding controls to the conditional node.</p>
            {onChangeConditionVariable && <button type="button" onClick={() => onChangeConditionVariable(inspectedNode.rowIndex, inspectedNode.operand)} className="mb-4 min-h-9 w-full border border-cyan-700/70 bg-cyan-950/40 px-3 font-mono text-[9px] font-bold tracking-[.12em] text-cyan-200 hover:border-cyan-400 hover:bg-cyan-900/50">CHANGE VARIABLE</button>}
            {definition.supportsAbility && definition.abilityOptions?.length > 0 && field("Ability", <select disabled={disabled} value={selectedCondition.ability ?? definition.abilityOptions[0].id} onChange={(event) => update({ ability: abilityIdFromBoundary(event.target.value) })}>{definition.abilityOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}</select>)}
            {definition.supportsStatusEffect && definition.statusEffectOptions?.length > 0 && field("Status effect", <select disabled={disabled} value={selectedCondition.statusEffect ?? ""} onChange={(event) => update({ statusEffect: normalizeStatusEffectSelection(event.target.value, definition.statusEffectOptions) })}><option value="" disabled>Choose status effect</option>{definition.statusEffectOptions.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select>)}
            {definition.supportsTarget && field("Target", <OrderedTargetPicker value={condition[targetField] ?? defaultTargetForVariable(definition, targetTypes)} targetTypes={targetOptions} allowOrdering={definition.targetOrderable !== false} onChange={(target) => update({ [targetField]: target })} />)}
            {!definition.supportsAbility && !definition.supportsStatusEffect && !definition.supportsTarget && <p className="code-inspector-note">This variable has no additional configuration.</p>}
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
        const remove = () => {
            if (onRemoveAction) {
                onRemoveAction(node.rootIndex, node.path, node.actionIndex);
                return;
            }
            updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.filter((_, index) => index !== node.actionIndex)));
        };
        const targetMode = actionTargetMode(entry, definition);
        const needsTarget = targetMode !== null && targetMode !== "absolute";
        return panel("ACTION", definition?.label ?? "Action", <>
            <p className="code-inspector-note">Canvas nodes show the sentence; detailed movement and ability options live here.</p>
            {definition?.variableAction && <VariableActionControls entry={entry} variables={customVariables} stateVariables={stateVariables} disabled={disabled} canAddAction={canAddAction} allowRemoveAction={!puzzleMode || canRemove} onChange={update} onPickOperand={(termIndex) => onPickActionOperand?.(node.rootIndex, node.path, node.actionIndex, termIndex)} onInspectOperand={(termIndex) => onInspectActionOperand?.(node.rootIndex, node.path, node.actionIndex, termIndex)} onRemoveAction={() => { remove(); onClose(); }} />}
            {definition?.movementConfig && <MovementConfigurationControls entry={entry} disabled={disabled} onChange={update} />}
            {definition?.orientationConfig && <PhaseOrientationControls entry={entry} onChange={update} />}
            {needsTarget && <ActionTargetControls entry={entry} definition={definition} targetTypes={targetTypes} disabled={disabled} onChange={update} />}
        </>, "REMOVE ACTION", remove);
    }
    return null;
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

function formatCoordinateTargetLabel(entry) {
    const x = Number.isFinite(Number(entry?.targetX)) ? Number(entry.targetX) : ARENA_WIDTH_UNITS / 2;
    const y = Number.isFinite(Number(entry?.targetY)) ? Number(entry.targetY) : ARENA_HEIGHT_UNITS / 2;
    return `Coordinates (${x}, ${y})`;
}

function formatActionTargetLabel(entry, definition, targetTypes) {
    const mode = actionTargetMode(entry, definition);
    if (!mode || mode === "absolute") return "";
    if (mode === "angle") return `Angle (${Number(entry?.targetAngle ?? 0)} deg)`;
    if (mode === "coordinates") {
        const coordinateLabel = formatCoordinateTargetLabel(entry);
        return definition?.movementConfig
            ? formatMovementTargetLabel(entry?.movementDirection ?? 0, coordinateLabel)
            : coordinateLabel;
    }
    const targetLabel = formatTargetLabel(entry?.actionTarget ?? "opponent", targetTypes);
    return definition?.movementConfig
        ? formatMovementTargetLabel(entry?.movementDirection ?? 0, targetLabel)
        : targetLabel;
}

function ActionTargetControls({ entry, definition, targetTypes, disabled, onChange }) {
    const mode = actionTargetMode(entry, definition);
    const canChooseCoordinates = Boolean(definition?.coordinateTarget && !definition?.movementConfig);
    const modeControl = canChooseCoordinates && <label className="code-inspector-field">
        <span>TARGET MODE</span>
        <select disabled={disabled} value={mode} onChange={(event) => onChange({ ...entry, targetMode: event.target.value })}><option value="target">Relative to target</option>{definition?.angleTarget && <option value="angle">Absolute angle</option>}<option value="coordinates">{definition?.angleTarget ? "Absolute coordinates" : "Relative to coordinates"}</option></select>
    </label>;
    if (mode === "angle") {
        return <div>
            {modeControl}
            <label className="code-inspector-field"><span>ANGLE</span><DeferredNumberInput disabled={disabled} min={-360} max={360} value={entry.targetAngle ?? 0} fallback={0} aria-label="Absolute rotation angle" onCommit={(targetAngle) => onChange({ ...entry, targetAngle })} /><span className="code-inspector-field-unit">deg</span></label>
            <small>0 deg = north · 90 deg = east · 180 deg = south · 270 deg = west. Negative angles are also valid.</small>
        </div>;
    }
    if (mode === "coordinates") {
        return <div>
            {modeControl}
            <div className="grid grid-cols-2 gap-2">
                <label className="code-inspector-field"><span>X COORDINATE</span><DeferredNumberInput disabled={disabled} min={0} max={ARENA_WIDTH_UNITS} value={entry.targetX ?? ARENA_WIDTH_UNITS / 2} fallback={ARENA_WIDTH_UNITS / 2} aria-label="Target X coordinate" onCommit={(targetX) => onChange({ ...entry, targetX })} /></label>
                <label className="code-inspector-field"><span>Y COORDINATE</span><DeferredNumberInput disabled={disabled} min={0} max={ARENA_HEIGHT_UNITS} value={entry.targetY ?? ARENA_HEIGHT_UNITS / 2} fallback={ARENA_HEIGHT_UNITS / 2} aria-label="Target Y coordinate" onCommit={(targetY) => onChange({ ...entry, targetY })} /></label>
            </div>
        </div>;
    }
    return <div>
        {modeControl}
        <label className="code-inspector-field"><span>TARGET</span><OrderedTargetPicker disabled={disabled} value={entry.actionTarget ?? "opponent"} targetTypes={targetTypes} onChange={(actionTarget) => onChange({ ...entry, actionTarget, ...(definition?.movementConfig ? {} : { targetMode: "target" }) })} /></label>
        {!definition?.movementConfig && <div className="grid grid-cols-2 gap-2">
            <label className="code-inspector-field"><span>OFFSET X</span><DeferredNumberInput disabled={disabled} min={-ARENA_WIDTH_UNITS} max={ARENA_WIDTH_UNITS} value={entry.targetOffsetX ?? 0} fallback={0} aria-label="Target X offset" onCommit={(targetOffsetX) => onChange({ ...entry, targetOffsetX })} /></label>
            <label className="code-inspector-field"><span>OFFSET Y</span><DeferredNumberInput disabled={disabled} min={-ARENA_HEIGHT_UNITS} max={ARENA_HEIGHT_UNITS} value={entry.targetOffsetY ?? 0} fallback={0} aria-label="Target Y offset" onCommit={(targetOffsetY) => onChange({ ...entry, targetOffsetY })} /></label>
        </div>}
    </div>;
}

function ActionVariableInspector({ definition, operand, targetTypes, disabled, onChange, onClose }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose });
    if (!definition) return null;
    const targetOptions = targetOptionsForDefinition(definition, targetTypes);
    const target = operand?.target ?? defaultTargetForVariable(definition, targetTypes);
    const update = (updates) => onChange({ ...operand, ...updates });
    return <aside ref={dialogRef} className="code-inspector code-inspector--secondary" data-node-drag-ignore="true" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
        <header className="code-inspector-header"><div><span>MODIFY INPUT VARIABLE</span><h2>{definition.label}</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close variable inspector"><span aria-hidden="true">×</span></button></header>
        <div className="code-inspector-body">
            <p className="code-inspector-note">Configure this action input without closing the modify custom variable action.</p>
            {definition.supportsAbility && definition.abilityOptions?.length > 0 && <label className="code-inspector-field"><span>ABILITY</span><select disabled={disabled} value={selectedAbilityOptionValue(operand?.ability, definition.abilityOptions)} onChange={(event) => update({ ability: abilityIdFromBoundary(event.target.value) })}>{definition.abilityOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}</select></label>}
            {definition.supportsStatusEffect && definition.statusEffectOptions?.length > 0 && <label className="code-inspector-field"><span>STATUS EFFECT</span><select disabled={disabled} value={selectedStatusOptionValue(operand?.statusEffect, definition.statusEffectOptions)} onChange={(event) => update({ statusEffect: normalizeStatusEffectSelection(event.target.value, definition.statusEffectOptions) })}><option value="" disabled>Choose status effect</option>{definition.statusEffectOptions.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select></label>}
            {definition.supportsTarget && <label className="code-inspector-field"><span>TARGET</span><OrderedTargetPicker disabled={disabled} value={target} targetTypes={targetOptions} allowOrdering={definition.targetOrderable !== false} onChange={(nextTarget) => update({ target: nextTarget })} /></label>}
            {!definition.supportsAbility && !definition.supportsStatusEffect && !definition.supportsTarget && <p className="code-inspector-note">This variable has no additional configuration.</p>}
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

function VariableActionControls({ entry, variables, stateVariables, disabled, canAddAction, allowRemoveAction = true, onChange, onPickOperand, onInspectOperand, onRemoveAction }) {
    const selected = variables.find((variable) => variable.id === entry.variableId) ?? variables[0];
    if (!selected) return <div className="font-mono text-[9px] text-amber-300">CREATE A CUSTOM VARIABLE FIRST</div>;
    const terms = variableActionTerms(entry);
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
    const removeTerm = (termIndex) => {
        if (!allowRemoveAction) return;
        if (terms.length <= 1) {
            onRemoveAction();
            return;
        }
        updateTerms(terms.filter((_, index) => index !== termIndex));
    };
    const addTerm = () => {
        if (!canAddAction || terms.length >= MAX_VARIABLE_ACTION_TERMS) return;
        updateTerms([...terms, { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 0 } }]);
    };
    return <div className="min-w-0 space-y-2 overflow-hidden">
        <select disabled={disabled} value={selected.id} onChange={(event) => changeVariable(event.target.value)} className="h-8 w-full min-w-0 rounded border border-border-lo bg-zinc-950 px-2 text-white">{variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select>
        {selected.valueType === "boolean" ? <div className="code-variable-action-row"><select disabled={disabled} aria-label="Variable action operator" value={CUSTOM_VARIABLE_OPERATIONS.SET} className="code-operator-socket code-variable-action-operator"><option value={CUSTOM_VARIABLE_OPERATIONS.SET}>=</option></select><select disabled={disabled} aria-label="Boolean value" value={String(entry.value ?? false)} onChange={(event) => onChange({ ...entry, variableId: selected.id, operation: CUSTOM_VARIABLE_OPERATIONS.SET, value: event.target.value === "true" })}><option value="false">FALSE</option><option value="true">TRUE</option></select>{allowRemoveAction && <button type="button" className="code-condition-row-remove" disabled={disabled} onClick={onRemoveAction} aria-label="Remove variable action">×</button>}</div> : <div className="space-y-2">
            {terms.map((term, termIndex) => {
                const operand = term?.operand ?? { type: "number", value: 0 };
                const operandDefinition = operand.type === "variable" ? stateVariables.find((variable) => variable.id === operand.value) : null;
                const operation = term?.operator ?? (termIndex === 0 ? CUSTOM_VARIABLE_OPERATIONS.SET : CUSTOM_VARIABLE_OPERATIONS.ADD);
                const updateTerm = (updates) => updateTerms(terms.map((current, index) => index === termIndex ? { ...current, ...updates } : current));
                const changeOperandType = () => {
                    if (operand.type === "variable") updateTerm({ operand: { type: "number", value: 0 } });
                    else onPickOperand?.(termIndex);
                };
                return <div className="code-variable-action-row" key={`variable-term-${termIndex}`}><select disabled={disabled} aria-label={`Variable action operator ${termIndex + 1}`} value={operation} onChange={(event) => updateTerm({ operator: event.target.value })} className="code-operator-socket code-variable-action-operator">{termIndex === 0 && <option value={CUSTOM_VARIABLE_OPERATIONS.SET}>=</option>}<option value={CUSTOM_VARIABLE_OPERATIONS.ADD}>+</option><option value={CUSTOM_VARIABLE_OPERATIONS.SUBTRACT}>−</option><option value={CUSTOM_VARIABLE_OPERATIONS.MODULO}>%</option></select><div className={`code-condition-input code-variable-action-input ${operandDefinition ? "is-variable" : "is-raw"}`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><>{operandDefinition ? <button type="button" className="code-condition-input-value code-variable-action-input-value" onClick={() => onInspectOperand?.(termIndex)} disabled={disabled}><span className="code-variable-action-input-label">{operandDefinition.label}</span></button> : <DeferredNumberInput disabled={disabled} min={CUSTOM_NUMBER_MIN} max={CUSTOM_NUMBER_MAX} value={operand.value ?? 0} onCommit={(value) => updateTerm({ operand: { type: "number", value } })} />}</><button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={changeOperandType} aria-label={operandDefinition ? "Use a raw number" : "Choose a variable"} title={operandDefinition ? "Use a raw number" : "Choose a variable"}><span aria-hidden="true">{operandDefinition ? "−" : "+"}</span></button></div>{allowRemoveAction && <button type="button" className="code-condition-row-remove" disabled={disabled} onClick={() => removeTerm(termIndex)} aria-label={`Remove variable operand ${termIndex + 1}`}>×</button>}</div>;
            })}
            <button type="button" disabled={disabled || !canAddAction || terms.length >= MAX_VARIABLE_ACTION_TERMS} onClick={addTerm} className="text-emerald-300">+ OPERAND</button>
        </div>}
    </div>;
}

function MovementConfigurationControls({ entry, disabled, onChange }) {
    const mode = entry.movementMode ?? "target";
    const isWalk = entry.action === BOT_CODE_ACTIONS.MOVE_WALK;
    const absolute = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "stop"];
    const relativeDirection = relativeMovementAngle(entry.movementDirection);
    const absoluteDegreeDirection = absoluteMovementAngle(entry.movementDirection);
    const absoluteDirection = absolute.includes(entry.movementDirection) ? entry.movementDirection : "north";
    const changeMode = (nextMode) => onChange({
        ...entry,
        movementMode: nextMode,
        movementDirection: nextMode === "absolute" ? (isWalk ? absoluteDegreeDirection : "north") : relativeDirection,
    });
    return <div className="space-y-2">
        <label className="block font-mono text-[9px] text-ink-muted">MOVEMENT MODE
            <select disabled={disabled} value={mode} onChange={(event) => changeMode(event.target.value)} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white"><option value="target">Relative to target</option><option value="coordinates">Relative to coordinates</option><option value="absolute">Absolute arena direction</option></select>
        </label>
        {mode === "absolute" && isWalk ? <label className="block font-mono text-[9px] text-ink-muted">MOVEMENT DIRECTION
            <div className="code-movement-angle-input">
                <DeferredNumberInput disabled={disabled} min={MOVEMENT_DIRECTION_MIN} max={MOVEMENT_DIRECTION_MAX} step={NUMBER_STEP} value={absoluteDegreeDirection} fallback={0} aria-label="Absolute arena movement direction in degrees" onCommit={(movementDirection) => onChange({ ...entry, movementDirection })} />
                <span>deg</span>
            </div>
            <small>0 deg = north · 90 deg = east · 180 deg = south · 270 deg = west. Negative angles are also valid.</small>
        </label> : mode === "absolute" ? <label className="block font-mono text-[9px] text-ink-muted">MOVEMENT DIRECTION
            <select disabled={disabled} value={absoluteDirection} onChange={(event) => onChange({ ...entry, movementDirection: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white">{absolute.map((direction) => <option key={direction} value={direction}>{direction.replace("stop", "hold ground").replaceAll("_", " ").toUpperCase()}</option>)}</select>
        </label> : <label className="block font-mono text-[9px] text-ink-muted">MOVEMENT DIRECTION
            <div className="code-movement-angle-input">
                <DeferredNumberInput disabled={disabled} min={MOVEMENT_DIRECTION_MIN} max={MOVEMENT_DIRECTION_MAX} step={NUMBER_STEP} value={relativeDirection} fallback={0} aria-label="Movement direction in degrees" onCommit={(movementDirection) => onChange({ ...entry, movementDirection })} />
                <span>deg</span>
            </div>
            <small>0 deg = toward · 90 deg = right perpendicular · 180 deg = away · 270 deg = left perpendicular. Negative angles are also valid.</small>
        </label>}
    </div>;
}

function PhaseOrientationControls({ entry, onChange }) {
    return <label className="block font-mono text-[9px] text-ink-muted">LANDING FACING<select value={entry.phaseFacingMode ?? "face_target"} onChange={(event) => onChange({ ...entry, phaseFacingMode: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white"><option value="face_target">Face target after passing through</option><option value="keep">Keep current facing</option><option value="face_origin">Face the position phased from</option><option value="mirror">Mirror facing across the phase line</option></select></label>;
}

function newTreeBranch(branchType, defaultVariable, createdOrder = 0) {
    const conditional = createConditional("always", "none");
    return {
        ...conditional,
        branchType,
        createdOrder,
        conditions: branchType === "else" ? [] : [createExpressionCondition(defaultVariable)],
        actions: [],
        children: [],
    };
}

function nextBranchOrder(branches) {
    return (branches ?? []).reduce((highest, branch) => Math.max(highest, Number(branch?.createdOrder) + 1 || 0), 0);
}

const CONDITION_PICKER_CATEGORY_ORDER = Object.freeze([
    "Basic",
    "Health & Combat",
    "Abilities & Status",
    "Position & Movement",
    "Objects",
    "Match",
    "Custom Variables",
    "Other",
]);

function conditionPickerCategory(option) {
    const id = String(option?.id ?? "");
    if (id === "always") return "Basic";
    if (option?.group === "Custom Variables" || id.startsWith("custom.")) return "Custom Variables";
    if (option?.supportsAbility || option?.supportsStatusEffect) return "Abilities & Status";
    if (option?.targetGroup === "objects" || option?.group === "Objects" || /\.(exists|count|age)$/.test(id)) return "Objects";
    if (option?.group === "General") return "Match";
    if (option?.group === "Movement"
        || option?.group === "Rotation"
        || ["my.x", "my.y", "opponent.x", "opponent.y", "target.distance"].includes(id)
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

function sanitizeConfigurationConditions(configuration, conditionTypes, defaultCondition, targetTypes = null, stateVariables = STATE_VARIABLES) {
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
                let nextCondition = normalizeConditionSelections(condition, leftDefinition, rightDefinition);
                if (leftDefinition?.supportsTarget) {
                    nextCondition = sanitizeExpressionTarget(nextCondition, "leftTarget", leftDefinition, targetTypes);
                }
                if (rightDefinition?.supportsTarget) {
                    nextCondition = sanitizeExpressionTarget(nextCondition, "rightTarget", rightDefinition, targetTypes);
                }
                changed ||= nextCondition !== condition;
                return nextCondition;
            }
            if (allowedIds.has(condition?.type)) return condition;
            changed = true;
            return createDefaultCondition(defaultCondition, targetTypes);
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

function sanitizeExpressionTarget(condition, field, definition, targetTypes) {
    if (!Array.isArray(targetTypes)) return condition;
    const options = targetOptionsForDefinition(definition, targetTypes);
    if (!options.length) return condition;
    const requested = condition[field] ?? condition.target;
    const baseRequested = String(requested ?? "").split(":")[0];
    if (options.some((target) => target.id === baseRequested)) {
        const normalized = definition.targetOrderable === false ? baseRequested : requested;
        return normalized === condition[field] ? condition : { ...condition, [field]: normalized };
    }
    const fallback = options.find((target) => target.kind === "entity")?.id ?? options[0]?.id;
    return fallback && fallback !== condition[field] ? { ...condition, [field]: fallback } : condition;
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
    return <span className="font-display-action flex items-center gap-2 text-base tracking-[.09em] text-sky-300">{icon && <ToolIcon name={icon} />}{children}</span>;
}

function ToolIcon({ name }) {
    return <MatchToolIcon name={name} />;
}

function ControlButton({ children, icon, label, onClick, disabled, tone = "neutral", className = "" }) {
    const tones = {
        neutral: "arena-toolbar-button--neutral",
        blue: "arena-toolbar-button--blue",
        green: "arena-toolbar-button--green",
        red: "arena-toolbar-button--red",
        violet: "arena-toolbar-button--violet",
        amber: "arena-toolbar-button--amber",
    };
    const accessibleLabel = label ?? (typeof children === "string" || typeof children === "number" ? String(children) : "Tool");
    return (
        <button
            type="button"
            aria-label={accessibleLabel}
            title={accessibleLabel}
            onClick={onClick}
            disabled={disabled}
            className={`arena-toolbar-button ${tones[tone] ?? tones.neutral} ${className}`}
        >
            {icon && <ToolIcon name={icon} />}<span>{children}</span>
        </button>
    );
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

function createDefaultCondition(definition, targetTypes = TARGET_TYPES) {
    if (definition.id === "expression") {
        return createExpressionCondition("target.distance");
    }
    return {
        type: definition.id,
        ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
        ...(definition.supportsTarget ? { target: defaultTargetForVariable(definition, targetTypes) } : {}),
    };
}

function abilityIdsForConfiguration(configuration) {
    const encoded = String(configuration);
    const selected = encoded.startsWith("sandbox:") ? decodeSandboxLoadout(encoded).abilities
        : encoded.startsWith("custom:") ? decodeBotLoadout(encoded).abilities : [];
    return new Set([...STANDARD_ABILITY_IDS, ...selected]);
}

function targetTypesForLoadouts(ownLoadout, opponentLoadout) {
    const ownAbilities = abilityIdsForConfiguration(ownLoadout), opponentAbilities = abilityIdsForConfiguration(opponentLoadout);
    return TARGET_TYPES
        .filter((target) => {
            if (!target.abilityId) return true;
            return (target.owner === "my" ? ownAbilities : opponentAbilities).has(target.abilityId);
        });
}

function OrderedTargetPicker({ value = "opponent", targetTypes = TARGET_TYPES, disabled = false, allowOrdering = true, onChange }) {
    const [baseValue, encodedOrder, encodedOrdinal] = String(value).split(":");
    const base = targetTypes.some((target) => target.id === baseValue) ? baseValue : targetTypes[0]?.id ?? "opponent";
    const order = ["closest", "farthest", "oldest", "newest"].includes(encodedOrder) ? encodedOrder : "closest";
    const ordinal = Math.max(1, Math.min(100, Number(encodedOrdinal) || 1));
    const ordered = allowOrdering && base !== "opponent";
    const encode = (nextBase, nextOrder = order, nextOrdinal = ordinal) => !allowOrdering || nextBase === "opponent"
        ? nextBase
        : `${nextBase}:${nextOrder}:${Math.max(1, Math.min(100, Number(nextOrdinal) || 1))}`;
    return <div className={`grid gap-1 ${ordered ? "grid-cols-[minmax(0,1fr)_6rem_4rem]" : "grid-cols-1"}`}>
        <select disabled={disabled} value={base} onChange={(event) => onChange(encode(event.target.value))} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">{targetTypes.map((target) => <option key={target.id} value={target.id}>{target.label.replace(/^Closest /, "")}</option>)}</select>
        {ordered && <select disabled={disabled} aria-label="Target ordering" value={order} onChange={(event) => onChange(encode(base, event.target.value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"><option value="closest">Closest</option><option value="farthest">Farthest</option><option value="oldest">Oldest</option><option value="newest">Newest</option></select>}
        {ordered && <DeferredNumberInput disabled={disabled} aria-label="Target ordinal" min={1} max={100} value={ordinal} fallback={1} onCommit={(value) => onChange(encode(base, order, value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white" />}
    </div>;
}

function formatTargetLabel(value, targetTypes = TARGET_TYPES) {
    const [baseValue, encodedOrder, encodedOrdinal] = String(value).split(":");
    const definition = targetTypes.find((target) => target.id === baseValue) ?? targetTypes[0];
    const label = definition?.label?.replace(/^Closest /, "") ?? baseValue;
    if (baseValue === "opponent") return label;
    const order = ["closest", "farthest", "oldest", "newest"].includes(encodedOrder) ? encodedOrder : "closest";
    const ordinal = Math.max(1, Math.min(100, Number(encodedOrdinal) || 1));
    return `${formatOrdinal(ordinal)} ${order[0].toUpperCase()}${order.slice(1)} ${label}`;
}

function formatOrdinal(value) {
    const remainder100 = value % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
    return `${value}${({ 1: "st", 2: "nd", 3: "rd" })[value % 10] ?? "th"}`;
}

function formatMovementTargetLabel(direction, targetLabel) {
    return String(relativeMovementAngle(direction)) + " deg from " + targetLabel;
}

function formatActionNodeLabel(label) {
    return label.replace(/^(?:Move|Movement|Rotate|Ability):\s*/, "");
}

function objectTargetTypes(targetTypes = TARGET_TYPES) {
    return targetTypes.filter((target) => (
        Boolean(target.abilityId)
        ||
        target.id.includes(":")
        ||
        target.id.startsWith("object_")
        || /^p[12]_object_[1-6]$/.test(target.id)
    ));
}

function targetOptionsForDefinition(definition, targetTypes = TARGET_TYPES) {
    const scoped = definition?.botTargetOnly
        ? targetTypes.filter((target) => target.id === "opponent")
        : definition?.targetGroup === "objects"
            ? objectTargetTypes(targetTypes)
            : targetTypes;
    if (definition?.targetCapability === TARGET_CAPABILITIES.HEALTH) return scoped.filter((target) => target.healthBearing);
    return scoped;
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
    ConditionalOperandBox,
    ActionVariableInspector,
    GraphConditionNode,
    PuzzleConditionNode,
    GraphActionNode,
    LogicNodeInspector,
    conditionGraphNodeId,
    actionGraphNodeId,
    graphEdgePath,
    newTreeBranch,
    nextBranchOrder,
    countActions,
    countLogicConditions,
    abilityIdsForConfiguration,
    targetTypesForLoadouts,
    sanitizeConfigurationConditions,
    PanelHeading,
    ScoreBox,
    ToolIcon,
    ControlButton,
    CodeTab,
    formatClock,
    clamp,
};
