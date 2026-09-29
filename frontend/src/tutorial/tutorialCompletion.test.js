import assert from "node:assert/strict";
import test from "node:test";
import { advanceArenaPreviewTick } from "../gameArena/modelPayloads/arenaPreviewSimulation.js";
import { createPreviewBaseline, restorePreviewBaseline } from "../gameArena/modelPayloads/previewBaseline.js";
import { toSimulationBotShape } from "../gameArena/modelPayloads/arenaShapes.js";
import { sanitizeStrategyConfigurationForLoadout } from "../gameArena/persistence/arenaStrategyStorage.js";
import { TUTORIAL_COMPLETION_PREFIX, loadTutorialBooleanState } from "../gameArena/persistence/tutorialStorage.js";
import { buildTutorialArenaShapes, getTutorialScenario, TUTORIAL_ACTIONS } from "./TutorialPresets.js";
import { completeTutorialGoal } from "./tutorialCompletion.js";

function memoryStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); },
    };
}

function tick(shapes, scenario, playerCode = scenario.emptyCode) {
    return advanceArenaPreviewTick(shapes, {
        selectedLoadout: scenario.playerLoadout,
        opponentLoadout: scenario.opponentLoadout,
        testingConfiguration: playerCode,
        opponentTestingConfiguration: scenario.opponentCode,
    });
}

function dontMissScenario() {
    const scenario = getTutorialScenario("dont-miss");
    return {
        ...scenario,
        opponentCode: sanitizeStrategyConfigurationForLoadout(scenario.opponentCode, scenario.opponentLoadout),
    };
}

function opponentState(shapes) {
    return toSimulationBotShape(shapes.find((shape) => shape.id === "opponent-model"));
}

test("Don't Miss keeps Opponent 1 completely still at its original position", () => {
    const scenario = dontMissScenario();
    const initialShapes = buildTutorialArenaShapes("dont-miss");
    const [player, opponent] = initialShapes;
    const initialOpponent = opponentState(initialShapes);

    assert.equal(scenario.goal, "fireball_hit");
    assert.equal(scenario.playerLoadout, "sandbox:5");
    assert.equal(scenario.opponentLoadout, "sandbox:");
    assert.deepEqual(scenario.opponentCode.customVariables, []);
    assert.deepEqual(scenario.opponentCode.roots, []);
    assert.equal(Math.hypot(
        player.transform.position.x - opponent.transform.position.x,
        player.transform.position.y - opponent.transform.position.y,
    ), 300);
    assert.deepEqual(opponent.transform.position, { x: 600, y: 450 });
    assert.deepEqual([player.transform.rotation, opponent.transform.rotation], [180, 180]);

    let shapes = initialShapes;
    for (let tickNumber = 0; tickNumber < 120; tickNumber += 1) shapes = tick(shapes, scenario);
    const stationaryOpponent = opponentState(shapes);

    assert.deepEqual(
        [stationaryOpponent.x, stationaryOpponent.y, stationaryOpponent.rotation],
        [initialOpponent.x, initialOpponent.y, initialOpponent.rotation],
    );
    assert.equal(stationaryOpponent.triggeredAbility, null);
    assert.equal(stationaryOpponent.dashRemaining ?? 0, 0);
    assert.deepEqual(stationaryOpponent.customVariables, {});
});

test("Don't Miss pause, resume, and Reset Stats preserve the stationary opponent baseline", () => {
    const scenario = dontMissScenario();
    const initialShapes = buildTutorialArenaShapes("dont-miss");
    const baseline = createPreviewBaseline(initialShapes);
    let shapes = initialShapes;

    for (let tickNumber = 0; tickNumber < 68; tickNumber += 1) shapes = tick(shapes, scenario);
    const beforePause = opponentState(shapes);
    shapes = tick(shapes, scenario);
    const afterResume = opponentState(shapes);
    assert.deepEqual(
        [afterResume.x, afterResume.y, afterResume.rotation],
        [beforePause.x, beforePause.y, beforePause.rotation],
    );

    let sawFireball = false;
    for (let tickNumber = 0; tickNumber < 30; tickNumber += 1) {
        shapes = tick(shapes, scenario, scenario.solution);
        if (shapes.some((shape) => Number(shape.abilityId) === TUTORIAL_ACTIONS.FIREBALL)) {
            sawFireball = true;
            break;
        }
    }
    assert.equal(sawFireball, true, "the reset fixture contains a live Fireball projectile");

    const reset = restorePreviewBaseline(baseline);
    assert.deepEqual(reset.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.deepEqual(reset.map((shape) => {
        const bot = toSimulationBotShape(shape);
        return [bot.x, bot.y, bot.rotation, bot.hp, bot.statusEffects.length];
    }), initialShapes.map((shape) => {
        const bot = toSimulationBotShape(shape);
        return [bot.x, bot.y, bot.rotation, bot.hp, bot.statusEffects.length];
    }));
});

test("Don't Miss supplied solution completes only after a Fireball hits the stationary opponent", () => {
    const scenario = dontMissScenario();
    const initialShapes = buildTutorialArenaShapes("dont-miss");
    const playerFireballBranch = scenario.solution.roots[0].branches[0];
    const aimBranch = scenario.solution.roots[1].branches[0];
    const previousStorage = globalThis.localStorage;
    const storage = memoryStorage();
    globalThis.localStorage = storage;

    try {
        assert.equal(playerFireballBranch.conditions[0].left, "selectable.relativeBearing");
        assert.equal(playerFireballBranch.conditions[0].comparator, "lte");
        assert.equal(playerFireballBranch.conditions[0].right.value, 10);
        assert.equal(playerFireballBranch.actions[0].action, TUTORIAL_ACTIONS.FIREBALL);
        assert.equal(aimBranch.conditions[0].type, "always");
        assert.equal(aimBranch.actions[0].action, "rotate_toward_enemy");
        assert.equal(completeTutorialGoal(scenario, initialShapes, "dont-miss"), false);

        let shapes = initialShapes;
        let completedAtTick = null;
        for (let tickNumber = 1; tickNumber <= 1200; tickNumber += 1) {
            shapes = tick(shapes, scenario, scenario.solution);
            if (completeTutorialGoal(scenario, shapes, "dont-miss")) {
                completedAtTick = tickNumber;
                break;
            }
        }

        const opponent = opponentState(shapes);
        assert.ok(completedAtTick != null, "the configured solution eventually hits the opponent");
        assert.deepEqual([opponent.x, opponent.y], [600, 450]);
        assert.ok(opponent.health.current < opponent.health.max, "the completed lesson records Fireball damage");
        assert.equal(loadTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, "dont-miss"), true);
        assert.equal(completeTutorialGoal(scenario, shapes, "dont-miss"), false);
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
});
