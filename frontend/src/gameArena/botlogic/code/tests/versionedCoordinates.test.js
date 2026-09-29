import assert from "node:assert/strict";
import test from "node:test";
import {
    BOT_CODE_ACTIONS,
    BOT_CODE_SELECTABLES,
    CUSTOM_VARIABLE_OPERATIONS,
    STATE_VARIABLES,
    selectAbilityStrategyActionPlan,
} from "../BotCode.js";
import { buildDeterministicLogicAction } from "../../planner/ArenaActionPlanner.js";
import { coordinateLimitsFor } from "../configuration/constants.js";

const V1 = "bot-logic-tree-v1";
const V2 = "bot-logic-tree-v2";

test("position variables expose the full signed public coordinate range", () => {
    for (const id of ["selectable.x", "selectable.y"]) {
        const variable = STATE_VARIABLES.find((candidate) => candidate.id === id);
        assert.equal(variable.min, -600);
        assert.equal(variable.max, 600);
    }
});

function battlePayload(player = { x: 600, y: 600, rotation: 0 }) {
    return {
        playerModel: { ...player, hp: 100, abilities: [], abilityCooldowns: {}, customVariables: {} },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 150, rotation: 180, hp: 100 }],
    };
}

function configuration(version, action, conditions = [{ type: "always" }], customVariables = []) {
    return {
        version,
        customVariables,
        roots: [{ branches: [{ conditions, actions: [action] }] }],
    };
}

function pointMove(version, targetX, targetY) {
    return configuration(version, {
        action: BOT_CODE_ACTIONS.MOVE_WALK,
        movementMode: "coordinates",
        targetX,
        targetY,
    });
}

test("v1 internal and v2 centered targets produce the same internal movement", () => {
    assert.deepEqual(coordinateLimitsFor(V1), { minimum: 0, maximum: 1200, offsetMagnitude: 1200 });
    assert.deepEqual(coordinateLimitsFor(V2), { minimum: -600, maximum: 600, offsetMagnitude: 600 });
    const v1 = pointMove(V1, 600, 150);
    const v2 = pointMove(V2, 0, 450);

    assert.deepEqual(buildDeterministicLogicAction(v1, battlePayload()), buildDeterministicLogicAction(v2, battlePayload()));
    assert.deepEqual(
        { dx: buildDeterministicLogicAction(v2, battlePayload()).dx, dy: buildDeterministicLogicAction(v2, battlePayload()).dy },
        { dx: 0, dy: -1 },
    );
});

test("v1 and v2 condition coordinates preserve distance, bearing, and compass semantics", () => {
    const make = (version, targetX, targetY) => configuration(version, {
        action: BOT_CODE_ACTIONS.MOVE_WALK,
        movementMode: "absolute",
        movementDirection: 0,
    }, [
        {
            type: "expression", left: "selectable.distance", selectable1: BOT_CODE_SELECTABLES.MY,
            targetMode: "coordinates", targetX, targetY, comparator: "eq", right: { type: "number", value: 450 },
        },
        {
            type: "expression", left: "selectable.relativeBearing", selectable1: BOT_CODE_SELECTABLES.MY,
            targetMode: "coordinates", targetX, targetY, comparator: "eq", right: { type: "number", value: 0 },
        },
    ]);
    const v1 = make(V1, 600, 150);
    const v2 = make(V2, 0, 450);
    const payload = battlePayload();

    assert.ok(selectAbilityStrategyActionPlan(v1, payload).movement);
    assert.ok(selectAbilityStrategyActionPlan(v2, payload).movement);
    assert.deepEqual(buildDeterministicLogicAction(v1, payload), buildDeterministicLogicAction(v2, payload));
});

test("Entity X and Y conditions and custom-variable operands use each brain version", () => {
    const selectCoordinate = (version, coordinate, expected) => configuration(version, {
        action: BOT_CODE_ACTIONS.MOVE_WALK,
        movementMode: "absolute",
        movementDirection: 90,
    }, [{
        type: "expression", left: coordinate, leftSelectable: BOT_CODE_SELECTABLES.MY,
        comparator: "eq", right: { type: "number", value: expected },
    }]);

    assert.ok(selectAbilityStrategyActionPlan(selectCoordinate(V1, "selectable.x", 600), battlePayload()).movement);
    assert.ok(selectAbilityStrategyActionPlan(selectCoordinate(V1, "selectable.y", 600), battlePayload()).movement);
    assert.ok(selectAbilityStrategyActionPlan(selectCoordinate(V2, "selectable.x", 0), battlePayload()).movement);
    assert.ok(selectAbilityStrategyActionPlan(selectCoordinate(V2, "selectable.y", 0), battlePayload()).movement);

    const readCoordinate = (version, id) => configuration(version, {
        action: BOT_CODE_ACTIONS.VARIABLE,
        variableId: "custom.coordinate",
        terms: [{ operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "variable", value: id, selectable: BOT_CODE_SELECTABLES.MY } }],
    }, [{ type: "always" }], [{ id: "custom.coordinate", name: "Coordinate", valueType: "number", initialValue: 0 }]);
    assert.equal(selectAbilityStrategyActionPlan(readCoordinate(V1, "selectable.x"), battlePayload()).customVariables["custom.coordinate"], 600);
    assert.equal(selectAbilityStrategyActionPlan(readCoordinate(V2, "selectable.x"), battlePayload()).customVariables["custom.coordinate"], 0);
    assert.equal(selectAbilityStrategyActionPlan(readCoordinate(V1, "selectable.y"), battlePayload()).customVariables["custom.coordinate"], 600);
    assert.equal(selectAbilityStrategyActionPlan(readCoordinate(V2, "selectable.y"), battlePayload()).customVariables["custom.coordinate"], 0);
});

test("public target offsets invert Y while retaining v1 behavior", () => {
    const make = (version, targetOffsetY) => configuration(version, {
        action: BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        targetOffsetX: 20,
        targetOffsetY,
    });
    const payload = battlePayload({ x: 600, y: 600, rotation: 90 });
    const v1 = buildDeterministicLogicAction(make(V1, -30), payload);
    const v2 = buildDeterministicLogicAction(make(V2, 30), payload);
    assert.deepEqual(v1, v2);
});
