import assert from "node:assert/strict";
import test from "node:test";
import {
    applyPositionOrder,
    mismatchedGroups,
    nudgeNode,
    positionRanks,
    priorityRanks,
    sortTreeByPriority,
} from "./siblingOrder.js";

// A minimal built graph: one root with three conditionals (the last is ELSE).
function fixture() {
    const roots = [
        { id: "r1", priority: 1, branches: [
            { id: "a", priority: 1, branchType: "if", conditions: [], children: [] },
            { id: "b", priority: 2, branchType: "if", conditions: [], children: [{ id: "b1", priority: 1, branchType: "if", conditions: [], children: [] }] },
            { id: "c", priority: 3, branchType: "else", conditions: [], children: [] },
        ] },
        { id: "r2", priority: 2, branches: [] },
    ];
    const graph = {
        roots: [
            { id: "root:r1", rootIndex: 0, x: 0, y: 0, width: 300 },
            { id: "root:r2", rootIndex: 1, x: 1000, y: 0, width: 300 },
        ],
        conditions: [
            { id: "cond:a", rootIndex: 0, path: [0], x: 0, y: 300, width: 200 },
            { id: "cond:b", rootIndex: 0, path: [1], x: 300, y: 300, width: 200 },
            { id: "cond:b1", rootIndex: 0, path: [1, 0], x: 300, y: 600, width: 200 },
            { id: "cond:c", rootIndex: 0, path: [2], x: 600, y: 300, width: 200 },
        ],
        actions: [
            { id: "act:b1", rootIndex: 0, path: [1, 0], actionIndex: 0, x: 320, y: 900, width: 150 },
        ],
    };
    return { roots, graph };
}

test("stored priorities rank siblings", () => {
    const { roots, graph } = fixture();
    const ranks = priorityRanks(graph, roots);
    assert.equal(ranks.get("cond:a"), 1);
    assert.equal(ranks.get("cond:c"), 3);
    assert.equal(ranks.get("root:r2"), 2);
    assert.equal(mismatchedGroups(graph, {}, roots).size, 0);
});

test("dragging a conditional past its neighbour reorders by left-to-right position", () => {
    const { roots, graph } = fixture();
    const offsets = { "cond:a": { x: 420, y: 0 } };
    const ranks = positionRanks(graph, offsets, roots, new Set(["branches:0:"]));
    assert.equal(ranks.get("cond:b"), 1);
    assert.equal(ranks.get("cond:a"), 2);
    assert.ok(mismatchedGroups(graph, offsets, roots).has("branches:0:"));
    const next = applyPositionOrder(roots, graph, offsets, new Set(["branches:0:"]));
    assert.deepEqual(next[0].branches.map((branch) => branch.priority), [2, 1, 3]);
    assert.equal(next[1], roots[1]);
});

test("ELSE stays last even when dragged to the far left", () => {
    const { roots, graph } = fixture();
    const offsets = { "cond:c": { x: -900, y: 0 } };
    const next = applyPositionOrder(roots, graph, offsets, new Set(["branches:0:"]));
    assert.equal(next[0].branches[2].priority, 3);
});

test("roots reorder by position too", () => {
    const { roots, graph } = fixture();
    const next = applyPositionOrder(roots, graph, { "root:r2": { x: -1200, y: 0 } }, new Set(["roots"]));
    assert.deepEqual(next.map((root) => root.priority), [2, 1]);
});

test("nudging swaps order and moves each subtree with its node", () => {
    const { roots, graph } = fixture();
    const result = nudgeNode(roots, graph, {}, graph.conditions[1], -1);
    assert.deepEqual(result.roots[0].branches.map((branch) => branch.priority), [2, 1, 3]);
    assert.deepEqual(result.offsets["cond:b"], { x: -300, y: 0 });
    assert.deepEqual(result.offsets["cond:b1"], { x: -300, y: 0 });
    assert.deepEqual(result.offsets["act:b1"], { x: -300, y: 0 });
    assert.deepEqual(result.offsets["cond:a"], { x: 300, y: 0 });
    assert.equal(nudgeNode(roots, graph, {}, graph.conditions[0], -1), null);
    assert.equal(nudgeNode(roots, graph, {}, graph.conditions[1], 1), null, "cannot swap with ELSE");
});

test("tidy sorts sibling lists by priority without changing behavior", () => {
    const sorted = sortTreeByPriority([
        { id: "r2", priority: 2, branches: [] },
        { id: "r1", priority: 1, branches: [
            { id: "x", priority: 2, branchType: "if", conditions: [{ type: "always" }], children: [] },
            { id: "y", priority: 1, branchType: "if", conditions: [], children: [] },
        ] },
    ]);
    assert.deepEqual(sorted.map((root) => root.id), ["r1", "r2"]);
    assert.deepEqual(sorted[0].branches.map((branch) => branch.id), ["y", "x"]);
    const misplacedElse = sortTreeByPriority([{ id: "r", priority: 1, branches: [
        { id: "e", priority: 1, branchType: "else", conditions: [], children: [] },
        { id: "i", priority: 2, branchType: "if", conditions: [{ type: "always" }], children: [] },
    ] }]);
    assert.equal(misplacedElse[0].branches[0].branchType, "if", "an ELSE that is not last becomes an always-true IF");
    assert.deepEqual(misplacedElse[0].branches[0].conditions, []);
});
