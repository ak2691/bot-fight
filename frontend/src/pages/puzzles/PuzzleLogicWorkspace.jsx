/* eslint-disable react-refresh/only-export-components */
import { useCallback, useRef, useState } from "react";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    BOT_LOGIC_TREE_VERSION,
    MAX_LOGIC_BLOCKS,
    MAX_ROOT_NODES,
    MAX_TOTAL_CONDITIONS,
    STATE_VARIABLES,
    createExpressionCondition,
    normalizeRoots,
} from "../../gameArena/botlogic/code/BotCode.js";
import { normalizeCreatedOrder, rootIdForCreatedOrder } from "../../gameArena/botlogic/code/configuration/identifiers.js";
import { DEFAULT_BOT_CONFIGURATION_ID } from "../../gameArena/gameconfig/CombatLoadouts.js";
import { TreeLogicBoard } from "../../gameArena/coding/LogicBoard.jsx";
import CustomVariablesModal from "../../gameArena/coding/modals/CustomVariablesModal.jsx";
import {
    addGraphAction,
    countLogicConditions,
    newTreeBranch,
} from "../../gameArena/coding/nodes/GraphNodes.jsx";

const INITIAL_ZOOM = 0.85;
const INITIAL_PAN = { x: 40, y: 36 };
const LEGACY_ACTION_FIELDS = [
    "action",
    "actionTarget",
    "movementMode",
    "movementDirection",
    "phaseFacingMode",
    "targetMode",
    "targetX",
    "targetY",
    "targetAngle",
    "targetOffsetX",
    "targetOffsetY",
    "variableId",
    "operation",
    "operand",
    "value",
    "terms",
];

function puzzleCondition(left, overrides = {}) {
    return { ...createExpressionCondition(left), ...overrides };
}

function puzzleRoot(name, kind, branch, createdOrder = 0) {
    const normalizedOrder = normalizeCreatedOrder(createdOrder);
    return {
        id: rootIdForCreatedOrder(normalizedOrder),
        name,
        kind,
        createdOrder: normalizedOrder,
        branches: [branch],
    };
}

export function createDefaultPuzzleLogic() {
    const defaultVariable = STATE_VARIABLES.find((variable) => variable.id === "target.distance")
        ?? STATE_VARIABLES[0];
    const winBranch = newTreeBranch("if", defaultVariable, 0);
    winBranch.conditions = [puzzleCondition("opponent.hp", {
        comparator: "lte",
        right: { type: "number", value: 0 },
    })];
    const loseBranch = newTreeBranch("if", defaultVariable, 0);
    loseBranch.conditions = [puzzleCondition("my.hp", {
        comparator: "lte",
        right: { type: "number", value: 0 },
    })];
    return normalizePuzzleLogic({
        version: BOT_LOGIC_TREE_VERSION,
        customVariables: [],
        roots: [
            puzzleRoot("Win Condition", "win", winBranch, 0),
            puzzleRoot("Lose Condition", "lose", loseBranch, 1),
        ],
    });
}

function walkBranches(branches, visit) {
    (branches ?? []).forEach((branch) => {
        visit(branch);
        walkBranches(branch.children, visit);
    });
}

export function flattenPuzzleConditions(configuration, kind) {
    const normalizedConfiguration = normalizePuzzleLogic(configuration);
    const conditions = [];
    (normalizedConfiguration?.roots ?? [])
        .filter((root) => root?.kind === kind)
        .forEach((root) => walkBranches(root.branches, (branch) => {
            conditions.push(...(Array.isArray(branch.conditions) ? branch.conditions : []));
        }));
    return conditions;
}

export function normalizePuzzleLogic(configuration) {
    if (!configuration) return configuration;
    const conditionNumbers = { win: 0, lose: 0, modify: 0 };
    const roots = normalizeRoots(configuration.roots ?? []).map((root) => {
        if (!["win", "lose", "modify"].includes(root?.kind)) return root;
        return {
            ...root,
            branches: normalizePuzzleBranches(root.branches, root.kind, conditionNumbers),
        };
    });
    return { ...configuration, roots };
}

function normalizePuzzleBranches(branches, kind, conditionNumbers) {
    if (!Array.isArray(branches)) return branches;
    return branches.map((branch) => {
        const normalizedBranch = kind === "modify" ? stripLegacyActionFields(branch) : { ...branch };
        return {
            ...normalizedBranch,
            conditions: Array.isArray(branch?.conditions)
                ? branch.conditions.map((condition) => ({
                    ...condition,
                    id: `puzzle-condition-${kind}-${++conditionNumbers[kind]}`,
                }))
                : branch?.conditions,
            children: normalizePuzzleBranches(branch?.children, kind, conditionNumbers),
        };
    });
}

function stripLegacyActionFields(branch) {
    const normalized = { ...(branch ?? {}) };
    LEGACY_ACTION_FIELDS.forEach((field) => delete normalized[field]);
    return normalized;
}

function createRuleRoot(stateVariables, kind, createdOrder) {
    const defaultVariable = stateVariables.find((variable) => variable.id === "target.distance")
        ?? stateVariables[0]
        ?? STATE_VARIABLES[0];
    const branch = newTreeBranch("if", defaultVariable, 0);
    const label = kind === "win" ? "Win Condition" : "Lose Condition";
    return puzzleRoot(label, kind, branch, createdOrder);
}

function createModifyRoot(configuration, stateVariables, createdOrder) {
    const defaultVariable = stateVariables.find((variable) => variable.id === "target.distance")
        ?? stateVariables[0]
        ?? STATE_VARIABLES[0];
    const branch = newTreeBranch("if", defaultVariable, 0);
    const withAction = addGraphAction(
        branch,
        DEFAULT_BOT_CONFIGURATION_ID,
        "variable",
        configuration.customVariables ?? [],
    );
    return puzzleRoot("Modify Custom Variable", "modify", withAction, createdOrder);
}

function clampZoom(value) {
    return Math.max(0.45, Math.min(1.35, value));
}

export default function PuzzleLogicWorkspace({
    configuration,
    onChange,
    stateVariables,
    targetTypes,
    maxCustomVariables,
    onClose,
    readOnly = false,
}) {
    const dialogRef = useRef(null);
    const [isCustomVariablesOpen, setIsCustomVariablesOpen] = useState(false);
    const [zoom, setZoom] = useState(INITIAL_ZOOM);
    const [pan, setPan] = useState(INITIAL_PAN);
    const [history, setHistory] = useState({ undo: [], redo: [] });
    const currentConfiguration = configuration ?? createDefaultPuzzleLogic();
    const defaultVariable = stateVariables.find((variable) => variable.id === "target.distance")
        ?? stateVariables[0]
        ?? STATE_VARIABLES[0];

    const closeTopLayer = useCallback(() => {
        if (isCustomVariablesOpen) {
            setIsCustomVariablesOpen(false);
            return;
        }
        onClose();
    }, [isCustomVariablesOpen, onClose]);

    useDialogFocus(dialogRef, {
        onClose: closeTopLayer,
        lockScroll: true,
    });

    const commitConfiguration = useCallback((nextConfiguration) => {
        if (readOnly || !nextConfiguration || nextConfiguration === currentConfiguration) return;
        const normalizedConfiguration = normalizePuzzleLogic(nextConfiguration);
        setHistory((current) => ({
            undo: [...current.undo, currentConfiguration].slice(-100),
            redo: [],
        }));
        onChange(normalizedConfiguration);
    }, [currentConfiguration, onChange, readOnly]);

    const travelHistory = useCallback((direction) => {
        if (readOnly) return;
        setHistory((current) => {
            const source = direction === "undo" ? current.undo : current.redo;
            if (!source.length) return current;
            const nextConfiguration = source[source.length - 1];
            const nextSource = source.slice(0, -1);
            const opposite = direction === "undo"
                ? [...current.redo, currentConfiguration]
                : [...current.undo, currentConfiguration];
            onChange(normalizePuzzleLogic(nextConfiguration));
            return direction === "undo"
                ? { undo: nextSource, redo: opposite }
                : { undo: opposite, redo: nextSource };
        });
    }, [currentConfiguration, onChange, readOnly]);

    const addRoot = useCallback((kind) => {
        if (readOnly || currentConfiguration.roots.length >= MAX_ROOT_NODES) return;
        const createdOrder = currentConfiguration.roots.length;
        const root = kind === "modify"
            ? createModifyRoot(currentConfiguration, stateVariables, createdOrder)
            : createRuleRoot(stateVariables, kind, createdOrder);
        commitConfiguration({
            ...currentConfiguration,
            roots: [...currentConfiguration.roots, root],
        });
    }, [commitConfiguration, currentConfiguration, readOnly, stateVariables]);

    const changeZoom = useCallback((delta, origin = null) => {
        const nextZoom = clampZoom(zoom + delta);
        if (origin && nextZoom !== zoom) {
            const scale = nextZoom / zoom;
            setPan((current) => ({
                x: origin.x - (origin.x - current.x) * scale,
                y: origin.y - (origin.y - current.y) * scale,
            }));
        }
        setZoom(nextZoom);
    }, [zoom]);

    const customVariableCount = currentConfiguration.customVariables?.length ?? 0;
    const conditionCount = countLogicConditions(currentConfiguration);
    const actionCount = (currentConfiguration.roots ?? []).reduce((total, root) => {
        let count = 0;
        walkBranches(root.branches, (branch) => { count += Array.isArray(branch.actions) ? branch.actions.length : 0; });
        return total + count;
    }, 0);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialogRef} className="code-workspace testing-mono relative flex h-[min(92vh,900px)] w-[min(96vw,1500px)] flex-col overflow-hidden rounded-sm border border-border-mid bg-[#111519] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="puzzle-logic-workspace-title" tabIndex={-1}>
                <header className="code-toolbar flex min-h-[84px] flex-shrink-0 items-center gap-4 border-b border-white/10 bg-[#12161a] px-5 py-3 shadow-[0_8px_24px_rgba(0,0,0,.18)]">
                    <div className="code-toolbar-title flex-none">
                        <div id="puzzle-logic-workspace-title" className="font-mono text-[11px] font-bold tracking-widest text-cyan">CONFIG{readOnly && <span className="ml-2 text-[9px] text-ink-muted">VIEW ONLY</span>}</div>
                        <div className="mt-1 truncate font-mono text-[8px] tracking-wide text-ink-muted">{customVariableCount}/{maxCustomVariables} V · {actionCount}/{MAX_LOGIC_BLOCKS} A · {conditionCount}/{MAX_TOTAL_CONDITIONS} C</div>
                    </div>
                    <div className="code-toolbar-controls min-w-0 flex-1 py-0.5">
                        <div className="code-toolbar-tools">
                            <button type="button" disabled={readOnly || currentConfiguration.roots.length >= MAX_ROOT_NODES} onClick={() => addRoot("win")} className="code-toolbar-button code-toolbar-button-primary"><span aria-hidden="true" className="code-toolbar-icon">＋</span> WIN CONDITION</button>
                            <button type="button" disabled={readOnly || currentConfiguration.roots.length >= MAX_ROOT_NODES} onClick={() => addRoot("lose")} className="code-toolbar-button code-toolbar-button-primary"><span aria-hidden="true" className="code-toolbar-icon">＋</span> LOSE CONDITION</button>
                            <button type="button" disabled={readOnly || customVariableCount >= maxCustomVariables} onClick={() => setIsCustomVariablesOpen(true)} className="code-toolbar-button"><span aria-hidden="true" className="code-toolbar-icon">＋</span> CUSTOM VARIABLE</button>
                            <button type="button" disabled={readOnly || !customVariableCount || currentConfiguration.roots.length >= MAX_ROOT_NODES || actionCount >= MAX_LOGIC_BLOCKS} onClick={() => addRoot("modify")} className="code-toolbar-button"><span aria-hidden="true" className="code-toolbar-icon">＋</span> MODIFY CUSTOM VARIABLE</button>
                        </div>
                        <div className="code-toolbar-actions">
                            <div className="code-toolbar-zoom">
                                <button type="button" aria-label="Zoom out" onClick={() => changeZoom(-0.1)} className="code-toolbar-zoom-button">−</button>
                                <span className="code-toolbar-zoom-value">{Math.round(zoom * 100)}%</span>
                                <button type="button" aria-label="Zoom in" onClick={() => changeZoom(0.1)} className="code-toolbar-zoom-button">+</button>
                            </div>
                            <button type="button" aria-label="Close puzzle configuration" title="Close" onClick={onClose} className="code-toolbar-button code-toolbar-close"><span aria-hidden="true">×</span><span className="code-toolbar-close-label">CLOSE</span></button>
                        </div>
                    </div>
                </header>
                <TreeLogicBoard
                    configuration={currentConfiguration}
                    puzzleMode
                    disabled={readOnly || isCustomVariablesOpen}
                    canRemove={!readOnly && !isCustomVariablesOpen}
                    selectedLoadout={DEFAULT_BOT_CONFIGURATION_ID}
                    stateVariables={stateVariables}
                    defaultVariable={defaultVariable}
                    targetTypes={targetTypes}
                    onChange={commitConfiguration}
                    zoom={zoom}
                    pan={pan}
                    onPanChange={setPan}
                    onZoomChange={changeZoom}
                    canUndo={!readOnly && history.undo.length > 0}
                    canRedo={!readOnly && history.redo.length > 0}
                    onUndo={() => travelHistory("undo")}
                    onRedo={() => travelHistory("redo")}
                    isSearchOpen={false}
                    isExternalConfigurationOpen={!readOnly && isCustomVariablesOpen}
                    onCloseExternalConfiguration={() => setIsCustomVariablesOpen(false)}
                    maxLogicBlocks={MAX_LOGIC_BLOCKS}
                    maxTotalConditions={MAX_TOTAL_CONDITIONS}
                />
                {!readOnly && isCustomVariablesOpen && <CustomVariablesModal configuration={currentConfiguration} currentValues={{}} maxSlots={maxCustomVariables} idPrefix="custom.puzzle" disabled={false} onChange={commitConfiguration} onClose={() => setIsCustomVariablesOpen(false)} />}
            </section>
        </div>
    );
}
