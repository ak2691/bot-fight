import { abilityId, abilityIdFromLegacyName } from "./AbilityRegistry.js";

/** Normalize hostile persisted/API data once before it enters runtime state. */
export function abilityIdFromBoundary(value) {
    const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    return abilityId(numeric) ?? abilityIdFromLegacyName(value);
}

export function abilityIdsFromBoundary(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(abilityIdFromBoundary).filter((id) => id != null))];
}

export function abilityMapFromBoundary(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
    const normalized = {};
    for (const [rawId, entry] of Object.entries(value)) {
        const id = abilityIdFromBoundary(rawId);
        if (id != null && !Object.hasOwn(normalized, id)) normalized[id] = entry;
    }
    return normalized;
}
