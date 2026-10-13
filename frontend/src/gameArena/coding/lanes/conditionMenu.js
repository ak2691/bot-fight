// The condition menu's groups and items for one card (or switch). Pure: each item carries `build()`, which returns the
// normalized condition the menu adds. Groups come in the menu's order: Me, Enemy, the card's ability (named after it),
// Other abilities, Objects, Match, Variables. Search and highlighting are menuModel.js.
import { SELECTABLE_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { buildCatalogCondition, buildVariableCondition, CONDITION_CATALOG, CONDITION_GROUPS, catalogEntry } from "./conditionCatalog.js";

/** The ability readings each other ability of the loadout offers ("Fireball: Ready"). */
export const OTHER_ABILITY_KEYS = Object.freeze(["ability.ready", "ability.preparing", "ability.sinceHit"]);

/**
 * The groups for the condition menu. `abilityId` and `abilityName` are the card's ability (both null on a plain card,
 * whose ability group then reads "Ability"). `loadout` is the equipped ability ids; `customVariables` the brain's
 * variables, with `customVariableValues` (id -> current value) for the item descriptions.
 */
export function conditionMenuGroups({
    abilityId = null,
    abilityName = null,
    loadout = [],
    customVariables = [],
    customVariableValues = {},
    selectableTypes = SELECTABLE_TYPES,
} = {}) {
    const entriesOf = (group) => CONDITION_CATALOG.filter((entry) => entry.group === group);
    const itemFor = (entry, options) => ({
        id: entry.key,
        name: entry.name,
        description: entry.description,
        icon: entry.icon,
        keywords: [],
        build: () => buildCatalogCondition(entry.key, { ...options, selectableTypes }),
    });
    const ownOptions = { abilityId, loadout, selectableTypes };
    const others = [...new Set(loadout.filter((id) => id !== abilityId && id != null))];
    const otherItems = [
        ...entriesOf("otherAbilities").map((entry) => itemFor(entry, {})),
        ...others.flatMap((id) => OTHER_ABILITY_KEYS.map((key) => {
            const entry = catalogEntry(key);
            const label = abilityDefinition(id)?.label ?? `Ability ${id}`;
            return { ...itemFor(entry, { abilityId: id }), id: `${key}@${id}`, name: `${label}: ${entry.name}` };
        })),
    ];
    const variableItems = customVariables.map((variable) => {
        const boolean = variable.valueType === "boolean";
        const current = customVariableValues?.[variable.id] ?? variable.initialValue;
        const now = boolean ? (current ? "yes" : "no") : String(Number(current) || 0);
        return {
            id: `var:${variable.id}`,
            name: variable.name,
            description: `${boolean ? "yes or no" : "number"}, now ${now}`,
            icon: "braces",
            keywords: [boolean ? "yes no" : "number"],
            build: () => buildVariableCondition(variable, { customVariables, selectableTypes }),
        };
    });
    const group = (id, items, label = CONDITION_GROUPS[id].label) => ({ id, label, tone: CONDITION_GROUPS[id].tone, items });
    return [
        group("me", entriesOf("me").map((entry) => itemFor(entry, ownOptions))),
        group("enemy", entriesOf("enemy").map((entry) => itemFor(entry, ownOptions))),
        group("ability", entriesOf("ability").map((entry) => itemFor(entry, ownOptions)), abilityName ?? "Ability"),
        group("otherAbilities", otherItems),
        group("objects", entriesOf("objects").map((entry) => itemFor(entry, ownOptions))),
        group("match", entriesOf("match").map((entry) => itemFor(entry, ownOptions))),
        group("variables", variableItems),
    ];
}
