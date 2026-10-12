import assert from "node:assert/strict";
import test from "node:test";
import { cooldownRemainingMs } from "../../../../shared/engine/gameconfig/AbilityState.js";
import { anotherAbilityActive,
    interruptCurrentAbility,
    rechargeAbility,
} from "../../../../shared/engine/gameconfig/AbilityResourceSystem.js";
import { ABILITY_STATS } from "../../../../shared/engine/gameconfig/Abilities.js";
import { tickBotResources } from "../testing/pureTicks.js";

const alive = { hp: 100 };

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

test("interrupting a dash clears its movement state and starts its short cooldown", () => {
    const interrupted = interruptCurrentAbility({
        abilities: [19],
        dashRemaining: 75,
        moveAbilityId: 19,
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

test("a channel is busy only while one of its abilities winds up or is active", () => {
    const winding = { abilityState: { 3: { stage: "windup", remainingMs: 500 } } };
    assert.equal(anotherAbilityActive(winding, 5), true, "same channel");
    assert.equal(anotherAbilityActive(winding, 3), false, "an ability never blocks itself");
    assert.equal(anotherAbilityActive(winding, 19), false, "the dash channel is independent");
    const dashing = { abilityState: { 19: { stage: "active", remainingMs: 200 } } };
    assert.equal(anotherAbilityActive(dashing, 3), false, "a running dash blocks no ability");
    assert.equal(anotherAbilityActive({ abilityState: { 3: { stage: "cooldown", remainingMs: 900 } } }, 5), false, "a cooldown is not busy");
});
