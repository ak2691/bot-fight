// The ability details panel's content (mockup section 7): the name, one line of description, and only the stats the
// ability has, read from the gameplay data (abilities.json through Abilities.js, the cost through AbilityChannels.js and
// the projectile speed through aimPrediction.js). Pure and read-only.
import { abilityStats, abilityTiming } from "../../../../../shared/engine/gameconfig/Abilities.js";
import { abilityStaminaCost } from "../../../../../shared/engine/gameconfig/AbilityChannels.js";
import { projectileSpeedPerSecond } from "../../../../../shared/engine/botlogic/planner/aimPrediction.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const seconds = (ms) => String(Number((Number(ms) / 1000).toFixed(2)));
const rounded = (value) => String(Math.round(Number(value)));

/**
 * The details of one ability, or null when it is not in the catalogue. `stats` lists `{ key, label, value, unit }` in
 * display order; a stat the ability does not have is left out. Units: "s" for times, "/ s" for speed, "" otherwise.
 */
export function abilityDetails(abilityId) {
    const definition = abilityDefinition(abilityId);
    if (!definition) return null;
    const stats = abilityStats(abilityId) ?? {};
    const timing = abilityTiming(abilityId) ?? {};
    const list = [];
    const add = (key, label, value, unit = "") => list.push({ key, label, value, unit });

    if (positive(stats.damage)) add("damage", "Damage", rounded(stats.damage));
    else if (stats.falloff && positive(stats.falloff.maxAmount)) {
        add("damage", "Damage", `${rounded(stats.falloff.minAmount)}–${rounded(stats.falloff.maxAmount)}`);
    }
    if (positive(stats.windupMs ?? timing.windupMs)) add("windup", "Wind-up", seconds(stats.windupMs ?? timing.windupMs), "s");
    if (positive(stats.activeMs ?? timing.activeMs)) add("active", "Active time", seconds(stats.activeMs ?? timing.activeMs), "s");
    if (positive(stats.cooldownMs ?? timing.cooldownMs)) add("cooldown", "Cooldown", seconds(stats.cooldownMs ?? timing.cooldownMs), "s");
    if (positive(stats.range)) add("range", "Range", rounded(stats.range));
    const speed = projectileSpeedPerSecond(abilityId);
    if (positive(speed)) add("speed", "Projectile speed", rounded(speed), "/ s");
    const stamina = abilityStaminaCost(abilityId);
    if (positive(stamina)) add("stamina", "Stamina cost", rounded(stamina));

    return {
        id: definition.id,
        name: definition.label,
        description: firstSentence(definition.description ?? definition.summary ?? ""),
        stats: list,
    };
}

/** "Damage 8 · Cooldown 0.5 s": one line of the stats, for a menu footer. */
export function statsLine(details) {
    return (details?.stats ?? []).map((stat) => `${stat.label} ${stat.value}${stat.unit ? ` ${stat.unit}` : ""}`).join(" · ");
}

/** The first sentence of a description (the whole text when it has no full stop). */
export function firstSentence(text) {
    const trimmed = String(text).trim();
    const match = trimmed.match(/^(.+?[.!?])(\s|$)/);
    return match ? match[1] : trimmed;
}
