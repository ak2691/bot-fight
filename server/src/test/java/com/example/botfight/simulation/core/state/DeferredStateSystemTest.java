package com.example.botfight.simulation.core.state;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import org.junit.jupiter.api.Test;

class DeferredStateSystemTest {
    @Test
    void restoresTemporalSnapshotAndAdvancesItsCompletionVisual() {
        DuelSimulationService.Bot bot = new DuelSimulationService.Bot();
        bot.x = 500;
        bot.y = 300;
        bot.hp = 40;
        bot.maxHp = 100;
        bot.temporalRewindMs = 3_000;
        bot.temporalRewindX = 100;
        bot.temporalRewindY = 200;
        bot.temporalRewindHp = 80;

        assertThat(DeferredStateSystem.tick(bot, 1_000)).isFalse();
        assertThat(bot.x).isEqualTo(500);
        assertThat(bot.hp).isEqualTo(40);
        assertThat(bot.temporalRewindMs).isEqualTo(2_000);

        assertThat(DeferredStateSystem.tick(bot, 2_000)).isTrue();
        assertThat(bot.x).isEqualTo(100);
        assertThat(bot.y).isEqualTo(200);
        assertThat(bot.hp).isEqualTo(80);
        assertThat(bot.temporalRewindMs).isZero();
        assertThat(bot.temporalRewindPulseMs).isEqualTo(400);

        DeferredStateSystem.tick(bot, 100);
        assertThat(bot.temporalRewindPulseMs).isEqualTo(300);
    }
}
