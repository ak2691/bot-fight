import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoPlayStartShapes, buildInitialArenaShapes, toSimulationBotShape } from "./arenaShapes.js";
import { PRACTICE_OPPONENT_START, PRACTICE_PLAYER_START } from "./arenaConstants.js";
import { buildTutorialArenaShapes } from "../../tutorial/TutorialPresets.js";

test("resuming autoplay preserves arena entities", () => {
    const shapes = [
        { id: "main", type: "circle", x: 100, y: 100 },
        { id: "mine-1", type: "proximityMine", x: 250, y: 250, armed: true },
        { id: "grenade-1", type: "grenade", x: 300, y: 300, stoppedMs: 400 },
    ];

    const resumed = buildAutoPlayStartShapes(shapes, null, false);

    assert.deepEqual(resumed, shapes);
    assert.notEqual(resumed, shapes);
    assert.notEqual(resumed[1], shapes[1]);
});

test("bot arena shapes group health, stats, transform, and statuses", () => {
    const [player, opponent] = buildInitialArenaShapes(null);

    assert.deepEqual(player.health, { current: 100, max: 100 });
    assert.deepEqual(player.transform.position, { x: 500, y: 500 });
    assert.deepEqual(player.transform.velocity, { x: 0, y: 0 });
    assert.deepEqual(player.statusEffects, []);
    assert.equal(player.hp, undefined);
    assert.equal(player.x, undefined);
    assert.equal(opponent.health.current, 100);
    assert.deepEqual(opponent.transform.position, { x: 500, y: 850 });
});

test("practice defaults use the game-facing bottom player and top opponent slots", () => {
    assert.deepEqual(PRACTICE_PLAYER_START, { x: 500, y: 850, rotation: 0 });
    assert.deepEqual(PRACTICE_OPPONENT_START, { x: 500, y: 150, rotation: 180 });
});

test("tutorial reset includes the three standard abilities without Block charges", () => {
    const [player] = buildTutorialArenaShapes(5);
    const shape = toSimulationBotShape(player);
    assert.deepEqual(shape.abilities, [19, 20, 34]);
    assert.equal(shape.abilityCharges[2], undefined);
});
