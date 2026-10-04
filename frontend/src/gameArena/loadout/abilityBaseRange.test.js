import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCondition, normalizeAbilityStrategyConfiguration } from "../botlogic/code/BotCode.js";
import { stateFromPayload } from "../botlogic/code/runtime/runtimeState.js";
import {
    STATE_VARIABLE_BY_ID,
    VISIBLE_STATE_VARIABLES,
    abilityDefinitionsForVariable,
} from "../botlogic/code/contracts/BotLogicContracts.js";
import { ALL_ABILITY_DEFINITIONS, abilityBaseRange } from "./BotLoadout.js";

// Mirrors server AbilityBaseRangeParityTest; keep the table in step.
export const EXPECTED_BASE_RANGES = Object.freeze({
    1: 92, 3: 1200, 4: 320, 5: 700, 6: 184, 7: 115, 8: null, 9: 500, 10: null, 11: 176,
    12: 500, 13: 900, 14: 220, 15: 1800, 16: null, 17: null, 18: 220, 19: null, 20: null,
    21: null, 22: null, 23: null, 24: null, 25: 100, 26: null, 27: null, 28: 400, 29: null,
    30: 600, 31: null, 32: 500, 33: null, 34: 80, 35: 190, 36: 112, 37: 125,
});

test("base range comes from the real hitbox, one value per hitbox type", () => {
    assert.equal(abilityBaseRange(1), 92, "arc -> range");
    assert.equal(abilityBaseRange(35), 190, "rectangle -> length");
    assert.equal(abilityBaseRange(3), 1200, "ray -> range");
    assert.equal(abilityBaseRange(5), 700, "projectile -> speed per tick x (lifetime / 100 ms)");
    assert.equal(abilityBaseRange(8), null, "circle has a radius, not a range");
    assert.equal(abilityBaseRange(19), null, "movement-only ability");
    assert.equal(abilityBaseRange(999), null, "unknown ability");
    assert.equal(abilityBaseRange(null), null);
});

test("base range table covers every ability ID", () => {
    assert.deepEqual(
        ALL_ABILITY_DEFINITIONS.map((ability) => ability.id).sort((a, b) => a - b),
        Object.keys(EXPECTED_BASE_RANGES).map(Number).sort((a, b) => a - b),
    );
    for (const ability of ALL_ABILITY_DEFINITIONS) {
        assert.equal(abilityBaseRange(ability.id), EXPECTED_BASE_RANGES[ability.id], `ability ${ability.id}`);
    }
});

test("Base Range is an ability variable that lists only abilities with a range", () => {
    const variable = STATE_VARIABLE_BY_ID.get("bot.selectedAbilityBaseRange");
    assert.equal(variable.label, "Base Range");
    assert.equal(variable.valueType, "number");
    assert.equal(variable.supportsAbility, true);
    assert.equal(variable.defaultSelectable, "my_bot");
    assert.match(variable.description, /\S/);
    assert.equal(VISIBLE_STATE_VARIABLES.includes(variable), true);
    const offered = abilityDefinitionsForVariable(variable, ALL_ABILITY_DEFINITIONS.map((ability) => ability.id))
        .map((ability) => ability.id);
    assert.deepEqual(offered, Object.entries(EXPECTED_BASE_RANGES).filter(([, range]) => range != null).map(([id]) => Number(id)));
});

const state = () => stateFromPayload({
    playerModel: { x: 400, y: 400, hp: 100 },
    objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100 }],
});
const condition = (ability, comparator, value, selectable = "my_bot") => ({
    type: "expression", left: "bot.selectedAbilityBaseRange", leftSelectable: selectable, selectable,
    ability, comparator, right: { type: "number", value },
});

test("Base Range evaluates for My Bot and for the opponent", () => {
    assert.equal(evaluateCondition(condition(5, "eq", 700), state()), true);
    assert.equal(evaluateCondition(condition(1, "lt", 100, "opponent_1"), state()), true);
    assert.equal(evaluateCondition(condition(1, "gt", 100, "opponent_1"), state()), false);
});

test("Base Range can be compared against Distance", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression", left: "selectable.distance", selectable1: "my_bot", selectable2: "opponent_1",
            comparator: "lte", right: { type: "variable", value: "bot.selectedAbilityBaseRange" },
            ability: 3, rightSelectable: "my_bot",
        }], actions: [] }] }],
    });
    const stored = normalized.roots[0].branches[0].conditions[0];
    assert.equal(stored.ability, 3);
    assert.equal(evaluateCondition(stored, state()), true);
});

test("Base Range rejects an ability without a range", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [condition(8, "gt", 0)], actions: [] }] }],
    });
    const stored = normalized.roots[0].branches[0].conditions[0];
    assert.notEqual(stored.left, "bot.selectedAbilityBaseRange");
    assert.equal(evaluateCondition(stored, state()), false);
    assert.equal(evaluateCondition(condition(8, "gt", -1), state()), false, "unnormalized no-range ability fails closed");
});
