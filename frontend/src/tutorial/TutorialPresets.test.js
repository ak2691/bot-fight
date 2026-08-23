import assert from "node:assert/strict";
import test from "node:test";
import { getTutorialScenario, TUTORIAL_STEP_COUNT } from "./TutorialPresets.js";
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
        ["movement", "distance", "basic-strike", "rotate", "lock-on", "dodge", "combine", "custom-variable", "search-roots", "game-overview", "ability-catalogue", "conditional-catalogue", "puzzles"],
    );
});

test("custom-variable tutorial solution adds one to Variable 1", () => {
    const solution = normalizeAbilityStrategyConfiguration(getTutorialScenario(7).solution);
    const plan = selectAbilityStrategyActionPlan(solution, emptyPayload);

    assert.deepEqual(solution.customVariables, [{ id: "custom.variable-1", name: "Variable 1", valueType: "number", initialValue: 0 }]);
    assert.equal(plan.customVariables["custom.variable-1"], 1);
});
