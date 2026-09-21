import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTutorialArenaShapes, getTutorialScenario, hasTutorialPriorityOrder, TUTORIAL_ACTIONS, TUTORIAL_STEP_COUNT } from "./TutorialPresets.js";
import { normalizeAbilityStrategyConfiguration, selectAbilityStrategyActionPlan } from "../gameArena/botlogic/code/BotCode.js";
import { buildStatePayload } from "../gameArena/modelPayloads/strategyStatePayload.js";
import { stateFromPayload } from "../gameArena/botlogic/code/runtime/runtimeState.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../gameArena/modelPayloads/arenaConstants.js";
import { BOT_CODE_ACTIONS } from "../gameArena/botlogic/code/contracts/BotLogicContracts.js";
import { TUTORIAL_CATEGORIES, TUTORIAL_ENDING, TUTORIAL_INTRODUCTION, TUTORIAL_INTRODUCTION_VISUALS, TUTORIAL_LESSONS, getTutorialLesson } from "./TutorialContent.js";

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
    assert.equal(TUTORIAL_STEP_COUNT, 16);
    assert.deepEqual(
        Array.from({ length: TUTORIAL_STEP_COUNT }, (_, index) => getTutorialScenario(index).id),
        ["arena-basics", "movement", "distance", "basic-strike", "priority", "rotate", "lock-on", "dodge", "combine", "vulnerability-1", "custom-variable", "combo-and-kite", "game-overview", "ability-catalogue", "conditional-catalogue", "puzzles"],
    );
});

test("custom-variable tutorial solution adds one to Variable 1", () => {
    const solution = normalizeAbilityStrategyConfiguration(getTutorialScenario(10).solution);
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

test("vulnerability tutorial configures its attacks and tactics", () => {
    const first = getTutorialScenario(9);
    const [firstPlayer, firstOpponent] = buildTutorialArenaShapes(9);
    const firstConditions = first.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.conditions));
    const firstMovementBranches = first.solution.roots[1].branches;
    const firstSlashConditions = first.solution.roots[3].branches[0].conditions;

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
    assert.equal(firstMovementBranches[0].conditions[0].right.value, 110);
    assert.equal(firstMovementBranches[0].conditions.some((condition) => condition.left === "bot.selectedAbilityOnCooldown" && condition.ability === TUTORIAL_ACTIONS.DASH && condition.leftSelectable === "my_bot"), true);
    assert.equal(firstMovementBranches[2].conditions.some((condition) => condition.left === "bot.selectedAbilityReady" && condition.ability === TUTORIAL_ACTIONS.DASH && condition.leftSelectable === "my_bot"), true);
    assert.deepEqual(firstMovementBranches[2].conditions.map((condition) => condition.join ?? "and"), ["and", "or", "and"]);
    assert.deepEqual(firstSlashConditions.map((condition) => ({ left: condition.left, comparator: condition.comparator, ability: condition.ability, value: condition.right.value })), [{ left: "bot.selectedAbilityCooldownMs", comparator: "gt", ability: TUTORIAL_ACTIONS.HEAVY_SLASH, value: 0.5 }]);

});

test("combo and kite tutorial cycles its combo and responds to edge pressure", () => {
    const scenario = getTutorialScenario(11);
    const [player] = buildTutorialArenaShapes(11);
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

test("new tutorial catalogue has four categories and keeps Some Theories descriptive-only", () => {
    assert.deepEqual(TUTORIAL_CATEGORIES.map((category) => category.id), ["basics", "timing", "arena-edges", "custom-variables"]);
    assert.equal(TUTORIAL_LESSONS.length, 13);
    assert.deepEqual(TUTORIAL_CATEGORIES[0].lessons.map((lesson) => lesson.id), ["first-steps", "retreat", "basic-strike", "dash-basics", "aiming-basics", "lock-on-basics"]);
    assert.equal(getTutorialLesson("some-theories").scenarioId, undefined);
    const firstSteps = getTutorialLesson("first-steps").description.at(-1);
    assert.equal(firstSteps.type, "steps");
    assert.equal(firstSteps.items.at(-1), "Click Play to see your code work");
    assert.equal(TUTORIAL_LESSONS.filter((lesson) => lesson.scenarioId).length, 12);
});

test("tutorial introduction maps node visuals and avoids em dashes", () => {
    assert.deepEqual(Object.values(TUTORIAL_INTRODUCTION_VISUALS), ["root-priorities", "conditional-examples", "action-examples", "configuration-examples", "custom-variable-examples"]);
    assert.equal(TUTORIAL_INTRODUCTION.some((paragraph) => paragraph.includes(String.fromCharCode(0x2014))), false);
    assert.equal(TUTORIAL_ENDING.some((paragraph) => paragraph.includes(String.fromCharCode(0x2014))), false);
});

test("tutorial ending points players to both gameplay catalogues", () => {
    const endingCopy = TUTORIAL_ENDING.join(" ");
    const pageSource = readFileSync(fileURLToPath(new URL("./TutorialPage.jsx", import.meta.url)), "utf8");

    assert.match(endingCopy, /Ability Catalogue/);
    assert.match(endingCopy, /status effect/);
    assert.match(endingCopy, /Conditional Catalogue/);
    assert.match(pageSource, /openCatalogue\("\/ability-catalogue"\)/);
    assert.match(pageSource, /openCatalogue\("\/conditionals"\)/);
    assert.match(pageSource, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
    assert.match(pageSource, />\s*View Ability Catalogue\s*</);
    assert.match(pageSource, />\s*View Conditional Catalogue\s*</);
});

test("new tutorial lessons resolve focused practice presets", () => {
    const fireballs = getTutorialScenario(getTutorialLesson("fireballs-in-range").scenarioId);
    const dontMiss = getTutorialScenario(getTutorialLesson("dont-miss").scenarioId);
    const aiming = getTutorialScenario(getTutorialLesson("aiming-basics").scenarioId);
    const dodging = getTutorialScenario(getTutorialLesson("dodging").scenarioId);
    const abilityVariables = getTutorialScenario(getTutorialLesson("bot-ability-variables").scenarioId);
    const edges = getTutorialScenario(getTutorialLesson("keep-running").scenarioId);
    const customVariables = getTutorialScenario(getTutorialLesson("custom-variable-basics").scenarioId);
    const [dontMissPlayer, dontMissOpponent] = buildTutorialArenaShapes("dont-miss");
    const dontMissBranch = dontMiss.solution.roots[0].branches[0];

    assert.equal(fireballs.playerLoadout, "sandbox:5");
    assert.equal(fireballs.solution.roots[0].branches[1].actions[0].action, TUTORIAL_ACTIONS.FIREBALL);
    assert.equal(dontMiss.playerLoadout, "sandbox:5");
    assert.equal(dontMissBranch.conditions[0].left, "selectable.relativeBearing");
    assert.equal(dontMissBranch.conditions[0].right.value, 10);
    assert.equal(dontMissBranch.actions[0].action, TUTORIAL_ACTIONS.FIREBALL);
    assert.equal(dontMiss.solution.roots[1].branches[0].conditions[0].type, "always");
    assert.equal(dontMiss.solution.roots[1].branches[0].actions[0].action, BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET);
    assert.equal(Math.hypot(
        dontMissPlayer.transform.position.x - dontMissOpponent.transform.position.x,
        dontMissPlayer.transform.position.y - dontMissOpponent.transform.position.y,
    ), 300);
    assert.equal(dontMissPlayer.transform.rotation, 180);
    const [aimingPlayer, aimingOpponent] = buildTutorialArenaShapes("aiming-basics");
    assert.equal(aiming.playerLoadout, "sandbox:5");
    assert.equal(aiming.opponentLoadout, "sandbox:");
    assert.equal(Math.hypot(
        aimingPlayer.transform.position.x - aimingOpponent.transform.position.x,
        aimingPlayer.transform.position.y - aimingOpponent.transform.position.y,
    ), 300);
    assert.deepEqual(aiming.opponentCode.customVariables, [
        { id: "custom.aiming-count", name: "Count", valueType: "number", initialValue: 0 },
        { id: "custom.aiming-lock", name: "Lock", valueType: "boolean", initialValue: false },
    ]);
    assert.equal(aiming.opponentCode.roots.length, 1);
    assert.deepEqual(aiming.opponentCode.roots[0].branches.slice(1).map((branch) => branch.actions[0].movementDirection), [270, 90]);
    const aimingEdgeBranch = aiming.opponentCode.roots[0].branches[0];
    assert.deepEqual(aimingEdgeBranch.conditions.map((condition) => ({ left: condition.left, comparator: condition.comparator, right: condition.right })), [
        { left: "selectable.edgeDistance", comparator: "lte", right: { type: "number", value: 100 } },
        { left: "custom.aiming-lock", comparator: "eq", right: { type: "boolean", value: false } },
    ]);
    assert.deepEqual(aimingEdgeBranch.actions[0].terms.map((term) => term.operator), ["add", "modulo", "modulo"]);
    assert.deepEqual(aimingEdgeBranch.actions[0].terms.map((term) => term.operand.value), [1, 1000, 2]);
    assert.deepEqual(aimingEdgeBranch.actions[1], { action: BOT_CODE_ACTIONS.VARIABLE, variableId: "custom.aiming-lock", value: true });
    assert.deepEqual(aiming.opponentCode.roots[0].branches.slice(1).map((branch) => branch.actions[1]), [
        { action: BOT_CODE_ACTIONS.VARIABLE, variableId: "custom.aiming-lock", value: false },
        { action: BOT_CODE_ACTIONS.VARIABLE, variableId: "custom.aiming-lock", value: false },
    ]);

    const aimingConfiguration = normalizeAbilityStrategyConfiguration(aiming.opponentCode);
    const centerPayload = buildStatePayload(buildTutorialArenaShapes("aiming-basics"), aiming.opponentLoadout, "opponent-model");
    const centerPlan = selectAbilityStrategyActionPlan(aimingConfiguration, centerPayload);
    assert.equal(centerPlan.customVariables["custom.aiming-lock"], false);
    assert.equal(centerPlan.movement.movementDirection, 270);

    const edgeShapes = buildTutorialArenaShapes("aiming-basics").map((shape) => shape.id === "opponent-model" ? { ...shape, x: 100 } : shape);
    const edgePayload = buildStatePayload(edgeShapes, aiming.opponentLoadout, "opponent-model");
    const edgePlan = selectAbilityStrategyActionPlan(aimingConfiguration, edgePayload);
    assert.equal(edgePlan.customVariables["custom.aiming-count"], 1);
    assert.equal(edgePlan.customVariables["custom.aiming-lock"], true);
    assert.equal(edgePlan.movement, undefined);

    const movementPayload = {
        ...edgePayload,
        playerModel: { ...edgePayload.playerModel, customVariables: edgePlan.customVariables },
    };
    const movementPlan = selectAbilityStrategyActionPlan(aimingConfiguration, movementPayload);
    assert.equal(movementPlan.customVariables["custom.aiming-count"], 1);
    assert.equal(movementPlan.customVariables["custom.aiming-lock"], false);
    assert.equal(movementPlan.movement.movementDirection, 90);

    const movedShapes = buildTutorialArenaShapes("aiming-basics").map((shape) => shape.id === "opponent-model" ? { ...shape, x: 115 } : shape);
    const movedPayload = buildStatePayload(movedShapes, aiming.opponentLoadout, "opponent-model");
    movedPayload.playerModel.customVariables = movementPlan.customVariables;
    const movedPlan = selectAbilityStrategyActionPlan(aimingConfiguration, movedPayload);
    assert.equal(movedPlan.customVariables["custom.aiming-count"], 1);
    assert.equal(movedPlan.customVariables["custom.aiming-lock"], false);
    assert.equal(movedPlan.movement.movementDirection, 90);
    assert.equal(dodging.opponentLoadout, "sandbox:4,5");
    assert.equal(dodging.playerHp, 1);
    assert.equal(dodging.opponentCode.roots[0].branches[0].actions[0].action, BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET);
    assert.equal(dodging.opponentCode.roots[1].branches[0].conditions[0].ability, TUTORIAL_ACTIONS.DASH);
    assert.equal(dodging.opponentCode.roots[2].branches[0].conditions[0].ability, TUTORIAL_ACTIONS.DASH);
    assert.deepEqual(dodging.opponentCode.roots.slice(1).flatMap((rootNode) => rootNode.branches[0].actions.map((action) => action.action)), [TUTORIAL_ACTIONS.GRENADE, TUTORIAL_ACTIONS.FIREBALL]);
    assert.equal(abilityVariables.opponentLoadout, "sandbox:7");
    assert.equal(abilityVariables.playerHp, 1);
    assert.equal(edges.opponentCode.roots[1].branches[0].actions[0].action, BOT_CODE_ACTIONS.MOVE_WALK);
    assert.deepEqual(customVariables.solution.customVariables, [{ id: "custom.variable-1", name: "Variable 1", valueType: "number", initialValue: 0 }]);
});
