import assert from "node:assert/strict";
import test from "node:test";
import { hunterDroneEntity, nullZoneEntity, orbitalMarkerEntity, proximityMineEntity, silenceWaveEntity, thrownFieldEntity } from "./EntityFactory.js";
import { tickAbilityEntityWorld } from "./AbilityEntitySystem.js";
import { tickFighterStatus } from "./FighterStatusSystem.js";
import { applyFighterAction } from "./ActionExecutionSystem.js";
import { tickProjectileWorld } from "./ProjectileSystem.js";
import { combatVisualRemainingMs, gunRayOpacity, healthBarPercent, prototypeVisualOpacity, swordSweepAngle } from "../combat/visualState.js";
import { applyDamageToShape, isSwingHitting, resolveBasicCombat, resolvePrototypeCombat, settlePendingHealing } from "../combat/FighterCombatSystem.js";
import { buildDeterministicLogicAction } from "../../logic/ArenaActionPlanner.js";
import { buildStatePayload } from "../modelPayloads/strategyStatePayload.js";
import { abilityDefinition, shouldInterpolateAbilityVisual } from "../loadout/BotLoadout.js";
import { ABILITY_CONTRACTS, DELIVERY_TYPES, EFFECT_TYPES, SHIELD_CHARGE_COSTS, SHIELD_MODES } from "../combat/AbilityContracts.js";
import { resolveShieldInteraction } from "../combat/ShieldSystem.js";
import { fighterStatusLabels } from "../pixi/pixiVisualState.js";
import { resetFighterShape } from "../modelPayloads/arenaShapes.js";

const noDamageCombat = {
    applyDamageToShape: (fighter, damage) => ({ ...fighter, hp: Math.max(0, fighter.hp - damage) }),
    applyDamageFromShapes: (owner, target, damage) => [owner, { ...target, hp: target.hp - damage }],
    isSwingHitting: () => false,
    incomingMeleeDamage: () => 0,
    incomingGunDamage: () => 0,
    attackerDamageMultiplier: () => 1,
    stunHits: () => false,
    grenadeDamageToFighter: () => 0,
    overlapsShape: () => false,
};

test("resetting fighter stats clears every transient status effect", () => {
    const reset = resetFighterShape({
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
    for (const id of ["swing", "fire_gun", "pistol_shot", "rail_shot", "concussive_shot"]) {
        assert.equal(shouldInterpolateAbilityVisual(id), false, id);
        assert.ok(abilityDefinition(id).tags.includes("instant-visual"), id);
    }
    for (const id of ["dash", "throw_grenade", "shoot_fireball", "micro_dash"]) {
        assert.equal(shouldInterpolateAbilityVisual(id), true, id);
        assert.ok(abilityDefinition(id).tags.includes("interpolated-visual"), id);
    }
});

test("every selectable ability exposes delivery, effects, and a shield policy", () => {
    for (const id of Object.keys(ABILITY_CONTRACTS)) {
        const definition = abilityDefinition(id);
        assert.ok(definition, id);
        assert.ok(Object.values(DELIVERY_TYPES).includes(definition.delivery.type), id);
        assert.ok(Array.isArray(definition.effects), id);
        assert.ok(Object.values(SHIELD_MODES).includes(definition.shieldInteraction.mode), id);
    }
});

test("shield contracts describe partial and full effect blocking", () => {
    assert.deepEqual(new Set(ABILITY_CONTRACTS.repulsor_burst.shieldInteraction.prevents), new Set([EFFECT_TYPES.DAMAGE]));
    assert.ok(!ABILITY_CONTRACTS.repulsor_burst.shieldInteraction.prevents.includes(EFFECT_TYPES.KNOCKBACK));
    assert.deepEqual(new Set(ABILITY_CONTRACTS.gravity_grenade.shieldInteraction.prevents), new Set([EFFECT_TYPES.DAMAGE]));
    assert.ok(!ABILITY_CONTRACTS.gravity_grenade.shieldInteraction.prevents.includes(EFFECT_TYPES.PULL));
    assert.equal(ABILITY_CONTRACTS.heavy_slash.shieldInteraction.chargeCost, SHIELD_CHARGE_COSTS.ALL);
    assert.equal(ABILITY_CONTRACTS.orbital_strike.shieldInteraction.mode, SHIELD_MODES.DRAIN_WHILE_ACTIVE);
});

test("declarative shield resolution filters effects and consumes configured charges", () => {
    const fighter = { x: 100, y: 100, rotation: 180, blockActiveMs: 100, blockCharges: 5 };
    const source = { x: 0, y: 100 };
    const repulsor = resolveShieldInteraction(fighter, source, ABILITY_CONTRACTS.repulsor_burst.shieldInteraction);
    assert.equal(repulsor.fighter.blockCharges, 4);
    assert.ok(repulsor.preventedEffects.has(EFFECT_TYPES.DAMAGE));
    assert.ok(!repulsor.preventedEffects.has(EFFECT_TYPES.KNOCKBACK));
    const slash = resolveShieldInteraction(fighter, source, ABILITY_CONTRACTS.heavy_slash.shieldInteraction);
    assert.equal(slash.fighter.blockCharges, 0);
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
        entities: [drone], fighters: [target], grenades: [], fireballs: [],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);
    assert.equal(result.entities[0].x, 104.5);
    assert.equal(result.entities[0].y, 200);
});

test("hunter drone retains the replay-matched shot visual timer", () => {
    const drone = { ...hunterDroneEntity({ id: "owner", slot: 1, x: 100, y: 200, rotation: 90 }), shotCooldownMs: 0 };
    const target = { id: "target", slot: 2, x: 200, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], fighters: [target], grenades: [], fireballs: [],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities[0].shotVisualMs, 250);
});

test("entity-hit records trigger an armed mine through the entity system", () => {
    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true };
    const fighter = { id: "attacker", slot: 2, x: 500, y: 500, size: 50, hp: 100, entityHitIds: [mine.id] };
    const result = tickAbilityEntityWorld({
        entities: [mine], fighters: [fighter], grenades: [], fireballs: [],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].type, "mineExplosion");
    assert.equal(result.entities[0].visibleMs, 300);
});

test("status effects are accumulated before the fighter hp snapshot is returned", () => {
    const fighter = {
        hp: 100, maxHp: 100, abilities: [],
        burnRemainingMs: 1000, burnTickMs: 50, burnDamageMultiplier: 1,
        bleedRemainingMs: 1000, bleedTickMs: 50, bleedDamage: 2,
    };
    const result = tickFighterStatus(fighter, 50, noDamageCombat.applyDamageToShape);
    assert.equal(result.hp, 96);
    assert.equal(result.burnRemainingMs, 950);
    assert.equal(result.bleedRemainingMs, 950);
});

test("DOT, direct damage, and healing on one tick resolve as one net hp change", () => {
    const fighter = {
        hp: 50, maxHp: 100, abilities: [], pendingHealing: 15,
        burnRemainingMs: 1000, burnTickMs: 50, burnDamageMultiplier: 1,
        bleedRemainingMs: 1000, bleedTickMs: 50, bleedDamage: 2,
    };
    const afterDots = tickFighterStatus(fighter, 50, applyDamageToShape);
    const afterDirectHit = applyDamageToShape(afterDots, 8);
    const result = settlePendingHealing(afterDirectHit);
    assert.equal(result.hp, 53);
    assert.equal(result.damageTakenThisTick, 12);
});

test("burn and bleed discard a pending tick when duration expires first", () => {
    const fighter = {
        hp: 100, maxHp: 100, abilities: [],
        burnRemainingMs: 100, burnTickMs: 200, burnDamageMultiplier: 1,
        bleedRemainingMs: 100, bleedTickMs: 200, bleedDamage: 2,
    };
    const result = tickFighterStatus(fighter, 200, noDamageCombat.applyDamageToShape);
    assert.equal(result.hp, 100);
    assert.equal(result.burnRemainingMs, 0);
    assert.equal(result.bleedRemainingMs, 0);
});

test("burn and bleed apply a final tick due exactly at expiration", () => {
    const fighter = {
        hp: 100, maxHp: 100, abilities: [],
        burnRemainingMs: 100, burnTickMs: 100, burnDamageMultiplier: 1,
        bleedRemainingMs: 100, bleedTickMs: 100, bleedDamage: 2,
    };
    assert.equal(tickFighterStatus(fighter, 100, noDamageCombat.applyDamageToShape).hp, 96);
});

test("another heavy slash refreshes bleed duration without resetting its pending tick", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, prototypeTriggered: "heavy_slash" };
    const defender = { id: "target", x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, bleedRemainingMs: 4000, bleedTickMs: 300, bleedDamage: 2 };
    const [, hit] = resolvePrototypeCombat(attacker, defender);
    assert.equal(hit.hp, 70);
    assert.equal(hit.bleedRemainingMs, 5000);
    assert.equal(hit.bleedTickMs, 300);
    assert.equal(tickFighterStatus(hit, 300, noDamageCombat.applyDamageToShape).hp, 68);
});

test("a blocked heavy slash removes every shield charge without applying damage or bleed", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, prototypeTriggered: "heavy_slash" };
    const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, blockActiveMs: 1, blockCharges: 5, abilities: ["block"] };
    const [, blocked] = resolvePrototypeCombat(attacker, defender);
    assert.equal(blocked.hp, 100);
    assert.equal(blocked.blockCharges, 0);
    assert.equal(blocked.bleedRemainingMs ?? 0, 0);
});

test("blocked concussive and rail shots do not apply their attached effects", () => {
    for (const ability of ["concussive_shot", "rail_shot"]) {
        const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, prototypeTriggered: ability };
        const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, blockActiveMs: 1, blockCharges: 5, abilities: ["block"] };
        const [, blocked] = resolvePrototypeCombat(attacker, defender);
        assert.equal(blocked.hp, 100, ability);
        assert.equal(blocked.slowedMs ?? 0, 0, ability);
        assert.equal(blocked.shockRemainingMs ?? 0, 0, ability);
        assert.equal(blocked.blockCharges, 4, ability);
    }
});

test("repulsor burst deals 20 damage and pushes 250 units, while blocking prevents only damage", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, prototypeTriggered: "repulsor_burst" };
    const defender = { id: "target", x: 180, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [, hit] = resolvePrototypeCombat(attacker, defender);
    assert.equal(hit.hp, 80);
    assert.equal(hit.x, 430);

    const [, blocked] = resolvePrototypeCombat(attacker, { ...defender, blockActiveMs: 1, blockCharges: 5, abilities: ["block"] });
    assert.equal(blocked.hp, 100);
    assert.equal(blocked.x, 430);
    assert.equal(blocked.blockCharges, 4);
});

test("thrust deals 15 damage and applies its 30-unit knockback", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, prototypeTriggered: "thrust" };
    const defender = { id: "target", x: 180, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const [, hit] = resolvePrototypeCombat(attacker, defender);
    assert.equal(hit.hp, 85);
    assert.equal(hit.x, 210);
});

test("absolute guard rejects damage, statuses, and displacement without draining block", () => {
    const guarded = {
        id: "target", slot: 2, x: 180, y: 100, size: 60, rotation: 180,
        hp: 100, maxHp: 100, blockActiveMs: 1, blockCharges: 5,
        abilityActiveMs: { absolute_guard: 1000 },
    };
    assert.equal(applyDamageToShape(guarded, 50), guarded);

    for (const ability of ["heavy_slash", "rail_shot", "concussive_shot", "repulsor_burst", "thrust"]) {
        const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, prototypeTriggered: ability };
        const [, result] = resolvePrototypeCombat(attacker, guarded);
        assert.equal(result.hp, 100, ability);
        assert.equal(result.x, 180, ability);
        assert.equal(result.blockCharges, 5, ability);
        assert.equal(result.bleedRemainingMs ?? 0, 0, ability);
        assert.equal(result.shockRemainingMs ?? 0, 0, ability);
        assert.equal(result.slowedMs ?? 0, 0, ability);
    }
});

test("absolute guard rejects persistent entity fields, pulses, mines, and strikes", () => {
    const guarded = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, abilityActiveMs: { absolute_guard: 1000 } };
    const arena = { fighters: [guarded], grenades: [], fireballs: [], stepMs: 100, width: 1000, height: 1000 };

    const silence = silenceWaveEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 });
    const silenced = tickAbilityEntityWorld({ ...arena, entities: [silence] }, noDamageCombat).fighters[0];
    assert.equal(silenced.silencedMs ?? 0, 0);
    assert.equal(silenced.stunnedMs ?? 0, 0);

    const gravity = { ...thrownFieldEntity("gravityField", { id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), x: 100, y: 100, traveled: 176, fuseMs: 1000 };
    const pulled = tickAbilityEntityWorld({ ...arena, entities: [gravity] }, noDamageCombat).fighters[0];
    assert.equal(pulled.x, 150);
    assert.equal(pulled.y, 100);

    const zone = nullZoneEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 150, 100, (value) => value);
    const zoned = tickAbilityEntityWorld({ ...arena, entities: [zone] }, noDamageCombat).fighters[0];
    assert.equal(zoned.nullZoneSilenced, false);

    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true };
    const orbital = { ...orbitalMarkerEntity({ id: "owner", slot: 1 }, 150, 100, (value) => value), fuseMs: 100 };
    const struck = tickAbilityEntityWorld({ ...arena, entities: [mine, orbital] }, noDamageCombat).fighters[0];
    assert.equal(struck.hp, 100);
});

test("releasing shield starts a two-second activation cooldown without changing charges", () => {
    const fighter = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, abilities: ["block"], blockCharges: 5, blockCooldownMs: 0 };
    const held = applyFighterAction(fighter, { block: 1 }, 100, noDamageCombat.applyDamageToShape);
    const released = applyFighterAction(held, {}, 100, noDamageCombat.applyDamageToShape);
    const rejected = applyFighterAction(released, { block: 1 }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(held.blockActiveMs, 1);
    assert.equal(released.blockCooldownMs, 2000);
    assert.equal(released.blockCharges, 5);
    assert.equal(rejected.blockActiveMs, 0);
});

test("each shield charge takes five seconds to recharge", () => {
    const fighter = { hp: 100, maxHp: 100, abilities: ["block"], blockCharges: 0, blockRechargeMs: 0 };
    const almost = tickFighterStatus(fighter, 4999, noDamageCombat.applyDamageToShape);
    assert.equal(almost.blockCharges, 0);
    const recharged = tickFighterStatus(almost, 1, noDamageCombat.applyDamageToShape);
    assert.equal(recharged.blockCharges, 1);
    assert.equal(recharged.blockRechargeMs, 0);
});

test("null zone silence is presence-based while silence pulse remains timed", () => {
    const zone = nullZoneEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 300, 300, (value) => value);
    const inside = { id: "target", slot: 2, x: 300, y: 300, size: 60, hp: 100, silencedMs: 0 };
    const inZone = tickAbilityEntityWorld({ entities: [zone], fighters: [inside], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(inZone.fighters[0].nullZoneSilenced, true);
    assert.equal(inZone.fighters[0].silencedMs, 0);

    const movedOut = { ...inZone.fighters[0], x: 800, y: 700 };
    const outOfZone = tickAbilityEntityWorld({ entities: inZone.entities, fighters: [movedOut], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(outOfZone.fighters[0].nullZoneSilenced, false);
    assert.equal(outOfZone.fighters[0].silencedMs, 0);
});

test("combat visual timing preserves centered pulses, sword sweeps, and pistol fade", () => {
    assert.equal(swordSweepAngle(400, 400), -50);
    assert.ok(Math.abs(swordSweepAngle(300, 400) - (-50 / 3)) < 0.0001);
    assert.ok(Math.abs(swordSweepAngle(200, 400) - (50 / 3)) < 0.0001);
    assert.equal(swordSweepAngle(100, 400), 50);
    assert.equal(prototypeVisualOpacity({ prototypeVisual: { ability: "pistol_shot", ms: 150 } }, "pistol_shot"), 0.5);
    assert.equal(prototypeVisualOpacity({ abilityActiveMs: { pistol_shot: 150 } }, "pistol_shot"), 0.5);
    assert.equal(combatVisualRemainingMs({ abilityActiveMs: { heavy_slash: 250 } }, "heavy_slash"), 250);
    assert.equal(prototypeVisualOpacity({ prototypeVisual: null }, undefined), 0);
});

test("prototype animations keep their full starting frame without an opponent", () => {
    for (const ability of ["heavy_slash", "pistol_shot", "repulsor_burst", "repair_pulse"]) {
        const attacker = { id: "main", x: 100, y: 100, rotation: 0, prototypeTriggered: ability };
        const [animated, opponent] = resolvePrototypeCombat(attacker, null);
        assert.equal(opponent, null, ability);
        assert.equal(animated.prototypeVisual.ability, ability);
        assert.equal(animated.prototypeVisual.ms, ability === "heavy_slash" ? 400 : 300, ability);
    }
    const [slash] = resolvePrototypeCombat({ id: "main", x: 100, y: 100, rotation: 0, prototypeTriggered: "heavy_slash" }, null);
    assert.equal(swordSweepAngle(slash.prototypeVisual.ms, 400), -50);
});

test("sword swing keeps its full visual timer through the activation step", () => {
    const fighter = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: ["swing"], swingCooldownMs: 0, swingActiveMs: 0,
    };
    const active = applyFighterAction(fighter, { swing: 1 }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.swingActiveMs, 400);
    assert.equal(swordSweepAngle(active.swingActiveMs, 400), -50);
    assert.equal(active.swingTriggered, true);
});

test("sword swing hit resolves only on its activation tick while its animation continues", () => {
    const defender = { x: 190, y: 100, size: 20 };
    assert.equal(isSwingHitting({ x: 100, y: 100, rotation: 90, size: 60, swingActiveMs: 200, swingTriggered: true }, defender), true);
    assert.equal(isSwingHitting({ x: 100, y: 100, rotation: 90, size: 60, swingActiveMs: 100, swingTriggered: false }, defender), false);
});

test("sword swing hitbox matches the displayed 100-degree, 92-unit sweep", () => {
    const attacker = { x: 100, y: 100, rotation: 90, size: 60, swingActiveMs: 200 };
    assert.equal(isSwingHitting(attacker, { x: 190, y: 100, size: 20 }), true);
    assert.equal(isSwingHitting(attacker, { x: 100, y: 190, size: 20 }), false);
    assert.equal(isSwingHitting(attacker, { x: 205, y: 100, size: 20 }), false);
});

test("a prepared ability cannot be replaced by another ready ability", () => {
    const fighter = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: ["concussive_shot", "pistol_shot"],
        abilityCooldowns: { concussive_shot: 0, pistol_shot: 0 }, abilityActiveMs: {},
    };
    const preparing = applyFighterAction(fighter, { abilityAction: { action: "concussive_shot" } }, 100, noDamageCombat.applyDamageToShape);
    const stillPreparing = applyFighterAction(preparing, { abilityAction: { action: "pistol_shot" } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(stillPreparing.preparingAbility, "concussive_shot");
    assert.equal(stillPreparing.preparingMs, 200);
    assert.equal(stillPreparing.abilityCooldowns.pistol_shot, 0);
});

test("temporal rewind creates a passive targetable clock zone", () => {
    const fighter = {
        id: "main", slot: 1, x: 240, y: 360, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: ["temporal_rewind"],
        abilityCooldowns: { temporal_rewind: 0 }, abilityActiveMs: {},
    };
    const active = applyFighterAction(fighter, { abilityAction: { action: "temporal_rewind" } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.prototypeSpawn.type, "temporalRewindZone");
    assert.equal(active.prototypeSpawn.x, 240);
    assert.equal(active.prototypeSpawn.y, 360);
});

test("health bar fill is the clamped fraction of current hp", () => {
    assert.equal(healthBarPercent(75, 100), 75);
    assert.equal(healthBarPercent(30, 120), 25);
    assert.equal(healthBarPercent(-5, 100), 0);
    assert.equal(healthBarPercent(150, 100), 100);
});

test("fire gun activation retains a fading ray for the active duration", () => {
    const fighter = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: ["fire_gun"], gunAmmo: 10,
        gunCooldownMs: 0, gunActiveMs: 0, gunReloadMs: 0,
    };
    const active = applyFighterAction(fighter, { gun: 1 }, 50, noDamageCombat.applyDamageToShape);
    assert.equal(active.gunShotActive, true);
    assert.equal(active.gunActiveMs, 950);
    assert.equal(gunRayOpacity(active), 0.95);
    const faded = tickFighterStatus(active, 450, noDamageCombat.applyDamageToShape);
    assert.equal(gunRayOpacity(faded), 0.5);
});

test("a dead fighter clears one-tick attacks while their visuals finish", () => {
    const dead = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 0, maxHp: 100, abilities: ["fire_gun", "rail_shot"],
        gunActiveMs: 900, gunShotActive: true,
        swingActiveMs: 300, swingTriggered: true,
        stunActiveMs: 250, stunCastActive: true,
        prototypeTriggered: "rail_shot",
        prototypeSpawn: { id: "already-spawned" },
        preparingAbility: "concussive_shot",
        preparingMs: 250,
    };

    const next = applyFighterAction(dead, { gun: 1 }, 50, noDamageCombat.applyDamageToShape);

    assert.equal(next.gunShotActive, false);
    assert.equal(next.swingTriggered, false);
    assert.equal(next.stunCastActive, false);
    assert.equal(next.prototypeTriggered, null);
    assert.equal(next.prototypeSpawn, null);
    assert.equal(next.preparingAbility, "concussive_shot");
    assert.equal(next.preparingMs, 250);
    assert.equal(next.gunActiveMs, 850);
    assert.ok(gunRayOpacity(next) > 0);
});

test("a ray from a fighter killed after firing cannot damage again", () => {
    const attacker = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 0, maxHp: 100, abilities: ["fire_gun"], gunShotActive: true,
        gunActiveMs: 900, attackDamageMultiplier: 1,
    };
    const defender = { id: "opponent-model", slot: 2, x: 200, y: 100, size: 60, hp: 100, maxHp: 100 };

    const cleared = applyFighterAction(attacker, {}, 50, noDamageCombat.applyDamageToShape);
    const [, afterCombat] = resolveBasicCombat(cleared, defender);

    assert.equal(afterCombat.hp, 100);
});

test("death removes every active fighter status while preserving preparation and cooldowns", () => {
    const fighter = {
        id: "target", hp: 5, maxHp: 100,
        slowedMs: 1000, silencedMs: 1000, nullZoneSilenced: true, stunnedMs: 1000,
        movementLockMs: 300, shockRemainingMs: 3000, shockTickElapsedMs: 250,
        burnRemainingMs: 3000, burnTickMs: 500, bleedRemainingMs: 4000, bleedTickMs: 750,
        blockActiveMs: 1, abilityActiveMs: { reactive_armor: 2000 },
        quickJabComboCount: 4, quickJabComboMs: 800,
        temporalRewindMs: 2000, temporalRewindPulseMs: 300,
        pendingHealing: 20, preparingAbility: "rail_shot", preparingMs: 450,
        abilityCooldowns: { rail_shot: 5000 },
    };

    const dead = applyDamageToShape(fighter, 10);

    assert.equal(dead.hp, 0);
    assert.deepEqual(fighterStatusLabels(dead), []);
    assert.deepEqual(dead.abilityActiveMs, {});
    assert.equal(dead.nullZoneSilenced, false);
    assert.equal(dead.shockRemainingMs, 0);
    assert.equal(dead.burnRemainingMs, 0);
    assert.equal(dead.bleedRemainingMs, 0);
    assert.equal(dead.temporalRewindMs, 0);
    assert.equal(dead.pendingHealing, 0);
    assert.equal(dead.preparingAbility, "rail_shot");
    assert.equal(dead.preparingMs, 450);
    assert.equal(dead.abilityCooldowns.rail_shot, 5000);
});

test("an ALWAYS brain action reaches the real fire-gun executor", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        blocks: [{ id: "always-fire", priority: 1, conditions: [{ type: "always" }], actions: [{ action: "fire_gun" }] }],
    };
    const snapshot = {
        playerModel: { id: "main", x: 100, y: 100, rotation: 0, gunAvailable: true },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 500, y: 100, size: 60, hp: 100 }],
    };
    const action = buildDeterministicLogicAction(configuration, snapshot);
    const fighter = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: ["fire_gun"], gunAmmo: 10, gunCooldownMs: 0, gunActiveMs: 0, gunReloadMs: 0 };
    const result = applyFighterAction(fighter, action, 50, noDamageCombat.applyDamageToShape);
    assert.deepEqual(action.abilityAction, { action: "fire_gun", targetX: undefined, targetY: undefined });
    assert.equal(action.gun, undefined);
    assert.equal(result.gunShotActive, true);
    assert.equal(result.gunAmmo, 9);
});

test("fireball and concussive shot hand off the shared ability head in either priority order", () => {
    const configuration = (first, second) => ({
        version: "bot-logic-tree-v1",
        columns: [{ id: "abilities", createdOrder: 0, branches: [
            { id: first, branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: first }] },
            { id: second, branchType: "else_if", createdOrder: 1, conditions: [{ type: "always" }], actions: [{ action: second }] },
        ] }],
    });
    const opponent = { id: "opponent-model", slot: 2, x: 600, y: 100, size: 60, hp: 100, abilities: [] };
    const fighter = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100,
        moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
        abilities: ["shoot_fireball", "concussive_shot"], fireballCharges: 4,
        fireballCooldownMs: 0, fireballActiveMs: 0, fireballReloadMs: 0,
        abilityCooldowns: { concussive_shot: 0 },
    };

    const fireballFirstAction = buildDeterministicLogicAction(configuration("shoot_fireball", "concussive_shot"), buildStatePayload([fighter, opponent], "custom"));
    const afterFireball = applyFighterAction(fighter, fireballFirstAction, 50, noDamageCombat.applyDamageToShape);
    const concussiveNextAction = buildDeterministicLogicAction(configuration("shoot_fireball", "concussive_shot"), buildStatePayload([afterFireball, opponent], "custom"));
    const preparingAfterFireball = applyFighterAction(afterFireball, concussiveNextAction, 50, noDamageCombat.applyDamageToShape);
    assert.equal(fireballFirstAction.abilityAction.action, "shoot_fireball");
    assert.equal(concussiveNextAction.abilityAction.action, "concussive_shot");
    assert.equal(preparingAfterFireball.preparingAbility, "concussive_shot");

    let afterConcussive = fighter;
    for (let tick = 0; tick < 10; tick += 1) {
        const action = buildDeterministicLogicAction(configuration("concussive_shot", "shoot_fireball"), buildStatePayload([afterConcussive, opponent], "custom"));
        afterConcussive = applyFighterAction(afterConcussive, action, 50, noDamageCombat.applyDamageToShape);
    }
    const fireballAfterConcussive = buildDeterministicLogicAction(configuration("concussive_shot", "shoot_fireball"), buildStatePayload([afterConcussive, opponent], "custom"));
    assert.equal(afterConcussive.preparingAbility, null);
    assert.ok(afterConcussive.abilityCooldowns.concussive_shot > 0);
    assert.equal(fireballAfterConcussive.abilityAction.action, "shoot_fireball");
});

test("projectile system returns net fighter damage and removes a colliding fireball", () => {
    const fighters = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100 },
    ];
    const fireball = { id: "fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickProjectileWorld({ fighters, grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(result.fireballs.length, 0);
    assert.equal(result.fighters[1].hp, 85);
    assert.equal(result.fighters[1].burnRemainingMs > 0, true);
});

test("projectiles pass through dead fighters without applying damage or status", () => {
    let world = {
        fighters: [
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
    assert.equal(world.fighters[1].burnRemainingMs ?? 0, 0);

    for (let tick = 0; tick < 25 && world.fireballs.length > 0; tick += 1) {
        world = { ...world, ...tickProjectileWorld(world, noDamageCombat) };
    }
    assert.equal(world.fighters[1].hp, 0);
    assert.equal(world.fighters[1].burnRemainingMs ?? 0, 0);
    assert.equal(world.fighters[2].hp, 85);
});

test("shield blocks fireball damage and burn together", () => {
    const fighters = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, rotation: 180, hp: 100, blockActiveMs: 1, blockCharges: 5 },
    ];
    const fireball = { id: "blocked-fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickProjectileWorld({ fighters, grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(result.fighters[1].hp, 100);
    assert.equal(result.fighters[1].burnRemainingMs ?? 0, 0);
    assert.equal(result.fighters[1].blockCharges, 4);
});

test("mine, gravity, silence, drone, and orbital effects use their shield rules", () => {
    const shield = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, blockActiveMs: 1, blockCharges: 5, abilities: ["block"] };
    const mine = { ...proximityMineEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }), traveled: 176, armed: true, hitTriggered: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], fighters: [shield], grenades: [], fireballs: [], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(mineResult.fighters[0].hp, 100);
    assert.equal(mineResult.fighters[0].blockCharges, 0);

    const gravity = { ...thrownFieldEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, "gravityField", "gravity_grenade", 240, 2000), traveled: 176, x: 100, y: 100, fuseMs: 100, remainingMs: 2000 };
    const gravityResult = tickAbilityEntityWorld({ entities: [gravity], fighters: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(gravityResult.fighters[0].hp, 100);
    assert.equal(gravityResult.fighters[0].blockCharges, 0);

    const silence = silenceWaveEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 });
    const silenceResult = tickAbilityEntityWorld({ entities: [silence], fighters: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(silenceResult.fighters[0].silencedMs ?? 0, 0);
    assert.equal(silenceResult.fighters[0].blockCharges, 4);

    const drone = { ...hunterDroneEntity({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }), shotCooldownMs: 0 };
    const droneResult = tickAbilityEntityWorld({ entities: [drone], fighters: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(droneResult.fighters[0].hp, 100);
    assert.equal(droneResult.fighters[0].blockCharges, 4);

    const orbital = { ...orbitalMarkerEntity({ id: "owner", slot: 1, x: 100, y: 100 }, 150, 100, (value) => value), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], fighters: [shield], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.ok(orbitalResult.fighters[0].hp < 100);
    assert.equal(orbitalResult.fighters[0].blockCharges, 0);
});

test("another fireball refreshes burn duration without resetting its pending damage tick", () => {
    const fighters = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100, burnRemainingMs: 4000, burnTickMs: 300, burnDamageMultiplier: 1 },
    ];
    const fireball = { id: "refresh", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const hit = tickProjectileWorld({ fighters, grenades: [], fireballs: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(hit.fighters[1].burnRemainingMs, 5000);
    assert.equal(hit.fighters[1].burnTickMs, 300);

    const ticked = tickFighterStatus(hit.fighters[1], 300, noDamageCombat.applyDamageToShape);
    assert.equal(ticked.hp, 83);
});
