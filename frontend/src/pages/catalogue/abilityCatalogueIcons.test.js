import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ABILITY_CATALOGUE_ICONS, getAbilityCatalogueIcon } from "../../abilityCatalogueIcons.js";
import { BOT_ABILITIES } from "../../gameArena/loadout/BotLoadout.js";

const ICON_DIRECTORY = fileURLToPath(new URL("../../../public/assets/ability-list/icons/", import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL("../../../scripts/ability_catalogue_icon_manifest.json", import.meta.url));
const CATALOGUE_PAGE_PATH = fileURLToPath(new URL("./AbilityCataloguePage.jsx", import.meta.url));

test("every registered ability has one generated catalogue icon", () => {
    assert.equal(Object.keys(ABILITY_CATALOGUE_ICONS).length, BOT_ABILITIES.length + 2);
    for (const ability of BOT_ABILITIES) {
        const iconPath = getAbilityCatalogueIcon(ability.id);
        assert.match(iconPath, new RegExp(`/assets/ability-list/icons/${ability.name}\\.png$`));
        assert.equal(existsSync(`${ICON_DIRECTORY}${ability.name}.png`), true, ability.id);
    }
    assert.equal(getAbilityCatalogueIcon(19), "/assets/ability-list/icons/dash.png");
    assert.equal(existsSync(`${ICON_DIRECTORY}dash.png`), true);
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
    assert.deepEqual(manifest.icons.block.grid, { columns: 5, rows: 4, frame_index: 12 });
    assert.deepEqual(manifest.icons.heavy_slash.grid, { columns: 6, rows: 2, frame_index: 6 });
    assert.deepEqual(manifest.icons.swing.grid, { columns: 6, rows: 2, frame_index: 0 });
    assert.deepEqual(manifest.icons.rail_shot.grid, { columns: 2, rows: 5, used_frames: 9, frame_index: 6 });
    assert.deepEqual(manifest.icons.gravity_grenade.grid, { columns: 10, rows: 10, used_frames: 91, frame_index: 55 });
    assert.deepEqual(manifest.icons.silence_pulse.grid, { columns: 2, rows: 3, used_frames: 5, frame_index: 2 });
    assert.deepEqual(manifest.icons.reactive_armor.procedural, "status_symbol");
    assert.deepEqual(manifest.icons.absolute_guard.procedural, "status_symbol");
    assert.notEqual(manifest.icons.reactive_armor.status, manifest.icons.absolute_guard.status);
    const hash = (id) => createHash("sha256").update(readFileSync(`${ICON_DIRECTORY}${id}.png`)).digest("hex");
    assert.notEqual(hash("swing"), hash("heavy_slash"));
    assert.notEqual(hash("fire_gun"), hash("pistol_shot"));
    assert.notEqual(hash("reactive_armor"), hash("absolute_guard"));
});

test("catalogue cards keep text accessible and artwork decorative", () => {
    const source = readFileSync(CATALOGUE_PAGE_PATH, "utf8");
    assert.match(source, /className="ability-card-art"/);
    assert.match(source, /alt=""/);
    assert.match(source, /aria-hidden="true"/);
    assert.match(source, /aria-label=\{`View \$\{ability\.label\} stats`\}/);
    assert.match(source, /onError=\{\(event\) => \{/);
});

test("missing icon mappings fail soft without removing the ability name", () => {
    assert.equal(getAbilityCatalogueIcon("unknown_future_ability"), null);
});
