import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./AbilitySelectionPanel.jsx", import.meta.url));
const GAME_PAGE_PATH = fileURLToPath(new URL("../GamePage.jsx", import.meta.url));

test("ability selection panel keeps draft limits and detail modal wiring", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /loadoutDraftState/);
    assert.match(source, /Round \{draft\.roundNumber\} of \{maxRounds\}/);
    assert.match(source, /toggleDraftAbility/);
    assert.match(source, /self \? "You"/);
    assert.match(source, /onChange\(toggleDraftAbility\(/);
});

test("round 1 shows a weapon row and an ability row, later rounds only the ability offers", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /timedRounds\?\.weaponOffers/);
    assert.match(source, /weaponRound && \(/);
    assert.match(source, />Weapon<\/h2>/);
    assert.match(source, />Ability<\/h2>/);
    assert.match(source, /abilityBaseRange\(weapon\.id\)/);
    assert.match(source, /abilityStats\(weapon\.id\)\?\.damage/);
    assert.match(source, /Pick a weapon and an ability/);
    assert.match(source, /Pick \$\{picks\} \$\{picks === 1 \? "ability" : "abilities"\}/);
});

test("the zone notice, deadline footer and removal of guaranteed offers", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const page = readFileSync(GAME_PAGE_PATH, "utf8");

    assert.match(source, /The zone closes this round/);
    assert.match(source, /No weapon picked by the deadline gets Slash; an empty ability slot gets the first offer\./);
    assert.doesNotMatch(source, /uarantee/);
    assert.doesNotMatch(page, /uarantee/);
    assert.match(page, /timedRounds=\{matchContext\?\.timedRounds/);
});
