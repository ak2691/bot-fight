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
    CUSTOM_INTEGER_MIN,
    CUSTOM_INTEGER_MAX,
    MAX_CONDITIONS_PER_BRANCH,
    MAX_LOGIC_BLOCKS,
    countConditionSlots,
} from "../../botlogic/code/BotCode.js";
import { actionTypesForLoadout } from "../../gameconfig/CombatLoadouts.js";
import { decodeBotLoadout, decodeSandboxLoadout } from "../../loadout/BotLoadout.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import RootNodePriorityInput from "../controls/RootNodePriorityInput.jsx";
import MatchToolIcon from "../controls/MatchToolIcon.jsx";

const LEGACY_MOVEMENT_ACTION = /^(move_(?!walk$)|dash_)/;

function clampNumber(value, min, max, fallback, step = 1, roundDown = false) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return text.startsWith("-") ? min : max;
    const bounded = Math.max(min, Math.min(max, numeric));
    return Number(((roundDown ? Math.floor(bounded / step) : Math.round(bounded / step)) * step).toFixed(10));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function DeferredNumberInput({ value, onCommit, min = CUSTOM_INTEGER_MIN, max = CUSTOM_INTEGER_MAX, fallback = 0, step = 1, roundDown = false, integerOnly = false, digitsOnly = false, ...props }) {
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
        const normalized = clampNumber(draft, min, max, fallback, step, roundDown);
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
        const rightLength = condition.right?.type === "variable" ? labelFor(condition.right.value).length : 8;
        const leftWidth = 39 + leftLength * 5.5;
        const rightWidth = condition.right?.type === "variable" ? 39 + rightLength * 5.5 : 110;
        return 175 + leftWidth + rightWidth;
    }), GRAPH_NODE_WIDTH), GRAPH_NODE_WIDTH, 1200);
}

function actionNodeWidth(entry, selectedLoadout, targetTypes) {
    const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const targetRequired = selected?.movementConfig ? entry.movementMode !== "absolute" : actionSupportsTarget(selected);
    const actionLabel = formatActionNodeLabel(selected?.label ?? "Action");
    if (!targetRequired) return Math.max(160, Math.ceil(actionLabel.length * 6.6 + 63));
    const targetLabel = formatTargetLabel(entry.actionTarget ?? "opponent", targetTypes);
    const describedTarget = selected?.movementConfig
        ? formatMovementTargetLabel(entry.movementDirection ?? "toward", targetLabel)
        : targetLabel;
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
            value: customVariables[0]?.valueType === "boolean" ? false : 0,
        } : {}),
    }]);
}

function NodeKindPicker({ selectedLoadout, onCancel, onChooseAction }) {
    const [query, setQuery] = useState("");
    const pickerRef = useRef(null);
    const searchInputRef = useRef(null);
    useExclusiveSearchMenu(pickerRef, true, onCancel);
    useEffect(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, []);
    const actionOptions = actionTypesForLoadout(ACTION_TYPES, selectedLoadout).filter((action) => action.id !== "none" && !LEGACY_MOVEMENT_ACTION.test(action.id));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredActions = actionOptions.filter((action) => !normalizedQuery || `${action.label} ${action.id}`.toLocaleLowerCase().includes(normalizedQuery));
    const title = "ADD ACTION NODE";
    return <div ref={pickerRef} className="code-node-picker code-node-picker--action absolute left-20 top-4 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl" role="dialog" aria-label={title} data-node-drag-ignore="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3"><strong className="tracking-[.12em] text-cyan-200">{title}</strong><button type="button" onClick={onCancel} className="text-slate-400 hover:text-white" aria-label={`Close ${title}`}>×</button></div>
        <label className="code-node-search-label"><span className="sr-only">Search actions</span><input ref={searchInputRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }} placeholder="Search actions…" /></label>
        <div className="code-node-search-results">{filteredActions.map((action) => <button key={action.id} type="button" onClick={() => onChooseAction(action.id)}><strong>{action.label}</strong></button>)}{!filteredActions.length && <p>No actions match “{query}”.</p>}</div>
    </div>;
}

function VariableOperandPicker({ operand, stateVariables, onChoose, onClose }) {
    const [query, setQuery] = useState("");
    const pickerRef = useRef(null);
    const searchInputRef = useRef(null);
    useExclusiveSearchMenu(pickerRef, true, onClose);
    useEffect(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, []);
    const normalized = query.trim().toLocaleLowerCase();
    const compatibleDefinitions = stateVariables.filter((variable) => operand !== 2 || variable.valueType === "number");
    const matches = (label, id) => !normalized || `${label} ${id}`.toLocaleLowerCase().includes(normalized);
    const showAlways = operand === 1 && matches("ALWAYS", "always");
    const definitions = [
        ...(showAlways ? [{ id: "always", label: "ALWAYS", valueType: "boolean" }] : []),
        ...compatibleDefinitions.filter((definition) => matches(definition.label, definition.id)),
    ];
    const title = "ADD VARIABLE INPUT";
    return <div ref={pickerRef} className="code-node-picker code-node-picker--variable absolute left-20 top-4 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl" role="dialog" aria-label={title} data-node-drag-ignore="true" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3"><strong className="tracking-[.12em] text-cyan-200">{title}</strong><button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close variable search">×</button></div>
        <label className="code-node-search-label"><span className="sr-only">Search variables</span><input ref={searchInputRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} placeholder="Search variables…" /></label>
        <div className="code-node-search-results">{definitions.map((definition) => <button key={definition.id} type="button" onClick={() => onChoose(definition.id)}><strong>{definition.label}</strong><small>{definition.valueType === "boolean" ? "TRUE / FALSE" : "NUMBER"}</small></button>)}{!definitions.length && <p>No variables match “{query}”.</p>}</div>
    </div>;
}

function ConditionalOperandBox({ operand, condition, stateVariables, disabled, selected, onPickVariable, onInspectVariable, onUseRawNumber, onNumberChange, onBooleanChange, tutorialFocus = false }) {
    const variableDefinition = operand === 1
        ? stateVariables.find((variable) => variable.id === condition.left)
        : condition.right?.type === "variable" ? stateVariables.find((variable) => variable.id === condition.right.value) : null;
    const variableLabel = variableDefinition?.label;
    const rawBoolean = operand === 2 && condition.right?.type === "boolean";
    const rawNumber = operand === 2 && condition.right?.type === "number";
    return <div className={`code-condition-input ${variableLabel ? "is-variable" : "is-raw"} ${tutorialFocus ? "tutorial-control-focus" : ""}`} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        {variableLabel ? <button type="button" className={`code-condition-input-value ${selected ? "is-selected" : ""}`} onClick={onInspectVariable} aria-label={`Configure ${variableLabel}`}>{variableLabel}</button>
            : rawBoolean ? <select data-node-drag-ignore="true" aria-label={`Input ${operand} boolean value`} disabled={disabled} value={String(condition.right.value)} onChange={(event) => onBooleanChange(event.target.value === "true")}><option value="true">TRUE</option><option value="false">FALSE</option></select>
            : rawNumber ? <DeferredNumberInput digitsOnly data-node-drag-ignore="true" aria-label={`Input ${operand} number`} disabled={disabled} value={condition.right.value} onCommit={onNumberChange} />
            : <span className="code-condition-input-placeholder">INPUT {operand}</span>}
        {variableLabel && operand === 2
            ? <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onUseRawNumber} aria-label={`Use a raw number for input ${operand}`} title="Use a raw number"><span aria-hidden="true">−</span></button>
            : <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onPickVariable} aria-label={`Use a variable for input ${operand}`} title="Choose a variable"><span aria-hidden="true">+</span></button>}
    </div>;
}

function GraphConditionNode({ node, branch, disabled, canRemove, canAddAction, canAddCondition, stateVariables, defaultVariable, nodeOffsets, beginNodeDrag, selected, onSelect, onPriorityChange, onPickVariable, onInspectVariable, onUseRawNumber, onRemoveCondition, inspectedVariable, onChange, onRemove, onAddParentConditional, onAddChildConditional, onAddAction, tutorialFocus }) {
    const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
    const updateCondition = (rowIndex, updater) => onChange({ conditions: conditions.map((condition, index) => index === rowIndex ? updater(condition) : condition) });
    const addJoinedCondition = (join) => onChange({ conditions: [...conditions, { ...createExpressionCondition(defaultVariable.id), ...(join === "or" ? { join: "or" } : {}) }] });
    return <section onClick={onSelect} onPointerDown={(event) => beginNodeDrag(event, node.id)} className={`code-graph-node code-graph-node--conditional absolute rounded-sm border bg-zinc-950 shadow-2xl ${selected ? "is-inspected" : ""}`} style={{ ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <header className="code-compact-header code-node-header--conditional">
            <span className="code-node-badge">{node.path.length}</span><span className="min-w-0 flex flex-1 items-center gap-1 truncate text-sky-100">Conditional <RootNodePriorityInput priority={Number(branch.createdOrder) + 1} max={MAX_LOGIC_BLOCKS} disabled={disabled} onCommit={onPriorityChange} ariaLabel={`Priority for Conditional ${Number(branch.createdOrder) + 1}`} className="code-conditional-priority" /></span><button type="button" data-node-drag-ignore="true" className="code-conditional-add-button" disabled={disabled || !canAddCondition} onClick={(event) => { event.stopPropagation(); onAddParentConditional(); }}>+IF</button>
        </header>
        <div className="space-y-2 p-3">
            {conditions.map((condition, index) => {
                const leftDefinition = stateVariables.find((variable) => variable.id === condition.left) ?? defaultVariable;
                const comparators = CONDITION_COMPARATORS.filter((candidate) => candidate.id !== "modulo" && candidate.valueTypes.includes(leftDefinition.valueType));
                const comparator = comparators.some((candidate) => candidate.id === condition.comparator) ? condition.comparator : comparators[0]?.id ?? "eq";
                return <div key={`${index}-${condition.type}`} className="code-compact-condition-wrap">
                    <div className="code-compact-condition">
                    <span data-node-drag-ignore="true" className="code-condition-prefix font-mono text-[9px] text-amber-200">{index ? (condition.join === "or" ? "OR" : "AND") : "IF"}</span>
                    {condition.type === "always" ? <button type="button" data-node-drag-ignore="true" className="code-condition-socket col-span-3" disabled={disabled} onClick={(event) => { event.stopPropagation(); onPickVariable(index, 1); }} aria-label={`Choose a variable for condition ${index + 1}`}>ALWAYS</button> : <><ConditionalOperandBox operand={1} condition={condition} stateVariables={stateVariables} disabled={disabled} selected={inspectedVariable?.rowIndex === index && inspectedVariable?.operand === 1} onPickVariable={() => onPickVariable(index, 1)} onInspectVariable={() => onInspectVariable(index, 1)} tutorialFocus={tutorialFocus === "add-condition" && index === 0} /><select data-node-drag-ignore="true" aria-label="Comparator" disabled={disabled} value={comparator} onClick={(event) => event.stopPropagation()} onChange={(event) => updateCondition(index, (current) => ({ ...current, comparator: event.target.value }))} className="code-operator-socket">{comparators.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select><ConditionalOperandBox operand={2} condition={condition} stateVariables={stateVariables} disabled={disabled} selected={inspectedVariable?.rowIndex === index && inspectedVariable?.operand === 2} onPickVariable={() => onPickVariable(index, 2)} onInspectVariable={() => onInspectVariable(index, 2)} onUseRawNumber={() => onUseRawNumber(index)} onNumberChange={(value) => updateCondition(index, (current) => ({ ...current, right: { type: "number", value } }))} onBooleanChange={(value) => updateCondition(index, (current) => ({ ...current, right: { type: "boolean", value } }))} /></>}
                    <button type="button" data-node-drag-ignore="true" className="code-condition-row-remove" disabled={disabled} onClick={(event) => { event.stopPropagation(); onRemoveCondition(index); }} aria-label={`Remove condition ${index + 1}`} title="Remove condition">×</button>
                    </div>
                </div>;
            })}
        </div>
        <footer className="code-compact-footer">
            <button type="button" data-node-drag-ignore="true" disabled={disabled || !canAddCondition || conditions.length >= MAX_CONDITIONS_PER_BRANCH} onClick={(event) => { event.stopPropagation(); addJoinedCondition("and"); }}>+ AND</button>
            <button type="button" data-node-drag-ignore="true" disabled={disabled || !canAddCondition || conditions.length >= MAX_CONDITIONS_PER_BRANCH} onClick={(event) => { event.stopPropagation(); addJoinedCondition("or"); }}>+ OR</button>
            <button type="button" data-node-drag-ignore="true" className="code-conditional-add-button" disabled={disabled || !canAddCondition} onClick={(event) => { event.stopPropagation(); onAddChildConditional(); }}>+ IF</button>
            <button type="button" data-node-drag-ignore="true" className={`code-action-add-button ${tutorialFocus === "add-action" && !graphBranchActions(branch).length ? "tutorial-control-focus" : ""}`} disabled={disabled || !canAddAction} onClick={(event) => { event.stopPropagation(); onAddAction(); }}>+ ACTION</button>
            <button type="button" data-node-drag-ignore="true" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-condition-node-remove" aria-label="Remove conditional node" title="Remove conditional node">×</button>
        </footer>
    </section>;
}

function GraphActionNode({ node, entry, disabled, selectedLoadout, targetTypes, nodeOffsets, beginNodeDrag, selectedNode, onInspect, onRemove }) {
    const actionTypes = actionTypesForLoadout(ACTION_TYPES, selectedLoadout);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const targetRequired = selected?.movementConfig ? entry.movementMode !== "absolute" : actionSupportsTarget(selected);
    const targetLabel = targetRequired ? formatTargetLabel(entry.actionTarget ?? "opponent", targetTypes) : "";
    const describedTarget = selected?.movementConfig
        ? formatMovementTargetLabel(entry.movementDirection ?? "toward", targetLabel)
        : targetLabel;
    return <section onClick={onInspect} onPointerDown={(event) => beginNodeDrag(event, node.id)} className={`code-graph-node code-graph-node--action absolute rounded-sm border shadow-2xl ${selectedNode ? "is-inspected" : ""}`} style={{ ...graphNodeStyle(node, nodeOffsets), width: node.width }}>
        <header className="code-action-bar code-node-header--action">
            <span className="code-action-label">{formatActionNodeLabel(selected?.label ?? "Action")}</span>
            {targetRequired && <span className="code-action-target">Target: {describedTarget}</span>}
        </header>
        <button type="button" data-node-drag-ignore="true" disabled={disabled} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="code-compact-remove code-condition-node-remove" aria-label="Remove action">×</button>
    </section>;
}

function LogicNodeInspector({ inspectedNode, graph, roots, stateVariables, targetTypes, selectedLoadout, customVariables, disabled, canRemove, onClose, updateBranch }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose });
    const panel = (eyebrow, title, body, removeLabel = "", onRemove = null) => <aside ref={dialogRef} className="code-inspector" data-node-drag-ignore="true" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
        <header className="code-inspector-header"><div><span>{eyebrow}</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close inspector">×</button></header>
        <div className="code-inspector-body">{body}</div>
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
        const targetOptions = definition.botTargetOnly
            ? targetTypes.filter((target) => target.id === "opponent")
            : definition.targetGroup === "objects" ? objectTargetTypes(targetTypes) : targetTypes;
        return panel(`INPUT ${inspectedNode.operand} VARIABLE`, definition.label, <>
            <p className="code-inspector-note">Configure this variable without adding controls to the conditional node.</p>
            {definition.supportsAbility && definition.abilityOptions?.length > 0 && field("Ability", <select disabled={disabled} value={condition.ability ?? definition.abilityOptions[0].id} onChange={(event) => update({ ability: event.target.value })}>{definition.abilityOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}</select>)}
            {definition.supportsStatusEffect && definition.statusEffectOptions?.length > 0 && field("Status effect", <select disabled={disabled} value={condition.statusEffect ?? definition.statusEffectOptions[0].id} onChange={(event) => update({ statusEffect: event.target.value })}>{definition.statusEffectOptions.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select>)}
            {definition.supportsTarget && field("Target", <OrderedTargetPicker value={condition[targetField] ?? definition.defaultTarget ?? (definition.targetGroup === "objects" ? "object_1" : "opponent")} targetTypes={targetOptions} onChange={(target) => update({ [targetField]: target })} />)}
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
        const needsTarget = definition?.movementConfig ? entry.movementMode !== "absolute" : actionSupportsTarget(definition);
        return panel("ACTION", definition?.label ?? "Action", <>
            <p className="code-inspector-note">Canvas nodes show the sentence; detailed movement and ability options live here.</p>
            {definition?.variableAction && <VariableActionControls entry={entry} variables={customVariables} stateVariables={stateVariables} onChange={update} />}
            {definition?.movementConfig && <MovementConfigurationControls entry={entry} onChange={update} />}
            {definition?.orientationConfig && <PhaseOrientationControls entry={entry} onChange={update} />}
            {needsTarget && field("Target", <OrderedTargetPicker value={entry.actionTarget ?? "opponent"} targetTypes={targetTypes} onChange={(actionTarget) => update({ ...entry, actionTarget, targetMode: "target" })} />)}
        </>, "REMOVE ACTION", () => updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.filter((_, index) => index !== node.actionIndex))));
    }
    return null;
}

function VariableActionControls({ entry, variables, stateVariables, onChange }) {
    const selected = variables.find((variable) => variable.id === entry.variableId) ?? variables[0];
    if (!selected) return <div className="font-mono text-[9px] text-amber-300">CREATE A CUSTOM VARIABLE FIRST</div>;
    const derived = Boolean(selected.conditions?.length);
    const operation = selected.valueType === "boolean" ? "set" : entry.operation ?? "set";
    const terms = entry.terms?.length ? entry.terms : [{ operator: operation, operand: { type: "number", value: entry.value ?? 0 } }];
    const operands = [...stateVariables.filter((variable) => variable.valueType === "number"), ...variables.filter((variable) => variable.valueType === "number").map((variable) => ({ ...variable, label: variable.name }))];
    const updateTerm = (index, updates) => onChange({ ...entry, variableId: selected.id, terms: terms.map((term, candidate) => candidate === index ? { ...term, ...updates } : term) });
    return <div className="min-w-0 space-y-2 overflow-hidden">
        <select value={selected.id} onChange={(event) => onChange({ ...entry, variableId: event.target.value, operation: "set", value: 0, terms: [{ operator: "set", operand: { type: "number", value: 0 } }] })} className="h-8 w-full min-w-0 rounded border border-border-lo bg-zinc-950 px-2 text-white">{variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select>
        {selected.valueType === "boolean" ? <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2"><span className="flex h-8 items-center justify-center text-white">=</span><select disabled={derived} value={String(entry.value ?? false)} onChange={(event) => onChange({ ...entry, variableId: selected.id, operation: "set", value: event.target.value === "true" })} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-2 text-white"><option value="false">FALSE</option><option value="true">TRUE</option></select></div> : <div className="space-y-2">{terms.map((term, index) => <div key={index} className="grid max-w-full grid-cols-[44px_76px_104px_28px] gap-1 overflow-hidden"><select value={term.operator} onChange={(event) => updateTerm(index, { operator: event.target.value })} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 text-white">{index === 0 && <option value="set">=</option>}<option value="add">+</option><option value="subtract">-</option></select><select value={term.operand?.type ?? "number"} onChange={(event) => updateTerm(index, { operand: event.target.value === "variable" ? { type: "variable", value: operands[0]?.id ?? "my.hp" } : { type: "number", value: 0 } })} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 text-white"><option value="number">NUMBER</option><option value="variable">VARIABLE</option></select>{term.operand?.type === "variable" ? <select value={term.operand.value} onChange={(event) => updateTerm(index, { operand: { type: "variable", value: event.target.value } })} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 text-white">{operands.map((operand) => <option key={operand.id} value={operand.id}>{operand.label}</option>)}</select> : <DeferredNumberInput min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={term.operand?.value ?? 0} onCommit={(value) => updateTerm(index, { operand: { type: "number", value } })} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-2 text-white" />}<button type="button" disabled={terms.length === 1} onClick={() => onChange({ ...entry, terms: terms.filter((_, candidate) => candidate !== index).map((item, candidate) => candidate === 0 && item.operator === "set" ? item : item) })} className="flex h-8 w-7 items-center justify-center text-red-300">×</button></div>)}<button type="button" onClick={() => onChange({ ...entry, variableId: selected.id, terms: [...terms, { operator: "add", operand: { type: "number", value: 0 } }] })} className="text-emerald-300">+ OPERAND</button></div>}
        {derived && <span className="block font-mono text-[9px] text-amber-300">Derived booleans are read-only.</span>}
    </div>;
}

function MovementConfigurationControls({ entry, onChange }) {
    const mode = entry.movementMode ?? "target";
    const absolute = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "stop"];
    const relative = [["toward", "Toward"], ["away", "Away"], ["left", "Left perpendicular"], ["right", "Right perpendicular"], ["toward_left", "Toward + left"], ["toward_right", "Toward + right"], ["away_left", "Away + left"], ["away_right", "Away + right"]];
    return <div className="space-y-2"><label className="block font-mono text-[9px] text-ink-muted">MOVEMENT MODE<select value={mode} onChange={(event) => onChange({ ...entry, movementMode: event.target.value, movementDirection: event.target.value === "absolute" ? "north" : "toward" })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white"><option value="target">Relative to target</option><option value="coordinates">Relative to coordinates</option><option value="absolute">Absolute arena direction</option></select></label><label className="block font-mono text-[9px] text-ink-muted">MOVEMENT DIRECTION<select value={entry.movementDirection ?? (mode === "absolute" ? "north" : "toward")} onChange={(event) => onChange({ ...entry, movementDirection: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white">{mode === "absolute" ? absolute.map((direction) => <option key={direction} value={direction}>{direction.replace("stop", "hold ground").replaceAll("_", " ").toUpperCase()}</option>) : relative.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>;
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
        conditions: branchType === "else" ? [] : [createExpressionCondition(defaultVariable.id)],
        actions: [],
        children: [],
    };
}

function nextBranchOrder(branches) {
    return (branches ?? []).reduce((highest, branch) => Math.max(highest, Number(branch?.createdOrder) + 1 || 0), 0);
}

function SearchablePicker({ value, onChange, options, placeholder = "Search...", compact = false }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const rootRef = useRef(null);
    useExclusiveSearchMenu(rootRef, open, () => setOpen(false));
    const selected = options.find((option) => option.id === value);
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
        ? options.filter((option) => `${option.label} ${option.id}`.toLocaleLowerCase().includes(normalized))
        : options;
    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [open]);
    return (
        <div ref={rootRef} className={`relative min-w-0 ${compact ? "w-full max-w-56 flex-none" : "flex-1"}`}>
            <button type="button" onClick={() => { setOpen((current) => !current); setQuery(""); }} className="flex h-8 w-full items-center justify-between rounded border border-border-lo bg-zinc-950 px-2 text-left font-mono text-[10px] text-ink-white">
                <span className="truncate">{selected?.label ?? "Choose..."}</span><span className="text-ink-muted">⌄</span>
            </button>
            {open && <div onWheel={(event) => event.stopPropagation()} className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 rounded border border-border-mid bg-zinc-950 p-2 shadow-2xl">
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} placeholder={placeholder} className="h-8 w-full rounded border border-cyan-900 bg-zinc-900 px-2 font-mono text-[10px] text-white outline-none focus:border-cyan-500" />
                <div className="mt-1 max-h-52 overflow-y-auto">
                    {filtered.map((option) => <button key={option.id} type="button" onClick={() => { onChange(option.id); setOpen(false); }} className={`block w-full rounded px-2 py-1.5 text-left font-mono text-[10px] hover:bg-cyan-950 ${option.id === value ? "text-cyan-200" : "text-ink-white"}`}>{option.label}</button>)}
                    {!filtered.length && <div className="px-2 py-3 font-mono text-[9px] text-ink-muted">NO MATCHES</div>}
                </div>
            </div>}
        </div>
    );
}

function ConditionEditor({
    condition,
    prefix,
    canChangeJoin = false,
    compact = false,
    onChange,
    onRemove,
    removable,
    stateVariables = STATE_VARIABLES,
    defaultVariable = STATE_VARIABLES[0],
    targetTypes = TARGET_TYPES,
    editorMode = false,
    disabled = false,
    operandOneConnectionLabel = "",
    operandTwoConnectionLabel = "",
    operandOnePortId = "",
    operandTwoPortId = "",
    connecting = null,
    onSelectOperand,
    onDisconnectOperand,
}) {
    return (
        <ExpressionConditionEditor
            condition={condition?.type === "expression" || condition?.type === "always"
                ? condition
                : { type: "always", ...(condition?.join === "or" ? { join: "or" } : {}) }}
            prefix={prefix}
            canChangeJoin={canChangeJoin}
            compact={compact}
            onChange={onChange}
            onRemove={onRemove}
            removable={removable}
            stateVariables={stateVariables}
            defaultVariable={defaultVariable}
            targetTypes={targetTypes}
            editorMode={editorMode}
            disabled={disabled}
            operandOneConnectionLabel={operandOneConnectionLabel}
            operandTwoConnectionLabel={operandTwoConnectionLabel}
            operandOnePortId={operandOnePortId}
            operandTwoPortId={operandTwoPortId}
            connecting={connecting}
            onSelectOperand={onSelectOperand}
            onDisconnectOperand={onDisconnectOperand}
        />
    );
}

function ConditionOperandInput({
    label = "Variable",
    kind = "variable",
    connectedLabel = "",
    selected = false,
    disabled = false,
    allowNumber = false,
    allowKindChange = allowNumber,
    numberValue = 0,
    numberMin = CUSTOM_INTEGER_MIN,
    numberMax = CUSTOM_INTEGER_MAX,
    numberStep = 1,
    numberFallback = 0,
    numberRoundDown = false,
    numberIntegerOnly = false,
    onNumberCommit,
    onKindChange,
    onSelect,
    onDisconnect,
    ariaLabel = "Condition operand",
}) {
    const variable = kind === "variable";
    return <div className={`code-condition-operand ${selected ? "is-selecting" : ""}`}>
        {variable ? <button
            type="button"
            data-node-drag-ignore="true"
            disabled={disabled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onSelect}
            onDoubleClick={onDisconnect}
            aria-label={`${ariaLabel}: Variable${connectedLabel ? ` attached to ${connectedLabel}` : ""}`}
            title={connectedLabel ? `Attached to ${connectedLabel}; double-click to disconnect` : "Select Variable, then click a variable node"}
            className="code-condition-operand-button"
        >
            <span className="truncate">{label}</span>
            {connectedLabel && <span className="sr-only">Attached to {connectedLabel}</span>}
        </button> : <DeferredNumberInput
            data-node-drag-ignore="true"
            aria-label={`${ariaLabel}: Number`}
            disabled={disabled}
            min={numberMin}
            max={numberMax}
            step={numberStep}
            value={numberValue}
            fallback={numberFallback}
            roundDown={numberRoundDown}
            integerOnly={numberIntegerOnly}
            onCommit={onNumberCommit}
            className="code-condition-operand-number"
        />}
        <select
            data-node-drag-ignore="true"
            aria-label={`${ariaLabel} type`}
            disabled={disabled || !allowKindChange}
            value={kind}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onKindChange?.(event.target.value)}
            className="code-condition-operand-kind"
        >
            <option value="variable">■</option>
            {allowNumber && <option value="number">#</option>}
        </select>
    </div>;
}

function ExpressionConditionEditor({
    condition,
    prefix,
    canChangeJoin = false,
    compact = false,
    onChange,
    onRemove,
    removable,
    stateVariables,
    defaultVariable,
    targetTypes,
    editorMode = false,
    disabled = false,
    operandOneConnectionLabel = "",
    operandTwoConnectionLabel = "",
    operandOnePortId = "",
    operandTwoPortId = "",
    connecting = null,
    onSelectOperand,
    onDisconnectOperand,
}) {
    const isAlways = condition?.type === "always";
    const variables = stateVariables.length ? stateVariables : STATE_VARIABLES;
    const leftDefinition = variables.find((variable) => variable.id === condition.left)
        ?? defaultVariable
        ?? variables[0]
        ?? STATE_VARIABLES[0];
    const rightVariableDefinition = condition.right?.type === "variable"
        ? variables.find((variable) => variable.id === condition.right.value)
        : null;
    const valueType = leftDefinition.valueType;
    const comparators = CONDITION_COMPARATORS.filter((comparator) => comparator.id !== "modulo" && comparator.valueTypes.includes(valueType));
    const comparator = comparators.some((candidate) => candidate.id === condition.comparator)
        ? condition.comparator
        : comparators[0]?.id ?? "eq";
    const moduloComparators = comparators.filter((candidate) => candidate.id !== "modulo");
    const moduloComparator = moduloComparators.some((candidate) => candidate.id === condition.modulo?.comparator)
        ? condition.modulo.comparator
        : "eq";
    const moduloDivisor = condition.modulo?.divisor ?? 1;
    const numericVariables = variables.filter((variable) => variable.valueType === "number");
    const canUseVariableOperand = valueType === "number" && numericVariables.length > 0;
    const selectionField = editorMode ? null : leftDefinition.supportsAbility ? "ability" : leftDefinition.supportsStatusEffect ? "statusEffect" : null;
    const selectionOptions = leftDefinition.supportsAbility ? (leftDefinition.abilityOptions ?? []) : (leftDefinition.statusEffectOptions ?? []);
    const selectionLabel = leftDefinition.supportsAbility ? "Selected ability" : "Selected status effect";
    const targetOptionsFor = (definition) => definition?.botTargetOnly
        ? targetTypes.filter((target) => target.id === "opponent")
        : definition?.targetGroup === "objects"
        ? objectTargetTypes(targetTypes)
        : targetTypes;
    const selectedTargetFor = (definition, field) => {
        const options = targetOptionsFor(definition);
        const requested = condition[field] ?? condition.target;
        return options.some((target) => target.id === String(requested).split(":")[0])
            ? requested
            : definition?.defaultTarget ?? (definition?.targetGroup === "objects" ? "object_1" : "opponent");
    };

    const changeLeft = (left) => {
        if (left === "always") {
            onChange({
                type: "always",
                ...(condition.join === "or" ? { join: "or" } : {}),
            });
            return;
        }
        const nextLeft = variables.find((variable) => variable.id === left) ?? variables[0];
        onChange({
            ...createExpressionCondition(nextLeft),
            ...(nextLeft.supportsAbility && nextLeft.abilityOptions?.length ? { ability: nextLeft.abilityOptions[0].id } : {}),
            ...(nextLeft.supportsStatusEffect && nextLeft.statusEffectOptions?.length ? { statusEffect: nextLeft.statusEffectOptions[0].id } : {}),
            ...(condition.join === "or" ? { join: "or" } : {}),
        });
    };
    const changeRightType = (type) => {
        if (type === "variable") {
            onChange({
                ...condition,
                right: { type: "variable", value: numericVariables[0]?.id ?? "my.hp" },
            });
            return;
        }
        onChange({
            ...condition,
            right: { type: "number", value: leftDefinition.defaultValue },
        });
    };
    const changeComparator = (nextComparator) => {
        if (nextComparator === "modulo") {
            const expectedResult = condition.right?.type === "variable"
                ? condition.right
                : {
                    type: "number",
                    value: Number.isInteger(condition.right?.value) ? condition.right.value : 0,
                };
            onChange({
                ...condition,
                comparator: "modulo",
                modulo: {
                    divisor: Number.isInteger(condition.modulo?.divisor) ? condition.modulo.divisor : 1,
                    comparator: moduloComparator,
                },
                right: expectedResult,
            });
            return;
        }
        const nextCondition = { ...condition, comparator: nextComparator };
        delete nextCondition.modulo;
        onChange(nextCondition);
    };

    return (
        <div className={`${compact ? "flex flex-wrap items-center gap-2" : "code-condition-row grid grid-cols-[42px_1fr_auto] items-center gap-2"} text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px] [&_span]:!text-[10px]`}>
            <ConditionJoinControl
                prefix={prefix}
                canChangeJoin={canChangeJoin}
                condition={condition}
                onChange={onChange}
            />
            <div className={`${compact ? "flex min-w-0 flex-1 flex-wrap items-center gap-2" : `grid min-w-0 gap-1 ${editorMode ? "grid-cols-[minmax(104px,150px)_auto_minmax(0,1fr)]" : "grid-cols-[1fr_auto_1fr]"}`}`}>
                {editorMode ? (isAlways ? <span className="flex min-h-8 min-w-0 items-center rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-cyan-100">ALWAYS</span> : <ConditionOperandInput
                    label="Variable"
                    disabled={disabled}
                    connectedLabel={operandOneConnectionLabel}
                    selected={connecting?.targetId === operandOnePortId && connecting.port === "operand-1"}
                    allowKindChange
                    onSelect={() => onSelectOperand?.(1)}
                    onDisconnect={() => onDisconnectOperand?.(1)}
                    ariaLabel="Left condition input"
                />) : <SearchablePicker
                    value={isAlways ? "always" : leftDefinition.id}
                    onChange={changeLeft}
                    options={[{ id: "always", label: "ALWAYS" }, ...variables]}
                    placeholder="Search conditionals..."
                    compact={compact}
                />}
                {!isAlways && selectionField && (
                    <select
                        aria-label={selectionLabel}
                        value={selectionOptions.some((option) => option.id === condition[selectionField]) ? condition[selectionField] : selectionOptions[0]?.id ?? ""}
                        onChange={(event) => onChange({ ...condition, [selectionField]: event.target.value })}
                        className="h-8 min-w-36 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        {selectionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                )}
                {!isAlways && (leftDefinition.rangeOnly ? (
                    <span className="flex h-8 items-center rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-ink-muted">BETWEEN</span>
                ) : valueType === "boolean" ? (
                    <span className="flex h-8 items-center rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-ink-muted">IS</span>
                ) : editorMode && comparator === "modulo" ? (
                    <span className="code-condition-modulo-symbol" aria-label="Modulo">%</span>
                ) : (
                    <select
                        value={comparator}
                        onChange={(event) => changeComparator(event.target.value)}
                        className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        {comparators.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                        ))}
                    </select>
                ))}
                {!isAlways && (leftDefinition.rangeOnly ? (
                    <div className="flex min-w-0 items-center gap-1">
                        <DeferredNumberInput
                            aria-label="Minimum target direction"
                            min={leftDefinition.min}
                            max={leftDefinition.max}
                            step={1}
                            value={condition.right?.min ?? leftDefinition.defaultMin}
                            fallback={leftDefinition.defaultMin}
                            onCommit={(min) => onChange({ ...condition, comparator: "range", right: { type: "range", min, max: condition.right?.max ?? leftDefinition.defaultMax } })}
                            className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />
                        <span className="font-mono text-[9px] text-ink-muted">° TO</span>
                        <DeferredNumberInput
                            aria-label="Maximum target direction"
                            min={leftDefinition.min}
                            max={leftDefinition.max}
                            step={1}
                            value={condition.right?.max ?? leftDefinition.defaultMax}
                            fallback={leftDefinition.defaultMax}
                            onCommit={(max) => onChange({ ...condition, comparator: "range", right: { type: "range", min: condition.right?.min ?? leftDefinition.defaultMin, max } })}
                            className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />
                        <span className="font-mono text-[9px] text-ink-muted">°</span>
                    </div>
                ) : valueType === "boolean" ? (
                    <select
                        value={String(condition.right?.value ?? true)}
                        onChange={(event) => onChange({
                            ...condition,
                            comparator: "eq",
                            right: { type: "boolean", value: event.target.value === "true" },
                        })}
                        className={`h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white ${compact ? "w-16 shrink-0" : "min-w-0"}`}
                    >
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                    </select>
                ) : comparator === "modulo" ? (
                    editorMode ? <div className="code-condition-modulo-inputs">
                        <ConditionOperandInput
                            kind="number"
                            disabled={disabled}
                            numberValue={moduloDivisor}
                            numberFallback={1}
                            numberRoundDown
                            numberIntegerOnly
                            onNumberCommit={(divisor) => onChange({ ...condition, modulo: { ...condition.modulo, divisor } })}
                            ariaLabel="Modulo divisor"
                        />
                        <select
                            aria-label="Modulo comparison operator"
                            value={moduloComparator}
                            onChange={(event) => onChange({ ...condition, modulo: { ...condition.modulo, comparator: event.target.value } })}
                            className="code-condition-modulo-comparator"
                        >
                            {moduloComparators.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                            ))}
                        </select>
                        <ConditionOperandInput
                            kind={condition.right?.type === "variable" ? "variable" : "number"}
                            disabled={disabled}
                            connectedLabel={operandTwoConnectionLabel}
                            selected={connecting?.targetId === operandTwoPortId && connecting.port === "operand-2"}
                            allowNumber={canUseVariableOperand}
                            numberValue={condition.right?.value ?? 0}
                            numberFallback={0}
                            numberRoundDown
                            numberIntegerOnly
                            onNumberCommit={(value) => onChange({ ...condition, right: { type: "number", value } })}
                            onKindChange={changeRightType}
                            onSelect={() => onSelectOperand?.(2)}
                            onDisconnect={() => onDisconnectOperand?.(2)}
                            ariaLabel="Modulo expected value"
                        />
                        {Number(moduloDivisor) === 0 && <span role="alert" className="col-span-3 font-mono text-[9px] text-red-300">MODULO VALUE CANNOT BE 0</span>}
                    </div> : <div className="col-span-3 flex min-w-0 flex-wrap items-center gap-1">
                        <label className="flex h-8 items-center gap-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-muted">
                            DIVISOR
                            <DeferredNumberInput
                                aria-label="Modulo divisor"
                                min={CUSTOM_INTEGER_MIN}
                                max={CUSTOM_INTEGER_MAX}
                                value={moduloDivisor}
                                fallback={1}
                                roundDown
                                integerOnly
                                onCommit={(divisor) => onChange({ ...condition, modulo: { ...condition.modulo, divisor } })}
                                className="h-7 w-16 min-w-0 bg-transparent px-1 text-right text-ink-white outline-none"
                            />
                        </label>
                        <select
                            aria-label="Modulo comparison operator"
                            value={moduloComparator}
                            onChange={(event) => onChange({ ...condition, modulo: { ...condition.modulo, comparator: event.target.value } })}
                            className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        >
                            {moduloComparators.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                            ))}
                        </select>
                        <select
                            aria-label="Modulo expected value type"
                            value={condition.right?.type === "variable" ? "variable" : "number"}
                            onChange={(event) => changeRightType(event.target.value)}
                            className="h-8 w-16 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        >
                            <option value="number">#</option>
                            {canUseVariableOperand && <option value="variable">VAR</option>}
                        </select>
                        {condition.right?.type === "variable" ? <SearchablePicker
                            value={rightVariableDefinition?.id ?? numericVariables[0]?.id}
                            onChange={(value) => onChange({ ...condition, right: { type: "variable", value } })}
                            options={numericVariables}
                            placeholder="Search variables..."
                            compact={compact}
                        /> : <DeferredNumberInput
                            aria-label="Modulo expected result"
                            min={CUSTOM_INTEGER_MIN}
                            max={CUSTOM_INTEGER_MAX}
                            step={1}
                            roundDown
                            integerOnly
                            value={condition.right?.value ?? 0}
                            fallback={0}
                            onCommit={(value) => onChange({ ...condition, right: { type: "number", value } })}
                            className="h-8 min-w-16 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />}
                        {Number(moduloDivisor) === 0 && <span role="alert" className="basis-full font-mono text-[9px] text-red-300">DIVISOR CANNOT BE 0</span>}
                    </div>
                ) : editorMode ? (
                    <ConditionOperandInput
                        kind={condition.right?.type === "variable" ? "variable" : "number"}
                        disabled={disabled}
                        connectedLabel={operandTwoConnectionLabel}
                        selected={connecting?.targetId === operandTwoPortId && connecting.port === "operand-2"}
                        allowNumber={canUseVariableOperand}
                        numberValue={condition.right?.value ?? leftDefinition.defaultValue}
                        numberMin={leftDefinition.min ?? CUSTOM_INTEGER_MIN}
                        numberMax={leftDefinition.max ?? CUSTOM_INTEGER_MAX}
                        numberStep={leftDefinition.step ?? 1}
                        numberFallback={leftDefinition.defaultValue}
                        onNumberCommit={(value) => onChange({ ...condition, right: { type: "number", value } })}
                        onKindChange={changeRightType}
                        onSelect={() => onSelectOperand?.(2)}
                        onDisconnect={() => onDisconnectOperand?.(2)}
                        ariaLabel="Right condition input"
                    />
                ) : (
                    <div className="flex min-w-0 gap-1">
                        <select
                            value={condition.right?.type === "variable" ? "variable" : "number"}
                            onChange={(event) => changeRightType(event.target.value)}
                            className="h-8 w-16 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        >
                            <option value="number">#</option>
                            {canUseVariableOperand && <option value="variable">VAR</option>}
                        </select>
                        {condition.right?.type === "variable" ? <SearchablePicker
                            value={rightVariableDefinition?.id ?? numericVariables[0]?.id}
                            onChange={(value) => onChange({
                                ...condition,
                                right: { type: "variable", value },
                            })}
                            options={numericVariables}
                            placeholder="Search variables..."
                        /> : <div className="flex min-w-0 flex-1 items-center gap-1">
                            <DeferredNumberInput
                                min={leftDefinition.min ?? CUSTOM_INTEGER_MIN}
                                max={leftDefinition.max ?? CUSTOM_INTEGER_MAX}
                                step={leftDefinition.step ?? 1}
                                value={condition.right?.value ?? leftDefinition.defaultValue}
                                fallback={leftDefinition.defaultValue}
                                onCommit={(value) => onChange({ ...condition, right: { type: "number", value } })}
                                className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                            />
                            {leftDefinition.suffix && <span className="font-mono text-[9px] text-ink-muted">{leftDefinition.suffix}</span>}
                        </div>}
                    </div>
                ))}
                {!editorMode && !isAlways && leftDefinition.supportsTarget && (
                    <label className="col-span-3 grid grid-cols-[72px_1fr] items-center gap-1 font-mono text-[9px] text-ink-muted">
                        <span>LEFT TARGET</span>
                        <OrderedTargetPicker value={selectedTargetFor(leftDefinition, "leftTarget")} targetTypes={targetOptionsFor(leftDefinition)} onChange={(leftTarget) => onChange({ ...condition, leftTarget })} />
                    </label>
                )}
                {!editorMode && !isAlways && rightVariableDefinition?.supportsTarget && (
                    <label className="col-span-3 grid grid-cols-[72px_1fr] items-center gap-1 font-mono text-[9px] text-ink-muted">
                        <span>RIGHT TARGET</span>
                        <OrderedTargetPicker value={selectedTargetFor(rightVariableDefinition, "rightTarget")} targetTypes={targetOptionsFor(rightVariableDefinition)} onChange={(rightTarget) => onChange({ ...condition, rightTarget })} />
                    </label>
                )}
            </div>
            {removable ? <button type="button" onClick={onRemove} className="text-red-300">x</button> : <span />}
        </div>
    );
}

function ConditionJoinControl({ prefix, canChangeJoin, condition, onChange }) {
    if (!canChangeJoin) {
        return <span data-node-drag-ignore="true" className="code-condition-prefix font-mono text-[9px] text-amber-200">{prefix}</span>;
    }
    return (
        <select
            data-node-drag-ignore="true"
            value={condition.join === "or" ? "or" : "and"}
            onChange={(event) => onChange({
                ...condition,
                ...(event.target.value === "or" ? { join: "or" } : { join: undefined }),
            })}
            className="h-8 rounded border border-border-lo bg-zinc-950 px-0.5 font-mono text-[8px] text-amber-200"
        >
            <option value="and">AND</option>
            <option value="or">OR</option>
        </select>
    );
}

function sanitizeConfigurationConditions(configuration, conditionTypes, defaultCondition) {
    const allowedIds = new Set(conditionTypes.map((condition) => condition.id));
    const sanitizeConditions = (conditions) => {
        if (!Array.isArray(conditions)) return conditions;
        let changed = false;
        const nextConditions = conditions.map((condition) => {
            if (condition?.type === "expression") {
                return condition;
            }
            if (allowedIds.has(condition?.type)) return condition;
            changed = true;
            return createDefaultCondition(defaultCondition);
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
        neutral: "border-slate-600/70 bg-slate-950/25 text-slate-300 hover:border-slate-500 hover:bg-slate-800/60 hover:text-white",
        blue: "border-blue-700/60 bg-blue-950/25 text-blue-300 hover:bg-blue-900/40",
        green: "border-emerald-700/60 bg-emerald-950/25 text-emerald-300 hover:bg-emerald-900/35",
        red: "border-red-700/60 bg-red-950/25 text-red-300 hover:bg-red-900/35",
        violet: "border-violet-700/60 bg-violet-950/25 text-violet-300 hover:bg-violet-900/35",
        amber: "border-amber-700/60 bg-amber-950/25 text-amber-300 hover:bg-amber-900/35",
    };
    const accessibleLabel = label ?? (typeof children === "string" || typeof children === "number" ? String(children) : "Tool");
    return (
        <button
            type="button"
            aria-label={accessibleLabel}
            title={accessibleLabel}
            onClick={onClick}
            disabled={disabled}
            className={`font-display-action flex min-h-11 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-base shadow-[0_5px_15px_rgba(0,0,0,.12)] transition disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone] ?? tones.neutral} ${className}`}
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
    return (configuration.roots ?? []).reduce((total, root) => total + countTreeBranches(root.branches), 0);
}

function countLogicConditions(configuration) {
    return countConditionSlots(configuration);
}

function countTreeBranches(branches = []) {
    return branches.reduce((total, branch) => {
        const actions = Array.isArray(branch.actions) && branch.actions.length ? branch.actions : [branch];
        return total + actions.filter((entry) => entry.action !== "none").length + countTreeBranches(branch.children);
    }, 0);
}

function createDefaultCondition(definition) {
    if (definition.id === "expression") {
        return createExpressionCondition("target.distance");
    }
    return {
        type: definition.id,
        ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
        ...(definition.supportsTarget ? { target: definition.defaultTarget ?? "opponent" } : {}),
    };
}

function abilityIdsForConfiguration(configuration) {
    const encoded = String(configuration);
    return encoded.startsWith("sandbox:") ? new Set(decodeSandboxLoadout(encoded).abilities)
        : encoded.startsWith("custom:") ? new Set(decodeBotLoadout(encoded).abilities) : new Set();
}

function targetTypesForLoadouts(ownLoadout, opponentLoadout) {
    const ownAbilities = abilityIdsForConfiguration(ownLoadout), opponentAbilities = abilityIdsForConfiguration(opponentLoadout);
    return TARGET_TYPES
        .filter((target) => {
            if (!target.abilityId) return true;
            return (target.owner === "my" ? ownAbilities : opponentAbilities).has(target.abilityId);
        });
}

function OrderedTargetPicker({ value = "opponent", targetTypes = TARGET_TYPES, onChange }) {
    const [baseValue, encodedOrder, encodedOrdinal] = String(value).split(":");
    const base = targetTypes.some((target) => target.id === baseValue) ? baseValue : targetTypes[0]?.id ?? "opponent";
    const order = ["closest", "farthest", "oldest", "newest"].includes(encodedOrder) ? encodedOrder : "closest";
    const ordinal = Math.max(1, Math.min(100, Number(encodedOrdinal) || 1));
    const ordered = base !== "opponent";
    const encode = (nextBase, nextOrder = order, nextOrdinal = ordinal) => nextBase === "opponent"
        ? "opponent"
        : `${nextBase}:${nextOrder}:${Math.max(1, Math.min(100, Number(nextOrdinal) || 1))}`;
    return <div className={`grid gap-1 ${ordered ? "grid-cols-[minmax(0,1fr)_6rem_4rem]" : "grid-cols-1"}`}>
        <select value={base} onChange={(event) => onChange(encode(event.target.value))} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">
            {targetTypes.map((target) => <option key={target.id} value={target.id}>{target.label.replace(/^Closest /, "")}</option>)}
        </select>
        {ordered && <select aria-label="Target ordering" value={order} onChange={(event) => onChange(encode(base, event.target.value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">
            <option value="closest">Closest</option><option value="farthest">Farthest</option><option value="oldest">Oldest</option><option value="newest">Newest</option>
        </select>}
        {ordered && <DeferredNumberInput aria-label="Target ordinal" min={1} max={100} value={ordinal} fallback={1} onCommit={(value) => onChange(encode(base, order, value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white" />}
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
    const directionPhrase = {
        toward: "Toward",
        away: "Away From",
        left: "Left of",
        right: "Right of",
        toward_left: "Toward + Left of",
        toward_right: "Toward + Right of",
        away_left: "Away + Left of",
        away_right: "Away + Right of",
    }[direction] ?? "Toward";
    return `${directionPhrase} ${targetLabel}`;
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
    ConditionalOperandBox,
    GraphConditionNode,
    GraphActionNode,
    LogicNodeInspector,
    conditionGraphNodeId,
    actionGraphNodeId,
    graphEdgePath,
    newTreeBranch,
    nextBranchOrder,
    ConditionEditor,
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
