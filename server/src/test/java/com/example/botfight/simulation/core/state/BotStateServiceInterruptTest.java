package com.example.botfight.simulation.core.state;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class BotStateServiceInterruptTest {
    @Test
    void interruptingPreparationStartsCooldownWithoutActivatingTheAbility() {
        Bot bot = bot();
        bot.abilities = Set.of(9);
        bot.preparingAbility = 9;
        bot.preparingMs = 300;
        bot.preparingTargetX = 400;
        bot.preparingTargetY = 200;
        bot.abilityCooldowns.put(9, 0);

        BotStateService.applyInterrupt(bot, 250, 30);

        assertThat(bot.preparingAbility).isNull();
        assertThat(bot.preparingMs).isZero();
        assertThat(bot.preparingTargetX).isNaN();
        assertThat(bot.preparingTargetY).isNaN();
        assertThat(bot.abilityActiveMs.getOrDefault(9, 0)).isZero();
        assertThat(bot.abilityCooldowns).containsEntry(9, 6_700);
        assertThat(bot.abilityPendingCooldownMs).doesNotContainKey(9);
        assertThat(BotStateService.statusRemainingMs(bot, "stun")).isEqualTo(250);
    }

    @Test
    void interruptingActiveMovementStopsTheMovementAndExposesRecovery() {
        Bot bot = bot();
        bot.abilities = Set.of(19);
        bot.abilityActiveMs.put(19, 200);
        bot.abilityPendingCooldownMs.put(19, 1_800);
        bot.dashRemaining = 75;
        bot.movementVelocityX = 8;
        bot.velocityX = 8;

        BotStateService.applyInterrupt(bot, 250, 30);

        assertThat(bot.abilityActiveMs.get(19)).isZero();
        assertThat(bot.abilityCooldowns).containsEntry(19, 1_800);
        assertThat(bot.abilityPendingCooldownMs).doesNotContainKey(19);
        assertThat(bot.dashRemaining).isZero();
        assertThat(bot.movementVelocityX).isZero();
        assertThat(bot.velocityX).isZero();
    }

    @Test
    void interruptingAnAbilityAlreadyReloadingDoesNotAddASecondCooldownGate() {
        Bot bot = bot();
        bot.abilities = Set.of(12);
        bot.abilityActiveMs.put(12, 500);
        bot.abilityCharges.put(12, 0);
        bot.abilityRechargeMs.put(12, 5_000);

        BotStateService.applyInterrupt(bot, 250, 30);

        assertThat(bot.abilityActiveMs.get(12)).isZero();
        assertThat(bot.abilityCooldowns.getOrDefault(12, 0)).isZero();
        assertThat(bot.abilityPendingCooldownMs).doesNotContainKey(12);
        assertThat(bot.abilityRechargeMs).containsEntry(12, 5_000);
    }

    private static Bot bot() {
        Bot bot = new Bot();
        bot.hp = 150;
        bot.maxHp = 150;
        bot.attackSpeedMultiplier = 1;
        bot.abilityCooldowns = new java.util.HashMap<>();
        bot.abilityActiveMs = new java.util.HashMap<>();
        bot.abilityPendingCooldownMs = new java.util.HashMap<>();
        bot.abilityCharges = new java.util.HashMap<>();
        bot.abilityRechargeMs = new java.util.HashMap<>();
        return bot;
    }
}
