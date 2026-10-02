/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    BOT_LOGIC_TREE_VERSION,
    BOT_CODE_SELECTABLES,
    CONDITION_TYPES,
    MAX_LOGIC_BLOCKS,
    MAX_ROOT_NODES,
    MAX_TOTAL_CONDITIONS,
    SELECTABLE_TYPES,
    STATE_VARIABLES,
    VISIBLE_STATE_VARIABLES,
    customVariableDefinitions,
    createExpressionCondition,
    normalizeConditions,
    normalizeRoots,
} from "../../gameArena/botlogic/code/BotCode.js";
import { BOT_LOGIC_TREE_V1 } from "../../gameArena/botlogic/code/configuration/constants.js";
import { createEditorNodeId, normalizePriority } from "../../gameArena/botlogic/code/configuration/identifiers.js";
import { DEFAULT_BOT_CONFIGURATION_ID } from "../../gameArena/gameconfig/CombatLoadouts.js";
import { TreeLogicBoard } from "../../gameArena/coding/LogicBoard.jsx";
import AddIcon from "../../gameArena/coding/controls/AddIcon.jsx";
import { BudgetMeter, ToolbarBracesIcon, ToolbarCloseIcon } from "../../gameArena/coding/controls/WorkspaceToolbarBits.jsx";
import CustomVariablesModal from "../../gameArena/coding/modals/CustomVariablesModal.jsx";
import {
    countLogicConditions,
    newTreeBranch,
    sanitizeConfigurationConditions,
} from "../../gameArena/coding/nodes/GraphNodes.jsx";
import { normalizePuzzleCustomVariables } from "./puzzleLogicNormalization.js";
import { upgradeStoredStrategyCoordinates } from "../../gameArena/persistence/arenaStrategyStorage.js";

const INITIAL_ZOOM = 0.85;
const INITIAL_PAN = { x: 40, y: 36 };
const LEGACY_ACTION_FIELDS = [
    "action",
    "selectable",
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

function puzzleRoot(name, kind, branch, priority = 1, id = null) {
    return {
        id: String(id ?? "").trim() || createEditorNodeId(`puzzle-${kind}-root`),
        name,
        kind,
        priority: normalizePriority(priority),
        branches: [branch],
    };
}

export function createDefaultPuzzleLogic(playerTeamSize = 1, opponentTeamSize = 1) {
    const defaultVariable = VISIBLE_STATE_VARIABLES.find((variable) => variable.id === "selectable.distance")
        ?? VISIBLE_STATE_VARIABLES[0]
        ?? STATE_VARIABLES[0];
    const winBranch = newTreeBranch("if", defaultVariable, 1);
    const opponentSelectors = Number(opponentTeamSize) > 1
        ? Array.from({ length: Math.min(2, Math.max(1, Number(opponentTeamSize))) }, (_, index) => `opponent_${index + 1}`)
        : [BOT_CODE_SELECTABLES.OPPONENT];
    winBranch.conditions = opponentSelectors.map((leftSelectable) => puzzleCondition("selectable.hp", {
        leftSelectable,
        comparator: "lte",
        right: { type: "number", value: 0 },
    }));
    const loseBranch = newTreeBranch("if", defaultVariable, 1);
    const playerSelectors = ["my_bot"];
    if (Number(playerTeamSize) > 1) playerSelectors.push("teammate_1");
    loseBranch.conditions = playerSelectors.map((leftSelectable) => puzzleCondition("selectable.hp", {
        leftSelectable,
        comparator: "lte",
        right: { type: "number", value: 0 },
    }));
    return normalizePuzzleLogic({
        version: BOT_LOGIC_TREE_VERSION,
        customVariables: [],
        roots: [
            puzzleRoot("Win Condition", "win", winBranch, 1, "puzzle-root-win"),
            puzzleRoot("Lose Condition", "lose", loseBranch, 2, "puzzle-root-lose"),
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

export function normalizePuzzleLogic(configuration, options = {}) {
    if (!configuration) return configuration;
    const conditionNumbers = { win: 0, lose: 0, modify: 0, other: 0 };
    const normalizedCustomVariables = normalizePuzzleCustomVariables(configuration);
    const customVariables = customVariableDefinitions({ customVariables: normalizedCustomVariables });
    const selectableTypes = options.selectableTypes ?? SELECTABLE_TYPES;
    const roots = normalizeRoots(configuration.roots ?? []).map((root) => {
        const normalizedKind = typeof root?.kind === "string" ? root.kind.trim().toLowerCase() : root?.kind;
        const normalizedRoot = normalizedKind !== root?.kind && typeof root?.kind === "string"
            ? { ...root, kind: normalizedKind }
            : root;
        return {
            ...normalizedRoot,
            branches: normalizePuzzleBranches(root?.branches, normalizedKind, conditionNumbers, customVariables, selectableTypes),
        };
    });
    return sanitizeConfigurationConditions(
        {
            ...configuration,
            // Existing puzzles without a discriminator were authored with the
            // historical top-left/Y-down contract. New puzzles are created
            // with an explicit v2 above.
            version: configuration.version ?? BOT_LOGIC_TREE_V1,
            customVariables: normalizedCustomVariables,
            roots,
        },
        options.conditionTypes ?? CONDITION_TYPES,
        options.defaultCondition ?? CONDITION_TYPES[0],
        selectableTypes,
        options.stateVariables ?? STATE_VARIABLES,
        options.selectableAbilityIds ?? null,
    );
}

function normalizePuzzleBranches(branches, kind, conditionNumbers, customVariables, selectableTypes) {
    if (!Array.isArray(branches)) return branches;
    const conditionKind = ["win", "lose", "modify"].includes(kind) ? kind : "other";
    return branches.map((branch) => {
        const normalizedBranch = stripLegacyActionFields(branch);
        if (kind !== "modify") normalizedBranch.actions = [];
        const normalizedConditions = Array.isArray(branch?.conditions)
            ? (selectableTypes === SELECTABLE_TYPES
                ? normalizeConditions(branch.conditions, customVariables, SELECTABLE_TYPES)
                : normalizeConditions(branch.conditions, customVariables, selectableTypes))
            : branch?.conditions;
        return {
            ...normalizedBranch,
            conditions: Array.isArray(normalizedConditions)
                ? normalizedConditions.map((condition, index) => ({
                    ...condition,
                    // Puzzle outcome conditions are a separate system and still support OR;
                    // bot conditionals are AND-only, so normalizeConditions drops the join.
                    ...(index > 0 && kind !== "modify" && branch.conditions[index]?.join === "or" ? { join: "or" } : {}),
                    id: `puzzle-condition-${conditionKind}-${++conditionNumbers[conditionKind]}`,
                }))
                : normalizedConditions,
            children: normalizePuzzleBranches(branch?.children, conditionKind, conditionNumbers, customVariables, selectableTypes),
        };
    });
}

function stripLegacyActionFields(branch) {
    const normalized = { ...(branch ?? {}) };
    LEGACY_ACTION_FIELDS.forEach((field) => delete normalized[field]);
    return normalized;
}

function createRuleRoot(stateVariables, kind, priority) {
    const defaultVariable = stateVariables.find((variable) => variable.id === "selectable.distance")
        ?? stateVariables[0]
        ?? VISIBLE_STATE_VARIABLES.find((variable) => variable.id === "selectable.distance")
        ?? STATE_VARIABLES[0];
    const branch = newTreeBranch("if", defaultVariable, 1);
    const label = kind === "win" ? "Win rule" : "Lose rule";
    return puzzleRoot(label, kind, branch, priority);
}

function clampZoom(value) {
    return Math.max(0.45, Math.min(1.35, value));
}

export default function PuzzleLogicWorkspace({
    configuration,
    onChange,
    stateVariables,
    selectableTypes,
    selectableAbilityIds = null,
    maxCustomVariables,
    onClose,
    readOnly = false,
}) {
    const dialogRef = useRef(null);
    const [isCustomVariablesOpen, setIsCustomVariablesOpen] = useState(false);
    const [zoom, setZoom] = useState(INITIAL_ZOOM);
    const [pan, setPan] = useState(INITIAL_PAN);
    const [history, setHistory] = useState({ undo: [], redo: [] });
    const currentConfiguration = useMemo(() => {
        const source = configuration ?? createDefaultPuzzleLogic();
        return readOnly ? source : upgradeStoredStrategyCoordinates(source);
    }, [configuration, readOnly]);
    const defaultVariable = stateVariables.find((variable) => variable.id === "selectable.distance")
        ?? stateVariables[0]
        ?? VISIBLE_STATE_VARIABLES.find((variable) => variable.id === "selectable.distance")
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
        const normalizedConfiguration = normalizePuzzleLogic(nextConfiguration, {
            stateVariables,
            selectableTypes,
            selectableAbilityIds,
        });
        setHistory((current) => ({
            undo: [...current.undo, currentConfiguration].slice(-100),
            redo: [],
        }));
        onChange(normalizedConfiguration);
    }, [currentConfiguration, onChange, readOnly, selectableAbilityIds, selectableTypes, stateVariables]);

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
            onChange(normalizePuzzleLogic(nextConfiguration, {
                stateVariables,
                selectableTypes,
                selectableAbilityIds,
            }));
            return direction === "undo"
                ? { undo: nextSource, redo: opposite }
                : { undo: opposite, redo: nextSource };
        });
    }, [currentConfiguration, onChange, readOnly, selectableAbilityIds, selectableTypes, stateVariables]);

    const addRoot = useCallback((kind) => {
        if (readOnly || currentConfiguration.roots.length >= MAX_ROOT_NODES) return;
        const priority = currentConfiguration.roots.length + 1;
        const root = createRuleRoot(stateVariables, kind, priority);
        commitConfiguration({
            ...currentConfiguration,
            roots: [...currentConfiguration.roots, root],
        });
    }, [commitConfiguration, currentConfiguration, readOnly, stateVariables]);

    // Latest zoom / pan in refs so rapid wheel events zoom about the cursor without stale values.
    const zoomRef = useRef(zoom);
    const panRef = useRef(pan);
    useEffect(() => { zoomRef.current = zoom; panRef.current = pan; });
    const changeZoom = useCallback((delta, origin = null) => {
        const currentZoom = zoomRef.current;
        const nextZoom = clampZoom(currentZoom + delta);
        if (nextZoom === currentZoom) return;
        let anchor = origin;
        if (!anchor) {
            const rect = dialogRef.current?.querySelector(".code-board")?.getBoundingClientRect();
            if (rect) anchor = { x: rect.width / 2, y: rect.height / 2 };
        }
        if (anchor) {
            const scale = nextZoom / currentZoom;
            const nextPan = {
                x: anchor.x - (anchor.x - panRef.current.x) * scale,
                y: anchor.y - (anchor.y - panRef.current.y) * scale,
            };
            panRef.current = nextPan;
            setPan(nextPan);
        }
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
    }, []);
    const applyPinchZoom = useCallback((nextZoom, nextPan) => {
        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        setZoom(nextZoom);
        setPan(nextPan);
    }, []);

    const customVariableCount = currentConfiguration.customVariables?.length ?? 0;
    const conditionCount = countLogicConditions(currentConfiguration);

    return typeof document === "undefined" ? null : createPortal(
        <div className="code-workspace-overlay fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/75 px-4 py-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialogRef} className="code-workspace relative flex h-[min(92vh,900px)] w-[min(96vw,1500px)] flex-col overflow-hidden rounded-sm border border-border-mid bg-[#111519] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="puzzle-logic-workspace-title" tabIndex={-1}>
                <header className="code-tb">
                    <h2 id="puzzle-logic-workspace-title" className="code-tb-title font-display">
                        Win and lose rules{readOnly && <span className="ml-2 text-[11px] font-normal text-slate-500">View only</span>}
                    </h2>
                    <div className="code-tb-meters" role="group" aria-label="Rules budget">
                        <BudgetMeter label="Conditions" value={conditionCount} max={MAX_TOTAL_CONDITIONS} />
                    </div>
                    <div className="code-tb-chips" role="group" aria-label="Rules budget">
                        <BudgetMeter label="C" title="Conditions" value={conditionCount} max={MAX_TOTAL_CONDITIONS} compact />
                    </div>
                    <span className="code-tb-spacer" />
                    <button type="button" disabled={readOnly || currentConfiguration.roots.length >= MAX_ROOT_NODES} onClick={() => addRoot("win")} className="code-tb-btn code-tb-btn--win" aria-label="Add win rule" title="Add win rule">
                        <AddIcon className="code-toolbar-icon" /> <span className="code-tb-label">Win rule</span>
                    </button>
                    <button type="button" disabled={readOnly || currentConfiguration.roots.length >= MAX_ROOT_NODES} onClick={() => addRoot("lose")} className="code-tb-btn code-tb-btn--lose" aria-label="Add lose rule" title="Add lose rule">
                        <AddIcon className="code-toolbar-icon" /> <span className="code-tb-label">Lose rule</span>
                    </button>
                    <button type="button" disabled={readOnly || customVariableCount >= maxCustomVariables} onClick={() => setIsCustomVariablesOpen(true)} className="code-tb-btn" aria-label="Custom variables" title="Custom variables">
                        <ToolbarBracesIcon />
                        <span className="code-tb-label">Variables</span>
                    </button>
                    <button type="button" aria-label="Close puzzle configuration" title="Close" onClick={onClose} className="code-tb-close">
                        <ToolbarCloseIcon />
                    </button>
                </header>
                <TreeLogicBoard
                    configuration={currentConfiguration}
                    puzzleMode
                    disabled={readOnly || isCustomVariablesOpen}
                    canRemove={!readOnly && !isCustomVariablesOpen}
                    selectedLoadout={DEFAULT_BOT_CONFIGURATION_ID}
                    selectableAbilityIds={selectableAbilityIds}
                    stateVariables={stateVariables}
                    defaultVariable={defaultVariable}
                    selectableTypes={selectableTypes}
                    onChange={commitConfiguration}
                    zoom={zoom}
                    pan={pan}
                    onPanChange={setPan}
                    onZoomChange={changeZoom}
                    onPinchZoom={applyPinchZoom}
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
                <div className="code-zoom-cluster" role="group" aria-label="Zoom">
                    <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => changeZoom(-0.1)}>&minus;</button>
                    <span className="code-zoom-value">{Math.round(zoom * 100)}%</span>
                    <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => changeZoom(0.1)}>+</button>
                </div>
                {!readOnly && isCustomVariablesOpen && <CustomVariablesModal configuration={currentConfiguration} currentValues={{}} maxSlots={maxCustomVariables} idPrefix="custom.puzzle" disabled={false} onChange={commitConfiguration} onClose={() => setIsCustomVariablesOpen(false)} />}
            </section>
        </div>,
        document.body
    );
}
