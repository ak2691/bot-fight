import assert from "node:assert/strict";
import test from "node:test";
import { ABILITY_TAGS, ALL_ABILITY_DEFINITIONS, BASE_BOT_STATS, STANDARD_ABILITY_IDS, abilityDefinition, actionIdsForLoadout, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout, statusEffectDefinitionsForAbilities } from "./BotLoadout.js";

test("Basic Strike is standard equipment with its direct melee contract", () => {
    assert.deepEqual(STANDARD_ABILITY_IDS, [19, 20, 34]);
    assert.equal(abilityDefinition(34).label, "Basic Strike");
    assert.deepEqual(abilityDefinition(34).effects.map(({ type }) => type), ["damage"]);
    assert.ok(actionIdsForLoadout({ abilities: [] }).includes(34));
    assert.equal(abilityDefinition(34).stats.damage, 5);
    assert.equal(abilityDefinition(34).stats.range, 80);
});

test("Basic Heal catalogue copy matches its 25 HP self-heal", () => {
    assert.equal(abilityDefinition(10).stats.healing, 25);
    assert.equal(abilityDefinition(10).summary, "Channel briefly to restore 25 HP.");
});

test("loadout payloads contain abilities only and use the default combat stats", () => {
    assert.deepEqual(normalizedBotLoadout({ abilities: [1] }), { abilities: [1] });
    assert.equal(encodeBotLoadout({ abilities: [1] }), "custom:s");
    assert.deepEqual(decodeBotLoadout("custom:s"), { abilities: [1] });
    assert.equal(BASE_BOT_STATS.maxHp, 150);
});

test("compact loadouts preserve acquisition order for status-panel positions", () => {
    const loadout = { abilities: [12, 1, 3, 13] };

    assert.equal(encodeBotLoadout(loadout), "custom:psgR");
    assert.deepEqual(decodeBotLoadout("custom:psgR"), loadout);
});

test("catalogue tags describe self, status effects, summon, zone, trap, and radial semantics", () => {
    assert.ok(abilityDefinition(10).tags.includes("self"));
    assert.ok(abilityDefinition(16).tags.includes("self"));
    assert.ok(abilityDefinition(17).tags.includes("summon"));
    assert.ok(abilityDefinition(11).tags.includes("trap"));
    assert.ok(abilityDefinition(8).tags.includes("radial"));
    assert.ok(abilityDefinition(14).tags.includes("projectile"));
    assert.ok(abilityDefinition(14).tags.includes("zone"));
    assert.ok(abilityDefinition(5).tags.includes(ABILITY_TAGS.STATUS_EFFECT));
    assert.ok(abilityDefinition(33).tags.includes(ABILITY_TAGS.STATUS_EFFECT));
    assert.ok(ALL_ABILITY_DEFINITIONS.every((ability) => !ability.tags.includes("buff")));
    assert.ok(ALL_ABILITY_DEFINITIONS.every((ability) => !ability.tags.includes("entity")));
});

test("positive catalogue effects expose their numeric strength", () => {
    assert.deepEqual(abilityDefinition(16).buffDetails, [
        { label: "Damage reduction", value: "50%" },
        { label: "Damage reflection", value: "50%" },
    ]);
    assert.deepEqual(abilityDefinition(23).buffDetails, [
        { label: "Damage immunity", value: "100%" },
    ]);
    assert.deepEqual(abilityDefinition(33).buffDetails, [
        { label: "Cooldown recovery", value: "50%" },
    ]);
    assert.deepEqual(statusEffectDefinitionsForAbilities([33]), [
        { id: "overclock", label: "Overclock" },
    ]);
});

test("charges are tagged generically with HP and ammunition subtypes", () => {
    assert.equal(abilityDefinition(3).tags.includes(ABILITY_TAGS.AMMUNITION_CHARGES), true);
    assert.deepEqual(
        ALL_ABILITY_DEFINITIONS.filter((ability) => ability.tags.includes(ABILITY_TAGS.CHARGES)).map((ability) => ability.id),
        [3, 5, 12],
    );
    assert.equal(abilityDefinition(2), null);
});
