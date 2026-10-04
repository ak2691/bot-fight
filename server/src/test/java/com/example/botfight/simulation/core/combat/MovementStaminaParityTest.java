package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.MovementConfig;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Authoritative mirror of frontend MovementStamina.test.js; keep the cases and numbers in step. */
class MovementStaminaParityTest {
    private static final double WALK = 15;
    private final BotStateService stateService = new BotStateService(new GameConfigCatalog(), new BotCodeService());
    private final ActionExecutionService executor = new ActionExecutionService(stateService);
    private final Arena arena = new Arena(1200, 1200, 1000);

    private static Bot bot() {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes("stamina".getBytes());
        bot.slot = 1;
        bot.x = 200;
        bot.y = 400;
        bot.size = 60;
        bot.rotation = 90;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.moveSpeed = WALK;
        bot.attackSpeedMultiplier = 1.0;
        bot.abilities = Set.of(1, 3, 19, 34);
        return bot;
    }

    private static Action idle() { return new Action(0, 0, 0, null, 0, 0, null, null, null); }
    private static Action walk(boolean sprint) { return new Action(1, 0, 0, null, 0, 0, null, null, null, sprint, false); }
    private static Action ability(int id, double dx, boolean sprint) {
        return new Action(dx, 0, 0, id, 900, 400, null, null, null, sprint, false);
    }
    private static Action cancel() { return new Action(0, 0, 0, null, 0, 0, null, null, null, false, true); }

    private void step(Bot bot, Action action) {
        bot.triggeredAbility = null;
        executor.execute(bot, action, arena);
    }

    private void run(Bot bot, Action action, int ticks) {
        for (int tick = 0; tick < ticks; tick += 1) step(bot, action);
    }

    @Test
    void configMatchesTheBrowserNumbersAndTheHundredMillisecondRule() {
        assertThat(MovementConfig.TICK_MS).isEqualTo(100);
        assertThat(new int[] {
                MovementConfig.STAMINA_MAX, MovementConfig.REGEN_PER_TICK, MovementConfig.REGEN_DELAY_MS,
                MovementConfig.EXHAUSTION_MS, MovementConfig.SPRINT_DRAIN_PER_TICK, MovementConfig.DASH_COST,
                MovementConfig.DASH_GAP_MS, MovementConfig.WINDUP_CANCEL_COST})
                .containsExactly(100, 2, 800, 1_500, 3, 30, 300, 25);
        assertThat(MovementConfig.SPRINT_MULTIPLIER).isEqualTo(1.5);
        for (int ms : new int[] {MovementConfig.REGEN_DELAY_MS, MovementConfig.EXHAUSTION_MS, MovementConfig.DASH_GAP_MS}) {
            assertThat(ms % MovementConfig.TICK_MS).isZero();
        }
    }

    @Test
    void staminaRegeneratesOnlyAfterTheDelay() {
        Bot bot = bot();
        step(bot, ability(19, 0, false));
        assertThat(bot.stamina).isEqualTo(70);
        assertThat(bot.staminaRegenDelayMs).isEqualTo(800);
        for (int tick = 1; tick <= 8; tick += 1) {
            step(bot, idle());
            assertThat(bot.stamina).as("tick %d", tick).isEqualTo(70);
        }
        assertThat(bot.staminaRegenDelayMs).isZero();
        step(bot, idle());
        assertThat(bot.stamina).isEqualTo(72);
        step(bot, idle());
        assertThat(bot.stamina).isEqualTo(74);
        run(bot, idle(), 40);
        assertThat(bot.stamina).isEqualTo(100);
    }

    @Test
    void exhaustionBlocksRegenerationForFifteenHundredMsWithoutSlowdown() {
        Bot bot = bot();
        bot.stamina = 3;
        bot.staminaRegenDelayMs = 800;
        step(bot, walk(true));
        assertThat(bot.stamina).isZero();
        assertThat(bot.exhaustedMs).isEqualTo(1_500);
        assertThat(bot.staminaRegenDelayMs).isEqualTo(800);
        for (int tick = 1; tick <= 15; tick += 1) {
            double x = bot.x;
            step(bot, walk(false));
            assertThat(bot.stamina).as("tick %d", tick).isZero();
            assertThat(bot.x - x).isEqualTo(WALK);
        }
        assertThat(bot.exhaustedMs).isZero();
        double before = bot.x;
        step(bot, walk(false));
        assertThat(bot.stamina).isEqualTo(2);
        assertThat(bot.x - before).isEqualTo(WALK);
    }

    @Test
    void dashChainRunsUntilStaminaRunsOutOnePerGap() {
        Bot bot = bot();
        java.util.List<Integer> dashTicks = new java.util.ArrayList<>();
        for (int tick = 0; tick < 20; tick += 1) {
            bot.dashRemaining = 0;
            step(bot, ability(19, 0, false));
            if (bot.triggeredAbility != null && bot.triggeredAbility == 19) dashTicks.add(tick);
        }
        assertThat(dashTicks).containsExactly(0, 4, 8);
        assertThat(executor.selectedAbilityReady(bot, 19)).isFalse();
    }

    @Test
    void dashGapAndStaminaCheckShowInReadyAndCooldownLeft() {
        Bot fresh = bot();
        assertThat(executor.selectedAbilityReady(fresh, 19)).isTrue();
        assertThat(executor.selectedAbilityCooldownMs(fresh, 19)).isZero();
        Bot gapped = bot();
        gapped.dashGapMs = 200;
        assertThat(executor.selectedAbilityReady(gapped, 19)).isFalse();
        assertThat(executor.selectedAbilityCooldownMs(gapped, 19)).isEqualTo(200);
        Bot shortOnStamina = bot();
        shortOnStamina.stamina = 10;
        assertThat(executor.selectedAbilityReady(shortOnStamina, 19)).isFalse();
        assertThat(executor.selectedAbilityCooldownMs(shortOnStamina, 19)).isEqualTo(1_000);
        shortOnStamina.staminaRegenDelayMs = 500;
        assertThat(executor.selectedAbilityCooldownMs(shortOnStamina, 19)).isEqualTo(1_500);
        shortOnStamina.exhaustedMs = 1_500;
        shortOnStamina.staminaRegenDelayMs = 800;
        assertThat(executor.selectedAbilityCooldownMs(shortOnStamina, 19)).isEqualTo(2_500);
        Bot enough = bot();
        enough.stamina = 30;
        assertThat(executor.selectedAbilityReady(enough, 19)).isTrue();
    }

    @Test
    void sprintIsOneAndAHalfInEveryDirectionAndDrainsThreePerTick() {
        Bot bot = bot();
        step(bot, walk(true));
        assertThat(bot.x).isEqualTo(200 + WALK * 1.5);
        assertThat(bot.stamina).isEqualTo(97);
        assertThat(bot.sprinting).isTrue();
        assertThat(bot.staminaRegenDelayMs).isEqualTo(800);
        run(bot, walk(true), 9);
        assertThat(bot.stamina).isEqualTo(70);
        for (double[] direction : new double[][] {{0, 1}, {-1, 0}, {1, 1}, {-1, -1}}) {
            Bot other = bot();
            other.x = 600;
            other.y = 600;
            double length = Math.hypot(direction[0], direction[1]);
            step(other, new Action(direction[0] / length, direction[1] / length, 0, null, 0, 0, null, null, null, true, false));
            assertThat(Math.hypot(other.x - 600, other.y - 600)).isCloseTo(WALK * 1.5, org.assertj.core.data.Offset.offset(1e-9));
        }
        Bot plain = bot();
        step(plain, walk(false));
        assertThat(plain.x).isEqualTo(200 + WALK);
        assertThat(plain.stamina).isEqualTo(100);
        Bot standing = bot();
        step(standing, new Action(0, 0, 0, null, 0, 0, null, null, null, true, false));
        assertThat(standing.stamina).isEqualTo(100);
        assertThat(standing.sprinting).isFalse();
    }

    @Test
    void sprintStopsAtZeroStamina() {
        Bot bot = bot();
        bot.stamina = 5;
        bot.staminaRegenDelayMs = 800;
        step(bot, walk(true));
        assertThat(bot.stamina).isEqualTo(2);
        step(bot, walk(true));
        assertThat(bot.stamina).isZero();
        assertThat(bot.sprinting).isTrue();
        double x = bot.x;
        step(bot, walk(true));
        assertThat(bot.sprinting).isFalse();
        assertThat(bot.x - x).isEqualTo(WALK);
    }

    @Test
    void startingWindingUpOrBeingActiveWithAnyAbilityCancelsSprint() {
        Bot bot = bot();
        step(bot, ability(1, 1, true));
        assertThat(bot.triggeredAbility).isEqualTo(1);
        assertThat(bot.x).isEqualTo(200 + WALK);
        assertThat(bot.stamina).isEqualTo(100);
        assertThat(bot.sprinting).isFalse();
        for (int tick = 1; tick <= 3; tick += 1) {
            double x = bot.x;
            step(bot, walk(true));
            assertThat(bot.x - x).as("active tick %d", tick).isEqualTo(WALK);
            assertThat(bot.stamina).isEqualTo(100);
        }
        double x = bot.x;
        step(bot, walk(true));
        assertThat(bot.x - x).isEqualTo(WALK * 1.5);
        assertThat(bot.stamina).isEqualTo(97);

        Bot winding = bot();
        step(winding, ability(3, 1, true));
        assertThat(winding.preparingAbility).isEqualTo(3);
        assertThat(winding.x).isEqualTo(200 + WALK);
        double windingX = winding.x;
        step(winding, walk(true));
        assertThat(winding.x - windingX).isEqualTo(WALK);
        assertThat(winding.stamina).isEqualTo(100);

        Bot onCooldown = bot();
        onCooldown.abilityCooldowns.put(1, 500);
        step(onCooldown, ability(1, 1, true));
        assertThat(onCooldown.triggeredAbility).isNull();
        assertThat(onCooldown.x).isEqualTo(200 + WALK * 1.5);
    }

    @Test
    void cancelWindupSpendsTwentyFiveClearsTheWindupAndCanRestartNextTick() {
        Bot bot = bot();
        step(bot, ability(3, 0, false));
        assertThat(bot.preparingAbility).isEqualTo(3);
        assertThat(bot.preparingMs).isEqualTo(800);
        step(bot, cancel());
        assertThat(bot.preparingAbility).isNull();
        assertThat(bot.preparingMs).isZero();
        assertThat(bot.triggeredAbility).isNull();
        assertThat(bot.stamina).isEqualTo(75);
        assertThat(bot.staminaRegenDelayMs).isEqualTo(800);
        assertThat(bot.abilityCooldowns.getOrDefault(3, 0)).isZero();
        assertThat(executor.selectedAbilityReady(bot, 3)).isTrue();
        step(bot, ability(3, 0, false));
        assertThat(bot.preparingAbility).isEqualTo(3);
        assertThat(bot.preparingMs).isEqualTo(800);
        assertThat(bot.stamina).isEqualTo(75);
    }

    @Test
    void cancelAtExactlyTheCostStartsExhaustionAndDoesNothingOtherwise() {
        Bot bot = bot();
        bot.stamina = 25;
        bot.staminaRegenDelayMs = 800;
        step(bot, ability(3, 0, false));
        step(bot, cancel());
        assertThat(bot.stamina).isZero();
        assertThat(bot.exhaustedMs).isEqualTo(1_500);

        Bot idleCancel = bot();
        step(idleCancel, cancel());
        assertThat(idleCancel.stamina).isEqualTo(100);

        Bot poor = bot();
        poor.stamina = 24;
        poor.staminaRegenDelayMs = 800;
        step(poor, ability(3, 0, false));
        step(poor, cancel());
        assertThat(poor.preparingAbility).isEqualTo(3);
        assertThat(poor.preparingMs).isEqualTo(700);
        assertThat(poor.stamina).isEqualTo(24);
    }

    @Test
    void aWindupAlreadyLockedInContinuesWhenAnotherActionIsSelected() {
        Bot bot = bot();
        step(bot, ability(3, 0, false));
        step(bot, ability(1, 0, false));
        assertThat(bot.preparingAbility).isEqualTo(3);
        assertThat(bot.preparingMs).isEqualTo(700);
    }

    @Test
    void aBotThatNeverUsesStaminaKeepsItsStateUnchanged() {
        Bot bot = bot();
        run(bot, walk(false), 5);
        assertThat(bot.stamina).isEqualTo(100);
        assertThat(bot.staminaRegenDelayMs).isZero();
        assertThat(bot.exhaustedMs).isZero();
        assertThat(bot.dashGapMs).isZero();
        assertThat(bot.sprinting).isFalse();
    }

    @Test
    void staminaExhaustedAndSprintingReadForMyBotAndTheOpponent() {
        var resolver = new com.example.botfight.simulation.core.logic.ConditionResolutionService(
                new com.example.botfight.simulation.bots.ConditionEvaluationService(), executor);
        Bot mine = bot();
        mine.stamina = 64;
        Bot theirs = bot();
        theirs.slot = 2;
        theirs.stamina = 12;
        theirs.exhaustedMs = 700;
        theirs.sprinting = true;
        java.util.function.BiFunction<String, String, com.example.botfight.simulation.core.orchestration.DuelSimulationService.StateValue> read =
                (variable, selectable) -> resolver.resolveStateVariable(variable, selectable,
                        new com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition(
                                "expression", 0, selectable, selectable, null, variable, null, "", "eq",
                                com.example.botfight.simulation.core.orchestration.DuelSimulationService.Operand.number(0)),
                        mine, theirs, java.util.List.of(), arena);
        assertThat(read.apply("bot.stamina", "my_bot").numberValue()).isEqualTo(64.0);
        assertThat(read.apply("bot.stamina", "opponent").numberValue()).isEqualTo(12.0);
        assertThat(read.apply("bot.exhausted", "opponent").booleanValue()).isTrue();
        assertThat(read.apply("bot.exhausted", "my_bot").booleanValue()).isFalse();
        assertThat(read.apply("bot.sprinting", "opponent").booleanValue()).isTrue();
        assertThat(read.apply("bot.sprinting", "my_bot").booleanValue()).isFalse();
    }

    // ---- Fast turn (a Rotate setting; mirrors the browser's MovementStamina.test.js) ----

    private static Action turn(double dRot, boolean fast) {
        return new Action(0, 0, dRot, null, 0, 0, null, null, null, false, false, fast);
    }

    private static Action turnWalking(double dRot, boolean sprint) {
        return new Action(1, 0, dRot, null, 0, 0, null, null, null, sprint, false, true);
    }

    @Test
    void fastTurnRotatesTwentyFourDegreesAndDrainsTwo() {
        Bot bot = bot();
        step(bot, turn(1, true));
        assertThat(bot.rotation).isEqualTo(114.0);
        assertThat(bot.stamina).isEqualTo(98);
        assertThat(bot.fastTurning).isTrue();
        assertThat(bot.staminaRegenDelayMs).isEqualTo(800);
        Bot plain = bot();
        step(plain, turn(1, false));
        assertThat(plain.rotation).isEqualTo(102.0);
        assertThat(plain.stamina).isEqualTo(100);
        assertThat(plain.fastTurning).isFalse();
        Bot reverse = bot();
        step(reverse, turn(-0.5, true));
        assertThat(reverse.rotation).isEqualTo(78.0);
    }

    @Test
    void fastTurnPaysNothingOnATickThatDoesNotRotate() {
        Bot bot = bot();
        step(bot, turn(0, true));
        assertThat(bot.rotation).isEqualTo(90.0);
        assertThat(bot.stamina).isEqualTo(100);
        assertThat(bot.fastTurning).isFalse();
        assertThat(bot.staminaRegenDelayMs).isZero();
    }

    @Test
    void belowTwoStaminaOrWhileExhaustedTheBotTurnsAtNormalSpeedForFree() {
        Bot low = bot();
        low.stamina = 1;
        low.staminaRegenDelayMs = 800;
        step(low, turn(1, true));
        assertThat(low.rotation).isEqualTo(102.0);
        assertThat(low.stamina).isEqualTo(1);
        assertThat(low.fastTurning).isFalse();
        Bot exhausted = bot();
        exhausted.stamina = 0;
        exhausted.exhaustedMs = 1000;
        step(exhausted, turn(1, true));
        assertThat(exhausted.rotation).isEqualTo(102.0);
        assertThat(exhausted.stamina).isZero();
        assertThat(exhausted.fastTurning).isFalse();
        Bot last = bot();
        last.stamina = 2;
        last.staminaRegenDelayMs = 800;
        step(last, turn(1, true));
        assertThat(last.rotation).isEqualTo(114.0);
        assertThat(last.stamina).isZero();
        assertThat(last.exhaustedMs).isEqualTo(MovementConfig.EXHAUSTION_MS);
    }

    @Test
    void fastTurnAndSprintDrainInTheSameTick() {
        Bot bot = bot();
        step(bot, turnWalking(1, true));
        assertThat(bot.stamina).isEqualTo(100 - MovementConfig.SPRINT_DRAIN_PER_TICK - MovementConfig.FAST_TURN_DRAIN_PER_TICK);
        assertThat(bot.sprinting).isTrue();
        assertThat(bot.fastTurning).isTrue();
        assertThat(bot.rotation).isEqualTo(114.0);
        Bot attacking = bot();
        step(attacking, new Action(0, 0, 1, 1, 900, 400, null, null, null, false, false, true));
        assertThat(attacking.fastTurning).isTrue();
        assertThat(attacking.rotation).isEqualTo(114.0);
    }

    @Test
    void theStaggerRotationMultiplierAppliesToTheFastStep() {
        Bot bot = bot();
        BotStateService.upsertStatusEffect(bot, new com.example.botfight.simulation.core.state.StatusEffectState("hit-stagger", 1_000, 0));
        step(bot, turn(1, true));
        assertThat(bot.rotation).isCloseTo(90 + 24 * 0.85, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(bot.stamina).isEqualTo(98);
    }

    @Test
    void aStunnedBotTurnsAtNormalSpeedAndPaysNothing() {
        Bot bot = bot();
        BotStateService.upsertStatusEffect(bot, new com.example.botfight.simulation.core.state.StatusEffectState("stun", 1_000, 0));
        step(bot, turn(1, true));
        assertThat(bot.rotation).isEqualTo(102.0);
        assertThat(bot.stamina).isEqualTo(100);
        assertThat(bot.fastTurning).isFalse();
    }

    @Test
    void scriptedFastTurnScenarioMatchesTheBrowserTrace() {
        Bot bot = bot();
        bot.stamina = 7;
        bot.staminaRegenDelayMs = 800;
        double[] rotation = new double[4];
        int[] stamina = new int[4];
        boolean[] fast = new boolean[4];
        Action[] script = {turn(1, true), turnWalking(1, true), turn(1, true), turn(-0.25, true)};
        for (int index = 0; index < script.length; index += 1) {
            step(bot, script[index]);
            rotation[index] = bot.rotation;
            stamina[index] = bot.stamina;
            fast[index] = bot.fastTurning;
        }
        assertThat(rotation).containsExactly(114.0, 138.0, 150.0, 147.0);
        assertThat(stamina).containsExactly(5, 0, 0, 0);
        assertThat(fast).containsExactly(true, true, false, false);
    }

    @Test
    void turningFastReadsForMyBotAndTheOpponent() {
        var resolver = new com.example.botfight.simulation.core.logic.ConditionResolutionService(
                new com.example.botfight.simulation.bots.ConditionEvaluationService(), executor);
        Bot mine = bot();
        Bot theirs = bot();
        theirs.slot = 2;
        theirs.fastTurning = true;
        java.util.function.BiFunction<String, String, com.example.botfight.simulation.core.orchestration.DuelSimulationService.StateValue> read =
                (variable, selectable) -> resolver.resolveStateVariable(variable, selectable,
                        new com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition(
                                "expression", 0, selectable, selectable, null, variable, null, "", "eq",
                                com.example.botfight.simulation.core.orchestration.DuelSimulationService.Operand.number(0)),
                        mine, theirs, java.util.List.of(), arena);
        assertThat(read.apply("bot.fastTurning", "opponent").booleanValue()).isTrue();
        assertThat(read.apply("bot.fastTurning", "my_bot").booleanValue()).isFalse();
    }
}
