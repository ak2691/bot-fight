package com.example.botfight.simulation.ecs.tests;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.ecs.entities.ClosingZoneSystem;
import com.example.botfight.simulation.geometry.ArenaUnits;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import java.util.List;
import org.junit.jupiter.api.Test;

class ClosingZoneSystemTest {
    private static final ClosingZoneConfig CONFIG = ClosingZoneConfig.duelV1();

    @Test
    void startsAfterDelayAndEmitsRendererOnlyEntityState() {
        TestBot bot = new TestBot(2, 500, 500, 60, 100);

        ClosingZoneSystem.TickResult<TestBot> before = ClosingZoneSystem.tick(
                null, CONFIG.startDelayMs() - 100, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(bot), CONFIG, damage());
        ClosingZoneSystem.TickResult<TestBot> started = ClosingZoneSystem.tick(
                null, CONFIG.startDelayMs(), 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(bot), CONFIG, damage());

        assertThat(before.entity()).isNull();
        assertThat(started.entity()).isNotNull();
        assertThat(started.entity().type()).isEqualTo(ClosingZoneSystem.TYPE);
        assertThat(started.entity().ownerSlot()).isZero();
        assertThat(bot.hp).isEqualTo(100);
    }

    @Test
    void cachesGeometryForSubsecondTicksAndDamagesUnsafeBotEveryFiveTicks() {
        TestBot safe = new TestBot(1, 500, 500, 60, 100);
        TestBot unsafe = new TestBot(2, 30, 30, 60, 100);
        ClosingZoneSystem.TickResult<TestBot> first = ClosingZoneSystem.tick(
                null, CONFIG.startDelayMs(), 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(safe, unsafe), CONFIG, damage());
        ClosingZoneSystem.TickResult<TestBot> cached = ClosingZoneSystem.tick(
                first.state(), CONFIG.startDelayMs() + 400, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT,
                List.of(safe, unsafe), CONFIG, damage());
        ClosingZoneSystem.TickResult<TestBot> damaged = ClosingZoneSystem.tick(
                cached.state(), CONFIG.startDelayMs() + CONFIG.approachDurationMs() + CONFIG.damageIntervalMs(), 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT,
                List.of(safe, unsafe), CONFIG, damage());

        assertThat(cached.state().geometryElapsedMs()).isZero();
        assertThat(cached.state()).isSameAs(first.state());
        assertThat(cached.entity().size()).isEqualTo(first.entity().size());
        assertThat(safe.hp).isEqualTo(100);
        assertThat(unsafe.hp).isEqualTo(98);
        assertThat(ClosingZoneSystem.safeRadiusAt(60_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG)).isZero();
    }

    @Test
    void contractsForFiveSecondsThenHoldsForFifteenSeconds() {
        double full = ClosingZoneSystem.safeRadiusAt(15_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG);
        double firstTarget = ClosingZoneSystem.safeRadiusAt(20_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG);
        double firstHold = ClosingZoneSystem.safeRadiusAt(25_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG);
        double secondTarget = ClosingZoneSystem.safeRadiusAt(40_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG);
        double secondHold = ClosingZoneSystem.safeRadiusAt(50_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG);

        assertThat(firstTarget).isCloseTo(full * (2.0 / 3.0), org.assertj.core.data.Offset.offset(1e-9));
        assertThat(firstHold).isEqualTo(firstTarget);
        assertThat(secondTarget).isCloseTo(full / 3.0, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(secondHold).isEqualTo(secondTarget);
        assertThat(ClosingZoneSystem.safeRadiusAt(60_000, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, CONFIG)).isZero();

        TestBot contractedBot = new TestBot(1, 500, 500, 60, 100);
        ClosingZoneSystem.TickResult<TestBot> contracted = ClosingZoneSystem.tick(
                null, 20_000, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(contractedBot), CONFIG, damage());
        ClosingZoneSystem.TickResult<TestBot> held = ClosingZoneSystem.tick(
                contracted.state(), 25_000, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(contractedBot), CONFIG, damage());
        assertThat(held.state()).isSameAs(contracted.state());
    }

    /** Parity: the browser's ClosingZoneSystem.test.js checks these same numbers for the mirrored config. */
    @Test
    void timedRoundsZoneOnlyExistsInRoundsFiveAndSixAndContractsFrom1200To900To600() {
        ClosingZoneConfig v2 = ClosingZoneConfig.timedRoundsV2();
        assertThat(v2.simulationDurationMs()).isEqualTo(120_000);
        assertThat(v2.startDelayMs()).isEqualTo(80_000);
        double[][] radii = {
                {79_900, Double.NaN}, {80_000, 600}, {82_500, 525}, {85_000, 450}, {99_900, 450},
                {100_000, 450}, {102_500, 375}, {105_000, 300}, {120_000, 300}};
        for (double[] row : radii) {
            double actual = ClosingZoneSystem.safeRadiusAt((int) row[0], ArenaUnits.WIDTH, ArenaUnits.HEIGHT, v2);
            if (Double.isNaN(row[1])) assertThat(actual).isNaN();
            else assertThat(actual).as("radius at %d", (int) row[0]).isCloseTo(row[1], org.assertj.core.data.Offset.offset(1e-9));
        }
        double[][] warnings = {
                {59_900, Double.NaN}, {60_000, 900}, {79_900, 900}, {80_000, 600}, {99_900, 600}, {100_000, Double.NaN}};
        for (double[] row : warnings) {
            double actual = v2.warningDiameterAt((int) row[0]);
            if (Double.isNaN(row[1])) assertThat(actual).isNaN();
            else assertThat(actual).as("warning at %d", (int) row[0]).isEqualTo(row[1]);
        }
        assertThat(CONFIG.warningDiameterAt(60_000)).isNaN();
    }

    @Test
    void timedRoundsZoneStartsAtTheRoundFiveBoundaryWithA1200UnitCircle() {
        ClosingZoneConfig v2 = ClosingZoneConfig.timedRoundsV2();
        TestBot center = new TestBot(1, 600, 600, 60, 100);
        TestBot corner = new TestBot(2, 60, 60, 60, 100);

        ClosingZoneSystem.TickResult<TestBot> before = ClosingZoneSystem.tick(
                null, 79_900, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(center, corner), v2, damage());
        ClosingZoneSystem.TickResult<TestBot> started = ClosingZoneSystem.tick(
                null, 80_000, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(center, corner), v2, damage());
        ClosingZoneSystem.TickResult<TestBot> contracted = ClosingZoneSystem.tick(
                started.state(), 85_000, 100, ArenaUnits.WIDTH, ArenaUnits.HEIGHT, List.of(center, corner), v2, damage());

        assertThat(before.entity()).isNull();
        assertThat(started.entity().size()).isEqualTo(1_200);
        assertThat(contracted.entity().size()).isEqualTo(900);
        assertThat(center.hp).isEqualTo(100);
    }

    private static ClosingZoneSystem.Damage<TestBot> damage() {
        return new ClosingZoneSystem.Damage<>() {
            @Override
            public double maxHp(TestBot bot) {
                return bot.maxHp;
            }

            @Override
            public void apply(TestBot bot, double amount) {
                bot.hp = Math.max(0, bot.hp - amount);
            }
        };
    }

    private static final class TestBot implements AbilityEntityBot {
        private final int slot;
        private double x;
        private double y;
        private final int size;
        private final int maxHp;
        private double hp;

        private TestBot(int slot, double x, double y, int size, int hp) {
            this.slot = slot;
            this.x = x;
            this.y = y;
            this.size = size;
            this.hp = hp;
            this.maxHp = hp;
        }

        @Override public int entitySlot() { return slot; }
        @Override public double entityX() { return x; }
        @Override public double entityY() { return y; }
        @Override public int entitySize() { return size; }
        @Override public double entityHp() { return hp; }
        @Override public boolean ignoresHostileEffects() { return false; }
        @Override public void setEntityPosition(double x, double y) { this.x = x; this.y = y; }
        @Override public void applyStatus(StatusEffectState status, boolean clearsVelocity) {}
        @Override public void clearZonePresence() {}
        @Override public void applyInterrupt(int durationMs, Integer abilityId) {}
    }
}
