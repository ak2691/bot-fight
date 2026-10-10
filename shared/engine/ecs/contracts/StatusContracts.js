/** Generic, allowlisted status-effect component vocabulary. */
export const STATUS_EFFECT_APPLICATIONS = Object.freeze({
    DAMAGE: "damage",
    MOVEMENT_MODIFIER: "movement_modifier",
    INCOMING_DAMAGE_MODIFIER: "incoming_damage_modifier",
    DAMAGE_REFLECTION: "damage_reflection",
    DAMAGE_IMMUNITY: "damage_immunity",
    STUN: "stun",
    SILENCE: "silence",
    MOVEMENT_LOCK: "movement_lock",
    COOLDOWN_MODIFIER: "cooldown_modifier",
});

const PRESENCE_MODE = "presence";
const CONSTANT_MODE = "constant";
const TICK_MODE = "tick";

/**
 * Normalizes one internal or boundary status record into the one status shape (every field present, in
 * this order; `tickMs` and `tickElapsedMs` are 0 for a status that does not tick).
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
                mode: effect.mode === TICK_MODE ? TICK_MODE : CONSTANT_MODE,
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

export function statusRemainingMs(shape, type) {
    return statusEffectsFor(shape)
        .filter((status) => status.type === String(type ?? "").toLowerCase() && status.mode !== PRESENCE_MODE)
        .reduce((remaining, status) => Math.max(remaining, status.remainingMs), 0);
}

export function statusEffectValue(shape, statusType, application, field, fallback) {
    const status = statusEffectFor(shape, statusType);
    if (!status || !statusIsActive({ statusEffects: [status] }, status.type)) return fallback;
    const value = status.effects.find((effect) => effect.type === application)?.[field];
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Resolves all active incoming-damage modifiers at the point damage is
 * settled. Modifiers add together, and a modifier can exclude a structured
 * damage-source type without requiring a status-specific branch.
 */
export function incomingDamageFor(shape, source = null) {
    let damageModifier = 0;
    let truncateToTenths = false;
    for (const status of statusEffectsFor(shape)) {
        if (!statusIsActive({ statusEffects: [status] }, status.type)) continue;
        for (const effect of status.effects) {
            if (effect.type !== STATUS_EFFECT_APPLICATIONS.INCOMING_DAMAGE_MODIFIER
                || effect.mode !== CONSTANT_MODE
                || damageSourceIsExcluded(effect, source)) continue;
            const explicitModifier = Number(effect.damageModifier);
            if (Number.isFinite(explicitModifier)) {
                damageModifier += explicitModifier;
            } else {
                // Read older replay/status payloads that represented the
                // same value as a per-effect factor.
                const legacyMultiplier = Number(effect.multiplier);
                if (Number.isFinite(legacyMultiplier)) damageModifier += legacyMultiplier - 1;
            }
            if (effect.rounding === "truncate_tenths") truncateToTenths = true;
        }
    }
    return { damageModifier, truncateToTenths };
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
