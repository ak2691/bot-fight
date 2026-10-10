import { STANDARD_ABILITY_IDS } from "../../../../shared/engine/loadout/BotLoadout.js";

export const WEAPONS_SECTION = "weapons";
export const MOVEMENT_SECTION = "movement";
/** Weapons first, then movement, then the draft tiers (catalogue `round` 1-3). */
export const SECTION_KEYS = Object.freeze([WEAPONS_SECTION, MOVEMENT_SECTION, 1, 2, 3]);

const MOVEMENT_ABILITY_IDS = new Set(STANDARD_ABILITY_IDS);

export function sectionOf(ability) {
    if (ability.category === "weapon") return WEAPONS_SECTION;
    if (MOVEMENT_ABILITY_IDS.has(ability.id)) return MOVEMENT_SECTION;
    return ability.round;
}

export const SECTION_TITLES = Object.freeze({
    [WEAPONS_SECTION]: "Weapons",
    [MOVEMENT_SECTION]: "Movement",
    1: "Rounds 1-2",
    2: "Rounds 3-4",
    3: "Rounds 5-6",
});

export const SECTION_SUBTITLES = Object.freeze({
    [WEAPONS_SECTION]: "pick one in round 1",
    [MOVEMENT_SECTION]: "on every bot, paid for with stamina",
    1: "offered in rounds 1 and 2",
    2: "offered in rounds 3 and 4",
    3: "offered in rounds 5 and 6",
});

export const sectionAnchor = (key) => `round-${key}-abilities`;

export const CATALOGUE_CHIPS = Object.freeze([
    ...SECTION_KEYS.map((key) => Object.freeze({ id: sectionAnchor(key), label: SECTION_TITLES[key] })),
    Object.freeze({ id: "combat-effects", label: "Effects" }),
]);

/** Sprint and Fast turn are settings on Walk and Rotate, not abilities, so they have no card or stats page. */
export const MOVEMENT_SETTINGS = Object.freeze([
    Object.freeze({
        id: "sprint",
        label: "Sprint",
        kind: "Walk setting",
        description: "+50% speed in any direction. Drains 30 stamina per second. Stops at 0 stamina.",
    }),
    Object.freeze({
        id: "fast-turn",
        label: "Fast turn",
        kind: "Rotate setting",
        description: "Turns twice as fast (24° per tick). Drains 20 stamina per second, only while the bot is actually turning. Below 2 stamina it turns at the normal speed.",
    }),
]);

export const STAMINA_NOTE = "Stamina is one pool of 100 shared by Dash, Sprint, Fast turn and cancelling a wind-up. It refills at 20 per second, starting 0.5 seconds after the last time you spend it. There is no exhaustion: at 0 stamina you just can't dash, sprint or fast turn until it refills. Every landed hit gives back 10 stamina (once per activation), so accurate aggression keeps you moving.";

export function movementSettingsMatching(normalizedSearch) {
    if (!normalizedSearch) return MOVEMENT_SETTINGS;
    return MOVEMENT_SETTINGS.filter((setting) => (
        `${setting.label} ${setting.kind} ${setting.description}`.toLowerCase().includes(normalizedSearch)
    ));
}
