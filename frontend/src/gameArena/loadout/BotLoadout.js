import { ABILITY_STATS, abilityStats } from "../gameconfig/Abilities.js";
import { abilityIdentity } from "../gameconfig/AbilityRegistry.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";
import { abilityContract } from "../gameconfig/AbilityContracts.js";

export { ABILITY_STATS };

export const BASE_BOT_STATS = Object.freeze({
    maxHp: 100,
    moveSpeed: 8,
    attackDamagePercent: 100,
    attackSpeedPercent: 100,
});

export const STAT_POINT_BUDGET_PER_ROUND = 4;
export const MAX_MATCH_STAT_POINTS = 12;
export const MAX_EQUIPPED_ABILITIES = 6;
export const ROUND_ABILITY_DRAFT = Object.freeze({
    1: Object.freeze({ offered: 6, picks: 3 }),
    2: Object.freeze({ offered: 4, picks: 2 }),
    3: Object.freeze({ offered: 3, picks: 1 }),
});
export const SANDBOX_MAX_STAT_POINTS = 100;

export const VISUAL_INTERPOLATION = Object.freeze({
    NONE: "none",
    LINEAR: "linear",
});

const BOT_ABILITY_CATALOG = [
    { id: 1, round: 1, visualInterpolation: "none", summary: "Dependable 92-range sword sweep covering a 120° arc." },
    { id: 2, round: 1, visualInterpolation: "none", summary: "Directional defense using rechargeable charges." },
    { id: 3, round: 1, visualInterpolation: "none", summary: "Hitscan fire with ammunition and distance falloff." },
    { id: 4, round: 1, visualInterpolation: "linear", summary: "A slowing explosive projectile." },
    { id: 5, round: 1, visualInterpolation: "linear", summary: "Charge-based projectile that burns its target." },
    { id: 6, round: 1, visualInterpolation: "none", summary: "Visible short-range control cast." },
    { id: 7, round: 1, visualInterpolation: "none", summary: "Wind up a 30-damage, 115-range sword punish across a 150° arc that also causes bleed." },
    { id: 8, round: 1, visualInterpolation: "none", summary: "Deal 20 damage and push nearby bots 250 units; blocking prevents only the damage." },
    { id: 9, round: 1, visualInterpolation: "none", summary: "A blockable projectile that slows on hit." },
    { id: 10, round: 1, visualInterpolation: "none", summary: "Channel briefly to restore 15 HP." },
    { id: 11, round: 1, visualInterpolation: "linear", summary: "Place one visible, destructible proximity trap." },
    { id: 12, round: 1, visualInterpolation: "none", summary: "Reliable 500-range low-damage hitscan shot." },
    { id: 13, round: 2, visualInterpolation: "none", summary: "Charge a visible 900-range, 40-damage beam that also shocks its target." },
    { id: 14, round: 2, visualInterpolation: "linear", summary: "Deploy a deterministic pulling damage field." },
    { id: 15, round: 2, visualInterpolation: "linear", summary: "Prevent nearby enemies from starting abilities." },
    { id: 16, round: 2, visualInterpolation: "none", summary: "Reduce damage and retaliate up to three times." },
    { id: 17, round: 2, visualInterpolation: "linear", summary: "Deploy a targetable deterministic firing drone." },
    { id: 18, round: 2, visualInterpolation: "linear", summary: "Fast windburst projectile with 220 range, 15 damage, and 90 knockback." },
    { id: 19, round: 0, visualInterpolation: "linear", standard: true, summary: "Standard one-charge 150-unit burst with a 1.5-second cooldown; aim it relative to a target or in an arena direction." },
    { id: 20, round: 0, visualInterpolation: "none", standard: true, summary: "Standard targeting ability that prepares for 0.2 seconds, then faces the resolved target; 10-second cooldown." },
    { id: 21, round: 3, visualInterpolation: "none", summary: "Snapshot position and HP, then return to them after three seconds." },
    { id: 22, round: 3, visualInterpolation: "none", summary: "Mark a visible zone that detonates after 1.5 seconds." },
    { id: 23, round: 3, visualInterpolation: "none", summary: "Ignore all hostile damage, statuses, interrupts, and displacement for 1.5 seconds." },
    { id: 24, round: 3, visualInterpolation: "none", summary: "Deploy an area where new abilities cannot begin." },
    { id: 25, round: 3, visualInterpolation: "linear", summary: "Pass through the opponent and choose the landing facing inside the action." },
];

const ENTITY_CAPABILITIES = Object.freeze({
    4: { entityType: "grenade", entityLabel: "Grenade", tags: ["projectile", "entity", "hittable"] },
    5: { entityType: "fireball", entityLabel: "Fireball", tags: ["projectile", "entity", "hittable", "chainable"] },
    9: { entityType: "concussive_shot", entityLabel: "Concussive Shot", tags: ["projectile", "entity", "hittable", "chainable"] },
    11: { entityType: "proximity_mine", entityLabel: "Proximity Mine", tags: ["trap", "entity", "hittable", "chainable", "destructible"] },
    14: { entityType: "gravity_field", entityLabel: "Gravity Field", tags: ["projectile", "zone", "entity"] },
    15: { entityType: "silence_wave", entityLabel: "Silence Pulse", tags: ["projectile", "entity", "hittable", "chainable"] },
    17: { entityType: "hunter_drone", entityLabel: "Hunter Drone", tags: ["summon", "entity", "hittable", "chainable", "destructible"] },
    18: { entityType: "windburst_projectile", entityLabel: "Wind Burst", tags: ["projectile", "entity", "hittable"] },
    21: { entityType: "temporal_rewind_zone", entityLabel: "Temporal Rewind Clock", tags: ["zone", "entity"] },
    22: { entityType: "orbital_zone", entityLabel: "Orbital Strike Zone", tags: ["zone", "entity"] },
    24: { entityType: "null_zone", entityLabel: "Null Zone", tags: ["zone", "entity"] },
});

function abilityCapabilities(ability) {
    const identity = abilityIdentity(ability.id);
    if (!identity) throw new Error(`Unknown ability in catalog: ${ability.id}`);
    const stats = abilityStats(identity.id) ?? {};
    const entity = ENTITY_CAPABILITIES[identity.id] ?? {};
    const tags = new Set([identity.type, ...(entity.tags ?? [])]);
    if (stats.windupMs) tags.add("wind-up");
    if (stats.beam) tags.add("ray");
    if (stats.durationMs) tags.add("duration");
    tags.add(ability.visualInterpolation === VISUAL_INTERPOLATION.LINEAR ? "interpolated-visual" : "instant-visual");
    const gameplay = abilityContract(ability.id);
    return Object.freeze({
        ...ability,
        id: identity.id,
        actions: Object.freeze([identity.id]),
        name: identity.name,
        label: identity.label,
        kind: identity.type,
        ...entity,
        stats: Object.freeze({ ...stats }),
        delivery: gameplay?.delivery ?? null,
        effects: gameplay?.effects ?? Object.freeze([]),
        shieldInteraction: gameplay?.shieldInteraction ?? null,
        tags: Object.freeze([...tags]),
    });
}

/** Full runtime metadata, including standard abilities that are not loadout choices. */
export const ALL_ABILITY_DEFINITIONS = Object.freeze(BOT_ABILITY_CATALOG.map(abilityCapabilities));
export const STANDARD_ABILITY_IDS = Object.freeze([19, 20]);
const STANDARD_ABILITY_SET = new Set(STANDARD_ABILITY_IDS);
/** Selectable/configurable ability catalog. Standard abilities are granted separately. */
export const BOT_ABILITIES = Object.freeze(ALL_ABILITY_DEFINITIONS.filter(({ id }) => !STANDARD_ABILITY_SET.has(id)));
export const SELECTABLE_BOT_ABILITIES = BOT_ABILITIES;

const STATUS_EFFECT_LABELS = Object.freeze({
    burn: "Burn",
    stun: "Stun",
    bleed: "Bleed",
    slow: "Slow",
    shock: "Shock",
    silence: "Silence",
});

export const STATUS_EFFECT_DEFINITIONS = Object.freeze([
    ...new Set(ALL_ABILITY_DEFINITIONS.flatMap((ability) => ability.effects
        .filter((effect) => effect.type === "debuff" && STATUS_EFFECT_LABELS[effect.debuff])
        .map((effect) => effect.debuff))),
].map((id) => Object.freeze({ id, label: STATUS_EFFECT_LABELS[id] })));

export function statusEffectDefinitionsForAbilities(abilityIds) {
    const selected = abilityIds instanceof Set ? abilityIds : new Set(abilityIds ?? []);
    const possible = new Set(ALL_ABILITY_DEFINITIONS
        .filter((ability) => selected.has(ability.id))
        .flatMap((ability) => ability.effects
            .filter((effect) => effect.type === "debuff")
            .map((effect) => effect.debuff)));
    return STATUS_EFFECT_DEFINITIONS.filter(({ id }) => possible.has(id));
}

export function abilityDefinition(id) {
    const identity = abilityIdentity(id);
    return identity ? ALL_ABILITY_DEFINITIONS.find((ability) => ability.id === identity.id) ?? null : null;
}

export function shouldInterpolateAbilityVisual(id) {
    return abilityDefinition(id)?.visualInterpolation === VISUAL_INTERPOLATION.LINEAR;
}

export function entityTargetDefinitions() {
    return ALL_ABILITY_DEFINITIONS.filter((ability) => ability.tags.includes("entity") && ability.entityType);
}

export const ACTION_TO_ABILITY = Object.freeze({
    ...Object.fromEntries(ALL_ABILITY_DEFINITIONS.flatMap((ability) => ability.actions.map((action) => [action, ability.id]))),
});

export const DEFAULT_BOT_LOADOUT = Object.freeze({
    abilities: Object.freeze([]),
    statPoints: Object.freeze({ maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 }),
});

export function normalizedBotLoadout(loadout) {
    const known = new Set(SELECTABLE_BOT_ABILITIES.map((ability) => ability.id));
    const abilities = [...new Set(normalizeAbilityInputList(loadout?.abilities ?? DEFAULT_BOT_LOADOUT.abilities))]
        .filter((ability) => known.has(ability))
        .slice(0, MAX_EQUIPPED_ABILITIES);
    const rawPoints = loadout?.statPoints ?? {};
    const pointKeys = ["maxHp", "moveSpeed", "attackDamage", "attackSpeed"];
    const statPoints = Object.fromEntries(pointKeys.map((key) => [key, Math.max(0, Math.floor(Number(rawPoints[key]) || 0))]));
    let overflow = Math.max(0, Object.values(statPoints).reduce((sum, value) => sum + value, 0) - MAX_MATCH_STAT_POINTS);
    for (const key of [...pointKeys].reverse()) {
        const removed = Math.min(statPoints[key], overflow);
        statPoints[key] -= removed;
        overflow -= removed;
    }
    return { abilities, statPoints };
}

export function botStatsForLoadout(loadout) {
    const { statPoints } = normalizedBotLoadout(loadout);
    return {
        maxHp: BASE_BOT_STATS.maxHp + statPoints.maxHp * 10,
        moveSpeed: BASE_BOT_STATS.moveSpeed + statPoints.moveSpeed,
        attackDamagePercent: BASE_BOT_STATS.attackDamagePercent + statPoints.attackDamage * 10,
        attackSpeedPercent: BASE_BOT_STATS.attackSpeedPercent + statPoints.attackSpeed * 10,
    };
}

export function actionIdsForLoadout(loadout) {
    const selected = new Set(normalizedBotLoadout(loadout).abilities);
    return [
        ...STANDARD_ABILITY_IDS.flatMap((id) => abilityDefinition(id)?.actions ?? []),
        ...SELECTABLE_BOT_ABILITIES.filter((ability) => selected.has(ability.id)).flatMap((ability) => ability.actions),
    ];
}

export function actionIdsForSandboxLoadout(loadout) {
    const selected = new Set(normalizedSandboxLoadout(loadout).abilities);
    return [
        ...STANDARD_ABILITY_IDS.flatMap((id) => abilityDefinition(id)?.actions ?? []),
        ...SELECTABLE_BOT_ABILITIES.filter((ability) => selected.has(ability.id)).flatMap((ability) => ability.actions),
    ];
}

const ABILITY_CODES = Object.freeze({ 1: "s", 2: "b", 3: "g", 4: "r", 5: "f", 6: "t", 7: "h", 8: "u", 9: "c", 10: "e", 11: "m", 12: "p", 13: "R", 14: "G", 15: "S", 16: "A", 17: "H", 18: "T", 21: "w", 22: "o", 23: "a", 24: "n", 25: "P" });
const ABILITY_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(ABILITY_CODES).map(([id, code]) => [code, id])));

export function encodeBotLoadout(loadout) {
    const normalized = normalizedBotLoadout(loadout);
    const abilities = normalized.abilities.map((id) => ABILITY_CODES[id]).filter(Boolean).sort().join("");
    const points = ["maxHp", "moveSpeed", "attackDamage", "attackSpeed"].map((key) => normalized.statPoints[key]).join(",");
    return `custom:${abilities}:${points}`;
}

export function decodeBotLoadout(value) {
    if (typeof value !== "string" || !value.startsWith("custom:")) return normalizedBotLoadout(DEFAULT_BOT_LOADOUT);
    const [, abilityCodes = "", points = "0,0,0,0"] = value.split(":");
    const abilities = [...abilityCodes].map((code) => ABILITY_BY_CODE[code]).filter(Boolean);
    const [maxHp = 0, moveSpeed = 0, attackDamage = 0, attackSpeed = 0] = points.split(",").map(Number);
    return normalizedBotLoadout({ abilities, statPoints: { maxHp, moveSpeed, attackDamage, attackSpeed } });
}

export function normalizedSandboxLoadout(loadout) {
    const known = new Set(SELECTABLE_BOT_ABILITIES.map((ability) => ability.id));
    const abilities = [...new Set(normalizeAbilityInputList(loadout?.abilities))]
        .filter((ability) => known.has(ability));
    const rawPoints = loadout?.statPoints ?? {};
    const keys = ["maxHp", "moveSpeed", "attackDamage", "attackSpeed"];
    const statPoints = Object.fromEntries(keys.map((key) => [key, Math.max(0, Math.min(SANDBOX_MAX_STAT_POINTS, Math.floor(Number(rawPoints[key]) || 0)))]));
    return { abilities, statPoints };
}

export function encodeSandboxLoadout(loadout) {
    const normalized = normalizedSandboxLoadout(loadout);
    return `sandbox:${normalized.abilities.join(",")}:${["maxHp", "moveSpeed", "attackDamage", "attackSpeed"].map((key) => normalized.statPoints[key]).join(",")}`;
}

export function decodeSandboxLoadout(value) {
    if (typeof value !== "string" || !value.startsWith("sandbox:")) return normalizedSandboxLoadout(DEFAULT_BOT_LOADOUT);
    const [, abilities = "", points = "0,0,0,0"] = value.split(":");
    const [maxHp = 0, moveSpeed = 0, attackDamage = 0, attackSpeed = 0] = points.split(",").map(Number);
    return normalizedSandboxLoadout({ abilities: abilities ? abilities.split(",") : [], statPoints: { maxHp, moveSpeed, attackDamage, attackSpeed } });
}

/** Legacy names are accepted only while decoding persisted/API-era loadouts. */
function normalizeAbilityInputList(values) {
    if (!Array.isArray(values)) return [];
    return values.map(abilityIdFromBoundary).filter((id) => id != null);
}

export function botStatsForSandboxLoadout(loadout) {
    const { statPoints } = normalizedSandboxLoadout(loadout);
    return {
        maxHp: BASE_BOT_STATS.maxHp + statPoints.maxHp * 10,
        moveSpeed: BASE_BOT_STATS.moveSpeed + statPoints.moveSpeed,
        attackDamagePercent: BASE_BOT_STATS.attackDamagePercent + statPoints.attackDamage * 10,
        attackSpeedPercent: BASE_BOT_STATS.attackSpeedPercent + statPoints.attackSpeed * 10,
    };
}
