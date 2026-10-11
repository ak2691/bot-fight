import assert from "node:assert/strict";
import test from "node:test";
import { countActionSlots, mergeLinkedActions, normalizeAbilityStrategyConfiguration } from "../BotCode.js";

const branch = (id, entry) => ({ id, conditions: [{ type: "always" }], actions: [entry], children: [] });
const brainOf = (entries) => ({ version: "bot-logic-tree-v2", roots: [{ id: "r", branches: entries.map((entry, i) => branch(`b${i + 1}`, entry)) }] });
const walk = (id, extra = {}) => ({ id, action: "move_walk", ...extra });
const copies = (count, linkId = "link-shared") => Array.from({ length: count }, (_, i) => walk(`a${i + 1}`, { linkId }));
const executable = (brain) => brain.roots[0].branches.filter((entry) => entry.action !== "none").length;

test("normalization keeps a valid linkId on tree actions and never mirrors it onto the conditional", () => {
    const saved = normalizeAbilityStrategyConfiguration(brainOf(copies(2)));
    assert.deepEqual(saved.roots[0].branches.map((entry) => entry.actions[0].linkId), ["link-shared", "link-shared"]);
    assert.equal(saved.roots[0].branches[0].linkId, undefined);
    assert.equal(saved.roots[0].branches[0].actions[0].id, "a1");
});

test("normalization drops a linkId that is too long or has the wrong pattern", () => {
    for (const linkId of ["x".repeat(41), "bad id!", "", 7, null]) {
        const saved = normalizeAbilityStrategyConfiguration(brainOf([walk("a1", { linkId })]));
        assert.equal(saved.roots[0].branches[0].actions[0].linkId, undefined, `linkId ${JSON.stringify(linkId)}`);
    }
    const longest = normalizeAbilityStrategyConfiguration(brainOf([walk("a1", { linkId: "x".repeat(40) })]));
    assert.equal(longest.roots[0].branches[0].actions[0].linkId, "x".repeat(40));
});

test("save then load: identical linked copies merge into one link and normalizing again changes nothing", () => {
    const saved = normalizeAbilityStrategyConfiguration(brainOf(copies(3)));
    assert.equal(mergeLinkedActions(saved), saved, "nothing to split");
    assert.deepEqual(normalizeAbilityStrategyConfiguration(saved).roots, saved.roots);
});

test("save then load: copies that no longer match load as separate nodes without a link", () => {
    const entries = copies(3);
    entries[2] = walk("a3", { linkId: "link-shared", sprint: true });
    const loaded = mergeLinkedActions(normalizeAbilityStrategyConfiguration(brainOf(entries)));
    assert.deepEqual(loaded.roots[0].branches.map((entry) => entry.actions[0].linkId), [undefined, undefined, undefined]);
    assert.deepEqual(loaded.roots[0].branches.map((entry) => entry.actions[0].id), ["a1", "a2", "a3"]);
});

test("a link with a single copy, or on a bare orphan, loads as a plain action", () => {
    const single = mergeLinkedActions(normalizeAbilityStrategyConfiguration(brainOf(copies(1))));
    assert.equal(single.roots[0].branches[0].actions[0].linkId, undefined);
    const withOrphan = normalizeAbilityStrategyConfiguration({ ...brainOf([walk("a1")]), orphans: [{ id: "o", kind: "action", action: "move_walk", linkId: "link-shared" }] });
    assert.equal(mergeLinkedActions(withOrphan).orphans[0].linkId, undefined);
});

test("budget: identical linked copies count as one action", () => {
    assert.equal(countActionSlots(brainOf(copies(5))), 1);
    assert.equal(countActionSlots(brainOf(copies(5).map((entry) => ({ ...entry, linkId: undefined })))), 5);
    assert.equal(executable(normalizeAbilityStrategyConfiguration(brainOf(copies(101)))), 101, "all copies survive the 100 action limit");
});

test("budget: copies with the same linkId but different content count separately", () => {
    const entries = [...copies(2), walk("a3", { linkId: "link-shared", sprint: true })];
    assert.equal(countActionSlots(brainOf(entries)), 2);
    const many = Array.from({ length: 101 }, (_, i) => walk(`a${i}`, { linkId: "link-shared", movementDirection: i }));
    assert.equal(countActionSlots(brainOf(many)), 101);
    assert.equal(executable(normalizeAbilityStrategyConfiguration(brainOf(many))), 100, "the budget truncates unrelated copies as before");
});

test("budget: normalization and counting agree for the same brain", () => {
    const brain = normalizeAbilityStrategyConfiguration(brainOf([...copies(30), ...copies(20, "link-other"), walk("solo")]));
    assert.equal(countActionSlots(brain), 3);
    assert.equal(executable(brain), 51);
});
