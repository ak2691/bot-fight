import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConditions } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { SELECTABLE_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { buildVariableCondition, conditionTile, customEntryFor, customVariableEntry } from "./conditionCatalog.js";
import { conditionMenuGroups } from "./conditionMenu.js";
import { filterItems } from "./menuModel.js";

const RAGE = { id: "custom.rage", name: "Rage", valueType: "boolean", initialValue: false };
const COUNT = { id: "custom.count", name: "Count", valueType: "number", initialValue: 4 };

const groupsFor = (options = {}) => conditionMenuGroups({ abilityId: 1, abilityName: "Slash", loadout: [1, 3], customVariables: [], ...options });

test("the menu lists the groups in order, with the card's ability named after it and the rest of the loadout under Other abilities", () => {
    const groups = groupsFor();
    assert.deepEqual(groups.map((group) => group.id), ["me", "enemy", "ability", "otherAbilities", "objects", "match", "variables"]);
    assert.equal(groups.find((group) => group.id === "ability").label, "Slash");
    const others = groups.find((group) => group.id === "otherAbilities").items.map((entry) => entry.name);
    assert.ok(others.includes("Has status"));
    assert.ok(others.some((name) => name.endsWith(": Ready")), "each other loadout ability lists its readings");
    assert.ok(!others.some((name) => name.startsWith("Slash:")), "the card's own ability is not listed under Other abilities");
});

test("a plain card's ability group reads Ability when it names no ability", () => {
    assert.equal(groupsFor({ abilityId: null, abilityName: null }).find((group) => group.id === "ability").label, "Ability");
});

test("typing filters the groups' items live, and a group with no match is empty", () => {
    const groups = groupsFor();
    const enemy = groups.find((group) => group.id === "enemy");
    assert.deepEqual(filterItems(enemy.items, "distance").map((entry) => entry.name), ["Distance"]);
    assert.equal(filterItems(groups.find((group) => group.id === "objects").items, "zzz").length, 0);
});

test("the Variables group lists the brain's custom variables with their type and current value, and is empty without any", () => {
    assert.equal(groupsFor().find((group) => group.id === "variables").items.length, 0);
    const items = groupsFor({ customVariables: [RAGE, COUNT], customVariableValues: { "custom.count": 9 } })
        .find((group) => group.id === "variables").items;
    assert.deepEqual(items.map((item) => [item.name, item.description]), [
        ["Rage", "yes or no, now no"],
        ["Count", "number, now 9"],
    ]);
});

test("every item builds a normalized condition, so picking it adds what a saved brain would hold", () => {
    const groups = groupsFor({ customVariables: [RAGE, COUNT] });
    for (const group of groups) {
        for (const item of group.items) {
            const condition = item.build();
            const normalized = normalizeConditions([condition], [RAGE, COUNT], SELECTABLE_TYPES)[0];
            assert.deepEqual(condition, normalized, `${item.name} is already normalized`);
        }
    }
});

test("a variable condition reads its variable's name and value in its tile", () => {
    const condition = buildVariableCondition(COUNT, { customVariables: [COUNT] });
    assert.equal(condition.comparator, "lte");
    assert.deepEqual(condition.right, { type: "number", value: 4 });
    assert.deepEqual(customEntryFor(condition, [COUNT]), customVariableEntry(COUNT));
    assert.deepEqual(conditionTile(condition, { customVariables: [COUNT] }), {
        entry: customVariableEntry(COUNT),
        icon: "braces",
        name: "Count",
        value: "≤ 4",
    });
    const flag = buildVariableCondition(RAGE, { customVariables: [RAGE] });
    assert.equal(conditionTile(flag, { customVariables: [RAGE] }).name, "Rage");
});

test("an ability reading for another loadout ability is named after that ability in its tile", () => {
    const groups = groupsFor();
    const other = groups.find((group) => group.id === "otherAbilities").items.find((entry) => entry.name.endsWith(": Ready"));
    const tile = conditionTile(other.build(), { cardAbilityId: 1, abilityLabelOf: (id) => `Ability ${id}`, abilityName: "Slash" });
    assert.match(tile.name, /^Ability \d+: Ready$/);
    const own = conditionTile(groups.find((group) => group.id === "ability").items[0].build(), { cardAbilityId: 1, abilityName: "Slash" });
    assert.equal(own.name, "Ready", "the card's own reading keeps its short name");
});
