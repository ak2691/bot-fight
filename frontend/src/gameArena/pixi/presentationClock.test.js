import test from "node:test";
import assert from "node:assert/strict";
import { advanceParticle } from "./particleMotion.js";
import { createPresentationClock } from "./presentationClock.js";

test("presentation time advances during playback", () => {
    let wallMs = 1000;
    const clock = createPresentationClock({ now: () => wallMs });

    wallMs += 120;

    assert.deepEqual(clock.advance(), { timeMs: 120, deltaMs: 120 });
});

test("presentation time remains unchanged while paused", () => {
    let wallMs = 1000;
    const clock = createPresentationClock({ now: () => wallMs, isPaused: true });

    wallMs += 5000;

    assert.deepEqual(clock.advance(), { timeMs: 0, deltaMs: 0 });
    assert.equal(clock.current(), 0);
});

test("resuming continues from frozen time without including the pause", () => {
    let wallMs = 1000;
    const clock = createPresentationClock({ now: () => wallMs });

    wallMs += 250;
    assert.deepEqual(clock.advance(), { timeMs: 250, deltaMs: 250 });

    wallMs += 300;
    clock.setPaused(true);
    assert.equal(clock.current(), 250);
    wallMs += 5000;

    clock.setPaused(false);
    wallMs += 40;
    assert.deepEqual(clock.advance(), { timeMs: 290, deltaMs: 40 });
});

test("particle motion and lifetime do not advance for zero presentation time", () => {
    const particle = { x: 10, y: 20, vx: 30, vy: -12, lifeMs: 400 };

    assert.deepEqual(advanceParticle(particle, 0), particle);
});

test("particle motion consumes a positive presentation delta", () => {
    const advanced = advanceParticle({ x: 10, y: 20, vx: 30, vy: -12, lifeMs: 400 }, 100);

    assert.equal(advanced.lifeMs, 300);
    assert.equal(advanced.x, 11.5);
    assert.equal(advanced.y, 19.4);
});
