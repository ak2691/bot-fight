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

function rangeBands(stats) {
    const starts = stats.damageRanges ?? [];
    const maximum = stats.damageMaxRadius ?? stats.damageMaxDistance ?? stats.range ?? stats.radius ?? stats.explosionRadius;
    if (!starts.length || maximum == null) return [];
    if (stats.damageRangeMode === "interpolated") {
        const minimum = stats.damageMinRadius ?? stats.damageMinDistance ?? 0;
        return starts.map((end, index) => [index === 0 ? minimum : starts[index - 1], end]);
    }
    if (stats.damageRangeMode === "continuous") return starts.map((point) => [point, point]);
    return starts.map((start, index) => [start, starts[index + 1] ?? maximum]);
}

function rangePoints(stats, bands) {
    const starts = stats.damageRanges ?? [];
    if (stats.damageRangeMode === "continuous") return starts;
    if (stats.damageRangeMode === "interpolated") return [bands[0][0], ...starts];
    return [...starts, bands.at(-1)[1]];
}

function damageRangeRows(stats, bands) {
    const damages = (stats.damageByRange ?? []).map(Number).filter(Number.isFinite);
    if (!damages.length || !bands.length) return [];

    const points = rangePoints(stats, bands);
    const intervals = points.slice(1).map((point, index) => point - points[index]).filter((interval) => interval > 0);
    const section = "Damage at each range";
    return [
        { label: "Min damage", value: number(Math.min(...damages)), section },
        { label: "Max damage", value: number(Math.max(...damages)), section },
        { label: "Min range", value: `${number(points[0])} units`, section },
        { label: "Max range", value: `${number(points.at(-1))} units`, section },
        { label: "Range intervals", value: `${intervals.map(number).join(", ")} units`, section },
    ];
}

function statusRows(ability, stats) {
    return (ability.effects ?? []).flatMap((effect) => {
        if (effect.type !== "debuff" || !effect.debuff) return [];
        const keys = STATUS_STAT_KEYS[effect.debuff] ?? {};
        const duration = stats[keys.duration] ?? effect.durationMs;
        const rows = [{ label: "Status effect", value: effect.debuff.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) }];
        if (duration != null) rows.push({ label: "Status duration", value: seconds(duration) });
        if (stats[keys.interval] != null) rows.push({ label: "Status interval", value: seconds(stats[keys.interval]) });
        if (stats[keys.damage] != null) rows.push({ label: "Status damage", value: String(stats[keys.damage]) });
        return rows;
    });
}

export function abilityStatsForDisplay(ability) {
    const stats = ability.stats ?? {};
    const rows = [];
    if (stats.cooldownMs != null) rows.push({ label: "Cooldown", value: seconds(stats.cooldownMs) });
    if (stats.activeMs != null || stats.visualMs != null) rows.push({ label: "Active", value: seconds(stats.activeMs ?? stats.visualMs) });
    if (stats.windupMs != null) rows.push({ label: "Wind-up", value: seconds(stats.windupMs) });
    const bands = rangeBands(stats);
    if (Array.isArray(stats.damageByRange) && bands.length) {
        rows.push(...damageRangeRows(stats, bands));
    } else if (stats.damage != null) rows.push({ label: "Damage", value: String(stats.damage) });
    if (!bands.length) {
        const range = stats.range ?? stats.radius ?? stats.explosionRadius ?? stats.distance;
        if (range != null) rows.push({ label: stats.radius != null || stats.explosionRadius != null ? "Radius" : "Range", value: `${number(range)} units` });
    }
    const arc = stats.arcDegrees ?? stats.coverageDegrees;
    if (arc != null) rows.push({ label: "Arc", value: `${number(arc)}\u00B0` });
    const charges = stats.maxCharges ?? stats.ammoMax;
    if (charges != null) rows.push({ label: "Charges", value: String(charges) });
    const hasEntity = (ability.effects ?? []).some((effect) => effect.type === "spawn_entity");
    const duration = stats.durationMs ?? (hasEntity ? stats.fuseMs ?? stats.delayMs : null);
    const durationIsStatus = (ability.effects ?? []).some((effect) => effect.type === "debuff" && effect.durationMs === duration);
    if (duration != null && !durationIsStatus) rows.push({ label: "Duration", value: seconds(duration) });
    rows.push(...statusRows(ability, stats));
    if (stats.healing != null) rows.push({ label: "Effect", value: `Restore ${stats.healing} HP` });
    if (stats.knockback != null) rows.push({ label: "Effect", value: `${number(stats.knockback)}-unit knockback` });
    return rows;
}
