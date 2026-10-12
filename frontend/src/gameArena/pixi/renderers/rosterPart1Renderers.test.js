import test from "node:test";
import assert from "node:assert/strict";
import { BOT_ABILITY_RENDERERS } from "./index.js";
import { ENTITY_VISUAL_RENDERERS } from "./entityRenderers.js";
import { BOT_ABILITY_VISUAL_SETTINGS, ENTITY_VISUAL_SETTINGS, botAbilityPresentationForType } from "../botAbilityPresentationDefinitions.js";

// Roster batch R2, part 1 renderers (docs/visuals/ability-visuals.html). The renderers draw through a recorder, so the
// checks are about which phase draws and which stays quiet, not about pixels.

function recorder() {
    const calls = [];
    const graphics = new Proxy({}, {
        get: (_target, name) => name === "calls" ? calls : (...args) => { calls.push([name, ...args]); return graphics; },
    });
    return { graphics, calls };
}

function context({ abilityId, pass, shape, presentation, graphics }) {
    return {
        pass, shape, graphics, presentation, abilityId, active: true, dead: false,
        position: { x: shape.x, y: shape.y }, rotation: Math.PI / 2, now: 1000, state: {}, arenaSprites: { abilities: {} },
    };
}

test("every procedural entity visual has settings, and the part 1 entity visuals are registered", () => {
    for (const type of Object.keys(ENTITY_VISUAL_RENDERERS)) assert.ok(ENTITY_VISUAL_SETTINGS[type], type);
    for (const type of ["pellet", "lungeStab", "tarGlob", "tarPit"]) assert.ok(ENTITY_VISUAL_RENDERERS[type], type);
});

test("the part 1 bot visuals have a presentation and a renderer, and the status aura has no ability", () => {
    for (const type of ["lunge", "shotgunBlast", "overdrive"]) {
        assert.ok(BOT_ABILITY_VISUAL_SETTINGS[type], type);
        assert.ok(BOT_ABILITY_RENDERERS[type], type);
        assert.ok(botAbilityPresentationForType(type), type);
    }
    assert.equal(botAbilityPresentationForType("overdrive").abilityId, null);
    assert.equal(botAbilityPresentationForType("lunge").abilityId, 38);
    assert.equal(botAbilityPresentationForType("shotgunBlast").abilityId, 39);
});

test("Lunge draws its crouch while it crouches and its leap afterwards, and nothing in the body pass", () => {
    const presentation = botAbilityPresentationForType("lunge");
    const draw = (remainingMs, pass = "world") => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, abilityVisual: { ability: 38, ms: remainingMs } };
        BOT_ABILITY_RENDERERS.lunge.update(context({ abilityId: 38, pass, shape, presentation, graphics }));
        return calls;
    };
    // The bot visual lasts 300 ms: 150 ms left is 150 ms in, which is inside the 200 ms crouch.
    assert.ok(draw(150).some(([name]) => name === "circle"), "crouch ring");
    // 50 ms left is 250 ms in: past the crouch, into the leap's afterimages.
    assert.ok(draw(50).some(([name]) => name === "circle"), "leap afterimages");
    assert.deepEqual(draw(150, "body"), [], "the lunge draws in the world pass only");
});

test("Shotgun Blast draws its muzzle blast only while it is showing", () => {
    const presentation = botAbilityPresentationForType("shotgunBlast");
    const shotgun = (ms) => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, abilityVisual: { ability: 39, ms } };
        // The renderer loop sets `active` from the ability's visual clock, so an ended visual is not active.
        BOT_ABILITY_RENDERERS.shotgunBlast.update({ ...context({ abilityId: 39, pass: "world", shape, presentation, graphics }), active: ms > 0 });
        return calls;
    };
    assert.ok(shotgun(120).some(([name]) => name === "poly"));
    assert.deepEqual(shotgun(0), []);
});

test("Overdrive draws its aura from the status, in the body pass, and only while the status runs", () => {
    const presentation = botAbilityPresentationForType("overdrive");
    const aura = (statusEffects, pass = "body") => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, statusEffects };
        BOT_ABILITY_RENDERERS.overdrive.update(context({ abilityId: null, pass, shape, presentation, graphics }));
        return calls;
    };
    const running = [{ type: "overdrive", mode: "duration", remainingMs: 1250 }];
    assert.ok(aura(running).some(([name]) => name === "stroke"), "aura drawn");
    assert.deepEqual(aura(running, "world"), [], "body pass only");
    assert.deepEqual(aura([]), [], "no status, no aura");
    assert.deepEqual(aura([{ type: "overdrive", mode: "duration", remainingMs: 0 }]), [], "expired status, no aura");
});
