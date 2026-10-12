import { GAMEPLAY_DATA } from "../gameconfig/gameplayData.js";
import { ABILITY_STATS, abilityStats } from "../gameconfig/Abilities.js";
import { positiveStatusEffects } from "../gameconfig/StatusPresets.js";
import { abilityIdentity } from "../gameconfig/AbilityRegistry.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";
import {
    abilityAppliesToOwner,
    phaseEffects as phaseEffectsOf,
    activationEffects,
    activationView,
    EFFECT_TYPES,
} from "../ecs/contracts/AbilityContracts.js";
import { entityContractForAbility } from "../ecs/contracts/AbilityContracts.js";
import { selectableIdentitiesForAbilityEntity } from "../modelPayloads/selectableIdentities.js";
import { abilityBaseRange } from "./abilityBaseRange.js";

export { ABILITY_STATS, abilityBaseRange };

export const BASE_BOT_STATS = Object.freeze({
    maxHp: 225,
    moveSpeed: 15,
    attackDamagePercent: 100,
    attackSpeedPercent: 100,
});

/** Loadout encoding also serves practice and puzzles; match kits are validated separately. */
export const MAX_EQUIPPED_ABILITIES = 7;
export const ROUND_ABILITY_UNLOCK = Object.freeze({
    1: Object.freeze({ tier: 1, weapon: true }),
    2: Object.freeze({ tier: null, weapon: false }),
    3: Object.freeze({ tier: 2, weapon: false }),
    4: Object.freeze({ tier: null, weapon: false }),
    5: Object.freeze({ tier: 3, weapon: false }),
    6: Object.freeze({ tier: null, weapon: false }),
});

/** The combat subset; the brain's loadout remains the full kit. */
export function unlockedKitLoadout(kit, roundNumber) {
    const tier = Math.ceil(Math.max(1, Math.min(6, roundNumber)) / 2);
    return { abilities: normalizedBotLoadout(kit).abilities.filter((id) => {
        const ability = abilityDefinition(id);
        return ability.category === "weapon" || ability.round <= tier;
    }) };
}

export const VISUAL_INTERPOLATION = Object.freeze({
    NONE: "none",
    LINEAR: "linear",
});

export const ABILITY_TAGS = Object.freeze({
    CHARGES: "charges",
    HP_CHARGES: "hp-charges",
    STATUS_EFFECT: "status-effect",
    RANGE: "has-range",
});

const BOT_ABILITY_CATALOG = [
    { id: 1, visualInterpolation: "none", description: "A quick sweeping cut in front of you that hits everything inside the arc.", summary: "No wind-up, 8 damage over a 120° arc with a short reach." },
    { id: 3, visualInterpolation: "none", description: "Line up a long-range shot. After a short aiming delay it fires an instant beam that hits the first bot in line for heavy damage. You can keep turning while you aim.", summary: "Hitscan beam after a long aiming delay, with the longest reach of any ability." },
    { id: 4, visualInterpolation: "linear", description: "Throw an explosive that blows up when it hits something, or after a short delay. Damage is highest at the centre of the blast.", summary: "An explosive projectile that triggers on hit or after some duration." },
    { id: 5, visualInterpolation: "linear", description: "Hurl a large ball of fire that damages whoever it hits and sets them burning.", summary: "A large projectile with a 5.5 second cooldown that deals 20 damage and applies a burn effect." },
    { id: 6, visualInterpolation: "none", description: "A short-range strike that hurts the target and freezes them in place for a moment.", summary: "Short-ranged stun." },
    { id: 8, visualInterpolation: "none", description: "A burst around you that damages nearby bots and shoves them away.", summary: "Quick burst that deals damage and knocks opponents away." },
    { id: 15, visualInterpolation: "linear", description: "Fire a pulse that damages the target and stops it from using abilities for a while.", summary: "Damaging pulse that silences opponents on hit." },
    { id: 17, visualInterpolation: "linear", description: "Deploy a drone that shoots the nearest opponent for as long as it lasts.", summary: "Deploy a firing drone that targets the nearest opponent" },
    { id: 18, visualInterpolation: "linear", description: "Fire a fast blast of wind that damages bots and pushes them back.", summary: "Fast projectile that pushes bots back." },
    { id: 19, visualInterpolation: "linear", standard: true, description: "Burst quickly in one direction, relative to a target or along a fixed heading.", summary: "Standard 150-unit movement burst; aim it relative to a target or in an arena direction." },
    { id: 21, visualInterpolation: "none", description: "Mark your position and health, then snap back to them a few seconds later.", summary: "Marks position and HP, then snaps back to them later." },
    { id: 22, visualInterpolation: "none", description: "Mark a spot in the arena. After a short warning, one big blast damages and stuns anything still standing inside it.", summary: "Marks a spot, then one blast hits anything standing inside it." },
    { id: 25, visualInterpolation: "linear", description: "Strike forward and, if it connects, blink through the target. A moment later, strike again from behind for extra damage if you are still behind it.", summary: "Blinks through the target, then strikes again from behind." },
    { id: 26, visualInterpolation: "none", description: "A ring of frost around you that damages, pushes and slows nearby bots.", summary: "A ring of frost that damages, pushes back and slows nearby bots." },
    { id: 27, visualInterpolation: "none", description: "Mark a spot that drags nearby bots toward it, then detonates.", summary: "Mark a zone that pulls nearby enemies before detonating." },
    { id: 28, visualInterpolation: "linear", description: "Launch a bolt that tugs the target back toward you and slows them.", summary: "Launch a bolt that deals light damage, pulls once, and slows on contact." },
    { id: 29, visualInterpolation: "linear", description: "Plant a trap that slows and hurts bots that touch it. It hits even harder if it is destroyed.", summary: "Place a destructible 16-second snare that deals 25 damage on contact or 40 damage when destroyed, with a stronger explosion on destruction." },
    { id: 30, visualInterpolation: "none", description: "Charge a dart that slows the target. If the target was winding up an ability, the dart also stuns it for longer.", summary: "Charge a dart that slows its target, and stuns it if it was winding up." },
    { id: 32, visualInterpolation: "none", description: "Fire a beam that damages the target and heals you for the damage it deals.", summary: "Fire a lifesteal beam." },
    // Weapons occupy the fixed kit weapon slot, separate from all three tiers.
    { id: 35, visualInterpolation: "none", description: "A thin, straight stab with the longest reach of any weapon. It only connects if you are facing the target.", summary: "10 damage along a narrow 190-unit line after a short wind-up." },
    { id: 36, visualInterpolation: "none", description: "A slow, wide swing that hits harder than any other weapon. The long wind-up gives opponents time to dodge.", summary: "15 damage over a 160° arc after a 500 ms wind-up." },
    { id: 37, visualInterpolation: "none", description: "A boxy overhead blow that hurts and shoves the target away from you.", summary: "11 damage and 120 knockback in a wide rectangle after a short wind-up." },
    { id: 38, visualInterpolation: "linear", description: "Crouch, then leap forward and stab with a blade that makes the target bleed. The crouch is your tell.", summary: "A crouch, a leap forward, then a stab that causes bleeding." },
    { id: 39, visualInterpolation: "linear", description: "Fire a close fan of pellets. They hit hard together at close range and do little once they spread out.", summary: "A short-range fan of pellets after a short wind-up." },
    { id: 40, visualInterpolation: "linear", description: "Throw a boomerang that flies straight out, then curves back to you. It can hit an enemy on the way out and again on the way back.", summary: "Flies out, then returns to you; can hit on the way out and on the way back." },
    { id: 41, visualInterpolation: "none", description: "Brace for the next attack that damages you. It does no damage, and the bot that attacked you is stunned for a moment. Parry only one attack at a time, and it lasts a short moment.", summary: "Blocks the next attack and stuns its attacker." },
    { id: 42, visualInterpolation: "none", description: "For a short time every stamina cost is free, so you can dash, sprint and turn without running dry.", summary: "Stamina costs are free for a short time." },
    { id: 43, visualInterpolation: "linear", description: "Throw a tar glob at a spot in front of you. It forms a pool that slows bots standing in it and wears them down.", summary: "A pool that slows and damages bots standing in it." },
    { id: 44, visualInterpolation: "none", description: "Charge your weapon for a short time: all your damage is doubled while it lasts, and each weapon hit uses up one of the charges.", summary: "Doubles all your damage for a few weapon hits." },
    { id: 45, visualInterpolation: "none", description: "Wind up a long, visible strike. It hits much harder when the target is low on health.", summary: "A long strike after a long wind-up that hits much harder on a low-health target." },
    { id: 46, visualInterpolation: "linear", description: "Throw a ring of blades that fly outward, then curve back to you. Each blade can hit an enemy once on the way out and once on the way back.", summary: "A ring of blades that fly out and return to you, each able to hit on both legs." },
    { id: 47, visualInterpolation: "linear", description: "Fire a bolt that tethers the first bot it hits. A tethered bot takes more damage and is pulled back toward you whenever it strays too far.", summary: "A bolt that tethers a bot and pulls it back when it strays." },
];

const CATALOGUE_ENTITY_TAGS = new Set(["projectile", "zone", "trap", "summon"]);
const STATUS_EFFECT_TYPES = new Set([EFFECT_TYPES.STATUS]);
const POSITIVE_EFFECT_LABELS = Object.freeze({
    damage_reduction: "Damage reduction",
    damage_reflection: "Damage reflection",
    damage_immunity: "Damage immunity",
    cooldown_recovery: "Cooldown recovery",
});

function percent(value) {
    const numeric = Number(value) * 100;
    return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** The player-facing numbers of an ability's status effects, read from each applied status preset. */
function positiveEffectDetailsForEffects(effects) {
    return Object.freeze((effects ?? [])
        .filter((effect) => effect.type === EFFECT_TYPES.STATUS)
        .flatMap((effect) => positiveStatusEffects(effect.subtype))
        .map(({ kind, value }) => Object.freeze({ label: POSITIVE_EFFECT_LABELS[kind], value: percent(value) })));
}

function abilityCapabilities(ability) {
    const identity = abilityIdentity(ability.id);
    if (!identity) throw new Error(`Unknown ability in catalog: ${ability.id}`);
    // Tier and weapon are data (abilities.json); the catalogue text does not repeat them.
    const record = GAMEPLAY_DATA.abilities.abilities.find((candidate) => candidate.id === identity.id);
    if (!record) throw new Error(`Ability ${identity.id} has no abilities.json record`);
    const round = record.tier ?? 0;
    const category = record.weapon ? "weapon" : "ability";
    const stats = abilityStats(identity.id) ?? {};
    const entity = entityContractForAbility(identity.id);
    const selectableIdentities = selectableIdentitiesForAbilityEntity(entity, identity.id);
    const entityMetadata = entity ? {
        entityType: entity.entityType,
        entityLabel: identity.label,
        entityCategory: entity.category.toLocaleLowerCase(),
    } : {};
    const catalogueTags = new Set();
    const phaseTag = phaseCatalogueTag(ability.id, entity, entityMetadata.entityCategory);
    if (phaseTag) catalogueTags.add(phaseTag);
    if (entityMetadata.entityCategory && CATALOGUE_ENTITY_TAGS.has(entityMetadata.entityCategory)
        && entityMetadata.entityCategory !== phaseTag) {
        catalogueTags.add(entityMetadata.entityCategory);
    }
    const entityEffects = (entity?.phases ?? []).flatMap(phaseEffectsOf);
    // A conditional effect (one with `when`) is a bonus on some hits, so the catalogue does not list it as a base effect.
    const effects = Object.freeze([...activationEffects(ability.id), ...entityEffects]
        .filter((effect, index, values) => !effect?.when && values.findIndex((candidate) =>
            JSON.stringify(candidate) === JSON.stringify(effect)) === index));
    if (effects.some(isStatusEffect)) catalogueTags.add(ABILITY_TAGS.STATUS_EFFECT);
    if (Number(stats.maxCharges) > 0) {
        catalogueTags.add(ABILITY_TAGS.CHARGES);
        if (stats.chargeType === "hp") catalogueTags.add(ABILITY_TAGS.HP_CHARGES);
    }
    const tags = new Set([identity.type, ...catalogueTags]);
    if (category === "weapon") tags.add("weapon");
    if (abilityBaseRange(ability.id) != null) tags.add(ABILITY_TAGS.RANGE);
    if (stats.windupMs) tags.add("preparation");
    if (stats.durationMs) tags.add("duration");
    tags.add(ability.visualInterpolation === VISUAL_INTERPOLATION.LINEAR ? "interpolated-visual" : "instant-visual");
    return Object.freeze({
        ...ability,
        id: identity.id,
        actions: Object.freeze([identity.id]),
        name: identity.name,
        label: identity.label,
        kind: identity.type,
        round,
        category,
        actionLabel: `${category === "weapon" ? "Weapon" : "Ability"}: ${identity.label}`,
        catalogueLabel: category === "weapon" ? `Weapon: ${identity.label}` : identity.label,
        ...entityMetadata,
        selectableIdentities,
        stats: Object.freeze({ ...stats }),
        phaseTag,
        effects,
        catalogueTags: Object.freeze([...catalogueTags]),
        buffDetails: positiveEffectDetailsForEffects(effects),
        tags: Object.freeze([...tags]),
    });
}

/** Display-only classification derived from the phase host and hitbox. */
function phaseCatalogueTag(abilityId, entity, entityCategory) {
    const phase = entity?.phases?.[0];
    if (entity && !phase) return entityCategory ?? null;
    if (entityCategory && ["projectile", "zone", "summon"].includes(phase?.type)) return phase.type;
    if (!entity && abilityAppliesToOwner(abilityId)) return "self";
    const hitbox = entity ? phase.hitbox : activationView(abilityId)?.hitbox;
    if (!hitbox?.shape) return "self";
    switch (hitbox.shape) {
        case "ray": return "ray";
        case "arc":
        case "rectangle": return "melee";
        case "circle": return "radial";
        default: return null;
    }
}

/** Full runtime metadata, including standard abilities that are not loadout choices. */
export const ALL_ABILITY_DEFINITIONS = Object.freeze(BOT_ABILITY_CATALOG.map(abilityCapabilities));
/** Abilities every bot has without equipping them (`"standard": true` in abilities.json): Dash. */
export const STANDARD_ABILITY_IDS = Object.freeze(GAMEPLAY_DATA.abilities.abilities.filter((ability) => ability.standard).map(({ id }) => id));
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
    overdrive: "Overdrive",
    parry: "Parry",
    overcharge: "Overcharge",
    tethered: "Tethered",
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
    return effect.subtype;
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

/** One-character loadout codes (`code` in shared/gameplay/abilities.json); Spring decodes the same codes. */
const ABILITY_CODES = Object.freeze(Object.fromEntries(GAMEPLAY_DATA.abilities.abilities.filter(({ code }) => code).map(({ id, code }) => [id, code])));
const ABILITY_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(ABILITY_CODES).map(([id, code]) => [code, Number(id)])));

export function encodeBotLoadout(loadout) {
    const normalized = normalizedBotLoadout(loadout);
    // The compact ID is also the match/replay presentation order. Preserve
    // the normalized order: weapon, tier 1, tier 2, tier 3 for a match kit.
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
