import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    createExpressionCondition,
    defaultSelectableForVariable,
    normalizeRoots,
    removeLogicBranch,
    setLogicRootPriority as setRootPriority,
} from "../botlogic/code/BotCode.js";
import { MAX_LOGIC_BLOCKS, MAX_TOTAL_CONDITIONS } from "../botlogic/code/configuration/constants.js";
import {
    applyPositionOrder,
    groupKeyForNode,
    mismatchedGroups,
    nudgeNode,
    positionRanks,
    priorityRanks,
    siblingGroups,
    sortTreeByPriority,
    swapNodePlaces,
    moveRootToIndex,
} from "./siblingOrder.js";
import Toast, { ToastStack } from "../../components/Toast.jsx";
import { createClickLog } from "./doubleClick.js";
import SearchRootNodesModal from "./modals/SearchRootNodesModal.jsx";
import {
    buildLogicGraph,
    treeBranchAt,
    updateTreeBranch,
    normalizeSiblingTypes,
    graphBranchActions,
    setGraphActions,
    addGraphAction,
    NodeKindPicker,
    VariableOperandPicker,
    GraphConditionNode,
    GraphRootNode,
    GraphActionNode,
    LogicNodeInspector,
    ActionVariableInspector,
    variableActionTerms,
    countActions,
    countLogicConditions,
    clamp,
    conditionGraphNodeId,
    newTreeBranch,
    nextBranchPriority,
} from "./nodes/GraphNodes.jsx";
import { brainFromEditorRoots, editorRootsFor, wireBlockReason, wireNodes, disconnectNode, removeRootKeepingChildren } from "./treeWiring.js";
import { carryPositions, topLeftForCenter } from "./nodePlacement.js";
import { graphEdgePath } from "./graphEdgeGeometry.js";
import { actionOperandValueType, withActionOperand, withActionOperandVariable } from "./nodes/actionOperandEdits.js";
import {
    nodePositionsForGraph,
    normalizeNodePositions,
} from "../botlogic/code/configuration/nodePositions.js";
import { isAddRootShortcutKeydown, readAddRootShortcut, readWorkspaceShortcut } from "./addRootShortcut.js";
import { createEditorNodeId } from "../botlogic/code/configuration/identifiers.js";

const LOGIC_CANVAS_WIDTH = 10000;
const LOGIC_CANVAS_HEIGHT = 6000;
const ROOT_TO_CONDITION_GAP = 106;
const CONDITION_TO_CHILD_GAP = 70;
const GRAPH_SIBLING_GAP = 72;
const LOGIC_MIN_ZOOM = 0.25;
const LOGIC_MAX_ZOOM = 1.35;

function graphNodesForGraph(graph) {
    return [
        ...graph.roots,
        ...graph.conditions,
        ...graph.actions,
        ...graph.variables,
        ...graph.targets,
    ];
}

// The offset that puts a node's top-left at `absolute`, kept on the canvas.
function offsetForAbsolute(node, absolute) {
    const x = clamp(Number(absolute.x), 0, LOGIC_CANVAS_WIDTH - node.width);
    const y = clamp(Number(absolute.y), 0, LOGIC_CANVAS_HEIGHT - (node.height ?? 0));
    return { x: x - node.x, y: y - node.y };
}

function offsetsForAbsolutePositions(nodes, positions) {
    return Object.fromEntries(nodes.map((node) => [node.id, offsetForAbsolute(node, positions[node.id] ?? { x: node.x, y: node.y })]));
}

function sameGraphPath(first, second) {
    return Array.isArray(first) && Array.isArray(second)
        && first.length === second.length
        && first.every((value, index) => value === second[index]);
}

// Pointer travel (px) beyond which a node press counts as a drag, not a tap.
const DRAG_CLICK_THRESHOLD = 4;

function absoluteGraphNodePosition(node, offsets) {
    const offset = offsets[node.id] ?? { x: 0, y: 0 };
    return {
        x: node.x + offset.x,
        y: node.y + offset.y,
        width: node.width,
        height: node.height,
    };
}

function positionInsertedGraphNode(parent, previousSibling, child, offsets, gap) {
    const parentPosition = absoluteGraphNodePosition(parent, offsets);
    const y = parentPosition.y + parentPosition.height + gap;
    if (!previousSibling) return { x: parentPosition.x + (parentPosition.width - child.width) / 2, y };
    const previousPosition = absoluteGraphNodePosition(previousSibling, offsets);
    return { x: previousPosition.x + previousPosition.width + GRAPH_SIBLING_GAP, y };
}

export const TreeLogicBoard = forwardRef(function TreeLogicBoard({
    configuration,
    disabled,
    canRemove,
    selectedLoadout,
    selectableAbilityIds,
    stateVariables,
    defaultVariable,
    selectableTypes,
    onChange,
    zoom,
    pan,
    onPanChange,
    onZoomChange,
    zoomToFitRef = null,
    onPinchZoom = null,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onAddRoot = null,
    canAddRoot = false,
    isSearchOpen,
    isQuickSearchOpen = false,
    onSearchClose,
    isExternalConfigurationOpen = false,
    onCloseExternalConfiguration,
    tutorialFocus = null,
    maxLogicBlocks = MAX_LOGIC_BLOCKS,
    maxTotalConditions = MAX_TOTAL_CONDITIONS,
    puzzleMode = false,
    phone = false,
    onSelectionChange = null,
}, ref) {
    const viewportRef = useRef(null);
    const [armedWire, setArmedWire] = useState(null);
    const [wireCursor, setWireCursor] = useState(null);
    const [selectedWire, setSelectedWire] = useState(null);
    // The condition row last clicked on a selected node (Edit and double-click open that row).
    const [selectedRow, setSelectedRow] = useState(null);
    const clickLogRef = useRef(createClickLog());
    const [wireToast, setWireToast] = useState(null);
    useEffect(() => {
        if (!wireToast) return undefined;
        const timeout = window.setTimeout(() => setWireToast(null), 3200);
        return () => window.clearTimeout(timeout);
    }, [wireToast]);
    const [frameGeometry, setFrameGeometry] = useState({});
    const [nodeOffsets, setNodeOffsets] = useState({});
    const nodeOffsetsRef = useRef({});
    // The graph the offsets belong to, and the configuration this board last emitted.
    const placedRef = useRef(null);
    const emittedConfigurationRef = useRef(null);
    const [nodePicker, setNodePicker] = useState(null);
    const [inspectedNode, setInspectedNode] = useState(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState([]);
    const [operandPicker, setOperandPicker] = useState(null);
    const [actionOperandInspector, setActionOperandInspector] = useState(null);
    const [selectionBox, setSelectionBox] = useState(null);
    // Sibling groups being dragged: their badges show the order implied by the
    // current left-to-right positions until the drop commits it.
    const [dragGroupKeys, setDragGroupKeys] = useState(null);
    const removeSelectedNodesRef = useRef(() => {});
    // Set when a pointer drag moved a node past the threshold so the click that
    // follows the drag does not select the node or open its panel.
    const dragClickSuppressedRef = useRef(false);
    const touchGestureRef = useRef(null);
    const onSearchCloseRef = useRef(onSearchClose);
    const onCloseExternalConfigurationRef = useRef(onCloseExternalConfiguration);
    useEffect(() => {
        onSearchCloseRef.current = onSearchClose;
        onCloseExternalConfigurationRef.current = onCloseExternalConfiguration;
    }, [onCloseExternalConfiguration, onSearchClose]);
    const roots = useMemo(() => normalizeRoots(editorRootsFor(configuration)), [configuration]);
    const graphActionCount = countActions(configuration);
    const graphConditionCount = countLogicConditions(configuration);
    const graph = useMemo(() => buildLogicGraph(roots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables), [configuration.customVariables, roots, selectedLoadout, stateVariables, selectableTypes]);
    const canvasWidth = LOGIC_CANVAS_WIDTH;
    const canvasHeight = LOGIC_CANVAS_HEIGHT;
    const graphNodes = useMemo(() => [...graph.roots, ...graph.conditions, ...graph.actions, ...graph.variables, ...graph.targets], [graph]);
    const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));
    useLayoutEffect(() => {
        const surface = viewportRef.current?.querySelector(".code-graph-surface");
        if (!surface) return;
        const measure = () => {
            const origin = surface.getBoundingClientRect();
            const geometry = {};
            surface.querySelectorAll("[data-graph-node-id]").forEach((frame) => {
                const rect = frame.getBoundingClientRect();
                geometry[frame.dataset.graphNodeId] = { x: (rect.left - origin.left) / zoom, y: (rect.top - origin.top) / zoom, width: rect.width / zoom, height: rect.height / zoom };
            });
            setFrameGeometry((current) => JSON.stringify(current) === JSON.stringify(geometry) ? current : geometry);
        };
        measure();
        const observer = new ResizeObserver(measure);
        surface.querySelectorAll("[data-graph-node-id]").forEach((frame) => observer.observe(frame));
        return () => observer.disconnect();
    }, [graph, nodeOffsets, zoom, pan]);
    const storedRanks = useMemo(() => priorityRanks(graph, roots), [graph, roots]);
    const liveRanks = useMemo(() => dragGroupKeys ? positionRanks(graph, nodeOffsets, roots, dragGroupKeys) : null, [dragGroupKeys, graph, nodeOffsets, roots]);
    const orderMismatches = useMemo(() => dragGroupKeys ? new Set() : mismatchedGroups(graph, nodeOffsets, roots), [dragGroupKeys, graph, nodeOffsets, roots]);
    const siblingCounts = useMemo(() => new Map([...siblingGroups(graph)].map(([key, group]) => [key, group.nodes.length])), [graph]);
    const orderProps = (node) => ({
        rank: liveRanks?.get(node.id) ?? storedRanks.get(node.id),
        siblingCount: siblingCounts.get(groupKeyForNode(node)) ?? 1,
        orderMismatch: orderMismatches.has(groupKeyForNode(node)),
        onNudge: disabled ? null : (delta) => nudgeOrder(node, delta),
    });
    const updateNodeOffsets = useCallback((updater) => {
        const current = nodeOffsetsRef.current;
        const next = typeof updater === "function" ? updater(current) : updater;
        nodeOffsetsRef.current = next;
        setNodeOffsets(next);
    }, []);
    // Node positions are absolute. A structure change keeps every surviving node where it was (nodePlacement.js).
    // A configuration this board did not emit (undo, redo, a reload) is placed the same way; a reload with no
    // earlier placement takes the saved positions.
    useEffect(() => {
        if (configuration === emittedConfigurationRef.current) return;
        const previous = placedRef.current;
        const saved = normalizeNodePositions(configuration?.nodePositions);
        const carried = previous
            ? carryPositions({ nodes: previous.nodes, roots: previous.roots, positions: nodePositionsForGraph(previous.nodes, nodeOffsetsRef.current) }, { nodes: graphNodes, roots })
            : {};
        const next = Object.fromEntries(graphNodes.map((node) => [node.id, offsetForAbsolute(node, carried[node.id] ?? saved[node.id] ?? { x: node.x, y: node.y })]));
        placedRef.current = { nodes: graphNodes, roots };
        nodeOffsetsRef.current = next;
        setNodeOffsets(next);
    }, [configuration, graphNodes, roots]);
    useEffect(() => {
        const savedPositions = configuration?.nodePositions;
        const hasAllPositions = graphNodes.length > 0 && graphNodes.every((node) => {
            const position = savedPositions?.[node.id];
            return Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.y));
        });
        if (!graphNodes.length || hasAllPositions) return;
        onChange({
            ...configuration,
            nodePositions: nodePositionsForGraph(graphNodes, nodeOffsetsRef.current),
        });
    }, [configuration, graphNodes, onChange]);
    useEffect(() => {
        if (!isSearchOpen) return;
        onCloseExternalConfigurationRef.current?.();
        setInspectedNode(null);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
    }, [isSearchOpen]);
    useEffect(() => {
        if (!isExternalConfigurationOpen) return;
        onSearchCloseRef.current?.();
        setInspectedNode(null);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
    }, [isExternalConfigurationOpen]);
    useEffect(() => {
        if (!inspectedNode) return;
        onSearchCloseRef.current?.();
        onCloseExternalConfigurationRef.current?.();
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
    }, [inspectedNode]);
    useEffect(() => {
        if (!nodePicker) return;
        onSearchCloseRef.current?.();
        onCloseExternalConfigurationRef.current?.();
        // Changing an action keeps its panel open; adding a node closes it.
        if (nodePicker.actionIndex == null) setInspectedNode(null);
        setOperandPicker(null);
    }, [nodePicker]);
    const closeExternalMenus = () => {
        onSearchCloseRef.current?.();
        onCloseExternalConfigurationRef.current?.();
    };
    const openNodePicker = (picker) => {
        closeExternalMenus();
        if (picker.actionIndex == null) setInspectedNode(null);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(picker);
    };
    const clearCanvasSelection = () => {
        setInspectedNode(null);
        setSelectedNodeIds([]);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
    };
    const dismissConfigurationFromSurfacePointerDown = (preserveSelection = false) => {
        const activeElement = document.activeElement;
        if (activeElement?.closest?.(".code-inspector, .code-condition-input.is-raw, .code-root-name")) activeElement.blur();
        if (actionOperandInspector) {
            setActionOperandInspector(null);
            return;
        }
        setInspectedNode(null);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
        if (!preserveSelection) setSelectedNodeIds([]);
    };
    // A tap selects the node and opens its panel (action nodes); a drag never does.
    // A click or tap only selects. Double-click, Enter / E, or Edit in the phone bar opens the panel.
    const selectGraphNode = (event, nodeId) => {
        event.stopPropagation();
        if (dragClickSuppressedRef.current) {
            dragClickSuppressedRef.current = false;
            return;
        }
        closeExternalMenus();
        const additive = event.ctrlKey || event.metaKey;
        setSelectedRow(null);
        setSelectedNodeIds((current) => {
            if (!additive) return current.includes(nodeId) ? current : [nodeId];
            return current.includes(nodeId) ? current : [...current, nodeId];
        });
        // Clicking the node whose panel is already open keeps it open; only clicking something else closes it.
        if (!additive) setInspectedNode((current) => (current?.id === nodeId ? current : null));
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
    };
    // Clicking a condition strip of an already selected node opens that condition's own panel.
    const openConditionRow = (event, node, rowIndex, open = false) => {
        event.stopPropagation();
        if (dragClickSuppressedRef.current) {
            dragClickSuppressedRef.current = false;
            return;
        }
        closeExternalMenus();
        setSelectedNodeIds([node.id]);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
        // A click only selects; a double-click, Enter / E, the right-click menu (or a phone's second tap) opens it.
        if (!open) { setSelectedRow({ id: node.id, rowIndex }); setInspectedNode(null); return; }
        setInspectedNode({ kind: "condition-row", id: node.id, rowIndex });
    };
    const editNode = (node, rowIndex = node && selectedRow?.id === node.id ? selectedRow.rowIndex : 0) => {
        if (!node) return;
        closeExternalMenus();
        setSelectedNodeIds([node.id]);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
        if (node.actionIndex != null) setInspectedNode({ kind: "action", id: node.id });
        else if (node.path && treeBranchAt(roots[node.rootIndex]?.branches, node.path)?.conditions?.length) setInspectedNode({ kind: "condition-row", id: node.id, rowIndex });
    };
    const canEditNode = (node) => Boolean(node) && (node.actionIndex != null
        || (node.path && Boolean(treeBranchAt(roots[node.rootIndex]?.branches, node.path)?.conditions?.length)));
    // The one place a structure change is committed. Surviving nodes keep their absolute positions; the overrides
    // place new nodes. The emitted configuration stores every node's absolute position.
    const commitConfiguration = (nextConfiguration, preserveGraphPositions = true, positionOverrides = {}) => {
        const clean = { ...nextConfiguration, roots: nextConfiguration.roots === configuration.roots ? roots : nextConfiguration.roots };
        if (Array.isArray(clean.roots)) {
            clean.roots = normalizeRoots(clean.roots);
            const nextGraph = buildLogicGraph(clean.roots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables);
            const nextNodes = graphNodesForGraph(nextGraph);
            const previous = placedRef.current ?? { nodes: graphNodes, roots };
            const previousState = { nodes: previous.nodes, roots: previous.roots, positions: nodePositionsForGraph(previous.nodes, nodeOffsetsRef.current) };
            const positions = preserveGraphPositions ? carryPositions(previousState, { nodes: nextNodes, roots: clean.roots }) : {};
            Object.entries(positionOverrides).forEach(([nodeId, position]) => {
                if (Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.y))) positions[nodeId] = { x: Number(position.x), y: Number(position.y) };
            });
            const nextOffsets = offsetsForAbsolutePositions(nextNodes, positions);
            placedRef.current = { nodes: nextNodes, roots: clean.roots };
            updateNodeOffsets(nextOffsets);
            clean.nodePositions = nodePositionsForGraph(nextNodes, nextOffsets);
        }
        const emitted = brainFromEditorRoots(clean, clean.roots);
        emittedConfigurationRef.current = emitted;
        onChange(emitted);
    };
const clampPan = (nextPan, nextZoom = zoom) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return nextPan;
        const margin = 80;
        return {
            x: clamp(nextPan.x, rect.width - canvasWidth * nextZoom - margin, margin),
            y: clamp(nextPan.y, rect.height - canvasHeight * nextZoom - margin, margin),
        };
    };
    // Frames a set of nodes in the viewport (used by Zoom to fit and Tidy).
    const fitNodesInView = (nodes, offsets) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect || !nodes.length) return;
        const bounds = nodes.reduce((box, node) => {
            const offset = offsets[node.id] ?? { x: 0, y: 0 };
            const left = node.x + offset.x;
            const top = node.y + offset.y;
            return {
                minX: Math.min(box.minX, left),
                minY: Math.min(box.minY, top),
                maxX: Math.max(box.maxX, left + node.width),
                maxY: Math.max(box.maxY, top + (node.height ?? 0)),
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const padding = 60;
        const width = bounds.maxX - bounds.minX + padding * 2;
        const height = bounds.maxY - bounds.minY + padding * 2;
        const nextZoom = clamp(Math.min(rect.width / width, rect.height / height), LOGIC_MIN_ZOOM, 1);
        // Center what fits; when even the minimum zoom is too small, start at the top-left.
        const axis = (size, min, max, viewport) => size * nextZoom <= viewport
            ? viewport / 2 - ((min + max) / 2) * nextZoom
            : padding - min * nextZoom;
        const nextPan = clampPan({
            x: axis(width, bounds.minX, bounds.maxX, rect.width),
            y: axis(height, bounds.minY, bounds.maxY, rect.height),
        }, nextZoom);
        if (onPinchZoom) onPinchZoom(nextZoom, nextPan);
        else onPanChange(nextPan);
    };
    const zoomToFit = () => fitNodesInView(graphNodes, nodeOffsetsRef.current);
    // Lets the workspace toolbar's zoom cluster trigger the same fit.
    useEffect(() => {
        if (!zoomToFitRef) return undefined;
        zoomToFitRef.current = zoomToFit;
        return () => { zoomToFitRef.current = null; };
    });
    // Optional helper: sorts every sibling list by execution order and lays the
    // tree out again. Behavior does not change; only positions do.
    const tidyLayout = () => {
        if (disabled) return;
        const sortedRoots = normalizeRoots(sortTreeByPriority(roots));
        const nextNodes = graphNodesForGraph(buildLogicGraph(sortedRoots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables));
        commitConfiguration({ ...configuration, roots: sortedRoots }, false);
        fitNodesInView(nextNodes, {});
    };
    useImperativeHandle(ref, () => ({
        addNode() { openNodePicker({ unconnected: true }); },
        addConditional() { createUnconnectedNode(); },
        tidy() { tidyLayout(); },
        // The phone bottom bar's commands for the one selected node.
        editSelection() { editNode(graphNodes.find((candidate) => candidate.id === selectedNodeIds[0])); },
        disconnectSelection() { disconnectIfWired(graphNodes.find((candidate) => candidate.id === selectedNodeIds[0])); },
        nudgeSelection(delta) {
            const node = graphNodes.find((candidate) => candidate.id === selectedNodeIds[0]);
            if (node) orderProps(node).onNudge?.(delta);
        },
        deleteSelection() { removeSelectedNodesRef.current(); },
        clearSelection() { clearCanvasSelection(); },
        // Selects a node by id and brings it to the middle of the view (used by the Variables dialog's "Used in" list).
        selectNode(nodeId) {
            const node = graphNodes.find((candidate) => candidate.id === nodeId);
            if (!node) return false;
            clearCanvasSelection();
            setSelectedRow(null);
            setSelectedNodeIds([nodeId]);
            const rect = viewportRef.current?.getBoundingClientRect();
            if (rect) {
                const offset = nodeOffsetsRef.current[node.id] ?? { x: 0, y: 0 };
                onPanChange(clampPan({
                    x: rect.width / 2 - (node.x + offset.x + node.width / 2) * zoom,
                    y: rect.height / 2 - (node.y + offset.y + (node.height ?? 0) / 2) * zoom,
                }));
            }
            return true;
        },
        cancelWire() { if (!armedWire) return false; setArmedWire(null); return true; },
        // "Add root" puts the new root's centre on the centre of the visible canvas. Everything else keeps its place.
        placeRootAtCenter(nextRoots, rootIndex) {
            const rect = viewportRef.current?.getBoundingClientRect();
            const nextEditorRoots = normalizeRoots(editorRootsFor({ ...configuration, roots: nextRoots }));
            const nextGraph = buildLogicGraph(nextEditorRoots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables);
            const rootNode = nextGraph.roots.find((node) => node.rootIndex === rootIndex);
            if (!rect || !rootNode) return null;
            const center = { x: (rect.width / 2 - pan.x) / zoom, y: (rect.height / 2 - pan.y) / zoom };
            const nextNodes = graphNodesForGraph(nextGraph);
            const previous = placedRef.current ?? { nodes: graphNodes, roots };
            const carried = carryPositions(
                { nodes: previous.nodes, roots: previous.roots, positions: nodePositionsForGraph(previous.nodes, nodeOffsetsRef.current) },
                { nodes: nextNodes, roots: nextEditorRoots },
                { [rootNode.id]: topLeftForCenter(center, rootNode) },
            );
            return nodePositionsForGraph(nextNodes, offsetsForAbsolutePositions(nextNodes, carried));
        },
    }));
    const beginPan = (event) => {
        if (event.pointerType === "touch" || event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        const start = { x: event.clientX, y: event.clientY, pan };
        const move = (next) => {
            onPanChange(clampPan({ x: start.pan.x + next.clientX - start.x, y: start.pan.y + next.clientY - start.y }));
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const clearTouchGesture = () => {
        const gesture = touchGestureRef.current;
        if (!gesture) return;
        window.removeEventListener("pointermove", gesture.move);
        window.removeEventListener("pointerup", gesture.end);
        window.removeEventListener("pointercancel", gesture.end);
        touchGestureRef.current = null;
    };
    const handleTouchPointerDown = (event) => {
        if (disabled || event.pointerType !== "touch") return;
        const isInteractiveControl = event.target?.closest?.("button,input,select,textarea,label,a,[role=\"button\"],[data-node-drag-ignore],.code-history-rail");
        if (isInteractiveControl) return;
        event.preventDefault();
        event.stopPropagation();
        const point = { x: event.clientX, y: event.clientY };
        let gesture = touchGestureRef.current;
        if (!gesture) {
            gesture = {
                points: new Map(),
                moved: false,
                empty: !event.target?.closest?.(".code-graph-node"),
                startPoint: point,
                startPan: { ...pan },
                lastPan: { ...pan },
                lastZoom: zoom,
                pinch: null,
                move: null,
                end: null,
            };
            const move = (nextEvent) => {
                const current = touchGestureRef.current;
                if (!current?.points.has(nextEvent.pointerId)) return;
                nextEvent.preventDefault();
                if (Math.hypot(nextEvent.clientX - current.startPoint.x, nextEvent.clientY - current.startPoint.y) > DRAG_CLICK_THRESHOLD) current.moved = true;
                current.points.set(nextEvent.pointerId, { x: nextEvent.clientX, y: nextEvent.clientY });
                const points = [...current.points.values()];
                if (points.length >= 2) {
                    const [first, second] = points;
                    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
                    const midpoint = {
                        x: (first.x + second.x) / 2,
                        y: (first.y + second.y) / 2,
                    };
                    if (!current.pinch) {
                        current.pinch = {
                            startDistance: distance,
                            startMidpoint: midpoint,
                            startZoom: current.lastZoom,
                            startPan: current.lastPan,
                        };
                    }
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const { startDistance, startMidpoint, startZoom, startPan } = current.pinch;
                    const nextZoom = clamp(startZoom * (distance / startDistance), LOGIC_MIN_ZOOM, LOGIC_MAX_ZOOM);
                    const anchorX = (startMidpoint.x - rect.left - startPan.x) / startZoom;
                    const anchorY = (startMidpoint.y - rect.top - startPan.y) / startZoom;
                    const nextPan = clampPan({
                        x: midpoint.x - rect.left - anchorX * nextZoom,
                        y: midpoint.y - rect.top - anchorY * nextZoom,
                    }, nextZoom);
                    const previousZoom = current.lastZoom;
                    current.lastZoom = nextZoom;
                    current.lastPan = nextPan;
                    if (onPinchZoom) onPinchZoom(nextZoom, nextPan);
                    else onZoomChange(nextZoom - previousZoom, { x: midpoint.x - rect.left, y: midpoint.y - rect.top });
                    return;
                }
                const [currentPoint] = points;
                const nextPan = clampPan({
                    x: current.startPan.x + currentPoint.x - current.startPoint.x,
                    y: current.startPan.y + currentPoint.y - current.startPoint.y,
                });
                current.lastPan = nextPan;
                onPanChange(nextPan);
            };
            const end = (nextEvent) => {
                const current = touchGestureRef.current;
                if (!current) return;
                if (!current.moved && !current.pinch && current.empty && nextEvent.type === "pointerup") { dropLiftedWire(); setArmedWire(null); }
                current.points.delete(nextEvent.pointerId);
                if (current.points.size < 2) clearTouchGesture();
            };
            gesture.move = move;
            gesture.end = end;
            touchGestureRef.current = gesture;
            window.addEventListener("pointermove", move, { passive: false });
            window.addEventListener("pointerup", end);
            window.addEventListener("pointercancel", end);
        }
        gesture.points.set(event.pointerId, point);
        if (gesture.points.size >= 2) {
            gesture.moved = true;
            const [first, second] = [...gesture.points.values()];
            gesture.pinch = {
                startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
                startMidpoint: {
                    x: (first.x + second.x) / 2,
                    y: (first.y + second.y) / 2,
                },
                startZoom: gesture.lastZoom,
                startPan: gesture.lastPan,
            };
        }
    };
    useEffect(() => () => {
        const gesture = touchGestureRef.current;
        if (!gesture) return;
        window.removeEventListener("pointermove", gesture.move);
        window.removeEventListener("pointerup", gesture.end);
        window.removeEventListener("pointercancel", gesture.end);
    }, []);
    const handleBoardPointerDown = (event) => {
        if (event.button === 0 && event.target === event.currentTarget) dismissConfigurationFromSurfacePointerDown(event.ctrlKey || event.metaKey);
        handleTouchPointerDown(event);
        beginPan(event);
    };
    const updateRoot = (rootIndex, updates) => commitConfiguration({ ...configuration, roots: roots.map((rootNode, index) => index === rootIndex ? { ...rootNode, ...updates } : rootNode) });
    // Deleting a root only deletes the root; what hung from it becomes unconnected (puzzle rules have no orphans).
    const removeRootNode = (rootIndex) => commitConfiguration({ ...configuration, roots: puzzleMode ? roots.filter((_, index) => index !== rootIndex) : removeRootKeepingChildren(roots, rootIndex) }, true);
    const removeGraphAction = (rootIndex, path, actionIndex) => {
        if (puzzleMode && roots[rootIndex]?.kind === "modify") {
            removeRootNode(rootIndex);
            return;
        }
        updateBranch(rootIndex, path, (current) => setGraphActions(current, graphBranchActions(current).filter((_, index) => index !== actionIndex)));
    };
    const commitReorder = (result) => {
        if (!result) return;
        updateNodeOffsets(result.offsets);
        commitConfiguration({ ...configuration, roots: result.roots, nodePositions: nodePositionsForGraph(graphNodes, result.offsets) });
    };
    const nudgeOrder = (node, delta) => commitReorder(nudgeNode(roots, graph, nodeOffsetsRef.current, node, delta));
    // Typed priorities (root search list) swap places too, so the layout keeps
    // matching execution order.
    const setRootOrder = (rootIndex, priority) => {
        const node = graph.roots.find((candidate) => candidate.rootIndex === rootIndex);
        const target = graph.roots.find((candidate) => Number(roots[candidate.rootIndex]?.priority) === Number(priority));
        const swapped = node && target ? swapNodePlaces(roots, graph, nodeOffsetsRef.current, node, target) : null;
        if (swapped) {
            commitReorder(swapped);
            return;
        }
        const reordered = setRootPriority(roots, rootIndex, priority);
        if (reordered !== roots) commitConfiguration({ ...configuration, roots: reordered });
    };
    // Dragging a root in the search list drops it at a place in the order; the roots in between shift by one.
    const moveRootInOrder = (rootIndex, toIndex) => {
        const node = graph.roots.find((candidate) => candidate.rootIndex === rootIndex);
        if (node) commitReorder(moveRootToIndex(roots, graph, nodeOffsetsRef.current, node, toIndex));
    };
    const persistNodePositions = () => commitConfiguration({
        ...configuration,
        nodePositions: nodePositionsForGraph(graphNodes, nodeOffsetsRef.current),
    });
    // `fromControls`: a node whose buttons and pins also start a drag (a click without movement still works).
    const beginNodeDrag = (event, key, { fromControls = false } = {}) => {
        const blocking = fromControls ? "input,select,textarea,label,a" : "button,input,select,textarea,label,a,[role=\"button\"],[data-node-drag-ignore]";
        if (disabled || event.button !== 0 || event.target?.closest?.(blocking)) return;
        if (event.pointerType === "touch") event.preventDefault();
        event.stopPropagation();
        dragClickSuppressedRef.current = false;
        const dragNodeIds = selectedNodeIds.includes(key) ? selectedNodeIds : [key];
        const startOffsets = Object.fromEntries(dragNodeIds.map((nodeId) => [nodeId, nodeOffsetsRef.current[nodeId] ?? { x: 0, y: 0 }]));
        const start = { x: event.clientX, y: event.clientY };
        const graphNodesToMove = dragNodeIds.map((nodeId) => graphNodeById.get(nodeId)).filter(Boolean);
        if (!graphNodesToMove.length) return;
        // Only conditionals read their order from where they sit; a root's priority never follows its position.
        const orderedNodeIds = new Set(graph.conditions.map((node) => node.id));
        const orderGroupKeys = new Set(graphNodesToMove.filter((node) => orderedNodeIds.has(node.id)).map(groupKeyForNode));
        if (orderGroupKeys.size) setDragGroupKeys(orderGroupKeys);
        let moved = false;
        let draggedPastThreshold = false;
        const move = (next) => {
            if (event.pointerType === "touch") next.preventDefault();
            if (Math.abs(next.clientX - start.x) > DRAG_CLICK_THRESHOLD || Math.abs(next.clientY - start.y) > DRAG_CLICK_THRESHOLD) draggedPastThreshold = true;
            return updateNodeOffsets((current) => {
                const updated = { ...current };
                const delta = { x: (next.clientX - start.x) / zoom, y: (next.clientY - start.y) / zoom };
                moved ||= Math.abs(delta.x) > 0 || Math.abs(delta.y) > 0;
                const boundedDelta = graphNodesToMove.reduce((bounds, graphNode) => {
                    const startOffset = startOffsets[graphNode.id];
                    return {
                        minX: Math.max(bounds.minX, -graphNode.x - startOffset.x),
                        maxX: Math.min(bounds.maxX, canvasWidth - graphNode.x - graphNode.width - startOffset.x),
                        minY: Math.max(bounds.minY, -graphNode.y - startOffset.y),
                        maxY: Math.min(bounds.maxY, canvasHeight - graphNode.y - graphNode.height - startOffset.y),
                    };
                }, { minX: Number.NEGATIVE_INFINITY, maxX: Number.POSITIVE_INFINITY, minY: Number.NEGATIVE_INFINITY, maxY: Number.POSITIVE_INFINITY });
                const groupDelta = {
                    x: clamp(delta.x, boundedDelta.minX, boundedDelta.maxX),
                    y: clamp(delta.y, boundedDelta.minY, boundedDelta.maxY),
                };
                graphNodesToMove.forEach((graphNode) => {
                    const startOffset = startOffsets[graphNode.id];
                    updated[graphNode.id] = {
                        x: startOffset.x + groupDelta.x,
                        y: startOffset.y + groupDelta.y,
                    };
                });
                return updated;
            });
        };
        const end = () => {
            if (draggedPastThreshold) {
                dragClickSuppressedRef.current = true;
                // The click fires right after pointerup; drop the flag if none arrives.
                window.setTimeout(() => { dragClickSuppressedRef.current = false; }, 0);
                // A drag that started on a button must not also press it.
                const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
                window.addEventListener("click", swallow, { capture: true, once: true });
                window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 60);
            }
            if (moved && orderGroupKeys.size) {
                // Unreal-style: siblings run left to right, so the drop decides order.
                commitConfiguration({
                    ...configuration,
                    roots: applyPositionOrder(roots, graph, nodeOffsetsRef.current, orderGroupKeys),
                    nodePositions: nodePositionsForGraph(graphNodes, nodeOffsetsRef.current),
                });
            } else if (moved) {
                persistNodePositions();
            }
            setDragGroupKeys(null);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const canvasPoint = (event) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: (event.clientX - rect.left - pan.x) / zoom,
            y: (event.clientY - rect.top - pan.y) / zoom,
        };
    };
    const finishConnection = (parent, child) => {
        const reason = wireBlockReason(roots, parent, child);
        if (reason) { setWireToast(reason); return; }
        // Siblings run left to right: a newly wired conditional lands among them by its current X.
        const branchX = (branch) => {
            const frame = graphNodes.find((candidate) => candidate.branchId === branch.id && candidate.actionIndex == null && Array.isArray(candidate.path));
            return frame ? absoluteGraphNodePosition(frame, nodeOffsetsRef.current).x : undefined;
        };
        const nextRoots = wireNodes(roots, parent, child, { xOf: branchX });
        if (!nextRoots) return;
        commitConfiguration({ ...configuration, roots: nextRoots });
        setArmedWire(null); setSelectedWire(null);
    };
    // Press and hold: moving more than a few px from an output bar drags a wire; releasing over a node connects
    // (refusals toast like clicks), anywhere else drops it. No movement leaves the press to click-to-arm.
    // Lifting a wire (input mode) and then letting go on empty space disconnects it: the child becomes an orphan.
    // Cuts the wire into `node`, if it has one.
    // Cuts the wire into `node`: the node becomes unconnected and keeps where it is.
    const cutWire = (node) => {
        const next = disconnectNode(roots, node);
        if (next) commitConfiguration({ ...configuration, roots: next });
    };
    const disconnectIfWired = (node) => {
        if (!node || !graph.edges.some((edge) => edge.toId === node.id)) return;
        cutWire(node);
        setSelectedWire(null);
    };
    const dropLiftedWire = () => { if (armedWire?.mode === "input") disconnectIfWired(graphNodeById.get(armedWire.id)); };
    const beginWireHold = (event, node, mode = "output") => {
        if (disabled || event.button !== 0) return;
        const start = { x: event.clientX, y: event.clientY };
        let held = false;
        const move = (next) => {
            if (!held) {
                if (Math.hypot(next.clientX - start.x, next.clientY - start.y) <= DRAG_CLICK_THRESHOLD) return;
                held = true;
                setArmedWire({ mode, id: node.id, touch: false });
                setSelectedWire(null);
            }
            setWireCursor(canvasPoint(next));
        };
        const end = (next) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            if (!held) return;
            // The click that follows a release must not arm or press anything.
            const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
            window.addEventListener("click", swallow, { capture: true, once: true });
            window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 60);
            setArmedWire(null);
            if (next.type === "pointercancel") return;
            const frame = document.elementFromPoint(next.clientX, next.clientY)?.closest?.("[data-graph-node-id]");
            const target = frame ? graphNodeById.get(frame.dataset.graphNodeId) : null;
            // From an output the target is the child; from an input (a lifted or new wire) the target is the parent.
            if (target) finishConnection(...(mode === "output" ? [node, target] : [target, node]));
            else if (mode === "input") disconnectIfWired(node);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const clickOutput = (event, node, pointerType) => {
        if (disabled) return;
        if (armedWire?.mode === "input") { finishConnection(node, graphNodeById.get(armedWire.id)); return; }
        setArmedWire({ mode: "output", id: node.id, touch: pointerType === "touch" });
        setWireCursor(canvasPoint(event)); setSelectedWire(null);
    };
    const clickInput = (event, node, pointerType) => {
        if (disabled) return;
        if (armedWire?.mode === "output") { finishConnection(graphNodeById.get(armedWire.id), node); return; }
        setArmedWire({ mode: "input", id: node.id, touch: pointerType === "touch" });
        setWireCursor(canvasPoint(event)); setSelectedWire(null);
    };
    // "+ Node" and F put the node's centre on the centre of the visible canvas; a double-click puts its corner on
    // the click. A new node is never wired to anything.
    const createUnconnectedNode = (actionId = null) => {
        if (disabled || (actionId ? graphActionCount >= maxLogicBlocks : graphConditionCount >= maxTotalConditions)) return;
        const id = createEditorNodeId("node");
        const entry = actionId ? { ...graphBranchActions(addGraphAction({ actions: [], conditions: [] }, selectedLoadout, actionId, configuration.customVariables ?? []))[0], id, kind: "action" }
            : { ...newTreeBranch("if", defaultVariable, 1), conditions: [{ type: "always" }], id, kind: "conditional" };
        if (actionId && !entry.action) return;
        const next = { ...configuration, orphans: [...(configuration.orphans ?? []), entry] };
        const nextRoots = normalizeRoots(editorRootsFor(next));
        // The new node is the top node of the last (unconnected) group.
        const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables);
        const created = [...nextGraph.conditions, ...nextGraph.actions]
            .find((node) => node.rootIndex === nextRoots.length - 1 && node.orphan && node.path?.length === 1 && (node.actionIndex ?? 0) === 0);
        const rect = viewportRef.current?.getBoundingClientRect();
        const center = { x: ((rect?.width ?? 800) / 2 - pan.x) / zoom, y: ((rect?.height ?? 600) / 2 - pan.y) / zoom };
        const spawn = nodePicker?.point ?? (created ? topLeftForCenter(center, created) : center);
        if (created) commitConfiguration({ ...next, roots: nextRoots }, true, { [created.id]: spawn });
        else commitConfiguration({ ...next, roots: nextRoots }, true);
        setNodePicker(null);
    };
    useEffect(() => {
        const keydown = (event) => {
            if (event.target?.closest?.("input,textarea,select,[contenteditable=\"true\"]")) return;
            if (event.key === "Escape" && armedWire) { event.preventDefault(); event.stopImmediatePropagation(); setArmedWire(null); }
            if (!disabled && selectedWire && ["Delete", "Backspace"].includes(event.key)) {
                event.preventDefault(); event.stopImmediatePropagation();
                const wire = graph.edges.find((edge) => edge.id === selectedWire);
                const child = wire ? graphNodeById.get(wire.toId) : null;
                if (child) cutWire(child);
                setSelectedWire(null);
            }
        };
        window.addEventListener("keydown", keydown, true);
        return () => window.removeEventListener("keydown", keydown, true);
    });
    const wirePinState = (node) => {
        if (armedWire?.mode !== "output") return { validInput: false, blockedReason: null };
        const reason = wireBlockReason(roots, graphNodeById.get(armedWire.id), node);
        return { validInput: !reason, blockedReason: reason };
    };
    const pinProps = (node) => ({
        onOutput: (event, pointerType) => clickOutput(event, node, pointerType), onOutputPress: (event) => beginWireHold(event, node), onInputPress: (event) => beginWireHold(event, node, "input"), onInput: (event, pointerType) => clickInput(event, node, pointerType), armed: armedWire?.id === node.id,
        ...wirePinState(node),
    });
    const inspectedOrderNode = inspectedNode ? graph.conditions.find((node) => node.id === inspectedNode.id) : null;
    const inspectedOrder = inspectedOrderNode ? orderProps(inspectedOrderNode) : null;
    const orderInfo = inspectedOrderNode ? { label: treeBranchAt(roots[inspectedOrderNode.rootIndex]?.branches, inspectedOrderNode.path)?.branchType === "else" ? "ELSE" : inspectedOrder.rank === 1 ? "IF" : "ELSE IF",
        rank: inspectedOrder.rank, count: inspectedOrder.siblingCount, onNudge: inspectedOrder.onNudge,
        canBack: treeBranchAt(roots[inspectedOrderNode.rootIndex]?.branches, inspectedOrderNode.path)?.branchType !== "else" && inspectedOrder.rank > 1, canForward: treeBranchAt(roots[inspectedOrderNode.rootIndex]?.branches, inspectedOrderNode.path)?.branchType !== "else" && inspectedOrder.rank < inspectedOrder.siblingCount } : null;
    const armedNode = armedWire ? graphNodeById.get(armedWire.id) : null;
    const armedFrame = armedNode ? frameGeometry[armedNode.id] ?? absoluteGraphNodePosition(armedNode, nodeOffsets) : null;
    const previewEdge = armedFrame && wireCursor ? armedWire.mode === "output"
        ? { x1: armedFrame.x + armedFrame.width / 2, y1: armedFrame.y + armedFrame.height, x2: wireCursor.x, y2: wireCursor.y }
        : { x1: wireCursor.x, y1: wireCursor.y, x2: armedFrame.x + armedFrame.width / 2, y2: armedFrame.y } : null;
    const beginMarquee = (event) => {
        if (disabled || event.pointerType === "touch" || event.button !== 0 || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        dropLiftedWire();
        setArmedWire(null);
        setSelectedWire(null);
        const start = canvasPoint(event);
        const additive = event.ctrlKey || event.metaKey;
        dismissConfigurationFromSurfacePointerDown(additive);
        setSelectionBox({ start, current: start, additive });
        let moved = false;
        const move = (next) => {
            const current = canvasPoint(next);
            moved ||= Math.abs(current.x - start.x) > 4 || Math.abs(current.y - start.y) > 4;
            setSelectionBox((box) => box ? { ...box, current } : box);
        };
        const end = (next) => {
            const current = canvasPoint(next);
            const left = Math.min(start.x, current.x);
            const top = Math.min(start.y, current.y);
            const right = Math.max(start.x, current.x);
            const bottom = Math.max(start.y, current.y);
            if (moved) {
                const matchingNodeIds = graphNodes.filter((node) => {
                    const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
                    const nodeLeft = node.x + offset.x;
                    const nodeTop = node.y + offset.y;
                    return nodeLeft < right && nodeLeft + node.width > left && nodeTop < bottom && nodeTop + node.height > top;
                }).map((node) => node.id);
                setSelectedNodeIds((currentIds) => additive ? [...new Set([...currentIds, ...matchingNodeIds])] : matchingNodeIds);
            }
            setSelectionBox(null);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const centerOnRoot = (node) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
        onPanChange(clampPan({
            x: rect.width / 2 - (node.x + offset.x + node.width / 2) * zoom,
            y: rect.height / 2 - (node.y + offset.y + node.height / 2) * zoom,
        }));
    };
    const updateBranch = (rootIndex, path, updater) => commitConfiguration({ ...configuration, roots: updateTreeBranch(roots, rootIndex, path, updater) });
    const removeBranch = (rootIndex, path) => commitConfiguration({ ...configuration, roots: removeLogicBranch(roots, rootIndex, path) }, true);
    const removeSelectedNodes = (ids = selectedNodeIds) => {
        if (disabled || !canRemove || !ids.length) return;
        const selected = new Set(ids);
        const selectedRootIndices = new Set(graph.roots.filter((node) => selected.has(node.id)).map((node) => node.rootIndex));
        const selectedConditionIds = new Set(graph.conditions.filter((node) => selected.has(node.id)).map((node) => node.id));
        const selectedActionsByBranch = new Map();
        if (!puzzleMode) graph.actions.forEach((node) => {
            if (!selected.has(node.id)) return;
            const branchKey = `${node.rootId}:${node.branchId}`;
            if (!selectedActionsByBranch.has(branchKey)) selectedActionsByBranch.set(branchKey, new Set());
            selectedActionsByBranch.get(branchKey).add(node.actionIndex);
        });
        const removeFromBranches = (branches, rootId) => normalizeSiblingTypes((branches ?? []).flatMap((branch) => {
            const branchId = conditionGraphNodeId(branch.id, rootId);
            if (selectedConditionIds.has(branchId) || selectedConditionIds.has(branch.id)) return removeFromBranches(branch.children, rootId);
            const nextBranch = { ...branch };
            if (Array.isArray(branch.children)) nextBranch.children = removeFromBranches(branch.children, rootId);
            const actionIndices = selectedActionsByBranch.get(`${rootId}:${branch.id}`);
            if (actionIndices?.size) {
                const actions = graphBranchActions(branch).filter((_, index) => !actionIndices.has(index));
                Object.assign(nextBranch, setGraphActions(nextBranch, actions));
            }
            return [nextBranch];
        }));
        let keptRoots = roots;
        if (puzzleMode) keptRoots = roots.filter((_, rootIndex) => !selectedRootIndices.has(rootIndex));
        else [...selectedRootIndices].sort((a, b) => b - a).forEach((rootIndex) => { keptRoots = removeRootKeepingChildren(keptRoots, rootIndex); });
        const nextRoots = keptRoots
            .map((root) => ({
                ...root,
                ...(Array.isArray(root.branches) ? { branches: removeFromBranches(root.branches, root.id) } : {}),
            }));
        commitConfiguration({ ...configuration, roots: nextRoots }, true);
        clearCanvasSelection();
    };
    removeSelectedNodesRef.current = removeSelectedNodes;
    useEffect(() => {
        const validNodeIds = new Set(graphNodes.map((node) => node.id));
        setSelectedNodeIds((current) => current.filter((nodeId) => validNodeIds.has(nodeId)));
    }, [graphNodes]);
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.target?.closest?.("input,textarea,select,[contenteditable=\"true\"]")) return;
            // A focused button keeps E / Enter for itself; Delete and Backspace still remove the selection.
            if (!disabled && selectedNodeIds.length === 1 && !inspectedNode && !event.ctrlKey && !event.metaKey && !event.altKey
                && ["e", "E", "Enter"].includes(event.key)) {
                if (event.target?.closest?.("button")) return;
                const node = graphNodes.find((candidate) => candidate.id === selectedNodeIds[0]);
                if (canEditNode(node)) { event.preventDefault(); editNode(node); }
                return;
            }
            if (disabled || !selectedNodeIds.length || !["Backspace", "Delete"].includes(event.key)) return;
            event.preventDefault();
            removeSelectedNodesRef.current();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled, selectedNodeIds, inspectedNode, configuration, roots, graph, canRemove, puzzleMode]);
    useEffect(() => {
        if (!onAddRoot || !canAddRoot || disabled || selectedNodeIds.length
            || isSearchOpen || isExternalConfigurationOpen || nodePicker || operandPicker
            || actionOperandInspector || inspectedNode || selectionBox) return undefined;
        const onKeyDown = (event) => {
            const workspace = viewportRef.current?.closest(".code-workspace");
            if (!workspace) return;
            const targetIsOutside = event.target !== document.body
                && event.target !== document.documentElement
                && !workspace.contains(event.target);
            const anotherDialogIsOpen = [...document.querySelectorAll('[aria-modal="true"]')]
                .some((dialog) => dialog !== workspace && !workspace.contains(dialog));
            if (targetIsOutside || anotherDialogIsOpen
                || !isAddRootShortcutKeydown(event, readAddRootShortcut())) return;
            event.preventDefault();
            onAddRoot();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onAddRoot, canAddRoot, disabled, selectedNodeIds, isSearchOpen, isExternalConfigurationOpen,
        nodePicker, operandPicker, actionOperandInspector, inspectedNode, selectionBox]);
    // What the phone bottom bar needs to know about the single selected node.
    const phoneSelectionKey = (() => {
        if (!phone || selectedNodeIds.length !== 1) return "none";
        const node = graphNodes.find((candidate) => candidate.id === selectedNodeIds[0]);
        if (!node) return "none";
        const kind = node.actionIndex != null ? "action" : node.path ? "conditional" : "root";
        const ordered = kind !== "action" ? orderProps(node) : null;
        const isElse = kind === "conditional" && treeBranchAt(roots[node.rootIndex]?.branches, node.path)?.branchType === "else";
        const rank = ordered?.rank ?? 1;
        return [kind, graph.edges.some((edge) => edge.toId === node.id) ? 1 : 0, ordered && !isElse && rank > 1 ? 1 : 0, ordered && !isElse && rank < (ordered.siblingCount ?? 1) ? 1 : 0].join(":");
    })();
    useEffect(() => {
        if (!onSelectionChange) return;
        if (phoneSelectionKey === "none") { onSelectionChange(null); return; }
        const [kind, wired, up, down] = phoneSelectionKey.split(":");
        onSelectionChange({ kind, canEdit: kind !== "root", canDisconnect: wired === "1", canUp: up === "1", canDown: down === "1", canDelete: canRemove });
    }, [phoneSelectionKey, onSelectionChange, canRemove]);
    useEffect(() => () => onSelectionChange?.(null), [onSelectionChange]);
    // The add-node key opens the node menu (nothing selected, no other panel open).
    useEffect(() => {
        if (disabled || puzzleMode || selectedNodeIds.length || isSearchOpen || isExternalConfigurationOpen || nodePicker
            || operandPicker || actionOperandInspector || inspectedNode || selectionBox) return undefined;
        const onKeyDown = (event) => {
            const workspace = viewportRef.current?.closest(".code-workspace");
            if (!workspace || !isAddRootShortcutKeydown(event, readWorkspaceShortcut("addNode"))) return;
            const targetIsOutside = event.target !== document.body && event.target !== document.documentElement && !workspace.contains(event.target);
            const anotherDialogIsOpen = [...document.querySelectorAll('[aria-modal="true"]')].some((dialog) => dialog !== workspace && !workspace.contains(dialog));
            if (targetIsOutside || anotherDialogIsOpen) return;
            event.preventDefault();
            openNodePicker({ unconnected: true });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    });
    const openOperandPicker = (rootIndex, path, rowIndex, operand) => {
        if (disabled) return;
        closeExternalMenus();
        // The conditional inspector stays open beneath the picker; only the legacy
        // single-variable inspector is dismissed.
        setInspectedNode((current) => current?.kind === "conditional" || current?.kind === "condition-row" ? current : null);
        setNodePicker(null);
        setActionOperandInspector(null);
        setOperandPicker({ kind: "condition", rootIndex, path, rowIndex, operand });
    };
    const openActionOperandPicker = (rootIndex, path, actionIndex, termIndex) => {
        if (disabled) return;
        closeExternalMenus();
        setNodePicker(null);
        setActionOperandInspector(null);
        setOperandPicker({ kind: "action", rootIndex, path, actionIndex, termIndex });
    };
    const setRawActionInput = (rootIndex, path, actionIndex, termIndex, valueType) => {
        updateActionOperand(rootIndex, path, actionIndex, termIndex, valueType === "boolean"
            ? { type: "boolean", value: false }
            : { type: "number", value: 0 });
        setOperandPicker(null);
    };
    const chooseOperandVariable = (variableId) => {
        if (!operandPicker) return;
        if (operandPicker.kind === "action") {
            const definition = stateVariables.find((variable) => variable.id === variableId);
            const customVariables = configuration.customVariables ?? [];
            const changed = (entry, index) => index !== operandPicker.actionIndex
                ? entry
                : withActionOperandVariable(entry, customVariables, operandPicker.termIndex, definition, selectableTypes) ?? entry;
            updateBranch(operandPicker.rootIndex, operandPicker.path, (branch) => setGraphActions(branch, graphBranchActions(branch).map(changed)));
            setOperandPicker(null);
            return;
        }
        if (operandPicker.operand === 1 && variableId === "always") {
            updateBranch(operandPicker.rootIndex, operandPicker.path, (branch) => ({
                ...branch,
                conditions: (branch.conditions ?? []).map((condition, index) => index === operandPicker.rowIndex
                    ? { type: "always" }
                    : condition),
            }));
            setInspectedNode((current) => current?.kind === "conditional" || current?.kind === "condition-row" ? current : null);
            setOperandPicker(null);
            return;
        }
        const definition = stateVariables.find((variable) => variable.id === variableId);
        if (!definition || (operandPicker.operand === 2 && definition.valueType !== "number")) return;
        updateBranch(operandPicker.rootIndex, operandPicker.path, (branch) => ({
            ...branch,
            conditions: (branch.conditions ?? []).map((condition, index) => {
                if (index !== operandPicker.rowIndex) return condition;
                if (operandPicker.operand === 2) return {
                    ...condition,
                    right: { type: "variable", value: definition.id },
                    ...(definition.supportsSelectable ? { rightSelectable: defaultSelectableForVariable(definition, selectableTypes) } : {}),
                };
                const replacement = createExpressionCondition(definition);
                const keepRight = definition.valueType === "number" && ["number", "variable"].includes(condition.right?.type)
                    ? condition.right
                    : definition.valueType === "boolean" && condition.right?.type === "boolean" ? condition.right : replacement.right;
                return { ...replacement, right: keepRight };
            }),
        }));
        setOperandPicker(null);
    };
    const addAction = (rootIndex, path, actionId) => {
        const rootNode = roots[rootIndex];
        const branch = treeBranchAt(rootNode?.branches, path);
        if (!rootNode || !branch) return;
        const existingActionCount = graphBranchActions(branch).length;
        const nextBranch = addGraphAction(branch, selectedLoadout, actionId, configuration.customVariables ?? []);
        if (nextBranch === branch) return;
        const nextRoots = normalizeRoots(updateTreeBranch(roots, rootIndex, path, () => nextBranch));
        const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables);
        const nextAction = nextGraph.actions.find((candidate) => candidate.rootIndex === rootIndex
            && sameGraphPath(candidate.path, path)
            && candidate.actionIndex === existingActionCount);
        const condition = graph.conditions.find((candidate) => candidate.rootIndex === rootIndex && sameGraphPath(candidate.path, path));
        const previousAction = graph.actions.find((candidate) => candidate.rootIndex === rootIndex
            && sameGraphPath(candidate.path, path)
            && candidate.actionIndex === existingActionCount - 1);
        const positionOverrides = nextAction && condition
            ? { [nextAction.id]: positionInsertedGraphNode(condition, previousAction, nextAction, nodeOffsetsRef.current, CONDITION_TO_CHILD_GAP) }
            : {};
        commitConfiguration({ ...configuration, roots: nextRoots }, true, positionOverrides);
        setNodePicker(null);
    };
    const replaceAction = (rootIndex, path, actionIndex, actionId) => {
        const branch = treeBranchAt(roots[rootIndex]?.branches, path);
        if (!branch) return;
        const actions = graphBranchActions(branch);
        const otherActions = actions.filter((_, index) => index !== actionIndex);
        const replacementBranch = addGraphAction(setGraphActions(branch, otherActions), selectedLoadout, actionId, configuration.customVariables ?? []);
        const fresh = graphBranchActions(replacementBranch)[otherActions.length];
        if (!fresh) return;
        // The replacement stays the same node: it keeps its id.
        const previous = actions[actionIndex];
        const replacement = { ...fresh, ...(previous?.id ? { id: previous.id } : {}) };
        updateBranch(rootIndex, path, (current) => setGraphActions(current, graphBranchActions(current).map((entry, index) => index === actionIndex ? replacement : entry)));
        setNodePicker(null);
    };
    const inspectActionOperand = (rootIndex, path, actionIndex, termIndex) => {
        setOperandPicker(null);
        setActionOperandInspector({ rootIndex, path, actionIndex, termIndex });
    };
    const updateActionOperand = (rootIndex, path, actionIndex, termIndex, operand) => updateBranch(rootIndex, path, (current) => setGraphActions(
        current,
        graphBranchActions(current).map((entry, index) => index === actionIndex ? withActionOperand(entry, configuration.customVariables ?? [], termIndex, operand) : entry),
    ));
    const actionOperandEntry = actionOperandInspector
        ? graphBranchActions(treeBranchAt(roots[actionOperandInspector.rootIndex]?.branches, actionOperandInspector.path))[actionOperandInspector.actionIndex]
        : null;
    const actionOperand = actionOperandEntry && actionOperandInspector
        ? variableActionTerms(actionOperandEntry)[actionOperandInspector.termIndex]?.operand
        : null;
    const actionOperandDefinition = actionOperand?.type === "variable"
        ? stateVariables.find((variable) => variable.id === actionOperand.value)
        : null;
    const pickerActionEntry = operandPicker?.kind === "action"
        ? graphBranchActions(treeBranchAt(roots[operandPicker.rootIndex]?.branches, operandPicker.path))[operandPicker.actionIndex]
        : null;
    const pickerActionValueType = pickerActionEntry ? actionOperandValueType(pickerActionEntry, configuration.customVariables ?? []) : null;
    const addRootConditional = (event, node, rootNode) => {
        event.stopPropagation();
        setSelectedNodeIds([]);
        setInspectedNode(null);
        const branch = newTreeBranch("if", defaultVariable, nextBranchPriority(rootNode.branches));
        const branchIndex = rootNode.branches?.length ?? 0;
        const nextRoots = normalizeRoots(roots.map((root, index) => index === node.rootIndex ? { ...root, branches: [...(root.branches ?? []), branch] } : root));
        const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables);
        const nextBranch = treeBranchAt(nextRoots[node.rootIndex]?.branches, [branchIndex]);
        const nextCondition = nextGraph.conditions.find((candidate) => candidate.rootIndex === node.rootIndex && candidate.branchId === nextBranch?.id);
        const previousCondition = graph.conditions.find((candidate) => candidate.rootIndex === node.rootIndex
            && sameGraphPath(candidate.path, [branchIndex - 1]));
        const positionOverrides = nextCondition
            ? { [nextCondition.id]: positionInsertedGraphNode(node, previousCondition, nextCondition, nodeOffsetsRef.current, ROOT_TO_CONDITION_GAP) }
            : {};
        commitConfiguration({ ...configuration, roots: nextRoots }, true, positionOverrides);
    };
    return (
        <div
            ref={viewportRef}
            className="code-board relative min-h-0 flex-1 select-none overflow-hidden bg-zinc-900"
            onPointerDown={handleBoardPointerDown}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
                event.preventDefault();
                const rect = viewportRef.current?.getBoundingClientRect();
                onZoomChange(event.deltaY > 0 ? -0.06 : 0.06, rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
            }}
        >
            {!roots.length && <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-widest text-ink-muted">ADD A ROOT TO START</div>}
            <div className="code-history-rail absolute inset-y-0 left-0 z-20 flex w-14 flex-col items-center justify-between gap-2 border-r border-white/10 bg-[#14181c]/95 px-2 py-4 shadow-[8px_0_20px_rgba(0,0,0,.12)]">
                <div className="flex flex-col gap-2">
                    {!zoomToFitRef && <button type="button" aria-label="Zoom to fit the tree" title="Zoom to fit" onClick={zoomToFit} className="code-history-button">⤢</button>}
                    <button type="button" aria-label="Tidy layout in execution order" title="Tidy: lay the tree out in execution order (behavior does not change)" disabled={disabled} onClick={tidyLayout} className="code-history-button">⇲</button>
                </div>
                <div className="flex flex-col gap-2">
                <button type="button" aria-label="Undo code edit" title="Undo" disabled={!canUndo} onClick={onUndo} className="code-history-button">↶</button>
                <button type="button" aria-label="Redo code edit" title="Redo" disabled={!canRedo} onClick={onRedo} className="code-history-button">↷</button>
                </div>
            </div>
            {isSearchOpen && <SearchRootNodesModal roots={roots} nodes={graph.roots} disabled={disabled} canRemove={canRemove} quick={isQuickSearchOpen} onSelect={centerOnRoot} onPriorityChange={setRootOrder} onMoveRoot={moveRootInOrder} onRemove={removeRootNode} onDeleteAll={() => { if (window.confirm("Delete all roots?")) commitConfiguration({ ...configuration, roots: [] }); }} onClose={onSearchClose} />}
            {wireToast && <ToastStack><Toast tone="warning" onDismiss={() => setWireToast(null)}>{wireToast}</Toast></ToastStack>}
            {armedWire?.touch && <div className="code-wire-banner" role="status">Tap an input to connect. Tap empty space to cancel.</div>}
            {!isSearchOpen && !isExternalConfigurationOpen && nodePicker && <NodeKindPicker type={nodePicker.type} stateVariables={stateVariables} selectableTypes={selectableTypes} selectedLoadout={selectedLoadout} title={nodePicker.unconnected ? "Add node" : nodePicker.actionIndex == null ? "Add action" : "Change action"} onCancel={() => setNodePicker(null)} flowOptions={nodePicker.unconnected ? [{ id: "conditional", label: "Conditional", head: "flow" }] : []} onChooseFlow={() => createUnconnectedNode()} onChooseAction={(actionId) => nodePicker.unconnected ? createUnconnectedNode(actionId) : nodePicker.actionIndex == null ? addAction(nodePicker.rootIndex, nodePicker.path, actionId) : replaceAction(nodePicker.rootIndex, nodePicker.path, nodePicker.actionIndex, actionId)} />}
            {!isSearchOpen && !isExternalConfigurationOpen && !nodePicker && operandPicker && <VariableOperandPicker operand={operandPicker.kind === "action" ? 2 : operandPicker.operand} numericOnly={operandPicker.kind === "action" && pickerActionValueType === "number"} valueType={operandPicker.kind === "action" ? pickerActionValueType : null} stateVariables={stateVariables} onChoose={chooseOperandVariable} onUseRawNumber={operandPicker.kind === "action" ? () => setRawActionInput(operandPicker.rootIndex, operandPicker.path, operandPicker.actionIndex, operandPicker.termIndex, pickerActionValueType) : null} onClose={() => setOperandPicker(null)} />}
            <div onPointerMove={(event) => { if (armedWire && event.pointerType !== "touch") setWireCursor(canvasPoint(event)); }} onClickCapture={(event) => {
                const frame = event.target.closest?.("[data-graph-node-id]");
                const row = event.target.closest?.("[data-cond-row]");
                clickLogRef.current.record(frame ? `${frame.dataset.graphNodeId}:${row ? row.dataset.condRow : ""}` : "canvas");
            }} onDoubleClick={(event) => {
                if (disabled || !clickLogRef.current.isDoubleClick()) return;
                if (event.target === event.currentTarget) { openNodePicker({ unconnected: true, point: canvasPoint(event) }); return; }
                const frame = event.target.closest?.("[data-graph-node-id]");
                if (phone || !frame || event.target.closest("button,input,select,textarea")) return;
                const rowElement = event.target.closest("[data-cond-row]");
                editNode(graphNodeById.get(frame.dataset.graphNodeId), rowElement ? Number(rowElement.dataset.condRow) : 0);
            }} onPointerDown={beginMarquee} className="code-graph-surface absolute left-0 top-0 bg-[#171b20] bg-[radial-gradient(circle,rgba(100,116,139,.24)_1px,transparent_1px)] bg-[size:20px_20px]" style={{ width: canvasWidth, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", "--code-zoom": zoom }}>
                <svg className="pointer-events-none absolute inset-0 overflow-hidden" width={canvasWidth} height={canvasHeight}>
                    {graph.edges.filter((edge) => !(armedWire?.mode === "input" && !armedWire.touch && edge.toId === armedWire.id)).map((edge) => <g key={edge.id}><path d={graphEdgePath(edge, nodeOffsets, frameGeometry)} fill="none" stroke={selectedWire === edge.id ? "#5fd4f0" : "rgba(165,180,252,.72)"} strokeWidth="2" /><path d={graphEdgePath(edge, nodeOffsets, frameGeometry)} fill="none" stroke="transparent" strokeWidth="16" style={{ pointerEvents: "stroke" }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedNodeIds([]); setSelectedWire(edge.id); }} /></g>)}
                    {previewEdge && !armedWire?.touch && <path d={graphEdgePath(previewEdge)} fill="none" stroke="#5fd4f0" strokeWidth="2" strokeDasharray="6 4" />}
                </svg>
                {selectionBox && <div className="code-selection-marquee" style={{
                    left: Math.min(selectionBox.start.x, selectionBox.current.x),
                    top: Math.min(selectionBox.start.y, selectionBox.current.y),
                    width: Math.abs(selectionBox.current.x - selectionBox.start.x),
                    height: Math.abs(selectionBox.current.y - selectionBox.start.y),
                }} />}
                {graph.roots.map((node) => {
                    const rootNode = roots[node.rootIndex];
                    return <GraphRootNode
                        key={node.id}
                        node={node}
                        {...pinProps(node)}
                        rootNode={rootNode}
                        nodeOffsets={nodeOffsets}
                        disabled={disabled}
                        canRemove={canRemove}
                        puzzleMode={puzzleMode}
                        graphConditionCount={graphConditionCount}
                        maxTotalConditions={maxTotalConditions}
                        selected={selectedNodeIds.includes(node.id)}
                        tutorialFocus={tutorialFocus}
                        onSelect={(event) => selectGraphNode(event, node.id)}
                        onPointerDown={(event) => beginNodeDrag(event, node.id, { fromControls: true })}
                        {...orderProps(node)}
                        onNameChange={(name) => updateRoot(node.rootIndex, { name })}
                        onAddConditional={addRootConditional}
                        onRemove={() => removeRootNode(node.rootIndex)}
                    />;
                })}
                {graph.conditions.map((node) => {
                    const branch = treeBranchAt(roots[node.rootIndex]?.branches, node.path);
                    if (!branch) return null;
                    return <GraphConditionNode {...pinProps(node)} key={node.id} {...{ node, branch, disabled, canRemove, stateVariables, defaultVariable, nodeOffsets, beginNodeDrag, tutorialFocus, puzzleMode }} puzzleLabel={roots[node.rootIndex]?.name ?? "Puzzle Condition"} selected={selectedNodeIds.includes(node.id)} onSelect={(event) => selectGraphNode(event, node.id)} onEditCondition={(event, rowIndex) => openConditionRow(event, node, rowIndex)} activeConditionIndex={inspectedNode?.kind === "condition-row" && inspectedNode.id === node.id ? inspectedNode.rowIndex : selectedNodeIds.includes(node.id) && selectedRow?.id === node.id ? selectedRow.rowIndex : null} {...orderProps(node)} onPickVariable={(rowIndex, operand) => openOperandPicker(node.rootIndex, node.path, rowIndex, operand)} onInspectVariable={(rowIndex, operand) => { setInspectedNode({ kind: "condition-variable", id: node.id, rowIndex, operand }); }} onRemoveCondition={(rowIndex) => { setInspectedNode((current) => (current?.kind === "condition-variable" || current?.kind === "condition-row") && current.id === node.id ? null : current); updateBranch(node.rootIndex, node.path, (current) => ({ ...current, conditions: (current.conditions ?? []).filter((_, index) => index !== rowIndex) })); }} inspectedVariable={inspectedNode?.kind === "condition-variable" && inspectedNode.id === node.id ? inspectedNode : null} canAddAction={graphActionCount < maxLogicBlocks} canAddCondition={graphConditionCount < maxTotalConditions}
                        onChange={(updates) => updateBranch(node.rootIndex, node.path, (current) => ({ ...current, ...updates }))}
                        onRemove={() => removeBranch(node.rootIndex, node.path)}
                        onAddChildConditional={() => {
                            const child = newTreeBranch("if", defaultVariable, nextBranchPriority(branch.children));
                            const childIndex = branch.children?.length ?? 0;
                            const nextRoots = normalizeRoots(updateTreeBranch(roots, node.rootIndex, node.path, (current) => ({ ...current, children: [...(current.children ?? []), child] })));
                            const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, selectableTypes, configuration.customVariables);
                            const nextChild = nextGraph.conditions.find((candidate) => candidate.rootIndex === node.rootIndex
                                && sameGraphPath(candidate.path, [...node.path, childIndex]));
                            const previousChild = graph.conditions.find((candidate) => candidate.rootIndex === node.rootIndex
                                && sameGraphPath(candidate.path, [...node.path, childIndex - 1]));
                            const positionOverrides = nextChild
                                ? { [nextChild.id]: positionInsertedGraphNode(node, previousChild, nextChild, nodeOffsetsRef.current, CONDITION_TO_CHILD_GAP) }
                                : {};
                            commitConfiguration({ ...configuration, roots: nextRoots }, true, positionOverrides);
                        }}
                        onAddAction={() => openNodePicker({ type: "action", rootIndex: node.rootIndex, path: node.path })} />;
                })}
                {graph.actions.map((node) => {
                    const branch = treeBranchAt(roots[node.rootIndex]?.branches, node.path);
                    const actions = graphBranchActions(branch);
                    const entry = actions[node.actionIndex];
                    if (!branch || !entry) return null;
                    return <GraphActionNode {...pinProps(node)} key={node.id} {...{ node, entry, actions, branch, disabled, selectedLoadout, selectableTypes, stateVariables, nodeOffsets, beginNodeDrag, canRemove, puzzleMode }} selectedNode={selectedNodeIds.includes(node.id)} onInspect={(event) => selectGraphNode(event, node.id)} customVariables={configuration.customVariables ?? []}
                        onChange={(nextEntry) => updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.map((item, index) => index === node.actionIndex ? nextEntry : item)))}
                        onRemove={() => removeGraphAction(node.rootIndex, node.path, node.actionIndex)} />;
                })}
            </div>
            {!isSearchOpen && !isExternalConfigurationOpen && inspectedNode && <LogicNodeInspector orderInfo={orderInfo} inspectedNode={inspectedNode} graph={graph} roots={roots} stateVariables={stateVariables} selectableTypes={selectableTypes} selectableAbilityIds={selectableAbilityIds} selectedLoadout={selectedLoadout} customVariables={configuration.customVariables ?? []} disabled={disabled} canRemove={canRemove} canAddAction={graphActionCount < maxLogicBlocks} defaultVariable={defaultVariable} puzzleMode={puzzleMode} onClose={() => setInspectedNode(null)} updateBranch={updateBranch} onPickConditionOperand={openOperandPicker} onChangeAction={(rootIndex, path, actionIndex) => openNodePicker({ type: "action", rootIndex, path, actionIndex })} onPickActionOperand={openActionOperandPicker} onInspectActionOperand={inspectActionOperand} onDismissOperandPicker={() => setOperandPicker(null)} />}
            {!isSearchOpen && !isExternalConfigurationOpen && actionOperandInspector && actionOperandDefinition && <ActionVariableInspector definition={actionOperandDefinition} operand={actionOperand} selectableTypes={selectableTypes} disabled={disabled} onChange={(operand) => updateActionOperand(actionOperandInspector.rootIndex, actionOperandInspector.path, actionOperandInspector.actionIndex, actionOperandInspector.termIndex, operand)} onClose={() => setActionOperandInspector(null)} />}
        </div>
    );
});
