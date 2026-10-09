import { abilityId } from "./AbilityRegistry.js";
import { GAMEPLAY_DATA, withoutNulls } from "./gameplayData.js";
import {
    EFFECT_TYPES,
    entityContractForAbility,
    findVerb,
    PHASE_EVENT_TYPES,
    phaseEffects,
    scheduledHitVerb,
    triggerEffects,
    triggerVerbs,
    VERBS,
} from "../ecs/contracts/AbilityContracts.js";

// Ability-level timing and resource metadata (shared/gameplay/abilities.json). Behavior that can change while
// an ability is active belongs to a phase contract, not this catalog.
const ABILITY_TIMING_BY_ID = Object.freeze(Object.fromEntries(GAMEPLAY_DATA.abilities.abilities.map(
    ({ id, timing }) => [id, Object.freeze(withoutNulls(timing))],
)));

/**
 * The read model the stats below are projected from: for an ability that spawns an entity, the entity's phases
 * (each with the effects its events apply); for any other ability, one phase built from its trigger verbs.
 * `embeddedPhase` is the shot a summon fires from its timer event.
 */
function phasesFor(abilityValue) {
    const id = abilityId(abilityValue);
    if (id == null) return [];
    const entity = entityContractForAbility(id);
    if (entity?.phases?.length) {
        return entity.phases.map((phase) => ({
            ...phase,
            effects: phaseEffects(phase),
            // The projection below keeps the old `speed` name for the unitsPerTick of a phase.
            movement: phase.movement ? { ...phase.movement, speed: phase.movement.unitsPerTick } : undefined,
        }));
    }
    const verbs = triggerVerbs(id);
    const hit = findVerb(verbs, VERBS.HIT);
    const move = findVerb(verbs, VERBS.MOVE);
    return [{
        id: "active",
        hitbox: hit?.hitbox ?? undefined,
        effects: triggerEffects(id),
        movement: move ? { speed: move.unitsPerTick, distance: move.distance, trailMs: move.trailMs } : undefined,
        visual: verbs.find((verb) => verb.visual)?.visual,
        on: {},
    }];
}

function embeddedShotPhase(id) {
    const shot = scheduledHitVerb(entityContractForAbility(id)?.phases?.find((phase) => scheduledHitVerb(phase)));
    return shot ? { hitbox: shot.hitbox, effects: shot.effects, shotVisibleMs: shot.visual?.visibleMs } : null;
}

function allEffectsFor(id, phases) {
    const embeddedPhase = embeddedShotPhase(id);
    // Trigger-time effects (Rewind's restore) join the effects of the entity's phases.
    const effects = [...triggerEffects(id), ...[...phases, ...(embeddedPhase ? [embeddedPhase] : [])]
        .flatMap((phase) => phase.effects ?? [])];
    return effects.filter((effect, index, values) => values.findIndex((candidate) =>
        JSON.stringify(candidate) === JSON.stringify(effect)) === index);
}

function firstEffect(effects, type) {
    return effects.find((effect) => effect?.type === type) ?? null;
}

function phaseProjection(id) {
    const phases = phasesFor(id);
    const entity = entityContractForAbility(id);
    const timing = ABILITY_TIMING_BY_ID[id] ?? {};
    const effects = allEffectsFor(id, phases);
    const embeddedPhase = embeddedShotPhase(id);
    const projectionPhases = [...phases, ...(embeddedPhase ? [embeddedPhase] : [])];
    const damageEffect = firstEffect(effects, EFFECT_TYPES.DAMAGE);
    const behaviorPhase = projectionPhases.find((phase) => phase.effects?.some(
        (effect) => effect?.type === EFFECT_TYPES.DAMAGE))
        ?? projectionPhases.find((phase) => phase.effects?.length > 0)
        ?? projectionPhases[0]
        ?? {};
    const movementPhase = phases.find((phase) => Number(phase.movement?.speed) > 0)
        ?? phases.find((phase) => phase.movement)
        ?? {};
    const visualPhase = phases.find((phase) => phase.visual) ?? {};
    const geometry = behaviorPhase.hitbox ?? phases.find((phase) => phase.hitbox)?.hitbox ?? {};
    const movement = movementPhase.movement ?? {};
    const movingProjectile = entity?.category === "projectile"
        && movementPhase != null
        && behaviorPhase != null
        && movementPhase.id === behaviorPhase.id;
    const movingPhaseDuration = Number(movementPhase.durationMs ?? timing.durationMs);
    const timingRange = movingProjectile
        && movingPhaseDuration > 0
        && Number(movement.speed) > 0
        ? Number(movement.speed) * movingPhaseDuration / 100 : null;
    const range = Number(embeddedPhase?.hitbox?.range
        ?? (timingRange != null ? timingRange : null)
        ?? geometry.range ?? geometry.length ?? geometry.radius ?? 0);
    const stats = {};

    if (damageEffect?.amount != null) stats.damage = Number(damageEffect.amount);
    if (damageEffect?.falloff) stats.falloff = damageEffect.falloff;
    const healing = firstEffect(effects, EFFECT_TYPES.HEALING);
    if (healing?.amount != null && !healing.mirrorsDamage) stats.healing = Number(healing.amount);
    const knockback = firstEffect(effects, EFFECT_TYPES.KNOCKBACK);
    if (knockback?.amount != null) stats.knockback = Number(knockback.amount);
    const pull = firstEffect(effects, EFFECT_TYPES.PULL);
    if (pull?.amount != null) stats.pullPerTick = Number(pull.amount);
    const interrupt = firstEffect(effects, EFFECT_TYPES.INTERRUPT);
    if (interrupt?.durationMs != null) stats.interruptMs = Number(interrupt.durationMs);
    const restore = firstEffect(effects, EFFECT_TYPES.RESTORE_STATE);
    if (restore?.delayMs != null) stats.delayMs = Number(restore.delayMs);

    const statuses = {};
    for (const effect of effects) {
        if (![EFFECT_TYPES.STATUS, EFFECT_TYPES.BUFF].includes(effect?.type)) continue;
        const subtype = effect.subtype ?? effect.buff;
        if (!subtype) continue;
        statuses[subtype] = {
            ...(effect.amount == null ? {} : { amount: Number(effect.amount) }),
            ...(effect.durationMs == null ? {} : { durationMs: Number(effect.durationMs) }),
            ...(effect.intervalMs == null ? {} : { intervalMs: Number(effect.intervalMs) }),
        };
    }
    if (Object.keys(statuses).length > 0) stats.statuses = Object.freeze(statuses);

    if (geometry.radius != null) stats.radius = Number(geometry.radius);
    if (range > 0) stats.range = range;
    if (geometry.arc != null) stats.arc = Number(geometry.arc);
    const width = geometry.width;
    const length = geometry.length ?? (geometry.shape === "ray" ? geometry.range : null);
    if (width != null) stats.hitboxWidth = Number(width);
    if (length != null) stats.hitboxLength = Number(length);
    if (movement.speed != null) stats.speed = Number(movement.speed);
    if (movement.distance != null) stats.distance = Number(movement.distance);
    if (movement.trailMs != null) stats.trailMs = Number(movement.trailMs);
    if (movement.turnDegrees != null) stats.turnStepDegrees = Number(movement.turnDegrees);
    if (visualPhase.visual?.visualSize != null) stats.visualSize = Number(visualPhase.visual.visualSize);
    if (visualPhase.visual?.visibleMs != null) stats.visualMs = Number(visualPhase.visual.visibleMs);
    const scheduledEvent = projectionPhases
        .flatMap((phase) => Object.values(phase.on ?? {}))
        .find((event) => event?.schedule?.mode === "repeat");
    const collisionIntervalMs = scheduledEvent?.schedule?.intervalMs;
    if (collisionIntervalMs != null) stats.intervalMs = Number(collisionIntervalMs);
    if (embeddedPhase?.shotVisibleMs != null) {
        stats.shotVisualMs = Number(embeddedPhase.shotVisibleMs);
    }
    const entityPhase = entity?.phases?.[0] ?? null;
    const entityVisualSize = Number(entityPhase?.visual?.visualSize);
    if (Number.isFinite(entityVisualSize) && entityVisualSize > 0) {
        stats.size = entityVisualSize;
    }
    const entityHealth = entity?.phases?.find((phase) => phase?.health)?.health;
    if (entityHealth?.hp != null) stats.hp = Number(entityHealth.hp);
    if (restore?.delayMs == null && restore?.durationMs != null) stats.delayMs = Number(restore.durationMs);
    const buff = effects.find((effect) => effect?.type === EFFECT_TYPES.BUFF && effect?.buff === "overclock");
    if (buff?.amount != null) {
        stats.cooldownRecoveryPercent = Number(buff.amount) * 100;
        stats.cooldownRecoveryMultiplier = Number(buff.multiplier ?? (1 - Number(buff.amount)));
    }
    return stats;
}

const ABILITY_STATS_BY_ID = Object.freeze(Object.fromEntries(
    Object.entries(ABILITY_TIMING_BY_ID).map(([id, timing]) => [
        id,
        Object.freeze({ ...timing, ...phaseProjection(Number(id)) }),
    ]),
));

/** Returns the configured charge cap for an active ability definition. */
export function abilityMaxChargesForShape(abilityIdValue) {
    return ABILITY_TIMING_BY_ID[abilityId(abilityIdValue)]?.maxCharges ?? null;
}

// Compatibility projection for UI/loadout payloads. New gameplay code should
// read the active phase contract directly.
export const ABILITY_STATS = ABILITY_STATS_BY_ID;

export function abilityStats(value) {
    const id = abilityId(value);
    return id == null ? null : ABILITY_STATS[id] ?? null;
}

/** Returns status metadata projected from the phase effect that applies it. */
export function statusStats(abilityValue, statusType) {
    return abilityStats(abilityValue)?.statuses?.[statusType] ?? null;
}

export function statusDurationMs(abilityValue, statusType, fallback = 0) {
    return Number(statusStats(abilityValue, statusType)?.durationMs ?? fallback);
}

export function statusIntervalMs(abilityValue, statusType, fallback = 0) {
    return Number(statusStats(abilityValue, statusType)?.intervalMs ?? fallback);
}
