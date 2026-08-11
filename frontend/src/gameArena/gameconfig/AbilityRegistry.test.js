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
    assert.equal(ABILITIES[3].name, "fire_gun");
    assert.equal(ABILITIES[3].label, "Fire Gun");
    assert.equal(ABILITIES[3].type, "ability");
    assert.equal(abilityIdFromLegacyName("fire_gun"), 3);
    assert.equal(abilityIdentity(3), ABILITIES[3]);
    assert.equal(abilityName(3), "fire_gun");
});

test("numeric identity owns tuning and contracts", () => {
    assert.equal(ABILITY_STATS[3].range, 700);
    assert.equal(abilityStats(3), ABILITY_STATS[3]);
    assert.equal(abilityContract(3), ABILITY_CONTRACTS[3]);
    assert.equal(ABILITY_STATS[3], abilityStats(3));
    assert.equal(ABILITY_CONTRACTS[3], abilityContract(3));
});

test("legacy names convert only through explicit allowlisted compatibility functions", () => {
    assert.equal(abilityId("3"), null);
    assert.equal(abilityId("fire_gun"), null);
    assert.equal(abilityIdFromLegacyName("fire_gun"), 3);
    assert.equal(legacyAbilityNameFromId(3), "fire_gun");
    assert.equal(abilityIdFromLegacyName("constructor"), null);
    assert.equal(abilityIdFromLegacyName("unknown"), null);
});

test("malformed numeric IDs fail closed", () => {
    for (const value of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 26, null]) {
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
});
