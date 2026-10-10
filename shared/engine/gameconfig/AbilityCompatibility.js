import { abilityId, abilityIdFromName } from "./AbilityRegistry.js";
import { ABILITY_STAGES } from "./AbilityState.js";

/** Normalize hostile persisted/API data once before it enters runtime state. */
export function abilityIdFromBoundary(value) {
    const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    return abilityId(numeric) ?? abilityIdFromName(value);
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

const KNOWN_STAGES = new Set(Object.values(ABILITY_STAGES));

/** Normalizes an `abilityState` map from a payload: canonical ids, known stages, finite non-negative numbers. */
export function abilityStateFromBoundary(value) {
    const records = abilityMapFromBoundary(value);
    return Object.fromEntries(Object.entries(records)
        .filter(([, record]) => record != null && typeof record === "object")
        .map(([id, record]) => {
            const stage = KNOWN_STAGES.has(record.stage) ? record.stage : ABILITY_STAGES.READY;
            const clean = { stage, remainingMs: Math.max(0, Number(record.remainingMs) || 0) };
            if (record.cooldownMs != null) clean.cooldownMs = Math.max(0, Number(record.cooldownMs) || 0);
            if (record.charges != null) clean.charges = Math.max(0, Math.trunc(Number(record.charges) || 0));
            if (record.reloadMs != null) clean.reloadMs = Math.max(0, Number(record.reloadMs) || 0);
            if (record.target != null && typeof record.target === "object") {
                clean.target = { x: record.target.x, y: record.target.y };
            }
            return [id, clean];
        }));
}
