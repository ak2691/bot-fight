import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";

/** What the Time Since Hit variable reads for an ability that has never hit (the general number limit). */
export const NEVER_HIT_SECONDS = 99_999;
const MAX_HIT_AGE_MS = NEVER_HIT_SECONDS * 1000;

/**
 * Notes that `owner`'s ability landed on an enemy bot this tick. Several hits in
 * one tick count once. The note is settled into `abilityLastHitAgeMs` when the tick ends.
 */
export function recordAbilityHit(owner, abilityId) {
    if (!owner || abilityId == null) return owner;
    const pending = owner.abilityHitsThisTick ?? [];
    return pending.includes(abilityId) ? owner : { ...owner, abilityHitsThisTick: [...pending, abilityId] };
}

/**
 * Ends a tick for the hit ledger: abilities that hit this tick start at one step
 * (so the next tick's logic reads 0.1 s) and every older record ages by one step.
 */
export function settleAbilityHits(shape, stepMs = AUTO_STEP_MS) {
    const hits = shape?.abilityHitsThisTick ?? [];
    const previous = shape?.abilityLastHitAgeMs ?? {};
    if (hits.length === 0 && Object.keys(previous).length === 0) return shape;
    const ages = Object.fromEntries(Object.entries(previous)
        .map(([id, ageMs]) => [id, Math.min(MAX_HIT_AGE_MS, Number(ageMs) + stepMs)]));
    for (const id of hits) ages[id] = stepMs;
    return { ...shape, abilityLastHitAgeMs: ages, abilityHitsThisTick: [] };
}

/** Seconds since the bot's ability last hit an enemy bot; the never-hit sentinel when it has not. */
export function abilitySinceHitSeconds(bot, abilityId) {
    const ageMs = Number(bot?.abilityLastHitAgeMs?.[abilityId]);
    return Number.isFinite(ageMs) ? ageMs / 1000 : NEVER_HIT_SECONDS;
}
