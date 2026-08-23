import assert from "node:assert/strict";
import test from "node:test";
import {
    abilityChargesFor,
    abilityChargeCount,
    abilityRechargeRemainingMs,
    consumeAbilityCharges,
    rechargeAbility,
    rechargeAbilityResources,
} from "./AbilityResourceSystem.js";
import { ABILITY_STATS } from "./Abilities.js";

test("proximity mine is cooldown-only and never exposes an ability charge", () => {
    assert.equal(ABILITY_STATS[11].maxCharges, undefined);
    assert.equal(abilityChargeCount({ abilityCharges: { 11: 1 } }, 11), null);
});

test("every finite ammunition or charge resource is represented by the canonical map", () => {
    const chargeAbilityIds = Object.entries(ABILITY_STATS)
        .filter(([, stats]) => stats.maxCharges != null)
        .map(([abilityId]) => Number(abilityId));

    assert.deepEqual(chargeAbilityIds, [3, 5]);
    assert.equal(abilityChargeCount({ abilityCharges: { 3: 6 } }, 3), 6);
    assert.equal(abilityChargeCount({ abilityCharges: { 5: 4 } }, 5), 4);
    assert.equal(ABILITY_STATS[16].maxCharges, undefined);
    assert.equal(ABILITY_STATS[17].maxCharges, undefined);
});

test("conditional charges include ammunition resources and ignore retired abilities", () => {
    assert.equal(abilityChargesFor({ abilityCharges: { 2: 25.99 } }, 2), 0);
    assert.equal(abilityChargesFor({ abilityCharges: { 3: 7 } }, 3), 6);
    assert.equal(abilityChargesFor({ abilityCharges: { 1: 1 } }, 1), 0);
});

test("one resource recharger handles both regenerate and reload payloads", () => {
    const regenerating = rechargeAbility({
        maxCharges: 5,
        charges: 3,
        rechargeMs: 4_500,
        stats: { resourceModel: "regenerate", rechargeMs: 5_000 },
    }, 600);
    assert.deepEqual(regenerating, {
        maxCharges: 5,
        charges: 4,
        rechargeMs: 100,
        stats: { resourceModel: "regenerate", rechargeMs: 5_000 },
    });

    const reloading = rechargeAbility({
        maxCharges: 10,
        charges: 0,
        rechargeMs: 3_000,
        stats: { resourceModel: "reload", reloadMs: 3_000 },
    }, 100);
    assert.equal(reloading.charges, 0);
    assert.equal(reloading.rechargeMs, 2_900);
});

test("fixed resources only exist while active and reset when the active window ends", () => {
    const active = rechargeAbility({
        maxCharges: 3,
        charges: 2,
        rechargeMs: 0,
        active: true,
        stats: { resourceModel: "fixed" },
    }, 100);
    assert.equal(active.charges, 2);

    const inactive = rechargeAbility({
        maxCharges: 3,
        charges: 2,
        rechargeMs: 0,
        active: false,
        stats: { resourceModel: "fixed" },
    }, 100);
    assert.equal(inactive.charges, 0);
    assert.equal(inactive.rechargeMs, 0);
});

test("resource ticking applies the same function to every equipped charge definition", () => {
    const next = rechargeAbilityResources({
        abilities: [3, 5, 11],
        abilityCharges: { 3: 0, 5: 0, 11: 0 },
        abilityRechargeMs: { 3: 3_000, 5: 3_000, 11: 0 },
    }, 100);

    assert.deepEqual(next.charges, { 3: 0, 5: 0 });
    assert.deepEqual(next.rechargeMs, { 3: 2_900, 5: 2_900 });
});

test("charge reloads wait for the active phase before consuming time", () => {
    const source = {
        abilities: [5],
        abilityCharges: { 5: 0 },
        abilityRechargeMs: { 5: 3_000 },
        abilityActiveMs: { 5: 500 },
    };
    const active = rechargeAbilityResources(source, 100);
    assert.equal(active.rechargeMs[5], 3_000);

    const recovering = rechargeAbilityResources({
        ...source,
        abilityCharges: active.charges,
        abilityRechargeMs: active.rechargeMs,
        abilityActiveMs: { 5: 0 },
    }, 100);
    assert.equal(recovering.rechargeMs[5], 2_900);
});

test("generic charge consumption starts reloads only when a resource becomes empty", () => {
    const gun = consumeAbilityCharges({
        abilityCharges: { 3: 1 },
        abilityRechargeMs: { 3: 0 },
    }, 3, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(gun.consumed, true);
    assert.equal(abilityChargeCount(gun.shape, 3), 0);
    assert.equal(gun.shape.abilityCooldowns?.[3] ?? 0, 0);
    assert.equal(abilityRechargeRemainingMs(gun.shape, 3), 5_100);

    const fireball = consumeAbilityCharges({
        abilityCharges: { 5: 4 },
        abilityRechargeMs: { 5: 0 },
    }, 5, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(abilityChargeCount(fireball.shape, 5), 3);
    assert.equal(fireball.shape.abilityRechargeMs[5], 0);

    const overclockedReload = consumeAbilityCharges({
        abilityCharges: { 3: 1 },
        abilityRechargeMs: { 3: 0 },
        statusEffects: [{
            type: "overclock",
            remainingMs: 4_000,
            effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
        }],
    }, 3, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(abilityRechargeRemainingMs(overclockedReload.shape, 3), 2_600);

});
