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
    botAbilityWindupEffect,
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
        [1, 3, 5, 6, 20, 7, 18, 12, 9, 13, 8, 10, 16, 23, 25, 26, 30, 32, 33, 34, 35, 36, 37]);
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

test("weapon placeholder visuals are registered and Slash keeps its meleeSwing", () => {
    assert.equal(botAbilityPresentationForId(1).bodyEffect.type, "meleeSwing");
    assert.equal(botAbilityPresentationForId(1).windupEffect, undefined);
    assert.equal(botAbilityPresentationForId(35).windupEffect.type, "thrustWindup");
    assert.equal(botAbilityPresentationForId(35).activeEffect.type, "thrust");
    assert.equal(botAbilityPresentationForId(35).activeEffect.color, 0xcbd5e1);
    assert.equal(botAbilityPresentationForId(36).windupEffect.type, "cleaveWindup");
    assert.equal(botAbilityPresentationForId(36).windupEffect.color, 0xf59e0b);
    assert.equal(botAbilityPresentationForId(36).activeEffect.type, "heavySlash");
    assert.equal(botAbilityPresentationForId(36).activeEffect.sizingHitboxAbilityId, 36);
    assert.equal(botAbilityPresentationForId(36).activeEffect.tint, 0xfde68a);
    assert.equal(botAbilityPresentationForId(37).windupEffect.type, "smashWindup");
    assert.equal(botAbilityPresentationForId(37).activeEffect.type, "smash");
    assert.ok(Object.isFrozen(botAbilityPresentationForId(37).windupEffect));
});

test("wind-up effects resolve only while the bot prepares that weapon", () => {
    assert.equal(botAbilityWindupEffect({ preparingAbility: 36 }).effect.type, "cleaveWindup");
    assert.equal(botAbilityWindupEffect({ preparingAbility: 1 }), null);
    assert.equal(botAbilityWindupEffect({ preparingAbility: null }), null);
    assert.equal(botAbilityWindupEffect({}), null);
});

test("PixiCanvas draws weapon effects from the contract hitbox and bot state only", async () => {
    const source = await readFile(fileURLToPath(new URL("./PixiCanvas.jsx", import.meta.url)), "utf8");
    const start = source.indexOf("function drawWeaponWindup");
    const end = source.indexOf("function drawProceduralAbilityRay");
    const weaponSource = source.slice(start, end);
    assert.ok(start > 0 && end > start);
    assert.doesNotMatch(weaponSource, /Math\.random/);
    assert.match(weaponSource, /hitbox\.length/);
    assert.match(weaponSource, /hitbox\.width/);
    assert.match(weaponSource, /hitbox\.range/);
    assert.match(weaponSource, /hitbox\.arc/);
    assert.match(source, /effect\.type === "thrust"/);
    assert.match(source, /effect\.type === "smash"/);
});

test("Sniper presentation keeps the gun role with a sight wind-up and rail_shot fire", () => {
    const sniper = botAbilityPresentationForId(3);
    assert.equal(sniper.role, "gun");
    assert.equal(sniper.windupEffect.type, "sniperSight");
    assert.equal(sniper.windupEffect.color, 0xef4444);
    assert.equal(sniper.windupEffect.width, 2);
    assert.equal(sniper.windupEffect.alphaMin, 0.35);
    assert.equal(sniper.windupEffect.alphaMax, 0.8);
    assert.equal(sniper.activeEffect.type, "abilityRay");
    assert.equal(sniper.activeEffect.rayFrames, "rail_shot");
    assert.equal(sniper.activeEffect.height, 40);
    assert.equal(sniper.activeEffect.muzzleFlash, true);
    assert.equal(sniper.directEffect.rayFrames, "rail_shot");
    assert.equal(botAbilityWindupEffect({ preparingAbility: 3 }).effect.type, "sniperSight");
});
