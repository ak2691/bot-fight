import assert from "node:assert/strict";
import test from "node:test";
import {
    loadoutForFreshRound,
    loadoutDraftState,
    toggleDraftAbility,
} from "./loadoutDraft.js";
import { BOT_ABILITIES } from "../gameArena/loadout/BotLoadout.js";

const roundOneOffers = [1, 2, 3, 6, 10, 12];
const roundTwoOffers = [13, 14, 15, 16];
const roundThreeOffers = [21, 22, 23];

test("round draft limits are three, two, and one", () => {
    assert.equal(loadoutDraftState({}, 1, roundOneOffers).draftRule.picks, 3);
    assert.equal(loadoutDraftState({}, 2, roundTwoOffers).draftRule.picks, 2);
    assert.equal(loadoutDraftState({}, 3, roundThreeOffers).draftRule.picks, 1);
});

test("round two abilities, including Rail Shot, can be selected independently", () => {
    const first = toggleDraftAbility({ abilities: [1, 2, 3] }, 2, roundTwoOffers, 13);
    const second = toggleDraftAbility(first, 2, roundTwoOffers, 14);
    const draft = loadoutDraftState(second, 2, roundTwoOffers);

    assert.deepEqual(draft.inheritedAbilities, [1, 2, 3]);
    assert.deepEqual(draft.draftedAbilities, [13, 14]);
    assert.equal(draft.hasAllDraftPicks, true);
});

test("every selectable ability can be drafted when the server offers it", () => {
    for (const ability of BOT_ABILITIES) {
        const next = toggleDraftAbility({}, ability.round, [ability.id], ability.id);
        assert.deepEqual(next.abilities, [ability.id], ability.id);
    }
});

test("legacy matchmaking offers normalize once at the draft boundary", () => {
    const draft = loadoutDraftState({}, 2, ["rail_shot", "unknown_ability"]);
    assert.deepEqual([...draft.offeredAbilityIds], [13]);
    assert.deepEqual(toggleDraftAbility({}, 2, ["rail_shot"], "rail_shot").abilities, [13]);
});

test("completed loadouts still mark auto-picked current-round abilities as selected", () => {
    const draft = loadoutDraftState({
        abilities: [1, 2, 3, 13, 18],
    }, 2, [13, 14, 15, 18]);

    assert.deepEqual(draft.inheritedAbilities, [1, 2, 3]);
    assert.deepEqual(draft.draftedAbilities, [13, 18]);
});

test("fresh round two and round three drafts clear only current-round abilities", () => {
    const roundTwoDraft = loadoutForFreshRound({
        abilities: [1, 2, 3, 13, 14],
        statPoints: { maxHp: 2 },
    }, 2);
    assert.deepEqual(roundTwoDraft.abilities, [1, 2, 3]);

    const roundThreeDraft = loadoutForFreshRound({
        abilities: [1, 2, 3, 13, 14, 22],
    }, 3);
    assert.deepEqual(roundThreeDraft.abilities, [1, 2, 3, 13, 14]);
});
