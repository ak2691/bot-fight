import assert from "node:assert/strict";
import test from "node:test";
import { applyStatus, dealDamage } from "../../../../../shared/engine/ecs/abilities/effects.js";
import { modifierFor } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { effectiveMovementSpeedMultiplier, effectiveRotationSpeedMultiplier } from "../../../../../shared/engine/gameconfig/HitStagger.js";
import { initialMovementState, staminaCostFor } from "../../../../../shared/engine/gameconfig/StaminaSystem.js";
import { applyBotAction, resolveTriggeredAbilityCombat as resolveAbilityCombat } from "../../testing/pureTicks.js";

const DASH_ABILITY_ID = 19;
const dashAction = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: DASH_ABILITY_ID, targetX: 900, targetY: 400 } };
const walk = (extra = {}) => ({ dx: 1, dy: 0, dRot: 0, ...extra });

// A ready status record carrying one constant modifier of `stat`.
function modifierRecord(type, stat, multiply) {
    return { type, remainingMs: 1000, effects: [{ type: "modifier", mode: "constant", stat, multiply }] };
}

function bot(extra = {}) {
    return {
        id: "main", slot: 1, x: 200, y: 400, size: 60, rotation: 90, hp: 100, maxHp: 100,
        moveSpeed: 15, attackSpeedMultiplier: 1, movementVelocityX: 0, movementVelocityY: 0,
        abilities: [DASH_ABILITY_ID], abilityState: {}, ...initialMovementState(), ...extra,
    };
}

test("no modifier leaves the stat alone", () => {
    assert.deepEqual(modifierFor(bot(), "incomingDamage"), { multiply: 1, truncateToTenths: false });
    assert.deepEqual(modifierFor(null, "moveSpeed"), { multiply: 1, truncateToTenths: false });
});

test("an outgoingDamage modifier of 2 doubles the damage the bot deals", () => {
    const target = () => ({ id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 });
    const attacker = () => ({ id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 3 });
    const [, plain] = resolveAbilityCombat(attacker(), target());
    const [, doubled] = resolveAbilityCombat(applyStatus(attacker(), modifierRecord("outgoing", "outgoingDamage", 2)), target());
    const plainDamage = 100 - plain.hp;
    assert.ok(plainDamage > 0);
    assert.equal(100 - doubled.hp, 2 * plainDamage);
});

test("a staminaCost modifier of 0 makes dash and sprint cost nothing", () => {
    const free = applyStatus(bot(), modifierRecord("free", "staminaCost", 0));
    // Without the modifier the same actions spend stamina (dash 30, sprint 3 for one tick).
    assert.equal(applyBotAction(bot(), dashAction, 100).stamina, 70);
    assert.equal(applyBotAction(bot(), walk({ sprint: true }), 100).stamina, 97);
    assert.equal(applyBotAction(free, dashAction, 100).stamina, 100);
    assert.equal(applyBotAction(free, walk({ sprint: true }), 100).stamina, 100);
});

test("staminaCostFor rounds a scaled cost up", () => {
    assert.equal(staminaCostFor(applyStatus(bot(), modifierRecord("half", "staminaCost", 0.5)), 25), 13);
    assert.equal(staminaCostFor(bot(), 25), 25);
});

test("two incomingDamage modifiers multiply", () => {
    let target = bot({ hp: 100 });
    target = applyStatus(target, modifierRecord("armor-a", "incomingDamage", 0.5));
    target = applyStatus(target, modifierRecord("armor-b", "incomingDamage", 0.5));
    assert.equal(modifierFor(target, "incomingDamage").multiply, 0.25);
    assert.equal(dealDamage(target, 10, { slot: 2 }).hp, 97.5);
});

test("slow and hit stagger together give 0.5 for movement and rotation", () => {
    const slowed = applyStatus(applyStatus(bot(), { subtype: "slow", durationMs: 1000 }), { subtype: "hit-stagger", durationMs: 300 });
    assert.equal(effectiveMovementSpeedMultiplier(slowed), 0.5);
    assert.equal(effectiveRotationSpeedMultiplier(slowed), 0.5);
    const staggeredFirst = applyStatus(applyStatus(bot(), { subtype: "hit-stagger", durationMs: 300 }), { subtype: "slow", durationMs: 1000 });
    assert.equal(effectiveMovementSpeedMultiplier(staggeredFirst), 0.5);
});

test("reapplying slow keeps both of its modifiers", () => {
    const once = applyStatus(bot(), { subtype: "slow", durationMs: 1000 });
    const twice = applyStatus(once, { subtype: "slow", durationMs: 1500 });
    assert.equal(effectiveMovementSpeedMultiplier(twice), 0.5);
    assert.equal(effectiveRotationSpeedMultiplier(twice), 0.5);
    assert.equal(twice.statusEffects[0].effects.length, 3);
});
