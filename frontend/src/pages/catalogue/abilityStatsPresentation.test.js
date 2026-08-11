import test from "node:test";
import assert from "node:assert/strict";
import { abilityStatsForDisplay } from "./abilityStatsPresentation.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";

test("ability stats expose only the player-facing vocabulary", () => {
    const rows = abilityStatsForDisplay({ effects: [{ type: "spawn_entity" }], stats: { cooldownMs: 12000, damageByRange: [50, 25], damageRanges: [0, 50], damageRangeMode: "stepped", damageMinRadius: 0, damageMaxRadius: 70, speedPerTick: 32, fuseMs: 1000, falloffDamage: [50, 25] } });
    assert.deepEqual(rows.map(({ label }) => label), ["Cooldown", "Min damage", "Max damage", "Min range", "Max range", "Range intervals", "Duration"]);
    assert.deepEqual(rows.slice(1, 6), [
        { label: "Min damage", value: "25", section: "Damage at each range" },
        { label: "Max damage", value: "50", section: "Damage at each range" },
        { label: "Min range", value: "0 units", section: "Damage at each range" },
        { label: "Max range", value: "70 units", section: "Damage at each range" },
        { label: "Range intervals", value: "50, 20 units", section: "Damage at each range" },
    ]);
});

test("ammo and coverage share the Charges and Arc labels", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { ammoMax: 10, arcDegrees: 180 } }), [{ label: "Arc", value: "180°" }, { label: "Charges", value: "10" }]);
});

test("status effects avoid per-tick wording", () => {
    const rows = abilityStatsForDisplay({ effects: [{ type: "debuff", debuff: "burn", durationMs: 5000 }], stats: { damage: 15, burnDamage: 2, burnTickMs: 1000, burnDurationMs: 5000 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Damage", "Status effect", "Status duration", "Status interval", "Status damage"]);
});

test("micro dash time is Active rather than Duration", () => {
    const rows = abilityStatsForDisplay({ effects: [], stats: { cooldownMs: 1500, activeMs: 200, distance: 150 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Cooldown", "Active", "Range"]);
});

test("every catalog ability has displayable stats", () => {
    for (const ability of ALL_ABILITY_DEFINITIONS) assert.doesNotThrow(() => abilityStatsForDisplay(ability), ability.id);
});
