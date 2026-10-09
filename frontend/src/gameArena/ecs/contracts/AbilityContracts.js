import { abilityId as resolveAbilityId } from "../../gameconfig/AbilityRegistry.js";
import { GAMEPLAY_DATA, deepFreeze, withoutNulls } from "../../gameconfig/gameplayData.js";
import { validateGameplayData } from "../../gameconfig/gameplayValidation.js";

/**
 * The allowlisted ability registry. An ability is data: `onTrigger` verbs that run when its wind-up ends, and
 * `entities` that its `spawn` verbs create. An entity is a list of phases whose events run the same verbs.
 * Nothing here executes user-provided code; verbs.js is the one executor.
 */
export const ENTITY_CATEGORIES = Object.freeze({
    PROJECTILE: "projectile",
    ZONE: "zone",
    TRAP: "trap",
    SUMMON: "summon",
});

/** Effect vocabulary. Concrete effect payloads live on the verbs that apply them. */
export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    HEALING: "healing",
    KNOCKBACK: "knockback",
    PULL: "pull",
    STATUS: "status",
    BUFF: "buff",
    INTERRUPT: "interrupt",
    TELEPORT: "teleport",
    RESTORE_STATE: "restore_state",
    DAMAGE_REDUCTION: "damage_reduction",
    DAMAGE_IMMUNITY: "damage_immunity",
    DAMAGE_REFLECTION: "damage_reflection",
});

/** Phase host vocabulary of entity phases. */
export const PHASE_TYPES = Object.freeze({
    PROJECTILE: "projectile",
    ZONE: "zone",
    SUMMON: "summon",
});

export const PHASE_EVENT_TYPES = Object.freeze({
    COLLISION: "collision",
    TRIGGER: "trigger",
    HIT: "hit",
    KILLED: "killed",
    LIFETIME_END: "lifetimeEnd",
    SCHEDULE: "schedule",
});

/** Determines when any phase event is evaluated. */
export const EVENT_SCHEDULE_MODES = Object.freeze({
    ONCE: "once",
    REPEAT: "repeat",
    CONTINUOUS: "continuous",
});

export const SPAWN_ROTATION_SPACES = Object.freeze({
    OWNER: "owner",
    WORLD: "world",
});

/** The verbs of `onTrigger` lists and entity event `do` lists. */
export const VERBS = Object.freeze({
    HIT: "hit",
    SPAWN: "spawn",
    MOVE: "move",
    FACE: "face",
    APPLY_EFFECTS: "applyEffects",
    TRANSITION: "transition",
    REMOVE: "remove",
    EMIT_VISUAL: "emitVisual",
});

export const MOVEMENT_MODES = Object.freeze({
    STRAIGHT: "straight",
    STATIC: "static",
    SEEK: "seek",
    FOLLOW_OWNER: "followOwner",
});

export const SPAWN_PATTERN_TYPES = Object.freeze({
    FAN: "fan",
    RING: "ring",
    LINE: "line",
});

export const TARGET_POLICY_MODES = Object.freeze({
    ONCE: "once",
    EVERY_TICK: "everyTick",
    INTERVAL: "interval",
});

/** Semantic target categories used by verbs and entity collision events. */
export const TARGET_KINDS = Object.freeze({
    BOT: "BOT",
    HP_ENTITY: "HP_ENTITY",
    SUMMON: "SUMMON",
    ENTITY: "ENTITY",
});

/** A verb's `targets` list names this to apply to the bot that owns the ability instead of to hit targets. */
export const OWNER_TARGET = "OWNER";

export const BOT_TARGET_KINDS = Object.freeze([TARGET_KINDS.BOT]);
export const DAMAGE_TARGET_KINDS = Object.freeze([TARGET_KINDS.BOT, TARGET_KINDS.HP_ENTITY]);
export const BOT_AND_SUMMON_TARGET_KINDS = Object.freeze([TARGET_KINDS.BOT, TARGET_KINDS.SUMMON]);

export const TELEPORT_DISTANCE_MODES = Object.freeze({
    CENTER_DISTANCE: "center_distance",
});

const SUMMON_SUPPORTED_EFFECT_TYPES = new Set([
    EFFECT_TYPES.DAMAGE,
    EFFECT_TYPES.STATUS,
    EFFECT_TYPES.INTERRUPT,
    EFFECT_TYPES.KNOCKBACK,
    EFFECT_TYPES.PULL,
]);
const HP_ENTITY_SUPPORTED_EFFECT_TYPES = new Set([
    EFFECT_TYPES.DAMAGE,
    EFFECT_TYPES.KNOCKBACK,
    EFFECT_TYPES.PULL,
]);

function defaultEffectTargetKinds(type) {
    return type === EFFECT_TYPES.DAMAGE ? DAMAGE_TARGET_KINDS : BOT_TARGET_KINDS;
}

export const effect = (type, values = {}) => Object.freeze({
    type,
    ...values,
    targetKinds: Object.freeze([...new Set(
        (Array.isArray(values.targetKinds) && values.targetKinds.length > 0
            ? values.targetKinds : defaultEffectTargetKinds(type))
            .filter((kind) => Object.values(TARGET_KINDS).includes(kind)),
    )]),
});
export const statusEffect = (subtype, values = {}) => effect(EFFECT_TYPES.STATUS, { subtype, ...values });

/** An event's `targets` list says who the event reaches. An event that lists none reaches bots only. */
export function eventTargetsKind(event, targetKind) {
    const targets = event?.targets;
    return !Array.isArray(targets) || targets.length === 0
        ? targetKind === TARGET_KINDS.BOT
        : targets.includes(targetKind);
}

/** Event target kinds are capabilities; summons also carry HP_ENTITY and ENTITY. */
export function eventTargetsEntity(event, targetKinds) {
    const declared = event?.targets;
    return Array.isArray(declared) && declared.length > 0
        && declared.some((kind) => targetKinds.includes(kind));
}

/** Returns the stable contract capabilities of a non-bot arena entity. */
export function targetKindsForEntity(entity) {
    const targetKinds = [TARGET_KINDS.ENTITY];
    if (entity?.hp != null) targetKinds.push(TARGET_KINDS.HP_ENTITY);
    if (entityContract(entity)?.category === ENTITY_CATEGORIES.SUMMON) {
        targetKinds.push(TARGET_KINDS.SUMMON);
    }
    return targetKinds;
}

/** Effect target kinds are intersected with the target's supported capabilities. */
export function effectTargetsTarget(effectValue, targetKinds) {
    if (!effectValue?.type || !Array.isArray(targetKinds)) return false;
    const declared = Array.isArray(effectValue.targetKinds) && effectValue.targetKinds.length > 0
        ? effectValue.targetKinds : defaultEffectTargetKinds(effectValue.type);
    if (targetKinds.includes(TARGET_KINDS.BOT)
        && declared.includes(TARGET_KINDS.BOT)) return true;
    if (targetKinds.includes(TARGET_KINDS.SUMMON)
        && declared.includes(TARGET_KINDS.SUMMON)
        && SUMMON_SUPPORTED_EFFECT_TYPES.has(effectValue.type)) return true;
    if (targetKinds.includes(TARGET_KINDS.HP_ENTITY)
        && declared.includes(TARGET_KINDS.HP_ENTITY)
        && HP_ENTITY_SUPPORTED_EFFECT_TYPES.has(effectValue.type)) return true;
    return effectValue.type === EFFECT_TYPES.DAMAGE
        && targetKinds.includes(TARGET_KINDS.ENTITY)
        && declared.includes(TARGET_KINDS.ENTITY);
}

/** The effects a list of verbs applies, in declaration order. */
export function verbEffects(verbs) {
    return (verbs ?? []).flatMap((verb) => verb?.effects ?? []);
}

/** The verbs of one entity event. */
export function eventVerbs(event) {
    return event?.do ?? [];
}

/**
 * The effects every event of one entity phase applies to its event targets (its `applyEffects` verbs). The
 * effects of a `hit` verb, such as a summon's shot, belong to that verb.
 */
export function phaseEffects(phase) {
    return Object.values(phase?.on ?? {}).flatMap((event) =>
        verbEffects(eventVerbs(event).filter((verb) => verb.do === VERBS.APPLY_EFFECTS)));
}

/** The first verb of `kind` in a verb list. */
export function findVerb(verbs, kind) {
    return (verbs ?? []).find((verb) => verb?.do === kind) ?? null;
}

// --- registry -------------------------------------------------------------------------------------------

function entityFromData(abilityId, entityType, entity) {
    return {
        ...withoutNulls(entity),
        abilityId,
        entityType,
        // A phase with `"visual": null` is hidden; the key must stay to tell it from a phase that declares none.
        phases: (entity.phases ?? []).map((phase) => ({ ...withoutNulls(phase), visual: phase.visual ? withoutNulls(phase.visual) : null })),
    };
}

function contractFromData(ability) {
    const entities = Object.fromEntries(Object.entries(ability.entities ?? {})
        .map(([entityType, entity]) => [entityType, entityFromData(ability.id, entityType, entity)]));
    const onTrigger = (ability.onTrigger ?? []).map((verb) => withoutNulls(verb));
    const spawned = findVerb(onTrigger, VERBS.SPAWN)?.entity;
    return {
        abilityId: ability.id,
        activation: withoutNulls(ability.activation ?? {}),
        onTrigger,
        entities,
        primaryEntity: spawned && entities[spawned] ? spawned : Object.keys(entities)[0] ?? null,
    };
}

function buildRegistry(abilityList) {
    const contracts = {};
    const entities = {};
    for (const ability of abilityList) {
        const contract = contractFromData(ability);
        contract.hitVerbList = contract.onTrigger.filter((verb) => verb.do === VERBS.HIT);
        for (const entity of Object.values(contract.entities)) {
            entity.phasesById = Object.fromEntries(entity.phases.map((phase) => [phase.id, phase]));
        }
        contracts[ability.id] = contract;
        if (contract.primaryEntity) entities[ability.id] = contract.entities[contract.primaryEntity];
    }
    const byType = {};
    for (const contract of Object.values(contracts)) {
        for (const entity of Object.values(contract.entities)) {
            byType[entity.entityType] = entity;
            byType[entity.runtimeType] ??= entity;
        }
    }
    byType.staticSnare = entities[29];
    byType.static_snare = entities[29];
    return { contracts, entities, byType };
}

let registry = buildRegistry(GAMEPLAY_DATA.abilities.abilities);
export const ABILITY_CONTRACTS = deepFreeze(registry.contracts);

/** Ability ID -> the entity the ability's `spawn` verb creates (abilities that spawn nothing are absent). */
export const ENTITY_CONTRACTS = deepFreeze(registry.entities);

/**
 * Runs `fn` with extra abilities (written in the abilities.json schema) in the registry: an ability whose id
 * is already used replaces the shipped one, a new id is added. The extra data goes through the same
 * validation as the shared files. For tests.
 */
export function withTestAbilities(extraAbilities, fn) {
    const replaced = new Set(extraAbilities.map(({ id }) => id));
    const merged = {
        ...GAMEPLAY_DATA,
        abilities: {
            ...GAMEPLAY_DATA.abilities,
            abilities: [
                ...GAMEPLAY_DATA.abilities.abilities.filter(({ id }) => !replaced.has(id)),
                ...extraAbilities,
            ],
        },
    };
    validateGameplayData(merged);
    const previous = registry;
    registry = buildRegistry(merged.abilities.abilities);
    try {
        return fn();
    } finally {
        registry = previous;
    }
}

function numericAbilityId(value) {
    const candidate = value && typeof value === "object" ? value.abilityId : value;
    if (Number.isSafeInteger(candidate)) return candidate;
    return resolveAbilityId(candidate);
}

export function abilityContract(value) {
    const numericId = numericAbilityId(value);
    return numericId == null ? null : registry.contracts[numericId] ?? null;
}

const NO_VERBS = Object.freeze([]);

/** The verbs that run when the ability triggers. */
export function triggerVerbs(value) {
    return abilityContract(value)?.onTrigger ?? [];
}

/** True when the ability has a verb of `kind`. */
export function abilityHasVerb(value, kind) {
    return findVerb(triggerVerbs(value), kind) != null;
}

/** True when the ability spawns arena entities. */
export function isEntityAbility(value) {
    return abilityHasVerb(value, VERBS.SPAWN);
}

/** True when every effect of the ability's trigger lands on its owner (heal, buffs, rewind). */
export function abilityAppliesToOwner(value) {
    return triggerVerbs(value).some((verb) => verb.do === VERBS.APPLY_EFFECTS
        && (verb.targets ?? []).includes(OWNER_TARGET));
}

/** The trigger `hit` verbs of an ability. */
export function hitVerbs(value) {
    return abilityContract(value)?.hitVerbList ?? NO_VERBS;
}

/** The effects the ability applies when it triggers (excluding what its entities apply later). */
export function triggerEffects(value) {
    return verbEffects(triggerVerbs(value));
}

/**
 * Read-only summary of an ability's trigger verbs for the UI, ranges and presentation: the first hitbox,
 * visual and move, plus its effects. Gameplay never reads this; verbs.js runs the verbs themselves.
 */
export function triggerView(value) {
    const verbs = triggerVerbs(value);
    if (verbs.length === 0) return null;
    const hit = findVerb(verbs, VERBS.HIT);
    const move = findVerb(verbs, VERBS.MOVE);
    return {
        hitbox: hit?.hitbox ?? null,
        move,
        visual: verbs.find((verb) => verb.visual)?.visual ?? null,
        effects: verbEffects(verbs),
        origin: hit?.origin ?? null,
    };
}

/** The entity definition for an ability ID, an entity type, a runtime type or an entity payload. */
export function entityContract(value) {
    if (value && typeof value === "object") {
        if (value.phases && value.runtimeType) return value;
        const owner = registry.contracts[value.entityContractId ?? value.abilityId];
        const key = value.entityKey ?? value.entityContractType;
        if (owner) {
            if (key && owner.entities[key]) return owner.entities[key];
            if (owner.primaryEntity) return owner.entities[owner.primaryEntity];
        }
        const fromType = value.entityContractType ?? value.type;
        return fromType != null ? registry.byType[fromType] ?? null : null;
    }
    const numericId = numericAbilityId(value);
    if (numericId != null) return registry.entities[numericId] ?? null;
    return registry.byType[value] ?? null;
}

export function entityContractForAbility(abilityValue) {
    return entityContract(abilityValue?.abilityId ?? abilityValue);
}

/** Returns the canonical lifecycle phases for an entity or entity payload. */
export function phasesForEntity(value) {
    const contract = entityContract(value);
    return Array.isArray(contract?.phases) ? contract.phases : [];
}

/** Resolves explicit phase state, falling back to the contract's first phase. */
export function phaseForEntity(value) {
    const phases = phasesForEntity(value);
    if (phases.length === 0) return null;
    if (value?.phaseId != null) {
        const explicit = phaseById(value, value.phaseId);
        if (explicit) return explicit;
    }
    return phases[0];
}

export function phaseTypeForEntity(value) {
    return phaseForEntity(value)?.type ?? null;
}

export function phaseById(value, phaseId) {
    const contract = entityContract(value);
    if (contract?.phasesById) return contract.phasesById[phaseId] ?? null;
    return phasesForEntity(value).find((phaseValue) => phaseValue.id === phaseId) ?? null;
}

/** The `hit` verb of an entity phase's timer event (a summon's shot), or null. */
export function scheduledHitVerb(phase) {
    return findVerb(eventVerbs(phase?.on?.[PHASE_EVENT_TYPES.SCHEDULE]), VERBS.HIT);
}

/** The shot of a summon entity: where it fires from and how it looks. */
export function entityShot(value) {
    const verb = scheduledHitVerb(phaseForEntity(value));
    return verb ? { hitbox: verb.hitbox, origin: verb.origin, visual: verb.visual ?? null } : null;
}

/** The numeric speed of a phase's straight/seek movement (units per tick), 0 when it does not move. */
export function phaseSpeed(phase) {
    const movement = phase?.movement;
    if (!movement || movement.mode === MOVEMENT_MODES.STATIC || movement.mode === MOVEMENT_MODES.FOLLOW_OWNER) {
        return 0;
    }
    return Number(movement.unitsPerTick ?? 0);
}
