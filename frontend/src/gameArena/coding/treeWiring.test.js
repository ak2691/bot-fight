import assert from "node:assert/strict";
import test from "node:test";
import { attachNewNode, attachTargetFor, canWireNodes, wireBlockReason, wireNodes } from "./treeWiring.js";

const move = { action: "move_walk", selectable: "opponent" };
const rotate = { action: "rotate_toward_enemy", selectable: "opponent" };

function fixture() {
    return {
        roots: [
            { id: "r1", name: "Root", priority: 1, branches: [
                { id: "b1", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [move], children: [] },
                { id: "b2", branchType: "else", priority: 2, conditions: [], actions: [{ action: "none" }], children: [] },
            ] },
            { id: "r2", name: "Other", priority: 2, branches: [
                { id: "b3", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [rotate], children: [] },
            ] },
        ],
    };
}

const rootNode = (rootIndex) => ({ id: `root:${rootIndex}`, rootIndex });
const branchNode = (rootIndex, path) => ({ id: `cond:${rootIndex}:${path.join(".")}`, rootIndex, path });
const actionNode = (rootIndex, path, actionIndex) => ({ id: `act:${rootIndex}:${path.join(".")}:${actionIndex}`, rootIndex, path, actionIndex });

test("a conditional wires under a root and keeps ELSE last", () => {
    const { roots } = fixture();
    const next = wireNodes(roots, rootNode(0), branchNode(1, [0]), { xOf: () => 0 });
    assert.deepEqual(next[0].branches.map((branch) => branch.id), ["b1", "b3", "b2"], "inserted before ELSE");
    assert.deepEqual(next[0].branches.map((branch) => branch.priority), [1, 2, 3]);
    assert.equal(next[1].branches.length, 0, "the moved conditional leaves its old root");
    assert.equal(roots[1].branches.length, 1, "the previous roots are not mutated");
});

test("a connected action is refused from a new output but moves when lifted", () => {
    const { roots } = fixture();
    const reason = wireBlockReason(roots, branchNode(1, [0]), actionNode(0, [0], 0));
    assert.match(reason, /Lift its input bar/);
    assert.equal(wireBlockReason(roots, branchNode(1, [0]), actionNode(0, [0], 0), { move: true }), null);
    const moved = wireNodes(roots, branchNode(1, [0]), actionNode(0, [0], 0), { move: true });
    assert.deepEqual(moved[0].branches[0].actions, [], "the action leaves its old conditional");
    assert.equal(moved[1].branches[0].actions.length, 2);
    assert.equal(moved[1].branches[0].action, "rotate_toward_enemy");
});

test("an action is refused where its category is already used, and onto its own conditional", () => {
    const { roots } = fixture();
    // The target holds a rotate, so a move is allowed beside it.
    assert.equal(wireBlockReason(roots, branchNode(1, [0]), actionNode(0, [0], 0), { move: true }), null);
    assert.equal(wireBlockReason(roots, branchNode(0, [0]), actionNode(0, [0], 0), { move: true }), "Already connected to this node");
    const clash = structuredClone(roots);
    clash[1].branches[0].actions = [{ action: "move_walk", selectable: "opponent" }];
    assert.match(wireBlockReason(clash, branchNode(1, [0]), actionNode(0, [0], 0), { move: true }), /already has a Move action/);
});

test("loops, self wires and root-into-node wires are refused", () => {
    const { roots } = fixture();
    const nested = structuredClone(roots);
    nested[0].branches[0].children = [{ id: "c", branchType: "if", priority: 1, conditions: [], actions: [], children: [] }];
    assert.match(wireBlockReason(nested, branchNode(0, [0, 0]), branchNode(0, [0])), /loop/);
    assert.match(wireBlockReason(roots, branchNode(0, [0]), branchNode(0, [0])), /itself/);
    assert.match(wireBlockReason(roots, branchNode(0, [0]), rootNode(1)), /root can't/);
    assert.equal(canWireNodes(roots, rootNode(0), branchNode(1, [0])), true);
});

test("the attach target is the selected root or conditional, else the last root, else a new root", () => {
    const { roots } = fixture();
    assert.deepEqual(attachTargetFor(roots, null), { rootIndex: 1, path: null });
    assert.deepEqual(attachTargetFor(roots, { rootIndex: 0, path: null }), { rootIndex: 0, path: null });
    assert.deepEqual(attachTargetFor(roots, { rootIndex: 0, path: [0] }), { rootIndex: 0, path: [0] });
    assert.deepEqual(attachTargetFor(roots, { rootIndex: 9, path: null }), { rootIndex: 1, path: null }, "a stale selection falls back");
    assert.deepEqual(attachTargetFor([], null), { rootIndex: 0, path: null, newRoot: true });
});

test("a new conditional under a root goes last before ELSE, and a new root is made when there is none", () => {
    const { roots } = fixture();
    const branch = { branchType: "if", priority: 9, conditions: [{ type: "always" }], actions: [], children: [] };
    const added = attachNewNode(roots, { rootIndex: 0, path: null }, { kind: "conditional", branch });
    assert.deepEqual(added.roots[0].branches.map((item) => item.branchType), ["if", "if", "else"]);
    assert.deepEqual(added.select, { rootIndex: 0, path: [1] });
    const fresh = attachNewNode([], attachTargetFor([], null), { kind: "conditional", branch });
    assert.equal(fresh.roots.length, 1);
    assert.deepEqual(fresh.select, { rootIndex: 0, path: [0] });
});

test("an action under a conditional follows the one-per-category rule; under a root it gets an Always conditional", () => {
    const { roots } = fixture();
    const sameCategory = { action: "move_walk", selectable: "opponent" };
    assert.match(attachNewNode(roots, { rootIndex: 0, path: [0] }, { kind: "action", entry: sameCategory }).reason, /already has a Move action/);
    const added = attachNewNode(roots, { rootIndex: 1, path: [0] }, { kind: "action", entry: { action: "variable", variableId: "", terms: [] } });
    assert.equal(added.roots[1].branches[0].actions.length, 2);
    assert.deepEqual(added.select, { rootIndex: 1, path: [0], actionIndex: 1 });
    const underRoot = attachNewNode(roots, { rootIndex: 0, path: null }, { kind: "action", entry: { action: "rotate_toward_enemy", selectable: "opponent" } });
    assert.equal(underRoot.roots[0].branches[1].conditions[0].type, "always");
    assert.deepEqual(underRoot.select, { rootIndex: 0, path: [1], actionIndex: 0 });
});
