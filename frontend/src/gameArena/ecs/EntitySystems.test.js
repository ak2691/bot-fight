import assert from "node:assert/strict";
import test from "node:test";
import { hunterDroneEntity, nullZoneEntity, orbitalMarkerEntity, proximityMineEntity, silenceWaveEntity, thrownFieldEntity, windburstProjectileEntity } from "./EntityFactory.js";
import { tickAbilityEntityWorld } from "./AbilityEntitySystem.js";
import { tickBotStatus } from "./BotStatusSystem.js";
import { applyBotAction } from "./ActionExecutionSystem.js";
import { grenadeDamageToEntity, tickProjectileWorld } from "./ProjectileSystem.js";
import { abilityActiveOpacity, basicHealParticleSpec, BASIC_HEAL_PARTICLE_COUNT, BASIC_HEAL_PARTICLE_LIFETIME_MS, combatVisualRemainingMs, healthBarPercent, abilityVisualOpacity, REPULSOR_BURST_FRAME_COUNT, REPULSOR_BURST_FRAME_MS, REPULSOR_BURST_MAX_DIAMETER, REPULSOR_BURST_VISUAL_MS, repulsorBurstDiameter, repulsorBurstFrameIndex, repulsorBurstProgress, sweepAngle } from "../gameconfig/visualState.js";
import { applyDamageFromShapes, applyDamageToShape, resolveTriggeredAbilityCombat as resolveAbilityCombat, settlePendingHealing } from "../gameconfig/BotCombatSystem.js";
import { abilityHitsTarget } from "./AbilityEffectSystem.js";
import { buildDeterministicLogicAction } from "../botlogic/planner/ArenaActionPlanner.js";
import { buildStatePayload } from "../modelPayloads/strategyStatePayload.js";
import { abilityDefinition, ABILITY_STATS, shouldInterpolateAbilityVisual } from "../loadout/BotLoadout.js";
import { ABILITY_CONTRACTS, DELIVERY_TYPES, EFFECT_TYPES, SHIELD_CHARGE_COSTS, SHIELD_MODES } from "../gameconfig/AbilityContracts.js";
import { resolveShieldInteraction } from "../gameconfig/ShieldSystem.js";
import { botStatusLabels } from "../pixi/pixiVisualState.js";
import { resetBotShape } from "../modelPayloads/arenaShapes.js";
import { compassDirection } from "../botlogic/planner/arenaAngles.js";
import { CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER, CONCUSSIVE_SHOT_SLOW_DURATION_MS, HIT_STAGGER_DURATION_MS, HIT_STAGGER_MOVEMENT_MULTIPLIER, HIT_STAGGER_ROTATION_MULTIPLIER } from "../gameconfig/HitStagger.js";

const noDamageCombat = {
    applyDamageToShape: (bot, damage) => ({ ...bot, hp: Math.max(0, bot.hp - damage) }),
    applyDamageFromShapes: (owner, target, damage) => [owner, { ...target, hp: target.hp - damage }],
    abilityHitsTarget: () => false,
    triggeredAbilityDamage: () => 0,
    grenadeDamageToBot: () => 0,
    overlapsShape: () => false,
};

function targetAtBearing(attacker, distance, bearing, size = 20) {
    const direction = compassDirection(bearing);
    return { x: attacker.x + direction.x * distance, y: attacker.y + direction.y * distance, size };
}

const base = {
    id: "target",
    slot: 2,
    x: 100,
    y: 100,
    size: 60,
    hp: 100,
    maxHp: 100,
    moveSpeed: 12,
    attackSpeedMultiplier: 1,
    movementVelocityX: 0,
    movementVelocityY: 0,
};

test("resetting bot stats clears every transient status effect", () => {
    const reset = resetBotShape({
        id: "main",
        combatLoadout: "custom",
        x: 400,
        y: 400,
        bleedRemainingMs: 5000,
        shockRemainingMs: 2000,
        nullZoneSilenced: true,
        movementLockMs: 1000,
        temporalRewindMs: 3000,
        pendingHealing: 25,
    });

    assert.equal(reset.bleedRemainingMs, 0);
    assert.equal(reset.shockRemainingMs, 0);
    assert.equal(reset.nullZoneSilenced, false);
    assert.equal(reset.movementLockMs, 0);
    assert.equal(reset.temporalRewindMs, 0);
    assert.equal(reset.pendingHealing, 0);
});

test("ability metadata separates instantaneous effects from interpolated motion", () => {
    for (const id of [1, 3, 12, 13, 9]) {
        assert.equal(shouldInterpolateAbilityVisual(id), false, id);
        assert.ok(abilityDefinition(id).tags.includes("instant-visual"), id);
    }
    for (const id of [4, 5, 19, 18]) {
        assert.equal(shouldInterpolateAbilityVisual(id), true, id);
        assert.ok(abilityDefinition(id).tags.includes("interpolated-visual"), id);
    }
});

test("every selectable ability exposes delivery, effects, and a shield policy", () => {
    for (const id of Object.keys(ABILITY_CONTRACTS).map(Number)) {
        const definition = abilityDefinition(id);
        assert.ok(definition, id);
        assert.ok(Object.values(DELIVERY_TYPES).includes(definition.delivery.type), id);
        assert.ok(Array.isArray(definition.effects), id);
        assert.ok(Object.values(SHIELD_MODES).includes(definition.shieldInteraction.mode), id);
    }
    assert.equal(ABILITY_CONTRACTS[25].delivery.type, DELIVERY_TYPES.MELEE);
});

test("shield contracts describe partial and full effect blocking", () => {
    assert.deepEqual(new Set(ABILITY_CONTRACTS[8].shieldInteraction.prevents), new Set([EFFECT_TYPES.DAMAGE]));
    assert.ok(!ABILITY_CONTRACTS[8].shieldInteraction.prevents.includes(EFFECT_TYPES.KNOCKBACK));
    assert.deepEqual(new Set(ABILITY_CONTRACTS[14].shieldInteraction.prevents), new Set([EFFECT_TYPES.DAMAGE]));
    assert.ok(!ABILITY_CONTRACTS[14].shieldInteraction.prevents.includes(EFFECT_TYPES.PULL));
    assert.equal(ABILITY_CONTRACTS[7].shieldInteraction.chargeCost, SHIELD_CHARGE_COSTS.ALL);
    assert.equal(ABILITY_CONTRACTS[22].shieldInteraction.mode, SHIELD_MODES.DRAIN_WHILE_ACTIVE);
});

test("declarative shield resolution filters effects and consumes configured charges", () => {
    const bot = { x: 100, y: 100, rotation: 180, abilityActiveMs: { 2: 100 }, blockCharges: 5 };
    const source = { x: 0, y: 100 };
    const repulsor = resolveShieldInteraction(bot, source, ABILITY_CONTRACTS[8].shieldInteraction);
    assert.equal(repulsor.bot.blockCharges, 4);
    assert.ok(repulsor.preventedEffects.has(EFFECT_TYPES.DAMAGE));
    assert.ok(!repulsor.preventedEffects.has(EFFECT_TYPES.KNOCKBACK));
    const slash = resolveShieldInteraction(bot, source, ABILITY_CONTRACTS[7].shieldInteraction);
    assert.equal(slash.bot.blockCharges, 0);
});

test("hunter drone spawns with component health and 50 hp", () => {
    const drone = hunterDroneEntity({ id: "owner", slot: 1, x: 100, y: 200, rotation: 0 });
    assert.equal(drone.hp, 50);
    assert.equal(drone.components.health.hp, 50);
    assert.equal(drone.components.collider.hittable, true);
});

test("hunter drone pursues targets at 4.5 units per arena tick", () => {
    const drone = hunterDroneEntity({ id: "owner", slot: 1, x: 100, y: 200, rotation: 0 });
    const target = { id: "target", slot: 2, x: 500, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], bots: [target], grenades: [], fireballs: [],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);
    assert.equal(result.entities[0].x, 104.5);
    assert.equal(result.entities[0].y, 200);
});

test("hunter drone retains the replay-matched shot visual timer", () => {
    const drone = { ...hunterDroneEntity({ id: "owner", slot: 1, x: 100, y: 200, rotation: 90 }), shotCooldownMs: 0 };
    const target = { id: "target", slot: 2, x: 200, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], bots: [target], grenades: [], fireballs: [],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities[0].shotVisualMs, 250);
});

test("entity-hit records trigger an armed mine through the entity system", () => {
    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true };
    const bot = { id: "attacker", slot: 2, x: 500, y: 500, size: 50, hp: 100, entityHitIds: [mine.id] };
    const result = tickAbilityEntityWorld({
        entities: [mine], bots: [bot], grenades: [], fireballs: [],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].type, "mineExplosion");
    assert.equal(result.entities[0].visibleMs, 300);
});

test("proximity mine triggers and damages within its increased radius", () => {
    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true };
    const bot = { id: "target", slot: 2, x: 180, y: 100, size: 50, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [mine], bots: [bot], grenades: [], fireballs: [],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities[0].type, "mineExplosion");
    assert.equal(result.entities[0].size, 175);
    assert.equal(result.bots[0].hp, 82);
});

test("status effects are accumulated before the bot hp snapshot is returned", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        burnRemainingMs: 1000, burnTickMs: 50, burnDamageMultiplier: 1,
        bleedRemainingMs: 1000, bleedTickMs: 50, bleedDamage: 2,
    };
    const result = tickBotStatus(bot, 50, noDamageCombat.applyDamageToShape);
    assert.equal(result.hp, 96);
    assert.equal(result.burnRemainingMs, 950);
    assert.equal(result.bleedRemainingMs, 950);
});

test("DOT, direct damage, and healing on one tick resolve as one net hp change", () => {
    const bot = {
        hp: 50, maxHp: 100, abilities: [], pendingHealing: 15,
        burnRemainingMs: 1000, burnTickMs: 50, burnDamageMultiplier: 1,
        bleedRemainingMs: 1000, bleedTickMs: 50, bleedDamage: 2,
    };
    const afterDots = tickBotStatus(bot, 50, applyDamageToShape);
    const afterDirectHit = applyDamageToShape(afterDots, 8);
    const result = settlePendingHealing(afterDirectHit);
    assert.equal(result.hp, 53);
    assert.equal(result.damageTakenThisTick, 12);
});

test("burn and bleed discard a pending tick when duration expires first", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        burnRemainingMs: 100, burnTickMs: 200, burnDamageMultiplier: 1,
        bleedRemainingMs: 100, bleedTickMs: 200, bleedDamage: 2,
    };
    const result = tickBotStatus(bot, 200, noDamageCombat.applyDamageToShape);
    assert.equal(result.hp, 100);
    assert.equal(result.burnRemainingMs, 0);
    assert.equal(result.bleedRemainingMs, 0);
});

test("burn and bleed apply a final tick due exactly at expiration", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        burnRemainingMs: 100, burnTickMs: 100, burnDamageMultiplier: 1,
        bleedRemainingMs: 100, bleedTickMs: 100, bleedDamage: 2,
    };
    assert.equal(tickBotStatus(bot, 100, noDamageCombat.applyDamageToShape).hp, 96);
});

test("another heavy slash refreshes bleed duration without resetting its pending tick", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const defender = { id: "target", x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, bleedRemainingMs: 4000, bleedTickMs: 300, bleedDamage: 2 };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 70);
    assert.equal(hit.bleedRemainingMs, 5000);
    assert.equal(hit.bleedTickMs, 300);
    assert.equal(tickBotStatus(hit, 300, noDamageCombat.applyDamageToShape).hp, 68);
});

test("successful hostile HP damage starts, refreshes, and never stacks hit stagger", () => {
    assert.equal(HIT_STAGGER_DURATION_MS, 300);
    assert.equal(HIT_STAGGER_MOVEMENT_MULTIPLIER, 0.85);
    assert.equal(HIT_STAGGER_ROTATION_MULTIPLIER, 0.85);

    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, target);
    assert.equal(hit.hp, 70);
    assert.equal(hit.hitStaggerMs, 300);

    const refreshed = applyDamageToShape({ ...hit, hp: 69, hitStaggerMs: 100 }, 1, attacker);
    assert.equal(refreshed.hitStaggerMs, 300);
    const repeated = applyDamageToShape({ ...refreshed, hp: 68 }, 1, attacker);
    assert.equal(repeated.hitStaggerMs, 300);
});

test("blocked, immune, zero, and shield-only damage do not stagger, while reduced HP damage does", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const blocked = resolveAbilityCombat(attacker, { id: "blocked", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, blockCharges: 5, abilities: [2] })[1];
    assert.equal(blocked.hitStaggerMs ?? 0, 0);
    const immune = applyDamageToShape({ id: "immune", slot: 2, hp: 100, maxHp: 100, abilityActiveMs: { 23: 100 } }, 20, attacker);
    assert.equal(immune.hitStaggerMs ?? 0, 0);
    const zero = applyDamageToShape({ id: "zero", slot: 2, hp: 100, maxHp: 100 }, 0, attacker);
    assert.equal(zero.hitStaggerMs ?? 0, 0);
    const shieldOnly = applyDamageToShape({ id: "shield", slot: 2, hp: 100, maxHp: 100, shieldHp: 5 }, 3, attacker);
    assert.equal(shieldOnly.hp, 100);
    assert.equal(shieldOnly.hitStaggerMs ?? 0, 0);
    const partiallyReduced = applyDamageToShape({ ...shieldOnly, hp: 100 }, 8, attacker);
    assert.equal(partiallyReduced.hp, 94);
    assert.equal(partiallyReduced.hitStaggerMs, 300);
});

test("hit stagger scales allocated movement and rotation for exactly three 100 ms ticks", () => {
    const action = { dx: 1, dy: 0, dRot: 1 };
    const base = { id: "target", slot: 2, x: 100, y: 100, size: 60, hp: 100, maxHp: 100, moveSpeed: 12, movementVelocityX: 12, movementVelocityY: 0 };
    const normal = applyBotAction(base, action, 100, applyDamageToShape);
    const staggered = applyBotAction({ ...base, hitStaggerMs: 300 }, action, 100, applyDamageToShape);
    assert.equal(normal.x, 112);
    assert.equal(staggered.x, 110.2);
    assert.equal(normal.rotation, 12);
    assert.ok(Math.abs(staggered.rotation - 10.2) < 1e-9);
    assert.equal(staggered.hitStaggerMs, 200);

    let ticking = { ...base, hitStaggerMs: 300 };
    for (let index = 0; index < 3; index += 1) ticking = applyBotAction(ticking, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(ticking.hitStaggerMs, 0);
    const expired = applyBotAction(ticking, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(expired.x - ticking.x, 12);

});

test("movement acceleration is half top speed and steering follows the velocity angle", () => {
    const fast = { ...base, moveSpeed: 20 };
    const accelerating = applyBotAction(fast, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(accelerating.x, 110);
    assert.equal(accelerating.movementVelocityX, 10);

    const topSpeed = applyBotAction(accelerating, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(topSpeed.x, 130);
    assert.equal(topSpeed.movementVelocityX, 20);

    const turning = applyBotAction(topSpeed, { dx: 0, dy: 1 }, 100, applyDamageToShape);
    assert.ok(Math.abs(turning.movementVelocityX - (20 - 10 / Math.SQRT2)) < 1e-9);
    assert.ok(Math.abs(turning.movementVelocityY - 10 / Math.SQRT2) < 1e-9);
});

test("Dash is granted with one charge and reloads at its cooldown boundary", () => {
    const dashBase = {
        ...base,
        x: 200,
        abilities: [19],
        abilityCooldowns: { 19: 0 },
        abilityCharges: { 19: 1 },
        abilityActiveMs: {},
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 19, targetX: 400, targetY: 100 } };
    const first = applyBotAction(dashBase, action, 100, applyDamageToShape);
    assert.equal(first.x, 275);
    assert.equal(first.abilityCharges[19], 0);
    assert.equal(first.abilityCooldowns[19], 1500);

    const blocked = applyBotAction({ ...first, microDashActiveMs: 0, microDashRemaining: 0 }, action, 100, applyDamageToShape);
    assert.equal(blocked.triggeredAbility, null);
    assert.equal(blocked.abilityCharges[19], 0);

    const reloaded = tickBotStatus({ ...first, microDashActiveMs: 0, microDashRemaining: 0 }, 1500, applyDamageToShape);
    assert.equal(reloaded.abilityCharges[19], 1);
});

test("Lock On prepares for two ticks before facing its target and respects its 10 second cooldown", () => {
    const lockBase = {
        ...base,
        x: 200,
        y: 200,
        rotation: 90,
        abilities: [20],
        abilityCooldowns: { 20: 0 },
        abilityCharges: {},
        abilityActiveMs: {},
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 20, targetX: 400, targetY: 200 } };
    const first = applyBotAction(lockBase, action, 100, applyDamageToShape);
    assert.equal(first.x, lockBase.x);
    assert.equal(first.y, lockBase.y);
    assert.equal(first.rotation, 90);
    assert.equal(first.hp, lockBase.hp);
    assert.equal(first.preparingAbility, 20);
    assert.equal(first.preparingMs, 100);
    assert.equal(first.abilityCooldowns[20], 0);

    const activated = applyBotAction(first, action, 100, applyDamageToShape);
    assert.equal(activated.x, lockBase.x);
    assert.equal(activated.y, lockBase.y);
    assert.equal(activated.rotation, 90);
    assert.equal(activated.hp, lockBase.hp);
    assert.equal(activated.preparingAbility, null);
    assert.equal(activated.abilityCooldowns[20], 10_000);
    assert.equal(activated.abilityActiveMs[20], 200);

    const ready = tickBotStatus(activated, 10_000, applyDamageToShape);
    assert.equal(ready.abilityCooldowns[20], 0);
    const second = applyBotAction(ready, action, 100, applyDamageToShape);
    assert.equal(second.rotation, 90);
    assert.equal(second.preparingAbility, 20);
    assert.equal(second.abilityCooldowns[20], 0);
});

test("entity damage and hostile DOT use the same HP-loss stagger settlement", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, hp: 100, maxHp: 100 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, maxHp: 100 };
    const fireball = { id: "fireball", type: "fireball", ownerId: "owner", ownerSlot: 1, x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const projectile = tickProjectileWorld({ bots: [owner, target], grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, { applyDamageToShape, applyDamageFromShapes });
    assert.equal(projectile.bots[1].hitStaggerMs, 300);

    const slashAttacker = { id: "slash-owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const [, bleeding] = resolveAbilityCombat(slashAttacker, { id: "bleeding", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 });
    const bleedTick = tickBotStatus(bleeding, 1000, applyDamageToShape);
    assert.equal(bleedTick.hp, 68);
    assert.equal(bleedTick.hitStaggerMs, 300);
});

test("Concussive Shot remains independent and wins the combined movement multiplier", () => {
    assert.equal(CONCUSSIVE_SHOT_SLOW_DURATION_MS, 2000);
    assert.equal(CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER, 0.60);
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 9 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, target);
    assert.equal(hit.hp, 92);
    assert.equal(hit.slowedMs, 2000);
    assert.equal(hit.hitStaggerMs, 300);

    const moved = applyBotAction({ ...hit, x: 200, moveSpeed: 10, movementVelocityX: 10 }, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(moved.x, 206);
    assert.equal(moved.slowedMs, 1900);
    assert.equal(moved.hitStaggerMs, 200);
    const ordinaryHit = applyDamageToShape({ ...moved, hp: 80, slowedMs: 2000 }, 1, attacker);
    assert.equal(ordinaryHit.slowedMs, 2000);
});

test("damage to an arena entity does not stagger either bot", () => {
    const bots = [
        { id: "owner", slot: 1, x: 100, y: 100, size: 60, hp: 100, maxHp: 100, triggeredAbility: 1 },
        { id: "target", slot: 2, x: 100, y: 100, size: 60, hp: 100, maxHp: 100 },
    ];
    const result = tickAbilityEntityWorld({
        entities: [hunterDroneEntity(bots[0])], bots, grenades: [], fireballs: [],
        stepMs: 100, width: 1000, height: 800,
    }, {
        applyDamageToShape,
        applyDamageFromShapes,
        abilityHitsTarget: () => true,
        triggeredAbilityDamage: () => 50,
        grenadeDamageToBot: () => 0,
        overlapsShape: () => false,
    });
    assert.equal(result.entities.length, 0);
    assert.equal(result.bots[0].hitStaggerMs ?? 0, 0);
    assert.equal(result.bots[1].hitStaggerMs ?? 0, 0);
});

test("a blocked heavy slash removes every shield charge without applying damage or bleed", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, blockCharges: 5, abilities: [2] };
    const [, blocked] = resolveAbilityCombat(attacker, defender);
    assert.equal(blocked.hp, 100);
    assert.equal(blocked.blockCharges, 0);
    assert.equal(blocked.bleedRemainingMs ?? 0, 0);
});

test("blocked concussive and rail shots do not apply their attached effects", () => {
    for (const ability of [9, 13]) {
        const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, blockCharges: 5, abilities: [2] };
        const [, blocked] = resolveAbilityCombat(attacker, defender);
        assert.equal(blocked.hp, 100, ability);
        assert.equal(blocked.slowedMs ?? 0, 0, ability);
        assert.equal(blocked.shockRemainingMs ?? 0, 0, ability);
        assert.equal(blocked.blockCharges, 4, ability);
    }
});

test("repulsor burst deals 20 damage and pushes 250 units, while blocking prevents only damage", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 8 };
    const defender = { id: "target", x: 180, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 80);
    assert.equal(hit.x, 430);

    const [, blocked] = resolveAbilityCombat(attacker, { ...defender, abilityActiveMs: { ...(defender.abilityActiveMs ?? {}), 2: 1 }, blockCharges: 5, abilities: [2] });
    assert.equal(blocked.hp, 100);
    assert.equal(blocked.x, 430);
    assert.equal(blocked.blockCharges, 4);
});

test("wind burst is a five-tick projectile with 15 damage and 90 knockback", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1 };
    const projectile = windburstProjectileEntity(attacker);
    assert.equal(projectile.type, "windburstProjectile");
    assert.equal(ABILITY_STATS[18].knockback, 90);
    assert.equal(ABILITY_CONTRACTS[18].effects.find((effect) => effect.type === EFFECT_TYPES.KNOCKBACK).distance, 90);
    assert.equal(projectile.velocityX, 44);
    assert.equal(projectile.velocityY, 0);
    assert.equal(projectile.size, 24);

    let world = { entities: [projectile], bots: [attacker], stepMs: 100, width: 1000, height: 800 };
    for (let tick = 0; tick < 4; tick += 1) {
        const result = tickAbilityEntityWorld(world, noDamageCombat);
        assert.equal(result.entities[0].traveled, (tick + 1) * 44);
        world = { ...world, entities: result.entities, bots: result.bots };
    }
    assert.equal(tickAbilityEntityWorld(world, noDamageCombat).entities.length, 0);

    const target = { id: "target", slot: 2, x: 210, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const hit = tickAbilityEntityWorld({ entities: [projectile], bots: [attacker, target], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(hit.bots[1].hp, 85);
    assert.equal(hit.bots[1].x, 300);
    assert.equal(hit.entities.length, 0);
});

test("absolute guard rejects damage, statuses, and displacement without draining block", () => {
    const guarded = {
        id: "target", slot: 2, x: 180, y: 100, size: 60, rotation: 180,
        hp: 100, maxHp: 100, abilityActiveMs: { 2: 1, 23: 1000 }, blockCharges: 5,
    };
    assert.equal(applyDamageToShape(guarded, 50), guarded);

    for (const ability of [7, 13, 9, 8, 18]) {
        const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const [, result] = resolveAbilityCombat(attacker, guarded);
        assert.equal(result.hp, 100, ability);
        assert.equal(result.x, 180, ability);
        assert.equal(result.blockCharges, 5, ability);
        assert.equal(result.bleedRemainingMs ?? 0, 0, ability);
        assert.equal(result.shockRemainingMs ?? 0, 0, ability);
        assert.equal(result.slowedMs ?? 0, 0, ability);
    }
});

test("absolute guard rejects persistent entity fields, pulses, mines, and strikes", () => {
    const guarded = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, abilityActiveMs: { 23: 1000 } };
    const arena = { bots: [guarded], grenades: [], fireballs: [], stepMs: 100, width: 1000, height: 1000 };

    const silence = silenceWaveEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 });
    const silenced = tickAbilityEntityWorld({ ...arena, entities: [silence] }, noDamageCombat).bots[0];
    assert.equal(silenced.silencedMs ?? 0, 0);
    assert.equal(silenced.stunnedMs ?? 0, 0);

    const gravity = { ...thrownFieldEntity("gravityField", { id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), x: 100, y: 100, traveled: 176, fuseMs: 1000 };
    const pulled = tickAbilityEntityWorld({ ...arena, entities: [gravity] }, noDamageCombat).bots[0];
    assert.equal(pulled.x, 150);
    assert.equal(pulled.y, 100);

    const zone = nullZoneEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 150, 100, (value) => value);
    const zoned = tickAbilityEntityWorld({ ...arena, entities: [zone] }, noDamageCombat).bots[0];
    assert.equal(zoned.nullZoneSilenced, false);

    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true };
    const orbital = { ...orbitalMarkerEntity({ id: "owner", slot: 1 }, 150, 100, (value) => value), fuseMs: 100 };
    const struck = tickAbilityEntityWorld({ ...arena, entities: [mine, orbital] }, noDamageCombat).bots[0];
    assert.equal(struck.hp, 100);
});

test("releasing shield starts a two-second activation cooldown without changing charges", () => {
    const bot = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, abilities: [2], blockCharges: 5, blockCooldownMs: 0 };
    const held = applyBotAction(bot, { abilityAction: { action: 2 } }, 100, noDamageCombat.applyDamageToShape);
    const released = applyBotAction(held, {}, 100, noDamageCombat.applyDamageToShape);
    const rejected = applyBotAction(released, { abilityAction: { action: 2 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(held.abilityActiveMs[2], 1);
    assert.equal(released.blockCooldownMs, 2000);
    assert.equal(released.blockCharges, 5);
    assert.equal(rejected.abilityActiveMs[2] ?? 0, 0);
});

test("each shield charge takes five seconds to recharge", () => {
    const bot = { hp: 100, maxHp: 100, abilities: [2], blockCharges: 0, blockRechargeMs: 0 };
    const almost = tickBotStatus(bot, 4999, noDamageCombat.applyDamageToShape);
    assert.equal(almost.blockCharges, 0);
    const recharged = tickBotStatus(almost, 1, noDamageCombat.applyDamageToShape);
    assert.equal(recharged.blockCharges, 1);
    assert.equal(recharged.blockRechargeMs, 0);
});

test("null zone silence is presence-based while silence pulse remains timed", () => {
    const zone = nullZoneEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 300, 300, (value) => value);
    const inside = { id: "target", slot: 2, x: 300, y: 300, size: 60, hp: 100, silencedMs: 0 };
    const inZone = tickAbilityEntityWorld({ entities: [zone], bots: [inside], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(inZone.bots[0].nullZoneSilenced, true);
    assert.equal(inZone.bots[0].silencedMs, 0);

    const movedOut = { ...inZone.bots[0], x: 800, y: 700 };
    const outOfZone = tickAbilityEntityWorld({ entities: inZone.entities, bots: [movedOut], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(outOfZone.bots[0].nullZoneSilenced, false);
    assert.equal(outOfZone.bots[0].silencedMs, 0);
});

test("combat visual timing preserves centered pulses, sword sweeps, and pistol fade", () => {
    assert.equal(sweepAngle(400, 400, -60, 60), -60);
    assert.ok(Math.abs(sweepAngle(300, 400, -60, 60) - (-20)) < 0.0001);
    assert.ok(Math.abs(sweepAngle(200, 400, -60, 60) - 20) < 0.0001);
    assert.equal(sweepAngle(100, 400, -60, 60), 60);
    const heavyHalfArc = Number(ABILITY_STATS[7].arcDegrees) / 2;
    assert.equal(sweepAngle(400, 400, -heavyHalfArc, heavyHalfArc), -75);
    assert.equal(sweepAngle(100, 400, -heavyHalfArc, heavyHalfArc), 75);
    assert.equal(abilityVisualOpacity({ abilityVisual: { ability: 12, ms: 150 } }, 12), 0.5);
    assert.equal(abilityVisualOpacity({ abilityActiveMs: { 12: 150 } }, 12), 0.5);
    assert.equal(combatVisualRemainingMs({ abilityActiveMs: { 7: 250 } }, 7), 250);
    assert.equal(abilityVisualOpacity({ abilityVisual: null }, undefined), 0);
});

test("repulsor burst presentation advances all ten frames over 500 ms without exceeding its hitbox", () => {
    assert.equal(REPULSOR_BURST_VISUAL_MS, 500);
    assert.equal(REPULSOR_BURST_FRAME_COUNT, 10);
    assert.equal(REPULSOR_BURST_FRAME_MS, 50);
    assert.equal(repulsorBurstProgress(0), 0);
    assert.equal(repulsorBurstProgress(REPULSOR_BURST_VISUAL_MS), 1);
    assert.equal(repulsorBurstFrameIndex(0), 0);
    assert.equal(repulsorBurstFrameIndex(0.999), 9);
    assert.equal(repulsorBurstFrameIndex(1), 9);
    assert.deepEqual(
        Array.from({ length: REPULSOR_BURST_FRAME_COUNT }, (_, index) => repulsorBurstFrameIndex(repulsorBurstProgress(index * REPULSOR_BURST_FRAME_MS))),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );

    const frames = Array.from({ length: 101 }, (_, index) => repulsorBurstFrameIndex(index / 100));
    assert.ok(frames.every((frame) => frame >= 0 && frame <= 9));
    assert.ok(frames.every((frame, index) => index === 0 || frame >= frames[index - 1]));

    const diameters = Array.from({ length: 101 }, (_, index) => repulsorBurstDiameter(index / 100));
    assert.equal(Math.max(...diameters), REPULSOR_BURST_MAX_DIAMETER);
    assert.equal(ABILITY_STATS[8].radius, 110);
    assert.equal(repulsorBurstDiameter(0.3, ABILITY_STATS[8].radius * 2), REPULSOR_BURST_MAX_DIAMETER);
    assert.ok(repulsorBurstDiameter(0) < REPULSOR_BURST_MAX_DIAMETER);
});

test("Basic Heal particle specs are deterministic, staggered, and upward", () => {
    const specs = Array.from({ length: BASIC_HEAL_PARTICLE_COUNT }, (_, index) => basicHealParticleSpec(index));
    assert.equal(BASIC_HEAL_PARTICLE_LIFETIME_MS, 1000);
    assert.deepEqual(specs, Array.from({ length: BASIC_HEAL_PARTICLE_COUNT }, (_, index) => basicHealParticleSpec(index)));
    assert.ok(specs.every((spec) => spec.vy < 0 && spec.fontSize >= 10 && spec.fontSize <= 14));
    assert.ok(specs.every((spec) => spec.lifetimeMs >= 900 && spec.lifetimeMs <= 1100));
    assert.ok(new Set(specs.map((spec) => `${spec.offsetX}:${spec.offsetY}:${spec.vx}`)).size > 1);
});

test("Basic Heal applies 15 self-healing and respects the HP cap", () => {
    const attacker = {
        id: "main", x: 100, y: 100, rotation: 0, hp: 90, maxHp: 100,
        triggeredAbility: 10,
    };
    const opponentShape = { id: "opponent", x: 900, y: 900, rotation: 180, hp: 100, maxHp: 100, size: 60 };
    const [activated, opponent] = resolveAbilityCombat(attacker, opponentShape);

    assert.deepEqual(opponent, opponentShape);
    assert.equal(activated.abilityVisual.ability, 10);
    assert.equal(activated.pendingHealing, 15);
    assert.equal(settlePendingHealing(activated).hp, 100);
    assert.equal(ABILITY_STATS[10].cooldownMs, 12000);
    assert.equal(ABILITY_STATS[10].windupMs, 800);
});

test("ability animations keep their full starting frame without an opponent", () => {
    for (const ability of [7, 12, 8, 10]) {
        const attacker = { id: "main", x: 100, y: 100, rotation: 0, triggeredAbility: ability };
        const [animated, opponent] = resolveAbilityCombat(attacker, null);
        assert.equal(opponent, null, ability);
        assert.equal(animated.abilityVisual.ability, ability);
        const expectedMs = ability === 7 ? 400 : ability === 8 ? 500 : 300;
        assert.equal(animated.abilityVisual.ms, expectedMs, ability);
    }
    const [slash] = resolveAbilityCombat({ id: "main", x: 100, y: 100, rotation: 0, triggeredAbility: 7 }, null);
    const heavyHalfArc = Number(ABILITY_STATS[7].arcDegrees) / 2;
    assert.equal(sweepAngle(slash.abilityVisual.ms, 400, -heavyHalfArc, heavyHalfArc), -75);
});

test("sword swing keeps its full visual timer through the activation step", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [1], swingCooldownMs: 0, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 1 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.abilityActiveMs[1], 400);
    assert.equal(sweepAngle(active.abilityActiveMs[1], 400, -60, 60), -60);
    assert.equal(active.triggeredAbility, 1);
});

test("sword swing hit resolves only on its activation tick while its animation continues", () => {
    const defender = { x: 190, y: 100, size: 20 };
    assert.equal(abilityHitsTarget({ x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] }, defender), true);
    assert.equal(abilityHitsTarget({ x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: null, abilities: [1] }, defender), false);
});

test("sword swing hitbox matches the inclusive 120-degree, 92-unit sweep", () => {
    const attacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] };
    for (const offset of [-60, 60]) assert.equal(abilityHitsTarget(attacker, targetAtBearing(attacker, 80, attacker.rotation + offset)), true, `at ${offset} degrees`);
    for (const offset of [-60.1, 60.1]) assert.equal(abilityHitsTarget(attacker, targetAtBearing(attacker, 80, attacker.rotation + offset)), false, `outside ${offset} degrees`);
});

test("heavy slash hitbox matches the inclusive 150-degree, 115-unit sweep", () => {
    assert.equal(ABILITY_STATS[1].range, 92);
    assert.equal(ABILITY_STATS[7].range, 115);
    const attacker = { id: "owner", x: 100, y: 100, rotation: 90, size: 60, hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    for (const offset of [-75, 75]) {
        const target = { id: `target-${offset}`, ...targetAtBearing(attacker, 80, attacker.rotation + offset), hp: 100, maxHp: 100 };
        assert.ok(resolveAbilityCombat(attacker, target)[1].hp < 100, `at ${offset} degrees`);
    }
    for (const offset of [-75.1, 75.1]) {
        const target = { id: `target-${offset}`, ...targetAtBearing(attacker, 80, attacker.rotation + offset), hp: 100, maxHp: 100 };
        assert.equal(resolveAbilityCombat(attacker, target)[1].hp, 100, `outside ${offset} degrees`);
    }
});

test("every browser melee hitbox reaches the defender's edge at max range", () => {
    const defenderSize = 60;
    const defenderRadius = defenderSize / 2;
    const swingAttacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] };
    assert.equal(abilityHitsTarget(swingAttacker, { x: 100 + 92 + defenderRadius, y: 100, size: defenderSize }), true);
    assert.equal(abilityHitsTarget(swingAttacker, { x: 100 + 92 + defenderRadius + 1, y: 100, size: defenderSize }), false);

    for (const ability of [7]) {
        const range = Number(ABILITY_STATS[ability].range);
        const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const atEdge = { id: "target", x: 100 + range + defenderRadius, y: 100, size: defenderSize, rotation: 270, hp: 100, maxHp: 100 };
        const beyondEdge = { ...atEdge, x: atEdge.x + 1 };
        assert.ok(resolveAbilityCombat(attacker, atEdge)[1].hp < 100, ability);
        assert.equal(resolveAbilityCombat(attacker, beyondEdge)[1].hp, 100, ability);
    }

    assert.equal(ABILITY_STATS[18].range, 220);

    const phaseAttacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 25 };
    const phaseAtRange = { id: "target", x: 200, y: 100, size: defenderSize, rotation: 270, hp: 100, maxHp: 100 };
    assert.ok(resolveAbilityCombat(phaseAttacker, phaseAtRange)[1].hp < 100);
    assert.equal(resolveAbilityCombat(phaseAttacker, { ...phaseAtRange, x: 201 })[1].hp, 100);
    assert.equal(resolveAbilityCombat(phaseAttacker, { ...phaseAtRange, x: 100, y: 200 })[1].hp, 100);

    const stunAttacker = { x: 100, y: 100, rotation: 90, triggeredAbility: 6, abilities: [6] };
    assert.equal(abilityHitsTarget(stunAttacker, { x: 100 + 184 + defenderRadius, y: 100, size: defenderSize }), true);
    assert.equal(abilityHitsTarget(stunAttacker, { x: 100 + 184 + defenderRadius + 1, y: 100, size: defenderSize }), false);
});

test("a prepared ability cannot be replaced by another ready ability", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [9, 12],
        abilityCooldowns: { 9: 0, 12: 0 }, abilityActiveMs: {},
    };
    const preparing = applyBotAction(bot, { abilityAction: { action: 9 } }, 100, noDamageCombat.applyDamageToShape);
    const stillPreparing = applyBotAction(preparing, { abilityAction: { action: 12 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(stillPreparing.preparingAbility, 9);
    assert.equal(stillPreparing.preparingMs, 200);
    assert.equal(stillPreparing.abilityCooldowns[12], 0);
});

test("ability preparation does not interrupt movement or rotation", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [9],
        abilityCooldowns: { 9: 0 }, abilityActiveMs: {},
    };
    const action = { dx: 1, dy: 0, dRot: 1, abilityAction: { action: 9 } };

    const first = applyBotAction(bot, action, 100, noDamageCombat.applyDamageToShape);
    assert.equal(first.x, 104);
    assert.equal(first.rotation, 12);
    assert.equal(first.preparingAbility, 9);

    const second = applyBotAction(first, action, 100, noDamageCombat.applyDamageToShape);
    assert.equal(second.x, 112);
    assert.equal(second.rotation, 24);
    assert.equal(second.preparingAbility, 9);
    assert.equal(second.preparingMs, 200);
});

test("special activation keeps the full authoritative active and cooldown timers", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [12],
        abilityCooldowns: { 12: 0 }, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 12 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.abilityActiveMs[12], 300);
    assert.equal(active.abilityCooldowns[12], 700);
});

test("repulsor burst browser activation keeps its 500 ms presentation timer", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [8],
        abilityCooldowns: { 8: 0 }, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 8 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.abilityActiveMs[8], 500);
});

test("a correctly facing shield blocks Phase Strike teleport and damage", () => {
    const attacker = {
        id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 25,
    };
    const defender = {
        id: "target", slot: 2, x: 200, y: 100, size: 60, rotation: 180,
        hp: 100, maxHp: 100, abilityActiveMs: { 2: 100 }, blockCharges: 5, abilities: [2],
    };
    const [nextAttacker, blocked] = resolveAbilityCombat(attacker, defender);
    assert.equal(nextAttacker.x, attacker.x);
    assert.equal(nextAttacker.y, attacker.y);
    assert.equal(blocked.hp, 100);
    assert.equal(blocked.blockCharges, 4);
});

test("temporal rewind creates a passive targetable clock zone", () => {
    const bot = {
        id: "main", slot: 1, x: 240, y: 360, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [21],
        abilityCooldowns: { temporal_rewind: 0 }, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 21 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.abilitySpawn.type, "temporalRewindZone");
    assert.equal(active.abilitySpawn.x, 240);
    assert.equal(active.abilitySpawn.y, 360);
});

test("health bar fill is the clamped fraction of current hp", () => {
    assert.equal(healthBarPercent(75, 100), 75);
    assert.equal(healthBarPercent(30, 120), 25);
    assert.equal(healthBarPercent(-5, 100), 0);
    assert.equal(healthBarPercent(150, 100), 100);
});

test("fire gun activation retains a fading ray for the active duration", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [3], gunAmmo: 10,
        gunCooldownMs: 0, gunReloadMs: 0, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 3 } }, 50, noDamageCombat.applyDamageToShape);
    assert.equal(active.triggeredAbility, 3);
    assert.equal(active.abilityActiveMs[3], 1000);
    assert.equal(abilityActiveOpacity(active, 3), 1);
    const faded = tickBotStatus(active, 450, noDamageCombat.applyDamageToShape);
    assert.equal(abilityActiveOpacity(faded, 3), 0.55);
});

test("a dead bot clears one-tick attacks while their visuals finish", () => {
    const dead = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 0, maxHp: 100, abilities: [3, 13],
        abilityActiveMs: { 3: 900, 1: 300, 6: 250 },
        triggeredAbility: 13,
        abilitySpawn: { id: "already-spawned" },
        preparingAbility: 9,
        preparingMs: 250,
    };

    const next = applyBotAction(dead, { abilityAction: { action: 3 } }, 50, noDamageCombat.applyDamageToShape);

    assert.equal(next.triggeredAbility, null);
    assert.equal(next.abilitySpawn, null);
    assert.equal(next.preparingAbility, 9);
    assert.equal(next.preparingMs, 250);
    assert.equal(next.abilityActiveMs[3], 850);
    assert.ok(abilityActiveOpacity(next, 3) > 0);
});

test("a ray from a bot killed after firing cannot damage again", () => {
    const attacker = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 0, maxHp: 100, abilities: [3], triggeredAbility: 3,
        abilityActiveMs: { 3: 900 }, attackDamageMultiplier: 1,
    };
    const defender = { id: "opponent-model", slot: 2, x: 200, y: 100, size: 60, hp: 100, maxHp: 100 };

    const cleared = applyBotAction(attacker, {}, 50, noDamageCombat.applyDamageToShape);
    const [, afterCombat] = resolveAbilityCombat(cleared, defender);

    assert.equal(afterCombat.hp, 100);
});

test("death removes every active bot status while preserving preparation and cooldowns", () => {
    const bot = {
        id: "target", hp: 5, maxHp: 100,
        slowedMs: 1000, silencedMs: 1000, nullZoneSilenced: true, stunnedMs: 1000,
        movementLockMs: 300, shockRemainingMs: 3000, shockTickElapsedMs: 250,
        burnRemainingMs: 3000, burnTickMs: 500, bleedRemainingMs: 4000, bleedTickMs: 750,
        abilityActiveMs: { 2: 1, 16: 2000 },
        quickJabComboCount: 4, quickJabComboMs: 800,
        temporalRewindMs: 2000, temporalRewindPulseMs: 300,
        pendingHealing: 20, preparingAbility: 13, preparingMs: 450,
        abilityCooldowns: { rail_shot: 5000 },
    };

    const dead = applyDamageToShape(bot, 10);

    assert.equal(dead.hp, 0);
    assert.deepEqual(botStatusLabels(dead), []);
    assert.deepEqual(dead.abilityActiveMs, {});
    assert.equal(dead.nullZoneSilenced, false);
    assert.equal(dead.shockRemainingMs, 0);
    assert.equal(dead.burnRemainingMs, 0);
    assert.equal(dead.bleedRemainingMs, 0);
    assert.equal(dead.temporalRewindMs, 0);
    assert.equal(dead.pendingHealing, 0);
    assert.equal(dead.preparingAbility, 13);
    assert.equal(dead.preparingMs, 450);
    assert.equal(dead.abilityCooldowns.rail_shot, 5000);
});

test("an ALWAYS code action reaches the real fire-gun executor", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [{ createdOrder: 0, branches: [{ id: "always-fire", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: 3 }], children: [] }] }],
    };
    const snapshot = {
        playerModel: { id: "main", x: 100, y: 100, rotation: 0, gunAvailable: true },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 500, y: 100, size: 60, hp: 100 }],
    };
    const action = buildDeterministicLogicAction(configuration, snapshot);
    const bot = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [3], gunAmmo: 10, gunCooldownMs: 0, abilityActiveMs: {}, gunReloadMs: 0 };
    const result = applyBotAction(bot, action, 50, noDamageCombat.applyDamageToShape);
    assert.deepEqual(action.abilityAction, { action: 3, targetX: undefined, targetY: undefined });
    assert.equal(action.gun, undefined);
    assert.equal(result.triggeredAbility, 3);
    assert.equal(result.gunAmmo, 9);
});

test("fireball and concussive shot hand off the shared ability head in either priority order", () => {
    const configuration = (first, second) => ({
        version: "bot-logic-tree-v1",
        roots: [{ createdOrder: 0, branches: [
            { id: first, branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: first }] },
            { id: second, branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], actions: [{ action: second }] },
        ] }],
    });
    const opponent = { id: "opponent-model", slot: 2, x: 600, y: 100, size: 60, hp: 100, abilities: [] };
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100,
        moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
        abilities: [5, 9], fireballCharges: 4,
        fireballCooldownMs: 0, fireballReloadMs: 0,
        abilityCooldowns: { 9: 0 },
    };

    const fireballFirstAction = buildDeterministicLogicAction(configuration(5, 9), buildStatePayload([bot, opponent], "custom"));
    const afterFireball = applyBotAction(bot, fireballFirstAction, 50, noDamageCombat.applyDamageToShape);
    const concussiveNextAction = buildDeterministicLogicAction(configuration(5, 9), buildStatePayload([afterFireball, opponent], "custom"));
    const preparingAfterFireball = applyBotAction(afterFireball, concussiveNextAction, 50, noDamageCombat.applyDamageToShape);
    assert.equal(fireballFirstAction.abilityAction.action, 5);
    assert.equal(concussiveNextAction.abilityAction.action, 9);
    assert.equal(preparingAfterFireball.preparingAbility, 9);

    let afterConcussive = bot;
    for (let tick = 0; tick < 10; tick += 1) {
        const action = buildDeterministicLogicAction(configuration(9, 5), buildStatePayload([afterConcussive, opponent], "custom"));
        afterConcussive = applyBotAction(afterConcussive, action, 50, noDamageCombat.applyDamageToShape);
    }
    const fireballAfterConcussive = buildDeterministicLogicAction(configuration(9, 5), buildStatePayload([afterConcussive, opponent], "custom"));
    assert.equal(afterConcussive.preparingAbility, null);
    assert.ok(afterConcussive.abilityCooldowns[9] > 0);
    assert.equal(fireballAfterConcussive.abilityAction.action, 5);
});

test("projectile system returns net bot damage and removes a colliding fireball", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100 },
    ];
    const fireball = { id: "fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickProjectileWorld({ bots, grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(result.fireballs.length, 0);
    assert.equal(result.bots[1].hp, 85);
    assert.equal(result.bots[1].burnRemainingMs > 0, true);
});

test("grenade damage uses the next falloff band at an exact boundary", () => {
    const explosion = { x: 0, y: 0, damageMultiplier: 1 };
    assert.equal(grenadeDamageToEntity(explosion, { x: 7, y: 0 }), 50);
    assert.equal(grenadeDamageToEntity(explosion, { x: 8, y: 0 }), 45);
    assert.equal(grenadeDamageToEntity(explosion, { x: 22, y: 0 }), 40);
});

test("projectiles pass through dead bots without applying damage or status", () => {
    let world = {
        bots: [
            { id: "owner", x: 50, y: 100, size: 60, hp: 100 },
            { id: "dead", x: 150, y: 100, size: 60, hp: 0 },
            { id: "living", x: 260, y: 100, size: 60, hp: 100 },
        ],
        grenades: [],
        fireballs: [{ id: "passing-fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 }],
        stepMs: 50,
        width: 1000,
        height: 800,
    };

    world = { ...world, ...tickProjectileWorld(world, noDamageCombat) };
    assert.equal(world.fireballs.length, 1);
    assert.equal(world.bots[1].burnRemainingMs ?? 0, 0);

    for (let tick = 0; tick < 25 && world.fireballs.length > 0; tick += 1) {
        world = { ...world, ...tickProjectileWorld(world, noDamageCombat) };
    }
    assert.equal(world.bots[1].hp, 0);
    assert.equal(world.bots[1].burnRemainingMs ?? 0, 0);
    assert.equal(world.bots[2].hp, 85);
});

test("shield blocks fireball damage and burn together", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, rotation: 180, hp: 100, abilityActiveMs: { 2: 1 }, blockCharges: 5 },
    ];
    const fireball = { id: "blocked-fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickProjectileWorld({ bots, grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(result.bots[1].hp, 100);
    assert.equal(result.bots[1].burnRemainingMs ?? 0, 0);
    assert.equal(result.bots[1].blockCharges, 4);
});

test("mine, gravity, silence, drone, and orbital effects use their shield rules", () => {
    const shield = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, blockCharges: 5, abilities: [2] };
    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true, hitTriggered: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], bots: [shield], grenades: [], fireballs: [], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(mineResult.bots[0].hp, 100);
    assert.equal(mineResult.bots[0].blockCharges, 0);

    const gravity = { ...thrownFieldEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, "gravityField", 14, 240, 2000), traveled: 176, x: 100, y: 100, fuseMs: 100, remainingMs: 2000 };
    const gravityResult = tickAbilityEntityWorld({ entities: [gravity], bots: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(gravityResult.bots[0].hp, 100);
    assert.equal(gravityResult.bots[0].blockCharges, 0);

    const silence = silenceWaveEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 });
    const silenceResult = tickAbilityEntityWorld({ entities: [silence], bots: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(silenceResult.bots[0].silencedMs ?? 0, 0);
    assert.equal(silenceResult.bots[0].blockCharges, 4);

    const drone = { ...hunterDroneEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }), shotCooldownMs: 0 };
    const droneResult = tickAbilityEntityWorld({ entities: [drone], bots: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(droneResult.bots[0].hp, 100);
    assert.equal(droneResult.bots[0].blockCharges, 4);

    const orbital = { ...orbitalMarkerEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 150, 100, (value) => value), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], bots: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.ok(orbitalResult.bots[0].hp < 100);
    assert.equal(orbitalResult.bots[0].blockCharges, 0);
});

test("radial effects use bot-center distance instead of outer-edge overlap", () => {
    const outside = { id: "target", slot: 2, x: 240, y: 100, size: 60, hp: 100, maxHp: 100 };
    const orbital = { ...orbitalMarkerEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 100, 100, (value) => value), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], bots: [outside], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(orbitalResult.bots[0].hp, 100);

    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], bots: [outside], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(mineResult.bots[0].hp, 100);

    assert.equal(grenadeDamageToEntity({ x: 100, y: 100, damageMultiplier: 1 }, outside), 0);
});

test("another fireball refreshes burn duration without resetting its pending damage tick", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100, burnRemainingMs: 4000, burnTickMs: 300, burnDamageMultiplier: 1 },
    ];
    const fireball = { id: "refresh", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const hit = tickProjectileWorld({ bots, grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(hit.bots[1].burnRemainingMs, 5000);
    assert.equal(hit.bots[1].burnTickMs, 300);

    const ticked = tickBotStatus(hit.bots[1], 300, noDamageCombat.applyDamageToShape);
    assert.equal(ticked.hp, 83);
});
