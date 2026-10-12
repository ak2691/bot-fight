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

/**
 * Timed rounds: 15 s segments, 6 rounds, 90 s in all. The zone only exists in rounds 5 and 6. It
 * starts at a 1200-unit diameter at the start of round 5 (60 s), contracts to 900 over the next 5 s,
 * then to 600 over the 5 s after round 6 starts (75 s). Damage is unchanged. A warning ring shows
 * the next diameter for the round before each step. Mirrors the server's
 * `ClosingZoneConfig.timedRounds()`.
 */
export const TIMED_ROUNDS_DURATION_MS = 90_000;
export const TIMED_ROUNDS_ZONE_CONFIG = Object.freeze({
    startDelayMs: 60_000,
    approachDurationMs: 5_000,
    phaseDurationMs: 15_000,
    phaseCount: 2,
    initialSafeRadiusPaddingUnits: 32,
    geometryUpdateMs: 1_000,
    damageIntervalMs: 500,
    damagePercentMaxHp: 0.02,
    simulationDurationMs: TIMED_ROUNDS_DURATION_MS,
    startDiameterUnits: 1_200,
    steps: Object.freeze([
        Object.freeze({ startMs: 60_000, contractMs: 5_000, toDiameterUnits: 900 }),
        Object.freeze({ startMs: 75_000, contractMs: 5_000, toDiameterUnits: 600 }),
    ]),
    warningLeadMs: 15_000,
});
