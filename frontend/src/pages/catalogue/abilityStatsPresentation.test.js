import test from "node:test";
import assert from "node:assert/strict";
import { abilityStatsForDisplay } from "./abilityStatsPresentation.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";

test("ability stats expose only the player-facing vocabulary", () => {
    const rows = abilityStatsForDisplay({ effects: [], stats: { cooldownMs: 12000, durationMs: 1000, falloff: { maxAmount: 50, minAmount: 25, falloffStart: 0, falloffEnd: 50 }, range: 70, speed: 32, visualSize: 140 } });
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
    assert.deepEqual(rows.map(({ label }) => label), ["Damage", "Status effect", "Status interval", "Status damage"]);
    assert.equal(rows.find(({ label }) => label === "Status effect").value, "Burn (5 sec)");
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
            { label: "Status effect", value: "Slow (3 sec)", section: "On destruction" },
        ],
    );
    assert.equal(
        abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 14))
            .some(({ section }) => ["Travel phase", "Fuse phase", "Active phase"].includes(section)),
        true,
    );
});

test("authored status effects keep their duration in the effect value", () => {
    for (const abilityId of [5, 6, 7, 9, 13, 15, 26, 28, 29, 30]) {
        const rows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityId));
        assert.equal(rows.some(({ label }) => label === "Status duration"), false, abilityId);
        assert.ok(rows.filter(({ label }) => label === "Status effect").every(({ value }) => /\([^)]* sec\)$/.test(value)), abilityId);
    }
});

test("grenade and proximity mine expose their impact radii", () => {
    assert.ok(abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 4))
        .some(({ label, value }) => label === "Radius" && value === "70 units"));
    assert.ok(abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 11))
        .some(({ label, value }) => label === "Radius" && value === "87.5 units"));
});

test("rectangular projectiles expose independent hitbox dimensions", () => {
    const grenadeRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 4));
    const fireballRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 5));
    const silenceRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 15));
    const stunRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 6));
    const teleportRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 25));
    const tetherRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 28));
    for (const rows of [grenadeRows, fireballRows, silenceRows, stunRows, teleportRows, tetherRows]) {
        assert.equal(rows.some(({ label }) => label === "Hitbox"), false);
    }
    assert.ok(grenadeRows.some(({ label, value, section }) => label === "Hitbox width" && value === "12 units" && section === "Travel phase"));
    assert.ok(grenadeRows.some(({ label, value, section }) => label === "Hitbox length" && value === "12 units" && section === "Armed phase"));
    assert.ok(fireballRows.some(({ label, value }) => label === "Hitbox width" && value === "30 units"));
    assert.ok(fireballRows.some(({ label, value }) => label === "Hitbox length" && value === "30 units"));
    assert.ok(silenceRows.some(({ label, value }) => label === "Hitbox width" && value === "150 units"));
    assert.ok(silenceRows.some(({ label, value }) => label === "Hitbox length" && value === "190 units"));
    assert.ok(stunRows.some(({ label, value }) => label === "Hitbox width" && value === "80 units"));
    assert.ok(stunRows.some(({ label, value }) => label === "Hitbox length" && value === "184 units"));
    assert.ok(teleportRows.some(({ label, value }) => label === "Hitbox width" && value === "60 units"));
    assert.ok(teleportRows.some(({ label, value }) => label === "Hitbox length" && value === "100 units"));
    assert.ok(tetherRows.some(({ label, value }) => label === "Hitbox width" && value === "18 units"));
    assert.ok(tetherRows.some(({ label, value }) => label === "Hitbox length" && value === "18 units"));

    const windBurstRows = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 18));
    assert.ok(windBurstRows.some(({ label, value }) => label === "Hitbox width" && value === "80 units"));
    assert.ok(windBurstRows.some(({ label, value }) => label === "Hitbox length" && value === "115 units"));
});

test("pull effects expose their per-tick strength", () => {
    for (const [abilityId, strength] of [[14, 6], [27, 10], [28, 100]]) {
        const ability = ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityId);
        assert.deepEqual(
            abilityStatsForDisplay(ability)
                .filter(({ label }) => label === "Pull strength")
                .map(({ label, value, section }) => ({ label, value, section })),
            abilityId === 14
                ? [
                    { label: "Pull strength", value: `${strength} units per tick`, section: "Travel phase" },
                    { label: "Pull strength", value: `${strength} units per tick`, section: "Fuse phase" },
                ]
                : [{ label: "Pull strength", value: `${strength} units per tick`, section: abilityId === 27 ? "Fuse phase" : "Active phase" }],
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

test("authored positive-effect rows do not repeat generated effect metadata", () => {
    const reactiveArmor = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 16));
    assert.deepEqual(reactiveArmor.filter(({ label }) => label === "Damage reduction"), [{ label: "Damage reduction", value: "50%", section: "Active phase" }]);
    assert.deepEqual(reactiveArmor.filter(({ label }) => label === "Damage reflection"), [{ label: "Damage reflection", value: "50%", section: "Active phase" }]);

    const overclock = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 33));
    assert.deepEqual(overclock.filter(({ label }) => label === "Cooldown recovery"), [{ label: "Cooldown recovery", value: "50%", section: "Active phase" }]);

    const damageImmunity = abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 23));
    assert.deepEqual(damageImmunity.filter(({ label }) => label === "Damage immunity"), [{ label: "Damage immunity", value: "100%", section: "Active phase" }]);

    for (const [abilityId, duration] of [[16, "4 sec"], [23, "1.5 sec"], [33, "4 sec"]]) {
        assert.deepEqual(
            abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityId))
                .filter(({ label }) => label === "Duration"),
            [{ label: "Duration", value: duration }],
        );
    }
});

test("every catalog ability has displayable stats", () => {
    for (const ability of ALL_ABILITY_DEFINITIONS) assert.doesNotThrow(() => abilityStatsForDisplay(ability), ability.id);
});
