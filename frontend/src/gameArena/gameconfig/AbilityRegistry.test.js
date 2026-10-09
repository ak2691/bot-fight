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
import {
    ABILITY_CONTRACTS,
    abilityContract,
    ENTITY_CONTRACTS,
    eventVerbs,
    isEntityAbility,
    phaseEffects,
    triggerView,
    triggerVerbs,
    EFFECT_TYPES,
} from "../ecs/contracts/AbilityContracts.js";

test("ability identities are stable numeric keys independent of array position", () => {
    assert.equal(ABILITIES[3].id, 3);
    assert.equal(ABILITIES[3].name, "gun");
    // Sniper is a display rename: the registry name and ID stay "gun"/3 for saved brains.
    assert.equal(ABILITIES[3].label, "Sniper");
    assert.equal(ABILITIES[3].type, "ability");
    assert.equal(abilityIdFromLegacyName("gun"), 3);
    assert.equal(abilityIdentity(3), ABILITIES[3]);
    assert.equal(abilityName(3), "gun");
    assert.equal(ABILITIES[32].name, "vampiric_beam");
    assert.equal(ABILITIES[32].label, "Vampiric Beam");
    assert.equal(ABILITIES[8].name, "repelling_blast");
    assert.equal(ABILITIES[8].label, "Repelling Blast");
    assert.equal(ABILITIES[21].name, "rewind");
    assert.equal(ABILITIES[21].label, "Rewind");
    assert.equal(ABILITIES[29].name, "snare_bomb");
    assert.equal(ABILITIES[29].label, "Snare Bomb");
    assert.equal(abilityIdFromLegacyName("repulsor_burst"), 8);
    assert.equal(abilityIdFromLegacyName("temporal_rewind"), 21);
    assert.equal(abilityIdFromLegacyName("static_snare"), 29);
    assert.equal(ABILITIES[30].label, "Disruptive Beam");
    assert.equal(abilityIdFromLegacyName("retired_beam"), null);
});

test("numeric identity owns tuning and contracts", () => {
    assert.equal(ABILITY_STATS[3].range, 1200);
    assert.equal(ABILITY_STATS[3].activeMs, 200);
    assert.equal(ABILITY_STATS[3].windupMs, 900);
    assert.equal(ABILITY_STATS[3].cooldownMs, 9000);
    assert.equal(ABILITY_STATS[3].reloadMs, undefined);
    assert.equal(ABILITY_STATS[3].falloff, undefined);
    assert.equal(ABILITY_STATS[3].damage, 40);
    assert.equal(ABILITY_STATS[3].hitboxWidth, 6);
    assert.equal(ABILITY_STATS[34].damage, 8);
    assert.equal(ABILITY_STATS[34].range, 80);
    assert.equal(ABILITY_STATS[34].arc, 30);
    assert.equal(ABILITY_STATS[19].cooldownMs, 100, "Dash recovers for 100 ms after its 200 ms active stage (a 300 ms gap in all)");
    assert.equal(ABILITY_STATS[25].hitboxWidth, 60);
    assert.equal(ABILITY_STATS[30].hitboxWidth, 8);
    assert.equal(ABILITY_STATS[32].hitboxWidth, 10);
    assert.equal(ABILITY_STATS[15].hitboxWidth, 150);
    assert.equal(ABILITY_STATS[15].hitboxLength, 190);
    assert.equal(ABILITY_STATS[18].hitboxWidth, 80);
    assert.equal(ABILITY_STATS[18].hitboxLength, 115);
    assert.equal(triggerView(25).hitbox.shape, "rectangle");
    assert.equal(triggerView(25).hitbox.includeTargetRadius, true);
    assert.equal(triggerView(25).effects[0].distanceMode, "center_distance");
    assert.equal(abilityContract(25).activation.teleportOncePerActivation, true);
    assert.equal(abilityStats(3), ABILITY_STATS[3]);
    assert.equal(ABILITY_STATS[3], abilityStats(3));
    assert.equal(abilityContract(3), ABILITY_CONTRACTS[3]);
});

test("requested combat tuning is represented in the browser catalog", () => {
    assert.equal(ABILITY_STATS[3].maxCharges, undefined);
    assert.equal(ABILITY_STATS[5].maxCharges, undefined);
    assert.equal(ABILITY_STATS[4].falloff.maxAmount, 40);
    assert.equal(ABILITY_STATS[4].radius, 70);
    assert.equal(ABILITY_STATS[5].cooldownMs, 5500);
    assert.equal(ABILITY_STATS[5].reloadMs, undefined);
    assert.equal(ABILITY_STATS[5].damage, 20);
    assert.equal(ABILITY_STATS[5].durationMs, 1400);
    assert.equal(ABILITY_STATS[5].hitboxWidth, 64);
    assert.equal(ABILITY_STATS[5].hitboxLength, 64);
    assert.equal(ABILITY_STATS[5].size, 60);
    assert.equal(ABILITY_STATS[8].cooldownMs, 10000);
    assert.equal(ABILITY_STATS[9].statuses.slow.durationMs, 3000);
    assert.equal(ABILITY_STATS[9].windupMs, 1000);
    assert.equal(ABILITY_STATS[10].healing, 25);
    assert.equal(ABILITY_STATS[11].damage, 30);
    assert.equal(ABILITY_STATS[11].radius, 87.5);
    assert.equal(ABILITY_STATS[11].range, 87.5);
    assert.equal(ABILITY_STATS[14].range, 120);
    assert.equal(ABILITY_STATS[3].hitboxLength, 1200);
    assert.equal(ABILITY_STATS[4].hitboxWidth, undefined);
    assert.equal(ABILITY_STATS[17].hitboxWidth, 5);
    assert.equal(ABILITY_STATS[17].shotVisualMs, 300);
    assert.equal(ABILITY_STATS[31].hitboxWidth, 5);
    assert.equal(ABILITY_STATS[31].shotVisualMs, 300);
    assert.equal(ABILITY_STATS[6].damage, 10);
    assert.equal(ABILITY_STATS[6].windupMs, 200);
    assert.equal(ABILITY_STATS[6].activeMs, 100);
    assert.equal(ABILITY_STATS[6].hitboxWidth, 80);
    assert.equal(ABILITY_STATS[6].range, 184);
    assert.equal(triggerView(6).hitbox.shape, "rectangle");
    assert.equal(triggerView(6).hitbox.includeTargetRadius, true);
    assert.equal(ABILITY_STATS[17].damage, 5);
    assert.equal(ABILITY_STATS[18].cooldownMs, 7000);
    assert.equal(ABILITY_STATS[18].windupMs, 300);
    assert.equal(ABILITY_STATS[18].damage, 20);
    assert.equal(ABILITY_STATS[18].knockback, 250);
    assert.equal(ABILITY_STATS[8].knockback, 300);
    assert.equal(ABILITY_STATS[22].windupMs, 500);
    assert.equal(ABILITY_STATS[22].activeMs, 0);
    assert.equal(ABILITY_STATS[22].durationMs, 1500);
    assert.equal(ABILITY_STATS[22].damage, 15);
    assert.equal(ABILITY_STATS[22].intervalMs, 500);
    assert.equal(ABILITY_STATS[27].pullPerTick, 10);
    assert.equal(ABILITY_STATS[28].pullPerTick, 250);
    assert.equal(ABILITY_STATS[24].activeMs, 300);
    assert.equal(ABILITY_STATS[24].windupMs, 1000);
    assert.equal(ABILITY_STATS[25].damage, 15);
    assert.equal(ABILITY_STATS[26].damage, 15);
    assert.equal(ABILITY_STATS[26].statuses.slow.durationMs, 2000);
    assert.equal(triggerView(26).visual.visualSize, 320);
    assert.equal(ABILITY_STATS[30].cooldownMs, 8000);
    assert.equal(ABILITY_STATS[30].windupMs, 200);
    assert.equal(ABILITY_STATS[30].damage, 20);
    assert.equal(ABILITY_STATS[30].statuses.slow.durationMs, 1500);
    assert.equal(ABILITY_STATS[31].damage, 3);
    assert.equal(ABILITY_STATS[31].knockback, 40);
    assert.equal(ABILITY_STATS[32].cooldownMs, 10000);
    assert.equal(ABILITY_STATS[32].windupMs, 300);
});

test("Tether Bolt returns on outbound collision and pulls once during the return phase", () => {
    const [outbound, returning] = ENTITY_CONTRACTS[28].phases;
    assert.deepEqual(eventVerbs(outbound.on.collision).map((verb) => verb.do), ["applyEffects", "transition"]);
    assert.equal(eventVerbs(outbound.on.collision)[1].to, "return");
    assert.equal(outbound.on.collision.recheckCollisionOnTransition, false);
    assert.equal(outbound.on.collision.nearestOnly, true);
    assert.equal(eventVerbs(outbound.on.lifetimeEnd)[0].to, "return");
    assert.equal(outbound.on.lifetimeEnd.recheckCollisionOnTransition, false);
    assert.equal(phaseEffects(returning).find((effect) => effect.type === EFFECT_TYPES.PULL).amount, 250);
    assert.deepEqual(returning.on.collision.targetPolicy, { mode: "once" });
    assert.equal(eventVerbs(returning.on.collision)[0].pullDirection, "owner");
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
    for (const value of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2, 38, null]) {
        assert.equal(abilityId(value), null);
    }
});

test("registered IDs are unique positive integers with matching stats and contracts", () => {
    const ids = Object.values(ABILITIES).map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
        assert.ok(Number.isSafeInteger(id) && id > 0);
        assert.ok(ABILITY_STATS[id]);
        assert.ok(abilityContract(id), id);
    }
});

test("one normalized contract registry covers direct and spawned abilities", () => {
    assert.equal(Object.keys(ABILITY_CONTRACTS).length, 36);
    assert.equal(Object.keys(ENTITY_CONTRACTS).length, 14);
    assert.equal(Object.values(ABILITY_CONTRACTS).filter((contract) => isEntityAbility(contract.abilityId)).length, 14);
    for (const contract of Object.values(ABILITY_CONTRACTS)) {
        assert.ok(contract.activation);
        assert.ok(contract.onTrigger.length > 0);
        for (const entity of Object.values(contract.entities)) assert.ok(entity.phases.length > 0);
    }
    for (const [id, entity] of Object.entries(ENTITY_CONTRACTS)) {
        assert.ok(triggerVerbs(Number(id)).some((verb) => verb.do === "spawn" && verb.entity === entity.entityType));
    }
    assert.deepEqual(ENTITY_CONTRACTS[15].phases[0].on.collision.targets, ["BOT", "SUMMON"]);
});

test("missing IDs stay missing instead of shifting later abilities", () => {
    const withoutFive = { ...ABILITIES };
    delete withoutFive[5];
    assert.equal(withoutFive[5], undefined);
    assert.equal(withoutFive[7].name, "heavy_slash");
    assert.equal(abilityIdentity(2), null);
});
