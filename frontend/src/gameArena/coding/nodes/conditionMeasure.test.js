import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeConditions } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { STATE_VARIABLES, STATE_VARIABLE_BY_ID, VARIABLE_SELECTABLE_TYPES, VISIBLE_STATE_VARIABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { describeCondition } from "./conditionSummary.js";
import {
    conditionVariableLabel,
    moveDirectionMeasure,
    objectPickIsCustom,
    switchMoveDirectionMeasure,
} from "./conditionMeasure.js";

const HEADING = "selectable.movementDirection";
const TOWARD = "selectable.approachAngle";
const visibleIds = () => VISIBLE_STATE_VARIABLES.map((variable) => variable.id);

test("the picker offers one Move Direction and hides Direction To, Facing and Approach Angle", () => {
    const ids = visibleIds();
    for (const hidden of ["selectable.absoluteBearing", "selectable.facing", TOWARD, "selectable.speed"]) {
        assert.equal(ids.includes(hidden), false, `${hidden} is hidden`);
        assert.ok(STATE_VARIABLES.some((variable) => variable.id === hidden), `${hidden} still evaluates`);
    }
    assert.deepEqual(VISIBLE_STATE_VARIABLES.filter((variable) => variable.label === "Move Direction").map((variable) => variable.id), [HEADING]);
    assert.equal(ids.includes("selectable.relativeBearing"), true, "Angle To stays");
    assert.equal(STATE_VARIABLE_BY_ID.get(TOWARD).selectableType, VARIABLE_SELECTABLE_TYPES.PAIR);
    assert.equal(STATE_VARIABLE_BY_ID.get(HEADING).selectableType, undefined);
});

test("a stored Approach Angle opens as Move Direction, Toward a target", () => {
    const old = { type: "expression", left: TOWARD, selectable1: "opponent_1", selectable2: "my_bot", comparator: "lt", right: { type: "number", value: 20 } };
    assert.equal(moveDirectionMeasure(old.left), "toward");
    assert.equal(moveDirectionMeasure(HEADING), "heading");
    assert.equal(moveDirectionMeasure("selectable.distance"), null);
    assert.equal(conditionVariableLabel(STATE_VARIABLE_BY_ID.get(TOWARD)), "Move Direction");
    assert.equal(conditionVariableLabel(STATE_VARIABLE_BY_ID.get("selectable.distance")), "Distance");

    const lookups = { variable: (id) => STATE_VARIABLE_BY_ID.get(id), selectable: (id) => id, ability: String };
    assert.equal(describeCondition(old, lookups), "Move Direction (opponent_1 → my_bot) < 20 deg");
    // Opening it does not rewrite the stored condition.
    assert.equal(switchMoveDirectionMeasure(old, 1, "toward"), old);
});

test("Heading switches to Toward a target and back, keeping the entity, comparator and value", () => {
    const heading = { type: "expression", left: HEADING, leftSelectable: "opponent_1", comparator: "gt", right: { type: "number", value: 90 } };
    const toward = switchMoveDirectionMeasure(heading, 1, "toward");
    assert.equal(toward.left, TOWARD);
    assert.equal(toward.selectable1, "opponent_1");
    assert.ok(toward.selectable2, "To gets a default");
    assert.equal("leftSelectable" in toward, false);
    assert.equal(toward.comparator, "gt");
    assert.deepEqual(toward.right, { type: "number", value: 90 });
    assert.equal(normalizeConditions([toward])[0].left, TOWARD);

    const back = switchMoveDirectionMeasure(toward, 1, "heading");
    assert.equal(back.left, HEADING);
    assert.equal(back.leftSelectable, "opponent_1");
    assert.equal("selectable1" in back, false);
    assert.equal("selectable2" in back, false);
    assert.equal(back.comparator, "gt");
    assert.equal(normalizeConditions([back])[0].left, HEADING);
});

test("switching to Toward a target keeps the compared number inside 0 to 180", () => {
    const heading = { type: "expression", left: HEADING, leftSelectable: "opponent", comparator: "lt", right: { type: "number", value: -270 } };
    assert.equal(switchMoveDirectionMeasure(heading, 1, "toward").right.value, 0);
    assert.equal(switchMoveDirectionMeasure({ ...heading, right: { type: "number", value: 300 } }, 1, "toward").right.value, 180);
});

test("switching keeps a compared-to variable and its right-side fields", () => {
    const condition = { type: "expression", left: HEADING, leftSelectable: "opponent", comparator: "eq", right: { type: "variable", value: "selectable.hp" }, rightSelectable: "my_bot" };
    const toward = switchMoveDirectionMeasure(condition, 1, "toward");
    assert.deepEqual(toward.right, condition.right);
    assert.equal(toward.rightSelectable, "my_bot");
});

test("the compared-to side switches in both directions without touching the left", () => {
    const condition = { type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "variable", value: HEADING }, rightSelectable: "opponent_1" };
    const toward = switchMoveDirectionMeasure(condition, 2, "toward");
    assert.deepEqual(toward.right, { type: "variable", value: TOWARD });
    assert.equal(toward.rightSelectable, "opponent_1");
    assert.equal(toward.left, "selectable.hp");
    assert.equal(toward.leftSelectable, "my_bot");

    const heading = switchMoveDirectionMeasure({ ...toward, rightSelectable2: "my_bot" }, 2, "heading");
    assert.deepEqual(heading.right, { type: "variable", value: HEADING });
    assert.equal(heading.rightSelectable, "opponent_1");
    assert.equal("rightSelectable2" in heading, false);
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
