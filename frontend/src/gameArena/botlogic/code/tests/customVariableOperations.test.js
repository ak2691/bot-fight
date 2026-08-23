import assert from "node:assert/strict";
import test from "node:test";
import {
    CONDITION_COMPARATORS,
    CUSTOM_VARIABLE_OPERATIONS,
    countActionSlots,
    normalizeAbilityStrategyConfiguration,
    selectAbilityStrategyActionPlan,
} from "../BotCode.js";

function payload(customVariables = {}) {
    return {
        playerModel: {
            x: 400,
            y: 400,
            hp: 80,
            abilities: [],
            abilityCooldowns: {},
            customVariables,
        },
        objects: [{
            id: "opponent-model",
            type: "opponentModel",
            x: 600,
            y: 400,
            hp: 100,
        }],
    };
}

function configuration(actions, customVariables = [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: 0 }]) {
    return {
        version: "bot-logic-tree-v1",
        customVariables,
        roots: [{ branches: [{
            id: "variable-action",
            conditions: [{ type: "always" }],
            actions,
            children: [],
        }] }],
    };
}

test("modulo is an allowlisted custom-variable operation, not a condition comparator", () => {
    assert.equal(CONDITION_COMPARATORS.some((comparator) => comparator.id === CUSTOM_VARIABLE_OPERATIONS.MODULO), false);

    const normalized = normalizeAbilityStrategyConfiguration(configuration([
        { action: "variable", variableId: "custom.counter", terms: [
            { operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "number", value: 10 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 5 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.MODULO, operand: { type: "number", value: 4 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.SUBTRACT, operand: { type: "number", value: 1 } },
        ] },
    ]));

    assert.equal(normalized.roots[0].branches[0].actions.length, 1);
    assert.deepEqual(normalized.roots[0].branches[0].actions[0].terms.map((term) => term.operator), ["set", "add", "modulo", "subtract"]);
    assert.equal(countActionSlots(normalized), 4);
    assert.equal(selectAbilityStrategyActionPlan(normalized, payload()).customVariables["custom.counter"], 2);
});

test("custom-variable modulo evaluates signed integer operands from left to right", () => {
    const normalized = normalizeAbilityStrategyConfiguration(configuration([
        { action: "variable", variableId: "custom.counter", terms: [
            { operator: CUSTOM_VARIABLE_OPERATIONS.MODULO, operand: { type: "variable", value: "custom.divisor" } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 1 } },
        ] },
    ], [
        { id: "custom.counter", name: "Counter", valueType: "number", initialValue: -10 },
        { id: "custom.divisor", name: "Divisor", valueType: "number", initialValue: 3 },
    ]));

    assert.equal(selectAbilityStrategyActionPlan(normalized, payload()).customVariables["custom.counter"], 0);
});

test("number values truncate to one decimal and modulo truncates only its operands", () => {
    const normalized = normalizeAbilityStrategyConfiguration(configuration([
        { action: "variable", variableId: "custom.counter", terms: [
            { operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "number", value: 3.29 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.MODULO, operand: { type: "number", value: 2.5 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 2.59 } },
        ] },
    ]));

    assert.deepEqual(normalized.roots[0].branches[0].actions[0].terms.map((term) => term.operand.value), [3.2, 2.5, 2.5]);
    assert.equal(selectAbilityStrategyActionPlan(normalized, payload()).customVariables["custom.counter"], 3.5);

    const initial = normalizeAbilityStrategyConfiguration(configuration([
        { action: "variable", variableId: "custom.counter", terms: [
            { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 0 } },
        ] },
    ], [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: 3.29 }]));
    assert.equal(selectAbilityStrategyActionPlan(initial, payload({ "custom.counter": 3.29 })).customVariables["custom.counter"], 3.2);
});

test("a zero modulo operand is a safe no-op in browser training", () => {
    const normalized = normalizeAbilityStrategyConfiguration(configuration([
        { action: "variable", variableId: "custom.counter", terms: [
            { operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "number", value: 7 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.MODULO, operand: { type: "number", value: 0 } },
            { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 2 } },
        ] },
    ]));

    assert.equal(selectAbilityStrategyActionPlan(normalized, payload()).customVariables["custom.counter"], 9);
});
