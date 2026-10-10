import { GAMEPLAY_DATA } from "./gameplayData.js";

/** Canonical ability map. Keys are permanent IDs, never array positions. Read from shared/gameplay/abilities.json. */
export const ABILITIES = Object.freeze(Object.fromEntries(GAMEPLAY_DATA.abilities.abilities.map(
    ({ id, name, label, type }) => [id, Object.freeze({ id, name, label, type })],
)));

const ABILITY_ID_BY_NAME = new Map(Object.values(ABILITIES).map(({ id, name }) => [name, id]));

/**
 * Accepts only a canonical runtime ID. Ability IDs are permanent and must never
 * be recycled, even when an ability is retired.
 */
export function abilityId(value) {
    return Number.isSafeInteger(value) && value > 0 && ABILITIES[value] ? value : null;
}

/** The ID of an ability's canonical `name` (e.g. "slash"), or null. */
export function abilityIdFromName(name) {
    return typeof name === "string" ? ABILITY_ID_BY_NAME.get(name) ?? null : null;
}

export function abilityIdentity(value) {
    const id = abilityId(value);
    return id == null ? null : ABILITIES[id];
}

export function abilityName(value) {
    return abilityIdentity(value)?.name ?? null;
}
