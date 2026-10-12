import test from "node:test";
import assert from "node:assert/strict";
import { BOT_ABILITY_RENDERERS } from "./index.js";
import { ENTITY_VISUAL_RENDERERS } from "./entityRenderers.js";
import { BOT_ABILITY_VISUAL_SETTINGS, ENTITY_VISUAL_SETTINGS, botAbilityPresentationForType } from "../botAbilityPresentationDefinitions.js";

// Roster batch R4 renderers (docs/visuals/ability-visuals.html): Execute's bonus X, Backstab (entity), the Disruptive Beam
// counter-hit, Parry, Overcharge, Tether Link's bolt (entity) and its chain. The renderers draw through a recorder, so the
// checks are about which pass draws and which stays quiet, not about pixels.

function recorder() {
    const calls = [];
    const graphics = new Proxy({}, {
        get: (_target, name) => name === "calls" ? calls : (...args) => { calls.push([name, ...args]); return graphics; },
    });
    return { graphics, calls };
}

function context({ abilityId = null, pass, shape, presentation, graphics, now = 1000, otherBots = [], position = { x: shape.x, y: shape.y } }) {
    return {
        pass, shape, graphics, presentation, abilityId, active: true, dead: false, position, now, state: {},
        arenaSprites: { abilities: {} }, rotation: Math.PI / 2, otherBots,
    };
}

const drawn = (calls) => calls.length > 0;

test("every R4 bot visual and entity visual is registered with its settings", () => {
    for (const type of ["parry", "overcharge", "counterHit", "tetherChain", "execute"]) {
        assert.ok(BOT_ABILITY_RENDERERS[type], type);
        assert.ok(BOT_ABILITY_VISUAL_SETTINGS[type], type);
    }
    for (const type of ["backstab", "tetherLink"]) {
        assert.ok(ENTITY_VISUAL_RENDERERS[type], type);
        assert.ok(ENTITY_VISUAL_SETTINGS[type], type);
    }
    assert.equal(botAbilityPresentationForType("parry").abilityId, null, "Parry has no activation visual");
    assert.equal(botAbilityPresentationForType("counterHit").abilityId, null, "the counter-hit is a stun's flash");
});

test("Execute's strike shows an X only when the finisher landed", () => {
    const presentation = botAbilityPresentationForType("execute");
    const strike = (bonus) => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, abilityVisual: { ability: 45, ms: 300, bonus } };
        BOT_ABILITY_RENDERERS.execute.update(context({ abilityId: 45, pass: "world", shape, presentation, graphics }));
        return calls;
    };
    const plain = strike(false).filter(([name]) => name === "stroke").length;
    const bonus = strike(true).filter(([name]) => name === "stroke").length;
    assert.ok(bonus > plain, "the X adds strokes");
});

test("Backstab: the sweep draws in the wait phase, and the from-behind flash only in the strike phase when it landed", () => {
    const backstab = (phaseId, bonusLanded) => {
        const { graphics, calls } = recorder();
        ENTITY_VISUAL_RENDERERS.backstab.update({
            graphics,
            shape: { abilityId: 25, entityKey: "backstab", phaseId, phaseTimerMs: 50, rotation: 90, bonusLanded },
            settings: ENTITY_VISUAL_SETTINGS.backstab,
        });
        return calls;
    };
    assert.ok(drawn(backstab("wait", false)), "the sweep draws while waiting");
    assert.deepEqual(backstab("strike", false), [], "nothing in the strike phase without the bonus");
    assert.ok(backstab("strike", true).some(([name]) => name === "circle"), "the bonus ring in the stab phase");
});

test("Parry: the stance draws in the world pass while the status runs, and a burst follows a block", () => {
    const presentation = botAbilityPresentationForType("parry");
    const stance = (remainingMs, pass = "world") => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, statusEffects: [{ type: "parry", mode: "duration", remainingMs }] };
        BOT_ABILITY_RENDERERS.parry.update(context({ pass, shape, presentation, graphics }));
        return calls;
    };
    assert.ok(drawn(stance(200)), "the stance draws");
    assert.deepEqual(stance(200, "body"), [], "the stance is a world-pass visual");
    const idle = recorder();
    BOT_ABILITY_RENDERERS.parry.update(context({ pass: "world", shape: { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, statusEffects: [] }, presentation, graphics: idle.graphics }));
    assert.deepEqual(idle.calls, [], "no status, no stance");

    // A status that ends with more than one tick left was used up by an attack: the burst starts on that snapshot.
    const state = {};
    const snapshot = (statusEffects, now) => BOT_ABILITY_RENDERERS.parry.sync({
        shape: { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, statusEffects }, state, now, presentation,
    });
    snapshot([{ type: "parry", mode: "duration", remainingMs: 200 }], 1000);
    snapshot([], 1100);
    assert.equal(state.blockedAt, 1100, "a block starts the burst");
    const burst = recorder();
    BOT_ABILITY_RENDERERS.parry.update({ ...context({ pass: "world", shape: { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, statusEffects: [] }, presentation, graphics: burst.graphics }), state, now: 1150 });
    assert.ok(drawn(burst.calls), "the burst draws shortly after the block");

    // The status that runs out on its own (its last snapshot had one tick left) starts no burst.
    const expired = {};
    BOT_ABILITY_RENDERERS.parry.sync({ shape: { id: "bot-1", x: 0, y: 0, rotation: 0, size: 60, statusEffects: [{ type: "parry", remainingMs: 100 }] }, state: expired, now: 1000, presentation });
    BOT_ABILITY_RENDERERS.parry.sync({ shape: { id: "bot-1", x: 0, y: 0, rotation: 0, size: 60, statusEffects: [] }, state: expired, now: 1100, presentation });
    assert.equal(expired.blockedAt, undefined, "running out is not a block");
});

test("Overcharge: the aura draws in the body pass while the status runs, and a spent charge pops a pip", () => {
    const presentation = botAbilityPresentationForType("overcharge");
    const aura = (charges, pass = "body") => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-1", x: 300, y: 600, rotation: 90, size: 60, statusEffects: [{ type: "overcharge", mode: "duration", remainingMs: 6000, charges }] };
        BOT_ABILITY_RENDERERS.overcharge.update(context({ pass, shape, presentation, graphics }));
        return calls;
    };
    assert.ok(drawn(aura(4)), "the aura draws");
    assert.deepEqual(aura(4, "world"), [], "the aura is a body-pass visual");
    assert.deepEqual(aura(0), [], "no charges, nothing to draw");

    const state = {};
    const shape = (charges) => ({ id: "bot-1", x: 0, y: 0, rotation: 0, size: 60, statusEffects: [{ type: "overcharge", mode: "duration", remainingMs: 6000, charges }] });
    BOT_ABILITY_RENDERERS.overcharge.sync({ shape: shape(4), state, now: 1000, presentation });
    BOT_ABILITY_RENDERERS.overcharge.sync({ shape: shape(3), state, now: 1100, presentation });
    assert.equal(state.popAt, 1100, "a charge spent pops a pip");
});

test("the counter-hit flashes on the target only for the first window of a stun the Disruptive Beam landed", () => {
    const presentation = botAbilityPresentationForType("counterHit");
    const flash = (stun) => {
        const { graphics, calls } = recorder();
        const shape = { id: "bot-2", x: 600, y: 600, rotation: 270, size: 60, statusEffects: stun ? [stun] : [] };
        BOT_ABILITY_RENDERERS.counterHit.update(context({ pass: "world", shape, presentation, graphics }));
        return calls;
    };
    assert.ok(drawn(flash({ type: "stun", abilityId: 30, remainingMs: 950 })), "the beam's stun, 50 ms in");
    assert.deepEqual(flash({ type: "stun", abilityId: 30, remainingMs: 500 }), [], "after the window the flash is gone");
    assert.deepEqual(flash({ type: "stun", abilityId: 6, remainingMs: 950 }), [], "a Stun from another ability is not the counter-hit");
    assert.deepEqual(flash(null), [], "no stun, no flash");
});

test("Tether Link's chain runs from the caster to the tethered bot, and is only drawn while the caster is on screen", () => {
    const presentation = botAbilityPresentationForType("tetherChain");
    const holder = { id: "bot-2", slot: 2, x: 400, y: 600, rotation: 270, size: 60, statusEffects: [{ type: "tethered", mode: "duration", remainingMs: 3000, sourceSlot: 1 }] };
    const caster = { view: { shape: { id: "bot-1", slot: 1, x: 200, y: 600 } }, position: { x: 200, y: 600 } };
    const chain = (otherBots) => {
        const { graphics, calls } = recorder();
        BOT_ABILITY_RENDERERS.tetherChain.update(context({ pass: "body", shape: holder, presentation, graphics, otherBots, position: { x: 400, y: 600 } }));
        return calls;
    };
    assert.ok(drawn(chain([caster])), "the chain draws to the caster");
    assert.deepEqual(chain([]), [], "no caster on screen, no chain");
    const world = recorder();
    BOT_ABILITY_RENDERERS.tetherChain.update(context({ pass: "world", shape: holder, presentation, graphics: world.graphics, otherBots: [caster], position: { x: 400, y: 600 } }));
    assert.deepEqual(world.calls, [], "the chain is a body-pass visual");
});

test("the Tether Link bolt draws its head and trail for an entity", () => {
    const { graphics, calls } = recorder();
    ENTITY_VISUAL_RENDERERS.tetherLink.update({ graphics, shape: { abilityId: 47, entityKey: "tether_link", phaseId: "outbound", phaseTimerMs: 100, rotation: 90 }, settings: ENTITY_VISUAL_SETTINGS.tetherLink });
    assert.ok(calls.some(([name]) => name === "poly"), "the head");
    assert.ok(calls.some(([name]) => name === "moveTo"), "the trail");
});
