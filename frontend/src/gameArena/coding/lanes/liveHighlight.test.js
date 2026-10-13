import assert from "node:assert/strict";
import test from "node:test";
import { ancestorIdsOf, liveHighlightSets, winnerIdsOf } from "./liveHighlight.js";

// A combo: slash (ability) has follow-up dash, which has follow-up cancel. A second top-level card stands alone.
const configuration = {
    modes: [{
        id: "main",
        name: "Main",
        movement: [{ id: "walk", conditions: [], action: { action: 20 } }],
        actions: [{
            id: "slash",
            conditions: [],
            action: { action: 1 },
            followUps: [{
                id: "dash",
                conditions: [],
                action: { action: 30 },
                followUps: [{ id: "cancel", conditions: [], action: { action: 40 } }],
            }],
        }, { id: "lone", conditions: [], action: { action: 3 } }],
        variables: [],
        switches: [],
    }],
    shared: { movement: [], actions: [], variables: [], switches: [] },
};

test("winners are every id that won, variables included, and nothing else", () => {
    assert.deepEqual([...winnerIdsOf({ winners: { move: "walk", face: null, action: "dash", variables: ["set", "add"] } })].sort(), ["add", "dash", "set", "walk"]);
    assert.deepEqual([...winnerIdsOf(null)], []);
});

test("ancestors of a follow-up are its parents, nearest last, and a top-level card has none", () => {
    assert.deepEqual(ancestorIdsOf(configuration, "cancel"), ["slash", "dash"]);
    assert.deepEqual(ancestorIdsOf(configuration, "dash"), ["slash"]);
    assert.deepEqual(ancestorIdsOf(configuration, "slash"), []);
    assert.deepEqual(ancestorIdsOf(configuration, "missing"), []);
    assert.deepEqual(ancestorIdsOf(configuration, null), []);
});

test("a running combo step is strong, and its ancestors are faint", () => {
    const sets = liveHighlightSets({ winners: { action: "cancel" }, comboStepId: "dash" }, configuration);
    assert.deepEqual([...sets.strong].sort(), ["cancel", "dash"], "the acting card and the running step keep their bar");
    assert.deepEqual([...sets.faint], ["slash"], "the step's parents show a faint bar");
});

test("a card that acted and is also an ancestor is strong, not faint", () => {
    const sets = liveHighlightSets({ winners: { action: "slash", move: "dash" }, comboStepId: "cancel" }, configuration);
    assert.deepEqual([...sets.strong].sort(), ["cancel", "dash", "slash"]);
    assert.deepEqual([...sets.faint], []);
});

test("no combo step means no faint bars", () => {
    const sets = liveHighlightSets({ winners: { move: "walk", action: "lone" } }, configuration);
    assert.deepEqual([...sets.strong].sort(), ["lone", "walk"]);
    assert.equal(sets.faint.size, 0);
});
