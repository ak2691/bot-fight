package com.example.botfight.simulation.ecs.entities;

import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import java.util.List;
import java.util.Set;

/**
 * Advances the authoritative arena-wide closing zone. It deliberately does
 * not implement an ability contract: the zone has no owner, target, or brain
 * payload and is only emitted as renderer/replay state.
 */
public final class ClosingZoneSystem {
    public static final String ID = "closing-zone";
    public static final String TYPE = "closingZone";

    private ClosingZoneSystem() {}

    public record State(double safeRadius, int activeElapsedMs, int geometryElapsedMs) {}

    public record TickResult<F extends AbilityEntityBot>(State state, ArenaEntity entity) {}

    public interface Damage<F extends AbilityEntityBot> {
        double maxHp(F bot);
        void apply(F bot, double amount);
    }

    public static <F extends AbilityEntityBot> TickResult<F> tick(
            State current,
            int elapsedMs,
            int stepMs,
            int width,
            int height,
            List<F> bots,
            ClosingZoneConfig config,
            Damage<F> damage) {
        if (elapsedMs < config.startDelayMs()) return new TickResult<>(null, null);

        int activeElapsedMs = Math.max(0, elapsedMs - config.startDelayMs());
        State initial = current == null
                ? new State(fullArenaCircleRadius(width, height, config), 0, 0)
                : current;
        int updateIntervalMs = Math.max(1, config.geometryUpdateMs());
        int geometryElapsedMs = activeElapsedMs / updateIntervalMs * updateIntervalMs;
        double candidateSafeRadius = safeRadiusAt(config.startDelayMs() + geometryElapsedMs, width, height, config);
        State next = Math.abs(candidateSafeRadius - initial.safeRadius()) > 1e-9
                ? new State(candidateSafeRadius,
                        activeElapsedMs, geometryElapsedMs)
                : initial;

        int previousElapsedMs = Math.max(0, elapsedMs - Math.max(1, stepMs));
        int damageTicks = completedDamageTicks(previousElapsedMs, elapsedMs, config);
        if (damage != null && damageTicks > 0) {
            for (int tick = 0; tick < damageTicks; tick += 1) {
                for (F bot : bots) {
                    if (!touchesDamageZone(next, bot, width, height)) continue;
                    double amount = Math.max(0, damage.maxHp(bot) * config.damagePercentMaxHp());
                    damage.apply(bot, amount);
                }
            }
        }
        return new TickResult<>(next, toEntity(next, width, height));
    }

    public static double safeRadiusAt(int elapsedMs, int width, int height, ClosingZoneConfig config) {
        if (elapsedMs < config.startDelayMs()) return Double.NaN;
        int activeElapsedMs = Math.max(0, elapsedMs - config.startDelayMs());
        double fullRadius = fullArenaCircleRadius(width, height, config);
        int phaseCount = Math.max(1, config.phaseCount());
        int approachMs = Math.max(0, config.approachDurationMs());
        int phaseMs = Math.max(1, config.phaseDurationMs());
        int completionElapsedMs = approachMs + Math.max(0, phaseCount - 1) * phaseMs;
        if (activeElapsedMs >= completionElapsedMs) return 0;
        int phaseIndex = activeElapsedMs / phaseMs;
        int phaseElapsedMs = activeElapsedMs % phaseMs;
        double startFraction = Math.max(0, 1.0 - (double) phaseIndex / phaseCount);
        if (phaseElapsedMs <= approachMs) {
            double progress = approachMs > 0 ? (double) phaseElapsedMs / approachMs : 1;
            double endFraction = Math.max(0, startFraction - 1.0 / phaseCount);
            return fullRadius * lerp(startFraction, endFraction, progress);
        }
        return fullRadius * Math.max(0, startFraction - 1.0 / phaseCount);
    }

    public static boolean touchesDamageZone(State zone, AbilityEntityBot bot, int width, int height) {
        if (zone == null || bot == null || bot.entityHp() <= 0) return false;
        double centerX = bot.entityX();
        double centerY = bot.entityY();
        double arenaCenterX = width / 2.0;
        double arenaCenterY = height / 2.0;
        return Math.hypot(centerX - arenaCenterX, centerY - arenaCenterY) + bot.entitySize() / 2.0
                >= zone.safeRadius();
    }

    private static ArenaEntity toEntity(State state, int width, int height) {
        return new ArenaEntity(
                ID, TYPE, 0, width / 2.0, height / 2.0,
                Math.max(0, (int) Math.round(state.safeRadius() * 2)),
                0, 0, 0, 0, true, 0, 0, 1.0, null, Set.of());
    }

    private static int completedDamageTicks(int previousElapsedMs, int elapsedMs, ClosingZoneConfig config) {
        int intervalMs = Math.max(1, config.damageIntervalMs());
        int previousActive = Math.max(0, previousElapsedMs - config.startDelayMs());
        int currentActive = Math.max(0, elapsedMs - config.startDelayMs());
        return Math.max(0, currentActive / intervalMs - previousActive / intervalMs);
    }

    private static double fullArenaCircleRadius(int width, int height, ClosingZoneConfig config) {
        return Math.hypot(width, height) / 2.0 + config.initialSafeRadiusPaddingUnits();
    }

    private static double lerp(double from, double to, double progress) {
        return from + (to - from) * Math.max(0, Math.min(1, progress));
    }
}
