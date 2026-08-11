import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
    createExpressionCondition,
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
    countActions,
    countLogicConditions,
    clamp,
    conditionGraphNodeId,
    actionGraphNodeId,
    graphEdgePath,
    newTreeBranch,
    nextBranchOrder,
} from "./nodes/GraphNodes.jsx";

const LOGIC_CANVAS_WIDTH = 10000;
const LOGIC_CANVAS_HEIGHT = 6000;

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
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    isSearchOpen,
    onSearchClose,
    isExternalConfigurationOpen = false,
    onCloseExternalConfiguration,
    tutorialFocus = null,
}, ref) {
    const viewportRef = useRef(null);
    const [nodeOffsets, setNodeOffsets] = useState({});
    const [nodePicker, setNodePicker] = useState(null);
    const [inspectedNode, setInspectedNode] = useState(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState([]);
    const [operandPicker, setOperandPicker] = useState(null);
    const [selectionBox, setSelectionBox] = useState(null);
    const suppressSurfaceClickRef = useRef(false);
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
    useEffect(() => {
        if (!isSearchOpen) return;
        onCloseExternalConfigurationRef.current?.();
        setInspectedNode(null);
        setOperandPicker(null);
        setNodePicker(null);
    }, [isSearchOpen]);
    useEffect(() => {
        if (!isExternalConfigurationOpen) return;
        onSearchCloseRef.current?.();
        setInspectedNode(null);
        setOperandPicker(null);
        setNodePicker(null);
    }, [isExternalConfigurationOpen]);
    useEffect(() => {
        if (!inspectedNode) return;
        onSearchCloseRef.current?.();
        onCloseExternalConfigurationRef.current?.();
        setOperandPicker(null);
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
        setNodePicker(null);
        setInspectedNode(inspector);
    };
    const openNodePicker = (picker) => {
        closeExternalMenus();
        setInspectedNode(null);
        setOperandPicker(null);
        setNodePicker(picker);
    };
    const clearCanvasSelection = () => {
        setInspectedNode(null);
        setSelectedNodeIds([]);
        setOperandPicker(null);
        setNodePicker(null);
    };
    const clearCanvasSelectionFromSurface = (event) => {
        if (event.target !== event.currentTarget) return;
        if (suppressSurfaceClickRef.current) {
            suppressSurfaceClickRef.current = false;
            return;
        }
        if (document.activeElement?.closest?.(".code-condition-input.is-raw")) document.activeElement.blur();
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
        setNodePicker(null);
    };
    const commitConfiguration = (nextConfiguration, preserveGraphPositions = false) => {
        const clean = { ...nextConfiguration };
        if (Array.isArray(clean.roots)) clean.roots = normalizeRoots(clean.roots);
        delete clean.editorGraph;
        if (preserveGraphPositions && Array.isArray(clean.roots)) {
            const nextGraph = buildLogicGraph(clean.roots, stateVariables, selectedLoadout, targetTypes);
            setNodeOffsets((current) => {
                const nextOffsets = { ...current };
        nextGraph.roots.concat(nextGraph.conditions, nextGraph.actions).forEach((node) => {
                    const previous = graphNodeById.get(node.id);
                    if (!previous) return;
                    const previousOffset = current[node.id] ?? { x: 0, y: 0 };
                    nextOffsets[node.id] = {
                        x: clamp(previous.x + previousOffset.x - node.x, -node.x, canvasWidth - node.x - node.width),
                        y: clamp(previous.y + previousOffset.y - node.y, -node.y, canvasHeight - node.y - node.height),
                    };
                });
                return nextOffsets;
            });
        }
        onChange(clean);
    };
    const clampPan = (nextPan) => {
            const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return nextPan;
        const margin = 80;
        return {
            x: clamp(nextPan.x, rect.width - canvasWidth * zoom - margin, margin),
            y: clamp(nextPan.y, rect.height - canvasHeight * zoom - margin, margin),
        };
    };
    useImperativeHandle(ref, () => ({
        placeRootAtCenter(nextRoots, rootIndex) {
            const rect = viewportRef.current?.getBoundingClientRect();
            const nextGraph = buildLogicGraph(nextRoots, stateVariables, selectedLoadout, targetTypes);
            const rootNode = nextGraph.roots.find((node) => node.rootIndex === rootIndex);
            if (!rect || !rootNode) return;

            const centerX = (rect.width / 2 - pan.x) / zoom;
            const centerY = (rect.height / 2 - pan.y) / zoom;
            const delta = {
                x: centerX - (rootNode.x + rootNode.width / 2),
                y: centerY - (rootNode.y + rootNode.height / 2),
            };
            const treeNodes = [...nextGraph.roots, ...nextGraph.conditions, ...nextGraph.actions, ...nextGraph.variables, ...nextGraph.targets]
                .filter((node) => node.rootIndex === rootNode.rootIndex);
            setNodeOffsets((current) => ({
                ...current,
                ...Object.fromEntries(treeNodes.map((node) => [node.id, {
                    x: clamp(delta.x, -node.x, canvasWidth - node.x - node.width),
                    y: clamp(delta.y, -node.y, canvasHeight - node.y - node.height),
                }])),
            }));
        },
    }), [canvasHeight, canvasWidth, pan.x, pan.y, selectedLoadout, stateVariables, targetTypes, zoom]);
    const beginPan = (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY, pan };
        const move = (next) => onPanChange(clampPan({ x: start.pan.x + next.clientX - start.x, y: start.pan.y + next.clientY - start.y }));
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const updateRoot = (rootIndex, updates) => commitConfiguration({ ...configuration, roots: roots.map((rootNode, index) => index === rootIndex ? { ...rootNode, ...updates } : rootNode) });
    const removeRootNode = (rootIndex) => commitConfiguration({ ...configuration, roots: roots.filter((_, index) => index !== rootIndex) }, true);
    const setRootOrder = (rootIndex, priority) => {
        const reordered = setRootPriority(roots, rootIndex, priority);
        if (reordered !== roots) commitConfiguration({ ...configuration, roots: reordered });
    };
    const beginNodeDrag = (event, key) => {
        if (disabled || event.button !== 0 || event.target?.closest?.("button,input,select,textarea,label,a,[role=\"button\"],[data-node-drag-ignore]")) return;
        event.stopPropagation();
        const dragNodeIds = selectedNodeIds.includes(key) ? selectedNodeIds : [key];
        const startOffsets = Object.fromEntries(dragNodeIds.map((nodeId) => [nodeId, nodeOffsets[nodeId] ?? { x: 0, y: 0 }]));
        const start = { x: event.clientX, y: event.clientY };
        const graphNodesToMove = dragNodeIds.map((nodeId) => graphNodeById.get(nodeId)).filter(Boolean);
        if (!graphNodesToMove.length) return;
        const move = (next) => setNodeOffsets((current) => {
            const updated = { ...current };
            const delta = { x: (next.clientX - start.x) / zoom, y: (next.clientY - start.y) / zoom };
            graphNodesToMove.forEach((graphNode) => {
                const startOffset = startOffsets[graphNode.id];
                updated[graphNode.id] = {
                    x: clamp(startOffset.x + delta.x, -graphNode.x, canvasWidth - graphNode.x - graphNode.width),
                    y: clamp(startOffset.y + delta.y, -graphNode.y, canvasHeight - graphNode.y - graphNode.height),
                };
            });
            return updated;
        });
        const end = () => {
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
        if (disabled || event.button !== 0 || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        const start = canvasPoint(event);
        const additive = event.ctrlKey || event.metaKey;
        setSelectionBox({ start, current: start, additive });
        setInspectedNode(null);
        setOperandPicker(null);
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
        graph.actions.forEach((node) => {
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
    useEffect(() => {
        const validNodeIds = new Set(graphNodes.map((node) => node.id));
        setSelectedNodeIds((current) => current.filter((nodeId) => validNodeIds.has(nodeId)));
    }, [graphNodes]);
    useEffect(() => {
        const onKeyDown = (event) => {
            if (disabled || !selectedNodeIds.length || !["Backspace", "Delete"].includes(event.key)) return;
            if (event.target?.closest?.("input,textarea,select,[contenteditable=\"true\"]")) return;
            event.preventDefault();
            removeSelectedNodes();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [disabled, selectedNodeIds, configuration, roots, graph, canRemove]);
    const inheritNodeOffset = (nodeId, parentId) => setNodeOffsets((current) => ({
        ...current,
        [nodeId]: current[parentId] ?? { x: 0, y: 0 },
    }));
    const openOperandPicker = (rootIndex, path, rowIndex, operand) => {
        if (disabled) return;
        closeExternalMenus();
        setInspectedNode(null);
        setNodePicker(null);
        setOperandPicker({ rootIndex, path, rowIndex, operand });
    };
    const chooseOperandVariable = (variableId) => {
        if (!operandPicker) return;
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
                    ...(definition.supportsTarget ? { rightTarget: definition.defaultTarget ?? "opponent" } : {}),
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
        const rootId = rootNode?.id ?? `root-${rootIndex + 1}`;
        const actionNodePrefix = branch && rootNode
            ? `action:${branch.id}:`
            : null;
        if (actionNodePrefix) {
            const conditionNodeId = conditionGraphNodeId(branch.id, rootId);
            const nextActionCount = graphBranchActions(branch).length + 1;
            setNodeOffsets((current) => {
                const conditionalOffset = current[conditionNodeId] ?? { x: 0, y: 0 };
                const next = Object.fromEntries(
                    Object.entries(current).filter(([nodeId]) => !nodeId.startsWith(actionNodePrefix)
                        || !nodeId.endsWith(`:root:${rootId}`))
                );
                for (let actionIndex = 0; actionIndex < nextActionCount; actionIndex += 1) {
                    next[actionGraphNodeId(branch.id, actionIndex, rootId)] = conditionalOffset;
                }
                return next;
            });
        }
        updateBranch(rootIndex, path, (current) => addGraphAction(current, selectedLoadout, actionId, configuration.customVariables ?? []));
        setNodePicker(null);
    };
    return (
        <div
            ref={viewportRef}
            className="code-board relative min-h-0 flex-1 select-none overflow-hidden bg-zinc-900"
            onPointerDown={beginPan}
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
            {isSearchOpen && <SearchRootNodesModal roots={roots} nodes={graph.roots} disabled={disabled} canRemove={canRemove} onSelect={centerOnRoot} onPriorityChange={setRootOrder} onRemove={removeRootNode} onDeleteAll={() => { if (window.confirm("Delete all roots?")) commitConfiguration({ ...configuration, roots: [] }); }} onClose={onSearchClose} />}
            {!isSearchOpen && !isExternalConfigurationOpen && nodePicker && <NodeKindPicker type={nodePicker.type} stateVariables={stateVariables} targetTypes={targetTypes} selectedLoadout={selectedLoadout} onCancel={() => setNodePicker(null)} onChooseAction={(actionId) => addAction(nodePicker.rootIndex, nodePicker.path, actionId)} />}
            {!isSearchOpen && !isExternalConfigurationOpen && !nodePicker && operandPicker && <VariableOperandPicker operand={operandPicker.operand} stateVariables={stateVariables} onChoose={chooseOperandVariable} onClose={() => setOperandPicker(null)} />}
            <div onPointerDown={beginMarquee} onClick={clearCanvasSelectionFromSurface} className="absolute left-0 top-0 bg-[#171b20] bg-[radial-gradient(circle,rgba(100,116,139,.24)_1px,transparent_1px)] bg-[size:20px_20px]" style={{ width: canvasWidth, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
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
                        <header className="code-root-header"><span className="code-root-label">Root <RootNodePriorityInput priority={Number(rootNode?.createdOrder) + 1} max={MAX_ROOT_NODES} disabled={disabled} onCommit={(priority) => setRootOrder(node.rootIndex, priority)} ariaLabel={`Priority for ${label}`} className="code-root-priority" /></span></header>
                        <div className="code-root-body"><input type="text" maxLength={40} value={rootNode?.name ?? "Root"} disabled={disabled} aria-label={`Name for ${label}`} onChange={(event) => updateRoot(node.rootIndex, { name: event.target.value })} className="code-root-name" /><div className="code-root-actions"><button type="button" disabled={disabled || graphConditionCount >= MAX_TOTAL_CONDITIONS} onClick={() => {
                                const branch = newTreeBranch("if", defaultVariable, nextBranchOrder(rootNode.branches));
                                inheritNodeOffset(conditionGraphNodeId(branch.id, node.rootId), node.id);
                                updateRoot(node.rootIndex, { branches: [...(rootNode.branches ?? []), branch] });
                            }} className={`code-root-action code-root-action--conditional ${tutorialFocus === "add-condition" && !rootNode.branches?.length ? "tutorial-control-focus" : ""}`}>+ CONDITIONAL</button><button type="button" disabled={!canRemove} onClick={() => removeRootNode(node.rootIndex)} className="code-root-action code-root-action--remove">REMOVE</button></div>
                        </div>
                    </section>;
                })}
                {graph.conditions.map((node) => {
                    const branch = treeBranchAt(roots[node.rootIndex]?.branches, node.path);
                    if (!branch) return null;
                    return <GraphConditionNode key={node.id} {...{ node, branch, disabled, canRemove, stateVariables, defaultVariable, nodeOffsets, beginNodeDrag, tutorialFocus }} selected={selectedNodeIds.includes(node.id)} onSelect={(event) => selectGraphNode(event, node.id)} onPriorityChange={(priority) => { const reordered = setLogicBranchPriority(roots, node.rootIndex, node.path, priority); if (reordered !== roots) commitConfiguration({ ...configuration, roots: reordered }); }} onPickVariable={(rowIndex, operand) => openOperandPicker(node.rootIndex, node.path, rowIndex, operand)} onInspectVariable={(rowIndex, operand) => { setInspectedNode({ kind: "condition-variable", id: node.id, rowIndex, operand }); }} onUseRawNumber={(rowIndex) => { setInspectedNode((current) => current?.kind === "condition-variable" && current.id === node.id && current.rowIndex === rowIndex && current.operand === 2 ? null : current); updateBranch(node.rootIndex, node.path, (current) => ({ ...current, conditions: (current.conditions ?? []).map((condition, index) => { if (index !== rowIndex) return condition; const next = { ...condition, right: { type: "number", value: 0 } }; delete next.rightTarget; return next; }) })); }} onRemoveCondition={(rowIndex) => { const currentConditions = Array.isArray(branch.conditions) ? branch.conditions : []; if (currentConditions.length <= 1) { setInspectedNode(null); setSelectedNodeIds((current) => current.filter((id) => id !== node.id)); removeBranch(node.rootIndex, node.path); return; } setInspectedNode((current) => current?.kind === "condition-variable" && current.id === node.id ? null : current); updateBranch(node.rootIndex, node.path, (current) => ({ ...current, conditions: (current.conditions ?? []).filter((_, index) => index !== rowIndex) })); }} inspectedVariable={inspectedNode?.kind === "condition-variable" && inspectedNode.id === node.id ? inspectedNode : null} canAddAction={graphActionCount < MAX_LOGIC_BLOCKS} canAddCondition={graphConditionCount < MAX_TOTAL_CONDITIONS}
                        onChange={(updates) => updateBranch(node.rootIndex, node.path, (current) => ({ ...current, ...updates }))}
                        onRemove={() => removeBranch(node.rootIndex, node.path)}
                        onAddParentConditional={() => {
                            const parent = newTreeBranch(branch.branchType ?? "if", defaultVariable);
                            inheritNodeOffset(conditionGraphNodeId(parent.id, node.rootId), node.id);
                            commitConfiguration({ ...configuration, roots: insertParentLogicBranch(roots, node.rootIndex, node.path, parent) });
                        }}
                        onAddChildConditional={() => {
                            const child = newTreeBranch("if", defaultVariable, nextBranchOrder(branch.children));
                            inheritNodeOffset(conditionGraphNodeId(child.id, node.rootId), node.id);
                            updateBranch(node.rootIndex, node.path, (current) => ({ ...current, children: [...(current.children ?? []), child] }));
                        }}
                        onAddAction={() => openNodePicker({ type: "action", rootIndex: node.rootIndex, path: node.path })} />;
                })}
                {graph.actions.map((node) => {
                    const branch = treeBranchAt(roots[node.rootIndex]?.branches, node.path);
                    const actions = graphBranchActions(branch);
                    const entry = actions[node.actionIndex];
                    if (!branch || !entry) return null;
                    return <GraphActionNode key={node.id} {...{ node, entry, actions, branch, disabled, selectedLoadout, targetTypes, stateVariables, nodeOffsets, beginNodeDrag }} selectedNode={selectedNodeIds.includes(node.id)} onInspect={(event) => selectGraphNode(event, node.id, { kind: "action", id: node.id })} customVariables={configuration.customVariables ?? []}
                        onChange={(nextEntry) => updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.map((item, index) => index === node.actionIndex ? nextEntry : item)))}
                        onRemove={() => updateBranch(node.rootIndex, node.path, (current) => setGraphActions(current, actions.filter((_, index) => index !== node.actionIndex)))} />;
                })}
            </div>
            {!isSearchOpen && !isExternalConfigurationOpen && inspectedNode && <LogicNodeInspector inspectedNode={inspectedNode} graph={graph} roots={roots} stateVariables={stateVariables} targetTypes={targetTypes} selectedLoadout={selectedLoadout} customVariables={configuration.customVariables ?? []} disabled={disabled} canRemove={canRemove} onClose={() => setInspectedNode(null)} updateBranch={updateBranch} />}
        </div>
    );
});
