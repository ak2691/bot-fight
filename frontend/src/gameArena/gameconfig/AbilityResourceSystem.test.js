import assert from "node:assert/strict";
import test from "node:test";
import { abilityRecord, activeRemainingMs, cooldownRemainingMs, preparingAbilityId, preparingRemainingMs, pendingCooldownMs } from "../../../../shared/engine/gameconfig/AbilityState.js";
import {
    abilityChargesFor,
    abilityChargeCount,
    abilityRechargeRemainingMs,
    abilityReadyInMs,
    anotherAbilityActive,
    consumeAbilityCharges,
    initialAbilityState,
    interruptCurrentAbility,
    rechargeAbility,
} from "../../../../shared/engine/gameconfig/AbilityResourceSystem.js";
import { ABILITY_STATS } from "../../../../shared/engine/gameconfig/Abilities.js";
import { tickBotResources } from "../testing/pureTicks.js";

const alive = { hp: 100 };

test("proximity mine is cooldown-only and never exposes an ability charge", () => {
    assert.equal(ABILITY_STATS[11].maxCharges, undefined);
    assert.equal(abilityChargeCount({ abilityState: { 11: { stage: "ready", remainingMs: 0, charges: 1 } } }, 11), null);
});

test("every finite ammunition or charge resource is represented by the ability record", () => {
    const chargeAbilityIds = Object.entries(ABILITY_STATS)
        .filter(([, stats]) => stats.maxCharges != null)
        .map(([abilityId]) => Number(abilityId));

    // Sniper (3) and Fireball (5) no longer use ammunition; Pistol is the only reload resource.
    assert.deepEqual(chargeAbilityIds, [12]);
    for (const id of [3, 5]) {
        assert.equal(ABILITY_STATS[id].maxCharges, undefined);
        assert.equal(ABILITY_STATS[id].reloadMs, undefined);
        assert.equal(ABILITY_STATS[id].resourceModel, undefined);
        assert.equal(abilityChargeCount({ abilityState: { [id]: { stage: "ready", remainingMs: 0, charges: 6 } } }, id), null);
    }
    assert.equal(abilityChargeCount({ abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 10 } } }, 12), 10);
    assert.equal(ABILITY_STATS[12].maxCharges, 10);
    assert.equal(ABILITY_STATS[12].reloadMs, 3000);
    assert.equal(ABILITY_STATS[16].maxCharges, undefined);
    assert.equal(ABILITY_STATS[17].maxCharges, undefined);
});

test("starting records are ready, with full charges only for charge-bearing abilities", () => {
    assert.deepEqual(initialAbilityState([1, 12], 150), {
        1: { stage: "ready", remainingMs: 0 },
        12: { stage: "ready", remainingMs: 0, charges: 10, reloadMs: 0 },
    });
});

test("conditional charges include ammunition resources and ignore retired abilities", () => {
    assert.equal(abilityChargesFor({ abilityState: { 2: { stage: "ready", remainingMs: 0, charges: 25.99 } } }, 2), 0);
    assert.equal(abilityChargesFor({ abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 11 } } }, 12), 10);
    assert.equal(abilityChargesFor({ abilityState: { 3: { stage: "ready", remainingMs: 0, charges: 7 } } }, 3), 0);
    assert.equal(abilityChargesFor({ abilityState: { 1: { stage: "ready", remainingMs: 0, charges: 1 } } }, 1), 0);
});

test("the resource recharger counts a reload down while empty", () => {
    const reloading = rechargeAbility({
        maxCharges: 10,
        charges: 0,
        rechargeMs: 3_000,
        stats: { resourceModel: "reload", reloadMs: 3_000 },
    }, 100);
    assert.equal(reloading.charges, 0);
    assert.equal(reloading.rechargeMs, 2_900);
});

test("resource ticking applies the same function to every equipped charge definition", () => {
    const next = tickBotResources({ ...alive, abilities: [3, 5, 11, 12], abilityState: { 3: { stage: "ready", remainingMs: 0, charges: 0, reloadMs: 3_000 }, 5: { stage: "ready", remainingMs: 0, charges: 0, reloadMs: 3_000 }, 11: { stage: "ready", remainingMs: 0, charges: 0, reloadMs: 0 }, 12: { stage: "ready", remainingMs: 0, charges: 0, reloadMs: 3_000 } } }, 100);

    // Only the charge-bearing ability keeps charges; the rest never carry ammunition.
    assert.deepEqual(Object.keys(next.abilityState).filter((id) => next.abilityState[id].charges != null), ["12"]);
    assert.equal(abilityRecord(next, 12).charges, 0);
    assert.equal(abilityRecord(next, 12)?.reloadMs, 2_900);
    assert.equal(abilityRecord(next, 3)?.reloadMs, undefined);
});

test("charge reloads wait for the active phase before consuming time", () => {
    const source = { ...alive, abilities: [12], abilityState: { 12: { stage: "active", remainingMs: 500, charges: 0, reloadMs: 3_000 } } };
    const active = tickBotResources(source, 100);
    assert.equal(abilityRecord(active, 12)?.reloadMs, 3_000);
    assert.equal(activeRemainingMs(active, 12), 400);

    const recovering = tickBotResources({ ...active, abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 0, reloadMs: 3_000 } } }, 100);
    assert.equal(abilityRecord(recovering, 12)?.reloadMs, 2_900);
});

test("generic charge consumption starts reloads only when a resource becomes empty", () => {
    const reloadsWhenEmpty = consumeAbilityCharges(
        { abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 1, reloadMs: 0 } } },
        12, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(reloadsWhenEmpty.consumed, true);
    assert.equal(abilityChargeCount(reloadsWhenEmpty.shape, 12), 0);
    assert.equal(cooldownRemainingMs(reloadsWhenEmpty.shape, 12) ?? 0, 0);
    assert.equal(abilityRechargeRemainingMs(reloadsWhenEmpty.shape, 12), 3_100);

    const stillLoaded = consumeAbilityCharges(
        { abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 4, reloadMs: 0 } } },
        12, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(abilityChargeCount(stillLoaded.shape, 12), 3);
    assert.equal(abilityRecord(stillLoaded.shape, 12)?.reloadMs, 0);

    const overclockedReload = consumeAbilityCharges({
        statusEffects: [{
            type: "overclock",
            remainingMs: 4_000,
            effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
        }],
        abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 1, reloadMs: 0 } },
    }, 12, 1, { elapsedMs: 100, cooldownMultiplier: 1 });
    assert.equal(abilityRechargeRemainingMs(overclockedReload.shape, 12), 1_600);

    const pistol = consumeAbilityCharges(
        { abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 1, reloadMs: 0 } } }, 12, 1);
    assert.equal(pistol.consumed, true);
    assert.equal(abilityChargeCount(pistol.shape, 12), 0);
    assert.equal(abilityRechargeRemainingMs(pistol.shape, 12), 3_000);
});

test("interrupting preparation starts recovery without activating the ability", () => {
    const interrupted = interruptCurrentAbility({
        abilities: [9],
        attackSpeedMultiplier: 1,
        abilityState: { 9: { stage: "windup", remainingMs: 300, target: { x: 400, y: 200 } } },
    });

    assert.equal(preparingAbilityId(interrupted), null);
    assert.equal(preparingRemainingMs(interrupted), 0);
    assert.equal(interrupted.abilityState[9].target, undefined);
    assert.equal(activeRemainingMs(interrupted, 9) ?? 0, 0);
    assert.equal(cooldownRemainingMs(interrupted, 9), 6_700);
    assert.equal(interrupted.abilityState[9].stage, "cooldown");
    assert.equal(pendingCooldownMs(interrupted, 9), 0);
});

test("interrupting an active ability exposes reserved recovery and leaves reload as the only gate", () => {
    const active = interruptCurrentAbility({
        abilities: [9, 12],
        attackSpeedMultiplier: 1,
        abilityState: { 9: { stage: "active", remainingMs: 300, cooldownMs: 6_700 }, 12: { stage: "active", remainingMs: 300, charges: 0, reloadMs: 5_000 } },
    });

    assert.equal(activeRemainingMs(active, 9), 0);
    assert.equal(cooldownRemainingMs(active, 9), 6_700);
    assert.equal(pendingCooldownMs(active, 9), 0);
    assert.equal(activeRemainingMs(active, 12), 0);
    assert.equal(cooldownRemainingMs(active, 12), 0);
    assert.equal(abilityRecord(active, 12)?.reloadMs, 5_000);
});

test("interrupting a dash clears its movement state and starts its short cooldown", () => {
    const interrupted = interruptCurrentAbility({
        abilities: [19],
        dashRemaining: 75,
        movementVelocityX: 8,
        movementVelocityY: 0,
        velocityX: 8,
        velocityY: 0,
        abilityState: { 19: { stage: "active", remainingMs: 200 } },
    });

    assert.equal(interrupted.dashRemaining, 0);
    assert.equal(interrupted.movementVelocityX, 0);
    assert.equal(interrupted.velocityX, 0);
    assert.equal(cooldownRemainingMs(interrupted, 19), 100, "Dash recovers for its cooldownMs after it is interrupted");
});

test("cooldown after active: only the leftover of the step that ends the active stage counts", () => {
    // Active for 250 ms of a 300 ms request: 50 ms left over in the third step starts the cooldown.
    const first = { ...alive, abilities: [1], abilityState: { 1: { stage: "active", remainingMs: 250, cooldownMs: 500 } } };
    const step1 = tickBotResources(first, 100);
    assert.equal(step1.abilityState[1].stage, "active");
    const step2 = tickBotResources(step1, 100);
    assert.equal(step2.abilityState[1].remainingMs, 50);
    const step3 = tickBotResources(step2, 100);
    assert.deepEqual([step3.abilityState[1].stage, step3.abilityState[1].remainingMs], ["cooldown", 450]);
    // An ability that activated this step is skipped; every other record advances.
    const skipped = tickBotResources(first, 100, 1);
    assert.equal(skipped.abilityState[1].remainingMs, 250);
});

test("readyInMs is the longest of the cooldown, the reload and the time to afford the cost", () => {
    const dashing = { stamina: 10, staminaRegenDelayMs: 500, abilities: [19, 12], abilityState: { 19: { stage: "cooldown", remainingMs: 200 }, 12: { stage: "ready", remainingMs: 0, charges: 0, reloadMs: 800 } } };
    // Dash: 200 ms cooldown vs 500 ms pause + 10 regeneration ticks for the 20 missing stamina.
    assert.equal(abilityReadyInMs(dashing, 19), 1_500);
    assert.equal(abilityReadyInMs(dashing, 12), 800, "a reload, no stamina cost");
    assert.equal(abilityReadyInMs({ abilityState: { 19: { stage: "cooldown", remainingMs: 200 } } }, 19), 200);
});

test("a channel is busy only while one of its abilities winds up or is active", () => {
    const winding = { abilityState: { 3: { stage: "windup", remainingMs: 500 } } };
    assert.equal(anotherAbilityActive(winding, 5), true, "same channel");
    assert.equal(anotherAbilityActive(winding, 3), false, "an ability never blocks itself");
    assert.equal(anotherAbilityActive(winding, 19), false, "the dash channel is independent");
    const dashing = { abilityState: { 19: { stage: "active", remainingMs: 200 } } };
    assert.equal(anotherAbilityActive(dashing, 3), false, "a running dash blocks no ability");
    assert.equal(anotherAbilityActive({ abilityState: { 3: { stage: "cooldown", remainingMs: 900 } } }, 5), false, "a cooldown is not busy");
});
