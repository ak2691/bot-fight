import test from "node:test";
import assert from "node:assert/strict";
import { botAbilityPresentationForType } from "../botAbilityPresentationDefinitions.js";
import { BOT_ABILITY_RENDERERS, syncBotAbilityRenderers, updateBotAbilityRenderers } from "./index.js";
import { activeBotVisual } from "../pixiVisualState.js";
import { dashedRectSegments, smashCrackPaths, smashDebrisPieces } from "./rendererHelpers.js";

/** Records what a renderer asks Pixi to do, so draws can be compared without a GPU. */
function fakeGraphics() {
    const calls = [];
    const graphics = new Proxy({}, {
        get: (_target, name) => name === "calls" ? calls : (...args) => { calls.push([name, ...args]); return graphics; },
    });
    return graphics;
}

function fakeKit() {
    const shown = [];
    return {
        shown,
        showEffect: (view, slot, texture, options) => shown.push({ slot, texture, ...options }),
        hideEffects: () => {},
        frameAtProgress: (frames, progress) => `${frames?.[0] ?? "frame"}@${Number(progress).toFixed(3)}`,
        frameAt: (frames, elapsedMs) => `${frames?.[0] ?? "frame"}+${elapsedMs}`,
        muzzleAnchor: () => 0.04,
    };
}

const arenaSprites = {
    abilities: {
        meleeSlash: ["slash"], heavySlash: ["heavy"], dashSmoke: ["smoke"], stun: ["stun"], shield: ["shield"],
        phaseStrike: ["phase"], frostRing: ["frost"], temporalRewind: ["rewind"],
        muzzleFlash: ["flash"], repulsorBlast: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
        rays: { rail_shot: ["rail"], pistol: ["pistol"], concussive_shot: ["concussive"] },
    },
};

function botShape(overrides = {}, abilityState = {}) {
    return { id: "bot-1", type: "bot", slot: 1, x: 200, y: 300, size: 60, hp: 100, maxHp: 100, rotation: 90, ...overrides, abilityState };
}

function context(view, shape, extra = {}) {
    return {
        pass: "body",
        shape,
        graphics: view.graphics,
        underGraphics: view.underGraphics,
        position: { x: shape.x, y: shape.y },
        now: 1000,
        arenaSprites,
        radius: Number(shape.size) / 2,
        rotation: Math.PI / 2,
        dead: false,
        otherBots: [],
        layers: {},
        kit: view.kit,
        activeAbilityId: activeBotVisual(shape),
        ...extra,
    };
}

function fakeView() {
    return { cachedEffects: new Map(), graphics: fakeGraphics(), underGraphics: fakeGraphics(), kit: fakeKit(), abilityRenderers: new Map() };
}

function frame(view, shape, extra = {}) {
    const ctx = context(view, shape, extra);
    for (const pass of ["body", "world"]) {
        ctx.pass = pass;
        updateBotAbilityRenderers(view, ctx);
    }
}

test("an idle bot draws nothing", () => {
    const view = fakeView();
    frame(view, botShape());
    assert.deepEqual(view.kit.shown, []);
    assert.deepEqual(view.graphics.calls, []);
    assert.deepEqual(view.underGraphics.calls, []);
});

test("Slash draws its body swing only while its active stage runs", () => {
    const view = fakeView();
    frame(view, botShape({}, { 1: { stage: "active", remainingMs: 200 } }));
    assert.equal(view.kit.shown.length, 1);
    assert.equal(view.kit.shown[0].slot, "swing");
    assert.ok(view.kit.shown[0].width > 0);
});

test("weapon wind-ups draw the contract telegraph for the ability being prepared", () => {
    for (const [abilityId, type] of [[35, "thrust"], [36, "cleave"], [37, "smash"], [3, "gun"]]) {
        const view = fakeView();
        frame(view, botShape({}, { [abilityId]: { stage: "windup", remainingMs: 300 } }));
        assert.ok(view.graphics.calls.length + view.underGraphics.calls.length > 0, `${type} wind-up should draw`);
    }
    const idle = fakeView();
    frame(idle, botShape({}, { 1: { stage: "windup", remainingMs: 100 } }));
    assert.deepEqual(idle.graphics.calls, []);
    assert.deepEqual(idle.underGraphics.calls, []);
});

test("weapon actives draw from the hitbox while they are the active visual", () => {
    const thrust = fakeView();
    frame(thrust, botShape({}, { 35: { stage: "active", remainingMs: 150 } }));
    assert.ok(thrust.graphics.calls.some(([name]) => name === "poly"), "thrust tip");
    const smash = fakeView();
    frame(smash, botShape({}, { 37: { stage: "active", remainingMs: 150 } }));
    assert.ok(smash.graphics.calls.some(([name]) => name === "circle"), "smash impact burst");
    assert.ok(smash.graphics.calls.filter(([name]) => name === "poly").length >= 11, "flash, ring and nine debris squares");
    assert.ok(smash.underGraphics.calls.some(([name]) => name === "stroke"), "smash cracks sit under the body");
    const cleave = fakeView();
    frame(cleave, botShape({}, { 36: { stage: "active", remainingMs: 150 } }));
    assert.equal(cleave.kit.shown[0].slot, "ability");
    assert.equal(cleave.kit.shown[0].tint, botAbilityPresentationForType("cleave").tint);
});

test("only the highest-priority active visual draws its activation effect", () => {
    const view = fakeView();
    // Slash (priority 0) outranks Frost Ring; the ring must not draw while Slash is active.
    frame(view, botShape({}, { 1: { stage: "active", remainingMs: 200 }, 26: { stage: "active", remainingMs: 200 } }));
    assert.deepEqual(view.kit.shown.map((effect) => effect.slot), ["swing"]);
});

test("rendering is deterministic and never reads randomness", () => {
    const originalRandom = Math.random;
    Math.random = () => { throw new Error("renderers must not use Math.random"); };
    try {
        const shape = botShape({}, { 37: { stage: "active", remainingMs: 150 }, 3: { stage: "active", remainingMs: 100 }, 36: { stage: "windup", remainingMs: 200 } });
        const first = fakeView();
        const second = fakeView();
        frame(first, shape);
        frame(second, shape);
        assert.deepEqual(first.graphics.calls, second.graphics.calls);
        assert.deepEqual(first.kit.shown, second.kit.shown);
    } finally {
        Math.random = originalRandom;
    }
});

const SMASH_ID = 37;
const smashActive = (remainingMs) => botShape({}, { [SMASH_ID]: { stage: "active", remainingMs } });
const countCalls = (graphics, name) => graphics.calls.filter(([call]) => call === name).length;
const detached = (view, shape) => syncBotAbilityRenderers(view, { shape, phaseShape: shape, previousShape: null, current: { x: 1, y: 1 }, now: 1000, suppressTransient: true, activeAbilityId: null, previousActiveAbilityId: null, effects: {}, kit: view.kit });

test("Smash wind-up draws a faint fill, dashed outline and impact shadow under the body", () => {
    const view = fakeView();
    frame(view, botShape({}, { [SMASH_ID]: { stage: "windup", remainingMs: 150 } }));
    assert.ok(countCalls(view.underGraphics, "lineTo") > 8, "dashed outline segments");
    assert.equal(countCalls(view.underGraphics, "poly"), 2, "box fill and shadow ellipse");
    assert.deepEqual(view.graphics.calls, []);
});

test("Smash cracks are fixed-seed and every crack is drawn by 12% into the active stage", () => {
    const first = fakeView();
    const second = fakeView();
    frame(first, smashActive(150));
    frame(second, smashActive(150));
    assert.deepEqual(first.underGraphics.calls, second.underGraphics.calls);
    assert.equal(countCalls(first.underGraphics, "stroke"), 14, "7 cracks, each drawn dark and highlighted");
    const early = fakeView();
    frame(early, smashActive(300));
    assert.equal(countCalls(early.underGraphics, "stroke"), 0, "nothing has grown at the first instant");
});

test("Smash cracks and dust linger 700 ms on the presentation clock, then clear", () => {
    const view = fakeView();
    frame(view, smashActive(100), { now: 1000 });
    const idle = botShape();
    const reset = () => { view.underGraphics.calls.length = 0; view.graphics.calls.length = 0; };
    reset();
    frame(view, idle, { now: 1100 });
    const early = view.underGraphics.calls.filter(([name]) => name === "stroke");
    assert.equal(early.length, 14);
    assert.ok(countCalls(view.graphics, "circle") > 0, "dust puffs");
    reset();
    frame(view, idle, { now: 1450 });
    const half = view.underGraphics.calls.find(([name]) => name === "stroke");
    assert.ok(half[1].alpha < early[0][1].alpha, "cracks fade");
    reset();
    frame(view, idle, { now: 1800 });
    assert.deepEqual(view.underGraphics.calls, []);
    assert.deepEqual(view.graphics.calls, []);
});

test("Smash leaves no lingering cracks when presentation is suppressed (reset, replay seek)", () => {
    const view = fakeView();
    const shape = smashActive(100);
    detached(view, shape);
    frame(view, shape, { now: 1000 });
    view.underGraphics.calls.length = 0;
    frame(view, botShape(), { now: 1100 });
    assert.deepEqual(view.underGraphics.calls, []);
});

const sprinting = (overrides = {}) => botShape({ sprinting: true, velocityX: 1, velocityY: 0, ...overrides });

test("the sprint trail spawns a line every 50 ms behind a sprinting bot, under the body", () => {
    const view = fakeView();
    frame(view, sprinting(), { now: 1000 });
    assert.equal(countCalls(view.underGraphics, "moveTo"), 1);
    assert.deepEqual(view.graphics.calls, [], "nothing over the body");
    const [, startX, startY] = view.underGraphics.calls.find(([name]) => name === "moveTo");
    assert.ok(Math.abs(startX + 30) < 1e-9, "one radius behind a bot moving in +x");
    assert.ok(Math.abs(startY - 0) <= 30 * 1.1 + 1e-9, "within 1.1 radii sideways");
    view.underGraphics.calls.length = 0;
    frame(view, sprinting(), { now: 1020 });
    assert.equal(countCalls(view.underGraphics, "moveTo"), 1, "no new spawn yet");
    view.underGraphics.calls.length = 0;
    frame(view, sprinting(), { now: 1050 });
    assert.equal(countCalls(view.underGraphics, "moveTo"), 2, "second line on the 50 ms tick");
});

test("the sprint trail stops spawning when sprinting stops and the rest fades out", () => {
    const view = fakeView();
    frame(view, sprinting(), { now: 1000 });
    frame(view, sprinting(), { now: 1050 });
    view.underGraphics.calls.length = 0;
    frame(view, botShape(), { now: 1100 });
    assert.equal(countCalls(view.underGraphics, "moveTo"), 2, "existing lines still draw");
    view.underGraphics.calls.length = 0;
    frame(view, botShape(), { now: 1230 });
    assert.equal(countCalls(view.underGraphics, "moveTo"), 1, "the first line (220 ms) has expired");
    view.underGraphics.calls.length = 0;
    frame(view, botShape(), { now: 1600 });
    assert.deepEqual(view.underGraphics.calls, []);
});

test("the sprint trail is seeded per bot, skips dead bots and clears when presentation is suppressed", () => {
    const run = (shape) => {
        const view = fakeView();
        for (let now = 1000; now < 1600; now += 50) frame(view, shape, { now });
        return view.underGraphics.calls;
    };
    assert.deepEqual(run(sprinting()), run(sprinting()));
    assert.notDeepEqual(run(sprinting()), run(sprinting({ slot: 2 })));
    const dead = fakeView();
    frame(dead, sprinting({ hp: 0 }), { now: 1000, dead: true });
    assert.deepEqual(dead.underGraphics.calls, []);
    const view = fakeView();
    frame(view, sprinting(), { now: 1000 });
    detached(view, sprinting());
    view.underGraphics.calls.length = 0;
    frame(view, botShape(), { now: 1020 });
    assert.deepEqual(view.underGraphics.calls, []);
});

test("Dash smoke starts on the dash transition, follows the presentation clock, and expires", () => {
    const view = fakeView();
    const previousShape = botShape();
    const shape = botShape({}, { 19: { stage: "active", remainingMs: 300 } });
    const base = { shape, phaseShape: shape, previousShape, current: { x: 150, y: 250 }, suppressTransient: false, activeAbilityId: null, previousActiveAbilityId: null, effects: {}, kit: view.kit, view };
    syncBotAbilityRenderers(view, { ...base, now: 1000 });

    frame(view, previousShape, { now: 1100 });
    const smoke = view.kit.shown.find((effect) => effect.slot === "dash-smoke");
    assert.ok(smoke);
    assert.equal(smoke.x, 150 - previousShape.x);
    assert.equal(smoke.texture, "smoke+100");

    view.kit.shown.length = 0;
    frame(view, previousShape, { now: 1500 });
    assert.deepEqual(view.kit.shown, []);
});

test("Dash smoke is not started while presentation is suppressed (reset, replay seek)", () => {
    const view = fakeView();
    const previousShape = botShape();
    const shape = botShape({}, { 19: { stage: "active", remainingMs: 300 } });
    syncBotAbilityRenderers(view, { shape, phaseShape: shape, previousShape, current: { x: 1, y: 1 }, now: 1000, suppressTransient: true, activeAbilityId: null, previousActiveAbilityId: null, effects: {}, kit: view.kit });
    frame(view, previousShape, { now: 1100 });
    assert.deepEqual(view.kit.shown, []);
});

test("Repulsor advances its cosmetic clock from the activation, not from snapshot gaps", () => {
    const view = fakeView();
    const shape = botShape({}, { 8: { stage: "active", remainingMs: 400 } });
    const sync = (now) => syncBotAbilityRenderers(view, {
        shape, phaseShape: shape, previousShape: null, current: { x: 0, y: 0 }, now, suppressTransient: false, activeAbilityId: 8, previousActiveAbilityId: 8, effects: {}, kit: view.kit,
    });
    sync(1000);
    frame(view, shape, { now: 1000 });
    const early = view.kit.shown.at(-1);
    frame(view, shape, { now: 1250 });
    const later = view.kit.shown.at(-1);
    assert.equal(early.slot, "ability");
    assert.ok(later.width >= early.width);
    assert.notEqual(early.texture, later.texture);
});

test("every renderer tolerates a dead bot with stale timers", () => {
    const view = fakeView();
    const shape = botShape({ hp: 0 }, { 1: { stage: "active", remainingMs: 100 }, 3: { stage: "active", remainingMs: 100 }, 8: { stage: "active", remainingMs: 100 }, 35: { stage: "active", remainingMs: 100 }, 36: { stage: "windup", remainingMs: 100 } });
    assert.doesNotThrow(() => frame(view, shape, { dead: true }));
    for (const type of Object.keys(BOT_ABILITY_RENDERERS)) assert.ok(botAbilityPresentationForType(type));
});

test("effect geometry is fixed-seed: same cracks and debris every run, dashes cover the outline evenly", () => {
    const settings = botAbilityPresentationForType("smash").active;
    assert.deepEqual(smashCrackPaths(settings.cracks), smashCrackPaths(settings.cracks));
    const cracks = smashCrackPaths(settings.cracks);
    assert.equal(cracks.length, 7);
    assert.ok(cracks.every((path) => path.length === 5 && path[0][0] === 0 && path[0][1] === 0));
    const debris = smashDebrisPieces(settings.debris);
    assert.equal(debris.length, 9);
    assert.ok(debris.every((piece) => Math.abs(piece.angle) <= 1.2 && piece.reach >= 70 && piece.reach <= 180));
    const dashed = dashedRectSegments(125, 100, 4.8, 4);
    const dashLength = dashed.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0);
    assert.ok(Math.abs(dashLength - (2 * (125 + 100)) * 4.8 / 8.8) < 4.8, "about 55% of the perimeter is dash");
});
