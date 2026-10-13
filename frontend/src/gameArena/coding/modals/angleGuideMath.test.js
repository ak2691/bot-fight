import assert from "node:assert/strict";
import test from "node:test";
import {
    HOME_POSITIONS,
    advancePreview,
    angleCaption,
    bearingBetween,
    clampAngle,
    normalizeAngle,
    previewPath,
    steeringHeading,
} from "./angleGuideMath.js";

test("angles wrap to -180..180 and clamp to the action range", () => {
    assert.equal(normalizeAngle(270), -90);
    assert.equal(normalizeAngle(-90), -90);
    assert.equal(normalizeAngle(180), 180);
    assert.equal(clampAngle(900), 360);
    assert.equal(clampAngle("abc"), 0);
    assert.equal(clampAngle(12.6), 13);
});

test("0 degrees is north and the bearing turns clockwise", () => {
    assert.equal(Math.round(bearingBetween({ x: 0, y: 10 }, { x: 0, y: 0 })), 0);
    assert.equal(Math.round(bearingBetween({ x: 0, y: 0 }, { x: 10, y: 0 })), 90);
    assert.equal(Math.round(bearingBetween({ x: 0, y: 0 }, { x: 0, y: 10 })), 180);
});

test("relative headings add to the bearing; absolute headings ignore the target", () => {
    const bot = { x: 0, y: 0 };
    const target = { x: 10, y: 0 };
    assert.equal(Math.round(steeringHeading("relative", 90, bot, target)), 180);
    assert.equal(steeringHeading("absolute", 90, bot, target), 90);
});

test("the caption changes with the angle", () => {
    assert.equal(angleCaption("relative", 0).title, "Straight at the target");
    assert.equal(angleCaption("relative", 45).title, "Angles in toward the target");
    assert.match(angleCaption("relative", 90).detail, /right/);
    assert.match(angleCaption("relative", -90).detail, /left/);
    assert.equal(angleCaption("relative", 135).title, "Angles away from the target");
    assert.equal(angleCaption("relative", 180).title, "Straight away from the target");
    assert.equal(angleCaption("absolute", 90).title, "Always east");
    assert.equal(angleCaption("absolute", -45).title, "Always north-west");
});

test("the preview stops on contact, at a wall, or after six seconds", () => {
    const { bot, target } = HOME_POSITIONS;
    // Chasing the target ends on contact.
    let position = bot;
    let result;
    for (let elapsedMs = 0; elapsedMs < 6000; elapsedMs += 50) {
        result = advancePreview({ bot: position, target, mode: "relative", direction: 0, seconds: 0.05, elapsedMs });
        position = result.bot;
        if (result.done) break;
    }
    assert.equal(result.done, true);
    assert.ok(Math.hypot(position.x - target.x, position.y - target.y) < 28);
    // Walking north in absolute mode ends at the top wall.
    const north = previewPath({ bot, target, mode: "absolute", direction: 0 });
    assert.ok(north.at(-1).y < 14);
    // Running away along the line to the target also ends at a wall, within the time limit.
    const away = previewPath({ bot, target, mode: "relative", direction: 180 });
    assert.ok(away.length > 2);
    // Time runs out before reaching anything.
    const late = advancePreview({ bot: { x: 150, y: 150 }, target, mode: "absolute", direction: 0, seconds: 0.05, elapsedMs: 6100 });
    assert.equal(late.done, true);
});
