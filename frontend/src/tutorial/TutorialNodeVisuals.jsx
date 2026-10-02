import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
    GraphActionNode,
    GraphConditionNode,
    GraphRootNode,
    graphBranchActions,
    graphEdgePath,
    TutorialLogicInspector,
} from "../gameArena/coding/nodes/GraphNodes.jsx";
import { TUTORIAL_ACTIONS } from "./TutorialPresets.js";

const EMPTY_LOADOUT = encodeSandboxLoadout({ abilities: [] });
const FIREBALL_LOADOUT = encodeSandboxLoadout({ abilities: [TUTORIAL_ACTIONS.FIREBALL] });
const NOOP = () => {};
const CANVAS_PADDING = 28;
// buildLogicGraph places first-level conditionals at y=300 (below a tall root gap);
// the tutorial pulls them up so small diagrams stay compact.
const FIRST_LEVEL_Y = 300;
const COMPACT_GAP_AFTER_ROOT = 70;

function branch(id, condition, actions = [], priority = 1, branchType = "if") {
    return {
        id,
        branchType,
        priority,
        conditions: branchType === "else" || !condition ? [] : [condition],
        actions,
        children: [],
    };
}

function makeRoots(specs) {
    return specs.map(({ id, name, priority = 1, branches = [] }) => ({
        ...createCodeRoot(priority, name, `tutorial-preview-root-${id}`),
        branches,
    }));
}

/** Lay the real workspace graph out tightly: drop the root gap and crop to the nodes. */
function buildStaticLayout(roots, selectedLoadout, { showActions }) {
    const graph = buildLogicGraph(roots, VISIBLE_STATE_VARIABLES, selectedLoadout, SELECTABLE_TYPES);
    const conditions = graph.conditions;
    const actions = showActions ? graph.actions : [];
    const rootNodes = graph.roots;
    const rootBottom = Math.max(...rootNodes.map((node) => node.y + node.height));
    const pull = FIRST_LEVEL_Y - (rootBottom + COMPACT_GAP_AFTER_ROOT);
    const moved = (node) => (node.y >= FIRST_LEVEL_Y ? { ...node, y: node.y - pull } : { ...node });
    const nodes = [...rootNodes.map(moved), ...conditions.map(moved), ...actions.map(moved)];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const shift = (node) => ({ ...node, x: node.x - minX + CANVAS_PADDING, y: node.y - minY + CANVAS_PADDING });
    const shiftedById = new Map([...byId].map(([id, node]) => [id, shift(node)]));
    const pick = (list) => list.map((node) => shiftedById.get(node.id)).filter(Boolean);
    const edges = graph.edges.flatMap((edge) => {
        const from = shiftedById.get(edge.fromId);
        const to = shiftedById.get(edge.toId);
        if (!from || !to) return [];
        return [{ ...edge, x1: from.x + from.width / 2, y1: from.y + from.height, x2: to.x + to.width / 2, y2: to.y }];
    });
    const shifted = [...shiftedById.values()];
    return {
        roots: pick(rootNodes),
        conditions: pick(conditions),
        actions: pick(actions),
        edges,
        width: Math.max(...shifted.map((node) => node.x + node.width)) + CANVAS_PADDING,
        height: Math.max(...shifted.map((node) => node.y + node.height)) + CANVAS_PADDING,
    };
}

function siblingInfo(rootBranches, path) {
    let siblings = rootBranches;
    for (let index = 0; index < path.length - 1; index += 1) siblings = siblings?.[path[index]]?.children;
    const position = path[path.length - 1] ?? 0;
    return { rank: position + 1, siblingCount: siblings?.length ?? 1 };
}

function branchAt(rootBranches, path) {
    let current = rootBranches?.[path[0]];
    for (let index = 1; current && index < path.length; index += 1) current = current.children?.[path[index]];
    return current;
}

/**
 * Static, non-interactive render of the real workspace nodes on the dotted canvas.
 * Scales down to fit narrow columns; `inert` keeps every control out of the tab order.
 */
function StaticTree({ roots, selectedLoadout = EMPTY_LOADOUT, showActions = true, caption, label }) {
    const layout = useMemo(() => buildStaticLayout(roots, selectedLoadout, { showActions }), [roots, selectedLoadout, showActions]);
    const frameRef = useRef(null);
    const [scale, setScale] = useState(1);

    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        const update = () => {
            const available = frame.clientWidth;
            setScale(available > 0 ? Math.min(1, available / layout.width) : 1);
        };
        update();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        observer?.observe(frame);
        return () => observer?.disconnect();
    }, [layout.width]);

    return (
        <figure className="tutorial-node-visual tutorial-node-visual--graph">
            <div ref={frameRef} className="tutorial-graph-frame" style={{ height: layout.height * scale }} role="img" aria-label={label ?? caption}>
                <div
                    className="tutorial-graph-canvas bg-[#171b20] bg-[radial-gradient(circle,rgba(100,116,139,.24)_1px,transparent_1px)] bg-[size:20px_20px]"
                    style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}
                    inert
                >
                    <svg className="pointer-events-none absolute inset-0 overflow-hidden" width={layout.width} height={layout.height} aria-hidden="true">
                        {layout.edges.map((edge) => <path key={edge.id} d={graphEdgePath(edge)} fill="none" stroke="rgba(165,180,252,.72)" strokeWidth="2" />)}
                    </svg>
                    {layout.roots.map((node) => {
                        const root = roots[node.rootIndex];
                        return <GraphRootNode
                            key={node.id}
                            node={node}
                            rootNode={root}
                            nodeOffsets={{}}
                            disabled
                            canRemove={false}
                            rank={node.rootIndex + 1}
                            siblingCount={roots.length}
                            graphConditionCount={0}
                            maxTotalConditions={0}
                        />;
                    })}
                    {layout.conditions.map((node) => {
                        const root = roots[node.rootIndex];
                        const nodeBranch = branchAt(root.branches, node.path);
                        if (!nodeBranch) return null;
                        const { rank, siblingCount } = siblingInfo(root.branches, node.path);
                        return <GraphConditionNode
                            key={node.id}
                            node={node}
                            branch={nodeBranch}
                            disabled
                            canRemove={false}
                            canAddAction={false}
                            canAddCondition={false}
                            stateVariables={VISIBLE_STATE_VARIABLES}
                            defaultVariable={VISIBLE_STATE_VARIABLES[0]}
                            selectableTypes={SELECTABLE_TYPES}
                            nodeOffsets={{}}
                            beginNodeDrag={NOOP}
                            selected={false}
                            rank={rank}
                            siblingCount={siblingCount}
                            onSelect={NOOP}
                            onChange={NOOP}
                            onRemove={NOOP}
                            onRemoveCondition={NOOP}
                        />;
                    })}
                    {layout.actions.map((node) => {
                        const root = roots[node.rootIndex];
                        const nodeBranch = branchAt(root.branches, node.path);
                        const entry = graphBranchActions(nodeBranch)[node.actionIndex];
                        if (!entry) return null;
                        return <GraphActionNode
                            key={node.id}
                            node={node}
                            entry={entry}
                            disabled
                            canRemove={false}
                            selectedLoadout={selectedLoadout}
                            selectableTypes={SELECTABLE_TYPES}
                            stateVariables={VISIBLE_STATE_VARIABLES}
                            nodeOffsets={{}}
                            beginNodeDrag={NOOP}
                            selectedNode={false}
                            onInspect={NOOP}
                            onRemove={NOOP}
                        />;
                    })}
                </div>
            </div>
            {caption && <figcaption className="tutorial-node-visual__caption">{caption}</figcaption>}
        </figure>
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

const ROOT_PRIORITY_ROOTS = makeRoots([
    { id: "priority-one", name: "Emergency rule", priority: 1 },
    { id: "priority-two", name: "Attack rule", priority: 2 },
]);

const DISTANCE_TREE_ROOTS = makeRoots([{
    id: "distance-tree",
    name: "Distance plan",
    branches: [
        branch("distance-far", distanceCondition("gt", 432), [walkAction(0)], 1, "if"),
        branch("distance-close", distanceCondition("lte", 432), [walkAction(180), fireballAction()], 2, "else_if"),
    ],
}]);

function RootPriorityVisual() {
    return <StaticTree
        roots={ROOT_PRIORITY_ROOTS}
        caption="Roots run left to right. The badge shows each root's priority: 1 goes first."
        label="Two root nodes, Emergency rule with priority 1 and Attack rule with priority 2"
    />;
}

function ConditionalExamplesVisual() {
    return <StaticTree
        roots={DISTANCE_TREE_ROOTS}
        selectedLoadout={FIREBALL_LOADOUT}
        showActions={false}
        caption="The IF branch is checked first. The ELSE IF branch is only checked when the IF is false."
        label="A root with an IF and an ELSE IF conditional comparing distance to 432"
    />;
}

function ActionExamplesVisual() {
    return <StaticTree
        roots={DISTANCE_TREE_ROOTS}
        selectedLoadout={FIREBALL_LOADOUT}
        caption="Actions hang below the conditional that selects them. Only the first true branch's actions run."
        label="The same tree with its walk and fireball action nodes"
    />;
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

function PanelFigure({ children, caption }) {
    return <figure className="tutorial-node-visual tutorial-node-visual--configuration">
        <div className="tutorial-config-preview">{children}</div>
        {caption && <figcaption className="tutorial-node-visual__caption">{caption}</figcaption>}
    </figure>;
}

function ConfigurationExamplesVisual() {
    return <PanelFigure caption="The side panel for a variable, an ability variable and an action. Each asks which entity (or ability) to look at.">
        <TutorialLogicInspector kind="condition" condition={entityHpCondition()} />
        <TutorialLogicInspector kind="condition" condition={abilityCooldownCondition()} selectedLoadout={FIREBALL_LOADOUT} />
        <TutorialLogicInspector kind="action" action={rotateFaceTargetAction()} />
    </PanelFigure>;
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
    return <PanelFigure caption="Modify custom variable sets, adds to or subtracts from a number, or sets a true/false value.">
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
    </PanelFigure>;
}

export default function TutorialNodeVisual({ kind }) {
    if (kind === "root-priorities") return <RootPriorityVisual />;
    if (kind === "conditional-examples") return <ConditionalExamplesVisual />;
    if (kind === "action-examples") return <ActionExamplesVisual />;
    if (kind === "configuration-examples") return <ConfigurationExamplesVisual />;
    if (kind === "custom-variable-examples") return <CustomVariableExamplesVisual />;
    return null;
}
