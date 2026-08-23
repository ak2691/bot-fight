import test from "node:test";
import assert from "node:assert/strict";
import { abilityStatsForDisplay } from "./abilityStatsPresentation.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";

test("ability stats expose only the player-facing vocabulary", () => {
    const rows = abilityStatsForDisplay({ effects: [{ type: "spawn_entity" }], stats: { cooldownMs: 12000, maxDamage: 50, minDamage: 25, damageFalloffStart: 0, damageFalloffEnd: 50, range: 70, speedPerTick: 32, fuseMs: 1000 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Cooldown", "Min damage", "Max damage", "Falloff ends", "Range", "Duration"]);
    assert.deepEqual(rows.slice(1, 5), [
        { label: "Min damage", value: "25", section: "Damage profile" },
        { label: "Max damage", value: "50", section: "Damage profile" },
        { label: "Falloff ends", value: "50 units", section: "Damage profile" },
        { label: "Range", value: "70 units" },
    ]);
});

test("charges and coverage share the Charges and Arc labels", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { maxCharges: 10, arcDegrees: 180 } }), [{ label: "Arc", value: "180°" }, { label: "Charges", value: "10" }]);
});

test("status effects avoid per-tick wording", () => {
    const rows = abilityStatsForDisplay({ effects: [{ type: "debuff", debuff: "burn", durationMs: 5000 }], stats: { damage: 15, burnDamage: 2, burnTickMs: 1000, burnDurationMs: 5000 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Damage", "Status effect", "Status duration", "Status interval", "Status damage"]);
});

test("Dash time is Active rather than Duration", () => {
    const rows = abilityStatsForDisplay({ effects: [], stats: { cooldownMs: 1500, activeMs: 200, distance: 150 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Cooldown", "Active", "Range"]);
});

test("Static Snare exposes its trigger radius", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { triggerRadius: 75 } }), [
        { label: "Radius", value: "75 units" },
    ]);
});

test("Snare Bomb exposes only its meaningful destruction phase attributes", () => {
    const ability = ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 29);
    assert.equal(ability.label, "Snare Bomb");
    assert.deepEqual(
        abilityStatsForDisplay(ability).filter(({ section }) => section === "On destruction"),
        [
            { label: "Radius", value: "120 units", section: "On destruction" },
            { label: "Damage", value: "20", section: "On destruction" },
            { label: "Status effect", value: "Slow", section: "On destruction" },
            { label: "Status duration", value: "3 sec", section: "On destruction" },
        ],
    );
    assert.equal(
        abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 14))
            .some(({ section }) => ["Travel phase", "Fuse phase", "Active phase"].includes(section)),
        false,
    );
});

test("grenade and proximity mine expose their throw ranges", () => {
    for (const abilityId of [4, 11]) {
        const rows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityId));
        assert.ok(rows.some(({ label, value }) => label === "Throw range" && value === `${abilityId === 4 ? 336 : 176} units`));
    }
});

test("pull effects expose their per-tick strength", () => {
    for (const [abilityId, strength] of [[14, 6], [27, 10], [28, 100]]) {
        const ability = ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityId);
        assert.deepEqual(
            abilityStatsForDisplay(ability).filter(({ label }) => label === "Pull strength"),
            [{ label: "Pull strength", value: `${strength} units per tick` }],
        );
    }
});

test("Null Zone separates its short active phase from its zone duration", () => {
    const ability = ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 24);
    assert.deepEqual(
        abilityStatsForDisplay(ability).filter(({ label }) => label === "Active" || label === "Duration"),
        [
            { label: "Active", value: "0.3 sec" },
            { label: "Duration", value: "5 sec" },
        ],
    );
});

test("lifesteal abilities describe damage-based healing", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [{ type: "healing", mirrorsDamage: true }], stats: {} }), [
        { label: "Effect", value: "Restore damage dealt as HP" },
    ]);
});

test("positive-effect percentages are included in player-facing stats", () => {
    const rows = abilityStatsForDisplay({
        effects: [],
        buffDetails: [
            { label: "Damage reduction", value: "50%" },
            { label: "Damage reflection", value: "50%" },
        ],
        stats: {},
    });
    assert.deepEqual(rows, [
        { label: "Damage reduction", value: "50%" },
        { label: "Damage reflection", value: "50%" },
    ]);
});

test("every catalog ability has displayable stats", () => {
    for (const ability of ALL_ABILITY_DEFINITIONS) assert.doesNotThrow(() => abilityStatsForDisplay(ability), ability.id);
});
