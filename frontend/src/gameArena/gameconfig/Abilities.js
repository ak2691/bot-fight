import { abilityId } from "./AbilityRegistry.js";
import {
    attachedAbilityContract,
    EFFECT_TYPES,
    entityAbilityPhaseForEntity,
    entityContractForAbility,
} from "../ecs/contracts/AbilityContracts.js";

// Ability-level timing and resource metadata. Behavior that can change while
// an ability is active belongs to a phase contract, not this catalog.
const ABILITY_TIMING_BY_ID = Object.freeze({
    1: { cooldownMs: 600, activeMs: 400 },
    3: { maxCharges: 6, resourceModel: "reload", chargeType: "ammunition", reloadMs: 5000, cooldownMs: 1000, activeMs: 500 },
    4: { cooldownMs: 12000, activeMs: 1 },
    5: { maxCharges: 4, resourceModel: "reload", chargeType: "ammunition", reloadMs: 5000, cooldownMs: 300, activeMs: 500, durationMs: 1200 },
    6: { cooldownMs: 9600, windupMs: 200, activeMs: 100, durationMs: 1200 },
    7: { cooldownMs: 4600, windupMs: 300, activeMs: 400 },
    8: { cooldownMs: 10000, activeMs: 500 },
    9: { cooldownMs: 6700, windupMs: 500, activeMs: 300 },
    10: { cooldownMs: 11700, windupMs: 800, activeMs: 300 },
    11: { cooldownMs: 10000, activeMs: 300, durationMs: 20800 },
    12: { maxCharges: 10, resourceModel: "reload", chargeType: "ammunition", reloadMs: 3000, cooldownMs: 400, activeMs: 300 },
    13: { cooldownMs: 10700, windupMs: 900, activeMs: 300 },
    14: { cooldownMs: 11000, activeMs: 1000, durationMs: 7000 },
    15: { cooldownMs: 10000, windupMs: 1000, activeMs: 2000, durationMs: 1200 },
    16: { cooldownMs: 9000, windupMs: 500, activeMs: 0, durationMs: 4000 },
    17: { cooldownMs: 8000, activeMs: 300, durationMs: 6000 },
    18: { cooldownMs: 7000, windupMs: 300, activeMs: 500, durationMs: 500 },
    19: { cooldownMs: 1800, activeMs: 200, durationMs: 200 },
    20: { cooldownMs: 9800, windupMs: 200, activeMs: 200 },
    21: { cooldownMs: 18000, activeMs: 300, durationMs: 3100 },
    22: { cooldownMs: 18000, windupMs: 500, activeMs: 0, durationMs: 1500 },
    23: { cooldownMs: 15500, windupMs: 500, activeMs: 0, durationMs: 1500 },
    24: { cooldownMs: 13000, windupMs: 1000, activeMs: 300, durationMs: 5000 },
    25: { cooldownMs: 1500, activeMs: 300 },
    26: { cooldownMs: 8700, activeMs: 300 },
    27: { cooldownMs: 18000, activeMs: 300, durationMs: 1300 },
    28: { cooldownMs: 7700, activeMs: 300, windupMs: 300, durationMs: 1100 },
    29: { cooldownMs: 10000, activeMs: 300, durationMs: 16000 },
    30: { cooldownMs: 8000, windupMs: 200, activeMs: 300 },
    31: { cooldownMs: 9000, activeMs: 300, durationMs: 6000 },
    32: { cooldownMs: 10000, windupMs: 300, activeMs: 300 },
    33: { cooldownMs: 12000, windupMs: 500, activeMs: 0, durationMs: 4000 },
    34: { cooldownMs: 500, activeMs: 200 },
});

function phasesFor(abilityValue) {
    const id = abilityId(abilityValue);
    const entity = id == null ? null : entityContractForAbility(id);
    if (entity?.phases?.length) return entity.phases;
    return id == null ? [] : attachedAbilityContract(id)?.phases ?? [];
}

function allEffectsFor(id, phases) {
    const embeddedPhase = entityAbilityPhaseForEntity(id);
    const effects = [...phases, ...(embeddedPhase ? [embeddedPhase] : [])]
        .flatMap((phase) => phase.effects ?? []);
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
    const embeddedPhase = entityAbilityPhaseForEntity(id);
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
    const movingProjectile = entity?.category === "projectile";
    const timingRange = movingProjectile
        && Number(timing.durationMs) > 0
        && Number(movement.speed) > 0
        ? Number(movement.speed) * Number(timing.durationMs) / 100 : null;
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
    if (movement.blockedByStatus != null) stats.blockedByStatus = movement.blockedByStatus;
    if (movement.turnDegrees != null) stats.turnStepDegrees = Number(movement.turnDegrees);
    if (visualPhase.visual?.visualSize != null) stats.visualSize = Number(visualPhase.visual.visualSize);
    if (visualPhase.visual?.visibleMs != null) stats.visualMs = Number(visualPhase.visual.visibleMs);
    if (behaviorPhase.execution?.intervalMs != null) stats.intervalMs = Number(behaviorPhase.execution.intervalMs);
    if (embeddedPhase?.visual?.visibleMs != null) stats.shotVisualMs = Number(embeddedPhase.visual.visibleMs);
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
