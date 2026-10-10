import assert from "node:assert/strict";
import test from "node:test";
import {
    BOT_CODE_ACTIONS,
    BOT_CODE_SELECTABLES,
    STATE_VARIABLES,
    normalizeAbilityStrategyConfiguration,
    normalizeConditions,
    selectAbilityStrategyActionPlan,
} from "../../../../../../shared/engine/botlogic/code/BotCode.js";
import { buildDeterministicLogicAction } from "../../../../../../shared/engine/botlogic/planner/ArenaActionPlanner.js";

// Brain coordinates are public (centered, Y-up); the engine works in internal (top-left, Y-down) units.
const plan = (brain, payload) => selectAbilityStrategyActionPlan(normalizeAbilityStrategyConfiguration(brain), payload);
const act = (brain, payload) => buildDeterministicLogicAction(normalizeAbilityStrategyConfiguration(brain), payload);

function battlePayload(player = { x: 600, y: 600, rotation: 0 }) {
    return {
        playerModel: { ...player, hp: 100, abilities: [], customVariables: {}, abilityState: {} },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 150, rotation: 180, hp: 100 }],
    };
}

const brain = (action, conditions = [{ type: "always" }], customVariables = []) => ({
    version: "bot-logic-tree-v2",
    customVariables,
    roots: [{ branches: [{ conditions, actions: [action] }] }],
});

test("position variables expose the full signed public coordinate range", () => {
    for (const id of ["selectable.x", "selectable.y"]) {
        const variable = STATE_VARIABLES.find((candidate) => candidate.id === id);
        assert.equal(variable.min, -600);
        assert.equal(variable.max, 600);
    }
});

test("a public coordinate target moves toward the matching internal point", () => {
    const towardOpponent = act(brain({ action: BOT_CODE_ACTIONS.MOVE_WALK, movementMode: "coordinates", targetX: 0, targetY: 450 }), battlePayload());
    assert.ok(Math.abs(towardOpponent.dx) < 1e-9);
    assert.ok(towardOpponent.dy < 0, "public +Y is internal up");
});

test("Entity X and Y read public coordinates", () => {
    const read = (variable) => brain({
        action: BOT_CODE_ACTIONS.VARIABLE,
        variableId: "custom.coordinate",
        terms: [{ operator: "set", operand: { type: "variable", value: variable, selectable: BOT_CODE_SELECTABLES.OPPONENT } }],
    }, [{ type: "always" }], [{ id: "custom.coordinate", name: "Coordinate", valueType: "number", initialValue: 0 }]);
    assert.equal(plan(read("selectable.x"), battlePayload()).customVariables["custom.coordinate"], 0);
    assert.equal(plan(read("selectable.y"), battlePayload()).customVariables["custom.coordinate"], 450);
});

test("negative coordinate comparisons survive normalization and evaluation", () => {
    const conditions = [
        { type: "expression", left: "selectable.x", leftSelectable: BOT_CODE_SELECTABLES.MY, comparator: "lt", right: { type: "number", value: -100 } },
        { type: "expression", left: "selectable.y", leftSelectable: BOT_CODE_SELECTABLES.MY, comparator: "gte", right: { type: "number", value: -450 } },
    ];
    assert.deepEqual(normalizeConditions(conditions).map((condition) => condition.right.value), [-100, -450]);
    const strategy = brain({ action: BOT_CODE_ACTIONS.MOVE_WALK, movementMode: "absolute", movementDirection: 90 }, conditions);
    assert.ok(plan(strategy, battlePayload({ x: 400, y: 1050 })).movement);
});

test("public target offsets invert Y", () => {
    const rotate = (targetOffsetY) => brain({
        action: BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        targetOffsetX: 0,
        targetOffsetY,
    });
    // Facing east at the center with the opponent due north. A public -600 Y offset puts the aim point
    // south of the bot (internal +Y), so the bot turns clockwise; an uninverted offset would turn it north.
    const payload = battlePayload({ x: 600, y: 600, rotation: 90 });
    assert.ok(act(rotate(-600), payload).dRot > 0);
    assert.ok(act(rotate(0), payload).dRot < 0);
});
