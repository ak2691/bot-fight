import assert from "node:assert/strict";
import test from "node:test";
import { createAbilityEntity } from "../../../../../shared/engine/ecs/entities/EntityFactory.js";
import { ENTITY_CONTRACTS, EVENT_SCHEDULE_MODES, entityContractForAbility, phaseTypeForEntity } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { isAbilityEntity } from "../../../../../shared/engine/ecs/abilities/AbilityEntitySystem.js";
import { abilityActiveOpacity, basicHealParticleSpec, BASIC_HEAL_PARTICLE_COUNT, BASIC_HEAL_PARTICLE_LIFETIME_MS, combatVisualRemainingMs, healthBarPercent, abilityVisualOpacity, REPULSOR_BURST_FRAME_COUNT, REPULSOR_BURST_FRAME_MS, REPULSOR_BURST_MAX_DIAMETER, REPULSOR_BURST_VISUAL_MS, repulsorBurstDiameter, repulsorBurstFrameIndex, repulsorBurstProgress, sweepAngle } from "../../../../../shared/engine/gameconfig/visualState.js";
import { amountAtDistance, durationAtDistance } from "../../../../../shared/engine/ecs/abilities/effects.js";
import { abilityHitsTarget } from "../../../../../shared/engine/ecs/abilities/AbilityHitDetectionSystem.js";
import { buildDeterministicLogicAction as buildDeterministicLogicActionNormalized } from "../../../../../shared/engine/botlogic/planner/ArenaActionPlanner.js";
import { buildStatePayload } from "../../../../../shared/engine/modelPayloads/strategyStatePayload.js";
import { abilityDefinition, ABILITY_STATS, shouldInterpolateAbilityVisual } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { ABILITY_CONTRACTS, EFFECT_TYPES, MOVEMENT_MODES, TARGET_KINDS, effectTargetsTarget, eventTargetsEntity, eventVerbs, phaseEffects, targetKindsForEntity, triggerVerbs, triggerView } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { botStatusLabels, visualForShape } from "../../pixi/pixiVisualState.js";
import { resetBotShape } from "../../modelPayloads/arenaShapes.js";
import { compassDirection } from "../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER, HIT_STAGGER_DURATION_MS, HIT_STAGGER_MOVEMENT_MULTIPLIER, HIT_STAGGER_ROTATION_MULTIPLIER } from "../../../../../shared/engine/gameconfig/HitStagger.js";
import { statusEffectFor, statusIsActive, statusRemainingMs } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { anotherAbilityActive } from "../../../../../shared/engine/gameconfig/AbilityResourceSystem.js";
import { movingCircleCollision, movingRectangleCollision } from "../../../../../shared/engine/gameconfig/geometry.js";
import { entityAbilitySpawnTransform, movingEntityCollision } from "../../../../../shared/engine/gameconfig/hitboxGeometry.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { applyBotAction, dealDamage, resolveTriggerVerbsForRoster, settleHealing, tickAbilityEntityWorld, tickBotLifecycle, tickBotResources, tickBotState, tickBotStatus, tickDeferredStates, resolveTriggeredAbilityCombat as resolveAbilityCombat } from "../../testing/pureTicks.js";
import { preparingAbilityId, preparingRemainingMs, activeRemainingMs, cooldownRemainingMs, pendingCooldownMs, abilityRecord, abilityIdsInStage } from "../../../../../shared/engine/gameconfig/AbilityState.js";

// The engine takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const buildDeterministicLogicAction = (configuration, ...rest) => buildDeterministicLogicActionNormalized(normalizeBrainForTick(configuration), ...rest);

const entityFor = (bot, abilityId, context = {}) => createAbilityEntity(bot, abilityId, context);
const resolveTriggeredAbilityCombatForRoster = (bots) => resolveTriggerVerbsForRoster(bots);
const phaseVisualFor = (entity) => ENTITY_CONTRACTS[entity.abilityId]?.phases
    ?.find((phase) => phase.id === entity.phaseId)?.visual;

test("phase contracts keep target policy on events and use generic event schedules", () => {
    const phases = Object.values(ENTITY_CONTRACTS).flatMap((contract) => contract.phases);
    assert.equal(phases.some((phase) => Object.hasOwn(phase, "persistence")), false);
    assert.deepEqual(eventVerbs(ENTITY_CONTRACTS[4].phases[0].on.collision), [{ do: "transition", to: "active" }]);
    assert.equal(ENTITY_CONTRACTS[15].phases[0].on.collision.targetPolicy.mode, "once");
    assert.equal(ENTITY_CONTRACTS[15].phases[0].on.collision.schedule.mode, EVENT_SCHEDULE_MODES.CONTINUOUS);
    assert.equal(ENTITY_CONTRACTS[22].phases[0].on.interval, undefined);
    assert.equal(ENTITY_CONTRACTS[22].phases[0].on.collision.targetPolicy, undefined);
    assert.deepEqual(ENTITY_CONTRACTS[22].phases[0].on.collision.schedule, {
        mode: EVENT_SCHEDULE_MODES.REPEAT, intervalMs: 500, startImmediately: true,
    });
    assert.equal(ENTITY_CONTRACTS[22].phases[0].execution, undefined);
    assert.deepEqual(ENTITY_CONTRACTS[5].phases[0].on.collision.targets,
        [TARGET_KINDS.BOT, TARGET_KINDS.HP_ENTITY]);
    assert.equal(ENTITY_CONTRACTS[5].phases[0].on.collision.schedule.mode,
        EVENT_SCHEDULE_MODES.CONTINUOUS);
    assert.deepEqual(ENTITY_CONTRACTS[29].phases[2].on.collision.targets,
        [TARGET_KINDS.BOT, TARGET_KINDS.HP_ENTITY]);
    assert.equal(phases.every((phase) => Object.values(phase.on ?? {})
        .every((event) => event.schedule?.mode)), true);
});

test("event and effect target kinds keep bots, HP entities, and summons distinct", () => {
    const hpEntity = { hp: 40 };
    const summon = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 17), phaseType: "zone" };
    const hpEntityKinds = targetKindsForEntity(hpEntity);
    const summonKinds = targetKindsForEntity(summon);
    const damage = { type: EFFECT_TYPES.DAMAGE };
    const slow = { type: EFFECT_TYPES.STATUS, subtype: "slow" };
    const summonSlow = { ...slow, targetKinds: [TARGET_KINDS.BOT, TARGET_KINDS.SUMMON] };

    assert.deepEqual(hpEntityKinds, [TARGET_KINDS.ENTITY, TARGET_KINDS.HP_ENTITY]);
    assert.deepEqual(summonKinds, [TARGET_KINDS.ENTITY, TARGET_KINDS.HP_ENTITY, TARGET_KINDS.SUMMON]);
    assert.deepEqual(triggerVerbs(21)[0].targets, ["OWNER"]);
    assert.equal(eventTargetsEntity({ targets: [TARGET_KINDS.BOT] }, summonKinds), false);
    assert.equal(eventTargetsEntity({ targets: [TARGET_KINDS.HP_ENTITY] }, summonKinds), true);
    assert.equal(eventTargetsEntity({ targets: [TARGET_KINDS.SUMMON] }, hpEntityKinds), false);
    assert.equal(effectTargetsTarget(damage, hpEntityKinds), true);
    assert.equal(effectTargetsTarget(damage, summonKinds), true);
    assert.equal(effectTargetsTarget(slow, summonKinds), false);
    assert.equal(effectTargetsTarget(summonSlow, hpEntityKinds), false);
    assert.equal(effectTargetsTarget(summonSlow, summonKinds), true);
});

test("an applyEffects verb lists only the effects it applies, statuses included", () => {
    // Silence Pulse applies the silence status and nothing else on collision.
    const statuses = phaseEffects(ENTITY_CONTRACTS[15].phases[0]).filter(({ type }) => type === EFFECT_TYPES.STATUS);
    assert.ok(statuses.length > 0);
    assert.ok(statuses.every(({ subtype }) => subtype === "silence"));
    // Slash lists its damage and nothing else.
    assert.deepEqual(triggerView(1).effects.map(({ type }) => type), [EFFECT_TYPES.DAMAGE]);
});

test("entity phases expose complete effect payloads for contract auditing", () => {
    for (const contract of Object.values(ENTITY_CONTRACTS)) {
        for (const phase of contract.phases) {
            assert.equal(phaseEffects(phase).every((effect) => effect && typeof effect === "object" && effect.type), true);
        }
    }
    assert.deepEqual(
        phaseEffects(ENTITY_CONTRACTS[5].phases[0]).find(({ type }) => type === "status"),
        {
            type: "status", subtype: "burn", amount: 2, durationMs: 5000,
            intervalMs: 1000, targetKinds: [TARGET_KINDS.BOT, TARGET_KINDS.SUMMON],
        },
    );
});

test("trigger hit verbs own their shape geometry", () => {
    assert.deepEqual(triggerView(1).hitbox, {
        shape: "arc", range: 92, arc: 120, radiusMultiplier: 1, includeTargetRadius: true,
    });
    assert.equal(triggerView(3).hitbox.shape, "ray");
    assert.equal(triggerView(6).hitbox.shape, "rectangle");
    assert.equal(triggerView(8).hitbox.shape, "circle");
    assert.equal(ENTITY_CONTRACTS[22].phases[0].on.collision.schedule.mode, EVENT_SCHEDULE_MODES.REPEAT);
});

test("trigger hit verbs fire from the owner's center and hit once", () => {
    const [hit] = triggerVerbs(1);
    assert.equal(hit.do, "hit");
    assert.deepEqual(hit.origin.offset, { x: 0, y: 0 });
    assert.equal(hit.origin.rotation, 0);
    assert.equal(hit.origin.rotationSpace, "owner");
    assert.ok(!hit.nearestOnly && !hit.oncePerTarget);
    assert.equal(ENTITY_CONTRACTS[1], undefined, "Slash spawns nothing");
});

test("Dash declares its utility as an explicit verb", () => {
    assert.deepEqual(triggerVerbs(19).map(({ do: verb }) => verb), ["move"]);
    const [move] = triggerVerbs(19);
    assert.deepEqual([move.distance, move.unitsPerTick, move.trailMs], [150, 75, 300]);
});

test("ability spawn offsets are relative to the bot", () => {
    const bot = { x: 100, y: 100, rotation: 90 };
    const ownerRelative = entityAbilitySpawnTransform(bot, {
        offset: { x: 10, y: 20 }, rotation: 180, rotationSpace: "owner",
    });
    assert.ok(Math.abs(ownerRelative.x - 120) < 0.000001);
    assert.ok(Math.abs(ownerRelative.y - 110) < 0.000001);
    assert.equal(ownerRelative.rotation, 270);

    const worldFacing = entityAbilitySpawnTransform(bot, {
        offset: { x: 10, y: 20 }, rotation: 0, rotationSpace: "world",
    });
    assert.ok(Math.abs(worldFacing.x - 120) < 0.000001);
    assert.ok(Math.abs(worldFacing.y - 110) < 0.000001);
    assert.equal(worldFacing.rotation, 0);
});

test("once collision does not wait for a target that enters after phase entry", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0 };
    const target = { id: "target", slot: 2, x: 500, y: 100, size: 60, hp: 100, maxHp: 100 };
    const singularity = {
        ...entityFor(owner, 27, { targetX: 200, targetY: 100, clamp: (value) => value }),
        x: 200,
        y: 100,
        phaseId: "active",
        phaseLocked: true,
        phaseTimerMs: 0,
    };
    const first = tickAbilityEntityWorld({
        entities: [singularity], bots: [target], stepMs: 50, width: 1000, height: 800,
    });
    const second = tickAbilityEntityWorld({
        entities: first.entities,
        bots: [{ ...target, x: 200 }],
        stepMs: 50, width: 1000, height: 800,
    });

    assert.equal(first.bots[0].hp, 100);
    assert.equal(second.bots[0].hp, 100);
    assert.equal(second.entities.length, 0);
});

test("projectile once remains continuous and can hit a target after it enters the path", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90 };
    const projectile = {
        ...entityFor(owner, 15), x: 100, y: 100, velocityX: 150, velocityY: 0,
    };
    const first = tickAbilityEntityWorld({
        entities: [projectile],
        bots: [{ id: "target", slot: 2, x: 500, y: 100, size: 60, hp: 100, maxHp: 100 }],
        stepMs: 100, width: 1000, height: 800,
    });
    const second = tickAbilityEntityWorld({
        entities: first.entities,
        bots: [{ id: "target", slot: 2, x: 250, y: 100, size: 60, hp: 100, maxHp: 100 }],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(statusRemainingMs(first.bots[0], "silence"), 0);
    assert.ok(statusRemainingMs(second.bots[0], "silence") > 0);
});

test("drone bodies are HP colliders while their schedule event owns the ray attack", () => {
    for (const abilityId of [17, 31]) {
        const contract = ENTITY_CONTRACTS[abilityId];
        const [phase] = contract.phases;
        assert.deepEqual(phase.hitbox, { shape: "circle", radius: 14, radiusMultiplier: 1 });
        assert.equal(phase.on.collision, undefined);
        assert.equal(phaseEffects(phase).length, 0);
        assert.equal(phase.movement.mode, MOVEMENT_MODES.SEEK);
        assert.deepEqual(phase.on.schedule.schedule, { mode: "repeat", intervalMs: 1000, startImmediately: true });
        assert.equal(phase.on.schedule.waitForHit, true);
        const [shot] = eventVerbs(phase.on.schedule);
        assert.equal(shot.do, "hit");
        assert.equal(shot.aim, "seekTarget");
        assert.deepEqual(shot.origin, { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" });
        assert.deepEqual(shot.hitbox, { shape: "ray", range: 200, width: 5, length: 200, radiusMultiplier: 1 });
    }
});

test("entity ability spawn offsets are relative to the drone", () => {
    const transform = entityAbilitySpawnTransform(
        { x: 100, y: 100, rotation: 0 },
        { offset: { x: 10, y: 20 }, rotation: 0, rotationSpace: "owner" },
    );

    assert.deepEqual(transform, { x: 110, y: 80, rotation: 0 });
});

test("entity existence and behavior stay in the entity registry and phases", () => {
    for (const contract of Object.values(ABILITY_CONTRACTS)) {
        assert.equal(Object.hasOwn(contract, "effects"), false);
        assert.equal(Object.hasOwn(contract, "phases"), false, "phases belong to entities, not abilities");
    }
    for (const contract of Object.values(ENTITY_CONTRACTS)) {
        assert.equal(Object.hasOwn(contract, "motion"), false);
        assert.equal(Object.hasOwn(contract, "visual"), false);
        for (const phase of contract.phases) {
            if (phase.movement) {
                assert.ok(Object.values(MOVEMENT_MODES).includes(phase.movement.mode));
                assert.equal(typeof phase.movement.unitsPerTick, "number");
            }
        }
    }
});

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
        ...metadata,
        effects: metadata.effects ?? [
            { type: "damage", mode: "tick", amount, multiplier: metadata.multiplier ?? 1 },
            ...(type === "bleed" ? [{
                type: "incoming_damage_modifier",
                mode: "constant",
                damageModifier: 0.25,
                rounding: "truncate_tenths",
                excludedDamageSourceTypes: ["bleed"],
            }] : []),
        ],
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

    const simulationShape = reset;
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

test("every trigger-only ability exposes its effects without redundant routing metadata", () => {
    for (const id of Object.keys(ABILITY_CONTRACTS).map(Number).filter((id) => !ENTITY_CONTRACTS[id])) {
        const definition = abilityDefinition(id);
        assert.ok(definition, id);
        assert.ok(definition.phaseTag, id);
        assert.ok(Array.isArray(definition.effects), id);
        assert.equal(definition.shieldInteraction, undefined, id);
    }
    assert.equal(triggerView(25).hitbox.shape, "rectangle");
});

test("active ability contracts do not expose shield filtering", () => {
    for (const [id, contract] of Object.entries(ABILITY_CONTRACTS)) {
        assert.equal(contract.shieldInteraction, undefined, id);
    }
});

test("hunter drone spawns with component health and 50 hp", () => {
    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 200, rotation: 0 }, 17);
    assert.equal(drone.hp, 50);
    assert.equal(drone.maxHp, 50);
    assert.equal(ENTITY_CONTRACTS[17].phases[0].health.maxHp, 50);
});

test("hunter drone pursues targets at 4.5 units per arena tick", () => {
    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 200, rotation: 0 }, 17);
    const target = { id: "target", slot: 2, x: 500, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    });
    assert.equal(result.entities[0].x, 104.5);
    assert.equal(result.entities[0].y, 200);
});

test("hunter drone retains the replay-matched shot visual timer", () => {
    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 200, rotation: 90 }, 17);
    const target = { id: "target", slot: 2, x: 200, y: 200, size: 60, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], bots: [target],
        stepMs: 50, width: 1000, height: 800,
    });

    assert.equal(result.entities[0].shotVisualMs, 250);
    assert.equal(result.entities[0].eventType, "schedule");
    assert.equal(result.entities[0].eventPhaseId, "active");
    assert.equal(result.entities[0].eventSequence, 1);
    assert.equal(visualForShape(result.entities[0]).type, "gun");
});

test("Tether Bolt returns on an outbound hit and pulls 250 units once on return", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, hp: 100, maxHp: 100, rotation: 90, attackDamageMultiplier: 1 };
    const bolt = entityFor(owner, 28);
    const target = { id: "target", slot: 2, x: 400, y: 100, size: 60, hp: 100, maxHp: 100 };
    let world = {
        entities: [bolt], bots: [owner, target],
        stepMs: 100, width: 1000, height: 800,
    };

    for (let tick = 1; tick <= 5; tick += 1) {
        world = tickAbilityEntityWorld(world);
        if (tick < 5) assert.equal(world.entities.length, 1);
        if (tick <= 2) assert.equal(world.entities[0].phaseId, "outbound");
        if (tick === 3) {
            assert.equal(world.entities[0].phaseId, "return");
            assert.equal(world.bots[1].x, 400);
        }
        if (tick === 4) assert.equal(world.bots[1].x, 150);
    }

    assert.equal(world.entities.length, 0);
    assert.equal(world.bots[1].hp, 90);
    assert.equal(statusRemainingMs(world.bots[1], "slow"), 1200);
    assert.equal(statusRemainingMs(world.bots[1], "stun"), 0);
    assert.equal(world.bots[1].x, 150);
});

test("Tether Bolt returns at its outbound lifetime limit when it misses", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, hp: 100, maxHp: 100, rotation: 90 };
    let world = {
        entities: [entityFor(owner, 28)], bots: [owner],
        stepMs: 100, width: 1000, height: 800,
    };

    for (let tick = 1; tick <= 6; tick += 1) {
        world = tickAbilityEntityWorld(world);
        if (tick < 6) assert.equal(world.entities.length, 1);
        if (tick < 4) assert.equal(world.entities[0].phaseId, "outbound");
        if (tick === 4) assert.equal(world.entities[0].phaseId, "return");
    }

    assert.equal(world.entities.length, 0);
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
        entities: [windburst], bots: [owner, target],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.entities.length, 0);
    assert.ok(result.bots[1].hp < 100);
});

test("Snare Bomb uses its stronger phase when generic damage destroys it", () => {
    const snare = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 29);
    const target = { id: "target", slot: 2, x: 800, y: 700, size: 60, hp: 100, maxHp: 100 };
    // A Concussive Shot from the east (20 damage) destroys the 20 HP bomb.
    const shooter = { id: "shooter", slot: 3, x: snare.x + 60, y: snare.y, size: 60, rotation: 270, hp: 100, maxHp: 100, triggeredAbility: 9 };
    const result = tickAbilityEntityWorld({
        entities: [snare], bots: [target, shooter],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].id, snare.id);
    assert.equal(result.entities[0].type, "snareBomb");
    assert.equal(result.entities[0].phaseId, "destroyed");
    assert.equal(result.entities[0].eventType, "collision");
    assert.equal(result.entities[0].eventPhaseId, "destroyed");
    assert.equal(result.entities[0].eventSequence, 1);
    assert.equal(visualForShape(result.entities[0]).type, "orbitalExplosion");
    assert.equal(visualForShape(result.entities[0]).visualSize, 240);
    assert.equal(result.entities[0].size, 24);
});

test("Snare Bomb triggers once without chaining to its owner", () => {
    const snare = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 29);
    const target = { id: "target", slot: 2, x: 140, y: 100, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [snare], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.bots[0].hp, 75);
    assert.equal(statusRemainingMs(result.bots[0], "slow"), 2200);
    assert.equal(statusRemainingMs(result.bots[0], "stun"), 150);
    assert.equal(result.entities[0].id, snare.id);
    assert.equal(result.entities[0].type, "snareBomb");
    assert.equal(result.entities[0].phaseId, "triggered");
    assert.equal(result.entities[0].eventType, "trigger");
    assert.equal(result.entities[0].eventPhaseId, "armed");
    assert.equal(result.entities[0].eventSequence, 1);
    assert.equal(result.entities[0].visualEventMs, 200);
    assert.equal(visualForShape(result.entities[0]).type, "grenadeExplosion");
    assert.equal(visualForShape(result.entities[0]).visualSize, 150);
    assert.equal(result.entities[0].size, 24);
});

test("an untouched Snare Bomb is removed when its lifetime ends", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, rotation: 0 };
    const faraway = { id: "target", slot: 2, x: 900, y: 700, size: 60, hp: 100, maxHp: 100 };
    const lifetimeTicks = Math.round(ENTITY_CONTRACTS[29].lifetime.duration / 100);
    let world = { entities: [entityFor(owner, 29)], bots: [faraway], stepMs: 100, width: 1000, height: 800 };
    for (let tick = 1; tick < lifetimeTicks; tick += 1) {
        world = tickAbilityEntityWorld(world);
        assert.equal(world.entities.length, 1, `alive at tick ${tick}`);
    }
    world = tickAbilityEntityWorld(world);
    assert.equal(world.entities.length, 0);
});

test("Snare Bomb uses bot contact instead of projectile overlap", () => {
    assert.equal(Object.hasOwn(ENTITY_CONTRACTS[29].phases[0].trigger, "attackHits"), false);
    assert.equal(Object.hasOwn(ENTITY_CONTRACTS[29].phases[0].trigger, "projectileOverlap"), false);
    assert.equal(ENTITY_CONTRACTS[29].phases[0].hitbox.radius, 12);
    const snareOwner = { id: "snare-owner", slot: 1, x: 100, y: 100, rotation: 0, hp: 100, maxHp: 100 };
    const projectileOwner = { id: "projectile-owner", slot: 2, x: 900, y: 700, rotation: 90, hp: 100, maxHp: 100 };
    const target = { id: "target", slot: 3, x: 500, y: 700, size: 60, hp: 100, maxHp: 100 };
    const snare = entityFor(snareOwner, 29);
    const fireball = {
        ...entityFor(projectileOwner, 5),
        x: 160,
        y: 100,
        velocityX: 0,
        velocityY: 0,
    };

    const result = tickAbilityEntityWorld({
        entities: [snare, fireball],
        bots: [snareOwner, projectileOwner, target],
        stepMs: 100,
        width: 1000,
        height: 800,
    });

    assert.equal(result.entities.find((entity) => entity.abilityId === 29)?.phaseId, "armed");
    assert.equal(result.bots[2].hp, 100);
});

test("Proximity Mine uses bot contact only after arming", () => {
    const trigger = ENTITY_CONTRACTS[11].phases[1].trigger;
    assert.deepEqual(trigger, { radius: 87.5, botContact: true });
    assert.deepEqual(phaseEffects(ENTITY_CONTRACTS[11].phases[1]), []);
});

test("Snare Bomb takes damage from a colliding projectile without inheriting its status", () => {
    const snareOwner = { id: "snare-owner", slot: 1, x: 100, y: 100, rotation: 0, hp: 100, maxHp: 100 };
    const projectileOwner = { id: "projectile-owner", slot: 2, x: 900, y: 700, rotation: 90, hp: 100, maxHp: 100 };
    const snare = entityFor(snareOwner, 29);
    const fireball = {
        ...entityFor(projectileOwner, 5),
        x: 100,
        y: 100,
        velocityX: 0,
        velocityY: 0,
        // Half damage keeps the 20 HP Snare alive so the armed phase is still observable.
        damageMultiplier: 0.5,
    };

    const result = tickAbilityEntityWorld({
        entities: [snare, fireball],
        bots: [snareOwner, projectileOwner],
        stepMs: 100,
        width: 1000,
        height: 800,
    });

    const damagedSnare = result.entities.find((entity) => entity.abilityId === 29);
    assert.equal(damagedSnare?.phaseId, "armed");
    assert.equal(damagedSnare?.hp, 10);
    assert.deepEqual(damagedSnare?.statusEffects, []);
    assert.equal(result.entities.some((entity) => entity.abilityId === 5), false);

    const next = tickAbilityEntityWorld({
        ...result,
        width: 1000,
        height: 800,
        stepMs: 100,
    });
    assert.equal(next.entities.find((entity) => entity.abilityId === 29)?.hp, 10);
});

test("Grenade explosion damages Snare Bomb across the explosion radius", () => {
    const snareOwner = { id: "snare-owner", slot: 1, teamNumber: 1, x: 100, y: 100, rotation: 0, hp: 100, maxHp: 100 };
    const grenadeOwner = { id: "grenade-owner", slot: 2, teamNumber: 2, x: 900, y: 700, rotation: 0, hp: 100, maxHp: 100 };
    const snare = entityFor(snareOwner, 29);
    const grenadeExplosion = {
        ...entityFor(grenadeOwner, 4),
        x: 170,
        y: 100,
        velocityX: 0,
        velocityY: 0,
        phaseId: "active",
        phaseTimerMs: 0,
        phaseLocked: true,
    };

    const result = tickAbilityEntityWorld({
        entities: [snare, grenadeExplosion],
        bots: [snareOwner, grenadeOwner],
        stepMs: 100,
        width: 1000,
        height: 800,
    });

    assert.equal(result.entities.find((entity) => entity.abilityId === 29)?.phaseId, "destroyed");
});

test("Travelling Grenade collides with an HP-bearing Snare Bomb and explodes", () => {
    const snareOwner = { id: "snare-owner", slot: 1, teamNumber: 1, x: 100, y: 100, rotation: 0, hp: 100, maxHp: 100 };
    const grenadeOwner = { id: "grenade-owner", slot: 2, teamNumber: 2, x: 900, y: 700, rotation: 0, hp: 100, maxHp: 100 };
    const snare = entityFor(snareOwner, 29);
    const grenade = {
        ...entityFor(grenadeOwner, 4),
        x: 100,
        y: 132,
        velocityX: 0,
        velocityY: -32,
        rotation: 0,
    };

    const result = tickAbilityEntityWorld({
        entities: [snare, grenade], bots: [snareOwner, grenadeOwner],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.entities.find((entity) => entity.abilityId === 4)?.phaseId, "active");

    const resolved = tickAbilityEntityWorld({
        ...result, stepMs: 100, width: 1000, height: 800,
    });
    assert.equal(resolved.entities.find((entity) => entity.abilityId === 29)?.phaseId, "destroyed");
});

test("Grenade can collide with and destroy its owner's Snare Bomb", () => {
    const owner = { id: "owner", slot: 1, teamNumber: 1, x: 900, y: 700, rotation: 0, hp: 100, maxHp: 100 };
    const snare = { ...entityFor(owner, 29), x: 100, y: 100 };
    const grenade = {
        ...entityFor(owner, 4),
        x: 100,
        y: 132,
        velocityX: 0,
        velocityY: -32,
        rotation: 0,
    };

    const collided = tickAbilityEntityWorld({
        entities: [snare, grenade], bots: [owner],
        stepMs: 100, width: 1000, height: 800,
    });
    assert.equal(collided.entities.find((entity) => entity.abilityId === 4)?.phaseId, "active");

    const resolved = tickAbilityEntityWorld({
        ...collided, stepMs: 100, width: 1000, height: 800,
    });
    assert.equal(resolved.entities.find((entity) => entity.abilityId === 29)?.phaseId, "destroyed");
});

test("Grenade fuse explosion damages Snare Bomb on the transition tick", () => {
    const snareOwner = { id: "snare-owner", slot: 1, teamNumber: 1, x: 100, y: 100, rotation: 0, hp: 100, maxHp: 100 };
    const grenadeOwner = { id: "grenade-owner", slot: 2, teamNumber: 2, x: 900, y: 700, rotation: 0, hp: 100, maxHp: 100 };
    const snare = entityFor(snareOwner, 29);
    const armedGrenade = {
        ...entityFor(grenadeOwner, 4),
        x: 170,
        y: 100,
        velocityX: 0,
        velocityY: 0,
        phaseId: "armed",
        phaseTimerMs: 900,
        phaseLocked: true,
    };

    const exploded = tickAbilityEntityWorld({
        entities: [snare, armedGrenade], bots: [snareOwner, grenadeOwner],
        stepMs: 100, width: 1000, height: 800,
    });
    assert.equal(exploded.entities.find((entity) => entity.abilityId === 4)?.phaseId, "active");
    assert.equal(exploded.entities.find((entity) => entity.abilityId === 29)?.phaseId, "armed");

    const resolved = tickAbilityEntityWorld({
        ...exploded, stepMs: 100, width: 1000, height: 800,
    });
    assert.equal(resolved.entities.find((entity) => entity.abilityId === 29)?.phaseId, "destroyed");
});

test("Snare Bomb gets its stronger radius and effects when any attack destroys it", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, triggeredAbility: 9 };
    const snare = entityFor(owner, 29);
    const target = { id: "target", slot: 2, x: 210, y: 100, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [snare], bots: [owner, target],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.bots[1].hp, 60);
    assert.equal(statusRemainingMs(result.bots[1], "slow"), 3000);
    assert.equal(statusRemainingMs(result.bots[1], "stun"), 150);
    assert.equal(result.entities[0].id, snare.id);
    assert.equal(result.entities[0].type, "snareBomb");
    assert.equal(result.entities[0].phaseId, "destroyed");
    assert.equal(visualForShape(result.entities[0]).type, "orbitalExplosion");
    assert.equal(visualForShape(result.entities[0]).visualSize, 240);
    assert.equal(result.entities[0].size, 24);
});

test("Snare Bomb does not detonate from a nonlethal attack hit", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100 };
    const snare = entityFor(owner, 29);
    // A weak Concussive Shot (20 damage x 0.25) from outside contact range leaves the 20 HP bomb standing.
    const attacker = { id: "attacker", slot: 2, x: snare.x + 400, y: snare.y, size: 60, rotation: 270, hp: 100, attackDamageMultiplier: 0.25, triggeredAbility: 9 };
    const result = tickAbilityEntityWorld({
        entities: [snare], bots: [attacker],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.entities[0].type, "snareBomb");
    assert.equal(result.entities[0].hp, 15);
    assert.equal(result.bots[0].hp, 100);
});

test("Snare Bomb uses its stronger phase when an opponent destroys it and skips its owner", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100 };
    const snare = entityFor(owner, 29);
    const attacker = { id: "attacker", slot: 2, x: 140, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, triggeredAbility: 9 };
    const result = tickAbilityEntityWorld({
        entities: [snare], bots: [owner, attacker],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.bots[0].hp, 100);
    assert.equal(result.bots[1].hp, 60);
    assert.equal(statusRemainingMs(result.bots[1], "slow"), 3000);
    assert.equal(result.entities[0].id, snare.id);
    assert.equal(result.entities[0].type, "snareBomb");
    assert.equal(result.entities[0].phaseId, "destroyed");
    assert.equal(visualForShape(result.entities[0]).type, "orbitalExplosion");
    assert.equal(visualForShape(result.entities[0]).visualSize, 240);
    assert.equal(result.entities[0].size, 24);
});

test("Repeller Drone uses the hunter drone body with low-damage knockback shots", () => {
    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }, 31);
    const target = { id: "target", slot: 2, x: 180, y: 100, size: 60, hp: 100, maxHp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [drone], bots: [target],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.entities[0].type, "hunterDrone");
    assert.equal(result.entities[0].hp, 50);
    assert.equal(result.entities[0].x, 104.5);
    assert.equal(result.bots[0].hp, 97);
    assert.ok(result.bots[0].x > target.x);
});

test("drone body contact does not apply the mini ability effects", () => {
    const hunter = entityFor({ id: "hunter-owner", slot: 1, x: 100, y: 100, rotation: 90 }, 17);
    const repeller = entityFor({ id: "repeller-owner", slot: 2, x: 100, y: 100, rotation: 270 }, 31);
    const result = tickAbilityEntityWorld({
        entities: [hunter, repeller], bots: [],
        stepMs: 100, width: 1000, height: 800,
    });

    assert.deepEqual(result.entities.map((entity) => entity.hp), [50, 50]);
});

test("summons accept explicitly summon-targeted presence effects and reset their execution timer", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, rotation: 90, size: 60, hp: 100 };
    const enemy = { id: "enemy", slot: 2, x: 300, y: 300, rotation: 0, size: 60, hp: 100 };
    const zone = entityFor(owner, 24, {
        id: "null-zone",
        targetX: enemy.x,
        targetY: enemy.y,
        clamp: (value) => value,
    });
    const drone = entityFor(enemy, 17, { id: "drone" });
    assert.deepEqual(phaseEffects(ENTITY_CONTRACTS[24].phases[0])[0].targetKinds,
        [TARGET_KINDS.BOT, TARGET_KINDS.SUMMON]);
    const result = tickAbilityEntityWorld({
        bots: [owner, enemy],
        entities: [zone, drone],
        stepMs: 100,
        width: 1000,
        height: 800,
    });

    assert.equal(statusIsActive(result.entities[1], "silence"), true);
    assert.equal(statusEffectFor(result.entities[1], "silence").mode, "presence");
    assert.equal(result.entities[1].intervalTimerMs, 1000);
    assert.equal(result.entities[1].shotVisualMs, 0);
});

test("summon shock deals interval damage and adds its movement lock", () => {
    const owner = { id: "owner", slot: 1, x: 700, y: 100, size: 60, hp: 100 };
    const enemy = { id: "enemy", slot: 2, x: 300, y: 100, size: 60, hp: 100 };
    const drone = {
        ...entityFor(enemy, 17, { id: "drone" }),
        statusEffects: [damageStatus("shock", 1000, 1000, 3, { effects: [
            { type: "damage", mode: "tick", amount: 3 },
            { type: "movement_lock", mode: "tick", durationMs: 300 },
        ] })],
    };
    const result = tickAbilityEntityWorld({
        bots: [owner, enemy],
        entities: [drone],
        stepMs: 1000,
        width: 1000,
        height: 800,
    });

    assert.equal(result.entities[0].hp, 47);
    assert.equal(statusIsActive(result.entities[0], "stun"), true);
    assert.equal(result.entities[0].x, drone.x);
});

test("Disruptor Dart interrupts a prepared ability and starts its cooldown", () => {
    const attacker = {
        id: "disruptor", slot: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 30,
    };
    const defender = {
        id: "caster", slot: 2, x: 200, y: 100, size: 60, rotation: 270,
        hp: 100, maxHp: 100, abilities: [9],
        abilityState: { 9: { stage: "windup", remainingMs: 300, target: { x: 400, y: 100 } } },
    };

    const [, interrupted] = resolveAbilityCombat(attacker, defender);

    assert.equal(interrupted.hp, 80);
    assert.equal(preparingAbilityId(interrupted), null);
    assert.equal(preparingRemainingMs(interrupted), 0);
    assert.equal(activeRemainingMs(interrupted, 9) ?? 0, 0);
    assert.equal(cooldownRemainingMs(interrupted, 9), 6_700);
    assert.equal(pendingCooldownMs(interrupted, 9), 0);
    assert.equal(statusRemainingMs(interrupted, "stun"), 250);
});

test("drones use a short bot action lock while their entities keep their duration", () => {
    const bot = {
        ...base,
        id: "owner",
        slot: 1,
        abilities: [17],
        abilityState: { 17: { stage: "ready", remainingMs: 0 } },
    };
    const activated = applyBotAction(bot, { abilityAction: { action: 17 } }, 100);

    assert.equal(activated.triggeredAbility, 17);
    assert.equal(activeRemainingMs(activated, 17), 300);
    assert.equal(activated.abilitySpawn[0].remainingMs, 6000);
});

test("entity-hit records do not trigger a proximity mine without bot contact", () => {
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true, phaseId: "armed", phaseLocked: true };
    const bot = { id: "attacker", slot: 2, x: 500, y: 500, size: 50, hp: 100, entityHitIds: [mine.id] };
    const result = tickAbilityEntityWorld({
        entities: [mine], bots: [bot],
        stepMs: 50, width: 1000, height: 800,
    });
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].id, mine.id);
    assert.equal(result.entities[0].type, "proximityMine");
    assert.equal(result.entities[0].phaseId, "armed");
    assert.equal(phaseVisualFor(result.entities[0]).type, "proximityMine");
});

test("a self buff does not count as an attack that triggers a proximity mine", () => {
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true, phaseId: "armed", phaseLocked: true };
    const buffingBot = { id: "attacker", slot: 2, x: 500, y: 500, size: 50, hp: 100, triggeredAbility: 33 };
    const result = tickAbilityEntityWorld({
        entities: [mine], bots: [buffingBot],
        stepMs: 50, width: 1000, height: 800,
    });

    assert.equal(result.entities[0].type, "proximityMine");
    assert.equal(result.entities[0].armed, true);
});

test("proximity mine triggers and damages within its increased radius", () => {
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true, phaseId: "armed", phaseLocked: true };
    const bot = { id: "target", slot: 2, x: 180, y: 100, size: 50, hp: 100 };
    const result = tickAbilityEntityWorld({
        entities: [mine], bots: [bot],
        stepMs: 50, width: 1000, height: 800,
    });

    assert.equal(result.entities[0].id, mine.id);
    assert.equal(result.entities[0].type, "proximityMine");
    assert.equal(result.entities[0].phaseId, "active");
    assert.equal(visualForShape(result.entities[0]).type, "mineExplosion");
    assert.equal(visualForShape(result.entities[0]).visualSize, 175);
    assert.equal(result.entities[0].size, 24);
    assert.equal(result.bots[0].hp, 70);
});

test("an untriggered proximity mine advances once without duplicating", () => {
    const mine = entityFor({ id: "owner", slot: 1, x: 100, y: 400, rotation: 0 }, 11);
    const world = { entities: [mine], bots: [{ id: "target", slot: 2, x: 800, y: 700, size: 50, hp: 100 }], stepMs: 100, width: 1000, height: 800 };
    const first = tickAbilityEntityWorld(world);
    assert.equal(first.entities.length, 1);
    assert.equal(first.entities[0].id, mine.id);
    assert.equal(first.entities[0].traveled, 22);
    assert.notEqual(first.entities[0].y, mine.y);

    const second = tickAbilityEntityWorld({ ...world, entities: first.entities });
    assert.equal(second.entities.length, 1);
    assert.equal(second.entities[0].traveled, 44);
});

test("proximity mine transitions from travel to armed phase within one duration", () => {
    const mine = entityFor({ id: "owner", slot: 1, x: 100, y: 400, rotation: 0 }, 11);
    let world = {
        entities: [mine],
        bots: [{ id: "target", slot: 2, x: 800, y: 700, size: 50, hp: 100 }],
        stepMs: 100,
        width: 1000,
        height: 800,
    };
    for (let tick = 0; tick < 8; tick += 1) {
        world = { ...world, ...tickAbilityEntityWorld(world) };
    }

    assert.equal(world.entities.length, 1);
    assert.equal(world.entities[0].armed, true);
    assert.equal(world.entities[0].traveled, 176);
    assert.equal(world.entities[0].ageMs, 800);
    assert.equal(world.entities[0].remainingMs, 20_000);

    const armed = tickAbilityEntityWorld(world);
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

    const first = tickAbilityEntityWorld(world);
    assert.equal(first.entities[0].ageMs, 100);

    const second = tickAbilityEntityWorld({ ...world, entities: first.entities });
    assert.equal(second.entities[0].ageMs, 200);
});

test("gravity zone uses its phase-owned travel speed before entering the fuse", () => {
    const owner = { id: "owner", slot: 1, x: 500, y: 400, size: 60, rotation: 0 };
    const gravity = { ...entityFor(owner, 14), velocityX: 0, velocityY: 0, traveled: 0 };
    let world = {
        entities: [gravity],
        bots: [],
        stepMs: 100,
        width: 1000,
        height: 800,
    };

    for (let tick = 0; tick < 9; tick += 1) {
        const result = tickAbilityEntityWorld(world);
        world = { ...world, entities: result.entities, bots: result.bots };
        assert.equal(world.entities[0].armed, false);
        assert.equal(world.entities[0].phaseId, "travel");
        assert.equal(world.entities[0].phaseTimerMs, (tick + 1) * 100);
    }
    assert.equal(world.entities[0].traveled, 198);

    const stopped = tickAbilityEntityWorld(world);
    assert.equal(stopped.entities[0].armed, true);
    assert.equal(stopped.entities[0].phaseId, "fuse");
    assert.equal(stopped.entities[0].phaseTimerMs, 0);
    assert.equal(stopped.entities[0].velocityX, 0);
    assert.equal(stopped.entities[0].velocityY, 0);
});

test("gravity grenade pulls nearby enemies while its one-second travel phase is active", () => {
    assert.equal(ABILITY_STATS[14].activeMs, 1000);
    assert.equal(ENTITY_CONTRACTS[14].phases[0].durationMs, 1000);
    const owner = { id: "owner", slot: 1, x: 500, y: 400, size: 60, rotation: 0 };
    const gravity = { ...entityFor(owner, 14), velocityX: 0, velocityY: 0 };
    const target = { id: "target", slot: 2, x: 650, y: 400, size: 60, hp: 100 };

    const result = tickAbilityEntityWorld({
        entities: [gravity], bots: [target], stepMs: 100, width: 1000, height: 800,
    });

    assert.equal(result.entities[0].phaseId, "travel");
    assert.equal(result.entities[0].phaseTimerMs, 100);
    assert.equal(result.bots[0].x, 644);
    assert.equal(result.bots[0].y, 400);
});

test("entity projectile ranges match duration times fixed-step displacement", () => {
    assert.equal(ABILITY_STATS[5].range, ABILITY_STATS[5].speed * ABILITY_STATS[5].durationMs / 100);
    assert.equal(ABILITY_STATS[18].range, ABILITY_STATS[18].speed * ABILITY_STATS[18].durationMs / 100);
    assert.equal(ABILITY_STATS[28].range, 400);
});

test("status effects are accumulated before the bot hp snapshot is returned", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        statusEffects: [damageStatus("burn", 1000, 50, 2), damageStatus("bleed", 1000, 50, 2)],
    };
    const result = tickBotStatus(bot, 50);
    // Burn 2 and bleed 2; bleed amplifies the burn tick by a quarter, but not its own.
    assert.equal(result.hp, 95.5);
    assert.equal(statusRemainingMs(result, "burn"), 950);
    assert.equal(statusRemainingMs(result, "bleed"), 950);
});

test("DOT, direct damage, and healing on one tick resolve as one net hp change", () => {
    const bot = {
        hp: 50, maxHp: 100, abilities: [], pendingHealing: 15,
        statusEffects: [damageStatus("burn", 1000, 50, 2), damageStatus("bleed", 1000, 50, 2)],
    };
    const afterDots = tickBotStatus(bot, 50);
    const afterDirectHit = dealDamage(afterDots, 8);
    const result = settleHealing(afterDirectHit);
    assert.equal(result.hp, 50.5);
    assert.equal(result.damageTakenThisTick, 14.5);
});

test("bleed amplifies non-bleed damage, excludes its own tick, and combines generically", () => {
    const bot = {
        hp: 100, maxHp: 100, slot: 2, abilities: [],
        statusEffects: [
            damageStatus("bleed", 5000, 1000, 2, { sourceSlot: 1 }),
            damageStatus("burn", 5000, 1000, 2, { sourceSlot: 1 }),
        ],
    };

    const afterStatuses = tickBotStatus(bot, 1000);
    assert.equal(afterStatuses.hp, 95.5);

    const afterHit = dealDamage(afterStatuses, 10.09, { slot: 1 });
    assert.equal(afterHit.hp, 82.9);

    const withDamageReduction = {
        ...bot,
        hp: 100,
        statusEffects: [
            damageStatus("bleed", 5000, 1000, 0),
            status("reactive-armor", 5000, {
                effects: [{
                    type: "incoming_damage_modifier",
                    mode: "constant",
                    damageModifier: -0.5,
                }],
            }),
        ],
    };
    assert.equal(dealDamage(withDamageReduction, 10.09, { slot: 1 }).hp, 92.5);
});

test("successful damage advances the renderer hit event for consecutive hits", () => {
    const first = dealDamage({ hp: 100, maxHp: 100 }, 10);
    const second = dealDamage(first, 10);
    assert.equal(first.hitParticleEvent, 1);
    assert.equal(second.hitParticleEvent, 2);
});

test("burn and bleed discard a pending tick when duration expires first", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        statusEffects: [damageStatus("burn", 100, 200, 2), damageStatus("bleed", 100, 200, 2)],
    };
    const result = tickBotStatus(bot, 200);
    assert.equal(result.hp, 100);
    assert.equal(statusRemainingMs(result, "burn"), 0);
    assert.equal(statusRemainingMs(result, "bleed"), 0);
});

test("burn and bleed apply a final tick due exactly at expiration", () => {
    const bot = {
        hp: 100, maxHp: 100, abilities: [],
        statusEffects: [damageStatus("burn", 100, 100, 2), damageStatus("bleed", 100, 100, 2)],
    };
    assert.equal(tickBotStatus(bot, 100).hp, 95.5);
});

test("another heavy slash refreshes bleed duration without resetting its pending tick", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const defender = {
        id: "target", x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100,
        statusEffects: [damageStatus("bleed", 4000, 300, 2)],
    };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 62.5);
    assert.equal(statusRemainingMs(hit, "bleed"), 5000);
    assert.equal(statusEffectFor(hit, "bleed").tickMs, 300);
    assert.equal(tickBotStatus(hit, 300).hp, 60.5);
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

    const refreshed = dealDamage({ ...hit, hp: 69, statusEffects: [status("hit-stagger", 100)] }, 1, attacker);
    assert.equal(statusRemainingMs(refreshed, "hit-stagger"), 300);
    const repeated = dealDamage({ ...refreshed, hp: 68 }, 1, attacker);
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
    const hit = resolveAbilityCombat(attacker, { id: "blocked", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [2], abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } } })[1];
    assert.equal(hit.hp, 70);
    assert.equal(abilityRecord(hit, 2)?.charges, 25);
    assert.equal(activeRemainingMs(hit, 2), 1);
    assert.equal(statusRemainingMs(hit, "hit-stagger"), 300);
    const immune = dealDamage({ id: "immune", slot: 2, hp: 100, maxHp: 100, statusEffects: [status("absolute-guard", 100)] }, 20, attacker);
    assert.equal(statusRemainingMs(immune, "hit-stagger"), 0);
    const zero = dealDamage({ id: "zero", slot: 2, hp: 100, maxHp: 100 }, 0, attacker);
    assert.equal(statusRemainingMs(zero, "hit-stagger"), 0);
    const withoutCharges = dealDamage({ id: "without-charges", slot: 2, hp: 100, maxHp: 100 }, 3, attacker);
    assert.equal(withoutCharges.hp, 97);
    assert.equal(statusRemainingMs(withoutCharges, "hit-stagger"), 300);
    const partiallyReduced = dealDamage({ ...withoutCharges, hp: 100 }, 8, attacker);
    assert.equal(partiallyReduced.hp, 92);
    assert.equal(statusRemainingMs(partiallyReduced, "hit-stagger"), 300);
});

test("hit stagger scales allocated movement and rotation for exactly three 100 ms ticks", () => {
    const action = { dx: 1, dy: 0, dRot: 1 };
    const base = { id: "target", slot: 2, x: 100, y: 100, rotation: 0, size: 60, hp: 100, maxHp: 100, moveSpeed: 12, movementVelocityX: 12, movementVelocityY: 0 };
    const normal = applyBotAction(base, action, 100);
    const staggered = applyBotAction({ ...base, statusEffects: [status("hit-stagger", 300, { effects: [{ type: "movement_modifier", mode: "constant", movementMultiplier: .85, rotationMultiplier: .85 }] })] }, action, 100);
    assert.equal(normal.x, 112);
    assert.equal(staggered.x, 110.2);
    assert.equal(normal.rotation, 12);
    assert.ok(Math.abs(staggered.rotation - 10.2) < 1e-9);
    assert.equal(statusRemainingMs(staggered, "hit-stagger"), 200);

    let ticking = { ...base, statusEffects: [status("hit-stagger", 300, { effects: [{ type: "movement_modifier", mode: "constant", movementMultiplier: .85, rotationMultiplier: .85 }] })] };
    for (let index = 0; index < 3; index += 1) ticking = applyBotAction(ticking, { dx: 1, dy: 0 }, 100);
    assert.equal(statusRemainingMs(ticking, "hit-stagger"), 0);
    const expired = applyBotAction(ticking, { dx: 1, dy: 0 }, 100);
    assert.equal(expired.x - ticking.x, 12);

});

test("walking starts, turns, and stops immediately without acceleration", () => {
    const fast = { ...base, moveSpeed: 20 };
    const moving = applyBotAction(fast, { dx: 1, dy: 0 }, 100);
    assert.equal(moving.x, 120);
    assert.equal(moving.movementVelocityX, 20);

    const turning = applyBotAction(moving, { dx: 0, dy: 1 }, 100);
    assert.equal(turning.x, 120);
    assert.equal(turning.y, 120);
    assert.equal(turning.movementVelocityX, 0);
    assert.equal(turning.movementVelocityY, 20);

    const stopped = applyBotAction(turning, { dx: 0, dy: 0 }, 100);
    assert.equal(stopped.x, 120);
    assert.equal(stopped.y, 120);
    assert.equal(stopped.movementVelocityX, 0);
    assert.equal(stopped.movementVelocityY, 0);
});

test("Dash costs stamina and a 100 ms cooldown after its active stage", () => {
    const dashBase = {
        ...base,
        x: 200,
        abilities: [19],
        abilityState: { 19: { stage: "ready", remainingMs: 0 } },
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 19, targetX: 400, targetY: 100 } };
    const first = applyBotAction(dashBase, action, 100);
    assert.equal(first.x, 275);
    assert.equal(abilityRecord(first, 19)?.charges, undefined);
    // The cooldown is reserved while the dash is active, and the cost is paid on activation.
    assert.equal(first.abilityState[19].stage, "active");
    assert.equal(cooldownRemainingMs(first, 19), 0);
    assert.equal(pendingCooldownMs(first, 19), 100);
    assert.equal(first.stamina, 70);
    assert.equal(first.dashGapMs, undefined);

    // The cooldown blocks another dash after the active phase and dash travel are over.
    const blocked = applyBotAction({ ...first, dashRemaining: 0, abilityState: { 19: { stage: "cooldown", remainingMs: 100 } } }, action, 100);
    assert.equal(blocked.triggeredAbility, null);
    assert.equal(blocked.stamina, 70);

    const ready = applyBotAction({ ...first, dashRemaining: 0, abilityState: { 19: { stage: "ready", remainingMs: 0 } } }, action, 100);
    assert.equal(ready.triggeredAbility, 19);
    assert.equal(ready.stamina, 40);
    assert.equal(cooldownRemainingMs(ready, 19), 0);
    assert.equal(pendingCooldownMs(ready, 19), 100);
});

test("Dash stops when its ability active timer expires and allows later dashes", () => {
    const dashBase = {
        ...base,
        x: 200,
        abilities: [19],
        abilityState: { 19: { stage: "ready", remainingMs: 0 } },
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 19, targetX: 400, targetY: 100 } };
    const first = applyBotAction(dashBase, action, 100);
    const finished = applyBotAction({
        ...first,
        abilityState: { 19: { stage: "ready", remainingMs: 0 } },
    }, { dx: 0, dy: 0, dRot: 0 }, 100);

    assert.equal(finished.dashRemaining, 0);
    assert.equal(activeRemainingMs(finished, 19), 0);

    const second = applyBotAction({
        ...finished,
        dashGapMs: 0,
        abilityState: { 19: { stage: "ready", remainingMs: 0 } },
    }, action, 100);
    assert.equal(second.triggeredAbility, 19);
    assert.ok(activeRemainingMs(second, 19) > 0);
});

test("entity-backed abilities resolve through normalized entity contracts", () => {
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
        assert.equal(entity.kind, "entity");
    }
    assert.equal(phaseTypeForEntity(createAbilityEntity(bot, 4)), "projectile");
    assert.equal(phaseTypeForEntity(createAbilityEntity(bot, 5)), "projectile");
    assert.equal(phaseTypeForEntity(createAbilityEntity(bot, 18)), "projectile");
    assert.equal(ENTITY_CONTRACTS.grenade, undefined);
});

test("Pistol waits for the next tick after its active boundary", () => {
    const pistol = {
        ...base,
        abilities: [12],
        abilityState: { 12: { stage: "active", remainingMs: 100, charges: 5, reloadMs: 0 } },
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 12 } };
    const fired = applyBotAction(pistol, action, 100);
    assert.equal(fired.triggeredAbility, null);
    assert.equal(cooldownRemainingMs(fired, 12), 0);
    assert.equal(activeRemainingMs(fired, 12), 0);
    assert.equal(abilityRecord(fired, 12)?.charges, 5);

    const nextTick = applyBotAction(fired, action, 100);
    assert.equal(nextTick.triggeredAbility, 12);
    assert.equal(cooldownRemainingMs(nextTick, 12), 0);
    assert.equal(pendingCooldownMs(nextTick, 12), 400);
    assert.equal(activeRemainingMs(nextTick, 12), 300);
    assert.equal(abilityRecord(nextTick, 12)?.charges, 4);
    assert.equal(abilityRecord(fired, 12)?.reloadMs, 0);
});

test("Sniper has no ammo, winds up for 900 ms, then fires with a 200 ms active phase and 9 s cooldown", () => {
    const sniper = {
        ...base,
        abilities: [3],
        abilityState: { 3: { stage: "ready", remainingMs: 0 } },
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 3 } };
    let bot = sniper;
    for (let elapsed = 100; elapsed < 900; elapsed += 100) {
        bot = applyBotAction(bot, action, 100);
        assert.equal(bot.triggeredAbility ?? null, null, `still aiming at ${elapsed} ms`);
        assert.equal(preparingAbilityId(bot), 3);
        assert.equal(preparingRemainingMs(bot), 900 - elapsed);
    }
    const fired = applyBotAction(bot, action, 100);
    assert.equal(fired.triggeredAbility, 3);
    assert.equal(preparingAbilityId(fired) ?? null, null);
    assert.equal(activeRemainingMs(fired, 3), 200);
    assert.equal(pendingCooldownMs(fired, 3), 9000);
    assert.equal(abilityRecord(fired, 3)?.charges, undefined);
    assert.equal(abilityRecord(fired, 3)?.reloadMs, undefined);
});

test("Fireball has no ammo and holds its 5.5 s recovery until its active window ends", () => {
    const bot = {
        ...base,
        abilities: [5],
        abilityState: { 5: { stage: "ready", remainingMs: 0 } },
    };
    const fired = applyBotAction(bot, { abilityAction: { action: 5 } }, 100);
    assert.equal(fired.triggeredAbility, 5);
    assert.equal(activeRemainingMs(fired, 5), 500);
    assert.equal(cooldownRemainingMs(fired, 5), 0);
    assert.equal(pendingCooldownMs(fired, 5), 5500);
    assert.equal(abilityRecord(fired, 5)?.charges, undefined);

    const active = tickBotState(fired, 400);
    assert.equal(activeRemainingMs(active, 5), 100);
    assert.equal(cooldownRemainingMs(active, 5), 0);
    assert.equal(pendingCooldownMs(active, 5), 5500);
    const recoveryStarted = tickBotState(active, 100);
    assert.equal(activeRemainingMs(recoveryStarted, 5), 0);
    assert.equal(cooldownRemainingMs(recoveryStarted, 5), 5500);
    assert.equal(pendingCooldownMs(recoveryStarted, 5), 0);
    const nearlyReady = tickBotState(recoveryStarted, 5400);
    assert.equal(cooldownRemainingMs(nearlyReady, 5), 100);
    const ready = tickBotState(nearlyReady, 100);
    assert.equal(cooldownRemainingMs(ready, 5), 0);
});

test("Pistol reload waits until its active window ends after the final charge", () => {
    const bot = {
        ...base,
        abilities: [12],
        abilityState: { 12: { stage: "ready", remainingMs: 0, charges: 1, reloadMs: 0 } },
    };
    const fired = applyBotAction(bot, { abilityAction: { action: 12 } }, 100);
    assert.equal(abilityRecord(fired, 12)?.charges, 0);
    assert.equal(cooldownRemainingMs(fired, 12), 0);
    assert.equal(abilityRecord(fired, 12)?.reloadMs, 3_000);

    const active = tickBotState(fired, 200);
    assert.equal(activeRemainingMs(active, 12), 100);
    assert.equal(abilityRecord(active, 12)?.reloadMs, 3_000);

    const activeEnded = tickBotState(active, 100);
    assert.equal(activeRemainingMs(activeEnded, 12), 0);
    assert.equal(abilityRecord(activeEnded, 12)?.reloadMs, 3_000);

    const reloading = tickBotState(activeEnded, 100);
    assert.equal(abilityRecord(reloading, 12)?.reloadMs, 2_900);
});

test("Disruptive Beam uses its full 0.2 second preparation before activating", () => {
    const beamBot = {
        ...base,
        abilities: [30],
        abilityState: { 30: { stage: "ready", remainingMs: 0 } },
    };
    const action = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 30 } };

    const firstTick = applyBotAction(beamBot, action, 100);
    assert.equal(firstTick.triggeredAbility, null);
    assert.equal(preparingAbilityId(firstTick), 30);
    assert.equal(preparingRemainingMs(firstTick), 100);

    const secondTick = applyBotAction(firstTick, action, 100);
    assert.equal(secondTick.triggeredAbility, 30);
    assert.equal(preparingAbilityId(secondTick), null);
});

test("entity damage and hostile DOT use the same HP-loss stagger settlement", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, hp: 100, maxHp: 100 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, maxHp: 100 };
    const fireball = { id: "fireball", type: "fireball", ownerId: "owner", ownerSlot: 1, x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const projectile = tickAbilityEntityWorld({ bots: [owner, target], entities: [fireball], stepMs: 50, width: 1000, height: 800 });
    assert.equal(statusRemainingMs(projectile.bots[1], "hit-stagger"), 300);

    const slashAttacker = { id: "slash-owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const [, bleeding] = resolveAbilityCombat(slashAttacker, { id: "bleeding", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 });
    const bleedTick = tickBotStatus(bleeding, 1000);
    assert.equal(bleedTick.hp, 68);
    assert.equal(statusRemainingMs(bleedTick, "hit-stagger"), 300);
});

test("Concussive Shot remains independent and wins the combined movement multiplier", () => {
    assert.equal(CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER, 0.50);
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 9 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, target);
    assert.equal(hit.hp, 80);
    assert.equal(statusRemainingMs(hit, "slow"), 3000);
    assert.equal(statusRemainingMs(hit, "hit-stagger"), 300);

    const moved = applyBotAction({ ...hit, x: 200, moveSpeed: 10, movementVelocityX: 10 }, { dx: 1, dy: 0 }, 100);
    assert.equal(moved.x, 205);
    assert.equal(statusRemainingMs(moved, "slow"), 2900);
    assert.equal(statusRemainingMs(moved, "hit-stagger"), 200);
    const ordinaryHit = dealDamage({ ...moved, hp: 80, statusEffects: [status("slow", 1000)] }, 1, attacker);
    assert.equal(statusRemainingMs(ordinaryHit, "slow"), 1000);
});

test("damage to an arena entity does not stagger either bot", () => {
    const bots = [
        { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, maxHp: 100 },
        { id: "target", slot: 2, x: 900, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, triggeredAbility: 3 },
    ];
    const result = tickAbilityEntityWorld({
        entities: [entityFor(bots[0], 17)], bots,
        stepMs: 100, width: 1000, height: 800,
    });
    // The Gun's 40 damage leaves the 50 HP drone alive.
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].hp, 10);
    assert.equal(statusRemainingMs(result.bots[0], "hit-stagger"), 0);
    assert.equal(statusRemainingMs(result.bots[1], "hit-stagger"), 0);
});

test("a heavy slash damages normally while its attached bleed still applies", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [2], abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } } };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.ok(hit.hp < 100);
    assert.equal(abilityRecord(hit, 2)?.charges, 25);
    assert.equal(activeRemainingMs(hit, 2), 1);
    assert.equal(statusRemainingMs(hit, "bleed"), 5000);
});

test("Concussive and rail shots apply damage and attached effects without blocking", () => {
    for (const ability of [9, 13]) {
        const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const defender = { id: "target", x: 190, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [2], abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } } };
        const [, hit] = resolveAbilityCombat(attacker, defender);
        assert.ok(hit.hp < 100, ability);
        assert.equal(abilityRecord(hit, 2)?.charges, 25, ability);
        if (ability === 9) {
            assert.equal(statusRemainingMs(hit, "slow"), 3000, ability);
            assert.equal(statusRemainingMs(hit, "shock"), 0, ability);
        } else {
            assert.equal(statusRemainingMs(hit, "slow"), 0, ability);
            assert.equal(statusRemainingMs(hit, "shock"), 3000, ability);
        }
    }
});

test("Repelling Blast deals 20 damage and pushes 300 units without blocking", () => {
    const attacker = { id: "owner", x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 8 };
    const defender = { id: "target", x: 180, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 80);
    assert.equal(hit.x, 480);

    const [, staleStateHit] = resolveAbilityCombat(attacker, { ...defender, rotation: 270, abilities: [2], abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } } });
    assert.equal(staleStateHit.hp, 80);
    assert.equal(abilityRecord(staleStateHit, 2)?.charges, 25);
    assert.equal(staleStateHit.x, 480);
});

test("Frost Ring composes damage, slow, and knockback without blocking", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: 26 };
    const defender = { id: "target", slot: 2, x: 180, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [, hit] = resolveAbilityCombat(attacker, defender);
    assert.equal(hit.hp, 85);
    assert.equal(statusRemainingMs(hit, "slow"), 2000);
    assert.equal(hit.x, 240);

    const [, staleStateHit] = resolveAbilityCombat(attacker, {
        ...defender,
        rotation: 270,
        abilities: [2],
        abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } },
    });
    assert.equal(staleStateHit.hp, 85);
    assert.equal(abilityRecord(staleStateHit, 2)?.charges, 25);
    assert.equal(statusRemainingMs(staleStateHit, "slow"), 2000);
    assert.equal(staleStateHit.x, 240);
});

test("Singularity pulls during its fuse and applies one generic zone detonation", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, attackDamageMultiplier: 1 };
    const target = { id: "target", slot: 2, x: 300, y: 100, size: 60, hp: 100, maxHp: 100 };
    const singularity = entityFor(owner, 27, { targetX: 200, targetY: 100, clamp: (value) => value });
    let world = { entities: [singularity], bots: [target], stepMs: 100, width: 1000, height: 800 };
    for (let tick = 0; tick < 11; tick += 1) {
        const result = tickAbilityEntityWorld(world);
        world = { ...world, entities: result.entities, bots: result.bots };
    }
    assert.ok(world.bots[0].x < 300);
    assert.equal(world.bots[0].hp, 100);

    const detonated = tickAbilityEntityWorld(world);
    assert.ok(detonated.bots[0].hp < 100);
    assert.equal(detonated.entities[0].id, singularity.id);
    assert.equal(detonated.entities[0].type, "singularityZone");
    assert.equal(detonated.entities[0].phaseId, "active");
    assert.equal(visualForShape(detonated.entities[0]).type, "singularityExplosion");
    const hpAfterDetonation = detonated.bots[0].hp;
    const after = tickAbilityEntityWorld({ ...world, entities: detonated.entities, bots: detonated.bots });
    assert.equal(after.bots[0].hp, hpAfterDetonation);
});

test("Orbital Strike winds up for five ticks and pulses four times for flat damage", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, attackDamageMultiplier: 1 };
    const target = { id: "target", slot: 2, x: 200, y: 100, size: 60, hp: 100, maxHp: 100 };
    const orbital = entityFor(owner, 22, { targetX: 200, targetY: 100, clamp: (value) => value });
    assert.equal(orbital.remainingMs, 1500);
    assert.deepEqual(orbital.eventScheduleState, {});
    assert.equal(ABILITY_STATS[22].windupMs, 500);
    assert.equal(ABILITY_STATS[22].activeMs, 0);
    assert.equal(ABILITY_STATS[22].durationMs, 1500);
    assert.equal(amountAtDistance(22, 0), 15);
    assert.equal(amountAtDistance(22, 100), 15);

    let world = { entities: [orbital], bots: [target], stepMs: 100, width: 1000, height: 800 };
    const pulseTicks = [];
    for (let tick = 0; tick < 16; tick += 1) {
        const beforeHp = world.bots[0].hp;
        const result = tickAbilityEntityWorld(world);
        if (result.bots[0].hp < beforeHp) pulseTicks.push(tick);
        world = { ...world, entities: result.entities, bots: result.bots };
    }

    assert.deepEqual(pulseTicks, [0, 4, 9, 14]);
    assert.equal(world.bots[0].hp, 40);
    // The final pulse's visual is emitted before the gameplay entity expires;
    // the renderer owns that event visual after the entity is removed.
    assert.equal(world.entities.length, 0);
});

test("Wind Burst is a five-tick projectile with 20 damage and 250 knockback", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, attackDamageMultiplier: 1 };
    const projectile = entityFor(attacker, 18);
    assert.equal(projectile.type, "windburstProjectile");
    assert.equal(ABILITY_STATS[18].knockback, 250);
    assert.equal(phaseEffects(ENTITY_CONTRACTS[18].phases[0])
        .find((effect) => effect.type === EFFECT_TYPES.KNOCKBACK).amount, 250);
    assert.equal(projectile.velocityX, 44);
    assert.equal(projectile.velocityY, 0);
    assert.equal(projectile.size, 24);

    let world = { entities: [projectile], bots: [attacker], stepMs: 100, width: 1000, height: 800 };
    for (let tick = 0; tick < 4; tick += 1) {
        const result = tickAbilityEntityWorld(world);
        assert.equal(result.entities[0].traveled, (tick + 1) * 44);
        world = { ...world, entities: result.entities, bots: result.bots };
    }
    assert.equal(tickAbilityEntityWorld(world).entities.length, 0);

    const target = { id: "target", slot: 2, x: 210, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100 };
    const hit = tickAbilityEntityWorld({ entities: [projectile], bots: [attacker, target], stepMs: 100, width: 1000, height: 800 });
    assert.equal(hit.bots[1].hp, 80);
    assert.equal(hit.bots[1].x, 460);
    assert.equal(hit.entities.length, 0);
});

test("absolute guard rejects damage, statuses, and displacement without changing stale state", () => {
    const guarded = {
        id: "target", slot: 2, x: 180, y: 100, size: 60, rotation: 180,
        hp: 100, maxHp: 100, statusEffects: [status("absolute-guard", 1000)],
        abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } },
    };
    assert.deepEqual(dealDamage(guarded, 50), guarded);

    for (const ability of [7, 13, 9, 8, 18]) {
        const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, attackDamageMultiplier: 1, triggeredAbility: ability };
        const [, result] = resolveAbilityCombat(attacker, guarded);
        assert.equal(result.hp, 100, ability);
        assert.equal(result.x, 180, ability);
        assert.equal(abilityRecord(result, 2)?.charges, 25, ability);
        assert.equal(statusRemainingMs(result, "bleed"), 0, ability);
        assert.equal(statusRemainingMs(result, "shock"), 0, ability);
        assert.equal(statusRemainingMs(result, "slow"), 0, ability);
    }
});

test("absolute guard rejects persistent entity zones, pulses, mines, and strikes", () => {
    const guarded = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, statusEffects: [status("absolute-guard", 1000)] };
    const arena = { bots: [guarded], stepMs: 100, width: 1000, height: 1000 };

    const silence = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 15);
    const silenced = tickAbilityEntityWorld({ ...arena, entities: [silence] }).bots[0];
    assert.equal(statusRemainingMs(silenced, "silence"), 0);
    assert.equal(statusRemainingMs(silenced, "stun"), 0);

    const gravity = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 14), x: 100, y: 100, traveled: 176, fuseMs: 1000 };
    const pulled = tickAbilityEntityWorld({ ...arena, entities: [gravity] }).bots[0];
    assert.equal(pulled.x, 150);
    assert.equal(pulled.y, 100);

    const zone = entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 24, { targetX: 150, targetY: 100, clamp: (value) => value });
    const zoned = tickAbilityEntityWorld({ ...arena, entities: [zone] }).bots[0];
    assert.equal(statusIsActive(zoned, "silence"), false);

    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true };
    const orbital = { ...entityFor({ id: "owner", slot: 1 }, 22, { targetX: 150, targetY: 100, clamp: (value) => value }), fuseMs: 100 };
    const struck = tickAbilityEntityWorld({ ...arena, entities: [mine, orbital] }).bots[0];
    assert.equal(struck.hp, 100);
});

test("retired Block cannot activate or create a charge resource", () => {
    const bot = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, abilities: [], abilityState: {} };
    const next = applyBotAction(bot, { abilityAction: { action: 2 } }, 100);
    assert.equal(next.triggeredAbility ?? null, null);
    assert.equal(activeRemainingMs(next, 2), 0);
    assert.equal(cooldownRemainingMs(next, 2), 0);
    assert.equal(ABILITY_STATS[2], undefined);
});

test("bot resources and lifecycle advance through their own generic component contracts", () => {
    const bot = {
        hp: 100,
        matchElapsedMs: 50,
        hitFlashMs: 100,
        abilityVisual: { ability: 3, ms: 100 },
        triggeredAbility: 3,
        abilitySpawn: [{ id: "spawned" }],
        entityHitIds: ["target"],
        damageTakenThisTick: 12,
        abilityState: { 3: { stage: "active", remainingMs: 100, cooldownMs: 100, charges: 8, reloadMs: 0 } },
    };

    const resourced = tickBotResources(bot, 50);
    assert.equal(cooldownRemainingMs(resourced, 3), 0);
    assert.equal(pendingCooldownMs(resourced, 3), 100);
    assert.equal(activeRemainingMs(resourced, 3), 50);
    assert.equal(resourced.matchElapsedMs, 50);

    const lifecycled = tickBotLifecycle(resourced, 50);
    assert.equal(lifecycled.matchElapsedMs, 100);
    assert.equal(lifecycled.hitFlashMs, 50);
    assert.equal(lifecycled.abilityVisual.ms, 50);
    assert.equal(lifecycled.triggeredAbility, null);
    assert.deepEqual(lifecycled.abilitySpawn, []);
    assert.deepEqual(lifecycled.entityHitIds, []);
    assert.equal(lifecycled.damageTakenThisTick, 0);
});

test("null zone silence is presence-based while silence pulse remains timed", () => {
    const zone = entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 24, { targetX: 300, targetY: 300, clamp: (value) => value });
    const inside = { id: "target", slot: 2, x: 300, y: 300, size: 60, hp: 100, statusEffects: [] };
    const inZone = tickAbilityEntityWorld({ entities: [zone], bots: [inside], stepMs: 50, width: 1000, height: 800 });
    assert.equal(statusIsActive(inZone.bots[0], "silence"), true);
    assert.equal(statusRemainingMs(inZone.bots[0], "silence"), 0);

    const movedOut = { ...inZone.bots[0], x: 800, y: 700 };
    const outOfZone = tickAbilityEntityWorld({ entities: inZone.entities, bots: [movedOut], stepMs: 50, width: 1000, height: 800 });
    assert.equal(statusIsActive(outOfZone.bots[0], "silence"), false);
    assert.equal(statusRemainingMs(outOfZone.bots[0], "silence"), 0);
});

test("combat visual timing preserves centered pulses, sword sweeps, and pistol fade", () => {
    assert.equal(sweepAngle(400, 400, -60, 60), -60);
    assert.ok(Math.abs(sweepAngle(300, 400, -60, 60) - (-20)) < 0.0001);
    assert.ok(Math.abs(sweepAngle(200, 400, -60, 60) - 20) < 0.0001);
    assert.equal(sweepAngle(100, 400, -60, 60), 60);
    const heavyHalfArc = Number(ABILITY_STATS[7].arc) / 2;
    assert.equal(sweepAngle(400, 400, -heavyHalfArc, heavyHalfArc), -75);
    assert.equal(sweepAngle(100, 400, -heavyHalfArc, heavyHalfArc), 75);
    assert.equal(abilityVisualOpacity({ abilityVisual: { ability: 12, ms: 150 } }, 12), 0.5);
    assert.equal(abilityVisualOpacity({ abilityState: { 12: { stage: "active", remainingMs: 150 } } }, 12), 0.5);
    assert.equal(combatVisualRemainingMs({ abilityState: { 7: { stage: "active", remainingMs: 250 } } }, 7), 250);
    assert.equal(abilityVisualOpacity({ abilityVisual: null }, undefined), 0);
});

test("Repelling Blast presentation advances all ten frames over 500 ms without exceeding its hitbox", () => {
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
    assert.equal(settleHealing(activated).hp, 100);
    assert.equal(ABILITY_STATS[10].cooldownMs, 11700);
    assert.equal(ABILITY_STATS[10].windupMs, 800);
});

test("Vampiric Beam heals its source only after confirmed HP damage", () => {
    const attacker = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 90, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 32 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 180, hp: 100, maxHp: 100 };
    const [hitAttacker, hitTarget] = resolveAbilityCombat(attacker, target);
    assert.equal(hitTarget.hp, 76);
    assert.equal(settleHealing(hitAttacker).hp, 100);

    const [missAttacker] = resolveAbilityCombat(attacker, { ...target, x: 100, y: 300 });
    assert.equal(missAttacker.pendingHealing ?? 0, 0);

    const [staleStateAttacker, staleStateTarget] = resolveAbilityCombat(attacker, {
        ...target,
        rotation: 270,
        abilities: [2],
        abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } },
    });
    assert.equal(staleStateTarget.hp, 76);
    assert.equal(settleHealing(staleStateAttacker).hp, 100);
});

test("defensive and status abilities use preparation plus status duration, not active time", () => {
    const cast = (abilityId) => {
        let bot = {
            id: `caster-${abilityId}`, slot: 1, x: 100, y: 100, size: 60, rotation: 0,
            hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
            attackDamageMultiplier: 1, abilities: [abilityId],
            abilityState: { [abilityId]: { stage: "ready", remainingMs: 0 } },
        };
        for (let tick = 0; tick < 5; tick += 1) {
            bot = applyBotAction(bot, { abilityAction: { action: abilityId } }, 100);
        }
        return bot;
    };

    const reactiveArmorCast = cast(16);
    assert.equal(reactiveArmorCast.triggeredAbility, 16);
    assert.equal(activeRemainingMs(reactiveArmorCast, 16), 0);
    const [reactiveArmor] = resolveAbilityCombat(reactiveArmorCast, null);
    assert.equal(statusRemainingMs(reactiveArmor, "reactive-armor"), 4000);
    assert.equal(dealDamage({ ...reactiveArmor, hp: 100 }, 20, { slot: 2 }).hp, 90);
    const reflected = { id: "attacker", slot: 2, hp: 100, maxHp: 100 };
    dealDamage({ ...reactiveArmor, hp: 100 }, 20, reflected, { reflectTo: reflected });
    assert.equal(reflected.hp, 90);

    const absoluteGuardCast = cast(23);
    assert.equal(absoluteGuardCast.triggeredAbility, 23);
    assert.equal(activeRemainingMs(absoluteGuardCast, 23), 0);
    const [absoluteGuard] = resolveAbilityCombat(absoluteGuardCast, null);
    assert.equal(statusRemainingMs(absoluteGuard, "absolute-guard"), 1500);
    assert.equal(dealDamage({ ...absoluteGuard, hp: 100 }, 20, { slot: 2 }).hp, 100);

    const orbitalCast = cast(22);
    assert.equal(orbitalCast.triggeredAbility, 22);
    assert.equal(activeRemainingMs(orbitalCast, 22), 0);
    assert.equal(orbitalCast.abilitySpawn[0].remainingMs, 1500);

    let nullZoneCast = {
        id: "caster-24", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [24],
        abilityState: { 24: { stage: "ready", remainingMs: 0 } },
    };
    for (let tick = 0; tick < 10; tick += 1) {
        nullZoneCast = applyBotAction(nullZoneCast, { abilityAction: { action: 24, targetX: 300, targetY: 300 } }, 100);
    }
    assert.equal(nullZoneCast.triggeredAbility, 24);
    assert.equal(activeRemainingMs(nullZoneCast, 24), 300);
    assert.equal(nullZoneCast.abilitySpawn[0].remainingMs, 5000);

    const overclockCast = cast(33);
    assert.equal(overclockCast.triggeredAbility, 33);
    assert.equal(activeRemainingMs(overclockCast, 33), 0);
    const [overclock] = resolveAbilityCombat(overclockCast, null);
    assert.equal(statusRemainingMs(overclock, "overclock"), 4000);
});

test("stun uses a two-tick wind-up followed by a one-tick active window", () => {
    const bot = {
        id: "stun-caster", slot: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [6],
        abilityState: { 6: { stage: "ready", remainingMs: 0 } },
    };
    const preparing = applyBotAction(bot, { abilityAction: { action: 6 } }, 100);
    assert.equal(preparing.triggeredAbility, null);
    assert.equal(preparingAbilityId(preparing), 6);
    assert.equal(preparingRemainingMs(preparing), 100);

    const active = applyBotAction(preparing, { abilityAction: { action: 6 } }, 100);
    assert.equal(active.triggeredAbility, 6);
    assert.equal(preparingAbilityId(active), null);
    assert.equal(activeRemainingMs(active, 6), 100);
});

test("the global ability lock includes preparation, not only active time", () => {
    const preparing = { abilityState: { 16: { stage: "windup", remainingMs: 100 } } };
    assert.equal(anotherAbilityActive(preparing, 1), true);
    assert.equal(anotherAbilityActive(preparing, 16), false);

    // Dash ignores the lock both ways: a running dash blocks nothing, and nothing blocks a dash.
    assert.equal(anotherAbilityActive({ abilityState: { 19: { stage: "active", remainingMs: 200 } } }, 1), false);
    assert.equal(anotherAbilityActive({ abilityState: { 1: { stage: "active", remainingMs: 200 } } }, 19), false);
    assert.equal(anotherAbilityActive({ abilityState: { 16: { stage: "windup", remainingMs: 100 } } }, 19), false);
    assert.equal(anotherAbilityActive({ abilityState: { 5: { stage: "active", remainingMs: 200 } } }, 1), true);
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
        abilityState: { 33: { stage: "active", remainingMs: 3000 }, 1: { stage: "cooldown", remainingMs: 1000 } },
    }, 100);
    assert.equal(cooldownRemainingMs(ticked, 1), 900);
    assert.equal(statusRemainingMs(ticked, "overclock"), 3900);

    const accelerated = applyBotAction({
        ...active,
        abilities: [33, 1],
        attackSpeedMultiplier: 1,
        abilityState: { 33: { stage: "ready", remainingMs: 0 }, 1: { stage: "ready", remainingMs: 0 } },
    }, { abilityAction: { action: 1 } }, 100);
    assert.equal(accelerated.triggeredAbility, 1);
    assert.equal(cooldownRemainingMs(accelerated, 1), 0);
    assert.equal(pendingCooldownMs(accelerated, 1), 250);

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
    const heavyHalfArc = Number(ABILITY_STATS[7].arc) / 2;
    assert.equal(sweepAngle(slash.abilityVisual.ms, 400, -heavyHalfArc, heavyHalfArc), -75);
});

test("slash keeps its full visual timer through the activation step", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [1],
        abilityState: { 1: { stage: "ready", remainingMs: 0 } },
    };
    const active = applyBotAction(bot, { abilityAction: { action: 1 } }, 100);
    assert.equal(activeRemainingMs(active, 1), 300);
    assert.equal(sweepAngle(activeRemainingMs(active, 1), 300, -60, 60), -60);
    assert.equal(active.triggeredAbility, 1);
});

test("slash hit resolves only on its activation tick while its animation continues", () => {
    const defender = { x: 190, y: 100, size: 20 };
    assert.equal(abilityHitsTarget({ x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] }, defender), true);
    assert.equal(abilityHitsTarget({ x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: null, abilities: [1] }, defender), false);
});

test("slash hitbox uses the inclusive 120-degree, 92-unit sector", () => {
    const attacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] };
    for (const offset of [-60, 60]) assert.equal(abilityHitsTarget(attacker, targetAtBearing(attacker, 80, attacker.rotation + offset)), true, `at ${offset} degrees`);
    for (const offset of [-68, 68]) assert.equal(abilityHitsTarget(attacker, targetAtBearing(attacker, 80, attacker.rotation + offset)), false, `outside ${offset} degrees`);
});

test("heavy slash hitbox matches the inclusive 150-degree, 115-unit sweep", () => {
    assert.equal(ABILITY_STATS[1].range, 92);
    assert.equal(ABILITY_STATS[7].range, 115);
    const attacker = { id: "owner", x: 100, y: 100, rotation: 90, size: 60, hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 7 };
    for (const offset of [-75, 75]) {
        const target = { id: `target-${offset}`, ...targetAtBearing(attacker, 80, attacker.rotation + offset), hp: 100, maxHp: 100 };
        assert.ok(resolveAbilityCombat(attacker, target)[1].hp < 100, `at ${offset} degrees`);
    }
    for (const offset of [-83, 83]) {
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
    const phaseAtRange = { id: "target", x: 230, y: 100, size: defenderSize, rotation: 270, hp: 100, maxHp: 100 };
    assert.ok(resolveAbilityCombat(phaseAttacker, phaseAtRange)[1].hp < 100);
    assert.equal(resolveAbilityCombat(phaseAttacker, { ...phaseAtRange, x: 231 })[1].hp, 100);
    assert.ok(resolveAbilityCombat(phaseAttacker, { ...phaseAtRange, x: 150, y: 160 })[1].hp < 100);
    assert.equal(resolveAbilityCombat(phaseAttacker, { ...phaseAtRange, x: 100, y: 161 })[1].hp, 100);

    const stunAttacker = { x: 100, y: 100, rotation: 90, triggeredAbility: 6, abilities: [6] };
    assert.equal(abilityHitsTarget(stunAttacker, { x: 100 + 184 + defenderRadius, y: 100, size: defenderSize }), true);
    assert.equal(abilityHitsTarget(stunAttacker, { x: 100 + 184 + defenderRadius + 1, y: 100, size: defenderSize }), false);
    assert.equal(abilityHitsTarget(stunAttacker, { x: 100 + 92, y: 100 + 40 + defenderRadius, size: defenderSize }), true);
    assert.equal(abilityHitsTarget(stunAttacker, { x: 100 + 92, y: 100 + 40 + defenderRadius + 1, size: defenderSize }), false);
});

test("direct melee hitboxes sweep across a moving defender", () => {
    const attacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: 1, abilities: [1] };
    const defender = {
        x: 300, y: 100, size: 60,
        movementStartX: 160, movementStartY: 100,
    };

    assert.equal(abilityHitsTarget(attacker, defender), true);
});

test("instantaneous rays use their configured finite width for collision", () => {
    for (const [ability, width] of [[3, 6], [30, 8], [32, 10]]) {
        const attacker = { x: 100, y: 100, rotation: 90, size: 60, triggeredAbility: ability, abilities: [ability] };
        const edgeOffset = 30 + width / 2;
        assert.equal(
            abilityHitsTarget(attacker, { x: 200, y: 100 + edgeOffset - 0.1, size: 60 }),
            true,
            `${ability} should hit inside its ray width`,
        );
        assert.equal(
            abilityHitsTarget(attacker, { x: 200, y: 100 + edgeOffset + 0.1, size: 60 }),
            false,
            `${ability} should miss outside its ray width`,
        );
    }
});

test("a prepared ability cannot be replaced by another ready ability", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [9, 12],
        abilityState: { 9: { stage: "ready", remainingMs: 0 }, 12: { stage: "ready", remainingMs: 0 } },
    };
    const preparing = applyBotAction(bot, { abilityAction: { action: 9 } }, 100);
    const stillPreparing = applyBotAction(preparing, { abilityAction: { action: 12 } }, 100);
    assert.equal(preparingAbilityId(stillPreparing), 9);
    assert.equal(preparingRemainingMs(stillPreparing), 800);
    assert.equal(cooldownRemainingMs(stillPreparing, 12), 0);
});

test("ability preparation does not interrupt movement or rotation", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [9],
        abilityState: { 9: { stage: "ready", remainingMs: 0 } },
    };
    const action = { dx: 1, dy: 0, dRot: 1, abilityAction: { action: 9 } };

    const first = applyBotAction(bot, action, 100);
    assert.equal(first.x, 108);
    assert.equal(first.rotation, 12);
    assert.equal(preparingAbilityId(first), 9);

    const second = applyBotAction(first, action, 100);
    assert.equal(second.x, 116);
    assert.equal(second.rotation, 24);
    assert.equal(preparingAbilityId(second), 9);
    assert.equal(preparingRemainingMs(second), 800);
});

test("special activation keeps the full authoritative active and cooldown timers", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [12],
        abilityState: { 12: { stage: "ready", remainingMs: 0 } },
    };
    const active = applyBotAction(bot, { abilityAction: { action: 12 } }, 100);
    assert.equal(activeRemainingMs(active, 12), 300);
    assert.equal(cooldownRemainingMs(active, 12), 0);
    assert.equal(pendingCooldownMs(active, 12), 400);
});

test("Repelling Blast browser activation keeps its 500 ms presentation timer", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [8],
        abilityState: { 8: { stage: "ready", remainingMs: 0 } },
    };
    const active = applyBotAction(bot, { abilityAction: { action: 8 } }, 100);
    assert.equal(activeRemainingMs(active, 8), 500);
});

test("Phase Strike damages normally and still teleports through stale retired state", () => {
    const attacker = {
        id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 25,
    };
    const defender = {
        id: "target", slot: 2, x: 200, y: 100, size: 60, rotation: 270,
        hp: 100, maxHp: 100, abilities: [2],
        abilityState: { 2: { stage: "active", remainingMs: 100, charges: 25 } },
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
    assert.equal(abilityRecord(hit, 2)?.charges, 25);
});

test("Phase Strike uses one edge-inclusive forward rectangle for every target and teleports through the nearest hit", () => {
    const attacker = {
        id: "owner", slot: 1, teamNumber: 1, x: 100, y: 100, size: 60, rotation: 90,
        hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 25,
    };
    const farTarget = {
        id: "far", slot: 3, teamNumber: 2, x: 190, y: 100, size: 60, hp: 100, maxHp: 100,
    };
    const nearTarget = {
        id: "near", slot: 2, teamNumber: 2, x: 160, y: 100, size: 60, hp: 100, maxHp: 100,
    };
    const outsideTarget = {
        id: "outside", slot: 4, teamNumber: 2, x: 150, y: 161, size: 60, hp: 100, maxHp: 100,
    };

    const [nextAttacker, nextFar, nextNear, nextOutside] = resolveTriggeredAbilityCombatForRoster([
        attacker, farTarget, nearTarget, outsideTarget,
    ]);

    assert.equal(nextFar.hp, 85);
    assert.equal(nextNear.hp, 85);
    assert.equal(nextOutside.hp, 100);
    assert.equal(nextAttacker.x, 220);
    assert.equal(nextAttacker.y, 100);
});

test("Phase Strike landing rotation is relative to the activation facing", () => {
    const attacker = {
        id: "owner", slot: 1, teamNumber: 1, x: 100, y: 100, size: 60, rotation: 30,
        hp: 100, maxHp: 100, attackDamageMultiplier: 1, triggeredAbility: 25,
        triggeredPhaseFacingMode: 90,
    };
    const target = {
        id: "target", slot: 2, teamNumber: 2, x: 160, y: 100, size: 60, hp: 100, maxHp: 100,
    };

    const [nextAttacker, nextTarget] = resolveTriggeredAbilityCombatForRoster([attacker, target]);

    assert.equal(nextAttacker.x, 220);
    assert.equal(nextAttacker.y, 100);
    assert.equal(nextAttacker.rotation, 120);
    assert.equal(nextTarget.hp, 85);
});

test("Rewind creates a passive targetable clock zone", () => {
    const bot = {
        id: "main", slot: 1, x: 240, y: 360, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [21],
        abilityState: { rewind: { stage: "ready", remainingMs: 0 } },
    };
    const active = applyBotAction(bot, { abilityAction: { action: 21 } }, 100);
    assert.equal(active.abilitySpawn[0].type, "temporalRewindZone");
    assert.equal(active.abilitySpawn[0].x, 240);
    assert.equal(active.abilitySpawn[0].y, 360);
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

test("sniper activation retains a fading ray for the active duration", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [3],
        abilityState: { 3: { stage: "ready", remainingMs: 0 } },
    };
    // One 900 ms step consumes the whole wind-up and releases the shot.
    const active = applyBotAction(bot, { abilityAction: { action: 3 } }, 900);
    assert.equal(active.triggeredAbility, 3);
    assert.equal(activeRemainingMs(active, 3), 200);
    assert.equal(abilityActiveOpacity(active, 3), 1);
    const faded = tickBotState(active, 150);
    assert.equal(abilityActiveOpacity(faded, 3), 0.25);
});

test("sniper collision uses the captured firing pose after the bot moves", () => {
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [3],
        abilityState: { 3: { stage: "ready", remainingMs: 0 } },
    };
    const fired = applyBotAction(bot, { abilityAction: { action: 3 } }, 900);
    const movedAfterFiring = { ...fired, x: 1000, y: 100, rotation: 180 };
    assert.equal(abilityHitsTarget(movedAfterFiring, { x: 100, y: 0, size: 20 }), true);
});

test("a dead bot clears one-tick attacks while their visuals finish", () => {
    const dead = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 0, maxHp: 100, abilities: [3, 13],
        triggeredAbility: 13,
        abilitySpawn: [{ id: "already-spawned" }],
        abilityState: { 3: { stage: "active", remainingMs: 900 }, 1: { stage: "active", remainingMs: 300 }, 6: { stage: "active", remainingMs: 250 }, 9: { stage: "windup", remainingMs: 250 } },
    };

    const next = applyBotAction(dead, { abilityAction: { action: 3 } }, 50);

    assert.equal(next.triggeredAbility, null);
    assert.deepEqual(next.abilitySpawn, []);
    assert.equal(preparingAbilityId(next), 9);
    assert.equal(preparingRemainingMs(next), 250);
    assert.equal(activeRemainingMs(next, 3), 850);
    assert.ok(abilityActiveOpacity(next, 3) > 0);
});

test("a ray from a bot killed after firing cannot damage again", () => {
    const attacker = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0,
        hp: 0, maxHp: 100, abilities: [3], triggeredAbility: 3,
        attackDamageMultiplier: 1,
        abilityState: { 3: { stage: "active", remainingMs: 900 } },
    };
    const defender = { id: "opponent-model", slot: 2, x: 200, y: 100, size: 60, hp: 100, maxHp: 100 };

    const cleared = applyBotAction(attacker, {}, 50);
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
        temporalRewindMs: 2000, temporalRewindPulseMs: 300,
        pendingHealing: 20,
        abilityState: { 2: { stage: "active", remainingMs: 1 }, 16: { stage: "active", remainingMs: 2000 }, 5: { stage: "cooldown", remainingMs: 5000 }, 13: { stage: "windup", remainingMs: 450 } },
    };

    const dead = dealDamage(bot, 10);

    assert.equal(dead.hp, 0);
    assert.deepEqual(botStatusLabels(dead), []);
    assert.deepEqual(abilityIdsInStage(dead, "active"), []);
    assert.equal(statusIsActive(dead, "silence"), false);
    assert.equal(statusRemainingMs(dead, "shock"), 0);
    assert.equal(statusRemainingMs(dead, "burn"), 0);
    assert.equal(statusRemainingMs(dead, "bleed"), 0);
    assert.equal(dead.temporalRewindMs, 0);
    assert.equal(dead.pendingHealing, 0);
    assert.equal(preparingAbilityId(dead), 13);
    assert.equal(preparingRemainingMs(dead), 450);
    assert.equal(cooldownRemainingMs(dead, 5), 5000);
});

test("an ALWAYS code action reaches the real Sniper executor", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [{ priority: 1, branches: [{ id: "always-fire", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [{ action: 3 }], children: [] }] }],
    };
    const snapshot = {
        playerModel: { id: "main", x: 100, y: 100, rotation: 0, abilities: [3], abilityState: { 3: { stage: "ready", remainingMs: 0 } } },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 500, y: 100, size: 60, hp: 100 }],
    };
    const action = buildDeterministicLogicAction(configuration, snapshot);
    const bot = { id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [3], abilityState: { 3: { stage: "ready", remainingMs: 0, charges: 6, reloadMs: 0 } } };
    const preparing = applyBotAction(bot, action, 100);
    assert.equal(preparingAbilityId(preparing), 3);
    assert.equal(preparing.triggeredAbility, null);
    const result = applyBotAction(preparing, action, 800);
    assert.equal(action.abilityAction.action, 3);
    assert.equal(action.abilityAction.abilityPayload.abilityId, 3);
    assert.equal(action.abilityAction.abilityPayload.activation.capture.gunRayOriginX, "x");
    assert.equal(action.abilityAction.targetX, undefined);
    assert.equal(action.abilityAction.targetY, undefined);
    assert.equal(action.gun, undefined);
    assert.equal(result.triggeredAbility, 3);
    assert.equal(abilityRecord(result, 3)?.charges, undefined);
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
        abilities: [5, 9],
        abilityState: { 5: { stage: "ready", remainingMs: 0, charges: 4, reloadMs: 0 }, 9: { stage: "ready", remainingMs: 0 } },
    };

    const fireballFirstAction = buildDeterministicLogicAction(configuration(5, 9), buildStatePayload([bot, opponent], "custom"));
    const afterFireball = applyBotAction(bot, fireballFirstAction, 50);
    const concussiveNextAction = buildDeterministicLogicAction(configuration(5, 9), buildStatePayload([afterFireball, opponent], "custom"));
    const preparingAfterFireball = applyBotAction(afterFireball, concussiveNextAction, 50);
    assert.equal(fireballFirstAction.abilityAction.action, 5);
    assert.equal(concussiveNextAction.abilityAction, null);
    assert.equal(preparingAbilityId(preparingAfterFireball), null);
    assert.ok(activeRemainingMs(preparingAfterFireball, 5) > 0);

    let afterConcussive = bot;
    for (let tick = 0; tick < 20; tick += 1) {
        const action = buildDeterministicLogicAction(configuration(9, 5), buildStatePayload([afterConcussive, opponent], "custom"));
        afterConcussive = applyBotAction(afterConcussive, action, 50);
    }
    const fireballAfterConcussive = buildDeterministicLogicAction(configuration(9, 5), buildStatePayload([afterConcussive, opponent], "custom"));
    assert.equal(preparingAbilityId(afterConcussive), null);
    assert.ok(pendingCooldownMs(afterConcussive, 9) > 0);
    assert.equal(fireballAfterConcussive.abilityAction, null);

    assert.ok(activeRemainingMs(afterConcussive, 9) > 0);
});

test("Dash starts during another ability's active phase and keeps its own cooldown rules", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [{ priority: 1, branches: [
            { id: "active-attack", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [{ action: 5 }] },
            { id: "dash", branchType: "if", priority: 2, conditions: [{ type: "always" }], actions: [{ action: 19, movementMode: "absolute", movementDirection: 90 }] },
        ] }],
    };
    const opponent = { id: "opponent-model", slot: 2, x: 700, y: 100, size: 60, hp: 100, abilities: [] };
    const bot = {
        id: "main", slot: 1, x: 100, y: 100, size: 60, rotation: 0, hp: 100, maxHp: 100,
        moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
        abilities: [5, 19],
        abilityState: { 5: { stage: "active", remainingMs: 300, charges: 4, reloadMs: 0 }, 19: { stage: "ready", remainingMs: 0 } },
    };

    const action = buildDeterministicLogicAction(configuration, buildStatePayload([bot, opponent], "custom"));
    const result = applyBotAction(bot, action, 100);

    assert.equal(action.abilityAction, null, "the active fireball cannot be selected again");
    assert.equal(action.dashAction.action, 19, "the dash is its own category");
    assert.equal(result.triggeredAbility, 19);
    assert.ok(activeRemainingMs(result, 19) > 0);
    assert.ok(activeRemainingMs(result, 5) > 0, "the fireball's active phase carries on");
});

test("a higher-priority fireball yields to grenade during its one-tick recovery", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        roots: [
            { priority: 1, branches: [{ conditions: [{ type: "always" }], actions: [{ action: "fireball" }] }] },
            { priority: 2, branches: [{ conditions: [{ type: "always" }], actions: [{ action: "grenade" }] }] },
        ],
    };
    const opponent = { id: "opponent-model", slot: 2, x: 700, y: 400, size: 60, hp: 100, maxHp: 100, abilities: [] };
    let bot = {
        id: "main", slot: 1, x: 100, y: 400, size: 60, rotation: 0,
        hp: 100, maxHp: 100, moveSpeed: 8, attackSpeedMultiplier: 1,
        attackDamageMultiplier: 1, abilities: [4, 5],
        abilityState: { 4: { stage: "ready", remainingMs: 0 }, 5: { stage: "ready", remainingMs: 0, charges: 4, reloadMs: 0 } },
    };
    const triggered = [];
    for (let tick = 0; tick < 8; tick += 1) {
        const action = buildDeterministicLogicAction(configuration, buildStatePayload([bot, opponent], "custom"));
        if (action.abilityAction) triggered.push(action.abilityAction.action);
        bot = applyBotAction(bot, action, 100);
    }

    assert.deepEqual(triggered.slice(0, 2), [5, 4]);
});

test("phase entity execution returns net bot damage and removes a colliding fireball", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100 },
    ];
    const fireball = { id: "fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickAbilityEntityWorld({ bots, entities: [fireball], stepMs: 50, width: 1000, height: 800 });
    assert.equal(result.entities.length, 0);
    assert.equal(result.bots[1].hp, 80);
    assert.equal(statusIsActive(result.bots[1], "burn"), true);
});

test("projectile collisions use the declared square footprint instead of a circle", () => {
    const squareHit = movingRectangleCollision(
        { x: 0, y: 0 }, { x: 0, y: 0 }, 20, 20, 0,
        { x: 9, y: 9 }, { x: 9, y: 9 }, 0,
    );
    const circularComparison = movingCircleCollision(
        { x: 0, y: 0 }, { x: 0, y: 0 }, 10,
        { x: 9, y: 9 }, { x: 9, y: 9 }, 0,
    );
    assert.equal(squareHit.hit, true);
    assert.equal(circularComparison.hit, false);
    [4, 5, 15, 18, 28].forEach((abilityId) => {
        assert.equal(ENTITY_CONTRACTS[abilityId].phases[0].hitbox.shape, "rectangle", `ability ${abilityId}`);
    });
});

test("rectangular projectile collision uses independent hitbox length and width", () => {
    const silenceWave = {
        type: "silenceWave", abilityId: 15, x: 0, y: 0, size: 225, velocityX: 10, velocityY: 0,
    };
    const targetOnLengthEdge = { type: "bot", x: 115, y: 0, size: 60 };
    const targetOutsideWidth = { type: "bot", x: 0, y: 110, size: 60 };
    const stationaryPath = { x: 0, y: 0 };

    assert.equal(movingEntityCollision(
        silenceWave, stationaryPath, stationaryPath,
        targetOnLengthEdge, targetOnLengthEdge, targetOnLengthEdge,
    ).hit, true);
    assert.equal(movingEntityCollision(
        silenceWave, stationaryPath, stationaryPath,
        targetOutsideWidth, targetOutsideWidth, targetOutsideWidth,
    ).hit, false);
});

test("projectile collision sweeps across a bot's dash segment", () => {
    const owner = { id: "owner", slot: 1, x: 700, y: 100, size: 60, hp: 100, maxHp: 100 };
    const target = {
        id: "target", slot: 2, x: 425, y: 432, size: 60, hp: 100, maxHp: 100,
        movementStartX: 500, movementStartY: 432,
    };
    const grenade = { ...entityFor(owner, 4), x: 500, y: 467.6, velocityX: 0, velocityY: 0 };
    const result = tickAbilityEntityWorld({
        bots: [owner, target],
        entities: [grenade],
        stepMs: 100,
        width: 1000,
        height: 800,
    });

    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].id, grenade.id);
    assert.equal(result.entities[0].phaseId, "active");
    assert.equal(result.entities[0].type, "grenade");
    assert.ok(result.bots[1].hp < 100);
});

test("grenades enter armed after the one-second travel phase and activate after the armed duration", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 400, size: 60, rotation: 0, hp: 100, maxHp: 100 };
    const target = { id: "target", slot: 2, x: 800, y: 700, size: 60, hp: 100, maxHp: 100 };
    let world = {
        bots: [owner, target],
        entities: [entityFor(owner, 4)],
        stepMs: 100,
        width: 1000,
        height: 800,
    };

    for (let tick = 0; tick < 9; tick += 1) {
        const result = tickAbilityEntityWorld(world);
            world = { ...world, entities: result.entities, bots: result.bots };
            assert.equal(world.entities[0].phaseId, "travel");
            assert.equal(Math.hypot(world.entities[0].velocityX, world.entities[0].velocityY), 32);
        }

    let result = tickAbilityEntityWorld(world);
    world = { ...world, entities: result.entities, bots: result.bots };
    assert.equal(world.entities[0].phaseId, "armed");
    assert.equal(world.entities[0].phaseLocked, true);
    assert.equal(world.entities[0].remainingMs, null);
    assert.equal(Math.hypot(world.entities[0].velocityX, world.entities[0].velocityY), 0);

    for (let tick = 0; tick < 9; tick += 1) {
        result = tickAbilityEntityWorld(world);
        world = { ...world, entities: result.entities, bots: result.bots };
        assert.equal(world.entities[0].phaseId, "armed");
    }
    assert.equal(world.entities[0].remainingMs, null);

    result = tickAbilityEntityWorld(world);
    assert.equal(result.entities[0].phaseId, "active");
});

test("grenades become ability-system explosions on contact and fuse expiry", () => {
    const owner = { id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 100, maxHp: 100 };
    const target = { id: "target", slot: 2, x: 150, y: 100, size: 60, hp: 100, maxHp: 100 };
    const grenade = { ...entityFor(owner, 4), x: 120, y: 100, velocityX: 0, velocityY: 0 };
    const contact = tickAbilityEntityWorld({ bots: [owner, target], entities: [grenade], stepMs: 50, width: 1000, height: 800 });
    assert.equal(contact.entities.length, 1);
    assert.equal(contact.entities[0].id, grenade.id);
    assert.equal(contact.entities[0].phaseId, "active");
    assert.equal(isAbilityEntity(contact.entities[0]), true);
    assert.equal(Math.round(contact.bots[1].hp * 100) / 100, 70.28);

    const exploded = tickAbilityEntityWorld({
        entities: contact.entities,
        bots: contact.bots,
        stepMs: 50,
        width: 1000,
        height: 800,
    });
    assert.equal(exploded.bots[1].hp, contact.bots[1].hp);
    assert.equal(exploded.entities.length, 1);

    const timed = tickAbilityEntityWorld({
        bots: [owner, { ...target, x: 184, hp: 100 }],
        entities: [{
            ...grenade,
            id: "timed-grenade",
            phaseId: "armed",
            phaseLocked: true,
            armed: true,
            velocityX: 0,
            velocityY: 0,
            phaseTimerMs: 1000,
        }],
        stepMs: 50,
        width: 1000,
        height: 800,
    });
    assert.equal(timed.entities.length, 1);
    assert.equal(timed.entities[0].id, "timed-grenade");
    assert.equal(timed.entities[0].type, "grenade");
    assert.equal(timed.entities[0].phaseId, "active");
    const timedExplosion = tickAbilityEntityWorld({
        entities: timed.entities,
        bots: timed.bots,
        stepMs: 50,
        width: 1000,
        height: 800,
    });
    assert.equal(timed.bots[1].hp, 75);
    assert.equal(timedExplosion.bots[1].hp, 75);
});

test("grenade damage falls linearly between its configured endpoints", () => {
    assert.equal(amountAtDistance(4, 0), 40);
    assert.equal(amountAtDistance(4, 32), 32.5);
    assert.equal(amountAtDistance(4, 64), 25);
    assert.equal(amountAtDistance(4, 70), 25);
    assert.equal(amountAtDistance(4, 71), 0);
});

test("ranged damage profiles use max and min plateaus around linear falloff", () => {
    // Sniper damage is flat across its whole range.
    assert.equal(amountAtDistance(3, 100), 40);
    assert.equal(amountAtDistance(3, 1200), 40);
    assert.equal(amountAtDistance(12, 166.665), 6);
    assert.equal(amountAtDistance(12, 400), 4);
    assert.equal(amountAtDistance(14, 45), 27.5);
    assert.equal(amountAtDistance(14, 120), 20);
    assert.equal(amountAtDistance(22, 65), 15);
    assert.equal(amountAtDistance(32, 0), 25);
    assert.equal(amountAtDistance(32, 250), 20);
    assert.equal(amountAtDistance(32, 500), 15);
});

test("generic amount and duration falloff clamp to the active ability range", () => {
    const amountEffect = {
        amount: 100,
        falloff: { maxAmount: 100, minAmount: 20, falloffStart: 0, falloffEnd: 160 },
    };
    assert.equal(amountAtDistance(10, 0, amountEffect, { range: 80 }), 100);
    assert.equal(amountAtDistance(10, 40, amountEffect, { range: 80 }), 60);
    assert.equal(amountAtDistance(10, 80, amountEffect, { range: 80 }), 20);
    assert.equal(amountAtDistance(10, 81, amountEffect, { range: 80 }), 0);

    const durationEffect = {
        durationMs: 100,
        falloff: { maxDurationMs: 100, minDurationMs: 25, falloffStart: 0, falloffEnd: 160 },
    };
    assert.equal(durationAtDistance(10, 40, durationEffect, { range: 80 }), 63);
    assert.equal(durationAtDistance(10, 80, durationEffect, { range: 80 }), 25);
    assert.equal(durationAtDistance(10, 81, durationEffect, { range: 80 }), 0);
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

    world = { ...world, ...tickAbilityEntityWorld(world) };
    assert.equal(world.entities.length, 1);
    assert.equal(statusRemainingMs(world.bots[1], "burn"), 0);

    for (let tick = 0; tick < 25 && world.entities.length > 0; tick += 1) {
        world = { ...world, ...tickAbilityEntityWorld(world) };
    }
    assert.equal(world.bots[1].hp, 0);
    assert.equal(statusRemainingMs(world.bots[1], "burn"), 0);
    assert.equal(world.bots[2].hp, 80);
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
    const stillAlive = tickAbilityEntityWorld({
        bots: [owner],
        entities: [longTraveled],
        stepMs: 100,
        width: 1000,
        height: 800,
    });
    assert.equal(stillAlive.entities.length, 1);

    const expired = tickAbilityEntityWorld({
        bots: [owner],
        entities: [{ ...longTraveled, ageMs: ABILITY_STATS[5].durationMs - 100 }],
        stepMs: 100,
        width: 1000,
        height: 800,
    });
    assert.equal(expired.entities.length, 0);
});

test("Fireball damages normally while its burn effect remains attached", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } } },
    ];
    const fireball = { id: "blocked-fireball", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const result = tickAbilityEntityWorld({ bots, entities: [fireball], stepMs: 50, width: 1000, height: 800 });
    assert.ok(result.bots[1].hp < 100);
    assert.equal(abilityRecord(result.bots[1], 2)?.charges, 25);
    assert.equal(statusRemainingMs(result.bots[1], "burn"), 5000);
});

test("mine, gravity, silence, drone, and orbital effects are never blocked", () => {
    const shield = { id: "target", slot: 2, x: 150, y: 100, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [2], abilityState: { 2: { stage: "active", remainingMs: 1, charges: 25 } } };
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), traveled: 176, armed: true, phaseId: "armed", phaseLocked: true, hitTriggered: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], bots: [shield], stepMs: 100, width: 1000, height: 800 });
    assert.ok(mineResult.bots[0].hp < 100);
    assert.equal(abilityRecord(mineResult.bots[0], 2)?.charges, 25);

    const gravity = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 14), traveled: 176, x: 100, y: 100, fuseMs: 100, remainingMs: 2000 };
    const gravityResult = tickAbilityEntityWorld({ entities: [gravity], bots: [shield], stepMs: 100, width: 1000, height: 800 });
    assert.ok(gravityResult.bots[0].hp <= 100);
    assert.equal(abilityRecord(gravityResult.bots[0], 2)?.charges, 25);

    const silence = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }, 15);
    const silenceResult = tickAbilityEntityWorld({ entities: [silence], bots: [shield], stepMs: 100, width: 1000, height: 800 });
    assert.equal(statusRemainingMs(silenceResult.bots[0], "silence"), 2000);
    assert.equal(abilityRecord(silenceResult.bots[0], 2)?.charges, 25);

    const drone = entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 90 }, 17);
    const droneResult = tickAbilityEntityWorld({ entities: [drone], bots: [shield], stepMs: 100, width: 1000, height: 800 });
    assert.ok(droneResult.bots[0].hp < 100);
    assert.equal(abilityRecord(droneResult.bots[0], 2)?.charges, 25);

    const orbital = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 22, { targetX: 150, targetY: 100, clamp: (value) => value }), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], bots: [shield], stepMs: 100, width: 1000, height: 800 });
    assert.ok(orbitalResult.bots[0].hp <= 100);
    assert.equal(abilityRecord(orbitalResult.bots[0], 2)?.charges, 25);
});

test("radial effects include bot-edge contact and exclude a bot just beyond the edge", () => {
    const orbitalEdge = { id: "orbital-edge", slot: 2, x: 260, y: 100, size: 60, hp: 100, maxHp: 100 };
    const orbital = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100 }, 22, { targetX: 100, targetY: 100, clamp: (value) => value }), fuseMs: 100 };
    const orbitalResult = tickAbilityEntityWorld({ entities: [orbital], bots: [orbitalEdge], stepMs: 100, width: 1000, height: 800 });
    assert.equal(orbitalResult.bots[0].hp, 85);

    const orbitalOutside = { ...orbitalEdge, id: "orbital-outside", x: 260.1, hp: 100 };
    const orbitalOutsideResult = tickAbilityEntityWorld({ entities: [orbital], bots: [orbitalOutside], stepMs: 100, width: 1000, height: 800 });
    assert.equal(orbitalOutsideResult.bots[0].hp, 100);

    const mineEdge = { id: "mine-edge", slot: 2, x: 217.5, y: 100, size: 60, hp: 100, maxHp: 100 };
    const mine = { ...entityFor({ id: "owner", slot: 1, x: 100, y: 100, rotation: 0 }, 11), velocityX: 0, velocityY: 0, traveled: 176, armed: true, phaseId: "armed", phaseLocked: true };
    const mineResult = tickAbilityEntityWorld({ entities: [mine], bots: [mineEdge], stepMs: 100, width: 1000, height: 800 });
    assert.equal(mineResult.bots[0].hp, 70);

    const mineOutside = { ...mineEdge, id: "mine-outside", x: 217.6, hp: 100 };
    const mineOutsideResult = tickAbilityEntityWorld({ entities: [mine], bots: [mineOutside], stepMs: 100, width: 1000, height: 800 });
    assert.equal(mineOutsideResult.bots[0].hp, 100);
});

test("another fireball refreshes burn duration without resetting its pending damage tick", () => {
    const bots = [
        { id: "owner", x: 100, y: 100, size: 60, hp: 100 },
        { id: "target", x: 150, y: 100, size: 60, hp: 100, statusEffects: [damageStatus("burn", 4000, 300, 2)] },
    ];
    const fireball = { id: "refresh", type: "fireball", ownerId: "owner", x: 120, y: 100, size: 30, velocityX: 5, velocityY: 0, traveled: 0, damageMultiplier: 1 };
    const hit = tickAbilityEntityWorld({ bots, entities: [fireball], stepMs: 50, width: 1000, height: 800 });
    assert.equal(statusRemainingMs(hit.bots[1], "burn"), 5000);
    assert.equal(statusEffectFor(hit.bots[1], "burn").tickMs, 300);

    const ticked = tickBotStatus(hit.bots[1], 300);
    assert.equal(ticked.hp, 78);
});
