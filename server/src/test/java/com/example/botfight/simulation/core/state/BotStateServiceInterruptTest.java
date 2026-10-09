package com.example.botfight.simulation.core.state;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.Bot;
import java.util.Set;
import org.junit.jupiter.api.Test;

class BotStateServiceInterruptTest {
    @Test
    void interruptingPreparationStartsCooldownWithoutActivatingTheAbility() {
        Bot bot = bot();
        bot.abilities = Set.of(9);
        LegacyAbility.setPreparing(bot, 9, 300, 400, 200);

        BotStateService.applyInterrupt(bot, 250, 30);

        assertThat(LegacyAbility.preparingAbility(bot)).isNull();
        assertThat(LegacyAbility.preparingMs(bot)).isZero();
        assertThat(AbilityState.record(bot, 9).targetX).isNaN();
        assertThat(AbilityState.record(bot, 9).targetY).isNaN();
        assertThat(LegacyAbility.activeMs(bot, 9)).isZero();
        assertThat(LegacyAbility.cooldown(bot, 9)).isEqualTo(6_700);
        assertThat(LegacyAbility.pending(bot, 9)).isZero();
        assertThat(BotStateService.statusRemainingMs(bot, "stun")).isEqualTo(250);
    }

    @Test
    void interruptingActiveMovementStopsTheMovementAndExposesRecovery() {
        Bot bot = bot();
        bot.abilities = Set.of(19);
        LegacyAbility.setActive(bot, 19, 200);
        LegacyAbility.setPending(bot, 19, 1_800);
        bot.dashRemaining = 75;
        bot.movementVelocityX = 8;
        bot.velocityX = 8;

        BotStateService.applyInterrupt(bot, 250, 30);

        assertThat(LegacyAbility.activeMs(bot, 19)).isZero();
        assertThat(LegacyAbility.cooldown(bot, 19)).isEqualTo(1_800);
        assertThat(LegacyAbility.pending(bot, 19)).isZero();
        assertThat(bot.dashRemaining).isZero();
        assertThat(bot.movementVelocityX).isZero();
        assertThat(bot.velocityX).isZero();
    }

    @Test
    void interruptingAnAbilityAlreadyReloadingDoesNotAddASecondCooldownGate() {
        Bot bot = bot();
        bot.abilities = Set.of(12);
        LegacyAbility.setActive(bot, 12, 500);
        LegacyAbility.setCharges(bot, 12, 0);
        LegacyAbility.setRecharge(bot, 12, 5_000);

        BotStateService.applyInterrupt(bot, 250, 30);

        assertThat(LegacyAbility.activeMs(bot, 12)).isZero();
        assertThat(LegacyAbility.cooldown(bot, 12)).isZero();
        assertThat(LegacyAbility.pending(bot, 12)).isZero();
        assertThat(LegacyAbility.recharge(bot, 12)).isEqualTo(5_000);
    }

    private static Bot bot() {
        Bot bot = new Bot();
        bot.hp = 150;
        bot.maxHp = 150;
        bot.attackSpeedMultiplier = 1;
        return bot;
    }
}
