const row = (label, value) => Object.freeze({ label, value });
const section = (name, ...rows) => Object.freeze({
    section: name,
    rows: Object.freeze(rows.map(([label, value]) => row(label, value))),
});

/**
 * Player-facing descriptions are deliberately authored here instead of being
 * inferred from the compatibility stat catalog. A value that changes by phase
 * must be described beside the phase that owns it.
 */
export const ABILITY_CATALOGUE_PHASES = Object.freeze({
    1: Object.freeze([section("Active phase",
        ["Damage", "20"], ["Range", "92 units"], ["Arc", "120°"])]),
    3: Object.freeze([section("Active phase",
        ["Min damage", "5"], ["Max damage", "15"], ["Falloff starts", "100 units"],
        ["Falloff ends", "700 units"], ["Range", "700 units"], ["Hitbox width", "5 units"])]),
    4: Object.freeze([
        section("Travel phase", ["Hitbox width", "12 units"], ["Hitbox length", "12 units"], ["Speed", "32 units per tick"]),
        section("Armed phase", ["Hitbox width", "12 units"], ["Hitbox length", "12 units"], ["Speed", "0 units per tick"]),
        section("Impact phase", ["Radius", "70 units"], ["Min damage", "25"], ["Max damage", "40"], ["Falloff ends", "64 units"]),
    ]),
    5: Object.freeze([section("Active phase",
        ["Damage", "15"], ["Hitbox width", "30 units"], ["Hitbox length", "30 units"], ["Speed", "36 units per tick"],
        ["Status effect", "Burn (5 sec)"], ["Status damage", "2"])]),
    6: Object.freeze([section("Active phase",
        ["Damage", "10"], ["Hitbox width", "80 units"], ["Hitbox length", "184 units"], ["Status effect", "Stun (1.2 sec)"])]),
    7: Object.freeze([section("Active phase",
        ["Damage", "30"], ["Range", "115 units"], ["Arc", "150°"], ["Status effect", "Bleed (5 sec)"])]),
    8: Object.freeze([section("Active phase",
        ["Damage", "20"], ["Radius", "110 units"], ["Knockback", "250 units"])]),
    9: Object.freeze([section("Active phase",
        ["Damage", "20"], ["Range", "500 units"], ["Hitbox width", "5 units"], ["Status effect", "Slow (1 sec)"])]),
    10: Object.freeze([section("Active phase", ["Effect", "Restore 25 HP"])]),
    11: Object.freeze([
        section("Travel phase", ["Radius", "12 units"], ["Speed", "22 units per tick"]),
        section("Armed phase", ["Radius", "87.5 units"], ["Speed", "0 units per tick"]),
        section("Impact phase", ["Radius", "87.5 units"], ["Damage", "25"]),
    ]),
    12: Object.freeze([section("Active phase",
        ["Min damage", "4"], ["Max damage", "8"], ["Falloff ends", "333.3 units"], ["Range", "500 units"], ["Hitbox width", "5 units"])]),
    13: Object.freeze([section("Active phase",
        ["Damage", "40"], ["Range", "900 units"], ["Hitbox width", "5 units"], ["Status effect", "Shock (3 sec)"])]),
    14: Object.freeze([
        section("Travel phase", ["Radius", "120 units"], ["Speed", "22 units per tick"], ["Pull strength", "6 units per tick"]),
        section("Fuse phase", ["Radius", "120 units"], ["Speed", "0 units per tick"], ["Pull strength", "6 units per tick"]),
        section("Impact phase", ["Radius", "120 units"], ["Min damage", "20"], ["Max damage", "35"], ["Falloff ends", "90 units"]),
    ]),
    15: Object.freeze([section("Active phase",
        ["Hitbox width", "150 units"], ["Hitbox length", "190 units"], ["Speed", "150 units per tick"], ["Status effect", "Silence (2 sec)"], ["Interrupt", "100 ms"])]),
    16: Object.freeze([section("Active phase",
        ["Damage reduction", "50%"], ["Damage reflection", "50%"])]),
    17: Object.freeze([section("Active phase",
        ["Movement speed", "4.5 units per tick"], ["Turn speed", "8° per tick"], ["Shot range", "200 units"], ["Shot cadence", "1 sec"], ["Shot damage", "5"])]),
    18: Object.freeze([section("Active phase",
        ["Damage", "20"], ["Hitbox width", "80 units"], ["Hitbox length", "115 units"], ["Speed", "44 units per tick"], ["Knockback", "200 units"])]),
    19: Object.freeze([section("Active phase", ["Distance", "150 units"], ["Speed", "75 units per tick"])]),
    20: Object.freeze([section("Activation", ["Effect", "Rotate toward the selected target"])]),
    21: Object.freeze([section("Active phase", ["Zone radius", "45 units"], ["Restore snapshot after", "3 sec"])]),
    22: Object.freeze([section("Active phase",
        ["Radius", "130 units"], ["Damage per explosion", "15"], ["Explosion interval", "0.5 sec"])]),
    23: Object.freeze([section("Active phase", ["Damage immunity", "100%"])]),
    24: Object.freeze([section("Active phase", ["Radius", "150 units"], ["Effect", "Silence while inside"])]),
    25: Object.freeze([section("Active phase",
        ["Hitbox width", "60 units"], ["Hitbox length", "100 units"], ["Damage", "15"], ["Effect", "Teleport behind the nearest hit"])]),
    26: Object.freeze([section("Active phase",
        ["Radius", "120 units"], ["Damage", "15"], ["Knockback", "60 units"], ["Status effect", "Slow (1.5 sec)"])]),
    27: Object.freeze([
        section("Fuse phase", ["Radius", "140 units"], ["Pull strength", "10 units per tick"]),
        section("Impact phase", ["Radius", "140 units"], ["Min damage", "15"], ["Max damage", "35"], ["Falloff ends", "140 units"]),
    ]),
    28: Object.freeze([section("Active phase",
        ["Hitbox width", "18 units"], ["Hitbox length", "18 units"], ["Speed", "42 units per tick"], ["Damage", "10"], ["Pull strength", "100 units per tick"], ["Status effect", "Slow (1.2 sec)"])]),
    29: Object.freeze([
        section("Armed phase", ["Radius", "75 units"], ["Damage", "15"], ["Status effect", "Slow (2.2 sec)"]),
        section("On destruction", ["Radius", "120 units"], ["Damage", "20"], ["Status effect", "Slow (3 sec)"]),
    ]),
    30: Object.freeze([section("Active phase",
        ["Damage", "15"], ["Range", "600 units"], ["Hitbox width", "8 units"], ["Interrupt", "250 ms"], ["Status effect", "Slow (2 sec)"])]),
    31: Object.freeze([section("Active phase",
        ["Movement speed", "4.5 units per tick"], ["Shot range", "200 units"], ["Shot cadence", "1 sec"], ["Shot damage", "3"], ["Knockback", "40 units"])]),
    32: Object.freeze([section("Active phase",
        ["Min damage", "15"], ["Max damage", "25"], ["Falloff ends", "500 units"], ["Range", "500 units"], ["Hitbox width", "10 units"], ["Effect", "Restore damage dealt as HP"])]),
    33: Object.freeze([section("Active phase", ["Cooldown recovery", "50%"])]),
    34: Object.freeze([section("Active phase", ["Damage", "8"], ["Range", "80 units"], ["Arc", "30°"])]),
});

export function phaseDisplayRows(abilityId) {
    return (ABILITY_CATALOGUE_PHASES[abilityId] ?? []).flatMap(({ section: sectionName, rows }) =>
        rows.map((entry) => ({ ...entry, section: sectionName })));
}
