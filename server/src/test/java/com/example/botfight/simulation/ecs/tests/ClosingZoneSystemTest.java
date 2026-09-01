package com.example.botfight.simulation.ecs.tests;

import static org.assertj.core.api.Assertions.assertThat;

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
        @Override public void applySilence(int durationMs) {}
        @Override public void setZoneSilenced(boolean silenced) {}
        @Override public void applyStun(int durationMs) {}
        @Override public void applyInterrupt(int durationMs) {}
    }
}
