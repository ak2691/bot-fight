import assert from "node:assert/strict";
import test from "node:test";
import { ABILITY_TAGS, ALL_ABILITY_DEFINITIONS, BASE_BOT_STATS, STANDARD_ABILITY_IDS, abilityDefinition, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout, SELECTABLE_BOT_ABILITIES } from "../../../../shared/engine/loadout/BotLoadout.js";

test("Dash is the only standard ability and unknown ability IDs drop out of a loadout", () => {
    assert.deepEqual(STANDARD_ABILITY_IDS, [19]);
    assert.equal(abilityDefinition(34), null);
    assert.deepEqual(normalizedBotLoadout({ abilities: [34, 1] }), { abilities: [1] });
});

test("loadout payloads contain abilities only and use the default combat stats", () => {
    assert.deepEqual(normalizedBotLoadout({ abilities: [1] }), { abilities: [1] });
    assert.equal(encodeBotLoadout({ abilities: [1] }), "custom:s");
    assert.deepEqual(decodeBotLoadout("custom:s"), { abilities: [1] });
    assert.equal(BASE_BOT_STATS.maxHp, 225);
    assert.equal(BASE_BOT_STATS.moveSpeed, 15);
});

test("compact loadouts preserve acquisition order for status-panel positions", () => {
    const loadout = { abilities: [3, 1, 6, 21] };

    assert.equal(encodeBotLoadout(loadout), "custom:gstw");
    assert.deepEqual(decodeBotLoadout("custom:gstw"), loadout);
});

test("catalogue tags describe self, status effects, summon, zone, trap, and radial semantics", () => {
    assert.ok(abilityDefinition(21).tags.includes("zone"));
    assert.ok(abilityDefinition(17).tags.includes("summon"));
    assert.ok(abilityDefinition(29).tags.includes("trap"));
    assert.ok(abilityDefinition(8).tags.includes("radial"));
    assert.ok(abilityDefinition(4).tags.includes("projectile"));
    assert.ok(abilityDefinition(5).tags.includes(ABILITY_TAGS.STATUS_EFFECT));
    assert.ok(abilityDefinition(15).tags.includes(ABILITY_TAGS.STATUS_EFFECT));
    assert.ok(ALL_ABILITY_DEFINITIONS.every((ability) => !ability.tags.includes("buff")));
    assert.ok(ALL_ABILITY_DEFINITIONS.every((ability) => !ability.tags.includes("entity")));
});


test("fixed kit unlock table grants tiers only in rounds 1, 3 and 5", async () => {
    const { ROUND_ABILITY_UNLOCK, unlockedKitLoadout } = await import("../../../../shared/engine/loadout/BotLoadout.js");
    assert.deepEqual(Object.values(ROUND_ABILITY_UNLOCK).map(({ tier }) => tier), [1, null, 2, null, 3, null]);
    assert.deepEqual(Object.values(ROUND_ABILITY_UNLOCK).map(({ weapon }) => weapon), [true, false, false, false, false, false]);
    for (let round = 1; round <= 6; round++) {
        assert.deepEqual(unlockedKitLoadout({ abilities: [1, 3, 6, 21] }, round).abilities,
            round < 3 ? [1, 3] : [1, 3, 6, 21]);
    }
});
