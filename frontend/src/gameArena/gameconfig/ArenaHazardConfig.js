/**
 * Arena-wide hazards are not ability contracts: bots cannot observe, target,
 * or select them. This configuration is mirrored by the authoritative server
 * closing-zone config.
 */
export const CLOSING_ZONE_TYPE = "closingZone";
export const CLOSING_ZONE_ID = "closing-zone";
export const MATCH_DURATION_MS = 90_000;

export const CLOSING_ZONE_CONFIG = Object.freeze({
    startDelayMs: 15_000,
    approachDurationMs: 5_000,
    // Each 20-second phase contracts for five seconds, then holds for 15
    // seconds: 2/3, 1/3, then 0 at 20s, 40s, and 60s of the duel.
    phaseDurationMs: 20_000,
    phaseCount: 3,
    initialSafeRadiusPaddingUnits: 32,
    geometryUpdateMs: 1_000,
    damageIntervalMs: 500,
    damagePercentMaxHp: 0.02,
    simulationDurationMs: MATCH_DURATION_MS,
});
