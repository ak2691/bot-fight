package com.example.botfight.simulation.gameconfig;

import java.util.List;

/**
 * Versioned arena-wide hazard tuning mirrored by the browser preview.
 *
 * <p>A config either uses the original phase model (the safe circle shrinks by equal fractions of
 * the full-arena circle) or, when {@code steps} is non-empty, a stepped model: the zone starts at
 * {@code startDiameterUnits} and contracts to each step's diameter in order.
 */
public record ClosingZoneConfig(
        int startDelayMs,
        int approachDurationMs,
        int phaseDurationMs,
        int phaseCount,
        int initialSafeRadiusPaddingUnits,
        int geometryUpdateMs,
        int damageIntervalMs,
        double damagePercentMaxHp,
        int simulationDurationMs,
        double startDiameterUnits,
        List<Step> steps,
        int warningLeadMs) {

    /** One contraction: starts at the absolute match time {@code startMs} and ends {@code contractMs} later. */
    public record Step(int startMs, int contractMs, double toDiameterUnits) {}

    public ClosingZoneConfig {
        steps = steps == null ? List.of() : List.copyOf(steps);
    }

    /** The original phase model. */
    public ClosingZoneConfig(
            int startDelayMs,
            int approachDurationMs,
            int phaseDurationMs,
            int phaseCount,
            int initialSafeRadiusPaddingUnits,
            int geometryUpdateMs,
            int damageIntervalMs,
            double damagePercentMaxHp,
            int simulationDurationMs) {
        this(startDelayMs, approachDurationMs, phaseDurationMs, phaseCount, initialSafeRadiusPaddingUnits,
                geometryUpdateMs, damageIntervalMs, damagePercentMaxHp, simulationDurationMs, 0, List.of(), 0);
    }

    public boolean stepped() {
        return !steps.isEmpty();
    }

    /** Each 20s phase contracts for 5s, holds for 15s, then targets 2/3, 1/3, and 0. */
    public static ClosingZoneConfig duelV1() {
        return new ClosingZoneConfig(15_000, 5_000, 20_000, 3, 32, 1_000, 500, 0.02, 90_000);
    }

    /**
     * Timed rounds: 20 s segments, 6 rounds, 120 s in all. The zone only exists in rounds 5 and 6.
     * It starts at a 1200-unit diameter at the start of round 5 (80 s), contracts to 900 over the
     * next 5 s, then to 600 over the 5 s after round 6 starts (100 s). Damage is unchanged. A
     * warning ring shows the next diameter for the round before each step (20 s).
     */
    public static ClosingZoneConfig timedRoundsV2() {
        return new ClosingZoneConfig(80_000, 5_000, 20_000, 2, 32, 1_000, 500, 0.02, 120_000,
                1_200, List.of(new Step(80_000, 5_000, 900), new Step(100_000, 5_000, 600)), 20_000);
    }

    /**
     * The diameter of the warning ring shown at {@code elapsedMs}, or {@code NaN} when none is shown:
     * for the {@code warningLeadMs} before each step starts, the diameter that step contracts to.
     */
    public double warningDiameterAt(int elapsedMs) {
        for (Step step : steps) {
            if (elapsedMs >= step.startMs() - warningLeadMs && elapsedMs < step.startMs()) {
                return step.toDiameterUnits();
            }
        }
        return Double.NaN;
    }
}
