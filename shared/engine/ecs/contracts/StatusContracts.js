import {
    MODIFIER_STACKING,
    MODIFIER_STATS,
    STATUS_EFFECT_APPLICATIONS,
} from "../../gameconfig/vocabulary.js";
export {
    STATUS_EFFECT_APPLICATIONS,
} from "../../gameconfig/vocabulary.js";

const PRESENCE_MODE = "presence";
const CONSTANT_MODE = "constant";

/**
 * Normalizes one internal or boundary status record into the one status shape (every field present, in
 * this order; `tickMs` and `tickElapsedMs` are 0 for a status that does not tick). `on` holds the status's
 * events with their resolved effects ({ schedule: { intervalMs, effects }, lifetimeEnd: { effects } }, or null)
 * and `snapshot` the fields a captures preset kept when applied (or null).
 */
export function normalizeStatusEffect(status) {
    if (!status || status.type == null) return null;
    const remainingMs = Math.max(0, Number(status.remainingMs ?? 0));
    const effects = Array.isArray(status.effects)
        ? status.effects
            .filter((effect) => effect?.type != null)
            .map((effect) => ({
                ...effect,
                type: String(effect.type).toLowerCase(),
                mode: CONSTANT_MODE,
            }))
        : [];
    return {
        type: String(status.type).toLowerCase(),
        abilityId: status.abilityId ?? null,
        mode: status.mode === PRESENCE_MODE ? PRESENCE_MODE : "duration",
        remainingMs,
        tickMs: Number(status.tickMs) > 0 ? Number(status.tickMs) : 0,
        tickElapsedMs: Number(status.tickElapsedMs) > 0 ? Number(status.tickElapsedMs) : 0,
        sourceSlot: status.sourceSlot ?? null,
        source: status.source ?? null,
        effects,
        on: status.on ?? null,
        snapshot: status.snapshot ?? null,
        ...(status.charges == null ? {} : { charges: Number(status.charges) }),
    };
}

export function statusEffectsFor(shape) {
    return (Array.isArray(shape?.statusEffects) ? shape.statusEffects : [])
        .map(normalizeStatusEffect)
        .filter(Boolean);
}

export function statusEffectFor(shape, type) {
    const normalizedType = String(type ?? "").toLowerCase();
    return statusEffectsFor(shape)
        .filter((status) => status.type === normalizedType)
        .sort((first, second) => Number(second.mode === PRESENCE_MODE) - Number(first.mode === PRESENCE_MODE)
            || second.remainingMs - first.remainingMs)[0] ?? null;
}

export function statusIsActive(shape, type) {
    const status = statusEffectFor(shape, type);
    return Boolean(status && (status.mode === PRESENCE_MODE || status.remainingMs > 0));
}

/** Every status of the shape that is active now, whatever its type (the same test as statusIsActive). */
function activeStatusEffects(shape) {
    return statusEffectsFor(shape).filter((status) => status.mode === PRESENCE_MODE || status.remainingMs > 0);
}

/** True when an active status has an effect of `type` that applies while it is active (mode constant). */
export function hasActiveEffect(shape, type) {
    return activeStatusEffects(shape).some((status) => status.effects
        .some((effect) => effect.type === type && effect.mode === CONSTANT_MODE));
}

/** The actions that the active `block` effects stop, as a Set (stun is not listed here; see isBlocked). */
export function blockedActions(shape) {
    const blocked = new Set();
    for (const status of activeStatusEffects(shape)) {
        for (const effect of status.effects) {
            if (effect.type !== STATUS_EFFECT_APPLICATIONS.BLOCK || !Array.isArray(effect.actions)) continue;
            for (const action of effect.actions) blocked.add(action);
        }
    }
    return blocked;
}

/** True when a stun, or an active block effect, stops `action` (an ability channel or a movement action). */
export function isBlocked(shape, action) {
    return hasActiveEffect(shape, STATUS_EFFECT_APPLICATIONS.STUN) || blockedActions(shape).has(action);
}

/** The numbers of one effect field, across every active status that has that effect of `type`. */
function activeEffectValues(shape, type, field) {
    return activeStatusEffects(shape).flatMap((status) => status.effects
        .filter((effect) => effect.type === type && effect.mode === CONSTANT_MODE)
        .map((effect) => Number(effect[field]))
        .filter((value) => Number.isFinite(value)));
}

/** The largest value of an effect field over the active statuses (`fallback` when none has the effect). */
export function largestActiveEffectValue(shape, type, field, fallback) {
    const values = activeEffectValues(shape, type, field);
    return values.length > 0 ? Math.max(...values) : fallback;
}

export function statusRemainingMs(shape, type) {
    return statusEffectsFor(shape)
        .filter((status) => status.type === String(type ?? "").toLowerCase() && status.mode !== PRESENCE_MODE)
        .reduce((remaining, status) => Math.max(remaining, status.remainingMs), 0);
}

/**
 * The combined `stat` modifier of the active statuses, as { multiply, truncateToTenths }. Each modifier's
 * `multiply` combines by MODIFIER_STACKING (the product, or the strongest = smallest). An incomingDamage modifier
 * can exclude a structured damage-source type, and `truncateToTenths` is set when a counted modifier rounds.
 * With no modifier the result is { multiply: 1, truncateToTenths: false }.
 */
export function modifierFor(shape, stat, source = null) {
    const multiplies = [];
    let truncateToTenths = false;
    for (const status of activeStatusEffects(shape)) {
        for (const effect of status.effects) {
            if (effect.type !== STATUS_EFFECT_APPLICATIONS.MODIFIER
                || effect.mode !== CONSTANT_MODE
                || effect.stat !== stat) continue;
            if (stat === MODIFIER_STATS.INCOMING_DAMAGE && damageSourceIsExcluded(effect, source)) continue;
            const multiply = Number(effect.multiply);
            if (!Number.isFinite(multiply)) continue;
            multiplies.push(multiply);
            if (effect.rounding === "truncate_tenths") truncateToTenths = true;
        }
    }
    if (multiplies.length === 0) return { multiply: 1, truncateToTenths: false };
    const multiply = MODIFIER_STACKING[stat] === "strongest"
        ? Math.min(...multiplies)
        : multiplies.reduce((product, value) => product * value, 1);
    return { multiply, truncateToTenths };
}

/** A bot's (or entity's) outgoing damage factor: its attack damage multiplier times its outgoingDamage modifiers. */
export function outgoingDamageMultiplier(shape) {
    return Number(shape?.attackDamageMultiplier ?? 1) * modifierFor(shape, MODIFIER_STATS.OUTGOING_DAMAGE).multiply;
}

/**
 * Drops the presence statuses of a bot or entity in place (they are re-applied each tick by whatever the
 * target stands in). The status list is replaced only when it holds one.
 */
export function clearPresenceStatuses(shape) {
    const statuses = Array.isArray(shape.statusEffects) ? shape.statusEffects : [];
    if (statuses.some((status) => status?.mode === PRESENCE_MODE)) {
        shape.statusEffects = statusEffectsFor(shape).filter((status) => status.mode !== PRESENCE_MODE);
    }
    return shape;
}

function damageSourceIsExcluded(effect, source) {
    if (source?.damageSourceKind !== "status") return false;
    const sourceType = String(source.damageSourceType ?? "").toLowerCase();
    return (Array.isArray(effect.excludedDamageSourceTypes) ? effect.excludedDamageSourceTypes : [])
        .some((type) => String(type).toLowerCase() === sourceType);
}
