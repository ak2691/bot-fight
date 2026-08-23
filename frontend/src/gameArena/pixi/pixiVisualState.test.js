import test from "node:test";
import assert from "node:assert/strict";
import { activeBotVisual, closingZoneDamageOccurred, ENTITY_PRESENTATION_DEFINITIONS, entityCaption, BOT_PRESENTATION_DEFINITIONS, botColorRole, botInteriorAlpha, botMovementRotation, botSpritesOverlap, botStatusLabels, grenadeDetonateProgress, grenadeVisualState, isBotShape, LOCK_ON_PRESENTATION, normalizeReplayObstacleShape, pixiLayerForShape, presentationDefinitionForShape, projectileTrailStyle, replayProjectileVelocity, shapeInterpolationMs } from "./pixiVisualState.js";
import { REQUIRED_ARENA_PRESENTATION_PATHS } from "./arenaPresentationAssetOwner.js";

test("Pixi renderer classifies every combat snapshot family without changing game state", () => {
    assert.equal(isBotShape({ id: "main" }), true);
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
    const buildingShape = { id: "main", type: "circle", slot: 1, x: 300, y: 400, rotation: 90 };
    const replayShape = { id: "bot-user-7", type: "bot", userId: "user-7", slot: 1, x: 300, y: 400, rotation: 90 };
    assert.deepEqual(presentationDefinitionForShape(buildingShape), presentationDefinitionForShape(replayShape));
    assert.equal(pixiLayerForShape(buildingShape), pixiLayerForShape(replayShape));
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
    const opponent = { id: "bot-slot-2", type: "bot", slot: 2, x: 700, y: 500 };
    assert.equal(isBotShape(opponent), true);
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

test("bot colors follow the match-assigned slot instead of viewer identity", () => {
    assert.equal(botColorRole({ id: "main", slot: 1 }), "blue");
    assert.equal(botColorRole({ id: "main", slot: 2 }), "red");
    assert.equal(botColorRole({ id: "opponent-model", slot: 1 }), "blue");
    assert.equal(botColorRole({ id: "opponent-model", slot: 2 }), "red");
});

test("Pixi movement interpolation follows canonical ability metadata", () => {
    assert.equal(shapeInterpolationMs({ abilityId: 13, interpolationMs: 100 }), 0);
    assert.equal(shapeInterpolationMs({ abilityId: 5, interpolationMs: 125 }), 125);
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
    assert.equal(botMovementRotation({ rotation: 90, dashActiveMs: 100, dashDirectionX: -1, dashDirectionY: 0 }), Math.PI);
    assert.equal(botMovementRotation({ rotation: 90, dashActiveMs: 100, velocityX: 1, velocityY: 0 }), 0);
    assert.equal(botMovementRotation({ rotation: 135, dashActiveMs: 100, dashDirectionX: 0, dashDirectionY: 0 }), Math.PI / 4);
});

test("Block is not an active bot presentation", () => {
    assert.equal(BOT_PRESENTATION_DEFINITIONS[2], undefined);
});

test("replay projectiles recover motion from adjacent frames when velocity is absent", () => {
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95 }, { x: 120, y: 100 }), { velocityX: 10, velocityY: -5 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 0, velocityY: 0 }, { x: 120, y: 100 }), { velocityX: 10, velocityY: -5 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 7, velocityY: 2 }, { x: 120, y: 100 }), { velocityX: 7, velocityY: 2 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 0, velocityY: 0 }, { x: 130, y: 95 }, { x: 140, y: 85 }), { velocityX: 10, velocityY: -10 });
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

test("bot and entity labels derive from calculated snapshot fields", () => {
    assert.deepEqual(botStatusLabels({ statusEffects: [
        { type: "burn", remainingMs: 100 },
        { type: "slow", remainingMs: 100 },
        { type: "silence", mode: "presence" },
    ] }), ["BURN", "SLOW", "SIL"]);
    assert.deepEqual(botStatusLabels({ statusEffects: [{ type: "overclock", remainingMs: 100 }] }), ["OVERCLOCK"]);
    assert.equal(activeBotVisual({ abilityVisual: { ability: 7, ms: 200 } }), 7);
    assert.equal(activeBotVisual({ abilityVisual: { ability: 19, ms: 200 } }), null);
    assert.equal(activeBotVisual({ abilityActiveMs: { 19: 200 } }), null);
    assert.equal(activeBotVisual({ abilityActiveMs: { 20: 200 } }), 20);
    assert.equal(LOCK_ON_PRESENTATION.markerSize, 48);
    assert.equal(activeBotVisual({ abilityActiveMs: { 16: 3000 } }), 16);
    assert.equal(activeBotVisual({ abilityActiveMs: { 23: 1500 } }), 23);
    assert.equal(activeBotVisual({ abilityActiveMs: { 33: 3000 } }), 33);
    assert.equal(activeBotVisual({ abilityActiveMs: { 34: 200 } }), 34);
    assert.equal(entityCaption({ type: "proximityMine", armed: true }), "");
    assert.equal(entityCaption({ type: "repellerDrone", hp: 31 }), "31.0 HP");
    assert.equal(entityCaption({ type: "staticSnare", hp: 20 }), "20.0 HP");
    assert.equal(entityCaption({ type: "orbitalMarker", fuseMs: 900 }), "0.9s");
});
