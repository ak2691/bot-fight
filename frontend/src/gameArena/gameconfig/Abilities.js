import { abilityId } from "./AbilityRegistry.js";

// cooldownMs is the recovery phase after activeMs. Total cadence remains
// activeMs + cooldownMs for abilities that have both phases.
const fixedStepRange = (displacementPerTick, durationMs) => displacementPerTick * durationMs / 100;

const ABILITY_STATS_BY_ID = Object.freeze({
    1: { damage: 20, cooldownMs: 600, activeMs: 400, range: 92, arc: 120, visualSize: 207 },
    3: {
        maxCharges: 6,
        resourceModel: "reload",
        chargeType: "ammunition",
        reloadMs: 5000,
        cooldownMs: 1000,
        activeMs: 500,
        falloff: { maxAmount: 15, minAmount: 5, falloffStart: 100, falloffEnd: 700 },
        range: 700,
        hitboxWidth: 5,
        visualSize: 16,
    },
    5: {
        maxCharges: 4,
        resourceModel: "reload",
        chargeType: "ammunition",
        reloadMs: 5000,
        cooldownMs: 300,
        activeMs: 500,
        range: fixedStepRange(36, 1200),
        durationMs: 1200,
        hitboxWidth: 30,
        speed: 36,
        visualSize: 30,
        damage: 15,
        burnDamage: 2,
        statuses: {
            burn: { durationMs: 5000, intervalMs: 1000 },
        },
    },
    18: { cooldownMs: 7000, windupMs: 300, visualMs: 500, damage: 20, range: fixedStepRange(44, 500), knockback: 200, size: 24, visualSize: 24, hitboxWidth: 80, hitboxLength: 115, speed: 44, durationMs: 500 },
    19: { cooldownMs: 1800, distance: 150, activeMs: 200, durationMs: 200, speed: 75, trailMs: 300, visualSize: 114 },
    25: { cooldownMs: 1500, visualMs: 300, damage: 15, range: 100, visualSize: 100, hitboxWidth: 60 },
    20: { cooldownMs: 9_800, windupMs: 200, activeMs: 200 },
    4: {
        cooldownMs: 12000,
        falloff: { maxAmount: 40, minAmount: 25, falloffStart: 0, falloffEnd: 64 },
        radius: 70,
        hitboxWidth: 12,
        speed: 32,
        fuseMs: 1000,
        phases: [
            { id: "travel", hitboxWidth: 12, speed: 32 },
            { id: "armed", hitboxWidth: 12, speed: 0 },
            { id: "active", radius: 70 },
        ],
    },
    12: {
        maxCharges: 10,
        resourceModel: "reload",
        chargeType: "ammunition",
        reloadMs: 3000,
        cooldownMs: 400,
        activeMs: 300,
        falloff: { maxAmount: 8, minAmount: 4, falloffStart: 0, falloffEnd: 333.33 },
        range: 500,
        hitboxWidth: 5,
        visualSize: 14,
    },
    6: { cooldownMs: 9600, windupMs: 200, activeMs: 100, damage: 10, durationMs: 1200, hitboxWidth: 80, range: 184, visualSize: 60, statuses: { stun: { durationMs: 1200 } } },
    7: { cooldownMs: 4600, windupMs: 300, visualMs: 400, damage: 30, range: 115, arc: 150, visualSize: 220.8, bleedDamage: 2, statuses: { bleed: { durationMs: 5000, intervalMs: 1000 } } },
    8: { cooldownMs: 10000, visualMs: 500, damage: 20, radius: 110, visualSize: 220, knockback: 250 },
    9: { cooldownMs: 6700, windupMs: 500, visualMs: 300, damage: 20, statuses: { slow: { durationMs: 1000 } }, range: 500, hitboxWidth: 5, visualSize: 76 },
    10: { cooldownMs: 11700, windupMs: 800, visualMs: 300, visualSize: 12, healing: 25 },
    11: {
        cooldownMs: 10000,
        activeMs: 300,
        entity: "mine",
        damage: 25,
        radius: 87.5,
        size: 24,
        speed: 22,
        durationMs: 20_800,
        visibleMs: 300,
        phases: [
            { id: "travel", radius: 12, speed: 22 },
            { id: "armed", radius: 87.5, speed: 0 },
        ],
    },
    13: { cooldownMs: 10700, windupMs: 900, visualMs: 300, damage: 40, shockDamage: 3, statuses: { shock: { durationMs: 3000, intervalMs: 1000 } }, movementLockMs: 300, range: 900, hitboxWidth: 5, visualSize: 100, beam: true },
    14: {
        cooldownMs: 11000,
        activeMs: 2000,
        entity: "gravity_zone",
        falloff: { maxAmount: 35, minAmount: 20, falloffStart: 0, falloffEnd: 90 },
        radius: 120,
        speed: 22,
        phases: [
            { id: "travel", startMs: 0, radius: 120, speed: 22 },
            { id: "fuse", startMs: 2000, radius: 120, speed: 0 },
            { id: "active", startMs: 5000, radius: 120, speed: 0 },
        ],
        pullPerTick: 6,
        durationMs: 7000,
    },
    15: { cooldownMs: 10000, windupMs: 1000, activeMs: 2000, durationMs: 1200, statuses: { silence: { durationMs: 2000 } }, interruptMs: 100, size: 225, visualSize: 225, speed: 150, hitboxWidth: 150, hitboxLength: 190 },
    16: { cooldownMs: 9000, windupMs: 500, activeMs: 0, durationMs: 4000, statuses: { damage_reduction: { durationMs: 4000 }, damage_reflection: { durationMs: 4000 } }, visualDurationMs: 300, visualSize: 80 },
    17: { cooldownMs: 8000, activeMs: 300, entity: "hunter_drone", durationMs: 6000, hp: 50, size: 28, visualSize: 28, speed: 4.5, range: 200, shotCooldownMs: 1000, shotVisualMs: 300, turnStepDegrees: 8, damage: 5 },
    21: { cooldownMs: 18000, activeMs: 300, delayMs: 3000, intervalMs: 400, radius: 45, visualSize: 90, durationMs: 3100 },
    22: {
        cooldownMs: 18000,
        windupMs: 500,
        activeMs: 0,
        durationMs: 1500,
        entity: "orbital_marker",
        damage: 15,
        radius: 130,
        visualSize: 260,
        intervalMs: 500,
        visibleMs: 400,
    },
    23: { cooldownMs: 15500, windupMs: 500, activeMs: 0, durationMs: 1500, statuses: { damage_immunity: { durationMs: 1500 } }, visualDurationMs: 300, visualSize: 80 },
    24: { cooldownMs: 13000, windupMs: 1000, activeMs: 300, entity: "null_zone", durationMs: 5000, radius: 150, visualSize: 300 },
    26: { cooldownMs: 8700, visualMs: 300, damage: 15, radius: 120, statuses: { slow: { durationMs: 1500 } }, knockback: 60 },
    27: {
        cooldownMs: 18000,
        activeMs: 300,
        entity: "singularity_zone",
        falloff: { maxAmount: 35, minAmount: 15, falloffStart: 0, falloffEnd: 140 },
        radius: 140,
        durationMs: 1300,
        pullPerTick: 10,
        visibleMs: 400,
        phases: [
            { id: "fuse", radius: 140, speed: 0 },
            { id: "active", radius: 140, speed: 0 },
        ],
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
        hitboxWidth: 18,
        speed: 42,
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
        radius: 75,
        size: 24,
        hp: 20,
        durationMs: 16000,
        visibleMs: 300,
        phases: [
            {
                id: "armed",
                label: "Armed",
                radius: 75,
            },
            {
                id: "destroyed",
                label: "On destruction",
                event: "destroyed",
                radius: 120,
                damage: 20,
                statuses: { slow: { durationMs: 3000 } },
            },
        ],
    },
    30: {
        cooldownMs: 8000,
        windupMs: 200,
        visualMs: 300,
        damage: 15,
        interruptMs: 250,
        statuses: { slow: { durationMs: 2000 } },
        range: 600,
        hitboxWidth: 8,
    },
    31: {
        cooldownMs: 9000,
        entity: "repeller_drone",
        activeMs: 300,
        durationMs: 6000,
        hp: 50,
        size: 28,
        visualSize: 28,
        speed: 4.5,
        range: 200,
        shotCooldownMs: 1000,
        shotVisualMs: 300,
        turnStepDegrees: 8,
        damage: 3,
        knockback: 40,
    },
    32: {
        cooldownMs: 10000,
        windupMs: 300,
        visualMs: 300,
        falloff: { maxAmount: 25, minAmount: 15, falloffStart: 0, falloffEnd: 500 },
        range: 500,
        hitboxWidth: 10,
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
        cooldownMs: 500,
        activeMs: 200,
        visualMs: 200,
        damage: 8,
        range: 80,
        arc: 30,
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
