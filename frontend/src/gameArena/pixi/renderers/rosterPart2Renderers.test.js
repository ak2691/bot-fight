import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_VISUAL_RENDERERS } from "./entityRenderers.js";
import { ENTITY_VISUAL_SETTINGS } from "../botAbilityPresentationDefinitions.js";

// Roster batch R3 renderers: the Boomerang and Fan of Blades entity visuals. They are
// phase visuals, so the checks cover registration, their settings, and that each one draws for an entity it is given.

function recorder() {
    const calls = [];
    const graphics = new Proxy({}, {
        get: (_target, name) => name === "calls" ? calls : (...args) => { calls.push([name, ...args]); return graphics; },
    });
    return { graphics, calls };
}

test("the Boomerang and Fan of Blades entity visuals are registered with their settings", () => {
    for (const type of ["boomerang", "blade"]) {
        assert.ok(ENTITY_VISUAL_RENDERERS[type], type);
        assert.ok(ENTITY_VISUAL_SETTINGS[type], type);
    }
    assert.notEqual(ENTITY_VISUAL_SETTINGS.boomerang.color, ENTITY_VISUAL_SETTINGS.boomerang.returnColor, "the return is a different colour");
});

test("the Boomerang and Fan of Blades visuals draw for an entity, with no phase data needed", () => {
    for (const type of ["boomerang", "blade"]) {
        const { graphics, calls } = recorder();
        ENTITY_VISUAL_RENDERERS[type].update({ graphics, shape: { x: 300, y: 600, rotation: 90, ageMs: 400 }, settings: ENTITY_VISUAL_SETTINGS[type] });
        assert.ok(calls.some(([name]) => name === "poly" || name === "circle" || name === "moveTo"), `${type} draws`);
    }
});
