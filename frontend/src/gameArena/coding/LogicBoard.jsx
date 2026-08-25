import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
    createExpressionCondition,
    defaultTargetForVariable,
    MAX_ROOT_NAME_LENGTH,
    MAX_ROOT_NODES,
    MAX_LOGIC_BLOCKS,
    MAX_TOTAL_CONDITIONS,
    insertParentLogicBranch,
    normalizeRoots,
    removeLogicBranch,
    setLogicBranchPriority,
    setLogicRootPriority as setRootPriority,
} from "../botlogic/code/BotCode.js";
import RootNodePriorityInput from "./controls/RootNodePriorityInput.jsx";
import SearchRootNodesModal from "./modals/SearchRootNodesModal.jsx";
import {
    buildLogicGraph,
    graphNodeStyle,
    treeBranchAt,
    updateTreeBranch,
    normalizeSiblingTypes,
    graphBranchActions,
    setGraphActions,
    addGraphAction,
    NodeKindPicker,
    VariableOperandPicker,
    GraphConditionNode,
    GraphActionNode,
    LogicNodeInspector,
    ActionVariableInspector,
    variableActionTerms,
    countActions,
    countLogicConditions,
    clamp,
    conditionGraphNodeId,
    graphEdgePath,
    newTreeBranch,
    nextBranchOrder,
} from "./nodes/GraphNodes.jsx";
import {
    nodePositionsForGraph,
    offsetsForGraphPositions,
} from "../botlogic/code/configuration/nodePositions.js";

const LOGIC_CANVAS_WIDTH = 10000;
const LOGIC_CANVAS_HEIGHT = 6000;
const ROOT_TO_CONDITION_GAP = 106;
const CONDITION_TO_CHILD_GAP = 70;
const GRAPH_SIBLING_GAP = 72;
const LOGIC_MIN_ZOOM = 0.45;
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

function sameGraphPath(first, second) {
    return Array.isArray(first) && Array.isArray(second)
        && first.length === second.length
        && first.every((value, index) => value === second[index]);
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
    stateVariables,
    defaultVariable,
    targetTypes,
    onChange,
    zoom,
    pan,
    onPanChange,
    onZoomChange,
    onPinchZoom = null,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    isSearchOpen,
    isQuickSearchOpen = false,
    onSearchClose,
    isExternalConfigurationOpen = false,
    onCloseExternalConfiguration,
    tutorialFocus = null,
    maxLogicBlocks = MAX_LOGIC_BLOCKS,
    maxTotalConditions = MAX_TOTAL_CONDITIONS,
    puzzleMode = false,
}, ref) {
    const viewportRef = useRef(null);
    const [nodeOffsets, setNodeOffsets] = useState({});
    const nodeOffsetsRef = useRef({});
    const [nodePicker, setNodePicker] = useState(null);
    const [inspectedNode, setInspectedNode] = useState(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState([]);
    const [operandPicker, setOperandPicker] = useState(null);
    const [actionOperandInspector, setActionOperandInspector] = useState(null);
    const [selectionBox, setSelectionBox] = useState(null);
    const removeSelectedNodesRef = useRef(() => {});
    const suppressSurfaceClickRef = useRef(false);
    const touchGestureRef = useRef(null);
    const onSearchCloseRef = useRef(onSearchClose);
    const onCloseExternalConfigurationRef = useRef(onCloseExternalConfiguration);
    useEffect(() => {
        onSearchCloseRef.current = onSearchClose;
        onCloseExternalConfigurationRef.current = onCloseExternalConfiguration;
    }, [onCloseExternalConfiguration, onSearchClose]);
    const roots = useMemo(() => normalizeRoots(configuration.roots ?? []), [configuration.roots]);
    const graphActionCount = countActions(configuration);
    const graphConditionCount = countLogicConditions(configuration);
    const graph = useMemo(() => buildLogicGraph(roots, stateVariables, selectedLoadout, targetTypes), [roots, selectedLoadout, stateVariables, targetTypes]);
    const canvasWidth = LOGIC_CANVAS_WIDTH;
    const canvasHeight = LOGIC_CANVAS_HEIGHT;
    const graphNodes = useMemo(() => [...graph.roots, ...graph.conditions, ...graph.actions, ...graph.variables, ...graph.targets], [graph]);
    const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));
    const updateNodeOffsets = useCallback((updater) => {
        const current = nodeOffsetsRef.current;
        const next = typeof updater === "function" ? updater(current) : updater;
        nodeOffsetsRef.current = next;
        setNodeOffsets(next);
    }, []);
    useEffect(() => {
        const savedOffsets = offsetsForGraphPositions(graphNodes, configuration?.nodePositions);
        setNodeOffsets((current) => {
            const next = Object.fromEntries(graphNodes.map((node) => [
                node.id,
                savedOffsets[node.id] ?? current[node.id] ?? { x: 0, y: 0 },
            ]));
            nodeOffsetsRef.current = next;
            return next;
        });
    }, [configuration?.nodePositions, graphNodes]);
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
        setInspectedNode(null);
        setOperandPicker(null);
    }, [nodePicker]);
    const closeExternalMenus = () => {
        onSearchCloseRef.current?.();
        onCloseExternalConfigurationRef.current?.();
    };
    const openConfiguration = (inspector) => {
        closeExternalMenus();
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
        setInspectedNode(inspector);
    };
    const openNodePicker = (picker) => {
        closeExternalMenus();
        setInspectedNode(null);
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
    const clearCanvasSelectionFromSurface = (event) => {
        if (event.target !== event.currentTarget) return;
        if (suppressSurfaceClickRef.current) {
            suppressSurfaceClickRef.current = false;
            return;
        }
        if (document.activeElement?.closest?.(".code-condition-input.is-raw, .code-root-name")) document.activeElement.blur();
        clearCanvasSelection();
    };
    const selectGraphNode = (event, nodeId, inspector = null) => {
        event.stopPropagation();
        closeExternalMenus();
        const additive = event.ctrlKey || event.metaKey;
        setSelectedNodeIds((current) => {
            if (!additive) return current.includes(nodeId) ? current : [nodeId];
            return current.includes(nodeId) ? current : [...current, nodeId];
        });
        if (inspector) openConfiguration(inspector);
        else if (!additive) setInspectedNode(null);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
    };
    const commitConfiguration = (nextConfiguration, preserveGraphPositions = true, positionOverrides = {}) => {
        const clean = { ...nextConfiguration };
        if (Array.isArray(clean.roots)) clean.roots = normalizeRoots(clean.roots);
        delete clean.editorGraph;
        if (Array.isArray(clean.roots)) {
            const nextGraph = buildLogicGraph(clean.roots, stateVariables, selectedLoadout, targetTypes);
            const nextGraphNodes = graphNodesForGraph(nextGraph);
            const currentPositions = nodePositionsForGraph(graphNodes, nodeOffsetsRef.current);
            const savedOffsets = offsetsForGraphPositions(nextGraphNodes, clean.nodePositions ?? currentPositions);
            let nextOffsets = Object.fromEntries(nextGraphNodes.map((node) => [
                node.id,
                savedOffsets[node.id] ?? nodeOffsetsRef.current[node.id] ?? { x: 0, y: 0 },
            ]));
            if (preserveGraphPositions) {
                nextGraphNodes.forEach((node) => {
                    const previousPosition = currentPositions[node.id];
                    if (!previousPosition) return;
                    nextOffsets[node.id] = {
                        x: clamp(previousPosition.x - node.x, -node.x, canvasWidth - node.x - node.width),
                        y: clamp(previousPosition.y - node.y, -node.y, canvasHeight - node.y - node.height),
                    };
                });
            }
            Object.entries(positionOverrides).forEach(([nodeId, position]) => {
                const node = nextGraphNodes.find((candidate) => candidate.id === nodeId);
                if (!node || !Number.isFinite(Number(position?.x)) || !Number.isFinite(Number(position?.y))) return;
                nextOffsets[nodeId] = {
                    x: clamp(Number(position.x) - node.x, -node.x, canvasWidth - node.x - node.width),
                    y: clamp(Number(position.y) - node.y, -node.y, canvasHeight - node.y - node.height),
                };
            });
            updateNodeOffsets(nextOffsets);
            clean.nodePositions = nodePositionsForGraph(nextGraphNodes, nextOffsets);
        }
        onChange(clean);
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
    useImperativeHandle(ref, () => ({
        placeRootAtCenter(nextRoots, rootIndex) {
            const rect = viewportRef.current?.getBoundingClientRect();
            const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, targetTypes);
            const rootNode = nextGraph.roots.find((node) => node.rootIndex === rootIndex);
            if (!rect || !rootNode) return null;

            const centerX = (rect.width / 2 - pan.x) / zoom;
            const centerY = (rect.height / 2 - pan.y) / zoom;
            const delta = {
                x: centerX - (rootNode.x + rootNode.width / 2),
                y: centerY - (rootNode.y + rootNode.height / 2),
            };
            const treeNodes = [...nextGraph.roots, ...nextGraph.conditions, ...nextGraph.actions, ...nextGraph.variables, ...nextGraph.targets]
                .filter((node) => node.rootIndex === rootNode.rootIndex);
            const nextOffsets = {
                ...nodeOffsetsRef.current,
                ...Object.fromEntries(treeNodes.map((node) => [node.id, {
                    x: clamp(delta.x, -node.x, canvasWidth - node.x - node.width),
                    y: clamp(delta.y, -node.y, canvasHeight - node.y - node.height),
                }]))
            };
            updateNodeOffsets(nextOffsets);
            return nodePositionsForGraph([
                ...nextGraph.roots,
                ...nextGraph.conditions,
                ...nextGraph.actions,
                ...nextGraph.variables,
                ...nextGraph.targets,
            ], nextOffsets);
        },
    }), [canvasHeight, canvasWidth, pan.x, pan.y, selectedLoadout, stateVariables, targetTypes, updateNodeOffsets, zoom]);
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
        handleTouchPointerDown(event);
        beginPan(event);
    };
    const updateRoot = (rootIndex, updates) => commitConfiguration({ ...configuration, roots: roots.map((rootNode, index) => index === rootIndex ? { ...rootNode, ...updates } : rootNode) });
    const removeRootNode = (rootIndex) => commitConfiguration({ ...configuration, roots: roots.filter((_, index) => index !== rootIndex) }, true);
    const removeGraphAction = (rootIndex, path, actionIndex) => {
        if (puzzleMode && roots[rootIndex]?.kind === "modify") {
            removeRootNode(rootIndex);
            return;
        }
        updateBranch(rootIndex, path, (current) => setGraphActions(current, graphBranchActions(current).filter((_, index) => index !== actionIndex)));
    };
    const setRootOrder = (rootIndex, priority) => {
        const reordered = setRootPriority(roots, rootIndex, priority);
        if (reordered !== roots) commitConfiguration({ ...configuration, roots: reordered });
    };
    const persistNodePositions = () => commitConfiguration({
        ...configuration,
        nodePositions: nodePositionsForGraph(graphNodes, nodeOffsetsRef.current),
    });
    const beginNodeDrag = (event, key) => {
        if (disabled || event.button !== 0 || event.target?.closest?.("button,input,select,textarea,label,a,[role=\"button\"],[data-node-drag-ignore]")) return;
        if (event.pointerType === "touch") event.preventDefault();
        event.stopPropagation();
        const dragNodeIds = selectedNodeIds.includes(key) ? selectedNodeIds : [key];
        const startOffsets = Object.fromEntries(dragNodeIds.map((nodeId) => [nodeId, nodeOffsetsRef.current[nodeId] ?? { x: 0, y: 0 }]));
        const start = { x: event.clientX, y: event.clientY };
        const graphNodesToMove = dragNodeIds.map((nodeId) => graphNodeById.get(nodeId)).filter(Boolean);
        if (!graphNodesToMove.length) return;
        let moved = false;
        const move = (next) => {
            if (event.pointerType === "touch") next.preventDefault();
            return updateNodeOffsets((current) => {
                const updated = { ...current };
                const delta = { x: (next.clientX - start.x) / zoom, y: (next.clientY - start.y) / zoom };
                moved ||= Math.abs(delta.x) > 0 || Math.abs(delta.y) > 0;
                graphNodesToMove.forEach((graphNode) => {
                    const startOffset = startOffsets[graphNode.id];
                    updated[graphNode.id] = {
                        x: clamp(startOffset.x + delta.x, -graphNode.x, canvasWidth - graphNode.x - graphNode.width),
                        y: clamp(startOffset.y + delta.y, -graphNode.y, canvasHeight - graphNode.y - graphNode.height),
                    };
                });
                return updated;
            });
        };
        const end = () => {
            if (moved) persistNodePositions();
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
    const beginMarquee = (event) => {
        if (disabled || event.pointerType === "touch" || event.button !== 0 || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        const start = canvasPoint(event);
        const additive = event.ctrlKey || event.metaKey;
        setSelectionBox({ start, current: start, additive });
        setInspectedNode(null);
        setOperandPicker(null);
        setActionOperandInspector(null);
        setNodePicker(null);
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
                suppressSurfaceClickRef.current = true;
                setSelectedNodeIds((currentIds) => additive ? [...new Set([...currentIds, ...matchingNodeIds])] : matchingNodeIds);
            } else {
                clearCanvasSelection();
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
    const removeSelectedNodes = () => {
        if (disabled || !canRemove || !selectedNodeIds.length) return;
        const selected = new Set(selectedNodeIds);
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
            if (selectedConditionIds.has(branchId)) return removeFromBranches(branch.children, rootId);
            const nextBranch = { ...branch };
            if (Array.isArray(branch.children)) nextBranch.children = removeFromBranches(branch.children, rootId);
            const actionIndices = selectedActionsByBranch.get(`${rootId}:${branch.id}`);
            if (actionIndices?.size) {
                const actions = graphBranchActions(branch).filter((_, index) => !actionIndices.has(index));
                Object.assign(nextBranch, setGraphActions(nextBranch, actions));
            }
            return [nextBranch];
        }));
        const nextRoots = roots
            .filter((_, rootIndex) => !selectedRootIndices.has(rootIndex))
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
            if (disabled || !selectedNodeIds.length || !["Backspace", "Delete"].includes(event.key)) return;
            if (event.target?.closest?.("input,textarea,select,[contenteditable=\"true\"]")) return;
            event.preventDefault();
            removeSelectedNodesRef.current();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [disabled, selectedNodeIds, configuration, roots, graph, canRemove, puzzleMode]);
    const openOperandPicker = (rootIndex, path, rowIndex, operand) => {
        if (disabled) return;
        closeExternalMenus();
        setInspectedNode(null);
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
    const chooseOperandVariable = (variableId) => {
        if (!operandPicker) return;
        if (operandPicker.kind === "action") {
            const definition = stateVariables.find((variable) => variable.id === variableId);
            if (!definition || definition.valueType !== "number") return;
            updateBranch(operandPicker.rootIndex, operandPicker.path, (branch) => {
                const actions = graphBranchActions(branch);
                return setGraphActions(branch, actions.map((entry, index) => {
                    if (index !== operandPicker.actionIndex) return entry;
                    const terms = variableActionTerms(entry);
                    const next = { ...entry, terms: terms.map((term, termIndex) => termIndex === operandPicker.termIndex
                        ? { ...term, operand: { type: "variable", value: definition.id, ...(definition.supportsTarget ? { target: defaultTargetForVariable(definition, targetTypes) } : {}) } }
                        : term) };
                    delete next.operation;
                    delete next.operand;
                    delete next.value;
                    return next;
                }));
            });
            setOperandPicker(null);
            return;
        }
        if (operandPicker.operand === 1 && variableId === "always") {
            updateBranch(operandPicker.rootIndex, operandPicker.path, (branch) => ({
                ...branch,
                conditions: (branch.conditions ?? []).map((condition, index) => index === operandPicker.rowIndex
                    ? { type: "always", ...(condition.join === "or" ? { join: "or" } : {}) }
                    : condition),
            }));
            setInspectedNode(null);
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
                    ...(definition.supportsTarget ? { rightTarget: defaultTargetForVariable(definition, targetTypes) } : {}),
                };
                const replacement = createExpressionCondition(definition);
                const keepRight = definition.valueType === "number" && ["number", "variable"].includes(condition.right?.type)
                    ? condition.right
                    : definition.valueType === "boolean" && condition.right?.type === "boolean" ? condition.right : replacement.right;
                return { ...replacement, ...(condition.join === "or" ? { join: "or" } : {}), right: keepRight };
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
        const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, targetTypes);
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
    const inspectActionOperand = (rootIndex, path, actionIndex, termIndex) => {
        setOperandPicker(null);
        setActionOperandInspector({ rootIndex, path, actionIndex, termIndex });
    };
    const updateActionOperand = (rootIndex, path, actionIndex, termIndex, operand) => updateBranch(rootIndex, path, (current) => {
        const actions = graphBranchActions(current);
        return setGraphActions(current, actions.map((entry, index) => {
            if (index !== actionIndex) return entry;
            const terms = variableActionTerms(entry);
            const next = { ...entry, terms: terms.map((term, index) => index === termIndex ? { ...term, operand } : term) };
            delete next.operation;
            delete next.operand;
            delete next.value;
            return next;
        }));
    });
    const actionOperandEntry = actionOperandInspector
        ? graphBranchActions(treeBranchAt(roots[actionOperandInspector.rootIndex]?.branches, actionOperandInspector.path))[actionOperandInspector.actionIndex]
        : null;
    const actionOperand = actionOperandEntry && actionOperandInspector
        ? variableActionTerms(actionOperandEntry)[actionOperandInspector.termIndex]?.operand
        : null;
    const actionOperandDefinition = actionOperand?.type === "variable"
        ? stateVariables.find((variable) => variable.id === actionOperand.value)
        : null;
    const addRootConditional = (event, node, rootNode) => {
        event.stopPropagation();
        setSelectedNodeIds([]);
        setInspectedNode(null);
        const branch = newTreeBranch("if", defaultVariable, nextBranchOrder(rootNode.branches));
        const branchIndex = rootNode.branches?.length ?? 0;
        const nextRoots = normalizeRoots(roots.map((root, index) => index === node.rootIndex ? { ...root, branches: [...(root.branches ?? []), branch] } : root));
        const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, targetTypes);
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
            onClick={clearCanvasSelectionFromSurface}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
                event.preventDefault();
                const rect = viewportRef.current?.getBoundingClientRect();
                onZoomChange(event.deltaY > 0 ? -0.06 : 0.06, rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
            }}
        >
            {!roots.length && <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-widest text-ink-muted">ADD A ROOT TO START</div>}
            <div className="code-history-rail absolute inset-y-0 left-0 z-20 flex w-14 flex-col items-center justify-between gap-2 border-r border-white/10 bg-[#14181c]/95 px-2 py-4 shadow-[8px_0_20px_rgba(0,0,0,.12)]">
                <div />
                <div className="flex flex-col gap-2">
                <button type="button" aria-label="Undo code edit" title="Undo" disabled={!canUndo} onClick={onUndo} className="code-history-button">↶</button>
                <button type="button" aria-label="Redo code edit" title="Redo" disabled={!canRedo} onClick={onRedo} className="code-history-button">↷</button>
                </div>
            </div>
            {isSearchOpen && <SearchRootNodesModal roots={roots} nodes={graph.roots} disabled={disabled} canRemove={canRemove} quick={isQuickSearchOpen} onSelect={centerOnRoot} onPriorityChange={setRootOrder} onRemove={removeRootNode} onDeleteAll={() => { if (window.confirm("Delete all roots?")) commitConfiguration({ ...configuration, roots: [] }); }} onClose={onSearchClose} />}
            {!isSearchOpen && !isExternalConfigurationOpen && nodePicker && <NodeKindPicker type={nodePicker.type} stateVariables={stateVariables} targetTypes={targetTypes} selectedLoadout={selectedLoadout} onCancel={() => setNodePicker(null)} onChooseAction={(actionId) => addAction(nodePicker.rootIndex, nodePicker.path, actionId)} />}
            {!isSearchOpen && !isExternalConfigurationOpen && !nodePicker && operandPicker && <VariableOperandPicker operand={operandPicker.kind === "action" ? 1 : operandPicker.operand} numericOnly={operandPicker.kind === "action"} stateVariables={stateVariables} onChoose={chooseOperandVariable} onClose={() => setOperandPicker(null)} />}
            <div onPointerDown={beginMarquee} onClick={clearCanvasSelectionFromSurface} className="code-graph-surface absolute left-0 top-0 bg-[#171b20] bg-[radial-gradient(circle,rgba(100,116,139,.24)_1px,transparent_1px)] bg-[size:20px_20px]" style={{ width: canvasWidth, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
                <svg className="pointer-events-none absolute inset-0 overflow-hidden" width={canvasWidth} height={canvasHeight}>
                    {graph.edges.map((edge) => <path key={edge.id} d={graphEdgePath(edge, nodeOffsets)} fill="none" stroke="rgba(165,180,252,.72)" strokeWidth="2" />)}
                </svg>
                {selectionBox && <div className="code-selection-marquee" style={{
                    left: Math.min(selectionBox.start.x, selectionBox.current.x),
                    top: Math.min(selectionBox.start.y, selectionBox.current.y),
                    width: Math.abs(selectionBox.current.x - selectionBox.start.x),
                    height: Math.abs(selectionBox.current.y - selectionBox.start.y),
                }} />}
                {graph.roots.map((node) => {
                    const rootNode = roots[node.rootIndex];
                    const label = `Root ${Number(rootNode?.createdOrder) + 1}`;
                    return <section key={node.id} onClick={(event) => selectGraphNode(event, node.id)} onPointerDown={(event) => beginNodeDrag(event, node.id)} className={`code-graph-node code-graph-node--root absolute w-[300px] rounded-sm shadow-2xl ${selectedNodeIds.includes(node.id) ? "is-selected" : ""}`} style={graphNodeStyle(node, nodeOffsets)}>
                        <header className="code-root-header">{puzzleMode ? <span className="code-root-label">PUZZLE RULE</span> : <span className="code-root-label">Root <RootNodePriorityInput priority={Number(rootNode?.createdOrder) + 1} max={MAX_ROOT_NODES} disabled={disabled} onCommit={(priority) => setRootOrder(node.rootIndex, priority)} ariaLabel={`Priority for ${label}`} className="code-root-priority" /></span>}</header>
                        <div className="code-root-body">{puzzleMode ? <span className="code-root-name code-root-name--puzzle" aria-label={`Name for ${label}`}>{rootNode?.name ?? "Puzzle Rule"}</span> : <RootNameInput value={rootNode?.name} disabled={disabled} ariaLabel={`Name for ${label}`} onCommit={(name) => updateRoot(node.rootIndex, { name })} />}<div className="code-root-actions">{!puzzleMode && <button type="button" disabled={disabled || graphConditionCount >= maxTotalConditions} onClick={(event) => addRootConditional(event, node, rootNode)} className={`code-root-action code-root-action--conditional ${tutorialFocus === "add-condition" && !rootNode.branches?.length ? "tutorial-control-focus" : ""}`}>+ CONDITIONAL</button>}<button type="button" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); removeRootNode(node.rootIndex); }} className="code-root-action code-root-action--remove">REMOVE</button></div>
                        </div>
                    </section>;
                })}
                {graph.conditions.map((node) => {
                    const branch = treeBranchAt(roots[node.rootIndex]?.branches, node.path);
                    if (!branch) return null;
                    return <GraphConditionNode key={node.id} {...{ node, branch, disabled, canRemove, stateVariables, defaultVariable, nodeOffsets, beginNodeDrag, tutorialFocus, puzzleMode }} puzzleLabel={roots[node.rootIndex]?.name ?? "Puzzle Condition"} selected={selectedNodeIds.includes(node.id)} onSelect={(event) => selectGraphNode(event, node.id)} onPriorityChange={(priority) => { const reordered = setLogicBranchPriority(roots, node.rootIndex, node.path, priority); if (reordered !== roots) commitConfiguration({ ...configuration, roots: reordered }); }} onPickVariable={(rowIndex, operand) => openOperandPicker(node.rootIndex, node.path, rowIndex, operand)} onInspectVariable={(rowIndex, operand) => { setInspectedNode({ kind: "condition-variable", id: node.id, rowIndex, operand }); }} onUseRawNumber={(rowIndex) => { setInspectedNode((current) => current?.kind === "condition-variable" && current.id === node.id && current.rowIndex === rowIndex && current.operand === 2 ? null : current); updateBranch(node.rootIndex, node.path, (current) => ({ ...current, conditions: (current.conditions ?? []).map((condition, index) => { if (index !== rowIndex) return condition; const next = { ...condition, right: { type: "number", value: 0 } }; delete next.rightTarget; return next; }) })); }} onRemoveCondition={(rowIndex) => { const currentConditions = Array.isArray(branch.conditions) ? branch.conditions : []; if (currentConditions.length <= 1) { setInspectedNode(null); setSelectedNodeIds((current) => current.filter((id) => id !== node.id)); removeBranch(node.rootIndex, node.path); return; } setInspectedNode((current) => current?.kind === "condition-variable" && current.id === node.id ? null : current); updateBranch(node.rootIndex, node.path, (current) => ({ ...current, conditions: (current.conditions ?? []).filter((_, index) => index !== rowIndex) })); }} inspectedVariable={inspectedNode?.kind === "condition-variable" && inspectedNode.id === node.id ? inspectedNode : null} canAddAction={graphActionCount < maxLogicBlocks} canAddCondition={graphConditionCount < maxTotalConditions}
                        onChange={(updates) => updateBranch(node.rootIndex, node.path, (current) => ({ ...current, ...updates }))}
                        onRemove={() => removeBranch(node.rootIndex, node.path)}
                        onAddParentConditional={() => {
                            const parent = newTreeBranch(branch.branchType ?? "if", defaultVariable);
                            const nextRoots = insertParentLogicBranch(roots, node.rootIndex, node.path, parent);
                            const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, targetTypes);
                            const nextParent = nextGraph.conditions.find((candidate) => candidate.rootIndex === node.rootIndex && sameGraphPath(candidate.path, node.path));
                            const currentPosition = absoluteGraphNodePosition(node, nodeOffsetsRef.current);
                            const positionOverrides = {};
                            if (nextParent) {
                                positionOverrides[nextParent.id] = {
                                    x: currentPosition.x + (currentPosition.width - nextParent.width) / 2,
                                    y: currentPosition.y - nextParent.height - CONDITION_TO_CHILD_GAP,
                                };
                            }
                            graph.conditions.filter((candidate) => candidate.rootIndex === node.rootIndex
                                && sameGraphPath(candidate.path.slice(0, node.path.length), node.path)).forEach((candidate) => {
                                const mappedPath = [...candidate.path.slice(0, node.path.length), 0, ...candidate.path.slice(node.path.length)];
                                const replacement = nextGraph.conditions.find((nextNode) => nextNode.rootIndex === node.rootIndex && sameGraphPath(nextNode.path, mappedPath));
                                if (replacement) positionOverrides[replacement.id] = absoluteGraphNodePosition(candidate, nodeOffsetsRef.current);
                            });
                            graph.actions.filter((candidate) => candidate.rootIndex === node.rootIndex
                                && sameGraphPath(candidate.path.slice(0, node.path.length), node.path)).forEach((candidate) => {
                                const mappedPath = [...candidate.path.slice(0, node.path.length), 0, ...candidate.path.slice(node.path.length)];
                                const replacement = nextGraph.actions.find((nextNode) => nextNode.rootIndex === node.rootIndex
                                    && sameGraphPath(nextNode.path, mappedPath)
                                    && nextNode.actionIndex === candidate.actionIndex);
                                if (replacement) positionOverrides[replacement.id] = absoluteGraphNodePosition(candidate, nodeOffsetsRef.current);
                            });
                            commitConfiguration({ ...configuration, roots: nextRoots }, true, positionOverrides);
                        }}
                        onAddChildConditional={() => {
                            const child = newTreeBranch("if", defaultVariable, nextBranchOrder(branch.children));
                            const childIndex = branch.children?.length ?? 0;
                            const nextRoots = normalizeRoots(updateTreeBranch(roots, node.rootIndex, node.path, (current) => ({ ...current, children: [...(current.children ?? []), child] })));
                            const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, targetTypes);
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
                    return <GraphActionNode key={node.id} {...{ node, entry, actions, branch, disabled, selectedLoadout, targetTypes, stateVariables, nodeOffsets, beginNodeDrag, canRemove, puzzleMode }} selectedNode={selectedNodeIds.includes(node.id)} onInspect={(event) => selectGraphNode(event, node.id, { kind: "action", id: node.id })} customVariables={configuration.customVariables ?? []}
                        onChange={(nextEntry) => updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.map((item, index) => index === node.actionIndex ? nextEntry : item)))}
                        onRemove={() => removeGraphAction(node.rootIndex, node.path, node.actionIndex)} />;
                })}
            </div>
            {!isSearchOpen && !isExternalConfigurationOpen && inspectedNode && <LogicNodeInspector inspectedNode={inspectedNode} graph={graph} roots={roots} stateVariables={stateVariables} targetTypes={targetTypes} selectedLoadout={selectedLoadout} customVariables={configuration.customVariables ?? []} disabled={disabled} canRemove={canRemove} canAddAction={graphActionCount < maxLogicBlocks} puzzleMode={puzzleMode} onClose={() => setInspectedNode(null)} updateBranch={updateBranch} onPickActionOperand={openActionOperandPicker} onInspectActionOperand={inspectActionOperand} onDismissOperandPicker={() => setOperandPicker(null)} onRemoveAction={removeGraphAction} />}
            {!isSearchOpen && !isExternalConfigurationOpen && actionOperandInspector && actionOperandDefinition && <ActionVariableInspector definition={actionOperandDefinition} operand={actionOperand} targetTypes={targetTypes} disabled={disabled} onChange={(operand) => updateActionOperand(actionOperandInspector.rootIndex, actionOperandInspector.path, actionOperandInspector.actionIndex, actionOperandInspector.termIndex, operand)} onClose={() => setActionOperandInspector(null)} />}
        </div>
    );
});
