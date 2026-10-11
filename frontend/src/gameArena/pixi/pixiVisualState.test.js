import test from "node:test";
import assert from "node:assert/strict";
import { lingerFade, smashCrackGrowth, sprintSpawnPlan, sniperSightAlpha, sniperSightLength, smashFlashAlpha, thrustLengthFraction, weaponActiveProgress, weaponWindupAlpha, weaponWindupProgress, activeBotVisual, closingZoneDamageOccurred, ENTITY_PRESENTATION_DEFINITIONS, entityCaption, BOT_PRESENTATION_DEFINITIONS, botColorRole, botInteriorAlpha, botMovementRotation, botSpritesOverlap, botStatusLabels, entityVisualRotation, grenadeDetonateProgress, grenadeVisualState, normalizeReplayObstacleShape, pixiLayerForShape, presentationDefinitionForShape, presentationTypeForShape, projectileTrailStyle, replayProjectileVelocity, shapeInterpolationMs, shapeWithoutVisualEvent, visualAnimationDescriptorForShape, visualForShape, visualInstanceForShape, visualInstanceIsActive, VISUAL_LIFECYCLES, VISUAL_SPAWN_MODES, visualSizeForShape } from "./pixiVisualState.js";
import { ABILITY_CONTRACTS, eventVerbs } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { REQUIRED_ARENA_PRESENTATION_PATHS } from "./arenaPresentationAssetOwner.js";
import { hitboxGeometriesForEntity, hitboxGeometryForBot, hitboxGeometryForEntity } from "../../../../shared/engine/gameconfig/hitboxGeometry.js";
import { createBotState, isBotState } from "../../../../shared/engine/modelPayloads/botState.js";

test("Pixi renderer classifies every combat snapshot family without changing game state", () => {
    assert.equal(isBotState(createBotState({ id: "main" })), true);
    assert.equal(isBotState({ id: "main", type: "circle", slot: 1, userId: "u" }), false, "only the factory kind marks a bot");
    assert.equal(isBotState({ id: "fireball-1", type: "fireball", abilityId: 5, ownerSlot: 1 }), false);
    assert.equal(pixiLayerForShape({ type: "fireball" }), "projectiles");
    assert.equal(pixiLayerForShape({ type: "nullZone" }), "zones");
    assert.equal(pixiLayerForShape({ type: "closingZone" }), "zones");
    assert.equal(pixiLayerForShape({ type: "hunterDrone" }), "entities");
});

test("overlapping bot sprites receive equal interior opacity without changing their state", () => {
    const left = { id: "left", size: 60, x: 100, y: 100, hp: 100 };
    const right = { id: "right", size: 60, x: 159, y: 100, hp: 100 };
    assert.equal(botSpritesOverlap(left, right), true);
    assert.equal(botInteriorAlpha(left, true), 0.55);
    assert.equal(botInteriorAlpha(right, true), 0.55);
    assert.equal(botSpritesOverlap(left, { ...right, x: 160 }), false);
    assert.equal(botInteriorAlpha(left, false), 1);
});

test("building and replay bot shapes resolve to the same presentation definition", () => {
    const buildingShape = createBotState({ id: "main", type: "circle", slot: 1, x: 300, y: 400, rotation: 90 });
    const replayShape = createBotState({ id: "bot-user-7", type: "bot", userId: "user-7", slot: 1, x: 300, y: 400, rotation: 90 });
    assert.deepEqual(presentationDefinitionForShape(buildingShape), presentationDefinitionForShape(replayShape));
    assert.equal(pixiLayerForShape(buildingShape), pixiLayerForShape(replayShape));
});

test("phase entities resolve phase visuals separately from event visuals", () => {
    assert.deepEqual(visualForShape({ type: "grenade", abilityId: 4, phaseId: "travel" }), {
        type: "grenade",
        state: "moving",
        visualSize: 12,
    });
    assert.equal(visualForShape({ type: "grenade", abilityId: 4, phaseId: "active" }), null);
    assert.equal(presentationDefinitionForShape({ type: "grenade", abilityId: 4, phaseId: "active" }).fallback, "hidden");
    assert.equal(pixiLayerForShape({ type: "grenade", abilityId: 4, phaseId: "active" }), "projectiles");
    assert.deepEqual(visualForShape({
        type: "proximityMine", abilityId: 11, phaseId: "active", phaseLocked: true,
        eventType: "collision", eventSequence: 1,
    }), {
        type: "mineExplosion",
        visualSize: 175,
        visibleMs: 300,
    });
});

test("drone shot visuals resolve from the embedded collision event contract", () => {
    const shot = {
        id: "drone-1",
        type: "hunterDrone",
        abilityId: 17,
        phaseId: "active",
        eventPhaseId: "active",
        eventType: "collision",
        eventSequence: 1,
        x: 200,
        y: 300,
    };

    assert.deepEqual(visualForShape(shot), {
        type: "gun",
        visualSize: 16,
        visibleMs: 300,
    });
    const instance = visualInstanceForShape(shot, 1_000);
    assert.equal(instance.type, "gun");
    assert.equal(instance.followEntity, false);
    assert.equal(instance.x, 200);
    assert.equal(instance.y, 300);
});

test("replay resolves transitioned event visuals from the phase that declared them", () => {
    const snareReplayShape = normalizeReplayObstacleShape({
        type: "staticSnare",
        abilityId: 29,
        phaseId: "triggered",
        eventPhaseId: "armed",
        eventType: "trigger",
        eventSequence: 1,
        x: 300,
        y: 240,
        size: 24,
    });

    assert.deepEqual(visualForShape(snareReplayShape), {
        type: "grenadeExplosion",
        visualSize: 150,
        visibleMs: 200,
    });
    assert.deepEqual(visualForShape({
        ...snareReplayShape,
        eventPhaseId: undefined,
    }), {
        type: "grenadeExplosion",
        visualSize: 150,
        visibleMs: 200,
    });
    assert.equal(visualAnimationDescriptorForShape(snareReplayShape).durationMs, 200);
    assert.equal(presentationTypeForShape(snareReplayShape), "grenadeExplosion");
    assert.equal(presentationDefinitionForShape(snareReplayShape).texturePath[0], "grenadeMineExplosion");
    assert.equal(presentationDefinitionForShape({
        type: "staticSnare", abilityId: 29, phaseId: "triggered",
    }).fallback, "hidden");
});

test("event visual declarations emit and resolve from event metadata only", () => {
    for (const contract of Object.values(ABILITY_CONTRACTS)) {
        for (const entity of Object.values(contract.entities)) for (const phase of entity.phases) {
            for (const [eventType, handler] of Object.entries(phase.on ?? {})) {
                // A visual is declared by an emitVisual verb, or by the visual of a hit verb (a summon's shot).
                const verbs = eventVerbs(handler);
                const emit = verbs.find((verb) => verb.do === "emitVisual");
                const shot = verbs.find((verb) => verb.do === "hit" && verb.visual);
                const declared = emit
                    ? { type: emit.visualType, visibleMs: emit.visibleMs }
                    : shot ? { type: shot.visual.type, visibleMs: shot.visual.visibleMs } : null;
                if (!declared) continue;

                assert.ok(Number.isInteger(declared.visibleMs) && declared.visibleMs > 0,
                    `${contract.abilityId}:${phase.id}:${eventType} declares its event visual duration`);

                const shape = {
                    id: `${contract.abilityId}:${phase.id}:${eventType}`,
                    type: entity.runtimeType,
                    abilityId: contract.abilityId,
                    phaseId: verbs.find((verb) => verb.do === "transition")?.to ?? phase.id,
                    eventPhaseId: phase.id,
                    eventType,
                    eventSequence: 1,
                };
                assert.equal(visualForShape(shape)?.type, declared.type, `${contract.abilityId}:${phase.id}:${eventType}`);
                const instance = visualInstanceForShape(shape, 1_000);
                assert.equal(instance?.type, declared.type,
                    `${contract.abilityId}:${phase.id}:${eventType} creates its separate visual`);
                assert.equal(instance?.followEntity, false,
                    `${contract.abilityId}:${phase.id}:${eventType} does not follow its source`);
            }
        }
    }
});

test("a replayed summon shot recorded as a collision event still resolves the shot visual", () => {
    const shot = { type: "hunterDrone", abilityId: 17, phaseId: "active", eventPhaseId: "active", eventSequence: 1 };
    assert.equal(visualForShape({ ...shot, eventType: "schedule" })?.type, "gun");
    assert.equal(visualForShape({ ...shot, eventType: "collision" })?.type, "gun");
});

test("semantic event lookup matches camel-cased contract event keys", () => {
    const contract = {
        category: "zone",
        runtimeType: "testZone",
        phases: [{
            id: "active",
            on: {
                lifetimeEnd: {
                    do: [{ do: "emitVisual", visualType: "expiryPulse", visibleMs: 250, visualSize: 45 }],
                },
            },
        }],
    };

    assert.deepEqual(visualForShape({
        type: "testZone",
        entityContractId: contract,
        phaseId: "active",
        eventPhaseId: "active",
        eventType: "lifetimeend",
        eventSequence: 1,
    }), {
        type: "expiryPulse",
        visualSize: 45,
        visibleMs: 250,
    });
});

test("Rewind uses a looping phase animation instead of a one-frame snapshot", () => {
    const shape = { type: "temporalRewindZone", abilityId: 21, phaseId: "active", phaseTimerMs: 1_500 };
    assert.deepEqual(presentationDefinitionForShape(shape), {
        kind: "entity",
        layer: "zones",
        texturePath: ["temporalRewind"],
        animation: "time",
        frameMs: 100,
    });
    const descriptor = visualAnimationDescriptorForShape(shape);
    assert.equal(descriptor.eventActive, false);
    assert.equal(descriptor.remainingMs, 1_600);
});

test("entity renderers use the active phase or event visual size", () => {
    assert.equal(visualSizeForShape({ type: "snareBomb", abilityId: 29, phaseId: "armed", size: 24 }), 24);
    assert.equal(visualSizeForShape({ type: "snareBomb", abilityId: 29, phaseId: "triggered", size: 24 }), 0);
    assert.equal(visualSizeForShape({ type: "snareBomb", abilityId: 29, phaseId: "destroyed", size: 24 }), 0);
    assert.equal(visualSizeForShape({
        type: "snareBomb",
        abilityId: 29,
        phaseId: "armed",
        size: 24,
        visualEventType: "staticSnareBurst",
        visualEventMs: 300,
        visualEventSize: 240,
    }), 24);
    assert.equal(visualSizeForShape({ type: "unknown", size: 24 }, 12), 12);
});

test("practice hitbox geometry mirrors projectile, explosion, and persistent ability colliders", () => {
    assert.deepEqual(hitboxGeometryForEntity({ type: "fireball", abilityId: 5, size: 60, velocityX: 10, velocityY: 0 }), {
        shape: "rectangle",
        width: 64,
        height: 64,
        rotation: 0,
    });
    [
        { type: "grenade", abilityId: 4, phaseId: "active", phaseLocked: true, size: 140, radius: 70 },
        { type: "proximityMine", abilityId: 11, phaseId: "active", phaseLocked: true, size: 175, radius: 87.5 },
        { type: "gravityZone", abilityId: 14, phaseId: "active", phaseLocked: true, size: 240, radius: 120 },
        { type: "singularityZone", abilityId: 27, phaseId: "active", phaseLocked: true, size: 280, radius: 140 },
        { type: "snareBomb", abilityId: 29, phaseId: "destroyed", phaseLocked: true, size: 240, radius: 120, armed: true },
        { type: "orbitalMarker", abilityId: 22, phaseId: "active", phaseLocked: true, size: 260, radius: 130 },
    ].forEach(({ type, abilityId, size, radius, phaseId, armed }) => {
        assert.deepEqual(hitboxGeometryForEntity({ type, abilityId, size, phaseId, armed, remainingMs: 100 }), {
            shape: "circle",
            radius,
        }, type);
    });
    assert.deepEqual(hitboxGeometryForEntity({ type: "silenceWave", abilityId: 15, size: 225, velocityX: 0, velocityY: 150 }), {
        shape: "rectangle",
        width: 190,
        height: 150,
        rotation: Math.PI / 2,
    });
    assert.deepEqual(hitboxGeometryForEntity({ type: "windburstProjectile", abilityId: 18, size: 24, velocityX: 44, velocityY: 0 }), {
        shape: "rectangle",
        width: 115,
        height: 80,
        rotation: 0,
    });
    assert.deepEqual(hitboxGeometryForEntity({ type: "nullZone", abilityId: 24, size: 300 }), {
        shape: "circle",
        radius: 150,
    });
    assert.deepEqual(hitboxGeometryForEntity({ type: "orbitalMarker", abilityId: 22, size: 260 }), {
        shape: "circle",
        radius: 130,
    });
});

test("practice hitbox geometry mirrors direct melee, radial, and hitscan deliveries", () => {
    const slash = hitboxGeometryForBot({
        hp: 100,
        size: 60,
        abilityVisual: { ability: 7, ms: 200, x: 100, y: 200, rotation: 90 },
    });
    assert.equal(slash.shape, "sector");
    assert.equal(slash.abilityId, 7);
    assert.equal(slash.x, 100);
    assert.equal(slash.y, 200);
    assert.equal(slash.radius, 115);
    assert.equal(slash.halfAngle, 75 * Math.PI / 180);
    assert.equal(slash.rotation, 0);
    assert.equal(slash.remainingMs, 200);

    const phaseStrike = hitboxGeometryForBot({
        hp: 100,
        size: 60,
        abilityVisual: { ability: 25, ms: 300, x: 100, y: 200, rotation: 90 },
    });
    assert.equal(phaseStrike.shape, "rectangle");
    assert.equal(phaseStrike.abilityId, 25);
    assert.equal(phaseStrike.x, 150);
    assert.equal(phaseStrike.y, 200);
    assert.equal(phaseStrike.width, 100);
    assert.equal(phaseStrike.height, 60);
    assert.equal(phaseStrike.rotation, 0);

    const ray = hitboxGeometryForBot({
        hp: 100,
        size: 60,
        abilityVisual: { ability: 3, ms: 500, x: 300, y: 400, rotation: 180 },
    });
    assert.equal(ray.shape, "ray");
    assert.equal(ray.abilityId, 3);
    assert.equal(ray.length, 1200);
    assert.equal(ray.width, 6);
    assert.equal(ray.x, 300);
    assert.equal(ray.y, 400);
    assert.equal(ray.rotation, Math.PI / 2);
    assert.equal(ray.remainingMs, 500);

    for (const [ability, expectedWidth] of [[9, 5], [12, 5], [13, 5], [30, 8], [32, 10]]) {
        const geometry = hitboxGeometryForBot({
            hp: 100,
            size: 60,
            abilityVisual: { ability, ms: 300, x: 300, y: 400, rotation: 180 },
        });
        assert.equal(geometry.shape, "ray", ability);
        assert.equal(geometry.width, expectedWidth, ability);
    }

    const radial = hitboxGeometryForBot({
        hp: 100,
        size: 60,
        x: 500,
        y: 500,
        rotation: 0,
        abilityState: { 26: { stage: "active", remainingMs: 300 } },
    });
    assert.equal(radial.shape, "circle");
    assert.equal(radial.abilityId, 26);
    assert.equal(radial.radius, 120);
    assert.equal(radial.x, 500);
    assert.equal(radial.y, 500);

    assert.equal(hitboxGeometryForBot({ abilityVisual: { ability: 10, ms: 300 } }), null);
});

test("practice hitbox geometry includes summon hitscan attacks during their shot window", () => {
    const geometries = hitboxGeometriesForEntity({
        type: "hunterDrone",
        abilityId: 17,
        x: 200,
        y: 300,
        rotation: 90,
        size: 28,
        shotVisualMs: 150,
    });
    assert.equal(geometries.length, 2);
    assert.equal(geometries[0].shape, "circle");
    assert.equal(geometries[1].shape, "ray");
    assert.equal(geometries[1].length, 200);
    assert.equal(geometries[1].remainingMs, 150);
    assert.equal(hitboxGeometriesForEntity({
        type: "hunterDrone",
        abilityId: 17,
        x: 200,
        y: 300,
        rotation: 90,
        size: 28,
        shotVisualMs: 0,
    }).length, 1);
});

test("closing zone presentation is renderer-only and does not require an asset", () => {
    const definition = presentationDefinitionForShape({ type: "closingZone" });
    assert.equal(definition.layer, "zones");
    assert.equal(definition.animation, "geometry");
    assert.equal(definition.texturePath, undefined);
});

test("closing-zone particle events only trigger when the damage counter advances", () => {
    assert.equal(closingZoneDamageOccurred({ closingZoneDamageCount: 1 }, { closingZoneDamageCount: 0 }), true);
    assert.equal(closingZoneDamageOccurred({ closingZoneDamageCount: 1 }, { closingZoneDamageCount: 1 }), false);
    assert.equal(closingZoneDamageOccurred({ closingZoneDamageCount: 0 }, { closingZoneDamageCount: 1 }), false);
});

test("slot-only replay bots remain visible when an opponent user id is omitted", () => {
    const opponent = createBotState({ id: "bot-slot-2", type: "bot", slot: 2, x: 700, y: 500 });
    assert.equal(isBotState(opponent), true);
    assert.equal(pixiLayerForShape(opponent), "bots");
    assert.equal(presentationDefinitionForShape(opponent).fallback, undefined);
});

test("every supported bot and entity presentation points at a required asset or an explicit fallback", () => {
    const requiredPaths = new Set(REQUIRED_ARENA_PRESENTATION_PATHS);
    const botPaths = Object.values(BOT_PRESENTATION_DEFINITIONS).map((definition) => definition.texturePath.join("."));
    const entityPaths = Object.values(ENTITY_PRESENTATION_DEFINITIONS).map((definition) => definition.texturePath.join("."));
    [...botPaths, ...entityPaths].forEach((path) => assert.equal(requiredPaths.has(path), true, path));

    const entityTypes = [
        "hunterDrone", "windburstProjectile", "fireball", "grenadeExplosion", "mineExplosion", "gravityExplosion",
        "gravityZone", "silenceWave", "nullZone", "temporalRewindZone", "orbitalMarker", "orbitalExplosion",
        "singularityZone", "singularityExplosion",
        "tetherBolt", "staticSnare", "staticSnareBurst", "repellerDrone",
    ];
    entityTypes.forEach((type) => {
        const definition = presentationDefinitionForShape({ type, visibleMs: 100, remainingMs: 100, velocityX: 0, velocityY: 0 });
        assert.notEqual(definition.fallback, "hidden", type);
    });
    assert.notEqual(presentationDefinitionForShape({ type: "grenade", velocityX: 0, velocityY: 0, stoppedMs: 0 }).fallback, "hidden");
    assert.notEqual(presentationDefinitionForShape({ type: "proximityMine", armed: false }).fallback, "hidden");
    assert.equal(presentationDefinitionForShape({ type: "unknownEntity" }).fallback, "hidden");
});

test("bot colors follow the match-assigned team instead of viewer identity or slot", () => {
    assert.equal(botColorRole({ id: "main", slot: 1 }), "blue");
    assert.equal(botColorRole({ id: "main", slot: 2 }), "red");
    assert.equal(botColorRole({ id: "opponent-model", slot: 1 }), "blue");
    assert.equal(botColorRole({ id: "opponent-model", slot: 2 }), "red");
    assert.equal(botColorRole({ id: "teammate", slot: 2, teamNumber: 1 }), "blue");
    assert.equal(botColorRole({ id: "opponent-1", slot: 3, teamNumber: 2 }), "red");
    assert.equal(botColorRole({ id: "opponent-2", slot: 4, teamNumber: 2 }), "red");
});

test("Pixi movement interpolation follows canonical ability metadata", () => {
    assert.equal(shapeInterpolationMs({ abilityId: 13, interpolationMs: 100 }), 0);
    assert.equal(shapeInterpolationMs({ abilityId: 5, interpolationMs: 125 }), 125);
});

test("Tether Bolt return interpolation follows its 150-unit phase speed", () => {
    const shape = { type: "tetherBolt", abilityId: 28, phaseId: "return", phaseTimerMs: 100 };
    assert.equal(shapeInterpolationMs(shape, { x: 500, y: 100 }, { x: 350, y: 100 }), 100);
    assert.ok(Math.abs(shapeInterpolationMs(shape, { x: 500, y: 100 }, { x: 400, y: 100 }) - (2 / 3 * 100)) < 0.000001);
});

test("moving projectile snapshots opt into animated trail presentation", () => {
    assert.deepEqual(projectileTrailStyle({ type: "fireball", velocityX: 10, velocityY: 0 }), { color: 0xfb923c, length: 48, width: 10 });
    assert.equal(projectileTrailStyle({ type: "grenade", velocityX: 10, velocityY: 0 }), null);
    assert.equal(projectileTrailStyle({ type: "grenade", velocityX: 0, velocityY: 0 }), null);
    assert.equal(projectileTrailStyle({ type: "proximityMine", velocityX: 10, velocityY: 0 }), null);
});

test("grenade presentation changes from moving to static to two-tick detonation", () => {
    assert.equal(grenadeVisualState({ velocityX: 8, velocityY: 0, stoppedMs: 0 }), "moving");
    assert.equal(grenadeVisualState({ velocityX: 0, velocityY: 0, stoppedMs: 700 }), "static");
    assert.equal(grenadeVisualState({ velocityX: 0, velocityY: 0, stoppedMs: 799 }), "static");
    assert.equal(grenadeVisualState({ velocityX: 0, velocityY: 0, stoppedMs: 800 }), "detonate");
    assert.equal(grenadeDetonateProgress({ velocityX: 0, velocityY: 0, stoppedMs: 800 }), 0);
    assert.equal(grenadeDetonateProgress({ velocityX: 0, velocityY: 0, stoppedMs: 900 }), 0.5);
});

test("Dash trails follow movement instead of bot facing", () => {
    assert.equal(botMovementRotation({ rotation: 90, dashDirectionX: -1, dashDirectionY: 0 }), Math.PI);
    assert.equal(botMovementRotation({ rotation: 90, velocityX: 1, velocityY: 0 }), 0);
    assert.equal(botMovementRotation({ rotation: 135, dashDirectionX: 0, dashDirectionY: 0 }), Math.PI / 4);
});

test("Block is not an active bot presentation", () => {
    assert.equal(BOT_PRESENTATION_DEFINITIONS[2], undefined);
});

test("directional summon visuals follow their authoritative facing", () => {
    assert.equal(ENTITY_PRESENTATION_DEFINITIONS.hunterDrone.rotationOffset, -Math.PI / 2);
    assert.equal(entityVisualRotation({ type: "hunterDrone", rotation: 0 }), -Math.PI);
    assert.equal(entityVisualRotation({ type: "hunterDrone", rotation: 90 }), -Math.PI / 2);
    assert.equal(entityVisualRotation({ type: "repellerDrone", rotation: 180 }), 0);
    assert.equal(entityVisualRotation({
        type: "fireball", rotation: 90, velocityX: 0, velocityY: 100,
    }), 0);
});

test("replay projectiles recover motion from adjacent frames when velocity is absent", () => {
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95 }, { x: 120, y: 100 }), { velocityX: 10, velocityY: -5 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 0, velocityY: 0 }, { x: 120, y: 100 }), { velocityX: 10, velocityY: -5 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 7, velocityY: 2 }, { x: 120, y: 100 }), { velocityX: 7, velocityY: 2 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 0, velocityY: 0 }, { x: 130, y: 95 }, { x: 140, y: 85 }), { velocityX: 10, velocityY: -10 });
});

test("replay does not infer a projectile trail for a stationary contract phase", () => {
    const replayShape = normalizeReplayObstacleShape({
        type: "gravityZone",
        abilityId: 14,
        phaseId: "fuse",
        x: 120,
        y: 100,
        velocityX: null,
        velocityY: null,
    }, { x: 100, y: 100 }, { x: 140, y: 100 });

    assert.deepEqual(
        { velocityX: replayShape.velocityX, velocityY: replayShape.velocityY },
        { velocityX: 0, velocityY: 0 },
    );
    assert.equal(projectileTrailStyle(replayShape), null);
});

test("replay obstacle normalization preserves the canonical building shape contract", () => {
    const buildingShape = {
        id: "grenade-1",
        type: "grenade",
        x: 130,
        y: 95,
        size: 16,
        rotation: 90,
        velocityX: 0,
        velocityY: 0,
        timerMs: 800,
        stoppedMs: 800,
        locked: true,
        interpolationMs: 100,
    };
    const replayShape = normalizeReplayObstacleShape({
        id: "grenade-1",
        type: "grenade",
        x: 130,
        y: 95,
        size: 16,
        rotation: 90,
        velocityX: 0,
        velocityY: 0,
        timerMs: 800,
        abilityId: 4,
    }, { id: "grenade-1", x: 130, y: 95 }, {
        interpolationMs: 100,
        hitParticleEvent: "100:id:grenade-1",
        replayFrameIndex: 1,
        replayPhase: "playback",
    });
    assert.deepEqual(presentationDefinitionForShape(buildingShape), presentationDefinitionForShape(replayShape));
    assert.deepEqual(replayShape.captureBySlot, { 1: 0, 2: 0 });
    assert.equal(replayShape.stoppedMs, 800);
    assert.equal(replayShape.abilityId, 4);
    assert.equal(replayShape.hitParticleEvent, "100:id:grenade-1");
    assert.equal(replayShape.replayFrameIndex, 1);
    assert.equal(replayShape.replayPhase, "playback");
});

test("replay phase visuals restore the training visible timer", () => {
    ["mineExplosion", "gravityExplosion", "singularityExplosion", "staticSnareBurst"].forEach((type) => {
        const replayShape = normalizeReplayObstacleShape({
            id: `${type}-1`,
            type,
            x: 300,
            y: 240,
            size: 150,
            timerMs: 175,
        });

        assert.equal(replayShape.visibleMs, 175, type);
        assert.equal(replayShape.remainingMs, 175, type);
    });
});

test("replay phase visuals use the same renderer contract as live entities", () => {
    const liveShape = {
        type: "grenade",
        abilityId: 4,
        phaseId: "active",
        phaseLocked: true,
        size: 30,
        visibleMs: 100,
    };
    const replayShape = normalizeReplayObstacleShape({
        ...liveShape,
        phaseLocked: undefined,
    });

    assert.equal(replayShape.phaseLocked, true);
    assert.deepEqual(visualForShape(replayShape), visualForShape(liveShape));
    assert.deepEqual(
        presentationDefinitionForShape(replayShape),
        presentationDefinitionForShape(liveShape),
    );
});

test("visual animation descriptors keep event timers separate from phase clocks", () => {
    const grenade = visualAnimationDescriptorForShape({
        type: "grenade",
        abilityId: 4,
        phaseId: "active",
        phaseLocked: true,
        eventType: "collision",
        eventSequence: 1,
        visualEventMs: 100,
    });
    assert.equal(grenade.eventActive, true);
    assert.equal(grenade.durationMs, 200);
    assert.equal(grenade.remainingMs, 100);

    const orbitalPulse = visualAnimationDescriptorForShape({
        type: "orbitalMarker",
        abilityId: 22,
        phaseId: "active",
        phaseLocked: true,
        visualEventType: "untrustedPayloadVisual",
        visualEventMs: 300,
        visualEventSize: 260,
    });
    assert.equal(orbitalPulse.eventActive, false);
    assert.equal(orbitalPulse.durationMs, 0);
    assert.equal(orbitalPulse.remainingMs, null);
});

test("semantic replay events resolve repeating visuals from the frontend contract", () => {
    const shape = {
        type: "orbitalMarker",
        abilityId: 22,
        phaseId: "active",
        phaseTimerMs: 600,
        eventType: "collision",
        eventSequence: 2,
    };

    assert.deepEqual(visualForShape(shape), {
        type: "orbitalExplosion",
        visualSize: 260,
        visibleMs: 400,
    });
    const descriptor = visualAnimationDescriptorForShape(shape);
    assert.equal(descriptor.eventActive, true);
    assert.equal(descriptor.durationMs, 400);
    assert.equal(descriptor.remainingMs, 400);
});

test("live repeating event visuals stop when their presentation timer reaches zero", () => {
    const activePulse = {
        type: "orbitalMarker",
        abilityId: 22,
        phaseId: "active",
        eventType: "collision",
        eventSequence: 3,
        visualEventType: "untrustedPayloadVisual",
        visualEventMs: 100,
        visualEventSize: 260,
    };
    assert.equal(visualForShape(activePulse).type, "orbitalExplosion");
    assert.equal(visualAnimationDescriptorForShape(activePulse).eventActive, true);

    const completedPulse = { ...activePulse, visualEventMs: 0 };
    assert.equal(visualForShape(completedPulse).type, "orbitalMarker");
    assert.equal(visualAnimationDescriptorForShape(completedPulse).eventActive, false);
});

test("event visuals become independent fixed-position instances", () => {
    const spawned = {
        id: "orbital-1",
        type: "orbitalMarker",
        x: 500,
        y: 300,
        remainingMs: 900,
        eventType: "collision",
        eventSequence: 3,
        visualEvent: 3,
        visualEventType: "untrustedPayloadVisual",
        visualEventMs: 100,
        visualEventSize: 12,
    };
    const instance = visualInstanceForShape(spawned, 1000);

    assert.equal(instance.id, "event:orbital-1:3:orbitalExplosion");
    assert.equal(instance.lifecycle, VISUAL_LIFECYCLES.EVENT);
    assert.equal(instance.spawnMode, VISUAL_SPAWN_MODES.EVENT);
    assert.equal(instance.followEntity, false);
    assert.equal(instance.spawnedAt, 700);
    assert.equal(instance.expiresAt, 1100);
    assert.equal(instance.x, 500);
    assert.equal(instance.y, 300);
    assert.equal(instance.shape.type, "orbitalExplosion");
    assert.equal(visualInstanceIsActive(instance, 1099), true);
    assert.equal(visualInstanceIsActive(instance, 1100), false);
});

test("repeated event occurrences get separate visual instances while phase visuals follow entities", () => {
    const first = visualInstanceForShape({
        id: "orbital-1", type: "orbitalMarker", abilityId: 22, phaseId: "active",
        x: 500, y: 300, eventType: "collision", eventSequence: 3,
        visualEventType: "untrustedPayloadVisual", visualEventMs: 400, visualEventSize: 12,
    }, 1000);
    const second = visualInstanceForShape({
        id: "orbital-1", type: "orbitalMarker", abilityId: 22, phaseId: "active",
        x: 540, y: 320, eventType: "collision", eventSequence: 4,
        visualEventType: "untrustedPayloadVisual", visualEventMs: 400, visualEventSize: 12,
    }, 1100);
    const phase = visualInstanceForShape({
        id: "grenade-1", type: "grenade", abilityId: 4, phaseId: "travel",
        phaseTimerMs: 100, x: 200, y: 150,
    }, 1000, VISUAL_LIFECYCLES.PHASE);

    assert.notEqual(first.id, second.id);
    assert.equal(first.x, 500);
    assert.equal(second.x, 540);
    assert.equal(phase.lifecycle, VISUAL_LIFECYCLES.PHASE);
    assert.equal(phase.spawnMode, VISUAL_SPAWN_MODES.ENTITY);
    assert.equal(phase.followEntity, true);
    assert.equal(phase.expiresAt, null);
    assert.deepEqual(shapeWithoutVisualEvent({
        eventType: "collision", eventSequence: 1, visualEventType: "impact", visualEventMs: 100,
        visualEventSize: 20, visualEvent: 1, type: "staticSnare", x: 1,
    }), { type: "staticSnare", x: 1 });
});

test("bot and entity labels derive from calculated snapshot fields", () => {
    assert.deepEqual(botStatusLabels({ statusEffects: [
        { type: "burn", remainingMs: 100 },
        { type: "slow", remainingMs: 100 },
        { type: "silence", mode: "presence" },
    ] }), ["BURN", "SLOW", "SIL"]);
    assert.deepEqual(botStatusLabels({ statusEffects: [{ type: "overclock", remainingMs: 100 }] }), ["OVERCLOCK"]);
    assert.equal(activeBotVisual({ abilityVisual: { ability: 7, ms: 200 } }), 7);
    assert.equal(activeBotVisual({ abilityVisual: { ability: 19, ms: 200 } }), null);
    assert.equal(activeBotVisual({ abilityState: { 19: { stage: "active", remainingMs: 200 } } }), null);
    assert.equal(activeBotVisual({ abilityState: { 16: { stage: "active", remainingMs: 3000 } } }), 16);
    assert.equal(activeBotVisual({ abilityState: { 23: { stage: "active", remainingMs: 1500 } } }), 23);
    assert.equal(activeBotVisual({ abilityState: { 33: { stage: "active", remainingMs: 3000 } } }), 33);
    assert.equal(entityCaption({ type: "proximityMine", armed: true }), "");
    assert.equal(entityCaption({ type: "repellerDrone", hp: 31 }), "31.0 HP");
    assert.equal(entityCaption({ type: "snareBomb", hp: 20 }), "20.0 HP");
    assert.equal(entityCaption({ type: "orbitalMarker", fuseMs: 900 }), "");
});

test("weapon wind-up progress comes from the ability's wind-up record", () => {
    assert.equal(weaponWindupProgress({ abilityState: { 36: { stage: "windup", remainingMs: 450 } } }, 36, 450), 0);
    assert.equal(weaponWindupProgress({ abilityState: { 36: { stage: "windup", remainingMs: 225 } } }, 36, 450), 0.5);
    // A wind-up with no time left has already fired, so no wind-up record exists.
    assert.equal(weaponWindupProgress({ abilityState: { 36: { stage: "ready", remainingMs: 0 } } }, 36, 450), null);
    assert.equal(weaponWindupProgress({ abilityState: { 36: { stage: "ready", remainingMs: 0 } } }, 36, 450), null);
    assert.equal(weaponWindupProgress({ abilityState: { 37: { stage: "windup", remainingMs: 100 } } }, 36, 450), null);
    assert.equal(weaponWindupProgress({}, 36, 450), null);
    assert.equal(weaponWindupProgress({ abilityState: { 1: { stage: "ready", remainingMs: 0 } } }, 1, 0), null);
});

test("weapon active progress runs from the remaining abilityActiveMs timer", () => {
    assert.equal(weaponActiveProgress(300, 300), 0);
    assert.equal(weaponActiveProgress(150, 300), 0.5);
    assert.equal(weaponActiveProgress(0, 300), 1);
    assert.equal(weaponActiveProgress(500, 300), 0);
});

test("Thrust extends over 35%, holds for 30% and retracts over the last 35%", () => {
    assert.equal(thrustLengthFraction(0), 0);
    assert.ok(Math.abs(thrustLengthFraction(0.175) - 0.5) < 1e-9);
    assert.equal(thrustLengthFraction(0.35), 1);
    assert.equal(thrustLengthFraction(0.5), 1);
    assert.ok(Math.abs(thrustLengthFraction(0.65) - 1) < 1e-9);
    assert.ok(Math.abs(thrustLengthFraction(0.825) - 0.5) < 1e-9);
    assert.equal(thrustLengthFraction(1), 0);
    assert.equal(thrustLengthFraction(2), 0);
});

test("Cleave and Smash alpha ramps", () => {
    assert.equal(weaponWindupAlpha(0, 0.25, 0.6), 0.25);
    assert.ok(Math.abs(weaponWindupAlpha(1, 0.25, 0.6) - 0.6) < 1e-9);
    assert.ok(Math.abs(weaponWindupAlpha(0.5, 0.25, 0.6) - 0.425) < 1e-9);
    assert.equal(smashFlashAlpha(0, 0.5), 0.5);
    assert.equal(smashFlashAlpha(1, 0.5), 0);
});

test("Smash cracks grow within the first 12% of the active phase and linger fades on the presentation clock", () => {
    assert.equal(smashCrackGrowth(0, 0.12), 0);
    assert.ok(Math.abs(smashCrackGrowth(0.06, 0.12) - 0.5) < 1e-9);
    assert.equal(smashCrackGrowth(0.12, 0.12), 1);
    assert.equal(smashCrackGrowth(0.9, 0.12), 1);
    assert.equal(smashCrackGrowth(0.5, 0), 1);
    assert.equal(lingerFade(0, 700), 1);
    assert.equal(lingerFade(350, 700), 0.5);
    assert.equal(lingerFade(700, 700), 0);
    assert.equal(lingerFade(5000, 700), 0);
    assert.equal(lingerFade(10, 0), 0);
});

test("sprint trail spawns on a fixed interval, catches up briefly, and never bursts after a gap or rewind", () => {
    assert.deepEqual(sprintSpawnPlan(null, 1000, 50), { count: 1, nextSpawnAt: 1050 });
    assert.deepEqual(sprintSpawnPlan(1050, 1020, 50), { count: 0, nextSpawnAt: 1050 });
    assert.deepEqual(sprintSpawnPlan(1050, 1050, 50), { count: 1, nextSpawnAt: 1100 });
    assert.deepEqual(sprintSpawnPlan(1050, 1160, 50), { count: 3, nextSpawnAt: 1200 });
    assert.deepEqual(sprintSpawnPlan(1050, 3000, 50), { count: 1, nextSpawnAt: 3050 }, "a long gap spawns one particle");
    assert.deepEqual(sprintSpawnPlan(5000, 1000, 50), { count: 1, nextSpawnAt: 1050 }, "a rewound clock restarts the schedule");
});

test("weapon active visuals are selected from the active stage and match replay state", () => {
    for (const id of [35, 36, 37]) {
        const live = { hp: 100, abilityState: { [id]: { stage: "active", remainingMs: 200 } } };
        assert.equal(activeBotVisual(live), id);
        assert.equal(activeBotVisual({ ...live, replayPhase: "playback", abilityState: { ...live.abilityState, 3: { stage: "windup", remainingMs: 100 } } }), id);
        assert.equal(activeBotVisual({ hp: 100, abilityState: {} }), null);
    }
});

test("Sniper sight alpha pulses between 0.35 and 0.8 from wind-up progress alone", () => {
    assert.ok(Math.abs(sniperSightAlpha(0) - 0.35) < 1e-9);
    assert.ok(Math.abs(sniperSightAlpha(1 / 6) - 0.8) < 1e-9);
    assert.ok(Math.abs(sniperSightAlpha(1 / 3) - 0.35) < 1e-9);
    for (let step = 0; step <= 20; step += 1) {
        const alpha = sniperSightAlpha(step / 20);
        assert.ok(alpha >= 0.35 - 1e-9 && alpha <= 0.8 + 1e-9);
    }
    assert.equal(sniperSightAlpha(0.37), sniperSightAlpha(0.37));
});

test("Sniper sight runs to max range or stops at the first bot it would hit", () => {
    const origin = { x: 100, y: 100 };
    // Compass 90 faces +x.
    assert.equal(sniperSightLength(origin, 90, 1200, 6, []), 1200);
    assert.equal(sniperSightLength(origin, 90, 1200, 6, [{ x: 500, y: 100, size: 60 }]), 367);
    // Targets behind the bot, or beside the ray beyond the target radius plus half width, are ignored.
    assert.equal(sniperSightLength(origin, 90, 1200, 6, [{ x: -300, y: 100, size: 60 }]), 1200);
    assert.equal(sniperSightLength(origin, 90, 1200, 6, [{ x: 500, y: 100 + 34, size: 60 }]), 1200);
    assert.ok(sniperSightLength(origin, 90, 1200, 6, [{ x: 500, y: 100 + 32, size: 60 }]) < 1200);
    // The nearest of several bots wins, and out-of-range bots do not extend the line.
    assert.equal(sniperSightLength(origin, 90, 300, 6, [{ x: 900, y: 100, size: 60 }, { x: 250, y: 100, size: 60 }]), 117);
    assert.equal(sniperSightLength(origin, 90, 300, 6, [{ x: 900, y: 100, size: 60 }]), 300);
    // The line follows the facing: rotating to 180 points it along +y.
    assert.equal(sniperSightLength(origin, 180, 1200, 6, [{ x: 100, y: 400, size: 60 }]), 267);
});
