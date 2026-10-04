import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCondition, normalizeAbilityStrategyConfiguration } from "../BotCode.js";
import { stateFromPayload } from "../runtime/runtimeState.js";
import { buildStatePayload } from "../../../modelPayloads/strategyStatePayload.js";
import { STATE_VARIABLES, STATE_VARIABLE_BY_ID, VISIBLE_STATE_VARIABLES } from "../contracts/BotLogicContracts.js";

// Mirrors server NewConditionsParityTest; keep the cases in step.
const main = (extra = {}) => ({ id: "main", type: "circle", slot: 1, x: 400, y: 400, size: 60, hp: 100, rotation: 90, ...extra });
const opponent = (extra = {}) => ({ id: "opponent-model", type: "opponentModel", slot: 2, x: 600, y: 400, size: 60, hp: 100, rotation: 270, ...extra });

function stateFor(shapes) {
    return stateFromPayload(buildStatePayload(shapes, "custom:", "main"));
}

function numberVariable(shapes, variable, selectable = "opponent") {
    const state = stateFor(shapes);
    // Probe by bisection-free comparison: the value is read back through eq/gt/lt conditions.
    const holds = (comparator, value) => evaluateCondition({
        type: "expression", left: variable, leftSelectable: selectable, selectable, comparator,
        right: { type: "number", value },
    }, state);
    return holds;
}

function boolVariable(shapes, variable, selectable = "opponent") {
    return evaluateCondition({
        type: "expression", left: variable, leftSelectable: selectable, selectable, comparator: "eq",
        right: { type: "boolean", value: true },
    }, stateFor(shapes));
}

const isAngle = (holds, expected) => holds("eq", expected);

test("new condition IDs are stable, bounded and in the right groups", () => {
    const approach = STATE_VARIABLE_BY_ID.get("selectable.approachAngle");
    assert.equal(approach.label, "Approach Angle");
    assert.equal(approach.group, "Movement");
    assert.equal(approach.valueType, "number");
    assert.equal(approach.min, 0);
    assert.equal(approach.max, 180);
    assert.match(approach.description, /\S/);

    const moving = STATE_VARIABLE_BY_ID.get("selectable.moving");
    assert.equal(moving.label, "Is Moving");
    assert.equal(moving.group, "Movement");
    assert.equal(moving.valueType, "boolean");

    const preparing = STATE_VARIABLE_BY_ID.get("bot.anyAbilityPreparing");
    assert.equal(preparing.label, "Any Ability Winding Up");
    assert.equal(preparing.valueType, "boolean");
    assert.deepEqual(preparing.selectableIdentities, ["bot"]);
    for (const variable of [approach, moving, preparing]) assert.match(variable.description, /\S/);
});

test("Speed leaves the visible picker but keeps evaluating for saved brains", () => {
    assert.equal(VISIBLE_STATE_VARIABLES.some((variable) => variable.id === "selectable.speed"), false);
    assert.equal(STATE_VARIABLES.some((variable) => variable.id === "selectable.speed"), true);
    assert.equal(VISIBLE_STATE_VARIABLES.some((variable) => variable.id === "selectable.movementDirection"), true);
    const state = stateFromPayload({
        playerModel: { x: 400, y: 400, hp: 100 },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, movementVelocityX: 3, movementVelocityY: 4 }],
    });
    assert.equal(evaluateCondition({
        type: "expression", left: "selectable.speed", leftSelectable: "opponent", selectable: "opponent",
        comparator: "gt", right: { type: "number", value: 4 },
    }, state), true);
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "expression", left: "selectable.speed", comparator: "gt", right: { type: "number", value: 4 } }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].left, "selectable.speed");
});

test("Approach Angle is 90 when the entity did not move last tick", () => {
    const stationary = [main(), opponent({ movementStartX: 600, movementStartY: 400 })];
    assert.equal(isAngle(numberVariable(stationary, "selectable.approachAngle"), 90), true);
    // A shape with no recorded movement start behaves the same.
    assert.equal(isAngle(numberVariable([main(), opponent()], "selectable.approachAngle"), 90), true);
});

test("Approach Angle is 0 head-on, 180 when fleeing and 90 sideways", () => {
    const toward = [main(), opponent({ movementStartX: 640, movementStartY: 400 })];
    assert.equal(isAngle(numberVariable(toward, "selectable.approachAngle"), 0), true);
    const away = [main(), opponent({ movementStartX: 560, movementStartY: 400 })];
    assert.equal(isAngle(numberVariable(away, "selectable.approachAngle"), 180), true);
    const sideways = [main(), opponent({ movementStartX: 600, movementStartY: 360 })];
    assert.equal(isAngle(numberVariable(sideways, "selectable.approachAngle"), 90), true);
    const diagonal = [main(), opponent({ movementStartX: 640, movementStartY: 440 })];
    assert.equal(isAngle(numberVariable(diagonal, "selectable.approachAngle"), 45), true);
    // The value is always inside 0-180.
    const holds = numberVariable(away, "selectable.approachAngle");
    assert.equal(holds("gt", 179.9) && holds("lt", 180.1), true);
});

test("Approach Angle is measured toward My Bot, wherever the viewer stands", () => {
    // The opponent moves in +y; My Bot is below it, then above it.
    const below = [main({ x: 600, y: 700 }), opponent({ movementStartX: 600, movementStartY: 360, y: 400 })];
    assert.equal(isAngle(numberVariable(below, "selectable.approachAngle"), 0), true);
    const above = [main({ x: 600, y: 100 }), opponent({ movementStartX: 600, movementStartY: 360, y: 400 })];
    assert.equal(isAngle(numberVariable(above, "selectable.approachAngle"), 180), true);
});

test("Is Moving covers walking, dash and knockback displacement, not standing still", () => {
    assert.equal(boolVariable([main(), opponent({ movementStartX: 600, movementStartY: 400 })], "selectable.moving"), false);
    assert.equal(boolVariable([main(), opponent()], "selectable.moving"), false);
    // Walking: the movement start trails the position.
    assert.equal(boolVariable([main(), opponent({ movementStartX: 592, movementStartY: 400 })], "selectable.moving"), true);
    // Knockback moves the bot after its own movement step, with no velocity change.
    const knockedBack = opponent({ x: 720, movementStartX: 600, movementStartY: 400, velocityX: 0, velocityY: 0, movementVelocityX: 0, movementVelocityY: 0 });
    assert.equal(boolVariable([main(), knockedBack], "selectable.moving"), true);
    // Dash displacement counts too.
    assert.equal(boolVariable([main(), opponent({ x: 600, y: 250, movementStartX: 600, movementStartY: 400 })], "selectable.moving"), true);
    // My Bot can be selected as well.
    assert.equal(boolVariable([main({ x: 410, movementStartX: 400, movementStartY: 400 }), opponent()], "selectable.moving", "my_bot"), true);
    assert.equal(boolVariable([main(), opponent()], "selectable.moving", "my_bot"), false);
});

test("Approach Angle reflects knockback toward or away from My Bot", () => {
    const pushedAway = [main(), opponent({ x: 720, movementStartX: 600, movementStartY: 400 })];
    assert.equal(isAngle(numberVariable(pushedAway, "selectable.approachAngle"), 180), true);
});

test("Any Ability Winding Up is true only while a wind-up is counting down", () => {
    assert.equal(boolVariable([main(), opponent()], "bot.anyAbilityPreparing"), false);
    assert.equal(boolVariable([main(), opponent({ preparingAbility: 36, preparingMs: 300 })], "bot.anyAbilityPreparing"), true);
    assert.equal(boolVariable([main(), opponent({ preparingAbility: 36, preparingMs: 0 })], "bot.anyAbilityPreparing"), false);
    assert.equal(boolVariable([main(), opponent({ preparingAbility: null, preparingMs: 300 })], "bot.anyAbilityPreparing"), false);
    assert.equal(boolVariable([main({ preparingAbility: 9, preparingMs: 200 }), opponent()], "bot.anyAbilityPreparing", "my_bot"), true);
});

test("new variables survive normalization with bounded values", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [
            { type: "expression", left: "selectable.approachAngle", selectable: "opponent", comparator: "lt", right: { type: "number", value: 999 } },
            { type: "expression", left: "selectable.moving", selectable: "opponent", comparator: "eq", right: { type: "boolean", value: true } },
            { type: "expression", left: "bot.anyAbilityPreparing", selectable: "opponent", comparator: "eq", right: { type: "boolean", value: true } },
        ], actions: [] }] }],
    });
    const conditions = normalized.roots[0].branches[0].conditions;
    assert.equal(conditions[0].left, "selectable.approachAngle");
    assert.equal(conditions[0].right.value, 180);
    assert.equal(conditions[1].left, "selectable.moving");
    assert.equal(conditions[2].left, "bot.anyAbilityPreparing");
});

// Approach Angle is a pair variable: From (first slot) -> To (second slot).
const pairState = (shapes) => stateFor(shapes);
const approachPair = (shapes, moving, target) => {
    const state = pairState(shapes);
    return (comparator, value) => evaluateCondition({
        type: "expression", left: "selectable.approachAngle", selectable1: moving, selectable2: target, comparator,
        right: { type: "number", value },
    }, state);
};
const entityObject = (extra) => ({ size: 20, hp: 20, ageMs: 1000, ...extra });
const withObjects = (payload, objects) => ({ ...payload, objects: [...payload.objects, ...objects] });

test("Approach Angle is a pair variable with From and To selectors", () => {
    const approach = STATE_VARIABLE_BY_ID.get("selectable.approachAngle");
    assert.equal(approach.selectableType, "Variable_Pair");
    assert.deepEqual(approach.selectableSelectorLabels, ["From", "To"]);
    assert.deepEqual(approach.pairSelectableIdentities, [[], []]);
    assert.equal(approach.defaultSelectable1, "opponent_1");
    assert.equal(approach.defaultSelectable2, "my_bot");
});

test("a saved old-format Approach Angle condition evaluates identically", () => {
    const old = { type: "expression", left: "selectable.approachAngle", selectable: "opponent", comparator: "lt", right: { type: "number", value: 20 } };
    const normalized = normalizeAbilityStrategyConfiguration({ roots: [{ branches: [{ conditions: [old], actions: [] }] }] })
        .roots[0].branches[0].conditions[0];
    // The old selectable was the moving entity; My Bot is the target.
    assert.equal(normalized.selectable1, "opponent_1");
    assert.equal(normalized.selectable2, "my_bot");
    const toward = stateFor([main(), opponent({ movementStartX: 640, movementStartY: 400 })]);
    const away = stateFor([main(), opponent({ movementStartX: 560, movementStartY: 400 })]);
    for (const condition of [old, normalized]) {
        assert.equal(evaluateCondition(condition, toward), true);
        assert.equal(evaluateCondition(condition, away), false);
    }
    // A saved condition that named My Bot as the moving entity keeps doing so.
    const mine = { ...old, leftSelectable: "my_bot", selectable: "my_bot" };
    const normalizedMine = normalizeAbilityStrategyConfiguration({ roots: [{ branches: [{ conditions: [mine], actions: [] }] }] })
        .roots[0].branches[0].conditions[0];
    assert.equal(normalizedMine.selectable1, "my_bot");
    assert.equal(normalizedMine.selectable2, "my_bot");
    // A condition with no selectable at all keeps the old Opponent default.
    const bare = { ...old };
    delete bare.selectable;
    const normalizedBare = normalizeAbilityStrategyConfiguration({ roots: [{ branches: [{ conditions: [bare], actions: [] }] }] })
        .roots[0].branches[0].conditions[0];
    assert.equal(normalizedBare.selectable1, "opponent_1");
    assert.equal(normalizedBare.selectable2, "my_bot");
    // Normalizing again does not change the result.
    const again = normalizeAbilityStrategyConfiguration({ roots: [{ branches: [{ conditions: [normalized], actions: [] }] }] })
        .roots[0].branches[0].conditions[0];
    assert.deepEqual(again, normalized);
});

test("a saved old-format Approach Angle on the right side keeps its moving entity", () => {
    const old = {
        type: "expression", left: "selectable.approachAngle", selectable: "my_bot", comparator: "gt",
        right: { type: "variable", value: "selectable.approachAngle" }, rightSelectable: "opponent",
    };
    const normalized = normalizeAbilityStrategyConfiguration({ roots: [{ branches: [{ conditions: [old], actions: [] }] }] })
        .roots[0].branches[0].conditions[0];
    assert.equal(normalized.rightSelectable1, "opponent_1");
    assert.equal(normalized.rightSelectable2, "my_bot");
});

test("Approach Angle works from an opponent to an ally entity", () => {
    const base = buildStatePayload([main(), opponent({ movementStartX: 600, movementStartY: 360 })], "custom:", "main");
    const drone = entityObject({ id: "drone-1", type: "hunterDrone", abilityId: 17, ownerId: "main", ownerSlot: 1, x: 600, y: 700 });
    const holds = (comparator, value) => evaluateCondition({
        type: "expression", left: "selectable.approachAngle", selectable1: "opponent_1", selectable2: "my_bot_hunter_drone",
        comparator, right: { type: "number", value },
    }, stateFromPayload(withObjects(base, [drone])));
    // The opponent moves +y straight at the drone below it.
    assert.equal(holds("eq", 0), true);
    const sideways = buildStatePayload([main(), opponent({ movementStartX: 640, movementStartY: 400 })], "custom:", "main");
    assert.equal(evaluateCondition({
        type: "expression", left: "selectable.approachAngle", selectable1: "opponent_1", selectable2: "my_bot_hunter_drone",
        comparator: "eq", right: { type: "number", value: 90 },
    }, stateFromPayload(withObjects(sideways, [drone]))), true);
});

test("Approach Angle works from an entity to an entity", () => {
    const base = buildStatePayload([main(), opponent()], "custom:", "main");
    const fireball = entityObject({ id: "fb-1", type: "fireball", abilityId: 5, ownerId: "opponent-model", ownerSlot: 2, x: 800, y: 800, velocityX: 10, velocityY: 0 });
    const droneAt = (x) => entityObject({ id: "drone-1", type: "hunterDrone", abilityId: 17, ownerId: "main", ownerSlot: 1, x, y: 800 });
    const holds = (x, value) => evaluateCondition({
        type: "expression", left: "selectable.approachAngle", selectable1: "opponent_1_fireball", selectable2: "my_bot_hunter_drone",
        comparator: "eq", right: { type: "number", value },
    }, stateFromPayload(withObjects(base, [fireball, droneAt(x)])));
    assert.equal(holds(1000, 0), true);
    assert.equal(holds(500, 180), true);
});

test("Approach Angle is 90 when the two entities coincide", () => {
    const moving = opponent({ x: 400, y: 400, movementStartX: 440, movementStartY: 400 });
    assert.equal(approachPair([main(), moving], "opponent_1", "my_bot")("eq", 90), true);
    assert.equal(approachPair([main(), opponent({ movementStartX: 640, movementStartY: 400 })], "opponent_1", "opponent_1")("eq", 90), true);
});
