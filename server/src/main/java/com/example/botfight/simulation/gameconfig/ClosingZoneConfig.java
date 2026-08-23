package com.example.botfight.simulation.gameconfig;

/** Versioned arena-wide hazard tuning mirrored by the browser preview. */
public record ClosingZoneConfig(
        int startDelayMs,
        int approachDurationMs,
        int phaseDurationMs,
        int phaseCount,
        int initialSafeRadiusPaddingUnits,
        int geometryUpdateMs,
        int damageIntervalMs,
        double damagePercentMaxHp,
        int simulationDurationMs) {

    /** Each 20s phase contracts for 5s, holds for 15s, then targets 2/3, 1/3, and 0. */
    public static ClosingZoneConfig duelV1() {
        return new ClosingZoneConfig(15_000, 5_000, 20_000, 3, 32, 1_000, 500, 0.02, 90_000);
    }
}
