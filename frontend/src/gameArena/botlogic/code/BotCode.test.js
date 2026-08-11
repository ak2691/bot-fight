import assert from "node:assert/strict";
import test from "node:test";
import {
    createDefaultAbilityStrategyConfiguration,
    createCodeRoot,
    countConditionSlots,
    normalizeAbilityStrategyConfiguration,
    normalizeRoots,
    setLogicBranchPriority,
    selectAbilityStrategyActionPlan,
    setLogicRootPriority,
    validateAbilityStrategyConfiguration,
} from "./BotCode.js";
import { getTutorialScenario, TUTORIAL_STEP_COUNT, validateBooleanCustomVariableLesson, validateCustomVariablesLesson, validateSearchNodesLesson } from "../../../tutorial/TutorialPresets.js";

function payload(overrides = {}) {
    return {
        playerModel: { x: 400, y: 400, hp: 100, abilities: ["swing", "concussive_shot"], abilityCooldowns: {}, ...overrides.playerModel },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 180 }],
    };
}

test("empty strategy uses the roots schema", () => {
    const code = createDefaultAbilityStrategyConfiguration();
    assert.deepEqual(code.roots, []);
    assert.equal("columns" in code, false);
});

test("retired blocks and clusters are not migrated", () => {
    const code = normalizeAbilityStrategyConfiguration({
        blocks: [{ action: "swing", conditions: [{ type: "always" }] }],
        clusters: [{ blocks: [{ action: "swing", conditions: [{ type: "always" }] }] }],
    });
    assert.deepEqual(code, {
        version: "bot-logic-tree-v1",
        roots: [],
        customVariables: [],
    });
});

test("retired directional action IDs are not migrated", () => {
    const code = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "move_inward" }], children: [] }] }],
    });
    assert.equal(code.roots[0].branches[0].actions[0].action, "none");
});

test("roots preserve names, IDs, and numeric priority gaps", () => {
    const roots = normalizeRoots([
        { id: "first", name: "Custom name", createdOrder: 4, branches: [] },
        { id: "second", name: "Another name", createdOrder: 9, branches: [] },
    ]);
    assert.deepEqual(roots.map((root) => root.createdOrder), [4, 9]);
    assert.deepEqual(roots.map((root) => root.id), ["first", "second"]);
    assert.deepEqual(roots.map((root) => root.name), ["Custom name", "Another name"]);
    const created = createCodeRoot(2);
    assert.equal(created.createdOrder, 2);
    assert.equal(created.name, "Root");
    assert.match(created.id, /^root-/);
});

test("numeric conditional order selects a later conditional", () => {
    const configuration = {
        roots: [{
            branches: [
                { id: "first", branchType: "if", createdOrder: 0, conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 1 } }], actions: [{ action: "swing" }] },
                { id: "second", branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] },
            ],
        }],
    };
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[1].branchType, "if");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).ability.action, 9);
});

test("root priority reorders roots and execution", () => {
    const roots = [
        { createdOrder: 0, branches: [{ id: "fire", conditions: [{ type: "always" }], actions: [{ action: "swing" }] }] },
        { createdOrder: 1, branches: [{ id: "concussive", conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] }] },
    ];
    const reordered = setLogicRootPriority(roots, 1, 1);
    assert.equal(reordered[0].branches[0].id, "concussive");
    assert.deepEqual(reordered.map((root) => root.createdOrder), [0, 1]);
    assert.equal(selectAbilityStrategyActionPlan({ roots: reordered }, payload()).ability.action, 9);
});

test("conditional priority switches siblings without renumbering them", () => {
    const roots = [{ createdOrder: 0, branches: [
        { id: "first", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [] },
        { id: "third", branchType: "if", createdOrder: 2, conditions: [{ type: "always" }], actions: [] },
    ] }];
    const switched = setLogicBranchPriority(roots, 0, [1], 1);
    assert.deepEqual(switched[0].branches.map((branch) => branch.id), ["third", "first"]);
    assert.deepEqual(switched[0].branches.map((branch) => branch.createdOrder), [0, 2]);
});

test("tutorial teaches rotate before lock on", () => {
    const rotateScenario = getTutorialScenario(2);
    const lockOnScenario = getTutorialScenario(3);
    const dodgeScenario = getTutorialScenario(4);
    const combineScenario = getTutorialScenario(5);
    const rotateActions = rotateScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    const lockOnActions = lockOnScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    assert.equal(rotateActions.some((action) => action.action === "rotate_toward_enemy"), true);
    assert.equal(lockOnActions.some((action) => action.action === 20), true);
    assert.equal(rotateScenario.durationMs, 2000);
    assert.equal(lockOnScenario.durationMs, 1000);
    assert.equal(rotateScenario.goal, "heavy_slash");
    assert.equal(lockOnScenario.goal, "heavy_slash");
    assert.equal(dodgeScenario.durationMs, 3000);
    assert.equal(combineScenario.durationMs, 3000);
    assert.equal(dodgeScenario.goal, "dodge_grenade");
});

test("boolean custom-variable lesson replaces Heavy Slash conditions", () => {
    const configuration = getTutorialScenario(7).solution;
    assert.equal(getTutorialScenario(7).goal, "custom_boolean");
    assert.equal(validateBooleanCustomVariableLesson(configuration), true);
});

test("integer custom-variable lesson accepts opponent damage-taken as the hit counter trigger", () => {
    const configuration = getTutorialScenario(8).solution;
    configuration.roots[0].branches[0].conditions[0] = {
        type: "expression",
        left: "opponent.damageTakenLastTick",
        comparator: "gt",
        right: { type: "number", value: 0 },
    };
    assert.equal(validateCustomVariablesLesson(configuration), true);
});

test("tutorial roots are named and search validation preserves their priorities", () => {
    const scenario = getTutorialScenario(9);
    assert.equal(TUTORIAL_STEP_COUNT, 12);
    assert.deepEqual(scenario.emptyCode.roots.map((root) => root.name), ["A", "E", "C", "D", "H", "F", "G", "K", "I", "J", "N", "L", "M", "B", "O", "P", "Q", "R", "S", "T"]);
    assert.deepEqual(scenario.solution.roots.map((root) => root.createdOrder), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18]);
    assert.equal(validateSearchNodesLesson(scenario.emptyCode), false);
    assert.equal(validateSearchNodesLesson(scenario.solution), true);
});

test("roots count conditions and validate as a trainable code", () => {
    const configuration = {
        roots: [{ createdOrder: 0, branches: [{ id: "branch", branchType: "if", conditions: [{ type: "always" }], actions: [{ action: "swing" }], children: [] }] }],
    };
    assert.equal(countConditionSlots(configuration), 1);
    assert.deepEqual(validateAbilityStrategyConfiguration(configuration).errors, []);
});
