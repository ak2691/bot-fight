import { abilityMaxChargesForShape, abilityTiming } from "./Abilities.js";
import { modifierFor } from "../ecs/contracts/StatusContracts.js";
import { MODIFIER_STATS } from "./vocabulary.js";
import { abilityChannel } from "./AbilityChannels.js";
import {
    ABILITY_STAGES,
    abilityIdsInStage,
    abilityRecord,
    activeRemainingMs,
    channelBusy,
    cooldownRemainingMs,
    endActiveStage,
    markCastsInterrupted,
    patchAbilityRecord,
    pendingCooldownMs,
    readyAbilityRecord,
} from "./AbilityState.js";
import { staminaWaitMs } from "./StaminaSystem.js";

const RELOAD_RESOURCE = "reload";

/** The starting records for a bot's abilities: ready, with full charges for the charge-bearing ones. */
export function initialAbilityState(abilities, maxHp = null) {
    return Object.fromEntries((abilities ?? []).map((id) => {
        const maxCharges = positiveInteger(abilityMaxChargesForShape(id, { maxHp }));
        return [id, maxCharges == null
            ? { stage: ABILITY_STAGES.READY, remainingMs: 0 }
            : { stage: ABILITY_STAGES.READY, remainingMs: 0, charges: maxCharges, reloadMs: 0 }];
    }));
}

/** Returns the canonical resource payload for one ability. */
export function abilityResourceFor(shape, abilityId, stats = abilityTiming(abilityId)) {
    const maxCharges = positiveInteger(abilityMaxChargesForShape(abilityId, shape));
    if (maxCharges == null) {
        return { abilityId, stats, maxCharges: null, charges: null, rechargeMs: 0 };
    }
    const record = abilityRecord(shape, abilityId);
    const charges = clampInteger(record?.charges == null ? maxCharges : record.charges, 0, maxCharges);
    return {
        abilityId,
        stats,
        maxCharges,
        charges,
        rechargeMs: positiveNumber(record?.reloadMs),
    };
}

/** Returns the charge count from the ability record, or null for uncharged abilities. */
export function abilityChargeCount(shape, abilityId) {
    const maxCharges = positiveInteger(abilityMaxChargesForShape(abilityId, shape));
    if (maxCharges == null) return null;
    const rawCharges = abilityRecord(shape, abilityId)?.charges;
    return rawCharges == null ? null : clampInteger(rawCharges, 0, maxCharges);
}

/** Returns the generic conditional charge value for any charge-bearing ability. */
export function abilityChargesFor(shape, abilityId) {
    return abilityChargeCount(shape, abilityId) ?? 0;
}

/** Returns recharge/reload time in the single remaining-time form used by callers. */
export function abilityRechargeRemainingMs(shape, abilityId) {
    const resource = abilityResourceFor(shape, abilityId);
    if (resource.maxCharges == null || resource.charges >= resource.maxCharges) return 0;
    if (resource.stats.resourceModel === RELOAD_RESOURCE && resource.charges === 0) {
        return resource.rechargeMs > 0 ? resource.rechargeMs : resourceDurationMs(resource.stats);
    }
    return 0;
}

/** Checks whether an ability's resource can be spent within the current simulation step. */
export function abilityResourceReady(shape, abilityId, readinessMs = 0) {
    const resource = abilityResourceFor(shape, abilityId);
    return resource.maxCharges == null
        || (resource.charges > 0 && abilityRechargeRemainingMs(shape, abilityId) <= Math.max(0, Number(readinessMs) || 0));
}

/**
 * Generic wait before an ability can start again: the longest of its cooldown, its reload and the time to
 * afford its stamina cost. It does not include a running wind-up or active stage; callers that show a readout
 * report 0 for those, as the ability is not recovering yet.
 */
export function abilityReadyInMs(shape, abilityId) {
    return Math.max(
        cooldownRemainingMs(shape, abilityId),
        abilityRechargeRemainingMs(shape, abilityId),
        staminaWaitMs(shape, abilityId),
    );
}

/**
 * Checks the two-phase ability timer at the end of the current fixed step.
 *
 * The visible cooldown is the post-active recovery timer. While an ability is
 * active, its reserved recovery waits in the record's `cooldownMs`; only any
 * time left in the step after the active window expires may consume recovery.
 * The stages are mutually exclusive for conditions, UI, replay, and execution.
 */
export function abilityTimingReady(shape, abilityId, elapsedMs = 100) {
    const elapsed = positiveNumber(elapsedMs);
    const activeMs = activeRemainingMs(shape, abilityId);
    const cooldownMs = cooldownRemainingMs(shape, abilityId);
    const recoveryWindow = Math.max(0, elapsed - Math.min(elapsed, activeMs));
    return activeMs <= elapsed
        && cooldownMs <= recoveryWindow;
}

/**
 * Stores a cooldown in the stage where it will actually run. While the ability is active the cooldown stays
 * reserved on the active record and starts when the active stage reaches zero.
 */
export function setAbilityCooldownState(shape, abilityId, cooldownMs) {
    const requested = positiveNumber(cooldownMs);
    const record = abilityRecord(shape, abilityId);
    if (record?.stage === ABILITY_STAGES.ACTIVE) {
        const pending = Math.max(pendingCooldownMs(shape, abilityId), requested);
        return patchAbilityRecord(shape, abilityId, { cooldownMs: pending > 0 ? pending : undefined });
    }
    const cooldown = Math.max(cooldownRemainingMs(shape, abilityId), requested);
    return patchAbilityRecord(shape, abilityId, {
        stage: cooldown > 0 ? ABILITY_STAGES.COOLDOWN : ABILITY_STAGES.READY,
        remainingMs: cooldown,
        cooldownMs: undefined,
        target: undefined,
    });
}

/**
 * Starts an ability's active stage. A cooldown still running (or reserved) is carried over to the end of
 * the active stage; an ability with no active time goes straight to its cooldown.
 */
export function startAbilityActive(shape, abilityId, activeMs) {
    const carried = Math.max(cooldownRemainingMs(shape, abilityId), pendingCooldownMs(shape, abilityId));
    const active = positiveNumber(activeMs);
    if (active > 0) {
        return patchAbilityRecord(shape, abilityId, {
            stage: ABILITY_STAGES.ACTIVE,
            remainingMs: active,
            cooldownMs: carried > 0 ? carried : undefined,
            target: undefined,
        });
    }
    return patchAbilityRecord(shape, abilityId, {
        stage: carried > 0 ? ABILITY_STAGES.COOLDOWN : ABILITY_STAGES.READY,
        remainingMs: carried,
        cooldownMs: undefined,
        target: undefined,
    });
}

/**
 * Interrupts every bot-owned ability stage that is currently preparing or
 * active. Ability entities are deliberately not touched: once an entity has
 * been spawned, its own contract owns its remaining lifetime.
 */
export function interruptCurrentAbility(shape, options = {}) {
    if (!shape || (shape.hp != null && Number(shape.hp) <= 0)) return shape;
    const ids = new Set([
        ...abilityIdsInStage(shape, ABILITY_STAGES.WINDUP),
        ...abilityIdsInStage(shape, ABILITY_STAGES.ACTIVE),
    ]);
    let next = shape;
    for (const abilityId of ids) next = interruptAbility(next, abilityId, options);
    return markCastsInterrupted(next);
}

/**
 * Cancels one ability stage and starts the relevant recovery gate without
 * firing its activation effects. Reloading resources remain on reload rather
 * than also receiving a cooldown, so the two resource gates cannot overlap.
 */
export function interruptAbility(shape, abilityId, { cooldownMultiplier = null } = {}) {
    const id = Number(abilityId);
    if (!shape || !Number.isFinite(id)) return shape;

    const stage = abilityRecord(shape, id)?.stage;
    const preparing = stage === ABILITY_STAGES.WINDUP && positiveNumber(abilityRecord(shape, id).remainingMs) > 0;
    const active = activeRemainingMs(shape, id) > 0;
    if (!preparing && !active) return shape;

    const stats = abilityTiming(id);
    const multiplier = positiveMultiplier(cooldownMultiplier == null
        ? 1 / Number(shape.attackSpeedMultiplier ?? 1)
        : cooldownMultiplier);
    let next = preparing ? readyAbilityRecord(shape, id) : endActiveStage(shape, id);

    let reloadActive = isReloadingResource(next, id, stats);
    if (preparing && !reloadActive
        && abilityMaxChargesForShape(id, next) != null
        && abilityChargesFor(next, id) > 0) {
        const consumed = consumeAbilityCharges(next, id, 1, {
            elapsedMs: 0,
            cooldownMultiplier: multiplier,
        });
        if (consumed.consumed) {
            next = consumed.shape;
            reloadActive = isReloadingResource(next, id, stats);
        }
    }

    if (reloadActive) {
        next = readyAbilityRecord(next, id);
    } else {
        const configuredCooldownMs = Math.round(
            Number(stats.cooldownMs ?? stats.reuseCooldownMs ?? 1000)
            * multiplier * cooldownStartMultiplier(next),
        );
        next = setAbilityCooldownState(next, id, configuredCooldownMs);
    }

    // An interrupted ability stops the move it started (a dash, or a lunge); a move another ability started keeps going.
    if (active && Number(shape.moveAbilityId) === id) {
        next.moveAbilityId = null;
        next.dashRemaining = 0;
        next.movementVelocityX = 0;
        next.movementVelocityY = 0;
        next.velocityX = 0;
        next.velocityY = 0;
    }
    return next;
}

function isReloadingResource(shape, abilityId, stats) {
    const resource = abilityResourceFor(shape, abilityId, stats);
    return stats.resourceModel === RELOAD_RESOURCE
        && resource.charges === 0
        && resource.rechargeMs > 0;
}

/** Returns true when another ability of the same channel is winding up or active. */
export function anotherAbilityActive(shape, abilityId) {
    return channelBusy(shape, abilityChannel(abilityId), abilityId);
}

/**
 * Advances one ability resource. The payload carries metadata and the current
 * canonical resource values; no ability id is special-cased here.
 */
export function rechargeAbility(resource, elapsedMs) {
    const maxCharges = resource?.maxCharges;
    if (maxCharges == null) return { ...resource, charges: null, rechargeMs: 0 };

    const charges = clampInteger(resource.charges, 0, maxCharges);
    const rechargeMs = positiveNumber(resource.rechargeMs);
    const elapsed = positiveNumber(elapsedMs);
    const durationMs = resourceDurationMs(resource.stats);

    if (charges >= maxCharges) return { ...resource, charges: maxCharges, rechargeMs: 0 };
    if (resource.stats?.resourceModel === RELOAD_RESOURCE && charges === 0 && durationMs > 0) {
        const remainingMs = Math.max(0, (rechargeMs > 0 ? rechargeMs : durationMs) - elapsed);
        return remainingMs <= 0
            ? { ...resource, charges: maxCharges, rechargeMs: 0 }
            : { ...resource, charges: 0, rechargeMs: remainingMs };
    }
    return { ...resource, charges, rechargeMs: 0 };
}

/** Consumes one generic ability resource, starting a reload only when empty. */
export function consumeAbilityCharges(shape, abilityId, amount = 1, { elapsedMs = 0, cooldownMultiplier = 1 } = {}) {
    const resource = abilityResourceFor(shape, abilityId);
    if (resource.maxCharges == null) return { shape, consumed: true };
    const spend = Math.max(0, Math.round(Number(amount) || 0));
    if (spend <= 0) return { shape, consumed: true };
    if (resource.charges <= 0) return { shape, consumed: false };

    const charges = Math.max(0, resource.charges - spend);
    let nextRechargeMs = resource.rechargeMs;
    if (charges >= resource.maxCharges) nextRechargeMs = 0;
    if (charges === 0 && resource.stats.resourceModel === RELOAD_RESOURCE) {
        const currentStepOffset = activeRemainingMs(shape, abilityId) > 0 ? 0 : positiveNumber(elapsedMs);
        // Snapshot Overclock when the reload starts; the timer ticks normally afterward.
        nextRechargeMs = Math.max(0, Math.round(resourceDurationMs(resource.stats)
            * positiveMultiplier(cooldownMultiplier) * cooldownStartMultiplier(shape) + currentStepOffset));
    }
    const startsRecharge = charges === 0 && resource.stats.resourceModel === RELOAD_RESOURCE;
    let next = patchAbilityRecord(shape, abilityId, { charges, reloadMs: nextRechargeMs });
    // A charged ability has exactly one post-active gate: the short between-charge cooldown while charges
    // remain, or the reload timer after the final charge. Never leave both gates armed together.
    if (startsRecharge) {
        next = abilityRecord(next, abilityId)?.stage === ABILITY_STAGES.ACTIVE
            ? patchAbilityRecord(next, abilityId, { cooldownMs: undefined })
            : readyAbilityRecord(next, abilityId);
    }
    return { shape: next, consumed: true };
}

function resourceDurationMs(stats = {}) {
    return positiveNumber(stats.rechargeMs ?? stats.reloadMs);
}

function positiveMultiplier(value) {
    const multiplier = Number(value);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

/** The cooldown multiplier of new cooldowns and reloads: the strongest cooldown modifier of the active statuses. */
export function cooldownStartMultiplier(shape) {
    return modifierFor(shape, MODIFIER_STATS.COOLDOWN).multiply;
}

function positiveInteger(value) {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function clampInteger(value, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : min));
}

function positiveNumber(value) {
    return Math.max(0, Number(value) || 0);
}
