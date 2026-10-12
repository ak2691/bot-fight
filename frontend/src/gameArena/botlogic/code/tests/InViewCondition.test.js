import assert from "node:assert/strict";
import test from "node:test";
import { resolveStateVariable } from "../../../../../../shared/engine/botlogic/code/runtime/stateVariableResolver.js";
import { compareValues } from "../../../../../../shared/engine/botlogic/code/runtime/conditionEvaluator.js";

// Internal arena coordinates: Y grows downward, so a rotation of 0 faces up and 90 faces right.
const operations = {
    resolveSelectable: (state, id) => state.entities[id] ?? null,
    matchingSelectables: () => [],
    resolveCustom: () => null,
};
const at = (x, y, rotation = 0) => ({ x, y, rotation });
const inView = (entities, fields = {}) => resolveStateVariable(
    { entities },
    { left: "selectable.inView", selectable1: "my_bot", selectable2: "opponent_1", targetMode: "target", ...fields },
    "selectable.inView",
    "my_bot",
    operations,
);

// To sits straight to the side of From: a 90 degree bearing away from its facing.
const SIDEWAYS = { my_bot: at(600, 600, 0), opponent_1: at(800, 600) };

test("In View with a 360 arc is true whenever both entities exist, even directly behind", () => {
    const behind = { my_bot: at(600, 600, 0), opponent_1: at(600, 800) };
    assert.equal(inView(behind, { viewArc: 360 }), true);
    assert.equal(inView(behind), true, "a missing arc defaults to the full circle");
});

test("In View is inclusive at exactly half the arc either side of facing", () => {
    assert.equal(inView(SIDEWAYS, { viewArc: 180 }), true, "a bearing of exactly 90 degrees is inside a 180 arc");
    assert.equal(inView(SIDEWAYS, { viewArc: 178 }), false, "just outside a 178 arc");
    assert.equal(inView(SIDEWAYS, { viewArc: 182 }), true, "just inside a 182 arc");
});

test("In View separates a target dead ahead from one behind a narrow arc", () => {
    const ahead = { my_bot: at(600, 600, 0), opponent_1: at(600, 400) };
    const behind = { my_bot: at(600, 600, 0), opponent_1: at(600, 800) };
    assert.equal(inView(ahead, { viewArc: 2 }), true);
    assert.equal(inView(behind, { viewArc: 2 }), false);
    assert.equal(inView(behind, { viewArc: 358 }), false, "a 358 arc still excludes a target 180 degrees away");
});

test("In View with a coordinates target measures to the point", () => {
    const state = { my_bot: at(600, 600, 90) };
    // Public (100, 0) is internal (700, 600), to the right of a unit facing right.
    const right = { targetMode: "coordinates", targetX: 100, targetY: 0, viewArc: 2 };
    assert.equal(inView(state, right), true);
    // Public (-100, 0) is directly behind a unit facing right.
    const left = { targetMode: "coordinates", targetX: -100, targetY: 0, viewArc: 2 };
    assert.equal(inView(state, left), false);
    assert.equal(inView(state, { ...left, viewArc: 360 }), true);
});

test("In View is no value when From lacks the facing identity, so a condition on it is false", () => {
    const entities = { my_bot: at(600, 600, 0), opponent_1: at(800, 600), "opponent_1_grenade": at(600, 400) };
    const value = inView(entities, { selectable1: "opponent_1_grenade", viewArc: 360 });
    assert.equal(value, null);
    // Evaluation compares a null operand as false, and an operand that is null never matches (checked by the condition evaluator).
    assert.equal(compareValues(false, "eq", true, "boolean"), false);
});

test("In View is false when To is missing", () => {
    assert.equal(inView({ my_bot: at(600, 600, 0) }, { viewArc: 360 }), false);
});
