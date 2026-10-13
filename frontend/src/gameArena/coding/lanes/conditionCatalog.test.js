import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConditions } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { VISIBLE_STATE_VARIABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { ALL_ABILITY_DEFINITIONS } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { addCard } from "./laneEdits.js";
import { createLanesStarter, STARTER_MODE_ID } from "./laneStarter.js";
import {
    BASE_RANGE_VARIABLE,
    buildCatalogCondition,
    catalogEntry,
    catalogEntryFor,
    CONDITION_CATALOG,
    conditionTile,
    formatShown,
    readingOption,
    storedFromShown,
} from "./conditionCatalog.js";
import { validateAbilityStrategyConfiguration } from "../../botlogic/code/validateBrain.js";

const SLASH = 1;
const STUN = 6; // has range, preparation, status effect and duration tags

/** The ability ids that carry a tag (the definitions' own tags), so a tagged reading can be built for real. */
const abilityWithTag = (tag) => ALL_ABILITY_DEFINITIONS.find((ability) => ability.tags.includes(tag))?.id ?? null;

test("every visible state variable is read by at least one catalog entry", () => {
    const covered = new Set(CONDITION_CATALOG.map((entry) => entry.variable));
    const missing = VISIBLE_STATE_VARIABLES.map((variable) => variable.id).filter((id) => !covered.has(id));
    assert.deepEqual(missing, []);
});

test("catalog keys are unique and every entry names a group, an icon and a kind", () => {
    const keys = CONDITION_CATALOG.map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const entry of CONDITION_CATALOG) {
        assert.ok(entry.group && entry.icon && entry.name, entry.key);
        assert.equal(typeof entry.matches, "function", entry.key);
        assert.equal(typeof entry.build, "function", entry.key);
        assert.ok(["number", "boolean"].includes(entry.kind), entry.key);
        if (entry.kind === "boolean") assert.ok(entry.labels?.on && entry.labels?.off, `${entry.key} needs on and off labels`);
    }
});

test("every catalog entry builds a condition that the engine's normalizer leaves unchanged", (t) => {
    for (const entry of CONDITION_CATALOG) {
        const abilityId = entry.requiredTag ? abilityWithTag(entry.requiredTag) : SLASH;
        if (entry.requiredTag && abilityId == null) {
            t.diagnostic(`no shipped ability has the ${entry.requiredTag} tag yet; ${entry.key} is checked once one does`);
            continue;
        }
        const built = buildCatalogCondition(entry.key, { abilityId: abilityId ?? STUN });
        const [normalized] = normalizeConditions([built], [], undefined);
        assert.deepEqual(normalized, built, entry.key);
    }
});

test("a built condition is read back by its own entry", () => {
    for (const entry of CONDITION_CATALOG) {
        const abilityId = entry.requiredTag ? abilityWithTag(entry.requiredTag) : SLASH;
        if (entry.requiredTag && abilityId == null) continue;
        const built = buildCatalogCondition(entry.key, { abilityId: abilityId ?? STUN });
        assert.equal(catalogEntryFor(built)?.key, entry.key, entry.key);
    }
});

test("a built card passes the brain validator", () => {
    const starter = createLanesStarter([SLASH, 3]);
    const { configuration } = addCard(starter, STARTER_MODE_ID, 4, [], [buildCatalogCondition("me.hp", { abilityId: SLASH })]);
    assert.deepEqual(validateAbilityStrategyConfiguration(configuration).errors, []);
});

test("a condition no entry describes reads as no entry", () => {
    const condition = {
        type: "expression",
        left: "selectable.damageTakenLastTick",
        leftSelectable: "my_bot",
        comparator: "lt",
        right: { type: "number", value: 5 },
    };
    assert.equal(catalogEntryFor(condition), null);
    assert.deepEqual(conditionTile(condition, { fallback: "Damage Taken < 5" }), { entry: null, icon: null, name: "Damage Taken < 5", value: null });
});

test("a number tile shows the comparator and the value in yellow, and a reading names its ability", () => {
    const distance = buildCatalogCondition("enemy.distance", { abilityId: SLASH });
    const plain = { ...distance, comparator: "gte", right: { type: "number", value: 120 } };
    assert.deepEqual(
        { name: conditionTile(plain).name, value: conditionTile(plain).value },
        { name: "Distance", value: "≥ 120" },
    );
    const reading = { ...distance, comparator: "lte", right: { type: "variable", value: BASE_RANGE_VARIABLE } };
    assert.equal(conditionTile(reading, { abilityName: "Slash" }).value, "≤ Slash range");
    assert.equal(conditionTile(reading).value, "≤ base range");
});

test("a yes-or-no tile names its state, and reads the off label when it is false", () => {
    const ready = buildCatalogCondition("ability.ready", { abilityId: SLASH });
    assert.equal(conditionTile(ready).name, "Ready");
    assert.equal(conditionTile({ ...ready, right: { type: "boolean", value: false } }).name, "Not ready");
    assert.equal(conditionTile(ready).value, null);
});

test("time in mode is shown and typed in seconds, stored in milliseconds", () => {
    const entry = catalogEntry("me.timeInMode");
    assert.equal(formatShown(5000, entry), "5");
    assert.equal(formatShown(2500, entry), "2.5");
    assert.equal(storedFromShown("2.5", entry), 2500);
    assert.equal(conditionTile({ ...buildCatalogCondition("me.timeInMode"), comparator: "gte", right: { type: "number", value: 5000 } }).value, "≥ 5 s");
    assert.equal(storedFromShown("", entry), null);
    assert.equal(storedFromShown("abc", entry), null);
});

test("the range reading is offered only to a distance entry on an ability card", () => {
    const distance = catalogEntry("enemy.distance");
    assert.equal(readingOption(distance, SLASH, "Slash")?.label, "Slash range");
    assert.equal(readingOption(distance, null, null), null);
    assert.equal(readingOption(catalogEntry("enemy.hp"), SLASH, "Slash"), null);
});
