import {
    BOT_ABILITIES,
    MAX_EQUIPPED_ABILITIES,
    ROUND_ABILITY_DRAFT,
    normalizedBotLoadout,
} from "../gameArena/loadout/BotLoadout.js";
import { abilityIdFromBoundary } from "../gameArena/gameconfig/AbilityCompatibility.js";

const ABILITY_BY_ID = new Map(BOT_ABILITIES.map((ability) => [ability.id, ability]));

function normalizedRoundNumber(roundNumber) {
    return Math.max(1, Number(roundNumber) || 1);
}

export function loadoutDraftState(loadout, roundNumber, abilityOffers = []) {
    const normalized = normalizedBotLoadout(loadout);
    const currentRound = normalizedRoundNumber(roundNumber);
    const draftRule = ROUND_ABILITY_DRAFT[currentRound] ?? { offered: 0, picks: 0 };
    const offeredAbilityIds = new Set(
        (Array.isArray(abilityOffers) ? abilityOffers : [])
            .map(abilityIdFromBoundary)
            .filter((id) => ABILITY_BY_ID.get(id)?.round === currentRound),
    );
    const inheritedAbilities = normalized.abilities.filter((id) => {
        const ability = ABILITY_BY_ID.get(id);
        return ability != null && ability.round < currentRound;
    });
    const draftedAbilities = normalized.abilities.filter((id) => {
        const ability = ABILITY_BY_ID.get(id);
        return ability != null && ability.round === currentRound;
    });

    return {
        normalized,
        roundNumber: currentRound,
        draftRule,
        offeredAbilityIds,
        inheritedAbilities,
        inheritedAbilityIds: new Set(inheritedAbilities),
        draftedAbilities,
        draftedAbilityIds: new Set(draftedAbilities),
        hasAllDraftPicks: draftedAbilities.length >= draftRule.picks,
    };
}

/**
 * A new round starts with the prior rounds' abilities as the inherited base.
 * Current-round abilities are draft state and must never leak into the next
 * selection screen from a stale or replayed loadout event.
 */
export function loadoutForFreshRound(loadout, roundNumber) {
    const normalized = normalizedBotLoadout(loadout);
    const currentRound = normalizedRoundNumber(roundNumber);
    return normalizedBotLoadout({
        ...normalized,
        abilities: normalized.abilities.filter((id) => ABILITY_BY_ID.get(id)?.round !== currentRound),
    });
}

export function toggleDraftAbility(loadout, roundNumber, abilityOffers, id) {
    const draft = loadoutDraftState(loadout, roundNumber, abilityOffers);
    const normalizedId = abilityIdFromBoundary(id);
    const ability = ABILITY_BY_ID.get(normalizedId);
    if (!ability
        || ability.round !== draft.roundNumber
        || !draft.offeredAbilityIds.has(normalizedId)) {
        return draft.normalized;
    }

    const abilities = draft.draftedAbilityIds.has(normalizedId)
        ? draft.normalized.abilities.filter((abilityId) => abilityId !== normalizedId)
        : draft.draftedAbilities.length < draft.draftRule.picks
            ? [...draft.normalized.abilities, normalizedId]
            : draft.normalized.abilities;
    const nextLoadout = normalizedBotLoadout({ ...draft.normalized, abilities });
    return nextLoadout.abilities.length <= MAX_EQUIPPED_ABILITIES ? nextLoadout : draft.normalized;
}
