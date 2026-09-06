import { phaseDisplayRows } from "./abilityCatalogueDisplay.js";

const STATUS_STAT_KEYS = Object.freeze({
    burn: { damage: "burnDamage", interval: "burnTickMs", duration: "burnDurationMs" },
    bleed: { damage: "bleedDamage", interval: "bleedTickMs", duration: "bleedDurationMs" },
    shock: { damage: "shockDamage", interval: "shockTickMs", duration: "shockDurationMs" },
});

function seconds(milliseconds) {
    const value = Number(milliseconds) / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} sec`;
}

function number(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function rangeForStats(stats) {
    return stats.range ?? stats.radius ?? stats.distance;
}

function damageRows(stats) {
    const falloff = stats.falloff ?? {};
    const hasFalloff = falloff.maxAmount != null || falloff.minAmount != null;
    if (!hasFalloff) return stats.damage != null ? [{ label: "Damage", value: String(stats.damage) }] : [];

    const maximum = Number(falloff.maxAmount ?? stats.damage ?? 0);
    const minimum = Number(falloff.minAmount ?? maximum);
    const section = "Damage profile";
    const rows = [
        { label: "Min damage", value: number(minimum), section },
        { label: "Max damage", value: number(maximum), section },
    ];
    const falloffStart = Number(falloff.falloffStart ?? 0);
    const falloffEnd = Number(falloff.falloffEnd ?? falloffStart);
    const range = Number(rangeForStats(stats));
    if (falloffStart > 0) rows.push({ label: "Falloff starts", value: `${number(falloffStart)} units`, section });
    if (falloffEnd > falloffStart && Number.isFinite(range) && falloffEnd < range) {
        rows.push({ label: "Falloff ends", value: `${number(falloffEnd)} units`, section });
    }
    return rows;
}

function statusRows(ability, stats) {
    return (ability.effects ?? []).flatMap((effect) => {
        if (effect.type !== "status" || !effect.subtype) return [];
        const keys = STATUS_STAT_KEYS[effect.subtype] ?? {};
        const duration = stats[keys.duration] ?? effect.durationMs;
        const rows = [{ label: "Status effect", value: effect.subtype.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) }];
        if (duration != null) rows.push({ label: "Status duration", value: seconds(duration) });
        if (stats[keys.interval] != null) rows.push({ label: "Status interval", value: seconds(stats[keys.interval]) });
        if (stats[keys.damage] != null) rows.push({ label: "Status damage", value: String(stats[keys.damage]) });
        return rows;
    });
}

function buffRows(ability) {
    return (ability.buffDetails ?? []).map(({ label, value }) => ({ label, value }));
}

function pullRows(ability, stats) {
    return (ability.effects ?? [])
        .filter((effect) => effect.type === "pull")
        .map((effect) => effect.perTick ?? effect.amount ?? stats.pullPerTick ?? stats.pull)
        .filter((strength) => Number.isFinite(Number(strength)))
        .map((strength) => ({ label: "Pull strength", value: `${number(strength)} units per tick` }));
}

export function abilityStatsForDisplay(ability) {
    const stats = ability.stats ?? {};
    const authoredPhaseRows = phaseDisplayRows(ability.id);
    if (authoredPhaseRows.length > 0) {
        const rows = [];
        if (stats.cooldownMs != null) rows.push({ label: "Cooldown", value: seconds(stats.cooldownMs) });
        if (stats.activeMs != null || stats.visualMs != null) {
            rows.push({ label: "Active", value: seconds(stats.activeMs ?? stats.visualMs) });
        }
        if (stats.windupMs != null) rows.push({ label: "Wind-up", value: seconds(stats.windupMs) });
        const duration = stats.durationMs ?? null;
        const durationIsStatus = (ability.effects ?? []).some((effect) => effect.type === "status" && effect.durationMs === duration);
        if (duration != null && !durationIsStatus) rows.push({ label: "Duration", value: seconds(duration) });
        if (stats.maxCharges != null) rows.push({ label: "Charges", value: String(stats.maxCharges) });
        const resourceDurationMs = stats.reloadMs ?? stats.rechargeMs;
        if (stats.maxCharges != null && resourceDurationMs != null) {
            rows.push({
                label: stats.reloadMs != null ? "Reload" : "Recharge",
                value: seconds(resourceDurationMs),
            });
        }
        return [...rows, ...authoredPhaseRows, ...buffRows(ability)];
    }
    const rows = [];
    if (stats.cooldownMs != null) rows.push({ label: "Cooldown", value: seconds(stats.cooldownMs) });
    if (stats.activeMs != null || stats.visualMs != null) rows.push({ label: "Active", value: seconds(stats.activeMs ?? stats.visualMs) });
    if (stats.windupMs != null) rows.push({ label: "Wind-up", value: seconds(stats.windupMs) });
    rows.push(...damageRows(stats));
    const range = rangeForStats(stats);
    if (stats.hitboxWidth != null) rows.push({ label: "Hitbox width", value: `${number(stats.hitboxWidth)} units` });
    if (stats.hitboxLength != null) rows.push({ label: "Hitbox length", value: `${number(stats.hitboxLength)} units` });
    if (range != null) rows.push({ label: stats.radius != null ? "Radius" : "Range", value: `${number(range)} units` });
    const arc = stats.arc ?? stats.coverageDegrees;
    if (arc != null) rows.push({ label: "Arc", value: `${number(arc)}\u00B0` });
    const charges = stats.maxCharges;
    if (charges != null) rows.push({ label: "Charges", value: String(charges) });
    const resourceDurationMs = stats.reloadMs ?? stats.rechargeMs;
    if (charges != null && resourceDurationMs != null) {
        rows.push({
            label: stats.reloadMs != null ? "Reload" : "Recharge",
            value: seconds(resourceDurationMs),
        });
    }
    const duration = stats.durationMs ?? null;
    const durationIsStatus = (ability.effects ?? []).some((effect) => effect.type === "status" && effect.durationMs === duration);
    if (duration != null && !durationIsStatus) rows.push({ label: "Duration", value: seconds(duration) });
    rows.push(...statusRows(ability, stats));
    if (stats.healing != null) rows.push({ label: "Effect", value: `Restore ${stats.healing} HP` });
    if ((ability.effects ?? []).some((effect) => effect.type === "healing" && effect.mirrorsDamage)) {
        rows.push({ label: "Effect", value: "Restore damage dealt as HP" });
    }
    if (stats.knockback != null) rows.push({ label: "Effect", value: `${number(stats.knockback)}-unit knockback` });
    rows.push(...pullRows(ability, stats));
    rows.push(...buffRows(ability));
    rows.push(...phaseDisplayRows(ability.id));
    return rows;
}
