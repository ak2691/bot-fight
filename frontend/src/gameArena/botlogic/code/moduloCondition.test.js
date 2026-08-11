import assert from "node:assert/strict";
import test from "node:test";
import {
    CONDITION_COMPARATORS,
    STATE_VARIABLES,
    customVariableDefinitions,
    normalizeAbilityStrategyConfiguration,
    selectAbilityStrategyActionPlan,
} from "./BotCode.js";

function payload(customVariables = {}, playerOverrides = {}) {
    return {
        playerModel: {
            x: 400,
            y: 400,
            hp: 80,
            customVariables,
            ...playerOverrides,
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

function moduloConfiguration(condition) {
    return {
        version: "bot-logic-tree-v1",
        customVariables: [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: -10 }],
        roots: [{ branches: [{ id: "modulo-node", branchType: "if", conditions: [condition], actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward" }], children: [] }] }],
    };
}

function configurationWithBranch(branch) {
    return { version: "bot-logic-tree-v1", roots: [{ branches: [{ branchType: "if", children: [], ...branch }] }] };
}

function firstBranch(configuration) {
    return normalizeAbilityStrategyConfiguration(configuration).roots[0].branches[0];
}

test("modulo is available for numeric variables but not booleans", () => {
    const modulo = CONDITION_COMPARATORS.find((comparator) => comparator.id === "modulo");
    assert.ok(modulo);
    assert.ok(STATE_VARIABLES
        .filter((variable) => variable.valueType === "number")
        .every((variable) => modulo.valueTypes.includes(variable.valueType)));
    assert.equal(customVariableDefinitions({
        customVariables: [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: 0 }],
    })[0].valueType, "number");
    assert.deepEqual(modulo.valueTypes, ["number"]);
});

test("floors modulo operands before evaluating negative JavaScript-compatible remainder", () => {
    const configuration = moduloConfiguration({
        type: "expression",
        left: "custom.counter",
        comparator: "modulo",
        modulo: { divisor: -3.5, comparator: "eq" },
        right: { type: "number", value: -1.5 },
    });

    assert.deepEqual(firstBranch(configuration).conditions[0], {
        type: "expression",
        left: "custom.counter",
        comparator: "modulo",
        right: { type: "number", value: -2 },
        modulo: { divisor: -4, comparator: "eq" },
    });
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary.id, "modulo-node");
});

test("modulo by zero fails closed without blocking an OR branch", () => {
    const zeroModulo = {
        type: "expression",
        left: "my.hp",
        comparator: "modulo",
        modulo: { divisor: 0, comparator: "eq" },
        right: { type: "number", value: 0 },
    };
    assert.equal(selectAbilityStrategyActionPlan(configurationWithBranch({
        id: "zero-only", conditions: [zeroModulo], actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward" }],
    }), payload()).primary, null);

    assert.equal(selectAbilityStrategyActionPlan(configurationWithBranch({
            id: "or-fallback",
            conditions: [zeroModulo, { type: "always", join: "or" }],
            actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward" }],
    }), payload()).primary.id, "or-fallback");
});

test("floors fractional resolved values, including time since start", () => {
    const configuration = configurationWithBranch({
            id: "fractional-left",
            conditions: [{
                type: "expression",
                left: "my.x",
                comparator: "modulo",
                modulo: { divisor: 3.5, comparator: "eq" },
                right: { type: "number", value: 1.5 },
            }],
            actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward" }],
    });
    assert.equal(firstBranch(configuration).conditions[0].modulo.divisor, 3);
    assert.equal(firstBranch(configuration).conditions[0].right.value, 1);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({}, { x: 400.5 })).primary.id, "fractional-left");

    const timeConfiguration = configurationWithBranch({
            id: "elapsed-modulo",
            conditions: [{
                type: "expression",
                left: "match.elapsedSeconds",
                comparator: "modulo",
                modulo: { divisor: 3, comparator: "eq" },
                right: { type: "number", value: 1 },
            }],
            actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward" }],
    });
    assert.equal(selectAbilityStrategyActionPlan(timeConfiguration, payload({}, { matchElapsedMs: 1100 })).primary.id, "elapsed-modulo");
});

test("malformed and recursive modulo conditions normalize to false", () => {
    for (const condition of [
        {
            type: "expression",
            left: "my.hp",
            comparator: "modulo",
            modulo: { divisor: 5, comparator: "modulo" },
            right: { type: "number", value: 0 },
        },
        {
            type: "expression",
            left: "target.exists",
            comparator: "modulo",
            modulo: { divisor: 5, comparator: "eq" },
            right: { type: "number", value: 0 },
        },
        {
            type: "expression",
            left: "my.hp",
            comparator: "modulo",
            right: { type: "number", value: 0 },
        },
    ]) {
        const normalized = normalizeAbilityStrategyConfiguration(configurationWithBranch({
            conditions: [condition], actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward" }],
        }));
        assert.equal(normalized.roots[0].branches[0].conditions[0].left, "match.elapsedSeconds");
        assert.equal(selectAbilityStrategyActionPlan(normalized, payload()).primary, null);
    }
});
