import assert from "node:assert/strict";
import test from "node:test";
import {
    loadoutForFreshRound,
    loadoutDraftState,
    offeredWeaponIds,
    toggleDraftAbility,
} from "./loadoutDraft.js";
import { BOT_ABILITIES } from "../../../shared/engine/loadout/BotLoadout.js";

const roundOneOffers = [3, 6, 10];
const roundTwoOffers = [26, 27, 15];
const roundFiveOffers = [21, 22];

test("round 1 picks a weapon and an ability, every later round one ability from two or three offers", () => {
    const rules = [1, 2, 3, 4, 5, 6].map((round) => loadoutDraftState({}, round, []).draftRule);
    assert.deepEqual(rules.map((rule) => rule.picks), [1, 1, 1, 1, 1, 1]);
    assert.deepEqual(rules.map((rule) => rule.offered), [3, 3, 3, 3, 2, 2]);
    assert.deepEqual(rules.map((rule) => rule.weaponPick), [true, false, false, false, false, false]);
    assert.deepEqual(rules.map((rule) => rule.tier), [1, 1, 2, 2, 3, 3]);
});

test("round two abilities, including Frost Ring, can be selected one at a time", () => {
    const first = toggleDraftAbility({ abilities: [1, 3] }, 2, roundTwoOffers, 26);
    const second = toggleDraftAbility(first, 2, roundTwoOffers, 27);
    const draft = loadoutDraftState(second, 2, roundTwoOffers);

    assert.deepEqual(second.abilities, [1, 3, 26], "the second pick is ignored once the round's one pick is made");
    assert.deepEqual(draft.inheritedAbilities, [1, 3]);
    assert.deepEqual(draft.draftedAbilities, [26]);
    assert.equal(draft.hasAllDraftPicks, true);
    assert.deepEqual(toggleDraftAbility(first, 2, roundTwoOffers, 26).abilities, [1, 3]);
});

test("round 1 needs a weapon as well as an ability, and choosing another weapon replaces the first", () => {
    const weapon = toggleDraftAbility({}, 1, roundOneOffers, 36);
    assert.deepEqual(weapon.abilities, [36]);
    assert.equal(loadoutDraftState(weapon, 1, roundOneOffers).hasAllDraftPicks, false);

    const both = toggleDraftAbility(weapon, 1, roundOneOffers, 6);
    assert.deepEqual(both.abilities, [36, 6]);
    assert.equal(loadoutDraftState(both, 1, roundOneOffers).hasAllDraftPicks, true);

    assert.deepEqual(toggleDraftAbility(both, 1, roundOneOffers, 37).abilities, [37, 6]);
    assert.deepEqual(toggleDraftAbility(both, 1, roundOneOffers, 36).abilities, [6]);
});

test("round 1 weapons are limited to the server's weapon offers", () => {
    assert.deepEqual(toggleDraftAbility({}, 1, roundOneOffers, 36, [1, 35]).abilities, []);
    assert.deepEqual(toggleDraftAbility({}, 1, roundOneOffers, 35, [1, 35]).abilities, [35]);
    assert.deepEqual(toggleDraftAbility({}, 1, roundOneOffers, 36, []).abilities, [36], "no offer list means every weapon");
    assert.deepEqual(offeredWeaponIds([1, 35, "x", 3]), [1, 35]);
    assert.deepEqual(offeredWeaponIds(null), [1, 35, 36, 37]);
});

test("weapons can only be drafted in round 1 and an ability the server did not offer cannot be drafted", () => {
    for (const id of [1, 35, 36, 37]) {
        for (const round of [2, 3, 4, 5, 6]) {
            assert.deepEqual(toggleDraftAbility({}, round, [id], id).abilities, [], `${id} round ${round}`);
        }
        assert.deepEqual(toggleDraftAbility({}, 1, [], id).abilities, [id], `${id} round 1`);
    }
    assert.deepEqual(toggleDraftAbility({}, 2, roundTwoOffers, 6).abilities, []);
    assert.equal(BOT_ABILITIES.find(({ id }) => id === 1).round, 0, "Slash is a weapon, not a tier 1 ability");
});

test("every selectable non-weapon ability can be drafted when the server offers it", () => {
    for (const ability of BOT_ABILITIES.filter(({ round, category }) => round > 0 && category !== "weapon")) {
        const next = toggleDraftAbility({}, 1, [ability.id], ability.id);
        assert.deepEqual(next.abilities, [ability.id], ability.id);
    }
});

test("legacy matchmaking offers normalize once at the draft boundary", () => {
    const draft = loadoutDraftState({}, 2, ["frost_ring", "unknown_ability"]);
    assert.deepEqual([...draft.offeredAbilityIds], [26]);
    assert.deepEqual(toggleDraftAbility({}, 2, ["frost_ring"], "frost_ring").abilities, [26]);
});

test("completed loadouts still mark the auto-picked current-round ability as selected", () => {
    const draft = loadoutDraftState({ abilities: [1, 3, 26] }, 2, [26, 27, 15]);

    assert.deepEqual(draft.inheritedAbilities, [1, 3]);
    assert.deepEqual(draft.draftedAbilities, [26]);

    const lateRound = loadoutDraftState({ abilities: [1, 3, 26, 27, 15, 21] }, 5, roundFiveOffers);
    assert.deepEqual(lateRound.draftedAbilities, [21]);
    assert.deepEqual(lateRound.inheritedAbilities, [1, 3, 26, 27, 15]);
});

test("a fresh round keeps only the picks of the rounds before it", () => {
    assert.deepEqual(loadoutForFreshRound({ abilities: [1, 3, 26] }, 1).abilities, []);
    assert.deepEqual(loadoutForFreshRound({ abilities: [1, 3, 26, 27] }, 2).abilities, [1, 3]);
    assert.deepEqual(loadoutForFreshRound({ abilities: [1, 3, 26, 27, 22] }, 3).abilities, [1, 3, 26]);
    assert.deepEqual(loadoutForFreshRound({ abilities: [1, 3, 26, 27, 15, 21, 22] }, 6).abilities, [1, 3, 26, 27, 15, 21]);
});
