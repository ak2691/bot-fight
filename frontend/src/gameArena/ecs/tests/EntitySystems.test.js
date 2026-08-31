import assert from "node:assert/strict";
import test from "node:test";
import { createAbilityEntity } from "../entities/EntityFactory.js";
import { ENTITY_CONTRACTS, entityContractForAbility, isProjectileEntity } from "../contracts/EntityContracts.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "../abilities/AbilityEntitySystem.js";
import { tickBotStatus } from "../bots/BotStatusSystem.js";
import { tickBotResources } from "../bots/BotResourceSystem.js";
import { tickBotLifecycle } from "../bots/BotLifecycleSystem.js";
import { tickDeferredStates } from "../bots/DeferredStateSystem.js";
import { tickBotState } from "../bots/BotStateSystem.js";
import { applyBotAction } from "../bots/ActionExecutionSystem.js";
import { tickProjectileWorld } from "../abilities/ProjectileSystem.js";
import { abilityActiveOpacity, basicHealParticleSpec, BASIC_HEAL_PARTICLE_COUNT, BASIC_HEAL_PARTICLE_LIFETIME_MS, combatVisualRemainingMs, healthBarPercent, abilityVisualOpacity, REPULSOR_BURST_FRAME_COUNT, REPULSOR_BURST_FRAME_MS, REPULSOR_BURST_MAX_DIAMETER, REPULSOR_BURST_VISUAL_MS, repulsorBurstDiameter, repulsorBurstFrameIndex, repulsorBurstProgress, sweepAngle } from "../../gameconfig/visualState.js";
import { applyDamageFromShapes, applyDamageToShape, resolveTriggeredAbilityCombat as resolveAbilityCombat, resolveTriggeredAbilityCombatForRoster, settlePendingHealing } from "../../gameconfig/BotCombatSystem.js";
import { damageAtDistance } from "../abilities/AbilityEffectSystem.js";
import { abilityHitsTarget } from "../abilities/AbilityHitDetectionSystem.js";
import { buildDeterministicLogicAction } from "../../botlogic/planner/ArenaActionPlanner.js";
import { buildStatePayload } from "../../modelPayloads/strategyStatePayload.js";
import { abilityDefinition, ABILITY_STATS, shouldInterpolateAbilityVisual } from "../../loadout/BotLoadout.js";
import { ABILITY_CONTRACTS, DELIVERY_TYPES, EFFECT_TYPES, SHIELD_MODES } from "../../gameconfig/AbilityContracts.js";
import { resolveShieldInteraction } from "../../gameconfig/ShieldSystem.js";
import { botStatusLabels } from "../../pixi/pixiVisualState.js";
import { resetBotShape, toSimulationBotShape } from "../../modelPayloads/arenaShapes.js";
import { compassDirection } from "../../botlogic/planner/arenaAngles.js";
import { CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER, CONCUSSIVE_SHOT_SLOW_DURATION_MS, HIT_STAGGER_DURATION_MS, HIT_STAGGER_MOVEMENT_MULTIPLIER, HIT_STAGGER_ROTATION_MULTIPLIER } from "../../gameconfig/HitStagger.js";
import { statusEffectFor, statusIsActive, statusRemainingMs } from "../contracts/StatusContracts.js";
import { anotherAbilityActive } from "../../gameconfig/AbilityResourceSystem.js";

const noDamageCombat = {
    applyDamageToShape: (bot, damage) => ({ ...bot, hp: Math.max(0, bot.hp - damage) }),
    applyDamageFromShapes: (owner, target, damage) => [owner, { ...target, hp: target.hp - damage }],
    abilityHitsTarget: () => false,
    triggeredAbilityDamage: () => 0,
    overlapsShape: () => false,
};

const entityFor = (bot, abilityId, context = {}) => createAbilityEntity(bot, abilityId, context);

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

function status(type, remainingMs, { tickMs = 0, tickElapsedMs = 0, mode = "duration", effects = [], ...metadata } = {}) {
    return { type, remainingMs, ...(tickMs > 0 ? { tickMs } : {}), ...(tickElapsedMs > 0 ? { tickElapsedMs } : {}), mode, effects, ...metadata };
}

function damageStatus(type, remainingMs, tickMs, amount, metadata = {}) {
    return status(type, remainingMs, {
        tickMs,
        effects: [{ type: "damage", mode: "tick", amount, multiplier: metadata.multiplier ?? 1 }],
        ...metadata,
    });
}

test("resetting bot stats clears every transient status effect", () => {
    const reset = resetBotShape({
        id: "main",
        combatLoadout: "custom",
        x: 400,
        y: 400,
        statusEffects: [
            damageStatus("bleed", 5000, 1000, 2),
            damageStatus("shock", 2000, 1000, 3),
            status("silence", 0, { mode: "presence", effects: [{ type: "silence", mode: "constant" }] }),
            status("movement-lock", 1000),
        ],
        temporalRewindMs: 3000,
        pendingHealing: 25,
    });

    const simulationShape = toSimulationBotShape(reset);
    assert.equal(reset.statusEffects.length, 0);
    assert.equal(statusRemainingMs(simulationShape, "bleed"), 0);
    assert.equal(statusRemainingMs(simulationShape, "shock"), 0);
    assert.equal(statusIsActive(simulationShape, "silence"), false);
    assert.equal(statusRemainingMs(simulationShape, "movement-lock"), 0);
    assert.equal(simulationShape.temporalRewindMs, 0);
    assert.equal(simulationShape.pendingHealing, 0);
});

test("target-relative walk uses a normalized vector from the bot to the target", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [{
            priority: 1,
            branches: [{
                id: "walk-up",
                branchType: "if",
                priority: 1,
                conditions: [{ type: "always" }],
                actions: [{ action: "move_walk", movementMode: "target", movementDirection: 0, selectable: "opponent" }],
                children: [],
            }],
        }],
    };
    const action = buildDeterministicLogicAction(configuration, {
        playerModel: { id: "main", x: 400, y: 400, rotation: 0, abilities: [] },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 100, size: 60, hp: 100, rotation: 180 }],
    });

    assert.ok(Math.abs(action.dx) < 0.000001);
    assert.ok(Math.abs(action.dy + 1) < 0.000001);
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

test("active ability contracts never block or filter effects", () => {
    for (const [id, contract] of Object.entries(ABILITY_CONTRACTS)) {
        assert.equal(contract.shieldInteraction.mode, SHIELD_MODES.IGNORE, id);
        assert.deepEqual(contract.shieldInteraction.prevents, [], id);
    }
});

test("stale retired Block state cannot suppress an ability effect", () => {
    const bot = { x: 100, y: 100, rotation: 180, maxHp: 100, abilityActiveMs: { 2: 100 }, abilityCharges: { 2: 25 } };
    const result = resolveShieldInteraction(bot, { x: 0, y: 100 }, { mode: SHIELD_MODES.BLOCK, prevents: [EFFECT_TYPES.DAMAGE] });
    assert.equal(result.bot, bot);
    assert.equal(result.blocked, false);
    assert.equal(result.preventedEffects.size, 0);
    assert.equal(result.bot.abilityCharges[2], 25);
});

test("hunter drone spawns with component health and 50 hp", () => {
    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 200, rotation: 0 }, 17);
    assert.equal(drone.hp, 50);
    assert.equal(drone.components.health.hp, 50);
    assert.equal(drone.components.collider.hittable, true);
});

test("hunter drone pursues targets at 4.5 units per arena tick", () => {
    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 200, rotation: 0 }, 17);
    const target = { id: "target", slot: 2, x: 500, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], projectiles: [], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);
    assert.equal(result.entities[0].x, 104.5);
    assert.equal(result.entities[0].y, 200);
});

test("hunter drone retains the replay-matched shot visual timer", () => {
    const drone = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 200, rotation: 90 }, 17), shotCooldownMs: 0 };
    const target = { id: "target", slot: 2, x: 200, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], projectiles: [], bots: [target],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities[0].shotVisualMs, 250);
});

test("Tether Bolt uses one generic segment hit for damage, pull, and slow", () => {
    const bolt = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90, attackDamageMultiplier: 1 }, 28);
    const target = { id: "target", slot: 2, x: 180, y: 100, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [bolt], projectiles: [], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities.length, 0);
    assert.equal(result.bots[0].hp, 90);
    assert.equal(statusRemainingMs(result.bots[0], "slow"), 1200);
    assert.ok(result.bots[0].x < target.x);
});

test("generic segment hitboxes sweep across a bot's dash segment", () => {
    const owner = { id: "owner", slot: 1, x: 700, y: 100, size: 60, hp: 100, maxHp: 100 };
    const target = {
        id: "target", slot: 2, x: 425, y: 432, size: 60, hp: 100, maxHp: 100,
        movementStartX: 500, movementStartY: 432,
    };
    const windburst = {
        ...entityFor(owner, 18),
        x: 500,
        y: 467.6,
        velocityX: 0,
        velocityY: 0,
    };
    const result = tickAbilityEntityWorld({
        entities: [windburst], projectiles: [], bots: [owner, target],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities.length, 0);
    assert.ok(result.bots[1].hp < 100);
});

test("Static Snare uses its stronger phase when generic damage destroys it", () => {
    const snare = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 29);
    const target = { id: "target", slot: 2, x: 800, y: 700, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [snare], projectiles: [], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    }, {
        ...noDamageCombat,
        triggeredAbilityDamage: () => 20,
        abilityHitsTarget: () => false,
    });

    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].type, "staticSnareBurst");
    assert.equal(result.entities[0].size, 240);
});

test("Static Snare triggers once without chaining to its owner", () => {
    const snare = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 29);
    const target = { id: "target", slot: 2, x: 140, y: 100, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [snare], projectiles: [], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.bots[0].hp, 85);
    assert.equal(statusRemainingMs(result.bots[0], "slow"), 2200);
    assert.equal(statusRemainingMs(result.bots[0], "stun"), 150);
    assert.equal(result.entities[0].type, "staticSnareBurst");
    assert.equal(result.entities[0].size, 150);
});

test("Static Snare gets its stronger radius and effects when any attack destroys it", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, triggeredAbility: 9 };
    const snare = entityFor(owner, 29);
    const target = { id: "target", slot: 2, x: 210, y: 100, size: 60, hp: 100, maxHp: 100 };
    const ownerShot = {
        ...noDamageCombat,
        abilityHitsTarget: (attacker, entity) => attacker.id === owner.id && entity.id === snare.id,
        triggeredAbilityDamage: (attacker, entity) => attacker.id === owner.id && entity.id === snare.id ? 20 : 0,
    };
    const result = tickAbilityEntityWorld({
        entities: [snare], projectiles: [], bots: [owner, target],
        stepMs: 100, width: 1000, height: 800,
    }, ownerShot);

    assert.equal(result.bots[1].hp, 80);
    assert.equal(statusRemainingMs(result.bots[1], "slow"), 3000);
    assert.equal(statusRemainingMs(result.bots[1], "stun"), 150);
    assert.equal(result.entities[0].type, "staticSnareBurst");
    assert.equal(result.entities[0].size, 240);
});

test("Static Snare does not detonate from a nonlethal attack hit", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100 };
    const snare = entityFor(owner, 29);
    const attacker = { id: "attacker", slot: 2, x: 800, y: 700, size: 60, rotation: 90, hp: 100, triggeredAbility: 9 };
    const result = tickAbilityEntityWorld({
        entities: [snare], projectiles: [], bots: [attacker],
        stepMs: 100, width: 1000, height: 800,
    }, {
        ...noDamageCombat,
        abilityHitsTarget: (bot, entity) => bot.id === attacker.id && entity.id === snare.id,
        triggeredAbilityDamage: (bot, entity) => bot.id === attacker.id && entity.id === snare.id ? 5 : 0,
    });

    assert.equal(result.entities[0].type, "staticSnare");
    assert.equal(result.entities[0].hp, 15);
    assert.equal(result.bots[0].hp, 100);
});

test("Static Snare uses its stronger phase when an opponent destroys it and skips its owner", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100 };
    const snare = entityFor(owner, 29);
    const attacker = { id: "attacker", slot: 2, x: 140, y: 100, size: 60, rotation: 90, hp: 100, maxHp: 100, triggeredAbility: 9 };
    const result = tickAbilityEntityWorld({
        entities: [snare], projectiles: [], bots: [owner, attacker],
        stepMs: 100, width: 1000, height: 800,
    }, {
        ...noDamageCombat,
        abilityHitsTarget: (bot, entity) => bot.id === attacker.id && entity.id === snare.id,
        triggeredAbilityDamage: (bot, entity) => bot.id === attacker.id && entity.id === snare.id ? 20 : 0,
    });

    assert.equal(result.bots[0].hp, 100);
    assert.equal(result.bots[1].hp, 80);
    assert.equal(statusRemainingMs(result.bots[1], "slow"), 3000);
    assert.equal(result.entities[0].type, "staticSnareBurst");
    assert.equal(result.entities[0].size, 240);
});

test("Repeller Drone uses the hunter drone body with low-damage knockback shots", () => {
    const drone = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }, 31), shotCooldownMs: 0 };
    const target = { id: "target", slot: 2, x: 180, y: 100, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], projectiles: [], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities[0].type, "hunterDrone");
    assert.equal(result.entities[0].hp, 50);
    assert.equal(result.entities[0].x, 104.5);
    assert.equal(result.bots[0].hp, 98);
    assert.ok(result.bots[0].x > target.x);
});

test("drones use a short bot action lock while their entities keep their duration", () => {
    const bot = {
        ...base,
        id: "owner",
        slot: 1,
        abilities: [17],
        abilityCooldowns: { 17: 0 },
        abilityActiveMs: {},
    };
    const activated = applyBotAction(bot, { abilityAction: { action: 17 } }, 100, applyDamageToShape);

    assert.equal(activated.triggeredAbility, 17);
    assert.equal(activated.abilityActiveMs[17], 300);
    assert.equal(activated.abilitySpawn.remainingMs, 6000);
});

test("entity-hit records trigger an armed mine through the entity system", () => {
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true };
    const bot = { id: "attacker", slot: 2, x: 500, y: 500, size: 50, hp: 100, entityHitIds: [mine.id] };
    const result = tickAbilityEntityWorld({
        entities: [mine], projectiles: [], bots: [bot],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].type, "mineExplosion");
    assert.equal(result.entities[0].visibleMs, 300);
});

test("lock-on does not count as an attack that triggers a proximity mine", () => {
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true };
    const lockOnBot = { id: "attacker", slot: 2, x: 500, y: 500, size: 50, hp: 100, triggeredAbility: 20 };
    const result = tickAbilityEntityWorld({
        entities: [mine], projectiles: [], bots: [lockOnBot],
        stepMs: 50, width: 1000, height: 800,
    }, { ...noDamageCombat, abilityHitsTarget });

    assert.equal(result.entities[0].type, "proximityMine");
    assert.equal(result.entities[0].armed, true);
});

test("proximity mine triggers and damages within its increased radius", () => {
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true };
    const bot = { id: "target", slot: 2, x: 180, y: 100, size: 50, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [mine], projectiles: [], bots: [bot],
        stepMs: 50, width: 1000, height: 800,
    }, noDamageCombat);

    assert.equal(result.entities[0].type, "mineExplosion");
    assert.equal(result.entities[0].size, 175);
    assert.equal(result.bots[0].hp, 75);
});

test("an untriggered proximity mine advances once without duplicating", () => {
    const mine = entityFor({ id: "owner", slot: 1, x: 100, y: 400, rotation: 0 }, 11);
    const world = { entities: [mine], projectiles: [], bots: [{ id: "target", slot: 2, x: 800, y: 700, size: 50, hp: 100 }], stepMs: 100, width: 1000, height: 800 };
    const first = tickAbilityEntityWorld(world, noDamageCombat);
    assert.equal(first.entities.length, 1);
    assert.equal(first.entities[0].id, mine.id);
    assert.equal(first.entities[0].traveled, 22);
    assert.notEqual(first.entities[0].y, mine.y);

    const second = tickAbilityEntityWorld({ ...world, entities: first.entities }, noDamageCombat);
    assert.equal(second.entities.length, 1);
    assert.equal(second.entities[0].traveled, 44);
});

test("proximity mine transitions from travel to armed phase within one duration", () => {
    const mine = entityFor({ id: "owner", slot: 1, x: 100, y: 400, rotation: 0 }, 11);
    let world = {
        entities: [mine],
        projectiles: [],
        bots: [{ id: "target", slot: 2, x: 800, y: 700, size: 50, hp: 100 }],
        stepMs: 100,
        width: 1000,
        height: 800,
    };
    for (let tick = 0; tick < 8; tick += 1) {
        world = { ...world, ...tickAbilityEntityWorld(world, noDamageCombat) };
    }

    assert.equal(world.entities.length, 1);
    assert.equal(world.entities[0].armed, true);
    assert.equal(world.entities[0].traveled, 176);
    assert.equal(world.entities[0].ageMs, 800);
    assert.equal(world.entities[0].remainingMs, 20_000);

    const armed = tickAbilityEntityWorld(world, noDamageCombat);
    assert.equal(armed.entities[0].remainingMs, 19_900);
    assert.equal(armed.entities[0].traveled, 176);
});

test("persistent ability entity age advances by one fixed tick and never resets", () => {
    const singularity = entityFor({ id: "owner", slot: 1, x: 500, y: 400 }, 27);
    const world = {
        entities: [singularity],
        bots: [],
        stepMs: 100,
        width: 1000,
        height: 800,
    };

    const first = tickAbilityEntityWorld(world, noDamageCombat);
    assert.equal(first.entities[0].ageMs, 100);
    assert.equal(first.entities[0].components.lifetime.ageMs, 100);

    const second = tickAbilityEntityWorld({ ...world, entities: first.entities }, noDamageCombat);
    assert.equal(second.entities[0].ageMs, 200);
    assert.equal(second.entities[0].components.lifetime.ageMs, 200);
});

test("gravity zone transitions through declarative phases even when it cannot translate", () => {
    const owner = { id: "owner", slot: 1, x: 500, y: 400, size: 60, rotation: 0 };
    const gravity = { ...entityFor(owner, 14), velocityX: 0, velocityY: 0, traveled: 0 };
    let world = {
        entities: [gravity],
        bots: [],
        stepMs: 100,
        width: 1000,
        height: 800,
    };

    for (let tick = 0; tick < 19; tick += 1) {
        const result = tickAbilityEntityWorld(world, noDamageCombat);
        world = { ...world, entities: result.entities, bots: result.bots };
        assert.equal(world.entities[0].armed, false);
        assert.equal(world.entities[0].phaseId, "travel");
        assert.equal(world.entities[0].phaseTimerMs, (tick + 1) * 100);
    }
    assert.equal(world.entities[0].traveled, 0);

    const stopped = tickAbilityEntityWorld(world, noDamageCombat);
    assert.equal(stopped.entities[0].armed, false);
    assert.equal(stopped.entities[0].phaseId, "fuse");
    assert.equal(stopped.entities[0].phaseTimerMs, 0);
    assert.equal(stopped.entities[0].velocityX, 0);
    assert.equal(stopped.entities[0].velocityY, 0);
});

test("entity projectile ranges match duration times fixed-step displacement", () => {
    assert.equal(ABILITY_STATS[5].range, ABILITY_STATS[5].speed * ABILITY_STATS[5].durationMs / 100);
    assert.equal(ABILITY_STATS[18].range, ABILITY_STATS[18].speedPerTick * ABILITY_STATS[18].durationMs / 100);
    assert.equal(ABILITY_STATS[28].range, ABILITY_STATS[28].speedPerTick * ABILITY_STATS[28].durationMs / 100);
});

test("status effects are accumulated before the bot hp snapshot is returned", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        statusEffects: [damageStatus("burn", 1000, 50, 2), damageStatus("bleed", 1000, 50, 2)],
    };
    const result = tickBotStatus(bot, 50, noDamageCombat.applyDamageToShape);
    assert.equal(result.hp, 96);
    assert.equal(statusRemainingMs(result, "burn"), 950);
    assert.equal(statusRemainingMs(result, "bleed"), 950);
});

test("DOT, direct damage, and healing on one tick resolve as one net hp change", () => {
    const bot = {
        hp: 50, maxHp: 100, abilities: [], pendingHealing: 15,
        statusEffects: [damageStatus("burn", 1000, 50, 2), damageStatus("bleed", 1000, 50, 2)],
    };
    const afterDots = tickBotStatus(bot, 50, applyDamageToShape);
    const afterDirectHit = applyDamageToShape(afterDots, 8);
    const result = settlePendingHealing(afterDirectHit);
    assert.equal(result.hp, 53);
    assert.equal(result.damageTakenThisTick, 12);
});

test("successful damage advances the renderer hit event for consecutive hits", () => {
    const first = applyDamageToShape({ hp: 100, maxHp: 100 }, 10);
    const second = applyDamageToShape(first, 10);
    assert.equal(first.hitParticleEvent, 1);
    assert.equal(second.hitParticleEvent, 2);
});

test("burn and bleed discard a pending tick when duration expires first", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        statusEffects: [damageStatus("burn", 100, 200, 2), damageStatus("bleed", 100, 200, 2)],
    };
    const result = tickBotStatus(bot, 200, noDamageCombat.applyDamageToShape);
    assert.equal(result.hp, 100);
    assert.equal(statusRemainingMs(result, "burn"), 0);
    assert.equal(statusRemainingMs(result, "bleed"), 0);
});

test("burn and bleed apply a final tick due exactly at expiration", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        statusEffects: [damageStatus("burn", 100, 100, 2), damageStatus("bleed", 100, 100, 2)],
    };
    assert.equal(tickBotStatus(bot, 100, noDamageCombat.applyDamageToShape).hp, 96);
});

test("another heavy slash refreshes bleed duration without resetting its pending tick", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const defender = {
        id: "target", x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100,
        statusEffects: [damageStatus("bleed", 4000, 300, 2)],
    };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 70);
    assert.equal(statusRemainingMs(hit, "bleed"), 5000);
    assert.equal(statusEffectFor(hit, "bleed").tickMs, 300);
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
    assert.equal(statusRemainingMs(hit, "hit-stagger"), 300);

    const refreshed = applyDamageToShape({ ...hit, hp: 69, statusEffects: [status("hit-stagger", 100)] }, 1, attacker);
    assert.equal(statusRemainingMs(refreshed, "hit-stagger"), 300);
    const repeated = applyDamageToShape({ ...refreshed, hp: 68 }, 1, attacker);
    assert.equal(statusRemainingMs(repeated, "hit-stagger"), 300);
});

test("roster combat damages opposing teams without damaging a nearby teammate", () => {
    const attacker = {
        id: "attacker", slot: 1, teamNumber: 1, x: 100, y: 100, size: 60,
        rotation: 90, hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 7,
    };
    const teammate = {
        id: "teammate", slot: 2, teamNumber: 1, x: 150, y: 100, size: 60,
        rotation: 270, hp: 100, maxHp: 100,
    };
    const opponent = {
        id: "opponent", slot: 3, teamNumber: 2, x: 150, y: 100, size: 60,
        rotation: 270, hp: 100, maxHp: 100,
    };

    const [, nextTeammate, nextOpponent] = resolveTriggeredAbilityCombatForRoster([
        attacker,
        teammate,
        opponent,
    ]);

    assert.equal(nextTeammate.hp, 100);
    assert.equal(nextOpponent.hp, 70);
});

test("damage is never absorbed by stale retired Block state", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const hit = resolveAbilityCombat(attacker, { id: "blocked", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, abilityCharges: { 2: 25 }, abilities: [2] })[1];
    assert.equal(hit.hp, 70);
    assert.equal(hit.abilityCharges[2], 25);
    assert.equal(hit.abilityActiveMs[2], 1);
    assert.equal(statusRemainingMs(hit, "hit-stagger"), 300);
    const immune = applyDamageToShape({ id: "immune", slot: 2, hp: 100, maxHp: 100, statusEffects: [status("absolute-guard", 100)] }, 20, attacker);
    assert.equal(statusRemainingMs(immune, "hit-stagger"), 0);
    const zero = applyDamageToShape({ id: "zero", slot: 2, hp: 100, maxHp: 100 }, 0, attacker);
    assert.equal(statusRemainingMs(zero, "hit-stagger"), 0);
    const withoutCharges = applyDamageToShape({ id: "without-charges", slot: 2, hp: 100, maxHp: 100 }, 3, attacker);
    assert.equal(withoutCharges.hp, 97);
    assert.equal(statusRemainingMs(withoutCharges, "hit-stagger"), 300);
    const partiallyReduced = applyDamageToShape({ ...withoutCharges, hp: 100 }, 8, attacker);
    assert.equal(partiallyReduced.hp, 92);
    assert.equal(statusRemainingMs(partiallyReduced, "hit-stagger"), 300);
});

test("hit stagger scales allocated movement and rotation for exactly three 100 ms ticks", () => {
    const action = { dx: 1, dy: 0, dRot: 1 };
    const base = { id: "target", slot: 2, x: 100, y: 100, size: 60, hp: 100, maxHp: 100, moveSpeed: 12, movementVelocityX: 12, movementVelocityY: 0 };
    const normal = applyBotAction(base, action, 100, applyDamageToShape);
    const staggered = applyBotAction({ ...base, statusEffects: [status("hit-stagger", 300, { effects: [{ type: "movement_modifier", mode: "constant", movementMultiplier: .85, rotationMultiplier: .85 }] })] }, action, 100, applyDamageToShape);
    assert.equal(normal.x, 112);
    assert.equal(staggered.x, 110.2);
    assert.equal(normal.rotation, 12);
    assert.ok(Math.abs(staggered.rotation - 10.2) < 1e-9);
    assert.equal(statusRemainingMs(staggered, "hit-stagger"), 200);

    let ticking = { ...base, statusEffects: [status("hit-stagger", 300, { effects: [{ type: "movement_modifier", mode: "constant", movementMultiplier: .85, rotationMultiplier: .85 }] })] };
    for (let index = 0; index < 3; index += 1) ticking = applyBotAction(ticking, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(statusRemainingMs(ticking, "hit-stagger"), 0);
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

test("Dash exposes recovery only after its active phase ends", () => {
    const dashBase = {
        ...base,
        x: 200,
        abilities: [19],
        abilityCooldowns: { 19: 0 },
        abilityCharges: {},
        abilityActiveMs: {},
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 19, targetX: 400, targetY: 100 } };
    const first = applyBotAction(dashBase, action, 100, applyDamageToShape);
    assert.equal(first.x, 275);
    assert.equal(first.abilityCharges[19], undefined);
    assert.equal(first.abilityCooldowns[19], 0);
    assert.equal(first.abilityPendingCooldownMs[19], 1300);

    const blocked = applyBotAction({ ...first, dashActiveMs: 0, dashRemaining: 0 }, action, 100, applyDamageToShape);
    assert.equal(blocked.triggeredAbility, null);
    assert.equal(blocked.abilityCharges[19], undefined);

    const activeBoundary = applyBotAction({ ...first, dashActiveMs: 0, dashRemaining: 0, abilityCooldowns: { 19: 0 }, abilityPendingCooldownMs: { 19: 100 }, abilityActiveMs: { 19: 100 } }, action, 100, applyDamageToShape);
    assert.equal(activeBoundary.triggeredAbility, null);
    assert.equal(activeBoundary.abilityActiveMs[19], 0);
    assert.equal(activeBoundary.abilityCooldowns[19], 100);
    assert.equal(activeBoundary.abilityPendingCooldownMs[19], undefined);

    const cooldownEnded = tickBotState(activeBoundary, 100, applyDamageToShape);
    assert.equal(cooldownEnded.abilityCooldowns[19], 0);
    const boundary = applyBotAction({ ...cooldownEnded, dashActiveMs: 0, dashRemaining: 0 }, action, 100, applyDamageToShape);
    assert.equal(boundary.triggeredAbility, 19);
    assert.equal(boundary.abilityCooldowns[19], 0);
    assert.equal(boundary.abilityPendingCooldownMs[19], 1300);
    assert.equal(boundary.abilityCharges[19], undefined);
});

test("declared spawned abilities resolve through normalized entity contracts", () => {
    const bot = { id: "owner", slot: 1, x: 100, y: 200, size: 60, rotation: 90, attackDamageMultiplier: 1 };
    const spawnedAbilities = [4, 5, 11, 14, 15, 17, 18, 21, 22, 24, 27, 28, 29, 31];
    for (const abilityId of spawnedAbilities) {
        const contract = entityContractForAbility(abilityId);
        const entity = createAbilityEntity(bot, abilityId, {
            targetX: 300,
            targetY: 400,
            clamp: (value) => value,
        });
        assert.ok(contract, `missing entity contract for ${abilityId}`);
        assert.ok(entity, `missing entity payload for ${abilityId}`);
        assert.equal(entity.abilityId, abilityId);
        assert.equal(contract.abilityId, abilityId);
        assert.equal(entity.entityContractId, abilityId);
        assert.equal(entity.type, contract.runtimeType);
        assert.ok(entity.components.transform);
        assert.ok(entity.components.motion);
        assert.ok(entity.components.lifetime);
    }
    assert.equal(isProjectileEntity(createAbilityEntity(bot, 4)), true);
    assert.equal(isProjectileEntity(createAbilityEntity(bot, 5)), true);
    assert.equal(isProjectileEntity(createAbilityEntity(bot, 18)), false);
    assert.equal(ENTITY_CONTRACTS.grenade, undefined);
});

test("Gun waits for the next tick after its active boundary", () => {
    const gun = {
        ...base,
        abilities: [3],
        abilityCooldowns: { 3: 0 },
        abilityCharges: { 3: 5 },
        abilityRechargeMs: { 3: 0 },
        abilityActiveMs: { 3: 100 },
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 3 } };
    const fired = applyBotAction(gun, action, 100, applyDamageToShape);
    assert.equal(fired.triggeredAbility, null);
    assert.equal(fired.abilityCooldowns[3], 0);
    assert.equal(fired.abilityActiveMs[3], 0);
    assert.equal(fired.abilityCharges[3], 5);

    const nextTick = applyBotAction(fired, action, 100, applyDamageToShape);
    assert.equal(nextTick.triggeredAbility, 3);
    assert.equal(nextTick.abilityCooldowns[3], 0);
    assert.equal(nextTick.abilityPendingCooldownMs[3], 1000);
    assert.equal(nextTick.abilityActiveMs[3], 500);
    assert.equal(nextTick.abilityCharges[3], 4);
    assert.equal(fired.abilityRechargeMs[3], 0);
});

test("Fireball holds recovery through its active window and starts it afterward", () => {
    const bot = {
        ...base,
        abilities: [5],
        abilityCooldowns: { 5: 0 },
        abilityCharges: { 5: 4 },
        abilityRechargeMs: { 5: 0 },
        abilityActiveMs: {},
    };
    const fired = applyBotAction(bot, { abilityAction: { action: 5 } }, 100, applyDamageToShape);
    assert.equal(fired.triggeredAbility, 5);
    assert.equal(fired.abilityActiveMs[5], 500);
    assert.equal(fired.abilityCooldowns[5], 0);
    assert.equal(fired.abilityPendingCooldownMs[5], 300);

    const active = tickBotState(fired, 400, applyDamageToShape);
    assert.equal(active.abilityActiveMs[5], 100);
    assert.equal(active.abilityCooldowns[5], 0);
    assert.equal(active.abilityPendingCooldownMs[5], 300);
    const recoveryStarted = tickBotState(active, 100, applyDamageToShape);
    assert.equal(recoveryStarted.abilityActiveMs[5], 0);
    assert.equal(recoveryStarted.abilityCooldowns[5], 300);
    assert.equal(recoveryStarted.abilityPendingCooldownMs[5], undefined);
    const nearlyReady = tickBotState(recoveryStarted, 200, applyDamageToShape);
    assert.equal(nearlyReady.abilityCooldowns[5], 100);
    const ready = tickBotState(nearlyReady, 100, applyDamageToShape);
    assert.equal(ready.abilityCooldowns[5], 0);
});

test("Fireball reload waits until its active window ends after the final charge", () => {
    const bot = {
        ...base,
        abilities: [5],
        abilityCooldowns: { 5: 0 },
        abilityCharges: { 5: 1 },
        abilityRechargeMs: { 5: 0 },
        abilityActiveMs: {},
    };
    const fired = applyBotAction(bot, { abilityAction: { action: 5 } }, 100, applyDamageToShape);
    assert.equal(fired.abilityCharges[5], 0);
    assert.equal(fired.abilityCooldowns[5], 0);
    assert.equal(fired.abilityRechargeMs[5], 5_000);

    const active = tickBotState(fired, 400, applyDamageToShape);
    assert.equal(active.abilityActiveMs[5], 100);
    assert.equal(active.abilityRechargeMs[5], 5_000);

    const activeEnded = tickBotState(active, 100, applyDamageToShape);
    assert.equal(activeEnded.abilityActiveMs[5], 0);
    assert.equal(activeEnded.abilityRechargeMs[5], 5_000);

    const reloading = tickBotState(activeEnded, 100, applyDamageToShape);
    assert.equal(reloading.abilityRechargeMs[5], 4_900);
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
    assert.equal(activated.abilityCooldowns[20], 0);
    assert.equal(activated.abilityPendingCooldownMs[20], 9_800);
    assert.equal(activated.abilityActiveMs[20], 200);

    const ready = tickBotState(activated, 10_000, applyDamageToShape);
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
    const projectile = tickProjectileWorld({ bots: [owner, target], entities: [fireball], stepMs: 50, width: 1000, height: 800 }, { applyDamageToShape, applyDamageFromShapes });
    assert.equal(statusRemainingMs(projectile.bots[1], "hit-stagger"), 300);

    const slashAttacker = { id: "slash-owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const [, bleeding] = resolveAbilityCombat(slashAttacker, { id: "bleeding", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 });
    const bleedTick = tickBotStatus(bleeding, 1000, applyDamageToShape);
    assert.equal(bleedTick.hp, 68);
    assert.equal(statusRemainingMs(bleedTick, "hit-stagger"), 300);
});

test("Concussive Shot remains independent and wins the combined movement multiplier", () => {
    assert.equal(CONCUSSIVE_SHOT_SLOW_DURATION_MS, 1000);
    assert.equal(CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER, 0.50);
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 9 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, target);
    assert.equal(hit.hp, 80);
    assert.equal(statusRemainingMs(hit, "slow"), 1000);
    assert.equal(statusRemainingMs(hit, "hit-stagger"), 300);

    const moved = applyBotAction({ ...hit, x: 200, moveSpeed: 10, movementVelocityX: 10 }, { dx: 1, dy: 0 }, 100, applyDamageToShape);
    assert.equal(moved.x, 205);
    assert.equal(statusRemainingMs(moved, "slow"), 900);
    assert.equal(statusRemainingMs(moved, "hit-stagger"), 200);
    const ordinaryHit = applyDamageToShape({ ...moved, hp: 80, statusEffects: [status("slow", 1000)] }, 1, attacker);
    assert.equal(statusRemainingMs(ordinaryHit, "slow"), 1000);
});

test("damage to an arena entity does not stagger either bot", () => {
    const bots = [
        { id: "owner", slot: 1, x: 100, y: 100, size: 60, hp: 100, maxHp: 100, triggeredAbility: 1 },
        { id: "target", slot: 2, x: 100, y: 100, size: 60, hp: 100, maxHp: 100 },
    ];
    const result = tickAbilityEntityWorld({
        entities: [entityFor(bots[0], 17)], projectiles: [], bots,
        stepMs: 100, width: 1000, height: 800,
    }, {
        applyDamageToShape,
        applyDamageFromShapes,
        abilityHitsTarget: () => true,
        triggeredAbilityDamage: () => 50,
        overlapsShape: () => false,
    });
    assert.equal(result.entities.length, 0);
    assert.equal(statusRemainingMs(result.bots[0], "hit-stagger"), 0);
    assert.equal(statusRemainingMs(result.bots[1], "hit-stagger"), 0);
});

test("a heavy slash damages normally while its attached bleed still applies", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, abilityCharges: { 2: 25 }, abilities: [2] };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.ok(hit.hp < 100);
    assert.equal(hit.abilityCharges[2], 25);
    assert.equal(hit.abilityActiveMs[2], 1);
    assert.equal(statusRemainingMs(hit, "bleed"), 5000);
});

test("Concussive and rail shots apply damage and attached effects without blocking", () => {
    for (const ability of [9, 13]) {
        const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, abilityCharges: { 2: 25 }, abilities: [2] };
        const [, hit] = resolveAbilityCombat(attacker, defender);
        assert.ok(hit.hp < 100, ability);
        assert.equal(hit.abilityCharges[2], 25, ability);
        if (ability === 9) {
            assert.equal(statusRemainingMs(hit, "slow"), 1000, ability);
            assert.equal(statusRemainingMs(hit, "shock"), 0, ability);
        } else {
            assert.equal(statusRemainingMs(hit, "slow"), 0, ability);
            assert.equal(statusRemainingMs(hit, "shock"), 3000, ability);
        }
    }
});

test("repulsor burst deals 20 damage and pushes 250 units without blocking", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 8 };
    const defender = { id: "target", x: 180, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 80);
    assert.equal(hit.x, 430);

    const [, staleStateHit] = resolveAbilityCombat(attacker, { ...defender, rotation: 270, abilityActiveMs: { 2: 1 }, abilityCharges: { 2: 25 }, abilities: [2] });
    assert.equal(staleStateHit.hp, 80);
    assert.equal(staleStateHit.abilityCharges[2], 25);
    assert.equal(staleStateHit.x, 430);
});

test("Frost Ring composes damage, slow, and knockback without blocking", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 26 };
    const defender = { id: "target", slot: 2, x: 180, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 90);
    assert.equal(statusRemainingMs(hit, "slow"), 1500);
    assert.equal(hit.x, 240);

    const [, staleStateHit] = resolveAbilityCombat(attacker, {
        ...defender,
        rotation: 270,
        abilityActiveMs: { 2: 1 },
        abilityCharges: { 2: 25 },
        abilities: [2],
    });
    assert.equal(staleStateHit.hp, 90);
    assert.equal(staleStateHit.abilityCharges[2], 25);
    assert.equal(statusRemainingMs(staleStateHit, "slow"), 1500);
    assert.equal(staleStateHit.x, 240);
});

test("Singularity pulls during its fuse and applies one generic zone detonation", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, attackDamageMultiplier: 1 };
    const target = { id: "target", slot: 2, x: 300, y: 100, size: 60, hp: 100, maxHp: 100 };
    const singularity = entityFor(owner, 27, { targetX: 200, targetY: 100, clamp: (value) => value });
    let world = { entities: [singularity], bots: [target], stepMs: 100, width: 1000, height: 800 };
    for (let tick = 0; tick < 11; tick += 1) {
        const result = tickAbilityEntityWorld(world, noDamageCombat);
        world = { ...world, entities: result.entities, bots: result.bots };
    }
    assert.ok(world.bots[0].x < 300);
    assert.equal(world.bots[0].hp, 100);

    const detonated = tickAbilityEntityWorld(world, noDamageCombat);
    assert.ok(detonated.bots[0].hp < 100);
    assert.equal(detonated.entities[0].type, "singularityExplosion");
    const hpAfterDetonation = detonated.bots[0].hp;
    const after = tickAbilityEntityWorld({ ...world, entities: detonated.entities, bots: detonated.bots }, noDamageCombat);
    assert.equal(after.bots[0].hp, hpAfterDetonation);
});

test("Orbital Strike winds up for five ticks and pulses four times for flat damage", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, attackDamageMultiplier: 1 };
    const target = { id: "target", slot: 2, x: 200, y: 100, size: 60, hp: 100, maxHp: 100 };
    const orbital = entityFor(owner, 22, { targetX: 200, targetY: 100, clamp: (value) => value });
    assert.equal(orbital.remainingMs, 1500);
    assert.equal(orbital.intervalTimerMs, 0);
    assert.equal(ABILITY_STATS[22].windupMs, 500);
    assert.equal(ABILITY_STATS[22].activeMs, 0);
    assert.equal(ABILITY_STATS[22].durationMs, 1500);
    assert.equal(damageAtDistance(22, 0), 15);
    assert.equal(damageAtDistance(22, 100), 15);

    let world = { entities: [orbital], bots: [target], stepMs: 100, width: 1000, height: 800 };
    const pulseTicks = [];
    for (let tick = 0; tick < 16; tick += 1) {
        const beforeHp = world.bots[0].hp;
        const result = tickAbilityEntityWorld(world, noDamageCombat);
        if (result.bots[0].hp < beforeHp) pulseTicks.push(tick);
        world = { ...world, entities: result.entities, bots: result.bots };
    }

    assert.deepEqual(pulseTicks, [0, 4, 9, 14]);
    assert.equal(world.bots[0].hp, 40);
    assert.equal(world.entities.some((entity) => entity.type === "orbitalExplosion"), true);
    assert.equal(world.entities.some((entity) => entity.type === "orbitalMarker"), false);
});

test("wind burst is a five-tick projectile with 15 damage and 150 knockback", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1 };
    const projectile = entityFor(attacker, 18);
    assert.equal(projectile.type, "windburstProjectile");
    assert.equal(ABILITY_STATS[18].knockback, 150);
    assert.equal(ABILITY_CONTRACTS[18].effects.find((effect) => effect.type === EFFECT_TYPES.KNOCKBACK).distance, 150);
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
    assert.equal(hit.bots[1].x, 360);
    assert.equal(hit.entities.length, 0);
});

test("absolute guard rejects damage, statuses, and displacement without changing stale state", () => {
    const guarded = {
        id: "target", slot: 2, x: 180, y: 100, size: 60, rotation: 180,
        hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, statusEffects: [status("absolute-guard", 1000)], abilityCharges: { 2: 25 },
    };
    assert.equal(applyDamageToShape(guarded, 50), guarded);

    for (const ability of [7, 13, 9, 8, 18]) {
        const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const [, result] = resolveAbilityCombat(attacker, guarded);
        assert.equal(result.hp, 100, ability);
        assert.equal(result.x, 180, ability);
        assert.equal(result.abilityCharges[2], 25, ability);
        assert.equal(statusRemainingMs(result, "bleed"), 0, ability);
        assert.equal(statusRemainingMs(result, "shock"), 0, ability);
        assert.equal(statusRemainingMs(result, "slow"), 0, ability);
    }
});

test("absolute guard rejects persistent entity zones, pulses, mines, and strikes", () => {
    const guarded = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, statusEffects: [status("absolute-guard", 1000)] };
    const arena = { bots: [guarded], projectiles: [], stepMs: 100, width: 1000, height: 1000 };

    const silence = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 15);
    const silenced = tickAbilityEntityWorld({ ...arena, entities: [silence] }, noDamageCombat).bots[0];
    assert.equal(statusRemainingMs(silenced, "silence"), 0);
    assert.equal(statusRemainingMs(silenced, "stun"), 0);

    const gravity = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 14), x: 100, y: 100, traveled: 176, fuseMs: 1000 };
    const pulled = tickAbilityEntityWorld({ ...arena, entities: [gravity] }, noDamageCombat).bots[0];
    assert.equal(pulled.x, 150);
    assert.equal(pulled.y, 100);

    const zone = entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 24, { targetX: 150, targetY: 100, clamp: (value) => value });
    const zoned = tickAbilityEntityWorld({ ...arena, entities: [zone] }, noDamageCombat).bots[0];
    assert.equal(statusIsActive(zoned, "silence"), false);

    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true };
    const orbital = { ...entityFor({ id: "owner", slot: 1 }, 22, { targetX: 150, targetY: 100, clamp: (value) => value }), fuseMs: 100 };
    const struck = tickAbilityEntityWorld({ ...arena, entities: [mine, orbital] }, noDamageCombat).bots[0];
    assert.equal(struck.hp, 100);
});

test("retired Block cannot activate or create a charge resource", () => {
    const bot = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, abilities: [], abilityCooldowns: {}, abilityActiveMs: {}, abilityCharges: {} };
    const next = applyBotAction(bot, { abilityAction: { action: 2 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(next.triggeredAbility ?? null, null);
    assert.equal(next.abilityActiveMs[2], undefined);
    assert.equal(next.abilityCooldowns[2], undefined);
    assert.equal(ABILITY_STATS[2], undefined);
});

test("bot resources and lifecycle advance through their own generic component contracts", () => {
    const bot = {
        hp: 100,
        abilityCooldowns: { 3: 100 },
        abilityActiveMs: { 3: 100 },
        abilityCharges: { 3: 8 },
        abilityRechargeMs: { 3: 0 },
        matchElapsedMs: 50,
        hitFlashMs: 100,
        abilityVisual: { ability: 3, ms: 100 },
        triggeredAbility: 3,
        abilitySpawn: { id: "spawned" },
        entityHitIds: ["target"],
        damageTakenThisTick: 12,
    };

    const resourced = tickBotResources(bot, 50);
    assert.equal(resourced.abilityCooldowns[3], 0);
    assert.equal(resourced.abilityPendingCooldownMs[3], 100);
    assert.equal(resourced.abilityActiveMs[3], 50);
    assert.equal(resourced.matchElapsedMs, 50);

    const lifecycled = tickBotLifecycle(resourced, 50);
    assert.equal(lifecycled.matchElapsedMs, 100);
    assert.equal(lifecycled.hitFlashMs, 50);
    assert.equal(lifecycled.abilityVisual.ms, 50);
    assert.equal(lifecycled.triggeredAbility, null);
    assert.equal(lifecycled.abilitySpawn, null);
    assert.deepEqual(lifecycled.entityHitIds, []);
    assert.equal(lifecycled.damageTakenThisTick, 0);
});

test("null zone silence is presence-based while silence pulse remains timed", () => {
    const zone = entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 24, { targetX: 300, targetY: 300, clamp: (value) => value });
    const inside = { id: "target", slot: 2, x: 300, y: 300, size: 60, hp: 100, statusEffects: [] };
    const inZone = tickAbilityEntityWorld({ entities: [zone], bots: [inside], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(statusIsActive(inZone.bots[0], "silence"), true);
    assert.equal(statusRemainingMs(inZone.bots[0], "silence"), 0);

    const movedOut = { ...inZone.bots[0], x: 800, y: 700 };
    const outOfZone = tickAbilityEntityWorld({ entities: inZone.entities, bots: [movedOut], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(statusIsActive(outOfZone.bots[0], "silence"), false);
    assert.equal(statusRemainingMs(outOfZone.bots[0], "silence"), 0);
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

test("Basic Heal applies 25 self-healing and respects the HP cap", () => {
    const attacker = {
        id: "main", x: 100, y: 100, rotation: 0, hp: 90, maxHp: 100,
        triggeredAbility: 10,
    };
    const opponentShape = { id: "opponent", x: 900, y: 900, rotation: 180, hp: 100, maxHp: 100, size: 60 };
    const [activated, opponent] = resolveAbilityCombat(attacker, opponentShape);

    assert.deepEqual(opponent, opponentShape);
    assert.equal(activated.abilityVisual.ability, 10);
    assert.equal(activated.pendingHealing, 25);
    assert.equal(settlePendingHealing(activated).hp, 100);
    assert.equal(ABILITY_STATS[10].cooldownMs, 11700);
    assert.equal(ABILITY_STATS[10].windupMs, 800);
});

test("Siphon Lance heals its source only after confirmed HP damage", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 90, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 32 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [hitAttacker, hitTarget] = resolveAbilityCombat(attacker, target);
    assert.equal(hitTarget.hp, 76);
    assert.equal(settlePendingHealing(hitAttacker).hp, 100);

    const [missAttacker] = resolveAbilityCombat(attacker, { ...target, x: 100, y: 300 });
    assert.equal(missAttacker.pendingHealing ?? 0, 0);

    const [staleStateAttacker, staleStateTarget] = resolveAbilityCombat(attacker, {
        ...target,
        rotation: 270,
        abilityActiveMs: { 2: 1 },
        abilityCharges: { 2: 25 },
        abilities: [2],
    });
    assert.equal(staleStateTarget.hp, 76);
    assert.equal(settlePendingHealing(staleStateAttacker).hp, 100);
});

test("defensive and status abilities use preparation plus status duration, not active time", () => {
    const cast = (abilityId) => {
        let bot = {
            id: `caster-${abilityId}`, slot: 1, x: 100, y: 100, size: 60, rotation: 0,
            hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
            attackDamageMultiplier: 1, abilities: [abilityId],
            abilityCooldowns: { [abilityId]: 0 }, abilityActiveMs: {},
        };
        for (let tick = 0; tick < 5; tick += 1) {
            bot = applyBotAction(bot, { abilityAction: { action: abilityId } }, 100,
                noDamageCombat.applyDamageToShape);
        }
        return bot;
    };

    const reactiveArmorCast = cast(16);
    assert.equal(reactiveArmorCast.triggeredAbility, 16);
    assert.equal(reactiveArmorCast.abilityActiveMs[16], 0);
    const [reactiveArmor] = resolveAbilityCombat(reactiveArmorCast, null);
    assert.equal(statusRemainingMs(reactiveArmor, "reactive-armor"), 4000);
    assert.equal(applyDamageToShape({ ...reactiveArmor, hp: 100 }, 20, { slot: 2 }).hp, 90);
    const [reflected] = applyDamageFromShapes(
        { id: "attacker", slot: 2, hp: 100, maxHp: 100 },
        { ...reactiveArmor, hp: 100 },
        20,
    );
    assert.equal(reflected.hp, 90);

    const absoluteGuardCast = cast(23);
    assert.equal(absoluteGuardCast.triggeredAbility, 23);
    assert.equal(absoluteGuardCast.abilityActiveMs[23], 0);
    const [absoluteGuard] = resolveAbilityCombat(absoluteGuardCast, null);
    assert.equal(statusRemainingMs(absoluteGuard, "absolute-guard"), 1500);
    assert.equal(applyDamageToShape({ ...absoluteGuard, hp: 100 }, 20, { slot: 2 }).hp, 100);

    const orbitalCast = cast(22);
    assert.equal(orbitalCast.triggeredAbility, 22);
    assert.equal(orbitalCast.abilityActiveMs[22], 0);
    assert.equal(orbitalCast.abilitySpawn.remainingMs, 1500);

    let nullZoneCast = {
        id: "caster-24", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [24],
        abilityCooldowns: { 24: 0 }, abilityActiveMs: {},
    };
    for (let tick = 0; tick < 15; tick += 1) {
        nullZoneCast = applyBotAction(nullZoneCast, { abilityAction: { action: 24, targetX: 300, targetY: 300 } }, 100,
            noDamageCombat.applyDamageToShape);
    }
    assert.equal(nullZoneCast.triggeredAbility, 24);
    assert.equal(nullZoneCast.abilityActiveMs[24], 300);
    assert.equal(nullZoneCast.abilitySpawn.remainingMs, 5000);

    const overclockCast = cast(33);
    assert.equal(overclockCast.triggeredAbility, 33);
    assert.equal(overclockCast.abilityActiveMs[33], 0);
    const [overclock] = resolveAbilityCombat(overclockCast, null);
    assert.equal(statusRemainingMs(overclock, "overclock"), 4000);
});

test("the global ability lock includes preparation, not only active time", () => {
    const preparing = { preparingAbility: 16, abilityActiveMs: {} };
    assert.equal(anotherAbilityActive(preparing, 34), true);
    assert.equal(anotherAbilityActive(preparing, 16), false);

    assert.equal(anotherAbilityActive({ abilityActiveMs: { 19: 200 } }, 34), true);
    assert.equal(anotherAbilityActive({ abilityActiveMs: { 34: 200 } }, 19), true);
    assert.equal(anotherAbilityActive({ abilityActiveMs: { 5: 200 } }, 34), true);
});

test("Overclock applies a non-stacking timed buff for cooldown recovery", () => {
    const attacker = {
        id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, triggeredAbility: 33,
    };
    const [active] = resolveAbilityCombat(attacker, null);
    assert.equal(statusRemainingMs(active, "overclock"), 4000);
    assert.equal(statusEffectFor(active, "overclock").effects[0].multiplier, 0.5);

    const ticked = tickBotState({
        ...active,
        abilityCooldowns: { 1: 1000 },
        abilityActiveMs: { 33: 3000 },
    }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(ticked.abilityCooldowns[1], 900);
    assert.equal(statusRemainingMs(ticked, "overclock"), 3900);

    const accelerated = applyBotAction({
        ...active,
        abilities: [33, 34],
        abilityCooldowns: { 33: 0, 34: 0 },
        abilityActiveMs: { 33: 0 },
        attackSpeedMultiplier: 1,
    }, { abilityAction: { action: 34 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(accelerated.triggeredAbility, 34);
    assert.equal(accelerated.abilityCooldowns[34], 0);
    assert.equal(accelerated.abilityPendingCooldownMs[34], 250);

    const [refreshed] = resolveAbilityCombat({
        ...active,
        statusEffects: [status("overclock", 2000, { effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }] })],
        triggeredAbility: 33,
    }, null);
    assert.equal(statusRemainingMs(refreshed, "overclock"), 4000);
    assert.equal(statusEffectFor(refreshed, "overclock").effects[0].multiplier, 0.5);
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

test("slash keeps its full visual timer through the activation step", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [1], abilityCooldowns: { 1: 0 }, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 1 } }, 100, noDamageCombat.applyDamageToShape);
    assert.equal(active.abilityActiveMs[1], 400);
    assert.equal(sweepAngle(active.abilityActiveMs[1], 400, -60, 60), -60);
    assert.equal(active.triggeredAbility, 1);
});

test("slash hit resolves only on its activation tick while its animation continues", () => {
    const defender = { x: 190, y: 100, size: 20 };
    assert.equal(abilityHitsTarget({ x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] }, defender), true);
    assert.equal(abilityHitsTarget({ x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: null, abilities: [1] }, defender), false);
});

test("slash hitbox matches the inclusive 120-degree, 92-unit sweep", () => {
    const attacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] };
    for (const offset of [-60, 60]) assert.equal(abilityHitsTarget(attacker, targetAtBearing(attacker, 80, attacker.rotation + offset)), true, `at ${offset} degrees`);
    for (const offset of [-60.1, 60.1]) assert.equal(abilityHitsTarget(attacker, targetAtBearing(attacker, 80, attacker.rotation + offset)), false, `outside ${offset} degrees`);
});

test("Basic Strike reaches the executor with its 5-damage, 80-range, 60-degree hitbox", () => {
    const attacker = {
        id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 150, maxHp: 150, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [34], abilityCooldowns: { 34: 0 },
        abilityActiveMs: {},
    };
    const fired = applyBotAction(attacker, { abilityAction: { action: 34 } }, 100, applyDamageToShape);
    assert.equal(fired.triggeredAbility, 34);
    assert.equal(fired.abilityActiveMs[34], 200);
    assert.equal(fired.abilityCooldowns[34], 0);
    assert.equal(fired.abilityPendingCooldownMs[34], 500);

    const centeredTarget = { id: "center", ...targetAtBearing(attacker, 60, attacker.rotation, 60), hp: 150, maxHp: 150 };
    assert.equal(resolveAbilityCombat(fired, centeredTarget)[1].hp, 145);
    for (const offset of [-30, 30]) {
        assert.equal(abilityHitsTarget(fired, targetAtBearing(attacker, 60, attacker.rotation + offset, 60)), true, `at ${offset} degrees`);
    }
    for (const offset of [-30.1, 30.1]) {
        assert.equal(abilityHitsTarget(fired, targetAtBearing(attacker, 60, attacker.rotation + offset, 60)), false, `outside ${offset} degrees`);
    }
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

    for (const ability of [7, 34]) {
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

test("direct melee hitboxes sweep across a moving defender", () => {
    const attacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 34, abilities: [34] };
    const defender = {
        x: 300, y: 100, size: 60,
        movementStartX: 160, movementStartY: 100,
    };

    assert.equal(abilityHitsTarget(attacker, defender), true);
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
    assert.equal(stillPreparing.preparingMs, 300);
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
    assert.equal(second.preparingMs, 300);
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
    assert.equal(active.abilityCooldowns[12], 0);
    assert.equal(active.abilityPendingCooldownMs[12], 400);
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

test("Phase Strike damages normally and still teleports through stale retired state", () => {
    const attacker = {
        id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 25,
    };
    const defender = {
        id: "target", slot: 2, x: 200, y: 100, size: 60, rotation: 270,
        hp: 100, maxHp: 100, abilityActiveMs: { 2: 100 }, abilityCharges: { 2: 25 }, abilities: [2],
    };
    const [nextAttacker, hit] = resolveAbilityCombat(attacker, defender);
    assert.notEqual(nextAttacker.x, attacker.x);
    assert.equal(nextAttacker.velocityX, 0);
    assert.equal(nextAttacker.velocityY, 0);
    assert.equal(nextAttacker.movementVelocityX, 0);
    assert.equal(nextAttacker.movementVelocityY, 0);
    assert.equal(nextAttacker.movementStartX, nextAttacker.x);
    assert.equal(nextAttacker.movementStartY, nextAttacker.y);
    assert.ok(hit.hp < 100);
    assert.equal(hit.abilityCharges[2], 25);
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

test("deferred state contracts restore a snapshot and finish their presentation pulse", () => {
    const pending = {
        x: 500, y: 300, hp: 40, maxHp: 100,
        temporalRewindMs: 3000, temporalRewindPulseMs: 0,
        temporalRewindX: 100, temporalRewindY: 200, temporalRewindHp: 80,
        temporalRewindVisualX: 100, temporalRewindVisualY: 200,
    };

    const waiting = tickDeferredStates(pending, 1000);
    assert.equal(waiting.x, 500);
    assert.equal(waiting.hp, 40);
    assert.equal(waiting.temporalRewindMs, 2000);

    const restored = tickDeferredStates(waiting, 2000);
    assert.equal(restored.x, 100);
    assert.equal(restored.y, 200);
    assert.equal(restored.hp, 80);
    assert.equal(restored.temporalRewindMs, 0);
    assert.equal(restored.temporalRewindPulseMs, 400);
    assert.equal(restored.temporalRewindX, null);
    assert.equal(restored.temporalRewindY, null);

    const settled = tickDeferredStates(restored, 400);
    assert.equal(settled.temporalRewindPulseMs, 0);
    assert.equal(settled.temporalRewindVisualX, null);
    assert.equal(settled.temporalRewindVisualY, null);
});

test("health bar fill is the clamped fraction of current hp", () => {
    assert.equal(healthBarPercent(75, 100), 75);
    assert.equal(healthBarPercent(30, 120), 25);
    assert.equal(healthBarPercent(-5, 100), 0);
    assert.equal(healthBarPercent(150, 100), 100);
});

test("gun activation retains a fading ray for the active duration", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [3], abilityCharges: { 3: 10 },
        abilityCooldowns: { 3: 0 }, abilityRechargeMs: { 3: 0 }, abilityActiveMs: {},
    };
    const active = applyBotAction(bot, { abilityAction: { action: 3 } }, 50, noDamageCombat.applyDamageToShape);
    assert.equal(active.triggeredAbility, 3);
    assert.equal(active.abilityActiveMs[3], 500);
    assert.equal(abilityActiveOpacity(active, 3), 1);
    const faded = tickBotState(active, 450, noDamageCombat.applyDamageToShape);
    assert.equal(abilityActiveOpacity(faded, 3), 0.1);
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
        statusEffects: [
            status("slow", 1000),
            status("silence", 1000),
            status("silence", 0, { mode: "presence" }),
            status("stun", 1000),
            status("movement-lock", 300),
            damageStatus("shock", 3000, 1000, 3, { tickElapsedMs: 250 }),
            damageStatus("burn", 3000, 500, 2),
            damageStatus("bleed", 4000, 750, 2),
        ],
        abilityActiveMs: { 2: 1, 16: 2000 },
        temporalRewindMs: 2000, temporalRewindPulseMs: 300,
        pendingHealing: 20, preparingAbility: 13, preparingMs: 450,
        abilityCooldowns: { rail_shot: 5000 },
    };

    const dead = applyDamageToShape(bot, 10);

    assert.equal(dead.hp, 0);
    assert.deepEqual(botStatusLabels(dead), []);
    assert.deepEqual(dead.abilityActiveMs, {});
    assert.equal(statusIsActive(dead, "silence"), false);
    assert.equal(statusRemainingMs(dead, "shock"), 0);
    assert.equal(statusRemainingMs(dead, "burn"), 0);
    assert.equal(statusRemainingMs(dead, "bleed"), 0);
    assert.equal(dead.temporalRewindMs, 0);
    assert.equal(dead.pendingHealing, 0);
    assert.equal(dead.preparingAbility, 13);
    assert.equal(dead.preparingMs, 450);
    assert.equal(dead.abilityCooldowns.rail_shot, 5000);
});

test("an ALWAYS code action reaches the real fire-gun executor", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [{ priority: 1, branches: [{ id: "always-fire", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [{ action: 3 }], children: [] }] }],
    };
    const snapshot = {
        playerModel: { id: "main", x: 100, y: 100, rotation: 0, abilities: [3], abilityCooldowns: { 3: 0 }, abilityCharges: { 3: 6 }, abilityRechargeMs: { 3: 0 }, abilityActiveMs: {} },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 500, y: 100, size: 60, hp: 100 }],
    };
    const action = buildDeterministicLogicAction(configuration, snapshot);
    const bot = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [3], abilityCharges: { 3: 6 }, abilityCooldowns: { 3: 0 }, abilityRechargeMs: { 3: 0 }, abilityActiveMs: {} };
    const result = applyBotAction(bot, action, 50, noDamageCombat.applyDamageToShape);
    assert.equal(action.abilityAction.action, 3);
    assert.equal(action.abilityAction.abilityPayload.abilityId, 3);
    assert.equal(action.abilityAction.abilityPayload.execution.capture.gunRayOriginX, "x");
    assert.equal(action.abilityAction.targetX, undefined);
    assert.equal(action.abilityAction.targetY, undefined);
    assert.equal(action.gun, undefined);
    assert.equal(result.triggeredAbility, 3);
    assert.equal(result.abilityCharges[3], 5);
});

test("a global ability lock blocks a different ability until the active phase ends", () => {
    const configuration = (first, second) => ({
        version: "bot-logic-tree-v1",
        roots: [{ priority: 1, branches: [
            { id: first, branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [{ action: first }] },
            { id: second, branchType: "if", priority: 2, conditions: [{ type: "always" }], actions: [{ action: second }] },
        ] }],
    });
    const opponent = { id: "opponent-model", slot: 2, x: 600, y: 100, size: 60, hp: 100, abilities: [] };
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100,
        moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
        abilities: [5, 9], abilityCharges: { 5: 4 },
        abilityCooldowns: { 5: 0, 9: 0 }, abilityRechargeMs: { 5: 0 },
    };

    const fireballFirstAction = buildDeterministicLogicAction(configuration(5, 9), buildStatePayload([bot, opponent], "custom"));
    const afterFireball = applyBotAction(bot, fireballFirstAction, 50, noDamageCombat.applyDamageToShape);
    const concussiveNextAction = buildDeterministicLogicAction(configuration(5, 9), buildStatePayload([afterFireball, opponent], "custom"));
    const preparingAfterFireball = applyBotAction(afterFireball, concussiveNextAction, 50, noDamageCombat.applyDamageToShape);
    assert.equal(fireballFirstAction.abilityAction.action, 5);
    assert.equal(concussiveNextAction.abilityAction, null);
    assert.equal(preparingAfterFireball.preparingAbility, null);
    assert.ok(preparingAfterFireball.abilityActiveMs[5] > 0);

    let afterConcussive = bot;
    for (let tick = 0; tick < 10; tick += 1) {
        const action = buildDeterministicLogicAction(configuration(9, 5), buildStatePayload([afterConcussive, opponent], "custom"));
        afterConcussive = applyBotAction(afterConcussive, action, 50, noDamageCombat.applyDamageToShape);
    }
    const fireballAfterConcussive = buildDeterministicLogicAction(configuration(9, 5), buildStatePayload([afterConcussive, opponent], "custom"));
    assert.equal(afterConcussive.preparingAbility, null);
    assert.ok(afterConcussive.abilityPendingCooldownMs[9] > 0);
    assert.equal(fireballAfterConcussive.abilityAction, null);

    assert.ok(afterConcussive.abilityActiveMs[9] > 0);
});

test("Dash participates in the global ability lock while retaining its own cooldown", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [{ priority: 1, branches: [
            { id: "active-attack", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [{ action: 5 }] },
            { id: "dash", branchType: "if", priority: 2, conditions: [{ type: "always" }], actions: [{ action: 19, movementMode: "absolute", movementDirection: "east" }] },
        ] }],
    };
    const opponent = { id: "opponent-model", slot: 2, x: 700, y: 100, size: 60, hp: 100, abilities: [] };
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100,
        moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
        abilities: [5, 19], abilityCharges: { 5: 4 },
        abilityCooldowns: { 5: 0, 19: 0 }, abilityRechargeMs: { 5: 0 }, abilityActiveMs: { 5: 300 },
    };

    const action = buildDeterministicLogicAction(configuration, buildStatePayload([bot, opponent], "custom"));
    const result = applyBotAction(bot, action, 100, noDamageCombat.applyDamageToShape);

    assert.equal(action.abilityAction, null);
    assert.equal(result.triggeredAbility, null);
    assert.equal(result.abilityCooldowns[19], 0);
    assert.equal(result.abilityPendingCooldownMs[19], undefined);
    assert.equal(result.x, bot.x);
});

test("a higher-priority fireball yields to grenade during its one-tick recovery", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [
            { priority: 1, branches: [{ conditions: [{ type: "always" }], actions: [{ action: "shoot_fireball" }] }] },
            { priority: 2, branches: [{ conditions: [{ type: "always" }], actions: [{ action: "throw_grenade" }] }] },
        ],
    };
    const opponent = { id: "opponent-model", slot: 2, x: 700, y: 400, size: 60, hp: 100, maxHp: 100, abilities: [] };
    let bot = {
        id: "main", slot: 1, x: 100, y: 400, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [4, 5], abilityCharges: { 5: 4 },
        abilityCooldowns: { 4: 0, 5: 0 }, abilityRechargeMs: { 5: 0 }, abilityActiveMs: {},
    };
    const triggered = [];
    for (let tick = 0; tick < 8; tick += 1) {
        const action = buildDeterministicLogicAction(configuration, buildStatePayload([bot, opponent], "custom"));
        if (action.abilityAction) triggered.push(action.abilityAction.action);
        bot = applyBotAction(bot, action, 100, noDamageCombat.applyDamageToShape);
    }

    assert.deepEqual(triggered.slice(0, 2), [5, 4]);
});

test("projectile system returns net bot damage and removes a colliding fireball", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100 },
    ];
    const fireball = { id: "fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickProjectileWorld({ bots, entities: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(result.entities.length, 0);
    assert.equal(result.bots[1].hp, 85);
    assert.equal(statusIsActive(result.bots[1], "burn"), true);
});

test("projectile collision sweeps across a bot's dash segment", () => {
    const owner = { id: "owner", slot: 1, x: 700, y: 100, size: 60, hp: 100, maxHp: 100 };
    const target = {
        id: "target", slot: 2, x: 425, y: 432, size: 60, hp: 100, maxHp: 100,
        movementStartX: 500, movementStartY: 432,
    };
    const grenade = { ...entityFor(owner, 4), x: 500, y: 467.6, velocityX: 0, velocityY: 0, stoppedMs: 0 };
    const result = tickProjectileWorld({
        bots: [owner, target],
        entities: [grenade],
        stepMs: 100,
        width: 1000,
        height: 800,
    }, noDamageCombat);

    assert.equal(result.entities.length, 0);
    assert.equal(result.spawnedEntities.length, 1);
    assert.equal(result.spawnedEntities[0].damageApplied, true);
    assert.ok(result.bots[1].hp < 100);
});

test("grenades become ability-system explosions on contact and fuse expiry", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, maxHp: 100 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, maxHp: 100 };
    const grenade = { ...entityFor(owner, 4), x: 120, y: 100, velocityX: 0, velocityY: 0, stoppedMs: 0 };
    const contact = tickProjectileWorld({ bots: [owner, target], entities: [grenade], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(contact.entities.length, 0);
    assert.equal(contact.spawnedEntities.length, 1);
    assert.equal(isAbilityEntity(contact.spawnedEntities[0]), true);
    assert.equal(contact.bots[1].hp, 60);

    const exploded = tickAbilityEntityWorld({
        entities: contact.spawnedEntities,
        projectiles: [],
        bots: contact.bots,
        stepMs: 50,
        width: 1000,
        height: 800,
    }, noDamageCombat);
    assert.equal(exploded.bots[1].hp, 60);
    assert.equal(exploded.entities.length, 1);

    const timed = tickProjectileWorld({
        bots: [owner, { ...target, x: 184, hp: 100 }],
        entities: [{ ...grenade, id: "timed-grenade", stoppedMs: 950 }],
        stepMs: 50,
        width: 1000,
        height: 800,
    }, noDamageCombat);
    assert.equal(timed.entities.length, 0);
    assert.equal(timed.spawnedEntities[0].type, "grenadeExplosion");
    const timedExplosion = tickAbilityEntityWorld({
        entities: timed.spawnedEntities,
        projectiles: [],
        bots: timed.bots,
        stepMs: 50,
        width: 1000,
        height: 800,
    }, noDamageCombat);
    assert.equal(timedExplosion.bots[1].hp, 75);
});

test("grenade damage falls linearly between its configured endpoints", () => {
    assert.equal(damageAtDistance(4, 0), 40);
    assert.equal(damageAtDistance(4, 32), 32.5);
    assert.equal(damageAtDistance(4, 64), 25);
    assert.equal(damageAtDistance(4, 70), 25);
    assert.equal(damageAtDistance(4, 71), 0);
});

test("ranged damage profiles use max and min plateaus around linear falloff", () => {
    assert.equal(damageAtDistance(3, 100), 15);
    assert.equal(damageAtDistance(3, 700), 5);
    assert.equal(damageAtDistance(12, 166.665), 6);
    assert.equal(damageAtDistance(12, 400), 4);
    assert.equal(damageAtDistance(14, 45), 27.5);
    assert.equal(damageAtDistance(14, 120), 20);
    assert.equal(damageAtDistance(22, 65), 15);
    assert.equal(damageAtDistance(32, 0), 25);
    assert.equal(damageAtDistance(32, 250), 20);
    assert.equal(damageAtDistance(32, 500), 15);
});

test("projectiles pass through dead bots without applying damage or status", () => {
    let world = {
        bots: [
            { id: "owner", x: 50, y: 100, size: 60, hp: 100 },
            { id: "dead", x: 150, y: 100, size: 60, hp: 0 },
            { id: "living", x: 260, y: 100, size: 60, hp: 100 },
        ],
        entities: [{ id: "passing-fireball", type: "fireball", entityContractId: 5, abilityId: 5, ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 }],
        stepMs: 50,
        width: 1000,
        height: 800,
    };

    world = { ...world, ...tickProjectileWorld(world, noDamageCombat) };
    assert.equal(world.entities.length, 1);
    assert.equal(statusRemainingMs(world.bots[1], "burn"), 0);

    for (let tick = 0; tick < 25 && world.entities.length > 0; tick += 1) {
        world = { ...world, ...tickProjectileWorld(world, noDamageCombat) };
    }
    assert.equal(world.bots[1].hp, 0);
    assert.equal(statusRemainingMs(world.bots[1], "burn"), 0);
    assert.equal(world.bots[2].hp, 85);
});

test("fireball lifetime, rather than traveled range, controls projectile removal", () => {
    const owner = { id: "owner", x: 500, y: 400, size: 60, hp: 100 };
    const longTraveled = {
        ...entityFor({ ...owner, slot: 1, rotation: 90 }, 5),
        x: 500,
        y: 400,
        velocityX: 0,
        velocityY: 0,
        traveled: 10_000,
        ageMs: 0,
    };
    const stillAlive = tickProjectileWorld({
        bots: [owner],
        entities: [longTraveled],
        stepMs: 100,
        width: 1000,
        height: 800,
    }, noDamageCombat);
    assert.equal(stillAlive.entities.length, 1);

    const expired = tickProjectileWorld({
        bots: [owner],
        entities: [{ ...longTraveled, ageMs: ABILITY_STATS[5].durationMs - 100 }],
        stepMs: 100,
        width: 1000,
        height: 800,
    }, noDamageCombat);
    assert.equal(expired.entities.length, 0);
});

test("Fireball damages normally while its burn effect remains attached", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, abilityCharges: { 2: 25 } },
    ];
    const fireball = { id: "blocked-fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickProjectileWorld({ bots, entities: [fireball], stepMs: 50, width: 1000, height: 800 }, { ...noDamageCombat, applyDamageToShape, applyDamageFromShapes });
    assert.ok(result.bots[1].hp < 100);
    assert.equal(result.bots[1].abilityCharges[2], 25);
    assert.equal(statusRemainingMs(result.bots[1], "burn"), 5000);
});

test("mine, gravity, silence, drone, and orbital effects are never blocked", () => {
    const shield = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityActiveMs: { 2: 1 }, abilityCharges: { 2: 25 }, abilities: [2] };
    const combat = { ...noDamageCombat, applyDamageToShape, applyDamageFromShapes };
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true, hitTriggered: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], projectiles: [], bots: [shield], stepMs: 100, width: 1000, height: 800 }, combat);
    assert.ok(mineResult.bots[0].hp < 100);
    assert.equal(mineResult.bots[0].abilityCharges[2], 25);

    const gravity = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 14), traveled: 176, x: 100, y: 100, fuseMs: 100, remainingMs: 2000 };
    const gravityResult = tickAbilityEntityWorld({ entities: [gravity], bots: [shield], stepMs: 100, width: 1000, height: 800 }, combat);
    assert.ok(gravityResult.bots[0].hp <= 100);
    assert.equal(gravityResult.bots[0].abilityCharges[2], 25);

    const silence = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }, 15);
    const silenceResult = tickAbilityEntityWorld({ entities: [silence], bots: [shield], stepMs: 100, width: 1000, height: 800 }, combat);
    assert.equal(statusRemainingMs(silenceResult.bots[0], "silence"), 2000);
    assert.equal(silenceResult.bots[0].abilityCharges[2], 25);

    const drone = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }, 17), shotCooldownMs: 0 };
    const droneResult = tickAbilityEntityWorld({ entities: [drone], bots: [shield], stepMs: 100, width: 1000, height: 800 }, combat);
    assert.ok(droneResult.bots[0].hp < 100);
    assert.equal(droneResult.bots[0].abilityCharges[2], 25);

    const orbital = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 22, { targetX: 150, targetY: 100, clamp: (value) => value }), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], bots: [shield], stepMs: 100, width: 1000, height: 800 }, combat);
    assert.ok(orbitalResult.bots[0].hp <= 100);
    assert.equal(orbitalResult.bots[0].abilityCharges[2], 25);
});

test("radial effects use bot-center distance instead of outer-edge overlap", () => {
    const outside = { id: "target", slot: 2, x: 240, y: 100, size: 60, hp: 100, maxHp: 100 };
    const orbital = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 22, { targetX: 100, targetY: 100, clamp: (value) => value }), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], bots: [outside], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(orbitalResult.bots[0].hp, 100);

    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], bots: [outside], stepMs: 100, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(mineResult.bots[0].hp, 100);

    assert.equal(Math.hypot(outside.x - 100, outside.y - 100) > ABILITY_STATS[4].explosionRadius, true);
});

test("another fireball refreshes burn duration without resetting its pending damage tick", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100, statusEffects: [damageStatus("burn", 4000, 300, 2)] },
    ];
    const fireball = { id: "refresh", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const hit = tickProjectileWorld({ bots, entities: [fireball], stepMs: 50, width: 1000, height: 800 }, noDamageCombat);
    assert.equal(statusRemainingMs(hit.bots[1], "burn"), 5000);
    assert.equal(statusEffectFor(hit.bots[1], "burn").tickMs, 300);

    const ticked = tickBotStatus(hit.bots[1], 300, noDamageCombat.applyDamageToShape);
    assert.equal(ticked.hp, 83);
});
