import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoots } from "../../../../shared/engine/botlogic/code/BotCode.js";
import { carryPositions, matchNodes, topLeftForCenter } from "./nodePlacement.js";
import { disconnectNode, editorRootsFor, removeRootKeepingChildren, wireNodes } from "./treeWiring.js";

// The node list mirrors buildLogicGraph's identities (roots, conditionals, actions) without its layout.
function nodesOf(roots) {
    const nodes = [];
    roots.forEach((root, rootIndex) => {
        const rootId = String(root?.id || `root-${rootIndex + 1}`);
        if (!root._orphan) nodes.push({ id: `rootNode:${rootId}`, rootId, rootIndex });
        const visit = (branch, path) => {
            const topOfGroup = Boolean(root._orphan) && path.length === 1;
            if (!branch._actionOrphan) {
                nodes.push({ id: topOfGroup ? branch.id : `condition:${branch.id}:root:${rootId}`, rootId, rootIndex, path });
            }
            (branch.actions ?? []).filter((entry) => entry.action && entry.action !== "none").forEach((entry, actionIndex) => {
                nodes.push({ id: entry.id ?? `action:${branch.id}:${actionIndex}:root:${rootId}`, rootId, rootIndex, path, actionIndex, orphan: Boolean(branch._actionOrphan) });
            });
            (branch.children ?? []).forEach((child, index) => visit(child, [...path, index]));
        };
        (root.branches ?? []).forEach((branch, index) => visit(branch, [index]));
    });
    return nodes;
}

// A conditional is labelled by its unique comparison value; the labels survive every structure change.
function labelOf(node, roots) {
    if (node.actionIndex != null) return null;
    if (!node.path) return `root:${node.id}`;
    let branch = roots[node.rootIndex]?.branches?.[node.path[0]];
    for (const index of node.path.slice(1)) branch = branch?.children?.[index];
    return branch?.conditions?.[0]?.right?.value != null ? `c${branch.conditions[0].right.value}` : null;
}

const conditional = (value) => ({ type: "expression", left: "match.elapsedSeconds", comparator: "lt", right: { type: "number", value } });

function brainWithLabels() {
    return normalizeRoots(editorRootsFor({
        roots: [
            { id: "A", name: "A", branches: [
                { id: "a1", conditions: [conditional(1)], actions: [], children: [
                    { id: "a2", conditions: [conditional(2)], actions: [], children: [] },
                ] },
                { id: "a3", conditions: [conditional(3)], actions: [], children: [] },
            ] },
            { id: "B", name: "B", branches: [
                { id: "b1", conditions: [conditional(4)], actions: [{ id: "x1", action: "move_walk", movementMode: "absolute", movementDirection: "east" }], children: [] },
            ] },
        ],
        orphans: [{ id: "loose", kind: "conditional", conditions: [conditional(5)], actions: [], children: [] }],
    }));
}

// Positions are absolute and deterministic, as the board stores them.
function positionsFor(nodes) {
    return Object.fromEntries(nodes.map((node, index) => [node.id, { x: 120 + index * 290, y: 80 + (index % 3) * 170 }]));
}

function labelledPositions(state) {
    const byLabel = new Map();
    for (const node of state.nodes) {
        const label = labelOf(node, state.roots);
        if (label) byLabel.set(label, state.positions[node.id]);
    }
    return byLabel;
}

function refOf(nodes, label, roots) {
    return nodes.find((node) => labelOf(node, roots) === label);
}

// One structure change: the next roots, normalized, with their node list.
function step(roots, nextRoots) {
    const normalized = normalizeRoots(nextRoots);
    return { roots: normalized, nodes: nodesOf(normalized) };
}

test("surviving nodes keep their absolute positions through attach, cut, delete and reattach", () => {
    let roots = brainWithLabels();
    let nodes = nodesOf(roots);
    let positions = positionsFor(nodes);
    let state = { roots, nodes, positions };

    const operations = [
        // Attach the unconnected conditional (5) under conditional 3.
        (current) => wireNodes(current, refOf(nodesOf(current), "c3", current), refOf(nodesOf(current), "c5", current)),
        // Cut conditional 2 out of its parent; its subtree stays with it.
        (current) => disconnectNode(current, refOf(nodesOf(current), "c2", current)),
        // Delete root B; its conditional (4) becomes unconnected.
        (current) => removeRootKeepingChildren(current, current.findIndex((root) => root.id === "B")),
        // Attach the unconnected conditional (4) under conditional 1.
        (current) => wireNodes(current, refOf(nodesOf(current), "c1", current), refOf(nodesOf(current), "c4", current)),
        // Cut conditional 3 again.
        (current) => disconnectNode(current, refOf(nodesOf(current), "c3", current)),
    ];

    for (const operation of operations) {
        const before = labelledPositions(state);
        const next = step(state.roots, operation(state.roots));
        const carried = carryPositions({ nodes: state.nodes, roots: state.roots, positions: state.positions }, next);
        const after = new Map();
        for (const node of next.nodes) {
            const label = labelOf(node, next.roots);
            if (label) after.set(label, carried[node.id]);
        }
        for (const [label, previous] of before) {
            if (!after.has(label)) continue;
            assert.deepEqual(after.get(label), previous, `${label} kept its position`);
        }
        state = { roots: next.roots, nodes: next.nodes, positions: carried };
    }
});

test("a spawned node takes its spawn position and nothing else moves", () => {
    const roots = brainWithLabels();
    const nodes = nodesOf(roots);
    const positions = positionsFor(nodes);
    const spawnTarget = { x: 900, y: 500 };
    const withNew = normalizeRoots(editorRootsFor({ roots: [], orphans: [] }));
    assert.equal(withNew.length, 0);
    const created = normalizeRoots(editorRootsFor({
        roots: roots.filter((root) => !root._orphan).map((root) => ({ id: root.id, name: root.name, branches: root.branches })),
        orphans: [{ id: "fresh", kind: "conditional", conditions: [conditional(9)], actions: [], children: [] }],
    }));
    const next = nodesOf(created);
    const freshNode = next.find((node) => labelOf(node, created) === "c9");
    const carried = carryPositions({ nodes, roots, positions }, { nodes: next, roots: created }, { [freshNode.id]: spawnTarget });
    assert.deepEqual(carried[freshNode.id], spawnTarget);
    for (const node of next) {
        const label = labelOf(node, created);
        if (!label || label === "c9") continue;
        const previous = nodes.find((candidate) => labelOf(candidate, roots) === label);
        assert.deepEqual(carried[node.id], positions[previous.id], `${label} kept its position`);
    }
});

test("content-identical siblings keep their own places, not each other's", () => {
    const roots = normalizeRoots(editorRootsFor({ roots: [{ id: "R", branches: [
        { id: "p", conditions: [conditional(7)], actions: [], children: [] },
        { id: "q", conditions: [conditional(7)], actions: [], children: [] },
    ] }], orphans: [] }));
    const nodes = nodesOf(roots);
    const positions = { [nodes[1].id]: { x: 10, y: 10 }, [nodes[2].id]: { x: 500, y: 10 } };
    const matches = matchNodes({ nodes, roots }, { nodes, roots });
    assert.equal(matches.get(nodes[1].id), nodes[1].id);
    assert.equal(matches.get(nodes[2].id), nodes[2].id);
    assert.deepEqual(carryPositions({ nodes, roots, positions }, { nodes, roots }), positions);
});

test("topLeftForCenter puts a node's centre on the given point", () => {
    assert.deepEqual(topLeftForCenter({ x: 500, y: 300 }, { width: 340, height: 120 }), { x: 330, y: 240 });
});
