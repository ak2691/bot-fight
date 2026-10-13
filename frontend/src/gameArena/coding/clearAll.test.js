import assert from "node:assert/strict";
import test from "node:test";
import { clearAllCounts, clearAllMessage, clearedConfiguration } from "./clearAll.js";

const brain = {
    roots: [{ id: "a", actions: [{ action: "move_walk" }] }, { id: "b" }, { id: "c" }],
    orphans: [{ id: "o1" }, { id: "o2" }, { id: "o3" }, { id: "o4" }, { id: "o5" }],
    customVariables: [{ id: "v1" }, { id: "v2" }, { id: "v3" }, { id: "v4" }],
    nodePositions: { a: { x: 1, y: 2 } },
};

test("clear all lists what it will delete", () => {
    assert.equal(clearAllMessage(clearAllCounts(brain)), "Delete 3 roots, 5 unconnected nodes and 4 variables?");
    assert.equal(clearAllMessage(clearAllCounts({ roots: [{ id: "a" }] })), "Delete 1 root?");
    assert.equal(clearAllMessage(clearAllCounts({ roots: [] })), "");
});

test("clear all empties the brain without touching other settings", () => {
    const cleared = clearedConfiguration({ ...brain, version: 3 });
    assert.deepEqual([cleared.roots, cleared.orphans, cleared.customVariables, cleared.nodePositions], [[], [], [], {}]);
    assert.equal(cleared.version, 3);
    assert.equal(brain.roots.length, 3, "the previous history entry is not mutated");
});
