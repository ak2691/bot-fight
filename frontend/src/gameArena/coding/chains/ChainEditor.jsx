import { TrashIcon } from "../controls/WorkspaceToolbarBits.jsx";
import { createClickLog } from "../doubleClick.js";
import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { isWorkspaceShortcutKeydown, readWorkspaceShortcut } from "../addRootShortcut.js";
import {
    ACTION_TYPES,
    createExpressionCondition,
    countActionSlots,
    countConditionSlots,
    MAX_CONDITIONS_PER_BRANCH,
} from "../../botlogic/code/BotCode.js";
import { CHAIN_STEP_TYPES, MAX_CHAIN_NAME_LENGTH, coordinateVersionFor } from "../../botlogic/code/configuration/constants.js";
import { actionTypesForLoadout } from "../../gameconfig/CombatLoadouts.js";
import {
    ActionVariableInspector,
    NodeKindPicker,
    VariableOperandPicker,
    conditionSummaryLookups,
    summarizeConditionForNode,
    conditionPlainText,
} from "../nodes/GraphNodes.jsx";
import { actionOperandAt, actionOperandValueType, withActionOperand, withActionOperandVariable } from "../nodes/actionOperandEdits.js";
import { ChainStepInspector } from "./ChainStepInspector.jsx";
import {
    BODY,
    BRANCH,
    LOOSE,
    isConditional,
    isLoosePath,
    FLOW_STEP_TYPES,
    addLooseBlock,
    addLooseBlockReason,
    addStepBlockReason,
    chainUsage,
    chainsOf,
    chooseDropGap,
    conditionFieldOf,
    cleanChainName,
    dropBlockReason,
    findChain,
    firstCallableChain,
    looseOf,
    moveStepAt,
    newActionStep,
    newFlowStep,
    numberChainSteps,
    stepPathsInOrder,
    pathKey,
    placeBlockInStack,
    removeStepPath,
    renameChain,
    samePath,
    stepAtPath,
    updateChain,
    updateStepPath,
    withConditionOperand,
} from "./chainEditing.js";
import { describeChainStep } from "./chainStepPresentation.js";
import "./chainEditor.css";

const FLOW_OPTIONS = FLOW_STEP_TYPES.map((option) => ({ ...option, head: "flow" }));
const NOTICE_MS = 5000;
const DRAG_START_PX = 4;
const LONG_PRESS_MS = 300;
const TOUCH_SLOP_PX = 10;
const EDGE_SCROLL_PX = 48;
const EDGE_SCROLL_SPEED = 14;
/** Where the stack sits on the canvas; loose blocks use the same canvas coordinates. */
const STACK_LEFT = 72;
const STACK_WIDTH = 300;
const STACK_TOP = 28;
/** Room kept past the right-most block, so the canvas scrolls before content reaches the edge. */
const RIGHT_ROOM = 300;
const NOT_DRAGGABLE = "button,input,select,textarea,a,.code-bt-x,.code-pin-add-condition";

function isWide() {
    return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 601px)").matches;
}

function NameInput({ value, disabled, onCommit }) {
    const [draft, setDraft] = useState(value);
    return <input
        type="text"
        className="cx-name"
        maxLength={MAX_CHAIN_NAME_LENGTH}
        value={draft}
        disabled={disabled}
        aria-label="Chain name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { onCommit(draft); setDraft(cleanChainName(draft, value)); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
    />;
}

/**
 * The chain canvas: a CHAIN header and the steps stacked directly under it with no gaps, like Scratch blocks.
 * If / Else if / Repeat are C-blocks (header, indented mouth, foot). "Add step" places a loose block beside
 * the stack; dragging a block (press and move) carries only that block, drops it into the nearest gap or
 * leaves it loose. Loose blocks never run.
 */
export const ChainEditor = forwardRef(function ChainEditor({
    configuration,
    chainId,
    runningChain = null,
    disabled,
    selectedLoadout,
    selectableAbilityIds,
    stateVariables,
    defaultVariable,
    selectableTypes,
    onChange,
    onOpenChain,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    maxLogicBlocks,
    maxTotalConditions,
    isExternalConfigurationOpen = false,
    onCloseExternalConfiguration,
    onDragChange = null,
    phone = false,
    onSelectionChange = null,
}, ref) {
    const chains = useMemo(() => chainsOf(configuration), [configuration]);
    const chain = findChain(configuration, chainId);
    const customVariables = useMemo(() => configuration.customVariables ?? [], [configuration.customVariables]);
    const coordinateVersion = coordinateVersionFor(configuration);
    const actionTypes = useMemo(() => actionTypesForLoadout(ACTION_TYPES, selectedLoadout), [selectedLoadout]);
    const lookups = useMemo(() => conditionSummaryLookups(stateVariables, selectableTypes), [stateVariables, selectableTypes]);
    const [selected, setSelected] = useState(null);
    const [conditionIndex, setConditionIndex] = useState(null);
    // "foot" when the selection is the end of a C-block rather than its header.
    const [selectedPart, setSelectedPart] = useState(null);
    const [insertPreview, setInsertPreview] = useState(null);
    const clickLogRef = useRef(createClickLog());
    const [inspecting, setInspecting] = useState(false);
    const [picker, setPicker] = useState(null);
    const [operandPicker, setOperandPicker] = useState(null);
    const [operandInspector, setOperandInspector] = useState(null);
    const [notice, setNotice] = useState("");
    // A block being carried: it is out of the stack (and out of the loose list) until it is dropped.
    const [drag, setDrag] = useState(null);
    const [dropTarget, setDropTarget] = useState(null);
    const boardRef = useRef(null);
    const canvasRef = useRef(null);
    const scrollRef = useRef(null);
    const stackRef = useRef(null);
    const dragRef = useRef(null);
    const pointerRef = useRef({ x: 0, y: 0 });

    // While a block is carried the chain is shown without it, so the gap it left closes.
    const draftChain = useMemo(() => (chain && drag ? removeStepPath(chain, drag.path) : chain), [chain, drag]);
    const viewChain = draftChain ?? chain;
    const steps = useMemo(() => viewChain?.steps ?? [], [viewChain]);
    const loose = looseOf(viewChain);
    const numbers = useMemo(() => numberChainSteps(steps), [steps]);

    const budget = {
        actions: maxLogicBlocks - countActionSlots(configuration),
        conditions: maxTotalConditions - countConditionSlots(configuration),
    };
    const selectedStep = selected && viewChain ? stepAtPath(viewChain, selected) : null;
    const describeContext = { actionTypes, selectableTypes, customVariables, stateVariables, chains, lookups };

    useEffect(() => {
        if (!notice) return undefined;
        const timer = window.setTimeout(() => setNotice(""), NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [notice]);
    // The custom variables dialog and this panel never share the screen: opening it closes the panels.
    const [externalWasOpen, setExternalWasOpen] = useState(false);
    if (isExternalConfigurationOpen !== externalWasOpen) {
        setExternalWasOpen(isExternalConfigurationOpen);
        if (isExternalConfigurationOpen) {
            setInspecting(false);
            setPicker(null);
            setOperandPicker(null);
            setOperandInspector(null);
        }
    }
    // A step that no longer exists (deleted, or undone away) cannot stay selected.
    if (selected && !selectedStep && !drag) {
        setSelected(null);
        setInspecting(false);
    }

    const closeMenus = () => {
        onCloseExternalConfiguration?.();
        setPicker(null);
        setOperandPicker(null);
        setOperandInspector(null);
    };
    const clearSelection = () => {
        setSelected(null);
        setSelectedPart(null);
        setInspecting(false);
        setPicker(null);
        setOperandPicker(null);
        setOperandInspector(null);
    };
    const commitChain = (next) => {
        if (disabled || !chain) return;
        onChange(updateChain(configuration, chain.id, () => next));
    };
    // `change` is the next step, or a function of the current one.
    const updateStep = (path, change) => commitChain(updateStepPath(chain, path, (step) => (typeof change === "function" ? change(step) : change)));
    const removeStep = (path) => {
        commitChain(removeStepPath(chain, path));
        clearSelection();
    };
    const moveStep = (path, delta) => {
        const moved = isLoosePath(path) ? null : moveStepAt(chain.steps ?? [], path, delta);
        if (!moved) return;
        commitChain({ ...chain, steps: moved.steps });
        setSelected(moved.path);
    };

    const select = (path, rowIndex = null) => {
        setConditionIndex(rowIndex);
        closeMenus();
        setSelected(path);
        setSelectedPart(null);
        setInspecting(true);
    };
    // Selecting without opening the side panel (a C-block header, its foot, or the first tap on a phone).
    const selectOnly = (path, rowIndex = null, part = null) => {
        setConditionIndex(rowIndex);
        closeMenus();
        setSelected(path);
        setSelectedPart(part);
        setInspecting(false);
    };
    // A click or tap only selects (a row remembers which condition). Double-click, Enter / E, or Edit in the phone bar opens it.
    const plainTap = (path) => selectOnly(path);
    const headerTap = (path) => selectOnly(path);
    const rowTap = (path, rowIndex) => selectOnly(path, rowIndex);
    // Steps with nothing to edit (End, Exit loop, an Else-less header) have no Edit.
    const canEditStep = (step) => Boolean(step) && ![CHAIN_STEP_TYPES.END, CHAIN_STEP_TYPES.EXIT_LOOP].includes(step.type);
    const footTap = (path) => selectOnly(path, null, "foot");
    const newStepCondition = (kind) => {
        const ready = kind === "until" ? stateVariables.find((variable) => variable.id === "bot.selectedAbilityReady") : null;
        return createExpressionCondition(ready ?? defaultVariable, selectableTypes);
    };

    // ---- Adding: a new block is loose, right of the stack's bottom, selected ---------------------
    const canvasPoint = (clientX, clientY) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        return { x: Math.max(0, clientX - (rect?.left ?? 0)), y: Math.max(0, clientY - (rect?.top ?? 0)) };
    };
    // A double-click on the empty canvas adds a loose block where it was clicked.
    const openLooseStep = (point) => {
        if (disabled || !chain) return;
        const reason = addLooseBlockReason({ chains, chain, stepType: CHAIN_STEP_TYPES.END, budget });
        if (reason && (budget.actions <= 0 || reason.includes("full"))) {
            setNotice(reason);
            return;
        }
        closeMenus();
        setInspecting(false);
        setPicker({ point });
    };
    // The toolbar's "Add step" and the add-node key insert under the selected step (inside the mouth when an
    // If / Else if / Repeat is selected), or at the end of the chain.
    const insertionTarget = () => {
        const current = selected && !isLoosePath(selected) ? stepAtPath(chain, selected) : null;
        const isBlock = isConditional(current) || current?.type === CHAIN_STEP_TYPES.REPEAT;
        // A selected foot adds directly after the whole block; a selected header adds first inside its mouth.
        if (current && isBlock && selectedPart !== "foot") return { listPath: [...selected, isConditional(current) ? BRANCH : BODY], index: 0 };
        if (current) return { listPath: selected.slice(0, -1), index: selected.at(-1) + 1 };
        return { listPath: [], index: (chain.steps ?? []).length };
    };
    const openInsertStep = () => {
        if (disabled || !chain || drag) return;
        const target = insertionTarget();
        const reason = addStepBlockReason({ chains, chain, listPath: target.listPath, stepType: CHAIN_STEP_TYPES.END, budget, insertionIndex: target.index });
        if (reason && (budget.actions <= 0 || reason.includes("full"))) {
            setNotice(reason);
            return;
        }
        closeMenus();
        setInspecting(false);
        setPicker(target);
    };
    useImperativeHandle(ref, () => ({
        addStep: openInsertStep,
        // The chain canvas has no zoom: "fit" brings the stack back to the top-left.
        fit: () => scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" }),
        // The phone bottom bar's commands for the selected block.
        editSelection: () => { if (selected) select(selected, conditionIndex); },
        moveSelection: (delta) => { if (selected) moveStep(selected, delta); },
        deleteSelection: () => { if (selected) removeStep(selected); },
        clearSelection,
        // Selects a step by path (used by the Variables dialog's "Used in" list).
        selectStep: (path) => selectOnly(path),
    }));
    const dragging = Boolean(drag);
    useEffect(() => { onDragChange?.(dragging); }, [dragging, onDragChange]);
    const pickerReason = (type) => (picker?.point
        ? addLooseBlockReason({ chains, chain, stepType: type, budget })
        : addStepBlockReason({ chains, chain, listPath: picker.listPath, stepType: type, budget, insertionIndex: picker.index }));
    const addPicked = (step) => {
        if (picker.point) {
            const next = addLooseBlock(chain, step, picker.point.x, picker.point.y);
            commitChain(next);
            setSelected([LOOSE, looseOf(next).length - 1]);
        } else {
            const next = placeBlockInStack(chain, picker.listPath, picker.index, step);
            if (!next) { setPicker(null); return; }
            commitChain(next);
            setSelected([...picker.listPath, picker.index]);
        }
        setPicker(null);
        setConditionIndex(null);
        setInspecting(isWide());
    };
    const chooseFlow = (type) => {
        const reason = pickerReason(type);
        if (reason) {
            setPicker(null);
            setNotice(reason);
            return;
        }
        addPicked(newFlowStep(type, {
            defaultCondition: [CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(type) ? newStepCondition("if") : null,
            chainId: type === CHAIN_STEP_TYPES.RUN_CHAIN ? firstCallableChain(chains, chain.id)?.id ?? "" : "",
        }));
    };
    const chooseAction = (actionId) => {
        const action = actionTypes.find((candidate) => candidate.id === actionId);
        const reason = pickerReason(CHAIN_STEP_TYPES.ACTION);
        if (!action || reason) {
            setPicker(null);
            if (reason) setNotice(reason);
            return;
        }
        addPicked(newActionStep(action, { customVariables, chains }));
    };

    const canMoveUp = Boolean(chain && selected && !isLoosePath(selected) && moveStepAt(chain.steps ?? [], selected, -1));
    const canMoveDown = Boolean(chain && selected && !isLoosePath(selected) && moveStepAt(chain.steps ?? [], selected, 1));
    const selectionKey = selected && selectedStep && !drag ? `${canMoveUp ? 1 : 0}${canMoveDown ? 1 : 0}` : "none";
    useEffect(() => {
        onSelectionChange?.(selectionKey === "none" ? null : { canUp: selectionKey[0] === "1", canDown: selectionKey[1] === "1" });
    }, [selectionKey, onSelectionChange]);
    useEffect(() => () => onSelectionChange?.(null), [onSelectionChange]);
    // A cyan line previews where the next added step would go, while something is selected.
    useEffect(() => {
        let next = null;
        if (chain && selected && selectedStep && !isLoosePath(selected) && !drag && !picker) {
            const target = insertionTarget();
            const gapElement = [...(stackRef.current?.querySelectorAll(".cx-gap") ?? [])]
                .find((element) => element.dataset.gapList === JSON.stringify(target.listPath) && Number(element.dataset.gapIndex) === target.index);
            const canvas = canvasRef.current?.getBoundingClientRect();
            if (gapElement && canvas) {
                const column = gapElement.parentElement.getBoundingClientRect();
                next = { left: Math.round(column.left - canvas.left), top: Math.round(gapElement.getBoundingClientRect().top - canvas.top), width: Math.round(column.width) };
            }
        }
        setInsertPreview((current) => (current && next && current.left === next.left && current.top === next.top && current.width === next.width) || (!current && !next) ? current : next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chain, selected, selectedPart, selectedStep, drag, picker]);
    // After the arrow keys move the selection, scroll just enough to keep the block (header, or the whole block when it fits) visible.
    const keepInView = (path) => {
        window.requestAnimationFrame(() => {
            const scroller = scrollRef.current;
            const block = [...(stackRef.current?.querySelectorAll("[data-block]") ?? [])].find((element) => element.dataset.block === pathKey(path));
            if (!scroller || !block) return;
            const area = scroller.getBoundingClientRect();
            const rect = block.getBoundingClientRect();
            const margin = 48;
            const height = Math.min(rect.height, area.height - margin * 2);
            if (rect.top < area.top + margin) scroller.scrollBy({ top: rect.top - area.top - margin, behavior: "smooth" });
            else if (rect.top + height > area.bottom - margin) scroller.scrollBy({ top: rect.top + height - area.bottom + margin, behavior: "smooth" });
        });
    };
    useEffect(() => {
        const onKeyDown = (event) => {
            if (dragRef.current?.started && event.key === "Escape") {
                event.preventDefault();
                dragRef.current.cancel();
                return;
            }
            if (!disabled && selected && !inspecting && !picker && !event.ctrlKey && !event.metaKey && !event.altKey
                && ["e", "E", "Enter"].includes(event.key) && !event.target?.closest?.("input,textarea,select,button,[contenteditable=\"true\"]")
                && canEditStep(selectedStep)) {
                event.preventDefault();
                select(selected, conditionIndex);
                return;
            }
            if (["ArrowUp", "ArrowDown"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
                && !drag && !dragRef.current && !picker && !operandPicker && !operandInspector && !isExternalConfigurationOpen
                && !event.target?.closest?.("input,textarea,select,button,.code-inspector,.pk,[contenteditable=\"true\"]")
                && (!selected || !isLoosePath(selected))) {
                const order = stepPathsInOrder(steps);
                if (order.length) {
                    event.preventDefault();
                    const at = selected ? order.findIndex((path) => samePath(path, selected)) : -1;
                    const next = event.key === "ArrowDown" ? Math.min(order.length - 1, at + 1) : Math.max(0, (at < 0 ? order.length : at) - 1);
                    if (at < 0 || next !== at) {
                        selectOnly(order[next]);
                        keepInView(order[next]);
                    }
                }
                return;
            }
            if (!disabled && !picker && !operandPicker && !operandInspector && !isExternalConfigurationOpen && !dragRef.current
                && isWorkspaceShortcutKeydown(event, readWorkspaceShortcut("addNode"))) {
                event.preventDefault();
                openInsertStep();
                return;
            }
            if (disabled || !selected || !["Backspace", "Delete"].includes(event.key)) return;
            if (event.target?.closest?.("input,textarea,select,[contenteditable=\"true\"]")) return;
            event.preventDefault();
            removeStep(selected);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    });

    // ---- Dragging a block ------------------------------------------------------------------------
    // The gaps are measured from the DOM on every move: one before the first block of every list of the
    // stack (and of every mouth) and one after each block.
    const measureGaps = () => [...(stackRef.current?.querySelectorAll(".cx-gap") ?? [])].map((element) => {
        const column = element.parentElement.getBoundingClientRect();
        return { listPath: JSON.parse(element.dataset.gapList), index: Number(element.dataset.gapIndex), y: element.getBoundingClientRect().top, left: column.left, right: column.right };
    });
    const targetFor = (state, x, y) => {
        const block = { top: y - state.grab.y, left: x - state.grab.x, right: x - state.grab.x + state.width };
        const gap = chooseDropGap(measureGaps(), block);
        if (!gap) return { gap: null, reason: null };
        const reason = dropBlockReason({ chains, chain: removeStepPath(chain, state.path), listPath: gap.listPath, index: gap.index, step: state.step });
        return { gap, reason };
    };
    const beginBlockDrag = (event, path, step) => {
        if (disabled || event.button !== 0 || drag || event.target.closest?.(NOT_DRAGGABLE)) return;
        const element = event.currentTarget.closest("[data-block]");
        if (!element) return;
        event.stopPropagation();
        const touch = event.pointerType === "touch";
        const rect = element.getBoundingClientRect();
        const state = {
            path, step, started: false, startX: event.clientX, startY: event.clientY, timer: 0,
            grab: { x: event.clientX - rect.left, y: event.clientY - rect.top }, width: rect.width,
        };
        const stop = () => {
            window.clearTimeout(state.timer);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("touchmove", blockScroll);
            dragRef.current = null;
        };
        const begin = (x, y) => {
            state.started = true;
            pointerRef.current = { x, y };
            setDrag({ path, step, grab: state.grab, width: state.width, x, y });
            clearSelection();
        };
        function cancel() {
            const wasStarted = state.started;
            stop();
            if (wasStarted) { setDrag(null); setDropTarget(null); }
        }
        function blockScroll(touchEvent) { if (state.started && touchEvent.cancelable) touchEvent.preventDefault(); }
        function move(next) {
            pointerRef.current = { x: next.clientX, y: next.clientY };
            const distance = Math.hypot(next.clientX - state.startX, next.clientY - state.startY);
            if (!state.started) {
                // A phone picks a block up after a long press; moving first means the user is scrolling.
                if (touch) { if (distance > TOUCH_SLOP_PX) stop(); return; }
                if (distance > DRAG_START_PX) begin(next.clientX, next.clientY);
                return;
            }
            setDrag((current) => (current ? { ...current, x: next.clientX, y: next.clientY } : current));
        }
        function end(next) {
            const wasStarted = state.started;
            stop();
            if (!wasStarted) return;
            // The click that follows a release must not select or press anything.
            const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
            window.addEventListener("click", swallow, { capture: true, once: true });
            window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 60);
            finishDrag(state, next.clientX, next.clientY);
        }
        state.cancel = cancel;
        dragRef.current = state;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("touchmove", blockScroll, { passive: false });
        if (touch) state.timer = window.setTimeout(() => begin(state.startX, state.startY), LONG_PRESS_MS);
    };
    const finishDrag = (state, x, y) => {
        const target = targetFor(state, x, y);
        const base = removeStepPath(chain, state.path);
        let next = null;
        let nextSelection = null;
        if (target.gap && !target.reason) {
            next = placeBlockInStack(base, target.gap.listPath, target.gap.index, state.step);
            nextSelection = [...target.gap.listPath, target.gap.index];
        }
        if (!next) {
            const point = canvasPoint(x - state.grab.x, y - state.grab.y);
            next = addLooseBlock(base, state.step, point.x, point.y);
            nextSelection = [LOOSE, looseOf(next).length - 1];
            if (target.reason) setNotice(target.reason);
        }
        commitChain(next);
        setDrag(null);
        setDropTarget(null);
        setSelected(nextSelection);
        setConditionIndex(null);
        setInspecting(false);
    };
    // Recompute the highlighted gap whenever the carried block moves (or the canvas scrolls under it).
    useEffect(() => {
        if (!drag || !dragRef.current) return undefined;
        const refresh = () => {
            const state = dragRef.current;
            if (!state?.started) return;
            const { x, y } = pointerRef.current;
            const found = targetFor(state, x, y);
            const canvas = canvasRef.current?.getBoundingClientRect();
            setDropTarget(found.gap && canvas ? { ...found, left: found.gap.left - canvas.left, top: found.gap.y - canvas.top, width: found.gap.right - found.gap.left } : null);
        };
        refresh();
        // Near the top or bottom edge the canvas scrolls under the carried block.
        const timer = window.setInterval(() => {
            const scroller = scrollRef.current?.getBoundingClientRect();
            if (!scroller) return;
            const { y } = pointerRef.current;
            if (y < scroller.top + EDGE_SCROLL_PX) scrollRef.current.scrollBy(0, -EDGE_SCROLL_SPEED);
            else if (y > scroller.bottom - EDGE_SCROLL_PX) scrollRef.current.scrollBy(0, EDGE_SCROLL_SPEED);
            else return;
            refresh();
        }, 30);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag?.x, drag?.y, Boolean(drag)]);

    // ---- Pickers opened from the side panel --------------------------------------------------
    const pickConditionOperand = (field, rowIndex, operand) => {
        if (disabled || !selected) return;
        closeMenus();
        setOperandPicker({ kind: "condition", path: selected, field, rowIndex, operand });
    };
    const pickActionOperand = (termIndex) => {
        if (disabled || !selected) return;
        closeMenus();
        setOperandPicker({ kind: "action", path: selected, termIndex });
    };
    const operandStep = operandPicker && viewChain ? stepAtPath(viewChain, operandPicker.path) : null;
    const chooseOperandVariable = (variableId) => {
        if (!operandPicker || !operandStep) return;
        const definition = stateVariables.find((variable) => variable.id === variableId);
        if (operandPicker.kind === "action") {
            updateStep(operandPicker.path, (step) => withActionOperandVariable(step, customVariables, operandPicker.termIndex, definition, selectableTypes) ?? step);
        } else {
            updateStep(operandPicker.path, (step) => ({
                ...step,
                [operandPicker.field]: withConditionOperand(step[operandPicker.field] ?? [], operandPicker.rowIndex, operandPicker.operand, variableId, definition, selectableTypes),
            }));
        }
        setOperandPicker(null);
    };
    const useRawNumber = () => {
        if (!operandPicker || operandPicker.kind !== "action" || !operandStep) return;
        const valueType = actionOperandValueType(operandStep, customVariables);
        updateStep(operandPicker.path, (step) => withActionOperand(step, customVariables, operandPicker.termIndex, valueType === "boolean" ? { type: "boolean", value: false } : { type: "number", value: 0 }));
        setOperandPicker(null);
    };
    const operandInspectorStep = operandInspector && viewChain ? stepAtPath(viewChain, operandInspector.path) : null;
    const operandInspectorOperand = operandInspectorStep ? actionOperandAt(operandInspectorStep, operandInspector.termIndex) : null;
    const operandInspectorDefinition = operandInspectorOperand?.type === "variable"
        ? stateVariables.find((variable) => variable.id === operandInspectorOperand.value)
        : null;

    // ---- Rendering ---------------------------------------------------------------------------
    const usage = chain ? chainUsage(configuration, chain.id) : { roots: 0, chains: 0 };
    // Adds a row to the step's own condition list: an If's conditions, or a Repeat while's.
    const addCondition = (path, step) => {
        const field = conditionFieldOf(step);
        if (disabled || budget.conditions <= 0 || (step[field]?.length ?? 0) >= MAX_CONDITIONS_PER_BRANCH) return;
        const index = step[field]?.length ?? 0;
        updateStep(path, (current) => ({ ...current, [field]: [...(current[field] ?? []), newStepCondition("if")] }));
        select(path, index);
    };
    const removeButton = (path) => !disabled && <button type="button" className="code-bt-x" onClick={(event) => { event.stopPropagation(); removeStep(path); }} aria-label="Delete step" title="Delete step"><TrashIcon /></button>;
    // An x on a condition row deletes just that condition (a step keeps at least one).
    const removeRowButton = (path, field, index, count) => !disabled && count > 1 && <button type="button" className="code-bt-x cx-row-x" onClick={(event) => { event.stopPropagation(); updateStep(path, (current) => ({ ...current, [field]: current[field].filter((_, row) => row !== index) })); setConditionIndex(null); }} aria-label={`Remove condition ${index + 1}`} title="Remove condition">×</button>;
    const blockProps = (path, description, floating, onTap = plainTap) => ({
        role: floating ? undefined : "button",
        tabIndex: floating ? undefined : 0,
        "aria-pressed": floating ? undefined : samePath(selected, path),
        "aria-current": runningChain?.chainId === chainId && samePath(runningChain.path, path) ? "step" : undefined,
        "aria-label": `${numbers.get(pathKey(path)) ? `Step ${numbers.get(pathKey(path))}, ` : ""}${description.tag} ${description.label}${description.summary ? `, ${description.summary}` : ""}`,
        onClick: floating ? undefined : (event) => { event.stopPropagation(); onTap(path); },
        onKeyDown: floating ? undefined : (event) => {
            if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "Enter") select(path); else onTap(path);
        },
        onDoubleClick: floating ? undefined : (event) => {
            if (phone || !clickLogRef.current.isDoubleClick() || event.target.closest?.("button,input,select,textarea")) return;
            event.stopPropagation();
            const row = event.target.closest?.(".cx-cond");
            const index = row ? [...row.parentElement.children].indexOf(row) : null;
            if (canEditStep(stepAtPath(chain, path))) select(path, index);
        },
        onPointerDown: floating ? undefined : (event) => beginBlockDrag(event, path, stepAtPath(chain, path)),
    });
    const gap = (listPath, index) => (isLoosePath(listPath) ? null
        : <div className="cx-gap" data-gap-list={JSON.stringify(listPath)} data-gap-index={index} aria-hidden="true" />);

    const renderStep = (step, path, floating = false) => {
        const description = describeChainStep(step, describeContext);
        const number = numbers.get(pathKey(path));
        const isRunning = runningChain?.chainId === chainId && samePath(runningChain.path, path);
        const isSelected = !floating && samePath(selected, path);
        const state = `${isSelected ? "is-selected" : ""} ${isRunning ? "is-running" : ""}`;
        const isLoose = isLoosePath(path);
        const numberBadge = number ? <span className="cx-num">{number}</span> : null;
        if (step.type === CHAIN_STEP_TYPES.REPEAT) {
            const usesWhile = Array.isArray(step.whileConditions);
            const rows = usesWhile
                ? (step.whileConditions.length ? step.whileConditions : [null]).map((condition) => conditionPlainText(condition ? summarizeConditionForNode(condition, lookups) : null))
                : [`${step.count ?? 2} ${(step.count ?? 2) === 1 ? "time" : "times"}`];
            return <div className="cx-c cx-c--repeat" data-block={pathKey(path)}>
                <div className={`cx-c-head ${state}`} {...blockProps(path, description, floating)}>
                    <div className="cx-c-title"><span className="cx-kw">{usesWhile ? "REPEAT WHILE" : "REPEAT"}</span></div>
                    <div className="cx-cond-rows">
                        {rows.map((text, index) => <div className={`cx-cond ${!floating && isSelected && conditionIndex === index ? "is-active" : ""}`} key={index}
                            role={floating ? undefined : "button"} tabIndex={floating ? undefined : 0}
                            onClick={floating ? undefined : (event) => { event.stopPropagation(); rowTap(path, index); }}
                            onKeyDown={floating ? undefined : (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); rowTap(path, index); } }}>
                            <span className="cx-cond-text" title={text}>{text}</span>{usesWhile && !floating && removeRowButton(path, "whileConditions", index, step.whileConditions.length)}
                        </div>)}
                    </div>
                    {usesWhile && !disabled && !floating && <button type="button" className="cx-add-condition" disabled={budget.conditions <= 0 || step.whileConditions.length >= MAX_CONDITIONS_PER_BRANCH} onClick={(event) => { event.stopPropagation(); addCondition(path, step); }}>+ Condition</button>}
                    {!floating && removeButton(path)}
                </div>
                <div className="cx-c-mouth"><div className="cx-c-edge" />{renderList(step.steps ?? [], [...path, BODY], floating)}</div>
                <div className={`cx-c-foot ${!floating && samePath(selected, path) && selectedPart === "foot" ? "is-selected" : ""}`} role={floating ? undefined : "button"} aria-label={floating ? undefined : "Select the end of this block"} onClick={floating ? undefined : (event) => { event.stopPropagation(); footTap(path); }}>{"end repeat"}</div>
            </div>;
        }
        if (isConditional(step)) {
            const rows = Array.isArray(step.conditions) && step.conditions.length ? step.conditions : [null];
            return <div className="cx-c cx-c--if" data-block={pathKey(path)}>
                <div className={`cx-c-head ${state}`} {...blockProps(path, { ...description, label: description.summary }, floating, headerTap)}>
                    <div className="cx-c-title">{numberBadge}<span className="cx-kw">{description.tag}</span></div>
                    <div className="cx-cond-rows">
                        {rows.map((condition, index) => {
                            const summary = condition ? summarizeConditionForNode(condition, lookups) : null;
                            const text = conditionPlainText(summary);
                            return <div className={`cx-cond ${!floating && isSelected && conditionIndex === index ? "is-active" : ""}`} key={index}
                                role={floating ? undefined : "button"} tabIndex={floating ? undefined : 0}
                                onClick={floating ? undefined : (event) => { event.stopPropagation(); rowTap(path, index); }}
                                onKeyDown={floating ? undefined : (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); rowTap(path, index); } }}>
                                <span className="cx-cond-text" title={text}>{text}</span>{!floating && removeRowButton(path, "conditions", index, rows.length)}
                            </div>;
                        })}
                    </div>
                    {!disabled && !floating && <button type="button" className="cx-add-condition" disabled={budget.conditions <= 0 || (step.conditions?.length ?? 0) >= MAX_CONDITIONS_PER_BRANCH} onClick={(event) => { event.stopPropagation(); addCondition(path, step); }}>+ Condition</button>}
                    {!floating && removeButton(path)}
                </div>
                <div className="cx-c-mouth"><div className="cx-c-edge" />{renderList(step.steps ?? [], [...path, BRANCH], floating)}</div>
                <div className={`cx-c-foot ${!floating && samePath(selected, path) && selectedPart === "foot" ? "is-selected" : ""}`} role={floating ? undefined : "button"} aria-label={floating ? undefined : "Select the end of this block"} onClick={floating ? undefined : (event) => { event.stopPropagation(); footTap(path); }}>{"end if"}</div>
            </div>;
        }
        if (step.type === CHAIN_STEP_TYPES.WAIT && Array.isArray(step.untilConditions)) {
            const rows = (step.untilConditions.length ? step.untilConditions : [null]).map((condition) => conditionPlainText(condition ? summarizeConditionForNode(condition, lookups) : null));
            return <div className={`cx-block cx-block--wait ${state}`} data-block={pathKey(path)} {...blockProps(path, description, floating)} data-loose={isLoose || undefined}>
                <div className="cx-c-title">{numberBadge}<span className="cx-kw">WAIT</span></div>
                <div className="cx-cond-rows">
                    {rows.map((text, index) => <div className={`cx-cond ${!floating && isSelected && conditionIndex === index ? "is-active" : ""}`} key={index}
                        role={floating ? undefined : "button"} tabIndex={floating ? undefined : 0}
                        onClick={floating ? undefined : (event) => { event.stopPropagation(); rowTap(path, index); }}
                        onKeyDown={floating ? undefined : (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); rowTap(path, index); } }}>
                        <span className="cx-cond-text" title={text}>{text}</span>{!floating && removeRowButton(path, "untilConditions", index, step.untilConditions.length)}
                    </div>)}
                </div>
                {!disabled && !floating && <button type="button" className="cx-add-condition" disabled={budget.conditions <= 0 || step.untilConditions.length >= MAX_CONDITIONS_PER_BRANCH} onClick={(event) => { event.stopPropagation(); addCondition(path, step); }}>+ Condition</button>}
                {!floating && removeButton(path)}
            </div>;
        }
        if (description.tone === "action") {
            // The same three rows as the main brain's action node, with the step number first.
            return <div className={`cx-block cx-block--action cx-an ${state}`} data-block={pathKey(path)} {...blockProps(path, description, floating)} data-loose={isLoose || undefined}>
                <div className="cx-an-r1">{numberBadge}<span className="cx-tag">{description.tag}</span></div>
                <div className="cx-an-r2" title={description.label}>{description.label}</div>
                {description.summary && <div className="cx-an-r3" title={description.summary}>{description.summary}</div>}
                {!floating && removeButton(path)}
            </div>;
        }
        return <div className={`cx-block cx-block--${description.tone} ${state}`} data-block={pathKey(path)} {...blockProps(path, description, floating)} data-loose={isLoose || undefined}>
            <div className="cx-block-top">{numberBadge}<span className="cx-tag">{description.tag}</span><span className="cx-label" title={description.label}>{description.label}</span></div>
            {description.summary && <div className="cx-block-sub"><span className="cx-sub-text" title={description.summary}>{description.summary}</span></div>}
            {!floating && removeButton(path)}
        </div>;
    };

    function renderList(list, listPath, floating = false) {
        const withGaps = !floating;
        return <div className="cx-list">
            {withGaps && gap(listPath, 0)}
            {list.map((step, index) => <Fragment key={index}>
                {renderStep(step, [...listPath, index], floating)}
                {withGaps && gap(listPath, index + 1)}
            </Fragment>)}
            {!list.length && <div className="cx-empty" aria-hidden="true" />}
        </div>;
    }

    if (!chain) return null;
    // The canvas reserves RIGHT_ROOM past the right-most block (stack or loose) so it scrolls early.
    const canvasMinWidth = Math.max(0, ...loose.map((entry) => entry.x + STACK_WIDTH + RIGHT_ROOM));
    const canvasHeight = Math.max(0, ...loose.map((entry) => entry.y + 240));
    return <div ref={boardRef} className={`code-board cx-board relative min-h-0 flex-1 select-none overflow-hidden ${drag ? "is-dragging" : ""}`} onPointerDown={(event) => { if (event.target === event.currentTarget) clearSelection(); }}>
        <div className="code-history-rail absolute inset-y-0 left-0 z-20 flex w-14 flex-col items-center justify-end gap-2 border-r border-white/10 bg-[#14181c]/95 px-2 py-4 shadow-[8px_0_20px_rgba(0,0,0,.12)]">
            <div className="flex flex-col gap-2">
                <button type="button" aria-label="Undo code edit" title="Undo" disabled={!canUndo} onClick={onUndo} className="code-history-button">↶</button>
                <button type="button" aria-label="Redo code edit" title="Redo" disabled={!canRedo} onClick={onRedo} className="code-history-button">↷</button>
            </div>
        </div>
        <div ref={scrollRef} className="cx-scroll" onClickCapture={(event) => {
                const block = event.target.closest?.("[data-block]");
                const row = event.target.closest?.(".cx-cond");
                clickLogRef.current.record(block ? `${block.dataset.block}:${row ? [...row.parentElement.children].indexOf(row) : ""}${event.target.closest?.(".cx-c-foot") ? ":foot" : ""}` : "canvas");
            }}
            onClick={(event) => { if (event.target === event.currentTarget || event.target === canvasRef.current) clearSelection(); }}
            onDoubleClick={(event) => { if (clickLogRef.current.isDoubleClick() && (event.target === event.currentTarget || event.target === canvasRef.current) && !disabled) openLooseStep(canvasPoint(event.clientX, event.clientY)); }}>
            <div ref={canvasRef} className="cx-canvas" style={{ minWidth: canvasMinWidth, minHeight: canvasHeight, paddingLeft: STACK_LEFT, paddingTop: STACK_TOP, paddingRight: RIGHT_ROOM }}>
                <div ref={stackRef} className="cx-stack">
                    <section className="cx-block cx-block--header" aria-label={`Chain ${chain.name}`}>
                        <div className="cx-header-top">
                            <span className="cx-tag">CHAIN</span>
                            <NameInput key={chain.name} value={chain.name} disabled={disabled} onCommit={(name) => onChange(renameChain(configuration, chain.id, name))} />
                        </div>
                        <div className="cx-used">Used by {usage.roots} {usage.roots === 1 ? "root" : "roots"}</div>
                    </section>
                    {renderList(steps, [])}
                </div>
                {loose.map((entry, index) => <div className="cx-loose" key={index} style={{ left: entry.x, top: entry.y }}>
                    {renderStep(entry.step, [LOOSE, index])}
                </div>)}
                {insertPreview && !dropTarget && <div className="cx-drop-line is-preview" style={{ left: insertPreview.left, top: insertPreview.top, width: insertPreview.width }} aria-hidden="true" />}
                {dropTarget && <div className={`cx-drop-line ${dropTarget.reason ? "is-invalid" : ""}`} style={{ left: dropTarget.left, top: dropTarget.top, width: dropTarget.width }}>{dropTarget.reason && <span>{dropTarget.reason}</span>}</div>}
            </div>
        </div>
        {drag && <div className="cx-float" style={{ left: drag.x - drag.grab.x, top: drag.y - drag.grab.y, width: drag.width }}>{renderStep(drag.step, ["float"], true)}</div>}
        {picker && !isExternalConfigurationOpen && <NodeKindPicker title="Add node" selectedLoadout={selectedLoadout} flowOptions={FLOW_OPTIONS} flowBlockReason={pickerReason} onChooseFlow={chooseFlow} onChooseAction={chooseAction} onCancel={() => setPicker(null)} />}
        {!picker && operandPicker && !isExternalConfigurationOpen && <VariableOperandPicker
            operand={operandPicker.kind === "action" ? 2 : operandPicker.operand}
            numericOnly={operandPicker.kind === "action" && operandStep && actionOperandValueType(operandStep, customVariables) === "number"}
            valueType={operandPicker.kind === "action" && operandStep ? actionOperandValueType(operandStep, customVariables) : null}
            stateVariables={stateVariables}
            onChoose={chooseOperandVariable}
            onUseRawNumber={operandPicker.kind === "action" ? useRawNumber : null}
            onClose={() => setOperandPicker(null)} />}
        {inspecting && selectedStep && !isExternalConfigurationOpen && <ChainStepInspector
            step={selectedStep}
            conditionIndex={conditionIndex}
            number={numbers.get(pathKey(selected))}
            chain={chain}
            chains={chains}
            actionTypes={actionTypes}
            selectableTypes={selectableTypes}
            selectableAbilityIds={selectableAbilityIds}
            stateVariables={stateVariables}
            defaultVariable={defaultVariable}
            untilCondition={newStepCondition("until")}
            customVariables={customVariables}
            coordinateVersion={coordinateVersion}
            disabled={disabled}
            canAddCondition={budget.conditions > 0}
            canAddAction={budget.actions > 0}
            canMoveUp={!isLoosePath(selected) && Boolean(moveStepAt(chain.steps ?? [], selected, -1))}
            canMoveDown={!isLoosePath(selected) && Boolean(moveStepAt(chain.steps ?? [], selected, 1))}
            onUpdate={(change) => updateStep(selected, change)}
            onMove={(delta) => moveStep(selected, delta)}
            onClose={clearSelection}
            onDelete={() => removeStep(selected)}
            onOpenChain={onOpenChain}
            onPickConditionOperand={pickConditionOperand}
            onPickActionOperand={pickActionOperand}
            onInspectActionOperand={(termIndex) => { setOperandPicker(null); setOperandInspector({ path: selected, termIndex }); }}
            onDismissOperandPicker={() => setOperandPicker(null)} />}
        {!isExternalConfigurationOpen && operandInspectorDefinition && <ActionVariableInspector
            definition={operandInspectorDefinition}
            operand={operandInspectorOperand}
            selectableTypes={selectableTypes}
            disabled={disabled}
            onChange={(operand) => updateStep(operandInspector.path, (step) => withActionOperand(step, customVariables, operandInspector.termIndex, operand))}
            onClose={() => setOperandInspector(null)} />}
        {notice && <div className="cx-notice" role="status" aria-live="polite"><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    </div>;
});
