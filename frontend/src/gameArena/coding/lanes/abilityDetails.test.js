import assert from "node:assert/strict";
import test from "node:test";
import { abilityDetails, firstSentence, statsLine } from "./abilityDetails.js";

const SLASH = 1;
const SNIPER = 3;
const GRENADE = 4;
const FIREBALL = 5;

const statOf = (details, key) => details.stats.find((stat) => stat.key === key);

test("details name the ability and give one sentence of its description", () => {
    const fireball = abilityDetails(FIREBALL);
    assert.equal(fireball.name, "Fireball");
    assert.equal(fireball.description, "Hurl a large ball of fire that damages whoever it hits and sets them burning.");
    assert.equal(abilityDetails(9999), null, "an unknown ability has no details");
});

test("only the stats an ability has are listed, with units", () => {
    const slash = abilityDetails(SLASH);
    assert.equal(statOf(slash, "damage").value, "8");
    assert.deepEqual([statOf(slash, "cooldown").value, statOf(slash, "cooldown").unit], ["0.5", "s"]);
    assert.equal(statOf(slash, "windup"), undefined, "Slash has no wind-up, so no wind-up line");
    assert.equal(statOf(slash, "speed"), undefined, "a melee strike has no projectile speed");

    const sniper = abilityDetails(SNIPER);
    assert.deepEqual([statOf(sniper, "windup").value, statOf(sniper, "windup").unit], ["0.9", "s"]);
    assert.equal(statOf(sniper, "speed"), undefined, "a hitscan beam has no projectile speed");
});

test("a projectile shows its speed per second, and a falloff damage shows its range of values", () => {
    const fireball = abilityDetails(FIREBALL);
    assert.deepEqual([statOf(fireball, "speed").value, statOf(fireball, "speed").unit], ["500", "/ s"]);
    assert.equal(statOf(abilityDetails(GRENADE), "damage").value, "18–30");
});

test("every stat is a finite display value and uses one of the known units", () => {
    for (const id of [SLASH, SNIPER, GRENADE, FIREBALL]) {
        for (const stat of abilityDetails(id).stats) {
            assert.ok(stat.value.length > 0 && !/NaN|undefined|Infinity/.test(stat.value), `${id} ${stat.key} shows ${stat.value}`);
            assert.ok(["", "s", "/ s"].includes(stat.unit), `${id} ${stat.key} has unit "${stat.unit}"`);
        }
    }
});

test("the stats line joins the listed stats for a footer", () => {
    const line = statsLine(abilityDetails(SLASH));
    assert.match(line, /^Damage 8 · /);
    assert.match(line, /Cooldown 0\.5 s/);
    assert.equal(statsLine({ stats: [] }), "");
});

test("firstSentence keeps the first sentence, or the whole text without a full stop", () => {
    assert.equal(firstSentence("One thing. Another."), "One thing.");
    assert.equal(firstSentence("No full stop here"), "No full stop here");
});
