import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoPlayStartShapes, buildInitialArenaShapes, buildMatchSpawnShapes, toSimulationBotShape } from "./arenaShapes.js";
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

    assert.deepEqual(player.health, { current: 300, max: 300 });
    assert.deepEqual(player.transform.position, { x: 600, y: 600 });
    assert.deepEqual(player.transform.velocity, { x: 0, y: 0 });
    assert.deepEqual(player.statusEffects, []);
    assert.equal(player.hp, undefined);
    assert.equal(player.x, undefined);
    assert.equal(opponent.health.current, 300);
    assert.deepEqual(opponent.transform.position, { x: 600, y: 1050 });
});

test("practice defaults use the game-facing bottom player and top opponent slots", () => {
    assert.deepEqual(PRACTICE_PLAYER_START, { x: 600, y: 1050, rotation: 0 });
    assert.deepEqual(PRACTICE_OPPONENT_START, { x: 600, y: 150, rotation: 180 });
});

test("tutorial reset includes the standard ability without Block charges", () => {
    const [player] = buildTutorialArenaShapes("first-steps");
    const shape = toSimulationBotShape(player);
    assert.deepEqual(shape.abilities, [19]);
    assert.equal(shape.abilityCharges[2], undefined);
});

test("match spawn shapes assign stable slots and spread each team across its row", () => {
    const shapes = buildMatchSpawnShapes({
        matchId: "match-2v2",
        player: { userId: "user-1", username: "One", slot: 1, teamNumber: 1, selectedLoadout: "melee" },
        loadout: "melee",
        players: [
            { userId: "user-1", username: "One", slot: 1, teamNumber: 1, selectedLoadout: "melee" },
            { userId: "user-2", username: "Two", slot: 2, teamNumber: 1, selectedLoadout: "melee" },
            { userId: "user-3", username: "Three", slot: 3, teamNumber: 2, selectedLoadout: "melee" },
            { userId: "user-4", username: "Four", slot: 4, teamNumber: 2, selectedLoadout: "melee" },
        ],
    }).map(toSimulationBotShape);

    assert.deepEqual(shapes.map((shape) => [shape.id, shape.slot, shape.teamNumber]), [
        ["main", 1, 1],
        ["bot-user-2", 2, 1],
        ["bot-user-3", 3, 2],
        ["bot-user-4", 4, 2],
    ]);
    assert.deepEqual(shapes.map((shape) => [shape.x, shape.y, shape.rotation]), [
        [400, 150, 180],
        [800, 150, 180],
        [400, 1050, 0],
        [800, 1050, 0],
    ]);
    assert.deepEqual(shapes.map((shape) => shape.locked), [false, true, true, true]);
    assert.deepEqual(shapes.map((shape) => shape.isCurrentUser), [true, false, false, false]);
});

test("match spawn shapes start from the frozen end of the last segment when the server sends one", () => {
    const players = [
        { userId: "u1", username: "One", slot: 1, teamNumber: 1, selectedLoadout: "melee" },
        { userId: "u2", username: "Two", slot: 2, teamNumber: 2, selectedLoadout: "melee" },
    ];
    const shapes = buildMatchSpawnShapes({
        matchId: "m",
        player: players[0],
        loadout: "melee",
        players,
        timedRounds: {
            segmentEndState: [
                { slot: 1, x: 500, y: 600, rotation: 45, hp: 120, stamina: 40 },
                { slot: 2, x: 700, y: 650, rotation: 200, hp: 80, stamina: 0 },
            ],
        },
    }).map(toSimulationBotShape);
    assert.deepEqual(shapes.map((shape) => [shape.x, shape.y, shape.rotation, shape.hp, shape.stamina]), [
        [500, 600, 45, 120, 40],
        [700, 650, 200, 80, 0],
    ]);
    assert.equal(shapes[1].locked, true, "the opponent is a stationary dummy");

    const fresh = buildMatchSpawnShapes({ matchId: "m", player: players[0], loadout: "melee", players }).map(toSimulationBotShape);
    assert.equal(fresh[0].hp, 300);
});
