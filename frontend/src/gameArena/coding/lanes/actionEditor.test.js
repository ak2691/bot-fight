import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_BY_ID, BOT_CODE_SELECTABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { actionTileLabel, applyEditorField, editorFields, targetOptionsFor, targetOf } from "./actionEditorModel.js";
import { defaultActionEntry } from "./laneEdits.js";

const walk = ACTION_BY_ID.get("move_walk");
const rotate = ACTION_BY_ID.get("rotate_toward_enemy");
const cancel = ACTION_BY_ID.get("cancel_windup");
const walkEntry = { action: "move_walk", selectable: BOT_CODE_SELECTABLES.OPPONENT, movementDirection: 0 };

test("an action offers only the targets it supports: Walk and Face take Enemy, Point and Angle; Cancel takes none", () => {
    assert.deepEqual(targetOptionsFor(walk).map((option) => option.label), ["Enemy", "Point", "Angle"]);
    assert.deepEqual(targetOptionsFor(rotate).map((option) => option.label), ["Enemy", "Point", "Angle"]);
    assert.deepEqual(targetOptionsFor(cancel), []);
    assert.deepEqual(targetOptionsFor(undefined), []);
});

test("Walk's editor shows Target, then Direction as Toward, Strafe and Away, then Sprint", () => {
    const fields = editorFields(walkEntry, walk);
    assert.deepEqual(fields.map((field) => `${field.key}:${field.kind}`), [
        "target:segmented",
        "movementDirection:segmented",
        "sprint:switch",
    ]);
    assert.deepEqual(fields[1].options.map((option) => option.label), ["Toward", "Strafe", "Away"]);
    assert.equal(targetOf(walkEntry, walk), "enemy");
});

test("Point adds its X and Y number boxes right after the target, and Angle adds one angle box", () => {
    const point = applyEditorField(walkEntry, walk, "target", "point");
    assert.equal(targetOf(point, walk), "point");
    assert.deepEqual(editorFields(point, walk).slice(1, 3).map((field) => `${field.key}:${field.label}`), ["targetX:X", "targetY:Y"]);
    const angle = applyEditorField(walkEntry, walk, "target", "angle");
    assert.equal(targetOf(angle, walk), "angle");
    const angleField = editorFields(angle, walk).find((field) => field.label === "Angle");
    assert.equal(angleField.key, "movementDirection");
    assert.equal(angleField.unit, "deg");
});

test("a switch is stored only when on, so an entry with it off is the entry it was", () => {
    const on = applyEditorField(walkEntry, walk, "sprint", true);
    assert.equal(on.sprint, true);
    assert.deepEqual(applyEditorField(on, walk, "sprint", false), walkEntry);
});

test("a direction preset sets the relative angle, and a custom angle shows a number box too", () => {
    assert.equal(applyEditorField(walkEntry, walk, "movementDirection", 180).movementDirection, 180);
    const custom = editorFields({ ...walkEntry, movementDirection: 45 }, walk);
    assert.ok(custom.some((field) => field.label === "Degrees" && field.value === 45), "a non-preset angle is editable");
});

test("tile labels read as the verb with its short target; an ability shows just its name; a variable shows its name", () => {
    assert.equal(actionTileLabel(walkEntry, walk), "Walk to enemy");
    assert.equal(actionTileLabel({ ...walkEntry, movementDirection: 180 }, walk), "Walk away from enemy");
    assert.equal(actionTileLabel({ action: "rotate_toward_enemy", selectable: BOT_CODE_SELECTABLES.OPPONENT }, rotate), "Face enemy");
    assert.equal(actionTileLabel({ action: "cancel_windup" }, cancel), "Cancel wind-up");
    assert.equal(actionTileLabel({ action: 1, selectable: BOT_CODE_SELECTABLES.OPPONENT }, ACTION_BY_ID.get(1)), "Slash");
    const rage = [{ id: "custom.rage", name: "Rage", valueType: "boolean", initialValue: false }];
    const variable = ACTION_BY_ID.get("variable");
    assert.equal(actionTileLabel(defaultActionEntry("variable", rage), variable, { customVariables: rage }), "Set Rage");
});

test("a boolean variable card's editor is a switch; a number's is a number box", () => {
    const flag = [{ id: "custom.rage", name: "Rage", valueType: "boolean", initialValue: false }];
    const count = [{ id: "custom.count", name: "Count", valueType: "number", initialValue: 0 }];
    const variable = ACTION_BY_ID.get("variable");
    const flagFields = editorFields(defaultActionEntry("variable", flag), variable, { customVariables: flag });
    assert.deepEqual(flagFields.map((field) => `${field.key}:${field.kind}`), ["variableValue:switch"]);
    const set = applyEditorField(defaultActionEntry("variable", flag), variable, "variableValue", true, { customVariables: flag });
    assert.equal(set.value, true);
    const numberFields = editorFields(defaultActionEntry("variable", count), variable, { customVariables: count });
    assert.deepEqual(numberFields.map((field) => `${field.key}:${field.kind}`), ["variableValue:number"]);
});

test("the fast turn switch is Rotate's; an action with no settings shows none", () => {
    assert.ok(editorFields({ action: "rotate_toward_enemy", selectable: BOT_CODE_SELECTABLES.OPPONENT }, rotate).some((field) => field.key === "fastTurn"));
    assert.deepEqual(editorFields({}, cancel), []);
});
