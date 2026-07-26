import test from "node:test";
import assert from "node:assert/strict";
import { activeFighterVisual, entityCaption, fighterColorRole, fighterDashRotation, fighterStatusLabels, isFighterShape, pixiLayerForShape, projectileTrailStyle, replayProjectileVelocity, shapeInterpolationMs } from "./pixiVisualState.js";

test("Pixi renderer classifies every combat snapshot family without changing game state", () => {
    assert.equal(isFighterShape({ id: "main" }), true);
    assert.equal(pixiLayerForShape({ type: "fireball" }), "projectiles");
    assert.equal(pixiLayerForShape({ type: "nullZone" }), "zones");
    assert.equal(pixiLayerForShape({ type: "hunterDrone" }), "entities");
});

test("fighter colors follow the match-assigned slot instead of viewer identity", () => {
    assert.equal(fighterColorRole({ id: "main", slot: 1 }), "blue");
    assert.equal(fighterColorRole({ id: "main", slot: 2 }), "pink");
    assert.equal(fighterColorRole({ id: "opponent-model", slot: 1 }), "blue");
    assert.equal(fighterColorRole({ id: "opponent-model", slot: 2 }), "pink");
});

test("Pixi movement interpolation follows canonical ability metadata", () => {
    assert.equal(shapeInterpolationMs({ abilityId: "rail_shot", interpolationMs: 100 }), 0);
    assert.equal(shapeInterpolationMs({ abilityId: "shoot_fireball", interpolationMs: 125 }), 125);
});

test("moving projectile snapshots opt into animated trail presentation", () => {
    assert.deepEqual(projectileTrailStyle({ type: "fireball", velocityX: 10, velocityY: 0 }), { color: 0xfb923c, length: 48, width: 10 });
    assert.equal(projectileTrailStyle({ type: "grenade", velocityX: 0, velocityY: 0 }), null);
    assert.equal(projectileTrailStyle({ type: "proximityMine", velocityX: 10, velocityY: 0 }), null);
});

test("fighter dash trails follow dash movement instead of fighter facing", () => {
    assert.equal(fighterDashRotation({ rotation: 180, dashActiveMs: 100, dashDirectionX: 0, dashDirectionY: 1 }), Math.PI / 2);
    assert.equal(fighterDashRotation({ rotation: 90, microDashActiveMs: 100, microDashDirectionX: -1, microDashDirectionY: 0 }), Math.PI);
    assert.equal(fighterDashRotation({ rotation: 90, dashActiveMs: 100, velocityX: 1, velocityY: 0 }), 0);
    assert.equal(fighterDashRotation({ rotation: 135, dashActiveMs: 100, dashDirectionX: 0, dashDirectionY: 0 }), Math.PI / 4);
});

test("replay projectiles recover motion from adjacent frames when velocity is absent", () => {
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95 }, { x: 120, y: 100 }), { velocityX: 10, velocityY: -5 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 0, velocityY: 0 }, { x: 120, y: 100 }), { velocityX: 10, velocityY: -5 });
    assert.deepEqual(replayProjectileVelocity({ x: 130, y: 95, velocityX: 7, velocityY: 2 }, { x: 120, y: 100 }), { velocityX: 7, velocityY: 2 });
});

test("fighter and entity labels derive from calculated snapshot fields", () => {
    assert.deepEqual(fighterStatusLabels({ burnRemainingMs: 100, slowedMs: 100, nullZoneSilenced: true }), ["BURN", "SLOW", "SIL"]);
    assert.equal(activeFighterVisual({ prototypeVisual: { ability: "heavy_slash", ms: 200 } }), "heavy_slash");
    assert.equal(activeFighterVisual({ prototypeVisual: { ability: "micro_dash", ms: 200 } }), null);
    assert.equal(activeFighterVisual({ abilityActiveMs: { micro_dash: 200 } }), null);
    assert.equal(activeFighterVisual({ abilityActiveMs: { reactive_armor: 3000 } }), null);
    assert.equal(entityCaption({ type: "proximityMine", armed: true }), "");
    assert.equal(entityCaption({ type: "orbitalMarker", fuseMs: 900 }), "0.9s");
});
