import test from "node:test";
import assert from "node:assert/strict";
import { buildStatePayload } from "./strategyStatePayload.js";
import { stateFromPayload } from "../botlogic/code/runtime/runtimeState.js";
import { statusEffectFor, statusIsActive } from "../ecs/contracts/StatusContracts.js";

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
    assert.equal(mine.hp, undefined);
    assert.equal(mine.ageMs, 2400);
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
