/** Canonical ability map. Keys are permanent IDs, never array positions. */
export const ABILITIES = Object.freeze({
    1: Object.freeze({ id: 1, name: "slash", label: "Slash", type: "ability" }),
    3: Object.freeze({ id: 3, name: "gun", label: "Gun", type: "ability" }),
    4: Object.freeze({ id: 4, name: "grenade", label: "Grenade", type: "ability" }),
    5: Object.freeze({ id: 5, name: "fireball", label: "Fireball", type: "ability" }),
    6: Object.freeze({ id: 6, name: "stun", label: "Stun", type: "ability" }),
    7: Object.freeze({ id: 7, name: "heavy_slash", label: "Heavy Slash", type: "ability" }),
    8: Object.freeze({ id: 8, name: "repulsor_burst", label: "Repulsor Burst", type: "ability" }),
    9: Object.freeze({ id: 9, name: "concussive_shot", label: "Concussive Shot", type: "ability" }),
    10: Object.freeze({ id: 10, name: "basic_heal", label: "Basic Heal", type: "ability" }),
    11: Object.freeze({ id: 11, name: "proximity_mine", label: "Proximity Mine", type: "ability" }),
    12: Object.freeze({ id: 12, name: "pistol", label: "Pistol", type: "ability" }),
    13: Object.freeze({ id: 13, name: "rail_shot", label: "Rail Shot", type: "ability" }),
    14: Object.freeze({ id: 14, name: "gravity_grenade", label: "Gravity Grenade", type: "ability" }),
    15: Object.freeze({ id: 15, name: "silence_pulse", label: "Silence Pulse", type: "ability" }),
    16: Object.freeze({ id: 16, name: "reactive_armor", label: "Reactive Armor", type: "ability" }),
    17: Object.freeze({ id: 17, name: "hunter_drone", label: "Hunter Drone", type: "ability" }),
    18: Object.freeze({ id: 18, name: "wind_burst", label: "Wind Burst", type: "ability" }),
    19: Object.freeze({ id: 19, name: "dash", label: "Dash", type: "ability" }),
    20: Object.freeze({ id: 20, name: "lock_on", label: "Lock On", type: "ability" }),
    21: Object.freeze({ id: 21, name: "temporal_rewind", label: "Temporal Rewind", type: "ability" }),
    22: Object.freeze({ id: 22, name: "orbital_strike", label: "Orbital Strike", type: "ability" }),
    23: Object.freeze({ id: 23, name: "absolute_guard", label: "Absolute Guard", type: "ability" }),
    24: Object.freeze({ id: 24, name: "null_zone", label: "Null Zone", type: "ability" }),
    25: Object.freeze({ id: 25, name: "phase_strike", label: "Phase Strike", type: "ability" }),
    26: Object.freeze({ id: 26, name: "frost_ring", label: "Frost Ring", type: "ability" }),
    27: Object.freeze({ id: 27, name: "singularity", label: "Singularity", type: "ability" }),
    28: Object.freeze({ id: 28, name: "tether_bolt", label: "Tether Bolt", type: "ability" }),
    29: Object.freeze({ id: 29, name: "static_snare", label: "Snare Bomb", type: "ability" }),
    30: Object.freeze({ id: 30, name: "disruptor_dart", label: "Disruptor Dart", type: "ability" }),
    31: Object.freeze({ id: 31, name: "repeller_drone", label: "Repeller Drone", type: "ability" }),
    32: Object.freeze({ id: 32, name: "vampiric_beam", label: "Vampiric Beam", type: "ability" }),
    33: Object.freeze({ id: 33, name: "overclock", label: "Overclock", type: "ability" }),
    34: Object.freeze({ id: 34, name: "basic_strike", label: "Basic Strike", type: "ability" }),
});

const LEGACY_ABILITY_NAME_ALIASES = Object.freeze({
    swing: 1,
    fire_gun: 3,
    throw_grenade: 4,
    shoot_fireball: 5,
    pistol_shot: 12,
});

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
