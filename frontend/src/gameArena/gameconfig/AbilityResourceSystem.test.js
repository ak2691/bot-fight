import assert from "node:assert/strict";
import test from "node:test";
import {
    abilityChargesFor,
    abilityChargeCount,
    abilityRechargeRemainingMs,
    consumeAbilityCharges,
    interruptCurrentAbility,
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

    // Sniper (3) and Fireball (5) no longer use ammunition; Pistol is the only reload resource.
    assert.deepEqual(chargeAbilityIds, [12]);
    for (const id of [3, 5]) {
        assert.equal(ABILITY_STATS[id].maxCharges, undefined);
        assert.equal(ABILITY_STATS[id].reloadMs, undefined);
        assert.equal(ABILITY_STATS[id].resourceModel, undefined);
        assert.equal(abilityChargeCount({ abilityCharges: { [id]: 6 } }, id), null);
    }
    assert.equal(abilityChargeCount({ abilityCharges: { 12: 10 } }, 12), 10);
    assert.equal(ABILITY_STATS[12].maxCharges, 10);
    assert.equal(ABILITY_STATS[12].reloadMs, 3000);
    assert.equal(ABILITY_STATS[16].maxCharges, undefined);
    assert.equal(ABILITY_STATS[17].maxCharges, undefined);
});

test("conditional charges include ammunition resources and ignore retired abilities", () => {
    assert.equal(abilityChargesFor({ abilityCharges: { 2: 25.99 } }, 2), 0);
    assert.equal(abilityChargesFor({ abilityCharges: { 12: 11 } }, 12), 10);
    assert.equal(abilityChargesFor({ abilityCharges: { 3: 7 } }, 3), 0);
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
        abilities: [3, 5, 11, 12],
        abilityCharges: { 3: 0, 5: 0, 11: 0, 12: 0 },
        abilityRechargeMs: { 3: 3_000, 5: 3_000, 11: 0, 12: 3_000 },
    }, 100);

    assert.deepEqual(next.charges, { 12: 0 });
    assert.deepEqual(next.rechargeMs, { 12: 2_900 });
});

test("charge reloads wait for the active phase before consuming time", () => {
    const source = {
        abilities: [12],
        abilityCharges: { 12: 0 },
        abilityRechargeMs: { 12: 3_000 },
        abilityActiveMs: { 12: 500 },
    };
    const active = rechargeAbilityResources(source, 100);
    assert.equal(active.rechargeMs[12], 3_000);

    const recovering = rechargeAbilityResources({
        ...source,
        abilityCharges: active.charges,
        abilityRechargeMs: active.rechargeMs,
        abilityActiveMs: { 12: 0 },
    }, 100);
    assert.equal(recovering.rechargeMs[12], 2_900);
});

test("generic charge consumption starts reloads only when a resource becomes empty", () => {
    const reloadsWhenEmpty = consumeAbilityCharges({
        abilityCharges: { 12: 1 },
        abilityRechargeMs: { 12: 0 },
    }, 12, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(reloadsWhenEmpty.consumed, true);
    assert.equal(abilityChargeCount(reloadsWhenEmpty.shape, 12), 0);
    assert.equal(reloadsWhenEmpty.shape.abilityCooldowns?.[12] ?? 0, 0);
    assert.equal(abilityRechargeRemainingMs(reloadsWhenEmpty.shape, 12), 3_100);

    const stillLoaded = consumeAbilityCharges({
        abilityCharges: { 12: 4 },
        abilityRechargeMs: { 12: 0 },
    }, 12, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(abilityChargeCount(stillLoaded.shape, 12), 3);
    assert.equal(stillLoaded.shape.abilityRechargeMs[12], 0);

    const overclockedReload = consumeAbilityCharges({
        abilityCharges: { 12: 1 },
        abilityRechargeMs: { 12: 0 },
        statusEffects: [{
            type: "overclock",
            remainingMs: 4_000,
            effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
        }],
    }, 12, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(abilityRechargeRemainingMs(overclockedReload.shape, 12), 1_600);

    const pistol = consumeAbilityCharges({
        abilityCharges: { 12: 1 },
        abilityRechargeMs: { 12: 0 },
    }, 12, 1);
    assert.equal(pistol.consumed, true);
    assert.equal(abilityChargeCount(pistol.shape, 12), 0);
    assert.equal(abilityRechargeRemainingMs(pistol.shape, 12), 3_000);

});

test("interrupting preparation starts recovery without activating the ability", () => {
    const interrupted = interruptCurrentAbility({
        abilities: [9],
        attackSpeedMultiplier: 1,
        preparingAbility: 9,
        preparingMs: 300,
        preparingTargetX: 400,
        preparingTargetY: 200,
        abilityCooldowns: { 9: 0 },
        abilityActiveMs: {},
    });

    assert.equal(interrupted.preparingAbility, null);
    assert.equal(interrupted.preparingMs, 0);
    assert.equal(interrupted.preparingTargetX, null);
    assert.equal(interrupted.abilityActiveMs[9] ?? 0, 0);
    assert.equal(interrupted.abilityCooldowns[9], 6_700);
    assert.equal(interrupted.abilityPendingCooldownMs?.[9], undefined);
});

test("interrupting an active ability exposes reserved recovery and leaves reload as the only gate", () => {
    const active = interruptCurrentAbility({
        abilities: [9, 12],
        attackSpeedMultiplier: 1,
        abilityCooldowns: { 9: 0, 12: 0 },
        abilityPendingCooldownMs: { 9: 6_700 },
        abilityActiveMs: { 9: 300, 12: 300 },
        abilityCharges: { 12: 0 },
        abilityRechargeMs: { 12: 5_000 },
    });

    assert.equal(active.abilityActiveMs[9], 0);
    assert.equal(active.abilityCooldowns[9], 6_700);
    assert.equal(active.abilityPendingCooldownMs?.[9], undefined);
    assert.equal(active.abilityActiveMs[12], 0);
    assert.equal(active.abilityCooldowns[12], 0);
    assert.equal(active.abilityRechargeMs[12], 5_000);
});

test("interrupting a dash clears its movement state", () => {
    const interrupted = interruptCurrentAbility({
        abilities: [19],
        abilityCooldowns: { 19: 0 },
        abilityActiveMs: { 19: 200 },
        dashRemaining: 75,
        movementVelocityX: 8,
        movementVelocityY: 0,
        velocityX: 8,
        velocityY: 0,
    });

    assert.equal(interrupted.dashRemaining, 0);
    assert.equal(interrupted.movementVelocityX, 0);
    assert.equal(interrupted.velocityX, 0);
    assert.equal(interrupted.abilityCooldowns[19], 0, "Dash has no fixed cooldown");
});
