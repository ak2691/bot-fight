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

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function phaseRows(stats) {
    return (stats.phases ?? []).flatMap((phase) => {
        const section = phase.label ?? `${titleCase(phase.id)} phase`;
        const rows = [];
        const radius = phase.radius;
        if (radius != null) rows.push({ label: "Radius", value: `${number(radius)} units`, section });
        if (phase.hitboxWidth != null) rows.push({ label: "Hitbox width", value: `${number(phase.hitboxWidth)} units`, section });
        if (phase.hitboxLength != null) rows.push({ label: "Hitbox length", value: `${number(phase.hitboxLength)} units`, section });
        if (phase.speed != null) rows.push({ label: "Speed", value: `${number(phase.speed)} units per tick`, section });
        if (phase.damage != null) rows.push({ label: "Damage", value: number(phase.damage), section });
        for (const [status, statusStats] of Object.entries(phase.statuses ?? {})) {
            rows.push({ label: "Status effect", value: titleCase(status), section });
            if (statusStats?.durationMs != null) rows.push({ label: "Status duration", value: seconds(statusStats.durationMs), section });
        }
        return rows;
    });
}

export function abilityStatsForDisplay(ability) {
    const stats = ability.stats ?? {};
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
    const hasEntity = (ability.effects ?? []).some((effect) => effect.type === "spawn_entity");
    const duration = stats.durationMs ?? (hasEntity ? stats.fuseMs ?? stats.delayMs : null);
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
    rows.push(...phaseRows(stats));
    return rows;
}
