/**
 * The one resolver for the value forms abilities.json uses. A value is:
 *   a plain number, boolean or string (returned as it is);
 *   an array (each item resolved);
 *   { "context": k, "fallback": v }     context[k], else v;
 *   { "ownerStat": k, "fallback": v }   the owner bot's k, else v;
 *   { "add": x, "amount": n }           x plus n;
 *   { "stat": k, "fallback": v }        stats[k], else v (a stat name a phase defines, e.g. its radius).
 * The validator (gameplayValidation.js) checks the data against these forms.
 */
export function resolveDataValue(value, { stats = {}, owner = null, context = {} } = {}) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => resolveDataValue(item, { stats, owner, context }));
    if (Object.hasOwn(value, "stat")) return stats[value.stat] ?? value.fallback;
    if (Object.hasOwn(value, "ownerStat")) return owner?.[value.ownerStat] ?? value.fallback;
    if (Object.hasOwn(value, "context")) {
        return context[value.context] ?? resolveDataValue(value.fallback, { stats, owner, context });
    }
    if (Object.hasOwn(value, "add")) {
        return Number(resolveDataValue(value.add, { stats, owner, context })) + Number(value.amount ?? 0);
    }
    return value;
}

/** A resolved number, or `fallback` when the value does not resolve to a finite number. */
export function resolveDataNumber(value, scope = {}, fallback = 0) {
    const number = Number(resolveDataValue(value, scope));
    return Number.isFinite(number) ? number : fallback;
}
