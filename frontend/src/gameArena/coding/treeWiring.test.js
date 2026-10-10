import assert from "node:assert/strict";
import test from "node:test";
import { brainFromEditorRoots, editorRootsFor, wireNodes, canWireNodes, wireBlockReason, disconnectNode, removeRootKeepingChildren } from "./treeWiring.js";
import { normalizeAbilityStrategyConfiguration, selectAbilityStrategyActionPlan as selectAbilityStrategyActionPlanNormalized } from "../../../../shared/engine/botlogic/code/BotCode.js";
import { graphEdgePath } from "./graphEdgeGeometry.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../../../shared/engine/botlogic/code/BotCode.js";

// The engine takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const selectAbilityStrategyActionPlan = (configuration, ...rest) => selectAbilityStrategyActionPlanNormalized(normalizeBrainForTick(configuration), ...rest);

function fixture() {
    const brain = { roots: [{ id: "r", branches: [{ id: "b", conditions: [{ type: "always" }], actions: [], children: [{ id: "c", actions: [], conditions: [], children: [] }] }] }],
        orphans: [{ id: "loose", kind: "action", action: "move_walk" }] };
    return { brain, roots: editorRootsFor(brain), root: { id: "rootNode:r", rootIndex: 0 }, branch: { id: "condition:b:root:r", branchId: "b", rootId: "r", rootIndex: 0, path: [0] },
        child: { id: "condition:c:root:r", rootIndex: 0, path: [0, 0] }, action: { id: "loose", rootIndex: 1, rootId: "orphan-wrapper:loose", path: [0], actionIndex: 0 } };
}
test("wiring an orphan action to a root stores root actions and removes its old input", () => {
    const { brain, roots, root, action } = fixture();
    const connected = brainFromEditorRoots(brain, wireNodes(roots, root, action));
    assert.equal(connected.roots[0].actions[0].id, "loose");
    assert.equal(connected.orphans.length, 0);
    assert.equal(brain.orphans.length, 1, "edits never mutate the previous history entry");
});
test("disconnect preserves the full subtree and reconnect replaces its one parent", () => {
    const { brain, roots, branch, root } = fixture();
    const detached = disconnectNode(roots, branch);
    const saved = brainFromEditorRoots(brain, detached);
    assert.equal(saved.roots[0].branches.length, 0);
    assert.equal(saved.orphans[1].children.length, 1);
    const child = { ...branch, rootIndex: 2, path: [0], id: saved.orphans[1].id };
    const connected = brainFromEditorRoots(brain, wireNodes(detached, root, child));
    assert.equal(connected.roots[0].branches.length, 1);
    assert.equal(connected.roots[0].branches[0].children.length, 1);
    assert.equal(connected.orphans.length, 1);
});
test("cycles and action outputs cannot be connected", () => {
    const { roots, branch, child, action } = fixture();
    assert.equal(canWireNodes(roots, child, branch), false);
    assert.equal(canWireNodes(roots, branch, branch), false);
    assert.equal(canWireNodes(roots, action, branch), false);
});
test("wire endpoints use measured frame edges instead of estimated heights at any zoom", () => {
    const edge = { fromId: "p", toId: "c", x1: 0, y1: 0, x2: 0, y2: 0 };
    const path = graphEdgePath(edge, { p: { x: 999, y: 999 } }, { p: { x: 20, y: 30, width: 100, height: 67 }, c: { x: 200, y: 250, width: 80, height: 50 } });
    assert.equal(path, "M 70 97 C 70 167, 240 180, 240 250");
});


test("disconnecting a normalized branch's last action does not resurrect its legacy action", () => {
    const brain = normalizeAbilityStrategyConfiguration({ roots: [{ id: "r", branches: [{ id: "node-b", conditions: [{ type: "always" }], actions: [{ id: "node-a", action: "move_walk" }] }] }] });
    const next = brainFromEditorRoots(brain, disconnectNode(editorRootsFor(brain), { id: "node-a", rootId: "r", rootIndex: 0, path: [0], actionIndex: 0 }));
    const saved = normalizeAbilityStrategyConfiguration(next);
    assert.equal(saved.roots[0].branches[0].action, "none");
    assert.equal(saved.orphans[0].action, "move_walk");
    assert.equal(selectAbilityStrategyActionPlan(saved, { playerModel: { hp: 100 }, objects: [] }).movement, undefined);
});


test("connecting to an empty normalized conditional replaces its N/A placeholder", () => {
    const brain = normalizeAbilityStrategyConfiguration({ roots: [{ id: "r", branches: [{ id: "b", conditions: [{ type: "always" }], actions: [{ action: "none" }] }] }], orphans: [{ id: "a", kind: "action", action: "move_walk" }] });
    const roots = editorRootsFor(brain);
    const next = wireNodes(roots, { id: "condition:b:root:r", rootIndex: 0, path: [0] }, { id: "a", rootIndex: 1, path: [0], actionIndex: 0 });
    assert.equal(next[0].branches[0].actions.length, 1);
    assert.equal(next[0].branches[0].actions[0].action, "move_walk");
    const detached = brainFromEditorRoots(brain, disconnectNode(next, { id: "a", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 }));
    assert.equal(detached.roots[0].branches[0].actions.length, 0);
    assert.equal(detached.orphans[0].action, "move_walk");
});

test("an action has one input: wiring a connected action from a new parent moves it, in either order", () => {
    const brain = { roots: [{ id: "r", branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [] },
        { id: "b2", conditions: [{ type: "always" }], actions: [], children: [] },
    ] }], orphans: [] };
    const roots = editorRootsFor(brain);
    const second = { id: "condition:b2:root:r", rootIndex: 0, path: [1] };
    const action = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    assert.equal(canWireNodes(roots, second, action), true);
    const moved = brainFromEditorRoots(brain, wireNodes(roots, second, action));
    assert.equal(moved.roots[0].branches[0].actions.length, 0);
    assert.equal(moved.roots[0].branches[1].actions.length, 1);
});

test("refused connections explain why", () => {
    const { roots, root, branch, child, action } = fixture();
    assert.equal(wireBlockReason(roots, branch, child), null);
    assert.equal(wireBlockReason(roots, child, branch), "That would create a loop");
    assert.equal(wireBlockReason(roots, branch, branch), "A node can't connect to itself");
    assert.equal(wireBlockReason(roots, action, branch), "Actions have no output");
    const brain = { roots: [{ id: "r", branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [] },
        { id: "b2", conditions: [{ type: "always" }], actions: [{ id: "a2", action: "move_walk" }], children: [] },
    ] }], orphans: [] };
    const second = { id: "condition:b2:root:r", rootIndex: 0, path: [1] };
    const walk = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    assert.equal(wireBlockReason(editorRootsFor(brain), second, walk), "This conditional already has a Move action");
    assert.equal(wireNodes(editorRootsFor(brain), second, walk), null);
    assert.equal(wireBlockReason(roots, root, action), null);
});

test("a wired conditional is inserted among its siblings by X, with ELSE last, and priorities renumbered", () => {
    const brain = { roots: [{ id: "r", branches: [
        { id: "left", conditions: [{ type: "always" }], actions: [], children: [] },
        { id: "right", conditions: [{ type: "always" }], actions: [], children: [] },
        { id: "other", branchType: "else", conditions: [], actions: [], children: [] },
    ] }], orphans: [{ id: "mid", kind: "conditional", conditions: [{ type: "always" }], actions: [], children: [] }] };
    const roots = editorRootsFor(brain);
    const xs = { left: 100, right: 500, mid: 300, other: 900 };
    const wired = wireNodes(roots, { id: "rootNode:r", rootIndex: 0 }, { id: "mid", rootIndex: 1, path: [0] }, { xOf: (branch) => xs[branch.id] });
    const saved = brainFromEditorRoots(brain, wired).roots[0].branches;
    assert.deepEqual(saved.map((branch) => branch.id), ["left", "mid", "right", "other"]);
    assert.deepEqual(saved.map((branch) => branch.priority), [1, 2, 3, 4]);
    assert.equal(saved.at(-1).branchType, "else");
    const farRight = wireNodes(roots, { id: "rootNode:r", rootIndex: 0 }, { id: "mid", rootIndex: 1, path: [0] }, { xOf: () => 2000 });
    assert.deepEqual(brainFromEditorRoots(brain, farRight).roots[0].branches.map((branch) => branch.id), ["left", "right", "mid", "other"]);
});

test("an action whose ability is not equipped can still be wired and disconnected", () => {
    const brain = { roots: [{ id: "r", branches: [{ id: "b", conditions: [{ type: "always" }], actions: [], children: [] }] }],
        orphans: [{ id: "ghost", kind: "action", action: "removed_ability" }] };
    const roots = editorRootsFor(brain);
    const ghost = { id: "ghost", rootIndex: 1, path: [0], actionIndex: 0 };
    const parent = { id: "condition:b:root:r", rootIndex: 0, path: [0] };
    const wired = wireNodes(roots, parent, ghost);
    assert.equal(wired[0].branches[0].actions[0].action, "removed_ability");
    assert.ok(disconnectNode(wired, { id: "ghost", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 }));
});

test("deleting a root orphans its conditionals and root actions instead of deleting them", () => {
    const brain = { roots: [{ id: "r", actions: [{ id: "ra", action: "move_walk" }], branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [{ id: "c1", conditions: [], actions: [], children: [] }] },
        { id: "b2", conditions: [{ type: "always" }], actions: [], children: [] },
    ] }, { id: "other", branches: [] }], orphans: [] };
    const saved = brainFromEditorRoots(brain, removeRootKeepingChildren(editorRootsFor(brain), 0));
    assert.deepEqual(saved.roots.map((root) => root.id), ["other"]);
    assert.deepEqual(saved.orphans.map((node) => node.id).sort(), ["b1", "b2", "ra"]);
    assert.equal(saved.orphans.find((node) => node.id === "b1").children.length, 1);
    assert.equal(saved.orphans.find((node) => node.id === "b1").actions[0].id, "a1");
});
