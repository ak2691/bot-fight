import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";
import { MOVEMENT_CONFIG } from "./MovementConfig.js";
import { refundStamina } from "./StaminaSystem.js";

/** What the Time Since Hit variable reads for an ability that has never hit (the general number limit). */
export const NEVER_HIT_SECONDS = 99_999;
const MAX_HIT_AGE_MS = NEVER_HIT_SECONDS * 1000;

/**
 * Notes that `owner`'s ability landed on an enemy bot this tick. Several hits in one tick count once for
 * Time Since Hit. The note is settled into `abilityLastHitAgeMs` when the tick ends.
 *
 * The same hit earns the hit stamina refund, once per activation: `activationSerial` identifies the
 * activation that landed it (the owner's current one for a direct hit, the spawning one for an entity), so
 * multi-hit, piercing and damage-over-time effects pay out once. The refund is banked in
 * `pendingStaminaRefund` and added when the tick settles.
 */
export function recordAbilityHit(owner, abilityId, activationSerial = owner?.activationSerial ?? 0) {
    if (!owner || abilityId == null) return owner;
    let next = owner;
    const pending = next.abilityHitsThisTick ?? [];
    if (!pending.includes(abilityId)) next = { ...next, abilityHitsThisTick: [...pending, abilityId] };
    const refunded = next.refundedActivations ?? [];
    if (!refunded.includes(activationSerial)) {
        next = {
            ...next,
            refundedActivations: [...refunded, activationSerial],
            pendingStaminaRefund: (Number(next.pendingStaminaRefund) || 0) + MOVEMENT_CONFIG.hitStaminaRefund,
        };
    }
    return next;
}

/**
 * Ends a tick for the hit ledger: abilities that hit this tick start at one step
 * (so the next tick's logic reads 0.1 s), every older record ages by one step, and banked hit refunds
 * are paid into stamina (capped at max) without changing the regeneration pause.
 */
export function settleAbilityHits(shape, stepMs = AUTO_STEP_MS) {
    const refund = Number(shape?.pendingStaminaRefund) || 0;
    const refunded = refund > 0 ? { ...refundStamina(shape, refund), pendingStaminaRefund: 0 } : shape;
    const hits = refunded?.abilityHitsThisTick ?? [];
    const previous = refunded?.abilityLastHitAgeMs ?? {};
    if (hits.length === 0 && Object.keys(previous).length === 0) return refunded;
    const ages = Object.fromEntries(Object.entries(previous)
        .map(([id, ageMs]) => [id, Math.min(MAX_HIT_AGE_MS, Number(ageMs) + stepMs)]));
    for (const id of hits) ages[id] = stepMs;
    return { ...refunded, abilityLastHitAgeMs: ages, abilityHitsThisTick: [] };
}

/** Seconds since the bot's ability last hit an enemy bot; the never-hit sentinel when it has not. */
export function abilitySinceHitSeconds(bot, abilityId) {
    const ageMs = Number(bot?.abilityLastHitAgeMs?.[abilityId]);
    return Number.isFinite(ageMs) ? ageMs / 1000 : NEVER_HIT_SECONDS;
}
