import test from "node:test";
import assert from "node:assert/strict";
import { buildStatePayload } from "./strategyStatePayload.js";
import { stateFromPayload } from "../botlogic/code/runtime/runtimeState.js";
import { statusEffectFor, statusIsActive } from "../ecs/contracts/StatusContracts.js";
import { SELECTABLE_IDENTITIES } from "./selectableIdentities.js";

test("bot payloads group health, stats, transform, and active statuses", () => {
    const payload = buildStatePayload([
        {
            id: "main",
            type: "circle",
            slot: 1,
            x: 430,
            y: 280,
            rotation: 120,
            velocityX: 20,
            velocityY: -15,
            movementVelocityX: 2,
            movementVelocityY: -1.5,
            size: 60,
            hp: 85,
            maxHp: 100,
            moveSpeed: 320,
            attackDamageMultiplier: 1.25,
            attackSpeedMultiplier: 1.1,
            statusEffects: [
                { type: "slow", remainingMs: 1200, effects: [{ type: "movement_modifier", mode: "constant", movementMultiplier: .5, rotationMultiplier: .5 }] },
                { type: "silence", mode: "presence", effects: [{ type: "silence", mode: "constant" }] },
                { type: "burn", remainingMs: 2500, tickMs: 1000, effects: [{ type: "damage", mode: "tick", amount: 2 }] },
            ],
            abilities: [5],
            abilityCooldowns: { 5: 3200 },
        },
        {
            id: "opponent-model",
            type: "opponentModel",
            slot: 2,
            x: 700,
            y: 280,
            rotation: 300,
            velocityX: -10,
            velocityY: 5,
            movementVelocityX: -1,
            movementVelocityY: 0.5,
            size: 64,
            hp: 100,
            maxHp: 100,
            abilities: [2],
        },
        { id: "mine-1", type: "proximityMine", x: 550, y: 280, size: 42, ageMs: 2400 },
    ], "custom:5");

    assert.deepEqual(payload.playerModel.health, {
        current: 85,
        max: 100,
        alive: true,
        hittable: true,
        projectileHittable: true,
        damageTakenLastTick: 0,
        netChangeLastTick: 0,
    });
    assert.deepEqual(payload.playerModel.stats, {
        movementSpeed: 320,
        attackDamageMultiplier: 1.25,
        attackSpeedMultiplier: 1.1,
    });
    assert.deepEqual(payload.playerModel.transform, {
        position: { x: 430, y: 280 },
        rotation: 120,
        velocity: { x: 20, y: -15 },
        movementVelocity: { x: 2, y: -1.5 },
        size: 60,
    });
    assert.equal(payload.playerModel.statusEffects.length, 3);
    assert.equal(statusEffectFor(payload.playerModel, "burn").remainingMs, 2500);
    assert.equal(statusIsActive(payload.playerModel, "silence"), true);
    assert.equal(payload.playerModel.cooldownRecoveryMs, undefined);
    assert.deepEqual(payload.playerModel.abilities, [5]);
    assert.equal(payload.playerModel.selectableIdentities.includes(SELECTABLE_IDENTITIES.BOT), true);
    assert.equal(payload.playerModel.x, undefined);
    assert.equal(payload.playerModel.hp, undefined);

    const opponent = payload.objects.find((object) => object.type === "opponentModel");
    assert.equal(opponent.health.current, 100);
    assert.deepEqual(opponent.transform.position, { x: 700, y: 280 });
    const restoredState = stateFromPayload(payload);
    assert.equal(restoredState.opponent.velocityX, -10);
    assert.equal(restoredState.opponent.velocityY, 5);
    assert.equal(restoredState.opponent.movementVelocityX, -1);
    assert.equal(restoredState.opponent.movementVelocityY, 0.5);
    const mine = payload.objects.find((object) => object.id === "mine-1");
    assert.deepEqual(mine.transform, undefined);
    assert.equal(mine.hp, 0);
    assert.equal(mine.selectableIdentities.includes(SELECTABLE_IDENTITIES.ABILITY_ENTITY), true);
    assert.equal(mine.selectableIdentities.includes(SELECTABLE_IDENTITIES.HEALTH), false);
    assert.equal(mine.selectableIdentities.includes(SELECTABLE_IDENTITIES.FACING), false);
    assert.equal(mine.ageMs, 2400);
});

test("spawned oriented entities inherit facing and movement selectable identities", () => {
    const payload = buildStatePayload([
        { id: "main", type: "circle", slot: 1, x: 400, y: 400, size: 60, hp: 100 },
        { id: "opponent-model", type: "opponentModel", slot: 2, x: 600, y: 400, size: 60, hp: 100 },
        { id: "drone-1", type: "hunterDrone", abilityId: 17, ownerId: "opponent-model", x: 500, y: 400, size: 30 },
    ], "custom:17");

    const drone = payload.objects.find((object) => object.id === "drone-1");
    assert.equal(drone.selectableIdentities.includes(SELECTABLE_IDENTITIES.ABILITY_ENTITY), true);
    assert.equal(drone.selectableIdentities.includes(SELECTABLE_IDENTITIES.FACING), true);
    assert.equal(drone.selectableIdentities.includes(SELECTABLE_IDENTITIES.MOVEMENT), true);
});

test("bot logic runtime restores nested payload values for existing conditions", () => {
    const state = stateFromPayload({
        playerModel: {
            id: "main",
            health: { current: 85, max: 100, damageTakenLastTick: 15, netChangeLastTick: -15 },
            transform: {
                position: { x: 430, y: 280 },
                rotation: 120,
                velocity: { x: 20, y: -15 },
                movementVelocity: { x: 2, y: -1.5 },
                size: 60,
            },
            statusEffects: [
                { type: "burn", remainingMs: 2500 },
                { type: "silence", mode: "presence" },
            ],
            abilities: [5],
        },
        objects: [],
    });

    assert.equal(state.player.hp, 85);
    assert.equal(state.player.maxHp, 100);
    assert.equal(state.player.x, 430);
    assert.equal(state.player.y, 280);
    assert.equal(state.player.velocityX, 20);
    assert.equal(state.player.velocityY, -15);
    assert.equal(state.player.movementVelocityX, 2);
    assert.equal(state.player.movementVelocityY, -1.5);
    assert.equal(statusEffectFor(state.player, "burn").remainingMs, 2500);
    assert.equal(statusIsActive(state.player, "silence"), true);
});

test("bot logic transform measurements truncate toward zero to one decimal", () => {
    const payload = buildStatePayload([{
        id: "main",
        type: "circle",
        x: 430.29,
        y: -0.09,
        rotation: 120.99,
        velocityX: 20.29,
        velocityY: -15.09,
        movementVelocityX: 2.99,
        movementVelocityY: -1.01,
        size: 60.09,
        hp: 100,
    }], "custom:1");

    assert.deepEqual(payload.playerModel.transform, {
        position: { x: 430.2, y: 0 },
        rotation: 120.9,
        velocity: { x: 20.2, y: -15 },
        movementVelocity: { x: 2.9, y: -1 },
        size: 60,
    });
});

test("timed buffs are exposed through the generic status collection", () => {
    const payload = buildStatePayload([
        {
            id: "main",
            type: "circle",
            slot: 1,
            x: 500,
            y: 500,
            size: 60,
            hp: 100,
            maxHp: 100,
            statusEffects: [{
                type: "overclock",
                remainingMs: 3200,
                effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
            }],
        },
    ], "custom:33");

    assert.equal(statusEffectFor(payload.playerModel, "overclock").remainingMs, 3200);
    const state = stateFromPayload(payload);
    assert.equal(statusEffectFor(state.player, "overclock").remainingMs, 3200);
    assert.equal(state.player.cooldownRecoveryMs, undefined);
});

test("canonical buff statuses win over stale flat timers when building logic payloads", () => {
    const payload = buildStatePayload([{
        id: "main",
        type: "circle",
        slot: 1,
        x: 500,
        y: 500,
        size: 60,
        hp: 100,
        maxHp: 100,
        statusEffects: [{
            type: "overclock",
            remainingMs: 3200,
            effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
        }],
    }], "custom:33");

    assert.equal(statusEffectFor(payload.playerModel, "overclock").remainingMs, 3200);
    const state = stateFromPayload(payload);
    assert.equal(statusEffectFor(state.player, "overclock").remainingMs, 3200);
    assert.equal(state.player.cooldownRecoveryMs, undefined);
});

test("renderer-only closing zone state is available as boundary state but absent from bot logic objects", () => {
    const payload = buildStatePayload([
        { id: "main", type: "circle", slot: 1, x: 500, y: 500, size: 60, hp: 100, maxHp: 100 },
        { id: "opponent-model", type: "opponentModel", slot: 2, x: 500, y: 500, size: 60, hp: 100, maxHp: 100 },
        { id: "closing-zone", type: "closingZone", visibility: "renderer-only", x: 500, y: 500, size: 900 },
    ], "custom:5");

    assert.equal(payload.objects.some((object) => object.type === "closingZone"), false);
    assert.deepEqual(payload.closingZone, { x: 500, y: 500, safeRadius: 450 });
    assert.deepEqual(stateFromPayload(payload).closingZone, payload.closingZone);
});

test("2v2 bot payloads expose stable teammate and numbered opponent selectors", () => {
    const payload = buildStatePayload([
        { id: "main", type: "circle", userId: "user-1", slot: 1, teamNumber: 1, x: 300, y: 150, hp: 100, abilities: [19] },
        { id: "bot-user-2", type: "bot", userId: "user-2", slot: 2, teamNumber: 1, x: 700, y: 150, hp: 90, abilities: [20] },
        { id: "bot-user-3", type: "bot", userId: "user-3", slot: 3, teamNumber: 2, x: 300, y: 850, hp: 80, abilities: [5] },
        { id: "bot-user-4", type: "bot", userId: "user-4", slot: 4, teamNumber: 2, x: 700, y: 850, hp: 70, abilities: [9] },
    ], "custom:19");

    assert.deepEqual(payload.objects.map((object) => [
        object.id, object.role, object.botIndex, object.teamNumber, object.owner,
    ]), [
        ["bot-user-2", "teammate", 1, 1, "my"],
        ["bot-user-3", "opponent", 1, 2, "opponent"],
        ["bot-user-4", "opponent", 2, 2, "opponent"],
    ]);
    const state = stateFromPayload(payload);
    assert.deepEqual(state.teammates.map((bot) => bot.id), ["bot-user-2"]);
    assert.deepEqual(state.opponents.map((bot) => bot.id), ["bot-user-3", "bot-user-4"]);
    assert.deepEqual(state.bots.map((bot) => bot.id), ["main", "bot-user-2", "bot-user-3", "bot-user-4"]);
});

test("spawned entities expose the exact bot selector that owns them", () => {
    const payload = buildStatePayload([
        { id: "main", type: "circle", userId: "user-1", slot: 1, teamNumber: 1, x: 300, y: 150, hp: 100 },
        { id: "bot-user-2", type: "bot", userId: "user-2", slot: 2, teamNumber: 1, x: 700, y: 150, hp: 100 },
        { id: "bot-user-3", type: "bot", userId: "user-3", slot: 3, teamNumber: 2, x: 300, y: 850, hp: 100 },
        { id: "bot-user-4", type: "bot", userId: "user-4", slot: 4, teamNumber: 2, x: 700, y: 850, hp: 100 },
        { id: "fireball-main", type: "fireball", abilityId: 5, ownerId: "main", ownerSlot: 1, x: 300, y: 300 },
        { id: "fireball-teammate", type: "fireball", abilityId: 5, ownerId: "bot-user-2", ownerSlot: 2, x: 700, y: 300 },
        { id: "fireball-opponent-1", type: "fireball", abilityId: 5, ownerId: "bot-user-3", ownerSlot: 3, x: 300, y: 700 },
        { id: "fireball-opponent-2", type: "fireball", abilityId: 5, ownerId: "bot-user-4", ownerSlot: 4, x: 700, y: 700 },
    ], "custom:5");

    assert.deepEqual(payload.objects.filter((object) => object.type === "fireball").map((object) => [object.id, object.ownerSelector]), [
        ["fireball-main", "my_bot"],
        ["fireball-teammate", "teammate_1"],
        ["fireball-opponent-1", "opponent_1"],
        ["fireball-opponent-2", "opponent_2"],
    ]);
});
