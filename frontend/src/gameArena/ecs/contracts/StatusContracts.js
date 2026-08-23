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

/** Normalizes one internal or boundary status record into the generic shape. */
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
        ...status,
        type: String(status.type).toLowerCase(),
        mode: status.mode === PRESENCE_MODE ? PRESENCE_MODE : "duration",
        remainingMs,
        ...(Number(status.tickMs) > 0 ? { tickMs: Number(status.tickMs) } : {}),
        ...(Number(status.tickElapsedMs) > 0 ? { tickElapsedMs: Number(status.tickElapsedMs) } : {}),
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

export function statusHasApplication(shape, application, mode = null) {
    return statusEffectsFor(shape).some((status) => {
        if (!statusIsActive({ statusEffects: [status] }, status.type)) return false;
        return status.effects.some((effect) => effect.type === application && (mode == null || effect.mode === mode));
    });
}

export function statusEffectValue(shape, statusType, application, field, fallback) {
    const status = statusEffectFor(shape, statusType);
    if (!status || !statusIsActive({ statusEffects: [status] }, status.type)) return fallback;
    const value = status.effects.find((effect) => effect.type === application)?.[field];
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/** Adds or refreshes one status while preserving an active tick clock. */
export function upsertStatusEffect(shape, incomingStatus) {
    const incoming = normalizeStatusEffect(incomingStatus);
    if (!incoming) return shape;
    const currentStatuses = statusEffectsFor(shape);
    const current = currentStatuses.find((status) => status.type === incoming.type && status.mode === incoming.mode);
    if (!current) return { ...shape, statusEffects: [...currentStatuses, incoming] };

    const merged = {
        ...current,
        ...incoming,
        remainingMs: Math.max(current.remainingMs, incoming.remainingMs),
        tickMs: current.remainingMs > 0 ? current.tickMs : (incoming.tickMs ?? current.tickMs),
        tickElapsedMs: current.remainingMs > 0
            ? Number(current.tickElapsedMs ?? 0)
            : Number(incoming.tickElapsedMs ?? 0),
        effects: mergeStatusEffects(current.effects, incoming.effects),
    };
    return {
        ...shape,
        statusEffects: currentStatuses.map((status) => status.type === merged.type && status.mode === merged.mode
            ? merged : status),
    };
}

export function removeStatusEffect(shape, type, { presenceOnly = false } = {}) {
    const normalizedType = String(type ?? "").toLowerCase();
    return {
        ...shape,
        statusEffects: statusEffectsFor(shape).filter((status) => status.type !== normalizedType
            || (presenceOnly && status.mode !== PRESENCE_MODE)),
    };
}

export function clearPresenceStatuses(shape) {
    return {
        ...shape,
        statusEffects: statusEffectsFor(shape).filter((status) => status.mode !== PRESENCE_MODE),
    };
}

function mergeStatusEffects(currentEffects, incomingEffects) {
    const merged = [...(currentEffects ?? [])];
    for (const incoming of incomingEffects ?? []) {
        const index = merged.findIndex((effect) => effect.type === incoming.type && effect.mode === incoming.mode);
        if (index < 0) {
            merged.push(incoming);
            continue;
        }
        const current = merged[index];
        merged[index] = {
            ...current,
            ...incoming,
            ...mergeNumericMaximum(current, incoming, "amount"),
            ...mergeNumericMaximum(current, incoming, "multiplier"),
        };
    }
    return merged;
}

function mergeNumericMaximum(current, incoming, field) {
    if (current[field] == null || incoming[field] == null) return {};
    return { [field]: Math.max(Number(current[field]), Number(incoming[field])) };
}
