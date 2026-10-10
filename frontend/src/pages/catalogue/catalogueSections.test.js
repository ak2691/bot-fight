import assert from "node:assert/strict";
import test from "node:test";
import { ALL_ABILITY_DEFINITIONS } from "../../../../shared/engine/loadout/BotLoadout.js";
import {
    CATALOGUE_CHIPS,
    MOVEMENT_SECTION,
    MOVEMENT_SETTINGS,
    SECTION_KEYS,
    SECTION_TITLES,
    STAMINA_NOTE,
    WEAPONS_SECTION,
    movementSettingsMatching,
    sectionOf,
} from "./catalogueSections.js";

const listed = ALL_ABILITY_DEFINITIONS;

test("the catalogue lists weapons first, then movement, then the three draft tiers", () => {
    assert.deepEqual(SECTION_KEYS, [WEAPONS_SECTION, MOVEMENT_SECTION, 1, 2, 3]);
    assert.deepEqual(SECTION_KEYS.map((key) => SECTION_TITLES[key]), ["Weapons", "Movement", "Rounds 1-2", "Rounds 3-4", "Rounds 5-6"]);
    assert.deepEqual(CATALOGUE_CHIPS.map((chip) => chip.label), ["Weapons", "Movement", "Rounds 1-2", "Rounds 3-4", "Rounds 5-6", "Effects"]);
});

test("Dash sits under Movement beside Sprint and Fast turn", () => {
    assert.equal(sectionOf(listed.find((ability) => ability.id === 19)), MOVEMENT_SECTION);
    assert.deepEqual(MOVEMENT_SETTINGS.map((setting) => setting.label), ["Sprint", "Fast turn"]);
    for (const ability of listed) {
        assert.ok(SECTION_KEYS.includes(sectionOf(ability)), `${ability.label} has a section`);
    }
    assert.ok(listed.filter((ability) => sectionOf(ability) === WEAPONS_SECTION).length >= 4);
});

test("stamina copy has no exhaustion and says a hit gives back 10", () => {
    assert.doesNotMatch(STAMINA_NOTE, /exhausted\b(?!ion)/i);
    assert.match(STAMINA_NOTE, /There is no exhaustion/);
    assert.match(STAMINA_NOTE, /0\.5 seconds/);
    assert.match(STAMINA_NOTE, /10 stamina/);
    assert.deepEqual(movementSettingsMatching("sprint").map((setting) => setting.id), ["sprint"]);
    assert.equal(movementSettingsMatching("").length, 2);
});
