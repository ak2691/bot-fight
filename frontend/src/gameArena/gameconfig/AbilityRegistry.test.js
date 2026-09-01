import assert from "node:assert/strict";
import test from "node:test";

import {
    ABILITIES,
    abilityId,
    abilityIdFromLegacyName,
    abilityIdentity,
    abilityName,
    legacyAbilityNameFromId,
} from "./AbilityRegistry.js";
import { ABILITY_STATS, abilityStats } from "./Abilities.js";
import { ABILITY_CONTRACTS, abilityContract } from "./AbilityContracts.js";

test("ability identities are stable numeric keys independent of array position", () => {
    assert.equal(ABILITIES[3].id, 3);
    assert.equal(ABILITIES[3].name, "gun");
    assert.equal(ABILITIES[3].label, "Gun");
    assert.equal(ABILITIES[3].type, "ability");
    assert.equal(abilityIdFromLegacyName("gun"), 3);
    assert.equal(abilityIdentity(3), ABILITIES[3]);
    assert.equal(abilityName(3), "gun");
    assert.equal(ABILITIES[32].name, "vampiric_beam");
    assert.equal(ABILITIES[32].label, "Vampiric Beam");
    assert.equal(abilityIdFromLegacyName("retired_beam"), null);
});

test("numeric identity owns tuning and contracts", () => {
    assert.equal(ABILITY_STATS[3].range, 700);
    assert.equal(ABILITY_STATS[3].activeMs, 500);
    assert.equal(ABILITY_STATS[3].cooldownMs, 1000);
    assert.equal(ABILITY_STATS[3].reloadMs, 5000);
    assert.equal(ABILITY_STATS[34].damage, 8);
    assert.equal(ABILITY_STATS[34].range, 80);
    assert.equal(ABILITY_STATS[34].arcDegrees, 30);
    assert.equal(ABILITY_STATS[19].cooldownMs, 1800);
    assert.equal(ABILITY_STATS[25].hitboxWidth, 60);
    assert.equal(ABILITY_CONTRACTS[25].delivery.geometry, "rectangle");
    assert.equal(ABILITY_CONTRACTS[25].delivery.includeTargetRadius, true);
    assert.equal(ABILITY_CONTRACTS[25].effects[0].distanceMode, "center_distance");
    assert.equal(ABILITY_CONTRACTS[25].execution.teleportOncePerActivation, true);
    assert.equal(abilityStats(3), ABILITY_STATS[3]);
    assert.equal(abilityContract(3), ABILITY_CONTRACTS[3]);
    assert.equal(ABILITY_STATS[3], abilityStats(3));
    assert.equal(ABILITY_CONTRACTS[3], abilityContract(3));
});

test("requested combat tuning is represented in the browser catalog", () => {
    assert.equal(ABILITY_STATS[3].maxCharges, 6);
    assert.equal(ABILITY_STATS[3].reloadMs, 5000);
    assert.equal(ABILITY_STATS[4].maxDamage, 40);
    assert.equal(ABILITY_STATS[4].throwRange, 336);
    assert.equal(ABILITY_STATS[5].cooldownMs, 300);
    assert.equal(ABILITY_STATS[5].reloadMs, 5000);
    assert.equal(ABILITY_STATS[8].cooldownMs, 10000);
    assert.equal(ABILITY_STATS[9].statuses.slow.durationMs, 1000);
    assert.equal(ABILITY_STATS[10].healing, 25);
    assert.equal(ABILITY_STATS[11].damage, 25);
    assert.equal(ABILITY_STATS[11].throwRange, 176);
    assert.equal(ABILITY_STATS[6].damage, 10);
    assert.equal(ABILITY_STATS[17].damage, 5);
    assert.equal(ABILITY_STATS[18].cooldownMs, 7000);
    assert.equal(ABILITY_STATS[18].windupMs, 300);
    assert.equal(ABILITY_STATS[18].damage, 20);
    assert.equal(ABILITY_STATS[18].knockback, 200);
    assert.equal(ABILITY_STATS[22].windupMs, 500);
    assert.equal(ABILITY_STATS[22].activeMs, 0);
    assert.equal(ABILITY_STATS[22].durationMs, 1500);
    assert.equal(ABILITY_STATS[22].damage, 15);
    assert.equal(ABILITY_STATS[22].intervalMs, 500);
    assert.equal(ABILITY_STATS[27].pullPerTick, 10);
    assert.equal(ABILITY_STATS[28].pullPerTick, 100);
    assert.equal(ABILITY_STATS[24].activeMs, 300);
    assert.equal(ABILITY_STATS[24].windupMs, 1000);
    assert.equal(ABILITY_STATS[25].damage, 15);
    assert.equal(ABILITY_STATS[26].damage, 15);
    assert.equal(ABILITY_STATS[30].cooldownMs, 8000);
    assert.equal(ABILITY_STATS[30].windupMs, 200);
    assert.equal(ABILITY_STATS[30].damage, 15);
    assert.equal(ABILITY_STATS[30].statuses.slow.durationMs, 2000);
    assert.equal(ABILITY_STATS[31].damage, 3);
    assert.equal(ABILITY_STATS[31].knockback, 40);
    assert.equal(ABILITY_STATS[32].cooldownMs, 10000);
    assert.equal(ABILITY_STATS[32].windupMs, 300);
});

test("legacy names convert only through explicit allowlisted compatibility functions", () => {
    assert.equal(abilityId("3"), null);
    assert.equal(abilityId("fire_gun"), null);
    assert.equal(abilityIdFromLegacyName("fire_gun"), 3);
    assert.equal(legacyAbilityNameFromId(3), "gun");
    assert.equal(abilityIdFromLegacyName("constructor"), null);
    assert.equal(abilityIdFromLegacyName("unknown"), null);
});

test("malformed numeric IDs fail closed", () => {
    for (const value of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2, 35, null]) {
        assert.equal(abilityId(value), null);
    }
});

test("registered IDs are unique positive integers with matching stats and contracts", () => {
    const ids = Object.values(ABILITIES).map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
        assert.ok(Number.isSafeInteger(id) && id > 0);
        assert.ok(ABILITY_STATS[id]);
        assert.ok(ABILITY_CONTRACTS[id]);
    }
});

test("missing IDs stay missing instead of shifting later abilities", () => {
    const withoutFive = { ...ABILITIES };
    delete withoutFive[5];
    assert.equal(withoutFive[5], undefined);
    assert.equal(withoutFive[7].name, "heavy_slash");
    assert.equal(abilityIdentity(2), null);
});
