import assert from "node:assert/strict";
import test from "node:test";
import { brainFromEditorRoots, editorRootsFor, wireNodes, canWireNodes, wireBlockReason, disconnectNode, removeRootKeepingChildren, inputBarBehavior, parentCount, linkIdOf, removeLinkedCopies, sharedDeletePrompt, syncLinkedActions, linkedChangeBlockReason } from "./treeWiring.js";
import { isLinkId } from "../../../../shared/engine/botlogic/code/configuration/linkedActions.js";
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

test("wiring a connected action under another parent adds a parent instead of moving it", () => {
    const brain = { roots: [{ id: "r", branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [] },
        { id: "b2", conditions: [{ type: "always" }], actions: [], children: [] },
    ] }], orphans: [] };
    const roots = editorRootsFor(brain);
    const second = { id: "condition:b2:root:r", rootIndex: 0, path: [1] };
    const action = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    assert.equal(canWireNodes(roots, second, action), true);
    const added = brainFromEditorRoots(brain, wireNodes(roots, second, action));
    const first = added.roots[0].branches[0].actions[0];
    const copy = added.roots[0].branches[1].actions[0];
    assert.equal(first.id, "a1", "the original keeps its id");
    assert.ok(isLinkId(first.linkId));
    assert.equal(copy.linkId, first.linkId);
    assert.notEqual(copy.id, first.id);
    assert.deepEqual({ ...copy, id: null }, { ...first, id: null });
    assert.equal(brain.roots[0].branches[0].actions[0].linkId, undefined, "edits never mutate the previous history entry");
});

test("a third parent joins the same link, and the same parent cannot be added twice", () => {
    const brain = { roots: [{ id: "r", branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [] },
        { id: "b2", conditions: [{ type: "always" }], actions: [], children: [] },
        { id: "b3", conditions: [{ type: "always" }], actions: [], children: [] },
    ] }], orphans: [] };
    const node = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    const parent = (index) => ({ id: `condition:b${index}:root:r`, rootIndex: 0, path: [index - 1] });
    const once = wireNodes(editorRootsFor(brain), parent(2), node);
    assert.equal(wireBlockReason(once, parent(2), node), "Already connected to this node");
    assert.equal(wireBlockReason(once, parent(1), node), "Already connected to this node");
    const thrice = brainFromEditorRoots(brain, wireNodes(once, parent(3), node));
    const links = thrice.roots[0].branches.map((branch) => branch.actions[0].linkId);
    assert.equal(new Set(links).size, 1);
    assert.equal(parentCount(editorRootsFor(thrice), node), 3);
});

test("a root can be one of the parents of a shared action", () => {
    const brain = { roots: [{ id: "r", branches: [{ id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [] }] }], orphans: [] };
    const root = { id: "rootNode:r", rootIndex: 0 };
    const node = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    const saved = brainFromEditorRoots(brain, wireNodes(editorRootsFor(brain), root, node));
    assert.equal(saved.roots[0].actions.length, 1);
    assert.equal(saved.roots[0].actions[0].linkId, saved.roots[0].branches[0].actions[0].linkId);
});

test("one action per category per conditional is still checked for each new parent", () => {
    const brain = { roots: [{ id: "r", branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk" }], children: [] },
        { id: "b2", conditions: [{ type: "always" }], actions: [{ id: "a2", action: "move_walk" }], children: [] },
    ] }], orphans: [] };
    const roots = editorRootsFor(brain);
    const second = { id: "condition:b2:root:r", rootIndex: 0, path: [1] };
    const walk = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    assert.equal(wireBlockReason(roots, second, walk), "This conditional already has a Move action");
    assert.equal(wireNodes(roots, second, walk), null);
});

test("an unconnected action is still moved, not copied, when it first gets a parent", () => {
    const { brain, roots, branch, action } = fixture();
    const saved = brainFromEditorRoots(brain, wireNodes(roots, branch, action));
    assert.equal(saved.orphans.length, 0);
    assert.equal(saved.roots[0].branches[0].actions[0].linkId, undefined);
});

test("the input bar lifts a lone wire but only explains a shared action's wires", () => {
    assert.deepEqual(inputBarBehavior(1), { lift: true, message: null });
    assert.deepEqual(inputBarBehavior(2), { lift: false, message: "Connected to 2 nodes. Select a wire to disconnect it." });
    assert.equal(inputBarBehavior(5).message, "Connected to 5 nodes. Select a wire to disconnect it.");
});

function sharedBrain(parents = 3) {
    return { roots: [{ id: "r", branches: Array.from({ length: parents }, (_, i) => ({ id: `b${i + 1}`, conditions: [{ type: "always" }], actions: [{ id: `a${i + 1}`, linkId: "link-shared", action: "move_walk" }], children: [] })) }], orphans: [] };
}

test("removing one wire of a shared action removes just that parent; a lone copy stops being linked", () => {
    const brain = sharedBrain(3);
    const node = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    const cut = (roots, index) => disconnectNode(roots, node, { rootIndex: 0, path: [index], actionIndex: 0 });
    const twoLeft = brainFromEditorRoots(brain, cut(editorRootsFor(brain), 1));
    assert.deepEqual(twoLeft.roots[0].branches.map((branch) => branch.actions.length), [1, 0, 1]);
    assert.equal(twoLeft.orphans.length, 0, "nothing becomes an orphan while another parent still has it");
    assert.equal(twoLeft.roots[0].branches[0].actions[0].linkId, "link-shared");
    const oneLeft = brainFromEditorRoots(twoLeft, cut(editorRootsFor(twoLeft), 2));
    assert.equal(oneLeft.orphans.length, 0);
    assert.equal(oneLeft.roots[0].branches[0].actions[0].linkId, undefined);
    const lastCut = brainFromEditorRoots(oneLeft, disconnectNode(editorRootsFor(oneLeft), node));
    assert.equal(lastCut.orphans.length, 1, "removing the last parent leaves an orphan as before");
    assert.equal(lastCut.orphans[0].action, "move_walk");
});

test("deleting a shared action asks first and removes every copy", () => {
    const brain = sharedBrain(3);
    const roots = editorRootsFor(brain);
    const node = { id: "a1", rootIndex: 0, rootId: "r", path: [0], actionIndex: 0 };
    assert.equal(sharedDeletePrompt(roots, node), "This action is used by 3 branches.");
    assert.equal(sharedDeletePrompt(editorRootsFor(sharedBrain(1)), node), null);
    const saved = brainFromEditorRoots(brain, removeLinkedCopies(roots, linkIdOf(roots, node)));
    assert.deepEqual(saved.roots[0].branches.map((branch) => branch.actions.length), [0, 0, 0]);
    assert.equal(saved.orphans.length, 0);
});

test("editing one copy of a shared action edits them all, and each keeps its own id", () => {
    const before = editorRootsFor(sharedBrain(2));
    const edited = structuredClone(before);
    edited[0].branches[1].actions[0].sprint = true;
    const synced = syncLinkedActions(before, edited);
    assert.equal(synced[0].branches[0].actions[0].sprint, true);
    assert.equal(synced[0].branches[0].actions[0].id, "a1");
    assert.equal(synced[0].branches[1].actions[0].id, "a2");
    assert.equal(edited[0].branches[0].actions[0].sprint, undefined, "the input is not mutated");
    assert.equal(syncLinkedActions(before, before), before);
});

test("changing a shared action to a category another parent already uses is refused", () => {
    const brain = sharedBrain(2);
    brain.roots[0].branches[1].actions.push({ id: "rot", action: "rotate_toward_enemy" });
    const roots = editorRootsFor(brain);
    const copy = roots[0].branches[0].actions[0];
    assert.match(linkedChangeBlockReason(roots, copy, { action: "rotate_toward_enemy" }) ?? "", /already has a Rotate action/);
    assert.equal(linkedChangeBlockReason(roots, copy, { action: "move_walk" }), null);
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
