import test from "node:test";
import assert from "node:assert/strict";
import { abilityStatsForDisplay } from "./abilityStatsPresentation.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";

test("ability stats expose only the player-facing vocabulary", () => {
    const rows = abilityStatsForDisplay({ effects: [{ type: "spawn_entity" }], stats: { cooldownMs: 12000, falloff: { maxAmount: 50, minAmount: 25, falloffStart: 0, falloffEnd: 50 }, range: 70, speed: 32, fuseMs: 1000, visualSize: 140 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Cooldown", "Min damage", "Max damage", "Falloff ends", "Range", "Duration"]);
    assert.deepEqual(rows.slice(1, 5), [
        { label: "Min damage", value: "25", section: "Damage profile" },
        { label: "Max damage", value: "50", section: "Damage profile" },
        { label: "Falloff ends", value: "50 units", section: "Damage profile" },
        { label: "Range", value: "70 units" },
    ]);
});

test("charges and coverage share the Charges and Arc labels", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { maxCharges: 10, arc: 180 } }), [{ label: "Arc", value: "180°" }, { label: "Charges", value: "10" }]);
});

test("charged abilities expose their reload time", () => {
    for (const [abilityId, expectedCharges, expectedReload] of [[3, "6", "5 sec"], [5, "4", "5 sec"], [12, "10", "3 sec"]]) {
        const rows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityId));
        assert.ok(rows.some(({ label, value }) => label === "Charges" && value === expectedCharges), abilityId);
        assert.ok(rows.some(({ label, value }) => label === "Reload" && value === expectedReload), abilityId);
    }
});

test("generic recharge metadata uses the Recharge label", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { maxCharges: 3, rechargeMs: 2500 } }), [
        { label: "Charges", value: "3" },
        { label: "Recharge", value: "2.5 sec" },
    ]);
});

test("status effects avoid per-tick wording", () => {
    const rows = abilityStatsForDisplay({ effects: [{ type: "status", subtype: "burn", durationMs: 5000 }], stats: { damage: 15, burnDamage: 2, burnTickMs: 1000, burnDurationMs: 5000 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Damage", "Status effect", "Status duration", "Status interval", "Status damage"]);
});

test("Dash time is Active rather than Duration", () => {
    const rows = abilityStatsForDisplay({ effects: [], stats: { cooldownMs: 1500, activeMs: 200, distance: 150 } });
    assert.deepEqual(rows.map(({ label }) => label), ["Cooldown", "Active", "Range"]);
});

test("Static Snare exposes its trigger radius", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { radius: 75 } }), [
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
        true,
    );
});

test("grenade and proximity mine expose their impact radii", () => {
    assert.ok(abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 4))
        .some(({ label, value }) => label === "Radius" && value === "70 units"));
    assert.ok(abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 11))
        .some(({ label, value }) => label === "Radius" && value === "87.5 units"));
});

test("rectangular projectiles expose independent hitbox dimensions", () => {
    const silenceRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 15));
    const windBurstRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 18));
    assert.ok(silenceRows.some(({ label, value }) => label === "Hitbox width" && value === "150 units"));
    assert.ok(silenceRows.some(({ label, value }) => label === "Hitbox length" && value === "190 units"));
    assert.ok(windBurstRows.some(({ label, value }) => label === "Hitbox width" && value === "80 units"));
    assert.ok(windBurstRows.some(({ label, value }) => label === "Hitbox length" && value === "115 units"));
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
