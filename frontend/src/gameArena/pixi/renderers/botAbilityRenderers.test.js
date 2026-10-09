import test from "node:test";
import assert from "node:assert/strict";
import { botAbilityPresentationForType } from "../botAbilityPresentationDefinitions.js";
import { BOT_ABILITY_RENDERERS, destroyBotAbilityRenderers, syncBotAbilityRenderers, updateBotAbilityRenderers } from "./index.js";
import { activeBotVisual } from "../pixiVisualState.js";

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
    const markers = [];
    return {
        shown,
        markers,
        showEffect: (view, slot, texture, options) => shown.push({ slot, texture, ...options }),
        hideEffects: () => {},
        frameAtProgress: (frames, progress) => `${frames?.[0] ?? "frame"}@${Number(progress).toFixed(3)}`,
        frameAt: (frames, elapsedMs) => `${frames?.[0] ?? "frame"}+${elapsedMs}`,
        muzzleAnchor: () => 0.04,
        createMarker: (layer, texture, size) => {
            const marker = { layer, texture, size, destroyed: false, container: { visible: false, position: { set() {} }, scale: { set() {} } } };
            markers.push(marker);
            return marker;
        },
        destroyMarker: (marker) => { marker.destroyed = true; },
    };
}

const arenaSprites = {
    abilities: {
        meleeSlash: ["slash"], heavySlash: ["heavy"], dashSmoke: ["smoke"], stun: ["stun"], shield: ["shield"],
        phaseStrike: ["phase"], frostRing: ["frost"], temporalRewind: ["rewind"], lockOnCrosshair: "crosshair",
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
        position: { x: shape.x, y: shape.y },
        now: 1000,
        arenaSprites,
        radius: Number(shape.size) / 2,
        rotation: Math.PI / 2,
        dead: false,
        otherBots: [],
        layers: { lockOn: { id: "lockOn" } },
        kit: view.kit,
        activeAbilityId: activeBotVisual(shape),
        ...extra,
    };
}

function fakeView() {
    return { cachedEffects: new Map(), graphics: fakeGraphics(), kit: fakeKit(), abilityRenderers: new Map() };
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
        assert.ok(view.graphics.calls.length > 0, `${type} wind-up should draw`);
    }
    const idle = fakeView();
    frame(idle, botShape({}, { 1: { stage: "windup", remainingMs: 100 } }));
    assert.deepEqual(idle.graphics.calls, []);
});

test("weapon actives draw from the hitbox while they are the active visual", () => {
    const thrust = fakeView();
    frame(thrust, botShape({}, { 35: { stage: "active", remainingMs: 150 } }));
    assert.ok(thrust.graphics.calls.some(([name]) => name === "poly"), "thrust tip");
    const smash = fakeView();
    frame(smash, botShape({}, { 37: { stage: "active", remainingMs: 150 } }));
    assert.ok(smash.graphics.calls.filter(([name]) => name === "circle").length >= 3, "smash dust");
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

test("start effects ask the scene for particles only when their visual becomes active", () => {
    const view = fakeView();
    const bursts = [];
    const heals = [];
    const effects = { spawnBurst: (...args) => bursts.push(args), spawnRepairPulse: (...args) => heals.push(args) };
    const shape = botShape({}, { 25: { stage: "active", remainingMs: 300 } });
    const sync = (activeAbilityId, previousActiveAbilityId, abilityShape = shape) => syncBotAbilityRenderers(view, {
        shape: abilityShape, phaseShape: abilityShape, previousShape: null, current: { x: 10, y: 20 }, now: 0, suppressTransient: false, activeAbilityId, previousActiveAbilityId, effects, kit: view.kit,
    });
    sync(25, null);
    sync(25, 25);
    assert.deepEqual(bursts, [[200, 300, 0xc4b5fd, 12]]);
    sync(10, null);
    assert.deepEqual(heals, [[10, 20, 12]]);
    sync(10, 10);
    assert.equal(heals.length, 1);
});

test("Lock-On keeps one scene marker per bot, hides it when inactive, and releases it on destroy", () => {
    const view = fakeView();
    const target = { view: { shape: { id: "bot-2", hp: 100, size: 60 } }, position: { x: 400, y: 300 } };
    const locking = botShape({ abilityTargetX: 395, abilityTargetY: 305 }, { 20: { stage: "active", remainingMs: 100 } });
    frame(view, locking, { otherBots: [target] });
    assert.equal(view.kit.markers.length, 1);
    assert.equal(view.kit.markers[0].container.visible, true);
    frame(view, locking, { otherBots: [target] });
    assert.equal(view.kit.markers.length, 1, "marker is reused");
    frame(view, botShape(), { otherBots: [target] });
    assert.equal(view.kit.markers[0].container.visible, false);
    destroyBotAbilityRenderers(view, view.kit);
    assert.equal(view.kit.markers[0].destroyed, true);
    assert.equal(view.abilityRenderers.size, 0);
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
