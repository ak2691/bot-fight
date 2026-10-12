import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
    BOT_ABILITY_PRESENTATIONS,
    BOT_ABILITY_VISUAL_PRIORITY,
    BOT_ABILITY_VISUAL_SETTINGS,
    botAbilityActiveMs,
    botAbilityPresentationForId,
    botAbilityPresentationForType,
} from "./botAbilityPresentationDefinitions.js";
import { BOT_ABILITY_RENDERERS } from "./renderers/index.js";
import { activationView } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";

const sourceOf = (relativePath) => readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("presentation settings are keyed by the visual type, immutable, and presentation-only", () => {
    assert.ok(Object.keys(BOT_ABILITY_VISUAL_SETTINGS).length > 0);
    for (const [type, settings] of Object.entries(BOT_ABILITY_VISUAL_SETTINGS)) {
        const presentation = botAbilityPresentationForType(type);
        assert.equal(presentation.type, type);
        assert.ok(Object.isFrozen(settings));
        assert.ok(Object.isFrozen(presentation));
        const fields = [];
        const collect = (value) => {
            for (const [key, nested] of Object.entries(value)) {
                fields.push(key);
                if (nested && typeof nested === "object") {
                    assert.ok(Object.isFrozen(nested), `${type}.${key} must be frozen`);
                    collect(nested);
                }
            }
        };
        collect(settings);
        assert.ok(!fields.some((field) => ["damage", "hit", "cooldown", "knockback"].includes(field)),
            "presentation metadata must not describe gameplay outcomes");
    }
    assert.equal(botAbilityPresentationForType("missing"), null);
    assert.equal(botAbilityPresentationForId("invalid"), null);
});

test("each presentation type resolves to the ability whose trigger declares that visual type", () => {
    for (const presentation of BOT_ABILITY_PRESENTATIONS) {
        if (presentation.abilityId == null) continue;
        assert.equal(activationView(presentation.abilityId).visual.type, presentation.type);
        assert.equal(botAbilityPresentationForId(presentation.abilityId), presentation);
    }
    // Rewind's visual lives on its entity phase, so it is driven by bot timer fields instead. Overdrive, Parry, Overcharge
    // and Tether Link's chain are status auras, and Disruptive Beam's counter-hit is a stun's flash: none has an ability trigger.
    assert.deepEqual(BOT_ABILITY_PRESENTATIONS.filter((presentation) => presentation.abilityId == null).map(({ type }) => type),
        ["sprintTrail", "temporalRewindZone", "overdrive", "parry", "overcharge", "counterHit", "tetherChain"]);
});

test("every presentation type has exactly one renderer module and vice versa", async () => {
    assert.deepEqual(Object.keys(BOT_ABILITY_RENDERERS).sort(), Object.keys(BOT_ABILITY_VISUAL_SETTINGS).sort());
    const files = (await readdir(fileURLToPath(new URL("./renderers/", import.meta.url))))
        .filter((file) => !["index.js", "rendererHelpers.js", "pixiToolkit.js", "entityRenderers.js"].includes(file) && file.endsWith(".js") && !file.endsWith(".test.js"))
        .map((file) => file.replace(/\.js$/, ""));
    assert.deepEqual(files.sort(), Object.keys(BOT_ABILITY_RENDERERS).sort());
    for (const [type, renderer] of Object.entries(BOT_ABILITY_RENDERERS)) {
        assert.equal(typeof renderer.create, "function", `${type}.create`);
        assert.equal(typeof renderer.update, "function", `${type}.update`);
        assert.equal(typeof renderer.destroy, "function", `${type}.destroy`);
    }
});

test("active presentation precedence matches the established ability priority", () => {
    assert.deepEqual(BOT_ABILITY_VISUAL_PRIORITY,
        [1, 3, 6, 8, 25, 26, 30, 32, 35, 36, 37, 38, 39, 45]);
});

test("the sprint trail is approved option C: a 50 ms line spawn with dust about one time in three", () => {
    const trail = botAbilityPresentationForType("sprintTrail");
    assert.equal(trail.abilityId, null);
    assert.equal(trail.spawnIntervalMs, 50);
    assert.equal(trail.line.lifeMs, 220);
    assert.equal(trail.dust.lifeMs, 500);
    assert.ok(trail.dust.chance > 0.3 && trail.dust.chance < 0.4);
});

test("Sniper keeps the gun type with a sight wind-up and rail_shot fire", () => {
    const sniper = botAbilityPresentationForId(3);
    assert.equal(sniper.type, "gun");
    assert.deepEqual({ ...sniper.sight }, { color: 0xef4444, width: 2, alphaMin: 0.35, alphaMax: 0.8, pulses: 3 });
    assert.equal(sniper.activeRay.rayFrames, "rail_shot");
    assert.equal(sniper.activeRay.height, 40);
    assert.equal(sniper.activeRay.muzzleFlash, true);
    assert.equal(sniper.directRay.rayFrames, "rail_shot");
});

test("active clocks come from ability records only", () => {
    const dash = botAbilityPresentationForType("dash");
    assert.equal(dash.abilityId, 19);
    assert.equal(botAbilityActiveMs({ abilityState: { [dash.abilityId]: { stage: "active", remainingMs: 500 } } }, dash), 500);
    assert.equal(botAbilityActiveMs({}, dash), 0);
    assert.equal(botAbilityActiveMs({}, botAbilityPresentationForType("temporalRewindZone")), 0);
});

test("PixiCanvas dispatches bot ability visuals through the renderer registry only", async () => {
    const source = await sourceOf("./PixiCanvas.jsx");
    assert.match(source, /updateBotAbilityRenderers\(view, rendererContext\)/);
    assert.match(source, /syncBotAbilityRenderers\(view,/);
    assert.match(source, /destroyBotAbilityRenderers\(view, rendererKit\)/);
    assert.doesNotMatch(source, /botAbilityPresentationForRole|BOT_ABILITY_PRESENTATION_DEFINITIONS/);
    assert.doesNotMatch(source, /effect\.type\s*===|visual\s*===\s*(?:\d+|[A-Z_]+\.id)\b/);
    assert.doesNotMatch(source, /abilityActiveMs\?\.\[\d+\]/);
    for (const removed of ["drawBotWorldEffects", "drawWeaponWindup", "drawThrustActive", "drawSmashActive", "drawDashSmoke", "drawLockOnMarkers"]) {
        assert.doesNotMatch(source, new RegExp(removed));
    }
});

test("renderers are driven only by state and contract numbers", async () => {
    const directory = new URL("./renderers/", import.meta.url);
    const files = (await readdir(fileURLToPath(directory))).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"));
    assert.ok(files.length > BOT_ABILITY_PRESENTATIONS.length);
    for (const file of files) {
        const source = await readFile(fileURLToPath(new URL(file, directory)), "utf8");
        assert.doesNotMatch(source, /Math\.random|Date\.now|performance\.now/, `${file} must not read randomness or wall time`);
        if (file !== "pixiToolkit.js") assert.doesNotMatch(source, /from "pixi\.js"/, `${file} must reach Pixi through ctx.kit`);
    }
});
