package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.LegacyAbility;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.MovementConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** Authoritative mirror of frontend StaminaRefund.test.js; keep the cases and numbers in step. */
class StaminaRefundTest {
    private static final int SLASH = 1;
    private static final int FIREBALL = 5;
    private static final int PAUSED = 100_000;
    private final BotStateService stateService = new BotStateService(new GameConfigCatalog(), new BotCodeService());
    private final ActionExecutionService executor = new ActionExecutionService(stateService);
    private final Arena arena = new Arena(1200, 1200, 1000);

    private static Bot bot() {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes("refund".getBytes());
        bot.slot = 1;
        bot.x = 200;
        bot.y = 400;
        bot.size = 60;
        bot.rotation = 90;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.moveSpeed = 15;
        bot.attackSpeedMultiplier = 1.0;
        bot.abilities = Set.of(1, 3, 19);
        return bot;
    }

    private static Action idle() { return new Action(0, 0, 0, null, 0, 0, null, null, null); }
    private static Action dash() { return new Action(0, 0, 0, 19, 900, 400, null, null, null, false, false); }
    private static Action walk(boolean sprint) { return new Action(1, 0, 0, null, 0, 0, null, null, null, sprint, false); }
    private static Action turn(double dRot, boolean fast) {
        return new Action(0, 0, dRot, null, 0, 0, null, null, null, false, false, fast);
    }

    /** One tick as the simulation runs it: act, then (optionally) land a hit, then settle. */
    private void step(Bot bot, Action action, Integer hitAbility, int activationSerial) {
        bot.triggeredAbility = null;
        executor.execute(bot, action, arena);
        if (hitAbility != null) BotStateService.recordEnemyHit(bot, hitAbility, activationSerial);
        stateService.settleTick(bot);
    }

    private void step(Bot bot, Action action) {
        step(bot, action, null, 0);
    }

    @Test
    void hitRefundIsTenAndThePauseIsFiveTicks() {
        assertThat(MovementConfig.HIT_STAMINA_REFUND).isEqualTo(10);
        assertThat(MovementConfig.REGEN_DELAY_MS).isEqualTo(500);
    }

    @Test
    void regenResumesExactlyFiveIdleTicksAfterTheLastSpend() {
        Bot bot = bot();
        step(bot, dash());
        assertThat(bot.stamina).isEqualTo(70);
        List<Integer> trace = new ArrayList<>();
        for (int tick = 1; tick <= 7; tick += 1) {
            step(bot, idle());
            trace.add(bot.stamina);
        }
        assertThat(trace).containsExactly(70, 70, 70, 70, 70, 72, 74);
    }

    @Test
    void atZeroStaminaTheBotCannotDashSprintOrFastTurnAndRecoversAfterThePause() {
        Bot empty = bot();
        empty.stamina = 0;
        empty.staminaRegenDelayMs = 500;
        Bot dashed = bot();
        dashed.stamina = 0;
        dashed.staminaRegenDelayMs = 500;
        step(dashed, dash());
        assertThat(dashed.triggeredAbility).isNull();

        Bot sprinted = bot();
        sprinted.stamina = 0;
        sprinted.staminaRegenDelayMs = 500;
        double x = sprinted.x;
        step(sprinted, walk(true));
        assertThat(sprinted.sprinting).isFalse();
        assertThat(sprinted.x - x).isEqualTo(15.0);

        Bot turned = bot();
        turned.stamina = 0;
        turned.staminaRegenDelayMs = 500;
        step(turned, turn(1, true));
        assertThat(turned.fastTurning).isFalse();
        assertThat(turned.rotation).isEqualTo(102.0);

        for (int tick = 0; tick < 5; tick += 1) step(empty, idle());
        assertThat(empty.stamina).isZero();
        step(empty, idle());
        assertThat(empty.stamina).isEqualTo(2);
        for (int tick = 0; tick < 14; tick += 1) step(empty, idle());
        assertThat(empty.stamina).isEqualTo(30);
        step(empty, dash());
        assertThat(empty.triggeredAbility).isEqualTo(19);
    }

    @Test
    void aHitRefundsTenStaminaOncePerActivationCappedAtTheMaximum() {
        Bot bot = bot();
        bot.stamina = 50;
        bot.staminaRegenDelayMs = PAUSED;
        step(bot, idle(), SLASH, 1);
        assertThat(bot.stamina).isEqualTo(60);
        step(bot, idle(), SLASH, 1);
        assertThat(bot.stamina).as("the same activation pays once").isEqualTo(60);
        step(bot, idle(), SLASH, 2);
        assertThat(bot.stamina).isEqualTo(70);

        Bot twice = bot();
        twice.stamina = 20;
        twice.staminaRegenDelayMs = PAUSED;
        BotStateService.recordEnemyHit(twice, SLASH, 1);
        BotStateService.recordEnemyHit(twice, FIREBALL, 2);
        stateService.settleTick(twice);
        assertThat(twice.stamina).isEqualTo(40);

        Bot nearFull = bot();
        nearFull.stamina = 95;
        nearFull.staminaRegenDelayMs = PAUSED;
        step(nearFull, idle(), SLASH, 1);
        assertThat(nearFull.stamina).isEqualTo(100);
        Bot full = bot();
        step(full, idle(), SLASH, 1);
        assertThat(full.stamina).isEqualTo(100);
    }

    @Test
    void aRefundDuringThePauseDoesNotChangeWhenRegenerationResumes() {
        Bot plain = bot();
        plain.stamina = 40;
        plain.staminaRegenDelayMs = 300;
        Bot helped = bot();
        helped.stamina = 40;
        helped.staminaRegenDelayMs = 300;
        List<Integer> gains = new ArrayList<>();
        for (int tick = 1; tick <= 6; tick += 1) {
            step(plain, idle());
            step(helped, idle(), tick == 2 ? SLASH : null, 1);
            assertThat(helped.staminaRegenDelayMs).as("tick %d", tick).isEqualTo(plain.staminaRegenDelayMs);
            gains.add(helped.stamina - plain.stamina);
        }
        assertThat(gains).containsExactly(0, 10, 10, 10, 10, 10);
        assertThat(plain.stamina).isEqualTo(46);
        assertThat(helped.stamina).isEqualTo(56);
    }

    @Test
    void parityTraceDashIdleHitIdleDash() {
        Bot bot = bot();
        List<List<Object>> trace = new ArrayList<>();
        Object[][] script = {
                {dash(), null}, {idle(), null}, {idle(), SLASH}, {idle(), null}, {dash(), null}};
        for (Object[] entry : script) {
            step(bot, (Action) entry[0], (Integer) entry[1], 7);
            trace.add(List.of(bot.stamina, bot.staminaRegenDelayMs, LegacyAbility.stage(bot, 19)));
        }
        assertThat(trace).containsExactly(
                List.of(70, 500, "active:200"), List.of(70, 400, "active:100"), List.of(80, 300, "cooldown:100"),
                List.of(80, 200, "ready:0"), List.of(50, 500, "active:200"));
    }

    @Test
    void anOldExhaustedConditionMigratesToAStaminaThreshold() throws Exception {
        JsonMapper mapper = new JsonMapper();
        String template = "[{\"type\":\"expression\",\"left\":\"bot.exhausted\",\"leftSelectable\":\"my_bot\",\"comparator\":\"%s\","
                + "\"right\":{\"type\":\"boolean\",\"value\":%s}}]";
        record Case(String comparator, String value, String expected) {}
        for (Case c : List.of(new Case("eq", "true", "lt"), new Case("eq", "false", "gte"),
                new Case("neq", "true", "gte"), new Case("neq", "false", "lt"))) {
            List<Condition> conditions = ConditionResolutionService.normalizeConditions(
                    mapper.readTree(template.formatted(c.comparator(), c.value())));
            assertThat(conditions).hasSize(1);
            Condition migrated = conditions.get(0);
            assertThat(migrated.left()).isEqualTo("bot.stamina");
            assertThat(migrated.comparator()).isEqualTo(c.expected());
            assertThat(migrated.right().numberValue()).isEqualTo(1.0);
            assertThat(migrated.leftSelectable()).isEqualTo("my_bot");
        }
    }
}
