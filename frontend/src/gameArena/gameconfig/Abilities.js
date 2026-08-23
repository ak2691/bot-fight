import { abilityId } from "./AbilityRegistry.js";

// cooldownMs is the recovery phase after activeMs. Total cadence remains
// activeMs + cooldownMs for abilities that have both phases.
const fixedStepRange = (displacementPerTick, durationMs) => displacementPerTick * durationMs / 100;

const ABILITY_STATS_BY_ID = Object.freeze({
    1: { activationModel: "immediate", damage: 20, cooldownMs: 600, activeMs: 400, range: 92, arcDegrees: 120 },
    3: {
        activationModel: "immediate",
        maxCharges: 6,
        resourceModel: "reload",
        chargeType: "ammunition",
        reloadMs: 5000,
        cooldownMs: 1000,
        activeMs: 500,
        maxDamage: 15,
        minDamage: 2,
        damageFalloffStart: 100,
        damageFalloffEnd: 700,
        range: 700,
    },
    5: {
        activationModel: "immediate",
        maxCharges: 4,
        resourceModel: "reload",
        chargeType: "ammunition",
        reloadMs: 5000,
        cooldownMs: 300,
        activeMs: 500,
        range: fixedStepRange(36, 1200),
        durationMs: 1200,
        size: 30,
        speed: 36,
        damage: 15,
        burnDamage: 2,
        statuses: {
            burn: { durationMs: 5000, intervalMs: 1000 },
        },
    },
    18: { cooldownMs: 7000, windupMs: 300, visualMs: 500, damage: 15, range: fixedStepRange(44, 500), knockback: 150, projectile: true, size: 24, speedPerTick: 44, durationMs: 500 },
    19: { cooldownMs: 1300, distance: 150, activeMs: 200, durationMs: 200, speedPerTick: 75, trailMs: 300 },
    25: { cooldownMs: 1500, visualMs: 300, damage: 14, range: 100, arcDegrees: 90, passThroughDistance: 50 },
    20: { cooldownMs: 9_800, windupMs: 200, activeMs: 200 },
    4: {
        activationModel: "immediate",
        cooldownMs: 12000,
        maxDamage: 40,
        minDamage: 25,
        damageFalloffStart: 0,
        damageFalloffEnd: 64,
        explosionRadius: 70,
        throwRange: 336,
        size: 12,
        speed: 32,
        decelerationPerTick: 1.6,
        fuseMs: 1000,
    },
    12: {
        cooldownMs: 400,
        activeMs: 300,
        maxDamage: 8,
        minDamage: 4,
        damageFalloffStart: 0,
        damageFalloffEnd: 333.33,
        range: 500,
    },
    6: { activationModel: "immediate", cooldownMs: 9600, windupMs: 400, damage: 5, durationMs: 1200, arcDegrees: 100, range: 184, statuses: { stun: { durationMs: 1200 } } },
    7: { cooldownMs: 4600, windupMs: 300, visualMs: 400, damage: 30, range: 115, arcDegrees: 150, bleedDamage: 2, statuses: { bleed: { durationMs: 5000, intervalMs: 1000 } } },
    8: { cooldownMs: 10000, visualMs: 500, damage: 20, radius: 110, knockback: 250 },
    9: { cooldownMs: 6700, windupMs: 500, visualMs: 300, damage: 20, statuses: { slow: { durationMs: 1000 } }, range: 500, projectile: true },
    10: { cooldownMs: 11700, windupMs: 800, visualMs: 300, healing: 20 },
    11: {
        cooldownMs: 10000,
        activeMs: 300,
        entity: "mine",
        damage: 20,
        radius: 87.5,
        size: 24,
        speedPerTick: 22,
        throwRange: fixedStepRange(22, 800),
        durationMs: 20_800,
        explosionVisibleMs: 300,
    },
    13: { cooldownMs: 10700, windupMs: 900, visualMs: 300, damage: 40, shockDamage: 3, statuses: { shock: { durationMs: 3000, intervalMs: 1000 } }, movementLockMs: 300, range: 900, beam: true },
    14: {
        cooldownMs: 11000,
        activeMs: 2000,
        entity: "gravity_zone",
        maxDamage: 35,
        minDamage: 20,
        damageFalloffStart: 0,
        damageFalloffEnd: 90,
        radius: 120,
        zoneSize: 240,
        speedPerTick: 22,
        phases: [
            { id: "travel", startMs: 0 },
            { id: "fuse", startMs: 2000 },
            { id: "active", startMs: 5000 },
        ],
        pullPerTick: 6,
        durationMs: 7000,
    },
    15: { cooldownMs: 10000, windupMs: 1000, activeMs: 2000, durationMs: 1200, statuses: { silence: { durationMs: 2000 } }, interruptMs: 100, waveSpeedPerTick: 150, projectileSize: 225 },
    16: { cooldownMs: 9000, windupMs: 500, activeMs: 0, durationMs: 4000, statuses: { damage_reduction: { durationMs: 4000 }, damage_reflection: { durationMs: 4000 } }, visualDurationMs: 300 },
    17: { cooldownMs: 8000, activeMs: 300, entity: "hunter_drone", durationMs: 6000, hp: 50, size: 28, moveSpeed: 4.5, range: 200, shotCooldownMs: 1000, shotVisualMs: 300, turnStepDegrees: 8, damage: 3 },
    21: { cooldownMs: 18000, activeMs: 300, delayMs: 3000, intervalMs: 400, zoneSize: 90, durationMs: 3100 },
    22: {
        cooldownMs: 18000,
        windupMs: 500,
        activeMs: 0,
        durationMs: 1500,
        entity: "orbital_marker",
        damage: 15,
        radius: 130,
        markerSize: 260,
        intervalMs: 500,
        explosionVisibleMs: 400,
    },
    23: { cooldownMs: 15500, windupMs: 500, activeMs: 0, durationMs: 1500, statuses: { damage_immunity: { durationMs: 1500 } }, visualDurationMs: 300 },
    24: { cooldownMs: 13000, windupMs: 1500, activeMs: 300, entity: "null_zone", durationMs: 5000, radius: 150, zoneSize: 300 },
    26: { cooldownMs: 8700, visualMs: 300, damage: 10, radius: 120, statuses: { slow: { durationMs: 1500 } }, knockback: 60 },
    27: {
        cooldownMs: 18000,
        activeMs: 300,
        entity: "singularity_zone",
        maxDamage: 35,
        minDamage: 15,
        damageFalloffStart: 0,
        damageFalloffEnd: 140,
        range: 140,
        radius: 140,
        zoneSize: 280,
        durationMs: 1300,
        pullPerTick: 10,
        explosionVisibleMs: 400,
    },
    28: {
        cooldownMs: 7700,
        activeMs: 300,
        windupMs: 300,
        visualMs: 300,
        damage: 10,
        statuses: { slow: { durationMs: 1200 } },
        pullPerTick: 100,
        range: fixedStepRange(42, 1100),
        size: 18,
        speedPerTick: 42,
        durationMs: 1100,
    },
    29: {
        cooldownMs: 10000,
        activeMs: 300,
        entity: "static_snare",
        visualMs: 300,
        damage: 15,
        statuses: { slow: { durationMs: 2200 } },
        interruptMs: 150,
        triggerRadius: 75,
        size: 24,
        hp: 20,
        durationMs: 16000,
        explosionVisibleMs: 300,
        phases: [
            {
                id: "destroyed",
                label: "On destruction",
                event: "destroyed",
                triggerRadius: 120,
                damage: 20,
                statuses: { slow: { durationMs: 3000 } },
            },
        ],
    },
    30: {
        cooldownMs: 8000,
        windupMs: 300,
        visualMs: 300,
        damage: 15,
        interruptMs: 250,
        statuses: { slow: { durationMs: 2000 } },
        range: 600,
    },
    31: {
        cooldownMs: 9000,
        entity: "repeller_drone",
        activeMs: 300,
        durationMs: 6000,
        hp: 50,
        size: 28,
        moveSpeed: 4.5,
        range: 200,
        shotCooldownMs: 1000,
        shotVisualMs: 300,
        turnStepDegrees: 8,
        damage: 2,
        knockback: 35,
    },
    32: {
        cooldownMs: 10000,
        windupMs: 300,
        visualMs: 300,
        maxDamage: 25,
        minDamage: 15,
        damageFalloffStart: 0,
        damageFalloffEnd: 500,
        range: 500,
    },
    33: {
        cooldownMs: 12000,
        windupMs: 500,
        activeMs: 0,
        durationMs: 4000,
        statuses: { overclock: { durationMs: 4000 } },
        visualMs: 300,
        cooldownRecoveryPercent: 50,
        cooldownRecoveryMultiplier: 0.5,
    },
    34: {
        activationModel: "immediate",
        cooldownMs: 500,
        activeMs: 200,
        visualMs: 200,
        damage: 5,
        range: 80,
        arcDegrees: 60,
    },
});

/** Returns the configured charge cap for an active ability definition. */
export function abilityMaxChargesForShape(abilityId) {
    return ABILITY_STATS_BY_ID[abilityId]?.maxCharges ?? null;
}

export const ABILITY_STATS = ABILITY_STATS_BY_ID;

export function abilityStats(value) {
    const id = abilityId(value);
    return id == null ? null : ABILITY_STATS[id] ?? null;
}

/** Resolves status metadata owned by the ability that applies the status. */
export function statusStats(abilityValue, statusType) {
    return abilityStats(abilityValue)?.statuses?.[statusType] ?? null;
}

export function statusDurationMs(abilityValue, statusType, fallback = 0) {
    return Number(statusStats(abilityValue, statusType)?.durationMs ?? fallback);
}

export function statusIntervalMs(abilityValue, statusType, fallback = 0) {
    return Number(statusStats(abilityValue, statusType)?.intervalMs ?? fallback);
}
