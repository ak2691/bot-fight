import assert from "node:assert/strict";
import test from "node:test";
import { buildTutorialArenaShapes, getTutorialScenario, hasTutorialPriorityOrder, TUTORIAL_ACTIONS, TUTORIAL_STEP_COUNT } from "./TutorialPresets.js";
import { normalizeAbilityStrategyConfiguration, selectAbilityStrategyActionPlan } from "../gameArena/botlogic/code/BotCode.js";
import { buildStatePayload } from "../gameArena/modelPayloads/strategyStatePayload.js";
import { stateFromPayload } from "../gameArena/botlogic/code/runtime/runtimeState.js";

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
    assert.equal(TUTORIAL_STEP_COUNT, 14);
    assert.deepEqual(
        Array.from({ length: TUTORIAL_STEP_COUNT }, (_, index) => getTutorialScenario(index).id),
        ["arena-basics", "movement", "distance", "basic-strike", "rotate", "lock-on", "dodge", "combine", "custom-variable", "priority", "game-overview", "ability-catalogue", "conditional-catalogue", "puzzles"],
    );
});

test("custom-variable tutorial solution adds one to Variable 1", () => {
    const solution = normalizeAbilityStrategyConfiguration(getTutorialScenario(8).solution);
    const plan = selectAbilityStrategyActionPlan(solution, emptyPayload);

    assert.deepEqual(solution.customVariables, [{ id: "custom.variable-1", name: "Variable 1", valueType: "number", initialValue: 0 }]);
    assert.equal(plan.customVariables["custom.variable-1"], 1);
});

test("tutorial presets use the current tree and selectable payload shapes", () => {
    const empty = getTutorialScenario(0).emptyCode;
    const solution = getTutorialScenario(4).solution;
    const closeCondition = solution.roots[1].branches[0].conditions[0];
    const strikeCondition = solution.roots[2].branches[0].conditions[1];
    const strikeAction = solution.roots[2].branches[0].actions[0];

    assert.deepEqual(Object.keys(empty).sort(), ["customVariables", "roots", "version"]);
    assert.deepEqual(
        { selectable1: closeCondition.selectable1, selectable2: closeCondition.selectable2 },
        { selectable1: "my_bot", selectable2: "opponent_1" },
    );
    assert.equal(closeCondition.leftSelectable, undefined);
    assert.equal(strikeCondition.leftSelectable, undefined);
    assert.equal(strikeAction.action, TUTORIAL_ACTIONS.HEAVY_SLASH);
    assert.equal(strikeAction.actionTarget, undefined);
});

test("tutorial arena uses standard offline bot labels and exposes its opponent", () => {
    const shapes = buildTutorialArenaShapes(0);
    const payload = buildStatePayload(shapes, shapes.find((shape) => shape.id === "main")?.combatLoadout);
    const opponent = payload.objects.find((object) => object.id === "opponent-model");

    assert.deepEqual(shapes.map((shape) => shape.username), ["My Bot", "Opponent 1"]);
    assert.equal(opponent?.type, "opponentModel");
    assert.equal(opponent?.role, "opponent");
    assert.equal(opponent?.botIndex, 1);
    assert.equal(stateFromPayload(payload).opponent?.id, "opponent-model");
});

test("tutorial priority lesson starts with Dash first and solution swaps only priorities", () => {
    const starting = getTutorialScenario(9).emptyCode;
    const solution = getTutorialScenario(9).solution;

    assert.equal(hasTutorialPriorityOrder(starting, TUTORIAL_ACTIONS.DASH, TUTORIAL_ACTIONS.LOCK_ON), true);
    assert.equal(hasTutorialPriorityOrder(starting, TUTORIAL_ACTIONS.LOCK_ON, TUTORIAL_ACTIONS.DASH), false);
    assert.equal(hasTutorialPriorityOrder(solution, TUTORIAL_ACTIONS.LOCK_ON, TUTORIAL_ACTIONS.DASH), true);
    assert.deepEqual(solution.roots.map((root) => root.id), starting.roots.map((root) => root.id));
});

test("tutorial solutions use the relaxed bearing and context-aware dashes", () => {
    const dodge = getTutorialScenario(6).solution;
    const dodgeAction = dodge.roots[0].branches[0].actions[0];
    const combine = getTutorialScenario(7).solution;
    const heavySlashRoot = combine.roots[0];
    const combineDash = combine.roots[1].branches[0].actions[0];
    const slash = heavySlashRoot.branches[0].conditions[1];

    assert.deepEqual(dodgeAction, { action: TUTORIAL_ACTIONS.DASH, movementMode: "target", movementDirection: 90, selectable: "opponent_1" });
    assert.deepEqual(combineDash, { action: TUTORIAL_ACTIONS.DASH, movementMode: "target", movementDirection: 90, selectable: "opponent_1_grenade" });
    assert.equal(heavySlashRoot.priority, 1);
    assert.equal(heavySlashRoot.branches[0].actions[0].action, TUTORIAL_ACTIONS.HEAVY_SLASH);
    assert.equal(slash.right.value, 75);
});
