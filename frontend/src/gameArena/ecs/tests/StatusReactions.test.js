import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPLAY_DATA } from "../../../../../shared/engine/gameconfig/gameplayData.js";
import { withTestStatuses } from "../../../../../shared/engine/gameconfig/StatusPresets.js";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { statusIsActive, outgoingDamageMultiplier } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { applyEffectList, applyEffectsFromEntity, applyStatus, settleSpentStatuses } from "../../../../../shared/engine/ecs/abilities/effects.js";
import { tickStatuses } from "../../../../../shared/engine/ecs/bots/BotStatusSystem.js";

// Status reactions: a status's `hit` event runs when an attack damages its holder (even when immunity blocks the
// damage), and its `hitDealt` event when the holder's attack damages an enemy. A status can also run a schedule that
// reads its source (a tether). Test presets are added with withTestStatuses.

const HAMMER = 36; // a weapon (Cleave), so the attack counts as a weapon hit
const baseAbility = (id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id));
const bot = (extra) => ({
    slot: 2, teamNumber: 2, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [], abilityState: {}, ...extra,
});
const DAMAGE = (amount) => [{ type: "damage", amount, targetKinds: ["BOT"] }];

/** Parry: immune, one charge; the attacker is stunned by the hit that spends it. */
const PARRY = {
    presenceWhenInside: false, carriesSourceSlot: false, clearsVelocity: false, charges: 1,
    effects: [{ type: "damage_immunity", mode: "constant", amount: 1 }],
    on: { hit: { target: "attacker", consume: 1, effects: [{ type: "status", subtype: "stun", durationMs: 500 }] } },
};

/** Reflection (the reactive-armor preset's shape, kept as a test preset): half the damage in, half the raw hit back. */
const REFLECT = {
    presenceWhenInside: false, carriesSourceSlot: false, clearsVelocity: false,
    effects: [{ type: "modifier", mode: "constant", stat: "incomingDamage", multiply: 0.5 }],
    on: { hit: { target: "attacker", effects: [{ type: "damage", amount: "$hitAmount", multiplier: 0.5 }] } },
};

/** Overcharge: doubles outgoing damage for three weapon hits. */
const OVERCHARGE = {
    presenceWhenInside: false, carriesSourceSlot: false, clearsVelocity: false, charges: 3,
    effects: [{ type: "modifier", mode: "constant", stat: "outgoingDamage", multiply: 2 }],
    on: { hitDealt: { from: ["weapon"], consume: 1, effects: [] } },
};

/** Tether: pulls its holder 20 units toward its source every tick while the holder is more than 200 away. */
const TETHER = {
    presenceWhenInside: false, carriesSourceSlot: true, clearsVelocity: false,
    effects: [],
    on: {
        schedule: {
            intervalMs: 100,
            effects: [{
                type: "displace", who: "target", from: "source", direction: "toward", distance: 20,
                when: [{ measure: "distance", op: ">", value: 200 }],
            }],
        },
    },
};

test("parry: the hit that immunity blocks still stuns the attacker, spends the charge and ends the parry when the tick settles", () => {
    withTestStatuses({ "test-parry": PARRY }, () => {
        const attacker = bot({ id: "attacker", slot: 1, teamNumber: 1, x: 300, y: 300 });
        const second = bot({ id: "second", slot: 3, teamNumber: 1, x: 420, y: 300 });
        const holder = bot({ id: "holder", slot: 2, teamNumber: 2, x: 360, y: 300 });
        applyStatus(holder, { subtype: "test-parry", durationMs: 2000 });
        const attack = (from = attacker) => applyEffectList(DAMAGE(20), {
            abilityId: HAMMER, stats: {}, source: from, owner: from, target: holder,
            damageMultiplier: outgoingDamageMultiplier(from),
        }, { targetKinds: ["BOT"] });
        attack();
        assert.equal(holder.hp, 100, "immunity blocks the damage");
        assert.equal(statusIsActive(attacker, "stun"), true, "the attacker is stunned by the parry");
        // Another hit in the same tick (a second pellet, a second attacker) meets the spent parry: blocked, no new stun.
        attack(second);
        assert.equal(holder.hp, 100, "a hit in the same tick is blocked too");
        assert.equal(statusIsActive(second, "stun"), false, "the spent parry stuns no one else");
        settleSpentStatuses(holder);
        assert.equal(statusIsActive(holder, "test-parry"), false, "the parry ends when the tick settles");
        attack();
        assert.equal(holder.hp, 80, "with no parry left, the next hit lands");
    });
});

test("a projectile stuns the bot that fired it: an entity's hit reaches its owner", () => {
    withTestStatuses({ "test-parry": PARRY }, () => {
        const shooter = bot({ id: "shooter", slot: 1, teamNumber: 1, x: 300, y: 300 });
        const holder = bot({ id: "holder", slot: 2, teamNumber: 2, x: 360, y: 300 });
        applyStatus(holder, { subtype: "test-parry", durationMs: 2000 });
        const shot = { id: "shot", ownerId: "shooter", ownerSlot: 1, ownerTeam: 1, x: 350, y: 300, size: 10, rotation: 90 };
        applyEffectsFromEntity([shooter, holder], 1, shot, HAMMER, {
            effects: DAMAGE(20), world: { width: 1000, height: 800 }, stats: {},
        });
        assert.equal(holder.hp, 100, "the shot is blocked");
        assert.equal(statusIsActive(shooter, "stun"), true, "the shooter is stunned");
    });
});

test("overcharge: the third weapon hit is still doubled, the charges spend on weapon hits only, then the bonus ends", () => {
    withTestAbilities([{ ...baseAbility(HAMMER), weapon: true, tier: undefined }], () => {
        withTestStatuses({ "test-overcharge": OVERCHARGE }, () => {
            const attacker = bot({ id: "attacker", slot: 1, teamNumber: 1, x: 300, y: 300, attackDamageMultiplier: 1 });
            applyStatus(attacker, { subtype: "test-overcharge", durationMs: 9000 });
            const dealt = [];
            for (let hit = 0; hit < 4; hit += 1) {
                const victim = bot({ id: `victim${hit}`, slot: 2, teamNumber: 2, x: 360, y: 300, hp: 100 });
                applyEffectList(DAMAGE(10), {
                    abilityId: HAMMER, stats: {}, source: attacker, owner: attacker, target: victim,
                    damageMultiplier: outgoingDamageMultiplier(attacker),
                }, { targetKinds: ["BOT"] });
                dealt.push(100 - victim.hp);
                settleSpentStatuses(attacker); // one hit per tick
            }
            assert.deepEqual(dealt, [20, 20, 20, 10]);
            assert.equal(statusIsActive(attacker, "test-overcharge"), false, "the last charge ends the bonus");
        });
    });
    // The same hits from a non-weapon ability do not spend the charges.
    withTestStatuses({ "test-overcharge": OVERCHARGE }, () => {
        const attacker = bot({ id: "attacker", slot: 1, teamNumber: 1, x: 300, y: 300 });
        applyStatus(attacker, { subtype: "test-overcharge", durationMs: 9000 });
        for (let hit = 0; hit < 4; hit += 1) {
            const victim = bot({ id: `victim${hit}`, slot: 2, teamNumber: 2, x: 360, y: 300 });
            applyEffectList(DAMAGE(10), {
                abilityId: 5, stats: {}, source: attacker, owner: attacker, target: victim,
                damageMultiplier: outgoingDamageMultiplier(attacker),
            }, { targetKinds: ["BOT"] });
        }
        assert.equal(statusIsActive(attacker, "test-overcharge"), true, "non-weapon hits leave the charges alone");
    });
});

test("tether: a schedule that reads its source pulls the holder back only while it is more than 200 away", () => {
    withTestStatuses({ "test-tether": TETHER }, () => {
        const caster = bot({ id: "caster", slot: 1, teamNumber: 1, x: 300, y: 300 });
        const far = bot({ id: "far", slot: 2, teamNumber: 2, x: 600, y: 300 });
        applyStatus(far, { subtype: "test-tether", durationMs: 2000 }, { source: caster });
        tickStatuses(far, 100, [caster, far]);
        assert.equal(far.x, 580, "300 away: pulled 20 toward the caster");

        const near = bot({ id: "near", slot: 2, teamNumber: 2, x: 350, y: 300 });
        applyStatus(near, { subtype: "test-tether", durationMs: 2000 }, { source: caster });
        tickStatuses(near, 100, [caster, near]);
        assert.equal(near.x, 350, "50 away: not pulled");

        const dead = { ...caster, hp: 0 };
        const stranded = bot({ id: "stranded", slot: 2, teamNumber: 2, x: 600, y: 300 });
        applyStatus(stranded, { subtype: "test-tether", durationMs: 2000 }, { source: caster });
        tickStatuses(stranded, 100, [dead, stranded]);
        assert.equal(stranded.x, 600, "a dead source has no position, so the pull is skipped");
    });
});

test("reflection: the reflected half of the raw hit goes back at the attacker, as before, and reactions do not chain", () => withTestStatuses({ "test-reflect": REFLECT }, () => {
    const victim = bot({ id: "victim", slot: 2, teamNumber: 2, x: 360, y: 300 });
    const attacker = bot({ id: "attacker", slot: 1, teamNumber: 1, x: 300, y: 300 });
    applyStatus(victim, { subtype: "test-reflect", durationMs: 4000 });
    applyEffectList(DAMAGE(20), {
        abilityId: HAMMER, stats: {}, source: attacker, owner: attacker, target: victim, damageMultiplier: 1,
    }, { targetKinds: ["BOT"] });
    assert.equal(victim.hp, 90, "incoming damage is halved");
    assert.equal(attacker.hp, 90, "half the raw 20 is reflected");
    assert.equal(statusIsActive(attacker, "hit-stagger"), true, "the reflected hit staggers the attacker");

    // Both bots armored: the reflection is not a new attack, so the attacker's own armor does not reflect it back.
    const armored = bot({ id: "armored", slot: 2, teamNumber: 2, x: 360, y: 300 });
    const other = bot({ id: "other", slot: 1, teamNumber: 1, x: 300, y: 300 });
    applyStatus(armored, { subtype: "test-reflect", durationMs: 4000 });
    applyStatus(other, { subtype: "test-reflect", durationMs: 4000 });
    applyEffectList(DAMAGE(20), {
        abilityId: HAMMER, stats: {}, source: other, owner: other, target: armored, damageMultiplier: 1,
    }, { targetKinds: ["BOT"] });
    assert.equal(armored.hp, 90);
    assert.equal(other.hp, 95, "one reflection (half of the reflected 10), not a chain back to the armored bot");
    assert.equal(armored.hp, 90, "the armored bot is not hit again");
}));
