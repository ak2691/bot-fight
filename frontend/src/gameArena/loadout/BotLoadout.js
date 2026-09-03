import { ABILITY_STATS, abilityStats } from "../gameconfig/Abilities.js";
import { abilityIdentity } from "../gameconfig/AbilityRegistry.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";
import { abilityContract, DELIVERY_TYPES, EFFECT_TYPES } from "../gameconfig/AbilityContracts.js";
import { entityContractForAbility } from "../ecs/contracts/EntityContracts.js";
import { selectableIdentitiesForAbilityEntity } from "../modelPayloads/selectableIdentities.js";

export { ABILITY_STATS };

export const BASE_BOT_STATS = Object.freeze({
    maxHp: 150,
    moveSpeed: 15,
    attackDamagePercent: 100,
    attackSpeedPercent: 100,
});

export const MAX_EQUIPPED_ABILITIES = 6;
export const ROUND_ABILITY_DRAFT = Object.freeze({
    1: Object.freeze({ offered: 6, picks: 3 }),
    2: Object.freeze({ offered: 4, picks: 2 }),
    3: Object.freeze({ offered: 3, picks: 1 }),
});

export const VISUAL_INTERPOLATION = Object.freeze({
    NONE: "none",
    LINEAR: "linear",
});

export const ABILITY_TAGS = Object.freeze({
    CHARGES: "charges",
    HP_CHARGES: "hp-charges",
    AMMUNITION_CHARGES: "ammunition-charges",
    STATUS_EFFECT: "status-effect",
});

const BOT_ABILITY_CATALOG = [
    { id: 1, round: 1, visualInterpolation: "none", summary: "Basic slash covering a 120° arc." },
    { id: 3, round: 1, visualInterpolation: "none", summary: "Shoots hitscan with distance falloff." },
    { id: 4, round: 1, visualInterpolation: "linear", summary: "An explosive projectile that triggers on hit or after some duration." },
    { id: 5, round: 1, visualInterpolation: "linear", summary: "Projectile that deals damage and applies a burn effect." },
    { id: 6, round: 2, visualInterpolation: "none", summary: "Short-ranged stun." },
    { id: 7, round: 1, visualInterpolation: "none", summary: "A slash with a wind-up that deals damage and applies a bleed effect." },
    { id: 8, round: 2, visualInterpolation: "none", summary: "Quick burst that deals damage and knocks opponents away." },
    { id: 9, round: 1, visualInterpolation: "none", summary: "A projectile that slows on hit." },
    { id: 10, round: 1, visualInterpolation: "none", summary: "Channel briefly to restore 25 HP." },
    { id: 11, round: 1, visualInterpolation: "linear", summary: "Place one visible, destructible proximity trap." },
    { id: 12, round: 1, visualInterpolation: "none", summary: "Shoots hitscan shot with distance falloff. Faster version of gun but less damage." },
    { id: 13, round: 2, visualInterpolation: "none", summary: "Charge a strong beam that shocks its target." },
    { id: 14, round: 2, visualInterpolation: "linear", summary: "Spawns a gravitational pull zone and explodes after some time." },
    { id: 15, round: 2, visualInterpolation: "linear", summary: "Silences opponents on hit." },
    { id: 16, round: 2, visualInterpolation: "none", summary: "Reduce and reflect damage." },
    { id: 17, round: 2, visualInterpolation: "linear", summary: "Deploy a firing drone that targets the nearest opponent" },
    { id: 18, round: 2, visualInterpolation: "linear", summary: "Fast projectile that pushes bots back." },
    { id: 19, round: 0, visualInterpolation: "linear", standard: true, summary: "Standard 150-unit movement burst; aim it relative to a target or in an arena direction." },
    { id: 20, round: 0, visualInterpolation: "none", standard: true, summary: "Standard ability that rotates your bot to a target instantly." },
    { id: 21, round: 3, visualInterpolation: "none", summary: "Marks position and HP, then return to them after three seconds." },
    { id: 22, round: 3, visualInterpolation: "none", summary: "Shoots explosive strikes at marked zone at multiple intervals." },
    { id: 23, round: 3, visualInterpolation: "none", summary: "Ignore all hostile damage, statuses, interrupts, and displacement temporarily." },
    { id: 24, round: 3, visualInterpolation: "none", summary: "Spawns a zone where bots are silenced if they are inside it." },
    { id: 25, round: 2, visualInterpolation: "linear", summary: "Strike forwards and teleports wielder behind the target it hit." },
    { id: 26, round: 1, visualInterpolation: "none", summary: "Blasts slowing frost around the caster." },
    { id: 27, round: 3, visualInterpolation: "none", summary: "Mark a zone that pulls nearby enemies before detonating." },
    { id: 28, round: 1, visualInterpolation: "linear", summary: "Launch a bolt that deals light damage, pulls once, and slows on contact." },
    { id: 29, round: 1, visualInterpolation: "linear", summary: "Place a destructible 16-second snare that explodes if an opponent bot is within range. If it is destroyed by an attack, it will have a stronger explosion." },
    { id: 30, round: 2, visualInterpolation: "none", summary: "Charge a dart that interrupts and slows on hit." },
    { id: 31, round: 2, visualInterpolation: "linear", summary: "Deploy a drone that shoots repelling lasers." },
    { id: 32, round: 2, visualInterpolation: "none", summary: "Fire a lifesteal beam." },
    { id: 33, round: 3, visualInterpolation: "none", summary: "Reduces cooldown time of all abilities temporarily." },
    { id: 34, round: 0, standard: true, visualInterpolation: "none", summary: "A quick melee attack." },
];

const DELIVERY_TAGS = Object.freeze({
    [DELIVERY_TYPES.SELF]: "self",
    [DELIVERY_TYPES.MELEE]: "melee",
    [DELIVERY_TYPES.RAY]: "ray",
    [DELIVERY_TYPES.PROJECTILE]: "projectile",
    [DELIVERY_TYPES.RADIAL]: "radial",
    [DELIVERY_TYPES.ZONE]: "zone",
    [DELIVERY_TYPES.TRAP]: "trap",
    [DELIVERY_TYPES.SUMMON]: "summon",
});

const CATALOGUE_ENTITY_TAGS = new Set(["zone", "trap", "summon"]);
const STATUS_EFFECT_TYPES = new Set([EFFECT_TYPES.DEBUFF, EFFECT_TYPES.BUFF]);
const POSITIVE_EFFECT_TYPES = new Set([
    EFFECT_TYPES.BUFF,
    EFFECT_TYPES.DAMAGE_REDUCTION,
    EFFECT_TYPES.DAMAGE_IMMUNITY,
    EFFECT_TYPES.DAMAGE_REFLECTION,
]);

function percent(value) {
    const numeric = Number(value) * 100;
    return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function positiveEffectDetailsForEffects(effects) {
    return Object.freeze((effects ?? [])
        .filter((effect) => POSITIVE_EFFECT_TYPES.has(effect.type))
        .map((effect) => {
            if (effect.type === EFFECT_TYPES.DAMAGE_REDUCTION) {
                return Object.freeze({ label: "Damage reduction", value: percent(1 - Number(effect.multiplier ?? effect.amount ?? 0)) });
            }
            if (effect.type === EFFECT_TYPES.DAMAGE_REFLECTION) {
                return Object.freeze({ label: "Damage reflection", value: percent(effect.multiplier ?? effect.amount ?? 0) });
            }
            if (effect.type === EFFECT_TYPES.BUFF && effect.buff === "overclock") {
                return Object.freeze({ label: "Cooldown recovery", value: percent(effect.amount ?? 0) });
            }
            return Object.freeze({ label: "Damage immunity", value: percent(effect.amount ?? 1) });
        }));
}

function abilityCapabilities(ability) {
    const identity = abilityIdentity(ability.id);
    if (!identity) throw new Error(`Unknown ability in catalog: ${ability.id}`);
    const stats = abilityStats(identity.id) ?? {};
    const entity = entityContractForAbility(identity.id);
    const selectableIdentities = selectableIdentitiesForAbilityEntity(entity, identity.id);
    const entityMetadata = entity ? {
        entityType: entity.entityType,
        entityLabel: identity.label,
        entityCategory: entity.category.toLocaleLowerCase(),
    } : {};
    const gameplay = abilityContract(ability.id);
    const catalogueTags = new Set();
    const deliveryTag = DELIVERY_TAGS[gameplay?.delivery?.type];
    if (deliveryTag) catalogueTags.add(deliveryTag);
    if (entityMetadata.entityCategory && CATALOGUE_ENTITY_TAGS.has(entityMetadata.entityCategory)) {
        catalogueTags.add(entityMetadata.entityCategory);
    }
    const effects = gameplay?.effects ?? Object.freeze([]);
    if (effects.some(isStatusEffect)) catalogueTags.add(ABILITY_TAGS.STATUS_EFFECT);
    if (Number(stats.maxCharges) > 0) {
        catalogueTags.add(ABILITY_TAGS.CHARGES);
        catalogueTags.add(stats.chargeType === "hp"
            ? ABILITY_TAGS.HP_CHARGES
            : ABILITY_TAGS.AMMUNITION_CHARGES);
    }
    const tags = new Set([identity.type, ...catalogueTags]);
    if (stats.windupMs) tags.add("wind-up");
    if (stats.beam) tags.add("ray");
    if (stats.durationMs) tags.add("duration");
    tags.add(ability.visualInterpolation === VISUAL_INTERPOLATION.LINEAR ? "interpolated-visual" : "instant-visual");
    return Object.freeze({
        ...ability,
        id: identity.id,
        actions: Object.freeze([identity.id]),
        name: identity.name,
        label: identity.label,
        kind: identity.type,
        ...entityMetadata,
        selectableIdentities,
        stats: Object.freeze({ ...stats }),
        delivery: gameplay?.delivery ?? null,
        effects,
        catalogueTags: Object.freeze([...catalogueTags]),
        buffDetails: positiveEffectDetailsForEffects(effects),
        tags: Object.freeze([...tags]),
    });
}

/** Full runtime metadata, including standard abilities that are not loadout choices. */
export const ALL_ABILITY_DEFINITIONS = Object.freeze(BOT_ABILITY_CATALOG.map(abilityCapabilities));
export const STANDARD_ABILITY_IDS = Object.freeze([19, 20, 34]);
const STANDARD_ABILITY_SET = new Set(STANDARD_ABILITY_IDS);
/** Selectable/configurable ability catalog. Standard abilities are granted separately. */
export const BOT_ABILITIES = Object.freeze(ALL_ABILITY_DEFINITIONS.filter(({ id }) => !STANDARD_ABILITY_SET.has(id)));
export const SELECTABLE_BOT_ABILITIES = BOT_ABILITIES;

const STATUS_EFFECT_LABELS = Object.freeze({
    overclock: "Overclock",
    burn: "Burn",
    stun: "Stun",
    bleed: "Bleed",
    slow: "Slow",
    shock: "Shock",
    silence: "Silence",
});

export const STATUS_EFFECT_DEFINITIONS = Object.freeze([
    ...new Set(ALL_ABILITY_DEFINITIONS.flatMap((ability) => ability.effects
        .filter((effect) => isStatusEffect(effect) && STATUS_EFFECT_LABELS[statusEffectId(effect)])
        .map(statusEffectId))),
].map((id) => Object.freeze({ id, label: STATUS_EFFECT_LABELS[id] })));

export function statusEffectDefinitionsForAbilities(abilityIds) {
    const selected = abilityIds instanceof Set ? abilityIds : new Set(abilityIds ?? []);
    const possible = new Set(ALL_ABILITY_DEFINITIONS
        .filter((ability) => selected.has(ability.id) && ability.tags.includes(ABILITY_TAGS.STATUS_EFFECT))
        .flatMap((ability) => ability.effects
            .filter(isStatusEffect)
            .map(statusEffectId)));
    return STATUS_EFFECT_DEFINITIONS.filter(({ id }) => possible.has(id));
}

function isStatusEffect(effect) {
    return STATUS_EFFECT_TYPES.has(effect?.type);
}

function statusEffectId(effect) {
    return effect?.type === EFFECT_TYPES.BUFF ? effect.buff : effect.debuff;
}

export function abilityDefinition(id) {
    const identity = abilityIdentity(id);
    return identity ? ALL_ABILITY_DEFINITIONS.find((ability) => ability.id === identity.id) ?? null : null;
}

export function shouldInterpolateAbilityVisual(id) {
    return abilityDefinition(id)?.visualInterpolation === VISUAL_INTERPOLATION.LINEAR;
}

export function entitySelectableDefinitions() {
    return ALL_ABILITY_DEFINITIONS.filter((ability) => entityContractForAbility(ability.id));
}

export const ACTION_TO_ABILITY = Object.freeze({
    ...Object.fromEntries(ALL_ABILITY_DEFINITIONS.flatMap((ability) => ability.actions.map((action) => [action, ability.id]))),
});

export const DEFAULT_BOT_LOADOUT = Object.freeze({
    abilities: Object.freeze([]),
});

export function normalizedBotLoadout(loadout) {
    const known = new Set(SELECTABLE_BOT_ABILITIES.map((ability) => ability.id));
    const abilities = [...new Set(normalizeAbilityInputList(loadout?.abilities ?? DEFAULT_BOT_LOADOUT.abilities))]
        .filter((ability) => known.has(ability))
        .slice(0, MAX_EQUIPPED_ABILITIES);
    return { abilities };
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

const ABILITY_CODES = Object.freeze({ 1: "s", 3: "g", 4: "r", 5: "f", 6: "t", 7: "h", 8: "u", 9: "c", 10: "e", 11: "m", 12: "p", 13: "R", 14: "G", 15: "S", 16: "A", 17: "H", 18: "T", 21: "w", 22: "o", 23: "a", 24: "n", 25: "P", 26: "F", 27: "Q", 28: "v", 29: "k", 30: "D", 31: "d", 32: "L", 33: "O" });
const ABILITY_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(ABILITY_CODES).map(([id, code]) => [code, id])));

export function encodeBotLoadout(loadout) {
    const normalized = normalizedBotLoadout(loadout);
    // The compact ID is also the match/replay presentation order. Preserve
    // the normalized selection order so later round picks stay after earlier
    // picks in the ability status panel.
    const abilities = normalized.abilities.map((id) => ABILITY_CODES[id]).filter(Boolean).join("");
    return `custom:${abilities}`;
}

export function decodeBotLoadout(value) {
    if (typeof value !== "string" || !value.startsWith("custom:")) return normalizedBotLoadout(DEFAULT_BOT_LOADOUT);
    const [, abilityCodes = ""] = value.split(":");
    const abilities = [...abilityCodes].map((code) => ABILITY_BY_CODE[code]).filter(Boolean);
    return normalizedBotLoadout({ abilities });
}

export function normalizedSandboxLoadout(loadout) {
    const known = new Set(SELECTABLE_BOT_ABILITIES.map((ability) => ability.id));
    const abilities = [...new Set(normalizeAbilityInputList(loadout?.abilities))]
        .filter((ability) => known.has(ability));
    return { abilities };
}

export function encodeSandboxLoadout(loadout) {
    const normalized = normalizedSandboxLoadout(loadout);
    return `sandbox:${normalized.abilities.join(",")}`;
}

export function decodeSandboxLoadout(value) {
    if (typeof value !== "string" || !value.startsWith("sandbox:")) return normalizedSandboxLoadout(DEFAULT_BOT_LOADOUT);
    const [, abilities = ""] = value.split(":");
    return normalizedSandboxLoadout({ abilities: abilities ? abilities.split(",") : [] });
}

/** Legacy names are accepted only while decoding persisted/API-era loadouts. */
function normalizeAbilityInputList(values) {
    if (!Array.isArray(values)) return [];
    return values.map(abilityIdFromBoundary).filter((id) => id != null);
}
