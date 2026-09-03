package com.example.botfight.simulation.core.state;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.HashMap;
import org.junit.jupiter.api.Test;

class BotStateServiceDamageTest {
    private final BotStateService service = new BotStateService(
            new GameConfigCatalog(), new BotCodeService());

    @Test
    void bleedAmplifiesOtherDamageButExcludesItsOwnTickAndTruncatesToTenths() {
        Bot target = bot();
        target.statusEffects.put("bleed:duration", damageStatus("bleed", 5_000, 100, 2)
                .addEffect(new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                        .damageModifier(StatusEffectState.BLEED_INCOMING_DAMAGE_MODIFIER)
                        .rounding(StatusEffectState.TRUNCATE_DAMAGE_TO_TENTHS)
                        .excludeDamageSourceType("bleed")));
        target.statusEffects.put("burn:duration", damageStatus("burn", 5_000, 100, 2));

        service.beginTick(target);

        // Bleed's own 2 damage is unchanged; Burn's 2 damage becomes 2.5.
        assertThat(target.hp).isEqualTo(95.5);
        service.applyDamage(target, 10.09, 1);
        assertThat(target.hp).isEqualTo(82.9);
    }

    @Test
    void incomingDamageModifiersAddAcrossActiveStatuses() {
        Bot target = bot();
        target.statusEffects.put("bleed:duration", new StatusEffectState("bleed", 5_000, 0)
                .addEffect(new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                        .damageModifier(StatusEffectState.BLEED_INCOMING_DAMAGE_MODIFIER)
                        .rounding(StatusEffectState.TRUNCATE_DAMAGE_TO_TENTHS)
                        .excludeDamageSourceType("bleed")));
        target.statusEffects.put("reactive-armor:duration", new StatusEffectState("reactive-armor", 5_000, 0)
                .addEffect(new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                        .damageModifier(-0.5)));

        service.applyDamage(target, 10.09, 1);

        // +25% -50% = -25%; 10.09 * 0.75 = 7.5675, truncated once to 7.5.
        assertThat(target.hp).isEqualTo(92.5);
    }

    private static StatusEffectState damageStatus(String type, int remainingMs, int tickMs, double amount) {
        StatusEffectState status = new StatusEffectState(type, remainingMs, tickMs);
        status.sourceSlot = 1;
        status.addEffect(new StatusEffectState.Effect("damage", "tick").amount(amount));
        return status;
    }

    private static Bot bot() {
        Bot bot = new Bot();
        bot.hp = 100;
        bot.maxHp = 100;
        bot.slot = 2;
        bot.statusEffects = new HashMap<>();
        return bot;
    }
}
