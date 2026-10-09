import assert from "node:assert/strict";
import test from "node:test";
import { MOVEMENT_TICK_MS } from "../../gameconfig/MovementConfig.js";
import { initialMovementState } from "../../gameconfig/StaminaSystem.js";
import { abilityChannel, abilityStaminaCost, channelBlockingStatuses } from "../../gameconfig/AbilityChannels.js";
import { channelBusy } from "../../gameconfig/AbilityState.js";
import { initialAbilityState } from "../../gameconfig/AbilityResourceSystem.js";
import { applyBotAction } from "../../testing/pureTicks.js";

// Mirrors the server's AbilityChannelsTest; keep the scenarios and numbers in step.
const DASH = 19;
const SNIPER = 3; // 900 ms wind-up, 200 ms active
const DART = 30; // 200 ms wind-up, 300 ms active
const idle = { dx: 0, dy: 0, dRot: 0 };
const dash = { action: DASH, targetX: 900, targetY: 400, movementMode: "absolute", movementDirection: "east" };
const snipe = { action: SNIPER, targetX: 900, targetY: 400 };
const dart = { action: DART, targetX: 900, targetY: 400 };

const bot = () => ({
    id: "main", slot: 1, x: 200, y: 400, size: 60, rotation: 90, hp: 100, maxHp: 100,
    moveSpeed: 15, attackSpeedMultiplier: 1, movementVelocityX: 0, movementVelocityY: 0,
    abilities: [SNIPER, DART, DASH], abilityState: initialAbilityState([SNIPER, DART, DASH]),
    ...initialMovementState(),
});
const step = (shape, action = idle) => applyBotAction(shape, action, MOVEMENT_TICK_MS);
const stage = (shape, id) => `${shape.abilityState[id]?.stage ?? "ready"}:${shape.abilityState[id]?.remainingMs ?? 0}`;

test("channels and the dash cost come from the shared data", () => {
    assert.equal(abilityChannel(DASH), "dash");
    assert.equal(abilityChannel(SNIPER), "ability");
    assert.equal(abilityStaminaCost(DASH), 30);
    assert.equal(abilityStaminaCost(SNIPER), 0);
    assert.deepEqual([...channelBlockingStatuses("ability")], ["stun", "silence"]);
    assert.deepEqual([...channelBlockingStatuses("dash")], ["stun", "slow"]);
});

test("an ability starts, winds up and fires while a dash is active", () => {
    let current = step(bot(), { ...idle, dashAction: dash });
    assert.equal(current.triggeredAbility, DASH);
    assert.equal(stage(current, DASH), "active:200");

    // The wind-up starts while the dash is active...
    current = step(current, { ...idle, abilityAction: dart });
    assert.equal(stage(current, DART), "windup:100");
    assert.equal(stage(current, DASH), "active:100", "the dash is still active");
    assert.equal(channelBusy(current, "dash"), true);
    assert.equal(channelBusy(current, "ability"), true);

    // ...and the ability fires in the next step, with the dash active at its start.
    assert.ok(current.abilityState[DASH].remainingMs > 0);
    current = step(current, { ...idle, abilityAction: dart });
    assert.equal(current.triggeredAbility, DART, "the ability fired");
    assert.equal(stage(current, DART).startsWith("active"), true);
});

test("a dash starts during another ability's wind-up and active time", () => {
    // Sniper winds up for 900 ms; a dash in the middle leaves the wind-up counting down.
    let current = step(bot(), { ...idle, abilityAction: snipe });
    assert.equal(stage(current, SNIPER), "windup:800");
    current = step(current, { ...idle, abilityAction: snipe, dashAction: dash });
    assert.equal(current.triggeredAbility, DASH);
    assert.equal(stage(current, SNIPER), "windup:700", "the wind-up continues while dashing");
    assert.equal(current.stamina, 70);

    // Let the wind-up finish. The dash recovers (200 ms active, 100 ms cooldown) while the sniper winds up.
    let fired = null;
    for (let tick = 0; tick < 12 && fired == null; tick += 1) {
        current = step(current, { ...idle, abilityAction: snipe });
        if (current.triggeredAbility === SNIPER) fired = current;
    }
    assert.ok(fired, "the sniper fired");
    assert.equal(stage(fired, SNIPER), "active:200");
    assert.equal(stage(fired, DASH), "ready:0");

    // A dash during the sniper's active time: the sniper stays active, the dash starts.
    const dashedDuringActive = step(fired, { ...idle, dashAction: dash });
    assert.equal(dashedDuringActive.triggeredAbility, DASH);
    assert.equal(stage(dashedDuringActive, DASH), "active:200");
    assert.equal(stage(dashedDuringActive, SNIPER), "active:100");
    assert.equal(fired.stamina + 2 - dashedDuringActive.stamina, 30, "the dash paid its 30 stamina (plus one tick of regeneration)");
});

test("a second ability of the same channel still waits for the first", () => {
    let current = step(bot(), { ...idle, abilityAction: snipe });
    const blocked = step(current, { ...idle, abilityAction: dart });
    assert.equal(stage(blocked, DART), "ready:0", "the dart cannot start while the sniper winds up");
    assert.equal(stage(blocked, SNIPER), "windup:700", "the started wind-up stays selected");
});
