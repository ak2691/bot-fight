import {
    BOT_ABILITIES,
    MAX_EQUIPPED_ABILITIES,
    ROUND_ABILITY_DRAFT,
    normalizedBotLoadout,
} from "../gameArena/loadout/BotLoadout.js";
import { abilityIdFromBoundary } from "../gameArena/gameconfig/AbilityCompatibility.js";

const ABILITY_BY_ID = new Map(BOT_ABILITIES.map((ability) => [ability.id, ability]));
const WEAPON_IDS = new Set(BOT_ABILITIES.filter((ability) => ability.category === "weapon").map((ability) => ability.id));

function normalizedRoundNumber(roundNumber) {
    return Math.max(1, Number(roundNumber) || 1);
}

/**
 * Round 1 picks a weapon and one ability; every later round picks one ability. An ability counts as
 * drafted this round when the server offered it (an owned ability is never re-offered) or, in round 1,
 * when it is a weapon. Everything else in the loadout is inherited from earlier rounds.
 */
export function loadoutDraftState(loadout, roundNumber, abilityOffers = []) {
    const normalized = normalizedBotLoadout(loadout);
    const currentRound = normalizedRoundNumber(roundNumber);
    const draftRule = ROUND_ABILITY_DRAFT[currentRound]
        ?? { tier: 0, offered: 0, picks: 0, weaponPick: false };
    const offeredAbilityIds = new Set(
        (Array.isArray(abilityOffers) ? abilityOffers : [])
            .map(abilityIdFromBoundary)
            .filter((id) => ABILITY_BY_ID.has(id) && !WEAPON_IDS.has(id)),
    );
    const isDrafted = (id) => offeredAbilityIds.has(id) || (draftRule.weaponPick && WEAPON_IDS.has(id));
    const inheritedAbilities = normalized.abilities.filter((id) => !isDrafted(id));
    const draftedAbilities = normalized.abilities.filter(isDrafted);
    const draftedWeapons = draftedAbilities.filter((id) => WEAPON_IDS.has(id));
    const draftedPicks = draftedAbilities.filter((id) => !WEAPON_IDS.has(id));

    return {
        normalized,
        roundNumber: currentRound,
        draftRule,
        offeredAbilityIds,
        inheritedAbilities,
        inheritedAbilityIds: new Set(inheritedAbilities),
        draftedAbilities,
        draftedAbilityIds: new Set(draftedAbilities),
        draftedWeapons,
        hasAllDraftPicks: draftedPicks.length >= draftRule.picks
            && (!draftRule.weaponPick || draftedWeapons.length >= 1),
    };
}

/**
 * A new round starts with the prior rounds' picks as the inherited base. The loadout keeps acquisition
 * order (the weapon, then one ability per round), so round N starts with its first N picks and round 1
 * starts empty. Current-round picks are draft state and must never leak into the next selection screen
 * from a stale or replayed loadout event.
 */
export function loadoutForFreshRound(loadout, roundNumber) {
    const normalized = normalizedBotLoadout(loadout);
    const currentRound = normalizedRoundNumber(roundNumber);
    return normalizedBotLoadout({
        ...normalized,
        abilities: normalized.abilities.slice(0, currentRound <= 1 ? 0 : currentRound),
    });
}

/** Weapon ids the round-1 pick may use: the server's `timedRounds.weaponOffers`, else every weapon. */
export function offeredWeaponIds(weaponOffers) {
    if (!Array.isArray(weaponOffers) || weaponOffers.length === 0) return [...WEAPON_IDS];
    return weaponOffers.map(abilityIdFromBoundary).filter((id) => WEAPON_IDS.has(id));
}

export function toggleDraftAbility(loadout, roundNumber, abilityOffers, id, weaponOffers = null) {
    const draft = loadoutDraftState(loadout, roundNumber, abilityOffers);
    const normalizedId = abilityIdFromBoundary(id);
    if (!ABILITY_BY_ID.has(normalizedId)) return draft.normalized;

    if (WEAPON_IDS.has(normalizedId)) {
        // The weapon is chosen once, in round 1, and choosing another replaces it.
        if (!draft.draftRule.weaponPick || !offeredWeaponIds(weaponOffers).includes(normalizedId)) return draft.normalized;
        const withoutWeapons = draft.normalized.abilities.filter((abilityId) => !WEAPON_IDS.has(abilityId));
        return normalizedBotLoadout({
            ...draft.normalized,
            abilities: draft.draftedAbilityIds.has(normalizedId)
                ? withoutWeapons
                : [normalizedId, ...withoutWeapons],
        });
    }
    if (!draft.offeredAbilityIds.has(normalizedId)) return draft.normalized;

    const draftedPicks = draft.draftedAbilities.filter((abilityId) => !WEAPON_IDS.has(abilityId));
    const abilities = draft.draftedAbilityIds.has(normalizedId)
        ? draft.normalized.abilities.filter((abilityId) => abilityId !== normalizedId)
        : draftedPicks.length < draft.draftRule.picks
            ? [...draft.normalized.abilities, normalizedId]
            : draft.normalized.abilities;
    const nextLoadout = normalizedBotLoadout({ ...draft.normalized, abilities });
    return nextLoadout.abilities.length <= MAX_EQUIPPED_ABILITIES ? nextLoadout : draft.normalized;
}
