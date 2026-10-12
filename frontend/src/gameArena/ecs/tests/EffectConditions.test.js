import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPLAY_DATA } from "../../../../../shared/engine/gameconfig/gameplayData.js";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { applyStatus, settleHealing } from "../../../../../shared/engine/ecs/abilities/effects.js";
import { statusIsActive } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { applyBotAction, resolveActivationVerbsForWorld } from "../../testing/pureTicks.js";

// An effect's `when` checks: the effect applies only when every check passes, on the live state at that effect.

const HAMMER = 6;
const VAMPIRIC_BEAM = 32;
const baseAbility = (id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id));
const NO_ORIGIN = { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" };
const CIRCLE = { shape: "circle", radius: 130, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: true };

const bot = (extra) => ({
    slot: 2, teamNumber: 2, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [], abilityState: {}, ...extra,
});
const caster = (abilityId, extra = {}) => ({
    id: "owner", slot: 1, teamNumber: 1, x: 300, y: 300, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [abilityId], abilityState: {},
    ...extra,
});

/** Casts the ability, ticking through any wind-up, and returns the owner on the tick the ability triggered. */
function cast(owner, abilityId) {
    let next = owner;
    for (let tick = 0; tick < 40; tick += 1) {
        next = applyBotAction(next, { dx: 0, dy: 0, abilityAction: { action: abilityId } }, 100);
        if (next.triggeredAbility != null) return next;
    }
    throw new Error("the ability never triggered");
}

/** A test hit: one activation hit on the enemy (60 units east of the owner) running `effects` in order. */
const hitWith = (effects) => ({ do: "hit", origin: NO_ORIGIN, targets: ["BOT"], hitbox: CIRCLE, effects, visual: null });

/** Strikes one enemy with `effects` and returns that enemy after the activation tick. `enemy` overrides its fields. */
function strike(effects, enemy = {}) {
    let struck = null;
    withTestAbilities([{ ...baseAbility(HAMMER), onActivate: [hitWith(effects)], entities: {} }], () => {
        const owner = cast(caster(HAMMER), HAMMER);
        const [, target] = resolveActivationVerbsForWorld([owner, bot({ id: "enemy", x: 360, y: 300, ...enemy })]).bots;
        struck = target;
    });
    return struck;
}

/** The status list of a bot that holds `subtype`, applied the way an ability applies it. */
function withStatus(subtype, extra = {}) {
    const holder = bot({ x: 360, y: 300 });
    applyStatus(holder, { subtype, durationMs: 2000, ...extra });
    return holder.statusEffects;
}

const BASE = { type: "damage", amount: 10, targetKinds: ["BOT"] };

test("an execute-style bonus applies only while the target is below 30% health", () => {
    const execute = { type: "damage", amount: 8, targetKinds: ["BOT"], when: [{ of: "target", measure: "hpRatio", op: "<", value: 0.3 }] };
    assert.equal(strike([execute, BASE], { hp: 100 }).hp, 90, "full health: base damage only");
    assert.equal(strike([execute, BASE], { hp: 31 }).hp, 21, "31%: not below the line");
    assert.equal(strike([execute, BASE], { hp: 30 }).hp, 20, "exactly 30%: `<` is strict");
    assert.equal(strike([execute, BASE], { hp: 25 }).hp, 7, "25%: the bonus and the base both land");
});

test("a shatter-style bonus lands on a slowed target and removes the slow; the lifetimeEnd of a removed status does not run", () => {
    const shatter = { type: "damage", amount: 20, targetKinds: ["BOT"], when: [{ of: "target", measure: "hasStatus", value: "slow" }] };
    const unslow = { type: "remove_status", subtype: "slow" };
    const slowed = strike([BASE, shatter, unslow], { statusEffects: withStatus("slow") });
    assert.equal(slowed.hp, 70, "base 10 plus the shatter bonus 20");
    assert.equal(statusIsActive(slowed, "slow"), false, "the slow is gone");
    assert.equal(strike([BASE, shatter, unslow], { statusEffects: [] }).hp, 90, "no slow: base damage only");

    // Rewind's lifetimeEnd would snap the bot back to where it was when the status was applied (x 330). Removing it
    // is a cleanse, so the bot stays at x 360.
    const rewindRemoved = strike([{ type: "remove_status", subtype: "rewind" }], {
        statusEffects: withRewindCaptured(330),
    });
    assert.equal(rewindRemoved.x, 360, "removeStatus does not run the status's lifetimeEnd");
    assert.equal(rewindRemoved.statusEffects.some((status) => status.type === "rewind"), false);
});

/** A rewind status captured while the bot stood at `x`. */
function withRewindCaptured(x) {
    const holder = bot({ x, y: 300 });
    applyStatus(holder, { subtype: "rewind", durationMs: 2000 });
    return holder.statusEffects;
}

test("a counter-hit stun applies only while the target is winding up", () => {
    const counter = { type: "status", subtype: "stun", durationMs: 500, targetKinds: ["BOT"], when: [{ of: "target", measure: "windingUp" }] };
    const winding = strike([BASE, counter], { abilityState: { [HAMMER]: { stage: "windup", remainingMs: 500 } } });
    assert.equal(statusIsActive(winding, "stun"), true, "the target was winding up");
    const idle = strike([BASE, counter], { abilityState: {} });
    assert.equal(statusIsActive(idle, "stun"), false, "a target that is not winding up is not stunned");
});

test("a from-behind bonus applies only when the source is more than 90 degrees off the target's facing", () => {
    const backstab = { type: "damage", amount: 30, targetKinds: ["BOT"], when: [{ measure: "fromBehind" }] };
    // The owner stands 60 units west of the enemy: an enemy facing east (90) has its back to it.
    assert.equal(strike([BASE, backstab], { rotation: 90 }).hp, 60, "facing away: the bonus lands");
    assert.equal(strike([BASE, backstab], { rotation: 270 }).hp, 90, "facing the owner: no bonus");
});

test("a distance check measures from the source to the target", () => {
    const far = { type: "damage", amount: 5, targetKinds: ["BOT"], when: [{ measure: "distance", op: ">", value: 50 }] };
    assert.equal(strike([BASE, far], { x: 360 }).hp, 85, "60 units away: the bonus lands");
    assert.equal(strike([BASE, far], { x: 340 }).hp, 90, "40 units away: no bonus");
});

test("Vampiric Beam still heals its owner by the damage it deals, and nothing when it hits nothing", () => {
    const owner = cast(caster(VAMPIRIC_BEAM, { hp: 100 }), VAMPIRIC_BEAM);
    const [healed, struck] = resolveActivationVerbsForWorld([owner, bot({ id: "enemy", x: 360, y: 300 })]).bots;
    const dealt = 100 - struck.hp;
    assert.ok(dealt > 0, "the beam hits the enemy");
    // Healing is banked during the tick and paid when it settles.
    assert.equal(settleHealing(healed).hp, 100 + dealt, "the owner heals by what the beam dealt");

    const missOwner = cast(caster(VAMPIRIC_BEAM, { hp: 100 }), VAMPIRIC_BEAM);
    const [healedOnMiss, missed] = resolveActivationVerbsForWorld([missOwner, bot({ id: "enemy", x: 360, y: 100 })]).bots;
    assert.equal(missed.hp, 100, "the enemy is off the beam");
    assert.equal(settleHealing(healedOnMiss).hp, 100, "no damage confirmed, no heal");
});
