import test from "node:test";
import assert from "node:assert/strict";
import { abilityHighlights,
    abilityStatsForDisplay,
} from "./abilityStatsPresentation.js";
import { ALL_ABILITY_DEFINITIONS } from "../../../../shared/engine/loadout/BotLoadout.js";

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

test("ability preparation uses the same player-facing term as bot variables", () => {
    const rows = abilityStatsForDisplay({ effects: [], stats: { windupMs: 300 } });
    assert.deepEqual(rows, [{ label: "Preparation time", value: "0.3 sec" }]);
});

test("charges and coverage share the Charges and Arc labels", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { maxCharges: 10, arc: 180 } }), [{ label: "Arc", value: "180°" }, { label: "Charges", value: "10" }]);
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

test("Snare Bomb exposes its trigger radius", () => {
    assert.deepEqual(abilityStatsForDisplay({ effects: [], stats: { radius: 75 } }), [
        { label: "Radius", value: "75 units" },
    ]);
});

test("Snare Bomb lists each phase from its entity data", () => {
    const ability = ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 29);
    assert.equal(ability.label, "Snare Bomb");
    assert.deepEqual(
        abilityStatsForDisplay(ability).filter(({ section }) => section === "Destroyed phase"),
        [
            { label: "Radius", value: "120 units", section: "Destroyed phase" },
            { label: "Speed", value: "0 units per tick", section: "Destroyed phase" },
            { label: "Damage", value: "40", section: "Destroyed phase" },
        ],
    );
    assert.equal(
        abilityStatsForDisplay(ALL_ABILITY_DEFINITIONS.find(({ id }) => id === 4))
            .some(({ section }) => ["Travel phase", "Armed phase", "Active phase"].includes(section)),
        true,
    );
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
    assert.ok(fireballRows.some(({ label, value }) => label === "Hitbox width" && value === "64 units"));
    assert.ok(fireballRows.some(({ label, value }) => label === "Hitbox length" && value === "64 units"));
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

const abilityById = (id) => ALL_ABILITY_DEFINITIONS.find((ability) => ability.id === id);

test("highlights lead with damage, show falloff as min-max and never exceed four tiles", () => {
    const grenade = abilityHighlights(abilityById(4));
    assert.equal(grenade[0].value, "18\u201330");
    assert.equal(grenade[0].label, "Damage \u00b7 edge to centre");
    assert.equal(grenade[0].tone, "damage");
    assert.deepEqual(grenade.slice(1).map((tile) => tile.label), ["Blast radius", "Cooldown", "Throw speed"]);
    for (const ability of ALL_ABILITY_DEFINITIONS) {
        const tiles = abilityHighlights(ability);
        assert.ok(tiles.length <= 4, ability.label);
        const dealsDamage = Number(ability.stats.damage) > 0 || ability.stats.falloff;
        if (dealsDamage) assert.equal(tiles[0].tone, "damage", ability.label);
    }
});

test("Sniper and Fireball show flat damage and no ammunition", () => {
    const sniper = abilityHighlights(abilityById(3));
    assert.equal(sniper[0].value, "35");
    assert.equal(sniper[0].label, "Damage");
    assert.ok(sniper.every((tile) => tile.unit !== "charges"));
    const fireball = abilityHighlights(abilityById(5));
    assert.equal(fireball[0].value, "20");
    assert.ok(fireball.every((tile) => tile.unit !== "charges"));
    assert.equal(abilityById(3).label, "Sniper");
});

test("damage-over-time-only abilities lead with the status damage per second", () => {
    const tiles = abilityHighlights({
        phaseTag: "zone",
        effects: [{ type: "status", subtype: "burn", amount: 4, intervalMs: 500, durationMs: 3000 }],
        stats: { cooldownMs: 8000, statuses: { burn: { amount: 4, intervalMs: 500, durationMs: 3000 } } },
    });
    assert.deepEqual(tiles[0], { value: "8", unit: "/s", label: "Burn damage", tone: "damage" });
});

test("every ability has a plain-language description", () => {
    for (const ability of ALL_ABILITY_DEFINITIONS) {
        assert.ok(typeof ability.description === "string" && ability.description.length > 10, ability.label);
        assert.doesNotMatch(ability.description, /\d/, `${ability.label} should not restate stats`);
    }
});

