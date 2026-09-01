import { ABILITY_STATS, abilityMaxChargesForShape } from "./Abilities.js";
import { abilityContract } from "./AbilityContracts.js";
import { statusEffectValue, statusIsActive, STATUS_EFFECT_APPLICATIONS } from "../ecs/contracts/StatusContracts.js";

const REGENERATE_RESOURCE = "regenerate";
const RELOAD_RESOURCE = "reload";
const FIXED_RESOURCE = "fixed";
const HP_RESOURCE = "hp";

/** Returns the canonical resource payload for one ability. */
export function abilityResourceFor(shape, abilityId, stats = ABILITY_STATS[abilityId] ?? {}) {
    const maxCharges = positiveInteger(abilityMaxChargesForShape(abilityId, shape));
    if (maxCharges == null) {
        return { abilityId, stats, maxCharges: null, charges: null, rechargeMs: 0 };
    }
    const rawCharges = shape?.abilityCharges?.[abilityId];
    const charges = clampInteger(rawCharges == null
        ? (stats.resourceModel === FIXED_RESOURCE ? 0 : maxCharges)
        : rawCharges, 0, maxCharges);
    return {
        abilityId,
        stats,
        maxCharges,
        charges,
        rechargeMs: positiveNumber(shape?.abilityRechargeMs?.[abilityId]),
    };
}

/** Returns the charge count from the canonical resource map, or null for uncharged abilities. */
export function abilityChargeCount(shape, abilityId) {
    const maxCharges = positiveInteger(abilityMaxChargesForShape(abilityId, shape));
    if (maxCharges == null) return null;
    const rawCharges = shape?.abilityCharges?.[abilityId];
    return rawCharges == null ? null : clampInteger(rawCharges, 0, maxCharges);
}

/** Returns the configured maximum for a charge-bearing ability. */
export function abilityMaxCharges(abilityId, shape = null) {
    return positiveInteger(abilityMaxChargesForShape(abilityId, shape));
}

/** Returns the generic conditional charge value for any charge-bearing ability. */
export function abilityChargesFor(shape, abilityId) {
    return abilityChargeCount(shape, abilityId) ?? 0;
}

/** Returns recharge/reload time in the single remaining-time form used by callers. */
export function abilityRechargeRemainingMs(shape, abilityId) {
    const resource = abilityResourceFor(shape, abilityId);
    if (resource.maxCharges == null || resource.charges >= resource.maxCharges) return 0;
    if (resource.stats.resourceModel === HP_RESOURCE) return 0;
    const durationMs = resourceDurationMs(resource.stats);
    if (resource.stats.resourceModel === REGENERATE_RESOURCE) {
        return Math.max(0, durationMs - resource.rechargeMs);
    }
    if (resource.stats.resourceModel === RELOAD_RESOURCE && resource.charges === 0) {
        return resource.rechargeMs > 0 ? resource.rechargeMs : durationMs;
    }
    return 0;
}

/** Checks whether an ability's resource can be spent within the current simulation step. */
export function abilityResourceReady(shape, abilityId, readinessMs = 0) {
    const resource = abilityResourceFor(shape, abilityId);
    const fixedInactive = resource.stats.resourceModel === FIXED_RESOURCE
        && Number(shape?.abilityActiveMs?.[abilityId] ?? 0) <= Math.max(0, Number(readinessMs) || 0);
    return resource.maxCharges == null
        || fixedInactive
        || (resource.charges > 0 && abilityRechargeRemainingMs(shape, abilityId) <= Math.max(0, Number(readinessMs) || 0));
}

/**
 * Checks the two-phase ability timer at the end of the current fixed step.
 *
 * `abilityCooldowns` is the visible post-active recovery timer. While an
 * ability is active, its reserved recovery lives in
 * `abilityPendingCooldownMs`; only any time left in the step after the active
 * window expires may consume recovery. This keeps the phase values mutually
 * exclusive for conditions, UI, replay, and execution.
 */
export function abilityTimingReady(shape, abilityId, elapsedMs = 100) {
    const elapsed = positiveNumber(elapsedMs);
    const activeMs = positiveNumber(shape?.abilityActiveMs?.[abilityId]);
    const cooldownMs = positiveNumber(shape?.abilityCooldowns?.[abilityId]);
    const recoveryWindow = Math.max(0, elapsed - Math.min(elapsed, activeMs));
    return activeMs <= elapsed
        && cooldownMs <= recoveryWindow;
}

/**
 * Stores a cooldown in the phase where it will actually run. Active time is
 * consumed first, so a cooldown created by an activation remains pending until
 * the active phase reaches zero.
 */
export function setAbilityCooldownState(shape, abilityId, cooldownMs) {
    const cooldowns = { ...(shape?.abilityCooldowns ?? {}) };
    const pendingCooldowns = { ...(shape?.abilityPendingCooldownMs ?? {}) };
    const requested = positiveNumber(cooldownMs);
    const current = Math.max(
        positiveNumber(cooldowns[abilityId]),
        positiveNumber(pendingCooldowns[abilityId]),
    );
    const active = positiveNumber(shape?.abilityActiveMs?.[abilityId]);
    if (active > 0) {
        cooldowns[abilityId] = 0;
        const pending = Math.max(current, requested);
        if (pending > 0) pendingCooldowns[abilityId] = pending;
        else delete pendingCooldowns[abilityId];
    } else {
        cooldowns[abilityId] = Math.max(current, requested);
        delete pendingCooldowns[abilityId];
    }
    return { ...shape, abilityCooldowns: cooldowns, abilityPendingCooldownMs: pendingCooldowns };
}

/**
 * Interrupts every bot-owned ability phase that is currently preparing or
 * active. Ability entities are deliberately not touched: once an entity has
 * been spawned, its own contract owns its remaining lifetime.
 */
export function interruptCurrentAbility(shape, options = {}) {
    if (!shape || (shape.hp != null && Number(shape.hp) <= 0)) return shape;
    const ids = new Set();
    const preparingAbilityId = shape.preparingAbility == null ? null : Number(shape.preparingAbility);
    if (Number.isFinite(preparingAbilityId) && positiveNumber(shape.preparingMs) > 0) {
        ids.add(preparingAbilityId);
    }
    for (const [abilityId, activeMs] of Object.entries(shape.abilityActiveMs ?? {})) {
        if (positiveNumber(activeMs) > 0) ids.add(Number(abilityId));
    }

    let next = shape;
    for (const abilityId of ids) next = interruptAbility(next, abilityId, options);
    if (next.preparingAbility != null || positiveNumber(next.preparingMs) > 0
        || next.preparingTargetX != null || next.preparingTargetY != null) {
        next = {
            ...next,
            preparingAbility: null,
            preparingMs: 0,
            preparingTargetX: null,
            preparingTargetY: null,
        };
    }
    return next;
}

/**
 * Cancels one ability phase and starts the relevant recovery gate without
 * firing its activation effects. Reloading resources remain on reload rather
 * than also receiving a cooldown, so the two resource gates cannot overlap.
 */
export function interruptAbility(shape, abilityId, { cooldownMultiplier = null } = {}) {
    const id = Number(abilityId);
    if (!shape || !Number.isFinite(id)) return shape;

    const preparing = Number(shape.preparingAbility) === id
        && positiveNumber(shape.preparingMs) > 0;
    const active = positiveNumber(shape.abilityActiveMs?.[id]) > 0;
    if (!preparing && !active) return shape;

    const stats = ABILITY_STATS[id] ?? {};
    const multiplier = positiveMultiplier(cooldownMultiplier == null
        ? 1 / Number(shape.attackSpeedMultiplier ?? 1)
        : cooldownMultiplier);
    let next = preparing
        ? {
            ...shape,
            preparingAbility: null,
            preparingMs: 0,
            preparingTargetX: null,
            preparingTargetY: null,
        }
        : shape;

    if (active) {
        next = {
            ...next,
            abilityActiveMs: { ...(next.abilityActiveMs ?? {}), [id]: 0 },
        };
    }

    let reloadActive = isReloadingResource(next, id, stats);
    if (preparing && !reloadActive
        && abilityMaxChargesForShape(id, next) != null
        && abilityChargesFor(next, id) > 0
        && ![FIXED_RESOURCE, HP_RESOURCE].includes(stats.resourceModel)) {
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
        const cooldowns = { ...(next.abilityCooldowns ?? {}), [id]: 0 };
        const pendingCooldowns = { ...(next.abilityPendingCooldownMs ?? {}) };
        delete pendingCooldowns[id];
        next = { ...next, abilityCooldowns: cooldowns, abilityPendingCooldownMs: pendingCooldowns };
    } else {
        const configuredCooldownMs = Math.round(
            Number(stats.cooldownMs ?? stats.reuseCooldownMs ?? 1000)
            * multiplier * cooldownStartMultiplier(next),
        );
        next = setAbilityCooldownState(next, id, configuredCooldownMs);
    }

    if (active && abilityContract(id)?.execution?.movement) {
        next = {
            ...next,
            dashActiveMs: 0,
            dashRemaining: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        };
    }
    return next;
}

function isReloadingResource(shape, abilityId, stats) {
    const resource = abilityResourceFor(shape, abilityId, stats);
    return stats.resourceModel === RELOAD_RESOURCE
        && resource.charges === 0
        && resource.rechargeMs > 0;
}

/** Returns true when a different non-bypass ability is active or still preparing. */
export function anotherAbilityActive(shape, abilityId, ignoresGlobalAbilityLock = abilityIgnoresGlobalLock(abilityId)) {
    if (ignoresGlobalAbilityLock) return false;
    const candidateAbilityId = Number(abilityId);
    const preparingAbilityId = shape?.preparingAbility == null ? null : Number(shape.preparingAbility);
    if (Number.isFinite(preparingAbilityId)
        && preparingAbilityId !== candidateAbilityId
        && !abilityIgnoresGlobalLock(preparingAbilityId)) return true;
    return Object.entries(shape?.abilityActiveMs ?? {})
        .some(([activeAbilityId, value]) => Number(activeAbilityId) !== candidateAbilityId
            && !abilityIgnoresGlobalLock(Number(activeAbilityId))
            && positiveNumber(value) > 0);
}

export function abilityIgnoresGlobalLock(abilityId) {
    return Boolean(abilityContract(abilityId)?.execution?.ignoresGlobalAbilityLock);
}

/** Advances every equipped charge-bearing ability through the same resource state machine. */
export function rechargeAbilityResources(shape, elapsedMs, activeValues = shape?.abilityActiveMs) {
    const elapsed = positiveNumber(elapsedMs);
    const charges = { ...(shape?.abilityCharges ?? {}) };
    const rechargeMs = { ...(shape?.abilityRechargeMs ?? {}) };
    const abilityIds = new Set([
        ...(Array.isArray(shape?.abilities) ? shape.abilities : []),
        ...Object.keys(charges).map(Number),
        ...Object.keys(rechargeMs).map(Number),
    ]);

    for (const abilityId of abilityIds) {
        const stats = ABILITY_STATS[abilityId];
        if (stats?.maxCharges == null) {
            delete charges[abilityId];
            delete rechargeMs[abilityId];
            continue;
        }
        if (stats.resourceModel === FIXED_RESOURCE
            && Number(shape?.abilityActiveMs?.[abilityId] ?? 0) <= 0) {
            delete charges[abilityId];
            delete rechargeMs[abilityId];
            continue;
        }
        const activeBefore = positiveNumber(activeValues?.[abilityId]);
        const recoveryElapsed = Math.max(0, elapsed - Math.min(elapsed, activeBefore));
        const resource = rechargeAbility({
            ...abilityResourceFor({
                maxHp: shape?.maxHp ?? shape?.health?.max,
                abilityCharges: charges,
                abilityRechargeMs: rechargeMs,
            }, abilityId, stats),
            stats,
            active: Number(shape?.abilityActiveMs?.[abilityId] ?? 0) > 0,
        }, recoveryElapsed);
        charges[abilityId] = resource.charges;
        rechargeMs[abilityId] = resource.rechargeMs;
    }
    return { charges, rechargeMs };
}

/**
 * Advances one ability resource. The payload carries metadata and the current
 * canonical resource values; no ability id is special-cased here.
 */
export function rechargeAbility(resource, elapsedMs) {
    const maxCharges = resource?.maxCharges;
    if (maxCharges == null) return { ...resource, charges: null, rechargeMs: 0 };

    let charges = clampInteger(resource.charges, 0, maxCharges);
    let rechargeMs = positiveNumber(resource.rechargeMs);
    const elapsed = positiveNumber(elapsedMs);
    const durationMs = resourceDurationMs(resource.stats);

    if (resource.stats?.resourceModel === FIXED_RESOURCE) {
        return resource.active === false
            ? { ...resource, charges: 0, rechargeMs: 0 }
            : { ...resource, charges, rechargeMs: 0 };
    }
    if (resource.stats?.resourceModel === HP_RESOURCE) {
        if (resource.active === false && durationMs <= 0) {
            const rate = positiveNumber(resource.stats.chargeRegenHpPerSecond);
            if (rate > 0) {
                rechargeMs += rate * elapsed;
                const gained = Math.floor(rechargeMs / 1000);
                charges = Math.min(maxCharges, charges + gained);
                rechargeMs = charges >= maxCharges ? 0 : rechargeMs % 1000;
            }
        }
        return { ...resource, charges, rechargeMs };
    }
    if (charges >= maxCharges) return { ...resource, charges: maxCharges, rechargeMs: 0 };
    if (resource.stats?.resourceModel === REGENERATE_RESOURCE && durationMs > 0) {
        rechargeMs += elapsed;
        while (charges < maxCharges && rechargeMs >= durationMs) {
            charges += 1;
            rechargeMs -= durationMs;
        }
        return { ...resource, charges, rechargeMs: charges >= maxCharges ? 0 : rechargeMs };
    }
    if (resource.stats?.resourceModel === RELOAD_RESOURCE && charges === 0 && durationMs > 0) {
        const remainingMs = Math.max(0, (rechargeMs > 0 ? rechargeMs : durationMs) - elapsed);
        return remainingMs <= 0
            ? { ...resource, charges: maxCharges, rechargeMs: 0 }
            : { ...resource, charges: 0, rechargeMs: remainingMs };
    }
    return { ...resource, charges, rechargeMs: 0 };
}

/** Consumes one generic ability resource, starting a reload only when empty. */
export function consumeAbilityCharges(shape, abilityId, amount = 1, { elapsedMs = 0, cooldownMultiplier = 1, activation = false } = {}) {
    const resource = abilityResourceFor(shape, abilityId);
    if (resource.maxCharges == null) return { shape, consumed: true };
    if (activation && resource.stats.resourceModel === FIXED_RESOURCE) {
        return {
            shape: {
                ...shape,
                abilityCharges: { ...(shape?.abilityCharges ?? {}), [abilityId]: resource.maxCharges },
                abilityRechargeMs: { ...(shape?.abilityRechargeMs ?? {}), [abilityId]: 0 },
            },
            consumed: true,
        };
    }
    if (activation && resource.stats.resourceModel === HP_RESOURCE) {
        return { shape, consumed: resource.charges > 0 };
    }
    const spend = Math.max(0, Math.round(Number(amount) || 0));
    if (spend <= 0) return { shape, consumed: true };
    if (resource.charges <= 0) return { shape, consumed: false };

    const charges = Math.max(0, resource.charges - spend);
    let nextRechargeMs = resource.rechargeMs;
    if (charges >= resource.maxCharges) nextRechargeMs = 0;
    if (charges === 0 && resource.stats.resourceModel === RELOAD_RESOURCE) {
        const activeRemaining = positiveNumber(shape?.abilityActiveMs?.[abilityId]);
        const currentStepOffset = activeRemaining > 0 ? 0 : positiveNumber(elapsedMs);
        // Snapshot Overclock when the reload starts; the timer ticks normally afterward.
        nextRechargeMs = Math.max(0, Math.round(resourceDurationMs(resource.stats)
            * positiveMultiplier(cooldownMultiplier) * cooldownStartMultiplier(shape) + currentStepOffset));
    }
    const startsRecharge = charges === 0
        && (resource.stats.resourceModel === RELOAD_RESOURCE
            || resource.stats.resourceModel === REGENERATE_RESOURCE);
    const nextCharges = { ...(shape?.abilityCharges ?? {}) };
    const nextRecharge = { ...(shape?.abilityRechargeMs ?? {}) };
    const nextCooldowns = { ...(shape?.abilityCooldowns ?? {}) };
    const nextPendingCooldowns = { ...(shape?.abilityPendingCooldownMs ?? {}) };
    nextCharges[abilityId] = charges;
    nextRecharge[abilityId] = nextRechargeMs;
    // A charged ability has exactly one post-active gate: the short
    // between-charge cooldown while charges remain, or the reload/recharge
    // timer after the final charge. Never leave both gates armed together.
    if (startsRecharge) {
        nextCooldowns[abilityId] = 0;
        delete nextPendingCooldowns[abilityId];
    }
    if (resource.stats.resourceModel === FIXED_RESOURCE && charges === 0) {
        delete nextCharges[abilityId];
        delete nextRecharge[abilityId];
    }
    return {
        shape: {
            ...shape,
            abilityCharges: nextCharges,
            abilityRechargeMs: nextRecharge,
            abilityPendingCooldownMs: nextPendingCooldowns,
            ...(startsRecharge || shape?.abilityCooldowns != null
                ? { abilityCooldowns: nextCooldowns }
                : {}),
        },
        consumed: true,
    };
}

function resourceDurationMs(stats = {}) {
    return positiveNumber(stats.rechargeMs ?? stats.reloadMs);
}

function positiveMultiplier(value) {
    const multiplier = Number(value);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function cooldownStartMultiplier(shape) {
    return statusIsActive(shape, "overclock")
        ? Math.min(1, Math.max(0, statusEffectValue(
            shape,
            "overclock",
            STATUS_EFFECT_APPLICATIONS.COOLDOWN_MODIFIER,
            "multiplier",
            1,
        )))
        : 1;
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
