import assert from "node:assert/strict";
import test from "node:test";
import { tapOpensPanel } from "./selectionRules.js";

test("a tap on an action opens its panel, selected or not", () => {
    assert.equal(tapOpensPanel({ isAction: true }), true);
    assert.equal(tapOpensPanel({ isAction: true, alreadySelected: true }), true);
});

test("a tap on a conditional only selects it, and a condition row opens once the conditional is selected", () => {
    assert.equal(tapOpensPanel({ isAction: false }), false);
    assert.equal(tapOpensPanel({ onRow: true, alreadySelected: false }), false);
    assert.equal(tapOpensPanel({ onRow: true, alreadySelected: true }), true);
});

test("Ctrl/Cmd taps never open a panel", () => {
    assert.equal(tapOpensPanel({ isAction: true, additive: true }), false);
    assert.equal(tapOpensPanel({ onRow: true, alreadySelected: true, additive: true }), false);
});
