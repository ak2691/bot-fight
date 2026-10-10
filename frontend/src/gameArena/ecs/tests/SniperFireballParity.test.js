import assert from "node:assert/strict";
import test from "node:test";
import { abilityHitsTarget } from "../../../../../shared/engine/ecs/abilities/AbilityHitDetectionSystem.js";
import { createAbilityEntity } from "../../../../../shared/engine/ecs/entities/EntityFactory.js";
import { ABILITY_STATS } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { ENTITY_CONTRACTS, phaseEffects, triggerView } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { abilityIdFromBoundary } from "../../../../../shared/engine/gameconfig/AbilityCompatibility.js";
import { abilityIdFromName } from "../../../../../shared/engine/gameconfig/AbilityRegistry.js";
import { applyBotAction, tickAbilityEntityWorld } from "../../testing/pureTicks.js";
import { preparingAbilityId } from "../../../../../shared/engine/gameconfig/AbilityState.js";

// Mirrors server SniperFireballParityTest; keep both in step.
const sniperBot = (extra = {}) => ({
    id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
    abilities: [3], abilityState: {}, ...extra,
});
const firing = (extra) => ({ ...sniperBot(extra), triggeredAbility: 3 });

test("Sniper keeps its ID and legacy name but reads Sniper in the catalogue", () => {
    assert.equal(abilityIdFromName("gun"), 3);
    assert.equal(abilityIdFromBoundary("gun"), 3);
});

test("Sniper hits at 1200 range and misses beyond it, with flat damage", () => {
    const attacker = firing();
    const reach = 1200 + 30 + 3;
    assert.equal(abilityHitsTarget(attacker, { x: 100 + 1200, y: 100, size: 60 }), true);
    assert.equal(abilityHitsTarget(attacker, { x: 100 + reach - 1, y: 100, size: 60 }), true);
    assert.equal(abilityHitsTarget(attacker, { x: 100 + reach + 1, y: 100, size: 60 }), false);
    assert.equal(abilityHitsTarget(attacker, { x: 100 + 150, y: 100, size: 60 }), true);
    assert.equal(ABILITY_STATS[3].falloff, undefined);
    assert.equal(triggerView(3).effects[0].amount, 40);
});

test("Sniper ray width of 6 sets its side edges", () => {
    const attacker = firing();
    assert.equal(abilityHitsTarget(attacker, { x: 400, y: 100 + 32, size: 60 }), true);
    assert.equal(abilityHitsTarget(attacker, { x: 400, y: 100 + 34, size: 60 }), false);
});

test("Sniper aim follows rotation during the wind-up and fires from the release pose", () => {
    const action = { dx: 0, dy: 0, dRot: 10 / 12, abilityAction: { action: 3 } };
    let bot = sniperBot({ rotation: 0, x: 100, y: 100 });
    // The target is due east: from the starting pose (facing north) the shot would miss.
    const target = { x: 700, y: 100, size: 60 };
    assert.equal(abilityHitsTarget({ ...bot, triggeredAbility: 3 }, target), false);
    for (let elapsed = 100; elapsed < 900; elapsed += 100) {
        bot = applyBotAction(bot, action, 100);
        assert.equal(bot.triggeredAbility ?? null, null);
        assert.equal(preparingAbilityId(bot), 3);
        assert.ok(bot.rotation > 0, "the bot keeps rotating while aiming");
    }
    const released = applyBotAction(bot, action, 100);
    assert.equal(released.triggeredAbility, 3);
    assert.equal(released.rotation, 90);
    assert.equal(released.gunRayRotation, 90);
    assert.equal(abilityHitsTarget(released, target), true);
});

test("Sniper fires from the bot's position at release, not where the wind-up started", () => {
    const action = { dx: 1, dy: 0, dRot: 0, abilityAction: { action: 3 } };
    let bot = sniperBot();
    for (let elapsed = 100; elapsed < 900; elapsed += 100) bot = applyBotAction(bot, action, 100);
    const released = applyBotAction(bot, action, 100);
    assert.equal(released.triggeredAbility, 3);
    assert.ok(released.x > 100, "moved while aiming");
    assert.equal(released.gunRayOriginX, released.x);
    assert.equal(released.gunRayOriginY, released.y);
});

function fireballWorld(targetX, targetY, ticks = 16) {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 150, maxHp: 150, attackDamageMultiplier: 1 };
    let target = { id: "target", slot: 2, x: targetX, y: targetY, size: 60, rotation: 270, hp: 150, maxHp: 150 };
    let entities = [createAbilityEntity(owner, 5, {})];
    const startX = entities[0].x;
    let lastX = startX;
    let aliveTicks = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
        const world = tickAbilityEntityWorld({
            entities, bots: [owner, target], stepMs: 100, width: 2000, height: 1000,
        });
        entities = world.entities;
        target = world.bots[1];
        const fireball = entities.find((entity) => entity.abilityId === 5);
        if (fireball) { lastX = fireball.x; aliveTicks += 1; }
    }
    return { target, startX, lastX, aliveTicks };
}

test("Fireball contract is 64x64 with a 60 visual, 20 damage and 1400 ms lifetime", () => {
    const phase = ENTITY_CONTRACTS[5].phases[0];
    assert.equal(phase.hitbox.width, 64);
    assert.equal(phase.hitbox.length, 64);
    assert.equal(phase.visual.visualSize, 60);
    assert.equal(phaseEffects(phase)[0].amount, 20);
    assert.equal(ENTITY_CONTRACTS[5].lifetime.duration, 1400);
    assert.equal(ABILITY_STATS[5].maxCharges, undefined);
});

test("Fireball hitbox edges are 64x64 plus the target radius", () => {
    // Half of 64 plus the 30-unit target radius is 62 units of lateral reach.
    assert.ok(fireballWorld(400, 100 + 60).target.hp < 150);
    assert.equal(fireballWorld(400, 100 + 66).target.hp, 150);
    assert.equal(150 - fireballWorld(400, 100).target.hp, 20);
});

test("Fireball travels about 700 units over its 1400 ms life", () => {
    const { startX, lastX, aliveTicks } = fireballWorld(1900, 900);
    assert.ok(lastX - startX >= 600 && lastX - startX <= 750, `travelled ${lastX - startX}`);
    assert.ok(aliveTicks <= 15);
});
