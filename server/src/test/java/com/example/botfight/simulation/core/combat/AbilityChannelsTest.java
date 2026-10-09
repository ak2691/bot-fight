package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DashAction;
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.LegacyAbility;
import com.example.botfight.simulation.gameconfig.AbilityChannels;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Authoritative mirror of frontend AbilityChannels.test.js; keep the scenarios and numbers in step. */
class AbilityChannelsTest {
    private static final int DASH = 19;
    private static final int SNIPER = 3; // 900 ms wind-up, 200 ms active
    private static final int DART = 30; // 200 ms wind-up, 300 ms active
    private final BotStateService stateService = new BotStateService(new GameConfigCatalog(), new BotCodeService());
    private final ActionExecutionService executor = new ActionExecutionService(stateService);
    private final Arena arena = new Arena(1200, 1200, 1000);

    private static Bot bot() {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes("channels".getBytes());
        bot.slot = 1;
        bot.x = 200;
        bot.y = 400;
        bot.size = 60;
        bot.rotation = 90;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.moveSpeed = 15;
        bot.attackSpeedMultiplier = 1.0;
        bot.abilities = Set.of(SNIPER, DART, DASH);
        return bot;
    }

    private static Action action(Integer ability, boolean withDash) {
        DashAction dash = withDash ? new DashAction(DASH, 900, 400, "absolute", "east", null) : null;
        return new Action(0, 0, 0, ability, 900, 400, null, null, null, false, false, false, dash);
    }

    private void step(Bot bot, Action action) {
        bot.triggeredAbility = null;
        executor.execute(bot, action, arena);
    }

    @Test
    void channelsAndTheDashCostComeFromTheSharedData() {
        assertThat(AbilityChannels.channel(DASH)).isEqualTo("dash");
        assertThat(AbilityChannels.channel(SNIPER)).isEqualTo("ability");
        assertThat(AbilityChannels.staminaCost(DASH)).isEqualTo(30);
        assertThat(AbilityChannels.staminaCost(SNIPER)).isZero();
        assertThat(AbilityChannels.blockingStatuses("ability")).containsExactly("stun", "silence");
        assertThat(AbilityChannels.blockingStatuses("dash")).containsExactly("stun", "slow");
    }

    @Test
    void anAbilityStartsWindsUpAndFiresWhileADashIsActive() {
        Bot bot = bot();
        step(bot, action(null, true));
        assertThat(bot.triggeredAbility).isEqualTo(DASH);
        assertThat(LegacyAbility.stage(bot, DASH)).isEqualTo("active:200");

        // The wind-up starts while the dash is active...
        step(bot, action(DART, false));
        assertThat(LegacyAbility.stage(bot, DART)).isEqualTo("windup:100");
        assertThat(LegacyAbility.stage(bot, DASH)).isEqualTo("active:100");
        assertThat(AbilityState.channelBusy(bot, "dash", null)).isTrue();
        assertThat(AbilityState.channelBusy(bot, "ability", null)).isTrue();

        // ...and the ability fires in the next step, with the dash active at its start.
        step(bot, action(DART, false));
        assertThat(bot.triggeredAbility).isEqualTo(DART);
        assertThat(LegacyAbility.stage(bot, DART)).startsWith("active");
    }

    @Test
    void aDashStartsDuringAnotherAbilitysWindupAndActiveTime() {
        Bot bot = bot();
        step(bot, action(SNIPER, false));
        assertThat(LegacyAbility.stage(bot, SNIPER)).isEqualTo("windup:800");
        step(bot, action(SNIPER, true));
        assertThat(bot.triggeredAbility).isEqualTo(DASH);
        assertThat(LegacyAbility.stage(bot, SNIPER)).as("the wind-up continues while dashing").isEqualTo("windup:700");
        assertThat(bot.stamina).isEqualTo(70);

        boolean fired = false;
        for (int tick = 0; tick < 12 && !fired; tick += 1) {
            step(bot, action(SNIPER, false));
            fired = bot.triggeredAbility != null && bot.triggeredAbility == SNIPER;
        }
        assertThat(fired).isTrue();
        assertThat(LegacyAbility.stage(bot, SNIPER)).isEqualTo("active:200");
        assertThat(LegacyAbility.stage(bot, DASH)).isEqualTo("ready:0");

        // A dash during the sniper's active time: the sniper stays active, the dash starts.
        int staminaBefore = bot.stamina;
        step(bot, action(null, true));
        assertThat(bot.triggeredAbility).isEqualTo(DASH);
        assertThat(LegacyAbility.stage(bot, DASH)).isEqualTo("active:200");
        assertThat(LegacyAbility.stage(bot, SNIPER)).isEqualTo("active:100");
        assertThat(staminaBefore + 2 - bot.stamina).as("30 stamina plus one tick of regeneration").isEqualTo(30);
    }

    @Test
    void aSecondAbilityOfTheSameChannelStillWaitsForTheFirst() {
        Bot bot = bot();
        step(bot, action(SNIPER, false));
        step(bot, action(DART, false));
        assertThat(LegacyAbility.stage(bot, DART)).as("the dart cannot start while the sniper winds up").isEqualTo("ready:0");
        assertThat(LegacyAbility.stage(bot, SNIPER)).as("the started wind-up stays selected").isEqualTo("windup:700");
    }
}
