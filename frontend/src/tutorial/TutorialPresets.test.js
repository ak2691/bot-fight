import assert from "node:assert/strict";
import test from "node:test";
import { getTutorialScenario, hasTutorialPriorityOrder, TUTORIAL_STEP_COUNT } from "./TutorialPresets.js";
import { normalizeAbilityStrategyConfiguration, selectAbilityStrategyActionPlan } from "../gameArena/botlogic/code/BotCode.js";

const emptyPayload = {
    playerModel: {
        x: 400,
        y: 400,
        hp: 80,
        abilities: [],
        abilityCooldowns: {},
        customVariables: {},
    },
    objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100 }],
};

test("tutorial scenarios follow the reordered lesson sequence", () => {
    assert.equal(TUTORIAL_STEP_COUNT, 13);
    assert.deepEqual(
        Array.from({ length: TUTORIAL_STEP_COUNT }, (_, index) => getTutorialScenario(index).id),
        ["movement", "distance", "basic-strike", "rotate", "lock-on", "dodge", "combine", "custom-variable", "priority", "game-overview", "ability-catalogue", "conditional-catalogue", "puzzles"],
    );
});

test("custom-variable tutorial solution adds one to Variable 1", () => {
    const solution = normalizeAbilityStrategyConfiguration(getTutorialScenario(7).solution);
    const plan = selectAbilityStrategyActionPlan(solution, emptyPayload);

    assert.deepEqual(solution.customVariables, [{ id: "custom.variable-1", name: "Variable 1", valueType: "number", initialValue: 0 }]);
    assert.equal(plan.customVariables["custom.variable-1"], 1);
});

test("tutorial priority lesson starts with Dash first and solution swaps only priorities", () => {
    const starting = getTutorialScenario(8).emptyCode;
    const solution = getTutorialScenario(8).solution;

    assert.equal(hasTutorialPriorityOrder(starting, 19, 20), true);
    assert.equal(hasTutorialPriorityOrder(starting, 20, 19), false);
    assert.equal(hasTutorialPriorityOrder(solution, 20, 19), true);
    assert.deepEqual(solution.roots.map((root) => root.id), starting.roots.map((root) => root.id));
});

test("tutorial solutions use the relaxed bearing and context-aware dashes", () => {
    const dodge = getTutorialScenario(5).solution;
    const dodgeAction = dodge.roots[0].branches[0].actions[0];
    const combine = getTutorialScenario(6).solution;
    const combineDash = combine.roots[0].branches[0].actions[0];
    const slash = combine.roots.at(-1).branches[0].conditions[1];

    assert.deepEqual(dodgeAction, { action: 19, movementMode: "target", movementDirection: 90, actionTarget: "opponent" });
    assert.deepEqual(combineDash, { action: 19, movementMode: "target", movementDirection: 90, actionTarget: "opponent_grenade" });
    assert.equal(slash.right.value, 75);
});
