package com.example.botfight.simulation.gameconfig;

import java.util.List;

/** Timed-rounds boundary metadata for request duration and socket zone-warning presentation. */
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

    /**
     * Timed rounds: 15 s segments, 6 rounds, 90 s in all. The zone only exists in rounds 5 and 6.
     * It starts at a 1200-unit diameter at the start of round 5 (60 s), contracts to 900 over the
     * next 5 s, then to 600 over the 5 s after round 6 starts (75 s). Damage is unchanged. A
     * warning ring shows the next diameter for the round before each step (15 s).
     */
    public static ClosingZoneConfig timedRounds() {
        return new ClosingZoneConfig(60_000, 5_000, 15_000, 2, 32, 1_000, 500, 0.02, 90_000,
                1_200, List.of(new Step(60_000, 5_000, 900), new Step(75_000, 5_000, 600)), 15_000);
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
