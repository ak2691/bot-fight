import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STATE_VARIABLES, STATE_VARIABLE_BY_ID, VARIABLE_SELECTABLE_TYPES, VISIBLE_STATE_VARIABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { objectPickIsCustom, switchMoveDirectionMeasure } from "./conditionMeasure.js";

const HEADING = "selectable.movementDirection";
const TOWARD = "selectable.approachAngle";

test("switching keeps a compared-to variable and its right-side fields", () => {
    const condition = { type: "expression", left: HEADING, leftSelectable: "opponent", comparator: "eq", right: { type: "variable", value: "selectable.hp" }, rightSelectable: "my_bot" };
    const toward = switchMoveDirectionMeasure(condition, 1, "toward");
    assert.deepEqual(toward.right, condition.right);
    assert.equal(toward.rightSelectable, "my_bot");
});

test("a condition that is not on Move Direction is never changed by the switch", () => {
    const distance = { type: "expression", left: "selectable.distance", selectable1: "my_bot", selectable2: "opponent_1", comparator: "lt", right: { type: "number", value: 50 } };
    assert.equal(switchMoveDirectionMeasure(distance, 1, "toward"), distance);
    assert.equal(switchMoveDirectionMeasure(distance, 2, "heading"), distance);
    assert.deepEqual(switchMoveDirectionMeasure({ type: "always" }, 1, "toward"), { type: "always" });
});

test("an object pick is Advanced only when it is not the 1st closest", () => {
    assert.equal(objectPickIsCustom("closest", 1), false);
    assert.equal(objectPickIsCustom(null, 1), false);
    assert.equal(objectPickIsCustom(undefined, undefined), false);
    assert.equal(objectPickIsCustom("closest", 2), true);
    assert.equal(objectPickIsCustom("farthest", 1), true);
    assert.equal(objectPickIsCustom("newest", 3), true);
});

test("the object target picker gates pick and number behind Advanced, and starts open for custom picks", () => {
    const source = readFileSync(new URL("./GraphNodes.jsx", import.meta.url), "utf8");
    assert.match(source, /useState\(customPick\)/);
    assert.match(source, /row\(label, objectMenu, info\)\}\s*\{ownerMenuOptions\.length > 0 && row\("Owner", <MenuSelect ariaLabel="Selectable owner"/);
    assert.match(source, /row\("Number", <div className="ts-stepper">/);
    assert.match(source, /label="Advanced" checked=\{advancedOpen\} disabled=\{disabled \|\| customPick\}/);
    assert.match(source, /\{advancedOpen && <>\s*\{row\("Pick", <MenuSelect ariaLabel="Selectable ordering"/);
});
