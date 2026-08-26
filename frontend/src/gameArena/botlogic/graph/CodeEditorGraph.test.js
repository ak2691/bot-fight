import assert from "node:assert/strict";
import test from "node:test";
import {
    CODE_EDITOR_GRAPH_VERSION,
    canConnectCodeEditorPorts,
    compileCodeEditorGraph,
    connectCodeEditorPorts,
    conditionOperandPortId,
    createCodeEditorGraph,
    editorGraphForConfiguration,
    editorGraphNodeLabel,
    graphFromCodeConfiguration,
    reconcileCodeEditorGraph,
    sanitizeCodeEditorGraph,
    variableTargetPortId,
} from "./CodeEditorGraph.js";
import { normalizeAbilityStrategyConfiguration, STATE_VARIABLES } from "../code/BotCode.js";

function configuration(condition, action = { action: "move_walk", movementMode: "target", movementDirection: 0, selectable: "opponent" }) {
    return {
        version: "bot-logic-tree-v1",
        roots: [{ branches: [{ id: "branch", branchType: "if", conditions: [condition], actions: [action], children: [] }] }],
        customVariables: [],
    };
}

test("editor graph starts empty instead of spawning nodes from the payload", () => {
    const source = configuration({ type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "variable", value: "selectable.hp" }, rightSelectable: "opponent" });
    const graph = graphFromCodeConfiguration(source);
    assert.deepEqual(graph, { version: CODE_EDITOR_GRAPH_VERSION, variables: [], targets: [], connections: [] });
    assert.deepEqual(editorGraphForConfiguration(source), graph);

    const compiled = compileCodeEditorGraph(source, graph);
    assert.deepEqual(normalizeAbilityStrategyConfiguration(compiled).roots[0].branches[0].conditions[0], normalizeAbilityStrategyConfiguration(source).roots[0].branches[0].conditions[0]);
    assert.equal(normalizeAbilityStrategyConfiguration(compiled).editorGraph, undefined);
});

test("compact editor chips preserve bounded user-facing names without changing semantics", () => {
    const graph = sanitizeCodeEditorGraph({
        ...createCodeEditorGraph(),
        variables: [{ id: "variable", kind: "variable", name: "My health", variableId: "selectable.hp" }],
        targets: [{ id: "target", kind: "target", name: "Target 1", targetKind: "entity", target: "opponent" }],
    });

    assert.equal(editorGraphNodeLabel(graph.variables[0], STATE_VARIABLES), "My health");
    assert.equal(editorGraphNodeLabel(graph.targets[0], STATE_VARIABLES), "Target 1");
    assert.equal(graph.variables[0].variableId, "selectable.hp");
    assert.equal(graph.targets[0].target, "opponent");
});

test("a literal remains inline while a connected variable replaces only operand two", () => {
    const source = configuration({ type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "number", value: 30 } });
    const graph = editorGraphForConfiguration(source);
    const variable = { id: "variable-opponent", kind: "variable", variableId: "selectable.hp" };
    const nextGraph = { ...graph, variables: [...graph.variables, variable] };
    const connected = connectCodeEditorPorts(nextGraph, variable.id, conditionOperandPortId("branch", 0, 2), "operand-2", STATE_VARIABLES);
    const compiled = compileCodeEditorGraph(source, connected);
    assert.deepEqual(compiled.roots[0].branches[0].conditions[0].right, { type: "variable", value: "selectable.hp" });
});

test("boolean variables stay on the boolean True/False comparison and cannot feed numeric operand two", () => {
    const source = configuration({ type: "expression", left: "selectable.alive", comparator: "eq", right: { type: "boolean", value: true } }, { action: "lock_on", selectable: "opponent" });
    const booleanNode = { id: "boolean-node", kind: "variable", variableId: "selectable.alive" };
    const graph = { ...createCodeEditorGraph(), variables: [booleanNode] };
    assert.equal(canConnectCodeEditorPorts(graph, booleanNode.id, conditionOperandPortId("branch", 0, 2), "operand-2", STATE_VARIABLES), false);
    assert.deepEqual(normalizeAbilityStrategyConfiguration(source).roots[0].branches[0].conditions[0].right, { type: "boolean", value: true });
});

test("connections use named ports and reject ambiguous duplicates", () => {
    const source = configuration({ type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "number", value: 30 } });
    const graph = editorGraphForConfiguration(source);
    const first = { id: "variable-first", kind: "variable", variableId: "selectable.hp" };
    const second = { id: "variable-second", kind: "variable", variableId: "selectable.hp" };
    const withNodes = { ...graph, variables: [...graph.variables, first, second] };
    const connectedFirst = connectCodeEditorPorts(withNodes, first.id, conditionOperandPortId("branch", 0, 1), "operand-1", STATE_VARIABLES);
    const connectedSecond = connectCodeEditorPorts(connectedFirst, second.id, conditionOperandPortId("branch", 0, 1), "operand-1", STATE_VARIABLES);
    assert.equal(connectedSecond.connections.filter((connection) => connection.targetId === conditionOperandPortId("branch", 0, 1)).length, 1);
    assert.equal(connectedSecond.connections.find((connection) => connection.targetId === conditionOperandPortId("branch", 0, 1)).sourceId, second.id);
});

test("action targets compile from a target node without changing normalized action semantics", () => {
    const source = configuration({ type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "number", value: 30 } });
    const graph = { ...createCodeEditorGraph(), targets: [{ id: "target-node", kind: "target", targetKind: "entity", target: "opponent" }] };
    const changed = connectCodeEditorPorts(graph, "target-node", "action:branch:0:target", "target", STATE_VARIABLES);
    const compiled = compileCodeEditorGraph(source, changed);
    assert.equal(normalizeAbilityStrategyConfiguration(compiled).roots[0].branches[0].actions[0].selectable, "opponent");
});

test("movement target connections do not copy target offsets", () => {
    const source = configuration(
        { type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "number", value: 30 } },
        { action: "move_walk", movementMode: "target", movementDirection: 90, selectable: "opponent", targetOffsetX: 25, targetOffsetY: -15 },
    );
    const graph = {
        ...createCodeEditorGraph(),
        targets: [{ id: "target-node", kind: "target", targetKind: "entity", target: "opponent", targetOffsetX: 80, targetOffsetY: -60 }],
    };
    const connected = connectCodeEditorPorts(graph, "target-node", "action:branch:0:target", "target", STATE_VARIABLES);
    const compiled = compileCodeEditorGraph(source, connected);
    const normalized = normalizeAbilityStrategyConfiguration(compiled).roots[0].branches[0].actions[0];

    assert.equal(normalized.movementDirection, 90);
    assert.equal("targetOffsetX" in normalized, false);
    assert.equal("targetOffsetY" in normalized, false);
});

test("target nodes connect to target-aware variables and actions, never conditionals", () => {
    const source = configuration({ type: "expression", left: "selectable.distance", comparator: "lt", right: { type: "number", value: 30 }, leftSelectable: "opponent" });
    const graph = {
        ...createCodeEditorGraph(),
        variables: [{ id: "variable-node", kind: "variable", variableId: "selectable.distance" }],
        targets: [{ id: "target-node", kind: "target", targetKind: "entity", target: "opponent_gravity_zone" }],
    };
    const variableConnection = connectCodeEditorPorts(graph, "variable-node", conditionOperandPortId("branch", 0, 1), "operand-1", STATE_VARIABLES);
    const targetConnection = connectCodeEditorPorts(variableConnection, "target-node", variableTargetPortId("variable-node"), "target", STATE_VARIABLES);
    const actionConnection = connectCodeEditorPorts(targetConnection, "target-node", "action:branch:0:target", "target", STATE_VARIABLES);
    assert.ok(actionConnection);
    assert.equal(canConnectCodeEditorPorts(actionConnection, "target-node", "condition:branch:row:0:target-1", "target-1", STATE_VARIABLES), false);

    const reconciled = reconcileCodeEditorGraph(source, actionConnection);
    const compiled = compileCodeEditorGraph(source, reconciled);
    const normalized = normalizeAbilityStrategyConfiguration(compiled);
    assert.equal(normalized.roots[0].branches[0].conditions[0].left, "selectable.distance");
    assert.equal(normalized.roots[0].branches[0].conditions[0].selectable1, "opponent_gravity_zone");
    assert.equal(normalized.roots[0].branches[0].actions[0].selectable, "opponent_gravity_zone");
});
