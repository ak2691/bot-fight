import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
    BOT_ABILITY_PRESENTATION_DEFINITIONS,
    BOT_ABILITY_VISUAL_PRIORITY,
    botAbilityActiveMs,
    botAbilityPresentationForId,
    botAbilityPresentationForRole,
} from "./botAbilityPresentationDefinitions.js";

test("ability presentation registry is keyed by ability ID and immutable", () => {
    assert.ok(Object.keys(BOT_ABILITY_PRESENTATION_DEFINITIONS).length > 0);
    for (const [id, definition] of Object.entries(BOT_ABILITY_PRESENTATION_DEFINITIONS)) {
        assert.equal(definition.id, Number(id));
    }
    for (const definition of Object.values(BOT_ABILITY_PRESENTATION_DEFINITIONS)) {
        assert.ok(Object.isFrozen(definition));
        for (const metadata of [definition.bodyEffect, definition.directEffect, definition.activeEffect, definition.onVisualStart, definition.marker, definition.shapeEffect]) {
            if (metadata) assert.ok(Object.isFrozen(metadata));
        }
        const fields = [definition, definition.bodyEffect, definition.directEffect, definition.activeEffect, definition.onVisualStart, definition.marker, definition.shapeEffect]
            .filter(Boolean).flatMap((metadata) => Object.keys(metadata));
        assert.ok(!fields.some((field) => ["damage", "hit", "cooldown", "knockback"].includes(field)),
            "presentation metadata must not describe gameplay outcomes");
    }
    assert.equal(botAbilityPresentationForId("8").activeEffect.type, "repulsorBurst");
    assert.equal(botAbilityPresentationForId("invalid"), null);
    assert.equal(botAbilityPresentationForRole("missing"), null);
});

test("active presentation precedence matches the established ability priority", () => {
    assert.deepEqual(BOT_ABILITY_VISUAL_PRIORITY,
        [1, 3, 5, 6, 20, 7, 18, 12, 9, 13, 8, 10, 16, 23, 25, 26, 30, 32, 33, 34]);
});

test("named definitions read only renderer-facing active clocks", () => {
    const dash = botAbilityPresentationForRole("dash");
    assert.equal(dash.transitionEffect, "dashSmoke");
    assert.equal(botAbilityActiveMs({ abilityActiveMs: { [dash.id]: 500 } }, dash), 500);
    assert.equal(botAbilityActiveMs({}, dash), 0);
    assert.equal(botAbilityPresentationForRole("lock-on").marker.type, "lockOn");
    assert.equal(botAbilityPresentationForRole("temporal-rewind").shapeEffect.timerField, "temporalRewindPulseMs");
});

test("PixiCanvas dispatches active bot effects through the keyed registry", async () => {
    const source = await readFile(fileURLToPath(new URL("./PixiCanvas.jsx", import.meta.url)), "utf8");
    assert.match(source, /botAbilityPresentationForId\(visual\)/);
    assert.match(source, /effect\.type === "abilityRay"/);
    assert.match(source, /definition\.shapeEffect/);
    assert.doesNotMatch(source, /visual\s*===\s*(?:7|8|10|16|23|25|26|30|32|33|34)\b/);
    assert.doesNotMatch(source, /abilityActiveMs\?\.\[(?:1|3|6|19|20)\]/);
});
