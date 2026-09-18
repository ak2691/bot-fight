import { useLayoutEffect, useRef, useState } from "react";
import {
    BOT_CODE_ACTIONS,
    BOT_CODE_SELECTABLES,
    CUSTOM_VARIABLE_OPERATIONS,
    createExpressionCondition,
    SELECTABLE_TYPES,
    VISIBLE_STATE_VARIABLES,
} from "../gameArena/botlogic/code/BotCode.js";
import { createCodeRoot } from "../gameArena/botlogic/code/configuration/configurationFactories.js";
import { encodeSandboxLoadout } from "../gameArena/loadout/BotLoadout.js";
import {
    buildLogicGraph,
    TutorialLogicInspector,
} from "../gameArena/coding/nodes/GraphNodes.jsx";
import { TUTORIAL_ACTIONS } from "./TutorialPresets.js";

const EMPTY_LOADOUT = encodeSandboxLoadout({ abilities: [] });
const FIREBALL_LOADOUT = encodeSandboxLoadout({ abilities: [TUTORIAL_ACTIONS.FIREBALL] });
const EMPTY_SET = new Set();

function branch(id, condition, actions = [], priority = 1, branchType = "if") {
    return {
        id,
        branchType,
        priority,
        conditions: [condition],
        actions,
        children: [],
    };
}

function makePreview(id, name, { priority = 1, condition = null, actions = [], branches = null, selectedLoadout = EMPTY_LOADOUT } = {}) {
    const rootBranches = branches ?? (condition ? [branch(`tutorial-preview-branch-${id}`, condition, actions)] : []);
    const root = {
        ...createCodeRoot(priority, name, `tutorial-preview-root-${id}`),
        branches: rootBranches,
    };
    const graph = buildLogicGraph([root], VISIBLE_STATE_VARIABLES, selectedLoadout, SELECTABLE_TYPES);
    return {
        root,
        roots: [root],
        graph,
        rootNode: graph.roots[0],
        branch: rootBranches[0] ?? null,
        conditionNode: graph.conditions[0] ?? null,
        actionNodes: graph.actions,
        selectedLoadout,
    };
}

function edgeKey(edge, index) {
    return edge.id ?? `${edge.fromId}-${edge.toId}-${index}`;
}

function AbstractNodeGroup({ type, nodes, registerNode }) {
    return (
        <div className={`tutorial-node-abstract__group tutorial-node-abstract__group--${type}`}>
            {nodes.map((node) => (
                <div
                    key={node.id}
                    ref={(element) => registerNode(node.id, element)}
                    className={`tutorial-node-abstract__node tutorial-node-abstract__node--${type}${node.active ? " tutorial-node-abstract__node--active" : ""}`}
                >
                    <span>{node.label}</span>
                    {node.status && <span className="tutorial-node-abstract__status">{node.status}</span>}
                </div>
            ))}
        </div>
    );
}

function AbstractGraphPreview({ rootNodes, conditionNodes, actionNodes, edges, evaluation = null }) {
    const groups = [
        { type: "root", nodes: rootNodes.map((node, index) => ({ id: node.id, label: `Root ${index + 1}` })) },
        { type: "conditional", nodes: conditionNodes.map((node, index) => ({
            id: node.id,
            label: `Conditional ${index + 1}`,
            status: evaluation?.conditionStatuses?.[node.id] ?? null,
        })) },
        { type: "action", nodes: actionNodes.map((node) => ({
            id: node.id,
            label: "Action",
            active: evaluation?.activeNodeIds?.has(node.id) ?? false,
        })) },
    ].filter((group) => group.nodes.length > 0);
    const containerRef = useRef(null);
    const nodeRefs = useRef(new Map());
    const highlightedEdgeIds = evaluation?.highlightedEdgeIds ?? EMPTY_SET;
    const edgeSignature = edges.map((edge, index) => `${edgeKey(edge, index)}:${edge.fromId}:${edge.toId}:${highlightedEdgeIds.has(edgeKey(edge, index))}`).join("|");
    const [wireState, setWireState] = useState({ width: 1, height: 1, paths: [] });

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        const updateWires = () => {
            const containerRect = container.getBoundingClientRect();
            const width = Math.max(container.clientWidth, container.scrollWidth, 1);
            const height = Math.max(container.clientHeight, container.scrollHeight, 1);
            const paths = edges.flatMap((edge, index) => {
                const source = nodeRefs.current.get(edge.fromId);
                const target = nodeRefs.current.get(edge.toId);
                if (!source || !target) return [];
                const sourceRect = source.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const startX = sourceRect.left - containerRect.left + sourceRect.width / 2;
                const startY = sourceRect.bottom - containerRect.top;
                const endX = targetRect.left - containerRect.left + targetRect.width / 2;
                const endY = targetRect.top - containerRect.top;
                const middleY = startY + (endY - startY) / 2;
                return [{
                    id: edgeKey(edge, index),
                    active: highlightedEdgeIds.has(edgeKey(edge, index)),
                    d: `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`,
                }];
            });
            setWireState((current) => {
                const unchanged = current.width === width
                    && current.height === height
                    && current.paths.length === paths.length
                    && current.paths.every((path, index) => path.id === paths[index].id && path.d === paths[index].d && path.active === paths[index].active);
                return unchanged ? current : { width, height, paths };
            });
        };

        updateWires();
        const hasWindow = typeof window !== "undefined";
        const frame = hasWindow ? window.requestAnimationFrame(updateWires) : null;
        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWires);
        resizeObserver?.observe(container);
        if (hasWindow) window.addEventListener("resize", updateWires);
        return () => {
            if (frame != null && hasWindow) window.cancelAnimationFrame(frame);
            resizeObserver?.disconnect();
            if (hasWindow) window.removeEventListener("resize", updateWires);
        };
    }, [edgeSignature, edges, highlightedEdgeIds]);

    const registerNode = (nodeId, element) => {
        if (element) nodeRefs.current.set(nodeId, element);
        else nodeRefs.current.delete(nodeId);
    };

    return (
        <div ref={containerRef} className="tutorial-node-abstract" role="img" aria-label="Abstract behavior tree example">
            <svg
                className="tutorial-node-abstract__wires"
                width={wireState.width}
                height={wireState.height}
                viewBox={`0 0 ${wireState.width} ${wireState.height}`}
                aria-hidden="true"
            >
                {wireState.paths.map((path) => (
                    <path
                        key={path.id}
                        className={`tutorial-node-abstract__wire${path.active ? " tutorial-node-abstract__wire--active" : ""}`}
                        d={path.d}
                        fill="none"
                        strokeWidth={path.active ? "3" : "2"}
                        strokeLinecap="round"
                    />
                ))}
            </svg>
            <div className="tutorial-node-abstract__stages">
                {groups.map((group) => (
                    <div key={group.type} className="tutorial-node-abstract__stage">
                        <AbstractNodeGroup type={group.type} nodes={group.nodes} registerNode={registerNode} />
                    </div>
                ))}
            </div>
            {evaluation && (
                <div className="tutorial-node-abstract__evaluation" role="note">
                    <p>Conditional 1 is true. Conditional 2 is true.</p>
                    <p>Only the action connected to Conditional 1 gets executed.</p>
                </div>
            )}
        </div>
    );
}

function GraphPreview({ preview, includeActions = false, demonstrateEvaluation = false }) {
    const rootNodes = preview.graph.roots;
    const conditionNodes = preview.graph.conditions;
    const actionNodes = includeActions ? preview.graph.actions : [];
    const visibleNodes = [...rootNodes, ...conditionNodes, ...actionNodes].filter(Boolean);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const edges = preview.graph.edges.filter((edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId));
    const evaluation = demonstrateEvaluation && conditionNodes.length >= 2
        ? (() => {
            const selectedCondition = conditionNodes[0];
            const selectedEdges = edges.filter((edge) => edge.fromId === selectedCondition.id);
            return {
                conditionStatuses: Object.fromEntries(conditionNodes.slice(0, 2).map((node) => [node.id, "TRUE"])),
                highlightedEdgeIds: new Set(selectedEdges.map((edge, index) => edgeKey(edge, edges.indexOf(edge) >= 0 ? edges.indexOf(edge) : index))),
                activeNodeIds: new Set(selectedEdges.map((edge) => edge.toId)),
            };
        })()
        : null;
    return (
        <AbstractGraphPreview
            rootNodes={rootNodes}
            conditionNodes={conditionNodes}
            actionNodes={actionNodes}
            edges={edges}
            evaluation={evaluation}
        />
    );
}

function distanceCondition(comparator, value) {
    return {
        ...createExpressionCondition("selectable.distance", SELECTABLE_TYPES),
        comparator,
        right: { type: "number", value },
        selectable1: BOT_CODE_SELECTABLES.MY,
        selectable2: BOT_CODE_SELECTABLES.OPPONENT,
    };
}

function walkAction(direction = 0) {
    return {
        action: BOT_CODE_ACTIONS.MOVE_WALK,
        movementMode: "target",
        movementDirection: direction,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
    };
}

function fireballAction() {
    return {
        action: TUTORIAL_ACTIONS.FIREBALL,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
    };
}

function VisualFigure({ children, className = "" }) {
    return <figure className={`tutorial-node-visual ${className}`}>
        {children}
    </figure>;
}

function rootPriorityPreview() {
    const roots = [
        { ...createCodeRoot(1, "Emergency rule", "tutorial-preview-root-priority-one"), branches: [] },
        { ...createCodeRoot(2, "Attack rule", "tutorial-preview-root-priority-two"), branches: [] },
    ];
    const graph = buildLogicGraph(roots, VISIBLE_STATE_VARIABLES, EMPTY_LOADOUT, SELECTABLE_TYPES);
    return {
        root: roots[0],
        roots,
        graph,
        rootNode: graph.roots[0],
        branch: null,
        conditionNode: null,
        actionNodes: [],
        selectedLoadout: EMPTY_LOADOUT,
    };
}

function RootPriorityVisual() {
    return <VisualFigure>
        <GraphPreview preview={rootPriorityPreview()} />
    </VisualFigure>;
}

function distanceTreePreview() {
    return makePreview("distance-tree", "Distance plan", {
        branches: [
            branch("distance-far", distanceCondition("gt", 432), [walkAction(0)], 1, "if"),
            branch("distance-close", distanceCondition("lte", 432), [walkAction(180), fireballAction()], 2, "else_if"),
        ],
        selectedLoadout: FIREBALL_LOADOUT,
    });
}

function ConditionalExamplesVisual() {
    return <VisualFigure>
        <GraphPreview preview={distanceTreePreview()} />
    </VisualFigure>;
}

function ActionExamplesVisual() {
    return <VisualFigure>
        <GraphPreview preview={distanceTreePreview()} includeActions demonstrateEvaluation />
    </VisualFigure>;
}

function entityHpCondition() {
    return {
        ...createExpressionCondition("selectable.hp", SELECTABLE_TYPES),
        comparator: "lte",
        right: { type: "number", value: 100 },
        leftSelectable: BOT_CODE_SELECTABLES.MY,
    };
}

function abilityCooldownCondition() {
    return {
        ...createExpressionCondition("bot.selectedAbilityCooldownMs", SELECTABLE_TYPES),
        comparator: "gt",
        right: { type: "number", value: 0 },
        ability: TUTORIAL_ACTIONS.FIREBALL,
        leftSelectable: BOT_CODE_SELECTABLES.MY,
    };
}

function rotateFaceTargetAction() {
    return {
        action: BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET,
        targetMode: "target",
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        targetOffsetX: 0,
        targetOffsetY: 0,
    };
}

function ConfigurationExamplesVisual() {
    return <VisualFigure className="tutorial-node-visual--configuration">
        <div className="tutorial-config-preview">
            <TutorialLogicInspector kind="condition" condition={entityHpCondition()} />
            <TutorialLogicInspector kind="condition" condition={abilityCooldownCondition()} selectedLoadout={FIREBALL_LOADOUT} />
            <TutorialLogicInspector kind="action" action={rotateFaceTargetAction()} />
        </div>
    </VisualFigure>;
}

function customNumberAction() {
    return {
        action: BOT_CODE_ACTIONS.VARIABLE,
        variableId: "custom.variable-1",
        terms: [
            { operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "number", value: 32 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 35 } },
        ],
    };
}

function customBooleanAction() {
    return {
        action: BOT_CODE_ACTIONS.VARIABLE,
        variableId: "custom.boolean-1",
        operation: CUSTOM_VARIABLE_OPERATIONS.SET,
        value: false,
    };
}

function CustomVariableExamplesVisual() {
    return <VisualFigure className="tutorial-node-visual--configuration">
        <div className="tutorial-config-preview">
            <TutorialLogicInspector
                kind="action"
                action={customNumberAction()}
                customVariables={[{ id: "custom.variable-1", name: "Variable 1", valueType: "number", initialValue: 0 }]}
            />
            <TutorialLogicInspector
                kind="action"
                action={customBooleanAction()}
                customVariables={[{ id: "custom.boolean-1", name: "Boolean 1", valueType: "boolean", initialValue: false }]}
            />
        </div>
    </VisualFigure>;
}

export default function TutorialNodeVisual({ kind }) {
    if (kind === "root-priorities") return <RootPriorityVisual />;
    if (kind === "conditional-examples") return <ConditionalExamplesVisual />;
    if (kind === "action-examples") return <ActionExamplesVisual />;
    if (kind === "configuration-examples") return <ConfigurationExamplesVisual />;
    if (kind === "custom-variable-examples") return <CustomVariableExamplesVisual />;
    return null;
}
