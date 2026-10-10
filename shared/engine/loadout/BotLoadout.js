import { GAMEPLAY_DATA } from "../gameconfig/gameplayData.js";
import { ABILITY_STATS, abilityStats } from "../gameconfig/Abilities.js";
import { abilityIdentity } from "../gameconfig/AbilityRegistry.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";
import {
    abilityAppliesToOwner,
    phaseEffects as phaseEffectsOf,
    triggerEffects,
    triggerView,
    EFFECT_TYPES,
} from "../ecs/contracts/AbilityContracts.js";
import { entityContractForAbility } from "../ecs/contracts/AbilityContracts.js";
import { selectableIdentitiesForAbilityEntity } from "../modelPayloads/selectableIdentities.js";
import { abilityBaseRange } from "./abilityBaseRange.js";

export { ABILITY_STATS, abilityBaseRange };

export const BASE_BOT_STATS = Object.freeze({
    maxHp: 300,
    moveSpeed: 15,
    attackDamagePercent: 100,
    attackSpeedPercent: 100,
});

/** A weapon plus one ability for each of the six rounds. */
export const MAX_EQUIPPED_ABILITIES = 7;
/**
 * The timed-rounds pick for each round, mirroring the server's MatchLoadoutService: round 1 picks a
 * weapon and one ability, every later round one ability. Rounds 1-2 draw from tier 1, 3-4 from tier 2
 * and 5-6 from tier 3 (the catalog `round` field is the tier); tier 3 offers two, the others three.
 */
export const ROUND_ABILITY_DRAFT = Object.freeze({
    1: Object.freeze({ tier: 1, offered: 3, picks: 1, weaponPick: true }),
    2: Object.freeze({ tier: 1, offered: 3, picks: 1, weaponPick: false }),
    3: Object.freeze({ tier: 2, offered: 3, picks: 1, weaponPick: false }),
    4: Object.freeze({ tier: 2, offered: 3, picks: 1, weaponPick: false }),
    5: Object.freeze({ tier: 3, offered: 2, picks: 1, weaponPick: false }),
    6: Object.freeze({ tier: 3, offered: 2, picks: 1, weaponPick: false }),
});

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
    { id: 1, round: 0, category: "weapon", visualInterpolation: "none", description: "A quick sweeping cut in front of you that hits everything inside the arc.", summary: "No wind-up, 8 damage over a 120° arc with a short reach." },
    { id: 3, round: 1, visualInterpolation: "none", description: "Line up a long-range shot. After a short aiming delay it fires an instant beam that hits the first bot in line for heavy damage. You can keep turning while you aim.", summary: "Hitscan with a 900 ms wind-up, 1200 range and flat 40 damage." },
    { id: 4, round: 1, visualInterpolation: "linear", description: "Throw an explosive that blows up when it hits something, or after a short delay. Damage is highest at the centre of the blast.", summary: "An explosive projectile that triggers on hit or after some duration." },
    { id: 5, round: 1, visualInterpolation: "linear", description: "Hurl a large ball of fire that damages whoever it hits and sets them burning.", summary: "A large projectile with a 5.5 second cooldown that deals 20 damage and applies a burn effect." },
    { id: 6, round: 2, visualInterpolation: "none", description: "A short-range strike that hurts the target and freezes them in place for a moment.", summary: "Short-ranged stun." },
    { id: 7, round: 1, visualInterpolation: "none", description: "A slow, wide swing that hits hard and causes bleeding.", summary: "A slash with preparation time that deals damage and applies a bleed effect." },
    { id: 8, round: 2, visualInterpolation: "none", description: "A burst around you that damages nearby bots and shoves them away.", summary: "Quick burst that deals damage and knocks opponents away." },
    { id: 9, round: 1, visualInterpolation: "none", description: "Charge up a shot that damages the target and slows them down.", summary: "Charge a 20-damage shot that slows its target for 3 seconds." },
    { id: 10, round: 1, visualInterpolation: "none", description: "Stand still for a moment to restore some of your health.", summary: "Channel briefly to restore 25 HP." },
    { id: 11, round: 1, visualInterpolation: "linear", description: "Drop a mine that stays on the arena and hurts any bot that gets close. Enemies can destroy it.", summary: "Place one visible, destructible proximity trap." },
    { id: 12, round: 1, visualInterpolation: "none", description: "A fast-firing beam with lighter damage than the Sniper. It hits harder up close.", summary: "Shoots hitscan shot with distance falloff. Faster than the Sniper but far less damage." },
    { id: 13, round: 2, visualInterpolation: "none", description: "Charge a powerful long beam that damages the target and shocks them.", summary: "Charge a strong beam that shocks its target." },
    { id: 14, round: 2, visualInterpolation: "linear", description: "Throw a grenade that drags bots toward it before it blows up.", summary: "Spawns a gravitational pull zone and explodes after some time." },
    { id: 15, round: 2, visualInterpolation: "linear", description: "Fire a pulse that stops the target from using abilities for a while.", summary: "Silences opponents on hit." },
    { id: 16, round: 2, visualInterpolation: "none", description: "Take less damage for a short time and bounce part of it back at the attacker.", summary: "Reduce and reflect damage." },
    { id: 17, round: 2, visualInterpolation: "linear", description: "Deploy a drone that shoots the nearest opponent for as long as it lasts.", summary: "Deploy a firing drone that targets the nearest opponent" },
    { id: 18, round: 2, visualInterpolation: "linear", description: "Fire a fast blast of wind that damages bots and pushes them back.", summary: "Fast projectile that pushes bots back." },
    { id: 19, round: 0, visualInterpolation: "linear", standard: true, description: "Burst quickly in one direction, relative to a target or along a fixed heading.", summary: "Standard 150-unit movement burst; aim it relative to a target or in an arena direction." },
    { id: 21, round: 3, visualInterpolation: "none", description: "Mark your position and health, then snap back to them a few seconds later.", summary: "Marks position and HP, then return to them after three seconds." },
    { id: 22, round: 3, visualInterpolation: "none", description: "Call down repeated explosions on a marked patch of the arena.", summary: "Shoots explosive strikes at marked zone at multiple intervals." },
    { id: 23, round: 3, visualInterpolation: "none", description: "Become untouchable for a short time: no damage and no status effects.", summary: "Ignore all hostile damage, statuses, interrupts, and displacement temporarily." },
    { id: 24, round: 3, visualInterpolation: "none", description: "Create an area where any bot standing inside cannot use abilities.", summary: "Spawns a zone where bots are silenced if they are inside it." },
    { id: 25, round: 2, visualInterpolation: "linear", description: "Strike forward and, if it connects, teleport behind the target.", summary: "Strike forwards and teleports wielder behind the target it hit." },
    { id: 26, round: 1, visualInterpolation: "none", description: "A ring of frost around you that damages, pushes and slows nearby bots.", summary: "Blast a 120-unit frost ring that deals damage, knockback, and a 2-second slow." },
    { id: 27, round: 3, visualInterpolation: "none", description: "Mark a spot that drags nearby bots toward it, then detonates.", summary: "Mark a zone that pulls nearby enemies before detonating." },
    { id: 28, round: 1, visualInterpolation: "linear", description: "Launch a bolt that tugs the target back toward you and slows them.", summary: "Launch a bolt that deals light damage, pulls once, and slows on contact." },
    { id: 29, round: 1, visualInterpolation: "linear", description: "Plant a trap that slows and hurts bots that touch it. It hits even harder if it is destroyed.", summary: "Place a destructible 16-second snare that deals 25 damage on contact or 40 damage when destroyed, with a stronger explosion on destruction." },
    { id: 30, round: 2, visualInterpolation: "none", description: "Charge a dart that interrupts what the target is doing and slows them.", summary: "Charge a 20-damage dart that interrupts and slows its target for 1.5 seconds." },
    { id: 31, round: 2, visualInterpolation: "linear", description: "Deploy a drone that fires lasers that push opponents away.", summary: "Deploy a drone that shoots repelling lasers." },
    { id: 32, round: 2, visualInterpolation: "none", description: "Fire a beam that damages the target and heals you for the damage it deals.", summary: "Fire a lifesteal beam." },
    { id: 33, round: 3, visualInterpolation: "none", description: "Recover faster for a while, so all your abilities come back sooner.", summary: "Reduces cooldown time of all abilities temporarily." },
    // Weapons are never match-draft offers (round 0, not standard); Slash alone stays in the tier 1 pool.
    { id: 35, round: 0, category: "weapon", visualInterpolation: "none", description: "A thin, straight stab with the longest reach of any weapon. It only connects if you are facing the target.", summary: "10 damage along a narrow 190-unit line after a short wind-up." },
    { id: 36, round: 0, category: "weapon", visualInterpolation: "none", description: "A slow, wide swing that hits harder than any other weapon. The long wind-up gives opponents time to dodge.", summary: "15 damage over a 160° arc after a 500 ms wind-up." },
    { id: 37, round: 0, category: "weapon", visualInterpolation: "none", description: "A boxy overhead blow that hurts and shoves the target away from you.", summary: "11 damage and 120 knockback in a wide rectangle after a short wind-up." },
];

const CATALOGUE_ENTITY_TAGS = new Set(["projectile", "zone", "trap", "summon"]);
const STATUS_EFFECT_TYPES = new Set([EFFECT_TYPES.STATUS, EFFECT_TYPES.BUFF]);
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
    const catalogueTags = new Set();
    const phaseTag = phaseCatalogueTag(ability.id, entity, entityMetadata.entityCategory);
    if (phaseTag) catalogueTags.add(phaseTag);
    if (entityMetadata.entityCategory && CATALOGUE_ENTITY_TAGS.has(entityMetadata.entityCategory)
        && entityMetadata.entityCategory !== phaseTag) {
        catalogueTags.add(entityMetadata.entityCategory);
    }
    const entityEffects = (entity?.phases ?? []).flatMap(phaseEffectsOf);
    const effects = Object.freeze([...triggerEffects(ability.id), ...entityEffects]
        .filter((effect, index, values) => values.findIndex((candidate) =>
            JSON.stringify(candidate) === JSON.stringify(effect)) === index));
    if (effects.some(isStatusEffect)) catalogueTags.add(ABILITY_TAGS.STATUS_EFFECT);
    if (Number(stats.maxCharges) > 0) {
        catalogueTags.add(ABILITY_TAGS.CHARGES);
        if (stats.chargeType === "hp") catalogueTags.add(ABILITY_TAGS.HP_CHARGES);
    }
    const tags = new Set([identity.type, ...catalogueTags]);
    if (ability.category === "weapon") tags.add("weapon");
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
        category: ability.category ?? "ability",
        actionLabel: `${ability.category === "weapon" ? "Weapon" : "Ability"}: ${identity.label}`,
        catalogueLabel: ability.category === "weapon" ? `Weapon: ${identity.label}` : identity.label,
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
    const hitbox = entity ? phase.hitbox : triggerView(abilityId)?.hitbox;
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
    return effect?.type === EFFECT_TYPES.BUFF ? effect.buff : effect.subtype;
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
