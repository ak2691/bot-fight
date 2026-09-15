import assert from "node:assert/strict";
import test from "node:test";
import { buildTutorialArenaShapes, getTutorialScenario, hasTutorialPriorityOrder, TUTORIAL_ACTIONS, TUTORIAL_STEP_COUNT } from "./TutorialPresets.js";
import { normalizeAbilityStrategyConfiguration, selectAbilityStrategyActionPlan } from "../gameArena/botlogic/code/BotCode.js";
import { buildStatePayload } from "../gameArena/modelPayloads/strategyStatePayload.js";
import { stateFromPayload } from "../gameArena/botlogic/code/runtime/runtimeState.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../gameArena/modelPayloads/arenaConstants.js";
import { BOT_CODE_ACTIONS } from "../gameArena/botlogic/code/contracts/BotLogicContracts.js";

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
    assert.equal(TUTORIAL_STEP_COUNT, 18);
    assert.deepEqual(
        Array.from({ length: TUTORIAL_STEP_COUNT }, (_, index) => getTutorialScenario(index).id),
        ["arena-basics", "movement", "distance", "basic-strike", "priority", "rotate", "lock-on", "dodge", "combine", "orbiting", "vulnerability-1", "vulnerability-2", "custom-variable", "combo-and-kite", "game-overview", "ability-catalogue", "conditional-catalogue", "puzzles"],
    );
});

test("custom-variable tutorial solution adds one to Variable 1", () => {
    const solution = normalizeAbilityStrategyConfiguration(getTutorialScenario(12).solution);
    const plan = selectAbilityStrategyActionPlan(solution, emptyPayload);

    assert.deepEqual(solution.customVariables, [{ id: "custom.variable-1", name: "Variable 1", valueType: "number", initialValue: 0 }]);
    assert.equal(plan.customVariables["custom.variable-1"], 1);
});

test("tutorial presets use the current tree and selectable payload shapes", () => {
    const empty = getTutorialScenario(0).emptyCode;
    const solution = getTutorialScenario(5).solution;
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

test("tutorial arena starts use the current arena center and preserve lesson spacing", () => {
    const shapes = buildTutorialArenaShapes(3);
    const centerX = ARENA_WIDTH_UNITS / 2;
    const centerY = ARENA_HEIGHT_UNITS / 2;

    assert.equal(shapes[0].transform.position.x, centerX);
    assert.equal(shapes[0].spawnX, centerX);
    assert.equal(shapes[0].transform.position.y, centerY + 60);
    assert.equal(shapes[0].spawnY, centerY + 60);
    assert.equal(shapes[1].transform.position.x, centerX);
    assert.equal(shapes[1].spawnX, centerX);
    assert.equal(shapes[1].transform.position.y, centerY);
    assert.equal(shapes[1].spawnY, centerY);
    assert.ok(shapes[0].transform.position.y > shapes[1].transform.position.y);
});

test("My Bot starts below the opponent in every tutorial lesson", () => {
    for (let step = 0; step < TUTORIAL_STEP_COUNT; step += 1) {
        const [player, opponent] = buildTutorialArenaShapes(step);
        assert.ok(player.transform.position.y > opponent.transform.position.y, getTutorialScenario(step).id);
    }
});

test("orbiting tutorial equips Slash and encodes the tactical solution", () => {
    const scenario = getTutorialScenario(9);
    const solution = normalizeAbilityStrategyConfiguration(scenario.solution);
    const actions = solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions));

    assert.equal(scenario.id, "orbiting");
    assert.equal(scenario.goal, "defeat_opponent");
    assert.equal(scenario.playerLoadout, "sandbox:1");
    assert.equal(scenario.opponentLoadout, "sandbox:1");
    assert.equal(actions.some((action) => action.action === TUTORIAL_ACTIONS.DASH && action.movementDirection === 45), true);
    assert.equal(actions.some((action) => action.action === TUTORIAL_ACTIONS.LOCK_ON), true);
    assert.equal(actions.some((action) => action.action === TUTORIAL_ACTIONS.SLASH), true);
    assert.equal(actions.some((action) => action.action === TUTORIAL_ACTIONS.BASIC_STRIKE), true);
});

test("vulnerability tutorials configure their distinct attacks and tactics", () => {
    const first = getTutorialScenario(10);
    const second = getTutorialScenario(11);
    const [firstPlayer, firstOpponent] = buildTutorialArenaShapes(10);
    const firstConditions = first.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.conditions));
    const firstMovementBranches = first.solution.roots[1].branches;
    const firstSlashConditions = first.solution.roots[3].branches[0].conditions;
    const secondConditions = second.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.conditions));
    const secondActions = second.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions));
    const secondRootOne = second.solution.roots[0].branches;

    assert.equal(first.id, "vulnerability-1");
    assert.equal(first.goal, "defeat_opponent_survive");
    assert.equal(firstPlayer.hp, 40);
    assert.equal(firstPlayer.maxHp, 150);
    assert.equal(firstPlayer.transform.position.y - firstOpponent.transform.position.y, 300);
    assert.equal(first.opponentLoadout, "sandbox:7,13");
    assert.equal(first.solution.roots.length, 4);
    assert.equal(firstConditions.some((condition) => condition.left === "bot.selectedAbilityPreparationMs" && condition.ability === TUTORIAL_ACTIONS.RAIL_SHOT && condition.right.value === 0.2), true);
    assert.deepEqual(first.solution.roots[0].branches.map((branch) => branch.actions[0].movementDirection), [90, 180]);
    assert.deepEqual(first.solution.roots[0].branches.map((branch) => branch.actions.length), [1, 1]);
    assert.deepEqual(firstMovementBranches.map((branch) => branch.actions[0].movementDirection), [120, 90, 30, 90]);
    assert.equal(firstMovementBranches[0].conditions.some((condition) => condition.left === "bot.selectedAbilityOnCooldown" && condition.ability === TUTORIAL_ACTIONS.DASH && condition.leftSelectable === "my_bot"), true);
    assert.equal(firstMovementBranches[2].conditions.some((condition) => condition.left === "bot.selectedAbilityReady" && condition.ability === TUTORIAL_ACTIONS.DASH && condition.leftSelectable === "my_bot"), true);
    assert.deepEqual(firstMovementBranches[2].conditions.map((condition) => condition.join ?? "and"), ["and", "or", "and"]);
    assert.deepEqual(firstSlashConditions.map((condition) => ({ left: condition.left, comparator: condition.comparator, ability: condition.ability, value: condition.right.value })), [{ left: "bot.selectedAbilityCooldownMs", comparator: "gt", ability: TUTORIAL_ACTIONS.HEAVY_SLASH, value: 0.5 }]);

    assert.equal(second.id, "vulnerability-2");
    assert.equal(second.opponentLoadout, "sandbox:6,7");
    assert.equal(buildTutorialArenaShapes(11)[0].hp, 40);
    assert.equal(buildTutorialArenaShapes(11)[0].maxHp, 150);
    assert.equal(second.solution.roots.length, 5);
    assert.equal(secondConditions.some((condition) => condition.left === "bot.selectedAbilityReady" && condition.ability === TUTORIAL_ACTIONS.STUN), true);
    assert.equal(secondConditions.some((condition) => condition.left === "bot.selectedAbilityOnCooldown" && condition.ability === TUTORIAL_ACTIONS.HEAVY_SLASH), true);
    assert.equal(secondActions.some((action) => action.action === TUTORIAL_ACTIONS.DASH && action.movementDirection === 0), true);
    assert.deepEqual(secondRootOne[0].conditions.map((condition) => condition.left), ["selectable.distance", "bot.selectedAbilityReady"]);
    assert.deepEqual(secondRootOne[1].actions.map((action) => [action.action, action.movementDirection]), [[TUTORIAL_ACTIONS.DASH, 180], [BOT_CODE_ACTIONS.MOVE_WALK, 180]]);
    assert.deepEqual(secondRootOne[2].conditions.map((condition) => condition.join ?? "and"), ["and", "and", "or", "and", "and"]);
    assert.equal(second.solution.roots[1].branches[0].conditions[0].right.value, 120);
    assert.equal(second.solution.roots[3].branches[0].conditions[0].right.value, 0.5);
    assert.equal(second.solution.roots[4].branches[0].conditions[0].right.value, 90);
});

test("combo and kite tutorial cycles its combo and responds to edge pressure", () => {
    const scenario = getTutorialScenario(13);
    const [player] = buildTutorialArenaShapes(13);
    const solution = normalizeAbilityStrategyConfiguration(scenario.solution);
    const comboBranches = solution.roots[0].branches;
    const allActions = solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions));

    assert.equal(scenario.id, "combo-and-kite");
    assert.equal(scenario.playerLoadout, "sandbox:6,7,18");
    assert.equal(scenario.opponentLoadout, "sandbox:1");
    assert.equal(player.hp, 1);
    assert.equal(player.maxHp, 150);
    assert.deepEqual(solution.customVariables, [{ id: "custom.combo-step", name: "Combo Step", valueType: "number", initialValue: 0 }]);
    assert.deepEqual(comboBranches.map((branch) => branch.actions[0].action), [TUTORIAL_ACTIONS.STUN, TUTORIAL_ACTIONS.HEAVY_SLASH]);
    assert.deepEqual(comboBranches.map((branch) => branch.conditions[1].right.value), [0, 1]);
    assert.equal(comboBranches[1].conditions[0].right.value, 100);
    assert.equal(allActions.some((action) => action.action === TUTORIAL_ACTIONS.WIND_BURST), true);
    assert.equal(allActions.some((action) => action.action === TUTORIAL_ACTIONS.DASH && action.movementDirection === 180), true);
    assert.equal(solution.roots[1].branches[0].conditions[0].comparator, "neq");
    assert.equal(solution.roots[1].branches[0].conditions[1].right.value, 80);
    assert.deepEqual(solution.roots[2].branches.map((branch) => branch.actions[0].movementDirection), [120, 0, 180]);
    assert.equal(solution.roots[2].branches[2].conditions[2].left, "custom.combo-step");
    assert.equal(solution.roots[4].branches[0].conditions[0].right.value, 150);
    assert.equal(solution.roots[4].branches[0].conditions[2].left, "custom.combo-step");
    assert.equal(scenario.opponentCode.roots.some((root) => root.branches.some((branch) => branch.actions.some((action) => action.action === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET))), true);
});

test("tutorial priority lesson starts with Dash first and solution swaps only priorities", () => {
    const starting = getTutorialScenario(4).emptyCode;
    const solution = getTutorialScenario(4).solution;

    assert.equal(hasTutorialPriorityOrder(starting, TUTORIAL_ACTIONS.DASH, TUTORIAL_ACTIONS.LOCK_ON), true);
    assert.equal(hasTutorialPriorityOrder(starting, TUTORIAL_ACTIONS.LOCK_ON, TUTORIAL_ACTIONS.DASH), false);
    assert.equal(hasTutorialPriorityOrder(solution, TUTORIAL_ACTIONS.LOCK_ON, TUTORIAL_ACTIONS.DASH), true);
    assert.deepEqual(solution.roots.map((root) => root.id), starting.roots.map((root) => root.id));
});

test("tutorial solutions use the relaxed bearing and context-aware dashes", () => {
    const dodge = getTutorialScenario(7).solution;
    const dodgeAction = dodge.roots[0].branches[0].actions[0];
    const combine = getTutorialScenario(8).solution;
    const heavySlashRoot = combine.roots[0];
    const combineDash = combine.roots[1].branches[0].actions[0];
    const slash = heavySlashRoot.branches[0].conditions[1];

    assert.deepEqual(dodgeAction, { action: TUTORIAL_ACTIONS.DASH, movementMode: "target", movementDirection: 90, selectable: "opponent_1" });
    assert.deepEqual(combineDash, { action: TUTORIAL_ACTIONS.DASH, movementMode: "target", movementDirection: 90, selectable: "opponent_1_grenade" });
    assert.equal(heavySlashRoot.priority, 1);
    assert.equal(heavySlashRoot.branches[0].actions[0].action, TUTORIAL_ACTIONS.HEAVY_SLASH);
    assert.equal(slash.right.value, 75);
});
