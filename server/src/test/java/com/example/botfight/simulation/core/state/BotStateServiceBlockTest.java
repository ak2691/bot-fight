package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.core.orchestration.Bot;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class BotStateServiceBlockTest {
    private final BotStateService service = new BotStateService(new GameConfigCatalog(), new BotCodeService());

    @Test
    void staleRetiredBlockStateNeverAbsorbsDamage() {
        Bot target = new Bot();
        target.slot = 2;
        target.x = 150;
        target.y = 100;
        target.rotation = 270;
        target.hp = 100;
        target.maxHp = 100;
        target.abilities = Set.of(2);
        LegacyAbility.setCharges(target, 2, 25);
        LegacyAbility.setActive(target, 2, 500);

        service.applyDamage(target, 20, 1, 100, 100);

        assertThat(target.hp).isEqualTo(80);
        assertThat(LegacyAbility.charges(target, 2)).isEqualTo(25);
        assertThat(LegacyAbility.activeMs(target, 2)).isEqualTo(500);
    }

    @Test
    void serverGrantedAbilitiesContainOnlyDash() throws Exception {
        var brain = new tools.jackson.databind.json.JsonMapper().readTree("{}");
        assertThat(new BotCodeService().readAbilities(brain)).containsExactlyInAnyOrder(19);
    }

    @Test
    void startingHpOverridesTheDefaultBotHp() throws Exception {
        var brain = new tools.jackson.databind.json.JsonMapper().readTree("{}");
        Bot bot = service.create(new DuelSimulationService.DuelBotRequest(
                UUID.randomUUID(), "Puzzle", 1, 100, 100, 0d, 20, "custom", brain, 70d));

        assertThat(bot.maxHp).isEqualTo(300);
        assertThat(bot.hp).isEqualTo(70);
    }

    @Test
    void chargeReloadWaitsUntilActiveWindowEnds() {
        Bot bot = new Bot();
        bot.hp = 100;
        bot.maxHp = 100;
        bot.abilities = Set.of(12);
        LegacyAbility.setCharges(bot, 12, 0);
        LegacyAbility.setRecharge(bot, 12, 3_000);
        LegacyAbility.setActive(bot, 12, 500);
        LegacyAbility.setCooldown(bot, 12, 100);

        for (int tick = 0; tick < 5; tick++) {
            service.beginTick(bot);
            assertThat(LegacyAbility.recharge(bot, 12)).isEqualTo(3_000);
        }
        assertThat(LegacyAbility.activeMs(bot, 12)).isZero();

        service.beginTick(bot);
        assertThat(LegacyAbility.recharge(bot, 12)).isEqualTo(2_900);
    }

    @Test
    void overclockReducesAChargeReloadWhenTheReloadStarts() {
        Bot bot = new Bot();
        bot.hp = 100;
        bot.maxHp = 100;
        LegacyAbility.setCharges(bot, 12, 1);
        BotStateService.upsertStatusEffect(bot, new StatusEffectState("overclock", 4_000, 0)
                .addEffect(new StatusEffectState.Effect("cooldown_modifier", "constant")
                        .multiplier(0.5)));

        assertThat(service.consumeAbilityCharge(bot, 12)).isTrue();
        assertThat(LegacyAbility.recharge(bot, 12)).isEqualTo(1_500);
    }

}
