import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ABILITY_CATALOGUE_ICON_LAYOUTS, ABILITY_CATALOGUE_ICONS, getAbilityCatalogueIcon, getAbilityCatalogueIconLayout } from "../../abilityCatalogueIcons.js";
import { BOT_ABILITIES } from "../../gameArena/loadout/BotLoadout.js";
import { STATUS_EFFECT_GUIDE } from "./statusEffectCatalogue.js";

const ICON_DIRECTORY = fileURLToPath(new URL("../../../public/assets/ability-list/icons/", import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL("../../../scripts/ability_catalogue_icon_manifest.json", import.meta.url));
const CATALOGUE_PAGE_PATH = fileURLToPath(new URL("./AbilityCataloguePage.jsx", import.meta.url));
const ARENA_PATH = fileURLToPath(new URL("../../gameArena/Arena.jsx", import.meta.url));
const INDEX_CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));
const LEGACY_ICON_FILENAMES = Object.freeze({
    slash: "swing",
    gun: "fire_gun",
    grenade: "throw_grenade",
    fireball: "shoot_fireball",
    pistol: "pistol_shot",
});

test("every registered ability has one generated catalogue icon", () => {
    assert.equal(Object.keys(ABILITY_CATALOGUE_ICONS).length, BOT_ABILITIES.length + 2);
    for (const ability of BOT_ABILITIES) {
        const iconPath = getAbilityCatalogueIcon(ability.id);
        const iconFilename = ability.name === "singularity" ? "singularity (2).webp" : `${LEGACY_ICON_FILENAMES[ability.name] ?? ability.name}.webp`;
        const expectedIconPath = ability.name === "singularity"
            ? "/assets/ability-list/icons/singularity%20%282%29.webp"
            : `/assets/ability-list/icons/${iconFilename}`;
        assert.equal(iconPath, expectedIconPath);
        assert.equal(existsSync(`${ICON_DIRECTORY}${iconFilename}`), true, ability.id);
    }
    assert.equal(getAbilityCatalogueIcon(19), "/assets/ability-list/icons/dash.webp");
    assert.equal(existsSync(`${ICON_DIRECTORY}dash.webp`), true);
    assert.match(getAbilityCatalogueIcon(20), /crosshair\.png$/);
});

test("icon extraction manifest covers the catalog and keeps explicit frame contracts", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    assert.deepEqual(Object.keys(manifest.icons).sort(), BOT_ABILITIES.map(({ name }) => name).sort());
    for (const [abilityId, spec] of Object.entries(manifest.icons)) {
        if (!spec.grid) continue;
        const { columns, rows, used_frames = columns * rows, frame_index } = spec.grid;
        assert.ok(Number.isInteger(columns) && columns > 0, `${abilityId}: columns`);
        assert.ok(Number.isInteger(rows) && rows > 0, `${abilityId}: rows`);
        assert.ok(Number.isInteger(used_frames) && used_frames > 0 && used_frames <= columns * rows, `${abilityId}: used_frames`);
        assert.ok(Number.isInteger(frame_index) && frame_index >= 0 && frame_index < used_frames, `${abilityId}: frame_index`);
    }
    assert.deepEqual(manifest.icons.heavy_slash.grid, { columns: 6, rows: 2, frame_index: 6 });
    assert.deepEqual(manifest.icons.slash.grid, { columns: 6, rows: 2, frame_index: 0 });
    assert.deepEqual(manifest.icons.rail_shot.grid, { columns: 2, rows: 5, used_frames: 9, frame_index: 6 });
    assert.deepEqual(manifest.icons.gravity_grenade.grid, { columns: 10, rows: 10, used_frames: 91, frame_index: 55 });
    assert.deepEqual(manifest.icons.silence_pulse.grid, { columns: 2, rows: 3, used_frames: 5, frame_index: 2 });
    assert.deepEqual(manifest.icons.reactive_armor.procedural, "status_symbol");
    assert.deepEqual(manifest.icons.absolute_guard.procedural, "status_symbol");
    assert.notEqual(manifest.icons.reactive_armor.status, manifest.icons.absolute_guard.status);
    const hash = (id) => createHash("sha256").update(readFileSync(`${ICON_DIRECTORY}${id}.webp`)).digest("hex");
    assert.notEqual(hash("swing"), hash("heavy_slash"));
    assert.notEqual(hash("fire_gun"), hash("pistol_shot"));
    assert.notEqual(hash("reactive_armor"), hash("absolute_guard"));
});

test("catalogue cards keep text accessible and artwork decorative", () => {
    const source = readFileSync(CATALOGUE_PAGE_PATH, "utf8");
    assert.match(source, /className=\{`ability-card-art ability-card-art-\$\{getAbilityCatalogueIconLayout\(ability\.id\)\}`\}/);
    assert.match(source, /alt=""/);
    assert.match(source, /aria-hidden="true"/);
    assert.match(source, /aria-label=\{`View \$\{ability\.label\} stats`\}/);
    assert.match(source, /onError=\{\(event\) => \{/);
    assert.doesNotMatch(source, /src="\/assets\/arena-toolbar\/info-circle-icon\.png"/);
});

test("catalogue starts with a compact status-effect guide and the requested intro", () => {
    const source = readFileSync(CATALOGUE_PAGE_PATH, "utf8");

    assert.equal(STATUS_EFFECT_GUIDE.length, 10);
    assert.ok(STATUS_EFFECT_GUIDE.every(({ label, description }) => label && description));
    assert.match(source, /Explore abilities here\. Click one to inspect its details\./);
    assert.match(source, /aria-labelledby="status-effects-title"/);
    assert.match(source, /STATUS_EFFECT_GUIDE\.map/);
    assert.doesNotMatch(source, /aria-labelledby="ability-types-title"/);
    assert.doesNotMatch(source, />Ability types<\/h2>/);
});

test("new catalogue artwork uses shape-aware layouts", () => {
    const source = readFileSync(CATALOGUE_PAGE_PATH, "utf8");
    const styles = readFileSync(INDEX_CSS_PATH, "utf8");
    assert.deepEqual(ABILITY_CATALOGUE_ICON_LAYOUTS, {
        tether_bolt: "wide",
        vampiric_beam: "wide",
        disruptor_dart: "wide",
        static_snare: "square",
        overclock: "square",
        singularity: "square",
        frost_ring: "square",
    });
    assert.equal(getAbilityCatalogueIconLayout(28), "wide");
    assert.equal(getAbilityCatalogueIconLayout(33), "square");
    assert.match(source, /getAbilityCatalogueIconLayout\(ability\.id\)/);
    assert.match(source, /ability-card-art-\$\{getAbilityCatalogueIconLayout/);
    assert.match(styles, /\.ability-card-art-wide[\s\S]*width: 90%;[\s\S]*height: 68%;/);
    assert.match(styles, /\.ability-card-art-square[\s\S]*width: 76%;[\s\S]*height: 94%;/);
});

test("missing icon mappings fail soft without removing the ability name", () => {
    assert.equal(getAbilityCatalogueIcon("unknown_future_ability"), null);
});

test("ability details can launch a practice room preset", () => {
    const catalogue = readFileSync(CATALOGUE_PAGE_PATH, "utf8");
    const arena = readFileSync(ARENA_PATH, "utf8");

    assert.match(catalogue, /onTestAbility = null/);
    assert.match(catalogue, />\s*TEST ABILITY\s*</);
    assert.match(catalogue, /arena-toolbar-button arena-toolbar-button--green arena-toolbar-button--inline/);
    assert.match(catalogue, /navigate\(`\/practice\?ability=\$\{encodeURIComponent\(ability\.id\)\}`\)/);
    assert.match(arena, /findAbilityTestingPreset/);
    assert.match(arena, /buildAbilityTestingArenaShapes\(catalogueAbilityTestingPreset\)/);
});
