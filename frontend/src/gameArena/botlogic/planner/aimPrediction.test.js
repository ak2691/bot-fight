import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildDeterministicLogicAction as buildDeterministicLogicActionNormalized } from "./ArenaActionPlanner.js";
import { leadAimTarget, leadSecondsForBlock, projectileSpeedPerSecond, targetVelocityPerSecond } from "./aimPrediction.js";
import { normalizeAbilityStrategyConfiguration, validateAbilityStrategyConfiguration } from "../code/BotCode.js";
import { buildStatePayload } from "../../modelPayloads/strategyStatePayload.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../code/BotCode.js";

// The engine takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const buildDeterministicLogicAction = (configuration, ...rest) => buildDeterministicLogicActionNormalized(normalizeBrainForTick(configuration), ...rest);

// Mirrors server AimPredictionParityTest; keep the cases in step.
const player = (extra = {}) => ({ id: "main", x: 200, y: 400, rotation: 90, ...extra });
const target = (x, y, startX = x, startY = y, extra = {}) => ({
    id: "opponent-model", x, y, displacementX: x - startX, displacementY: y - startY, ...extra,
});

test("current aim returns the target untouched, whatever its velocity", () => {
    const moving = target(600, 400, 580, 400);
    assert.equal(leadAimTarget(moving, { aim: "current" }, player()), moving);
    assert.equal(leadAimTarget(moving, {}, player()), moving);
    assert.equal(leadAimTarget(moving, null, player()), moving);
});

test("a stationary target gets no lead", () => {
    const standing = target(600, 400);
    assert.deepEqual(targetVelocityPerSecond(standing), { x: 0, y: 0 });
    const predicted = leadAimTarget(standing, { aim: "lead", leadSeconds: 1.5 }, player());
    assert.equal(predicted.x, 600);
    assert.equal(predicted.y, 400);
    const auto = leadAimTarget(standing, { aim: "auto", leadAbilityId: 5 }, player());
    assert.equal(auto.x, 600);
    assert.equal(auto.y, 400);
});

test("a straight-line mover is predicted by last-tick velocity x lead seconds", () => {
    // 20 units in the last 0.1 s tick is 200 units per second.
    const mover = target(600, 400, 580, 400);
    assert.deepEqual(targetVelocityPerSecond(mover), { x: 200, y: 0 });
    const predicted = leadAimTarget(mover, { aim: "lead", leadSeconds: 1 }, player());
    assert.equal(predicted.x, 800);
    assert.equal(predicted.y, 400);
    const diagonal = leadAimTarget(target(600, 400, 590, 410), { aim: "lead", leadSeconds: 0.5 }, player());
    assert.equal(Math.round(diagonal.x), 650);
    assert.equal(Math.round(diagonal.y), 350);
});

test("the predicted point is clamped to the arena", () => {
    const nearWall = leadAimTarget(target(1150, 400, 1130, 400), { aim: "lead", leadSeconds: 2 }, player());
    assert.equal(nearWall.x, 1200);
    const nearCorner = leadAimTarget(target(40, 40, 60, 60), { aim: "lead", leadSeconds: 2 }, player());
    assert.equal(nearCorner.x, 0);
    assert.equal(nearCorner.y, 0);
});

test("a target that changes direction defeats the prediction", () => {
    // It ran +x for several ticks, then turned and only moved +y last tick.
    const turned = target(600, 420, 600, 400);
    const predicted = leadAimTarget(turned, { aim: "lead", leadSeconds: 1 }, player());
    assert.equal(predicted.x, 600);
    assert.equal(predicted.y, 620);
    // Where it would have been had it kept going straight along +x.
    const straightLineGuess = { x: 800, y: 420 };
    assert.notEqual(predicted.x, straightLineGuess.x);
});

test("auto lead is wind-up plus projectile travel time", () => {
    // Fireball: no wind-up, 50 units per tick = 500 per second, 400 units away = 0.8 s of travel.
    assert.equal(projectileSpeedPerSecond(5), 500);
    assert.ok(Math.abs(leadSecondsForBlock({ aim: "auto", leadAbilityId: 5 }, player(), target(600, 400)) - 0.8) < 1e-9);
    // Sniper is hitscan: only its 900 ms wind-up counts, full when not started and the remainder once it has.
    assert.equal(projectileSpeedPerSecond(3), 0);
    assert.ok(Math.abs(leadSecondsForBlock({ aim: "auto", leadAbilityId: 3 }, player(), target(600, 400)) - 0.9) < 1e-9);
    assert.ok(Math.abs(leadSecondsForBlock({ aim: "auto", leadAbilityId: 3 }, player({ abilityState: { 3: { stage: "windup", remainingMs: 300 } } }), target(600, 400)) - 0.3) < 1e-9);
    // A different ability in wind-up does not shorten the chosen one.
    assert.ok(Math.abs(leadSecondsForBlock({ aim: "auto", leadAbilityId: 3 }, player({ abilityState: { 9: { stage: "windup", remainingMs: 300 } } }), target(600, 400)) - 0.9) < 1e-9);
    // Melee has no wind-up and no travel time.
    assert.equal(leadSecondsForBlock({ aim: "auto", leadAbilityId: 1 }, player(), target(600, 400)), 0);
    const predicted = leadAimTarget(target(600, 400, 580, 400), { aim: "auto", leadAbilityId: 3 }, player());
    assert.equal(predicted.x, 600 + 200 * 0.9);
});

test("lead seconds are bounded to 0 through 2", () => {
    assert.equal(leadSecondsForBlock({ aim: "lead", leadSeconds: 99 }, player(), target(600, 400)), 2);
    assert.equal(leadSecondsForBlock({ aim: "lead", leadSeconds: -4 }, player(), target(600, 400)), 0);
    assert.equal(leadSecondsForBlock({ aim: "lead", leadSeconds: Number.NaN }, player(), target(600, 400)), 0);
});

test("old and malformed aim fields normalize without changing behavior", () => {
    const base = (action) => ({ roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [action] }] }] });
    const read = (action) => normalizeAbilityStrategyConfiguration(base(action)).roots[0].branches[0].actions[0];
    // No field: nothing is added to the stored action.
    const legacy = read({ action: "rotate_toward_enemy", selectable: "opponent" });
    assert.equal("aim" in legacy, false);
    assert.equal("leadSeconds" in legacy, false);
    assert.equal(read({ action: "rotate_toward_enemy", selectable: "opponent", aim: "current", leadSeconds: 1 }).aim, undefined);
    assert.equal(read({ action: "rotate_toward_enemy", selectable: "opponent", aim: "nonsense" }).aim, undefined);
    const lead = read({ action: "rotate_toward_enemy", selectable: "opponent", aim: "lead", leadSeconds: 99 });
    assert.equal(lead.aim, "lead");
    assert.equal(lead.leadSeconds, 2);
    assert.equal(read({ action: "rotate_toward_enemy", selectable: "opponent", aim: "lead", leadSeconds: 0.37 }).leadSeconds, 0.3);
    const auto = read({ action: "rotate_toward_enemy", selectable: "opponent", aim: "auto", leadAbilityId: 5 });
    assert.equal(auto.aim, "auto");
    assert.equal(auto.leadAbilityId, 5);
    // An unknown ability falls back to the default aim instead of storing garbage.
    assert.equal(read({ action: "rotate_toward_enemy", selectable: "opponent", aim: "auto", leadAbilityId: 9999 }).aim, undefined);
    // Coordinate and angle targets never carry an aim.
    assert.equal(read({ action: "rotate_toward_enemy", targetMode: "coordinates", targetX: 0, targetY: 0, aim: "lead", leadSeconds: 1 }).aim, undefined);
    assert.equal(read({ action: "rotate_toward_enemy", targetMode: "angle", targetAngle: 90, aim: "lead", leadSeconds: 1 }).aim, undefined);
    // Movement and plain abilities do not aim.
    assert.equal(read({ action: "move_walk", selectable: "opponent", aim: "lead", leadSeconds: 1 }).aim, undefined);
    assert.equal(read({ action: 1, selectable: "opponent", aim: "lead", leadSeconds: 1 }).aim, undefined);
    assert.equal(validateAbilityStrategyConfiguration(base({ action: "rotate_toward_enemy", selectable: "opponent", aim: "lead", leadSeconds: 1 })).valid ?? true, true);
});

function planFor(aim, opponentShape) {
    const configuration = normalizeAbilityStrategyConfiguration({
        version: "bot-logic-tree-v1",
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "rotate_toward_enemy", selectable: "opponent", ...aim }] }] }],
    });
    const shapes = [
        { id: "main", type: "circle", slot: 1, x: 300, y: 600, size: 60, hp: 100, rotation: 90 },
        { id: "opponent-model", type: "opponentModel", slot: 2, size: 60, hp: 100, rotation: 270, ...opponentShape },
    ];
    return buildDeterministicLogicAction(configuration, buildStatePayload(shapes, "custom:", "main"));
}

test("Face Target turns toward the predicted point only when lead is configured", () => {
    // The opponent is straight ahead (east) and moving south at 20 units per tick.
    const mover = { x: 900, y: 600, movementStartX: 900, movementStartY: 580 };
    const current = planFor({}, mover);
    const lead = planFor({ aim: "lead", leadSeconds: 2 }, mover);
    assert.equal(current.dRot, 0);
    // Predicted point is 400 units south of the target: the bot must turn toward south (clockwise from east).
    assert.ok(lead.dRot > 0, `expected a clockwise turn, got ${lead.dRot}`);
    const stationary = planFor({ aim: "lead", leadSeconds: 2 }, { x: 900, y: 600, movementStartX: 900, movementStartY: 600 });
    assert.equal(stationary.dRot, 0);
});

test("the action editor exposes an Aim segmented control for Face Target and targeted abilities only", () => {
    const source = readFileSync(new URL("../../coding/nodes/GraphNodes.jsx", import.meta.url), "utf8");
    assert.match(source, /function AimControls/);
    assert.match(source, /actionSupportsAim\(definition\)/);
    for (const label of ["Current", "Lead", "Auto"]) assert.match(source, new RegExp(`label: "${label}"`));
    assert.match(source, /aria-label="Lead time in seconds"/);
    assert.match(source, /aria-label="Ability to lead for"/);
    assert.match(source, /MAX_LEAD_SECONDS/);
});
