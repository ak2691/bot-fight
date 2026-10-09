import { GAMEPLAY_DATA } from "./gameplayData.js";

/** Canonical ability map. Keys are permanent IDs, never array positions. Read from shared/gameplay/abilities.json. */
export const ABILITIES = Object.freeze(Object.fromEntries(GAMEPLAY_DATA.abilities.abilities.map(
    ({ id, name, label, type }) => [id, Object.freeze({ id, name, label, type })],
)));

const LEGACY_ABILITY_NAME_ALIASES = GAMEPLAY_DATA.abilities.legacyNames;

const ABILITY_ID_BY_NAME = new Map([
    ...Object.values(ABILITIES).map(({ id, name }) => [name, id]),
    ...Object.entries(LEGACY_ABILITY_NAME_ALIASES),
]);

/**
 * Accepts only a canonical runtime ID. Ability IDs are permanent and must never
 * be recycled, even when an ability is retired.
 */
export function abilityId(value) {
    return Number.isSafeInteger(value) && value > 0 && ABILITIES[value] ? value : null;
}

/** Explicit compatibility boundary for persisted or protocol-era names. */
export function abilityIdFromLegacyName(name) {
    return typeof name === "string" ? ABILITY_ID_BY_NAME.get(name) ?? null : null;
}

/** Explicit compatibility boundary for formats that still require names. */
export function legacyAbilityNameFromId(value) {
    const id = abilityId(value);
    return id == null ? null : ABILITIES[id].name;
}

export function abilityIdentity(value) {
    const id = abilityId(value);
    return id == null ? null : ABILITIES[id];
}

export function abilityName(value) {
    return legacyAbilityNameFromId(value);
}
