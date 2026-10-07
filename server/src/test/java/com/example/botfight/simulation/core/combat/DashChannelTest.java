package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DashAction;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Authoritative mirror of frontend DashChannel.test.js; keep the scenarios and numbers in step. */
class DashChannelTest {
    private static final int SLASH = 1;
    private static final int SNIPER = 3;
    private static final int FIREBALL = 5;
    private static final int DASH = 19;
    private static final double WALK = 15;
    private final GameConfigCatalog catalog = new GameConfigCatalog();
    private final BotStateService stateService = new BotStateService(catalog, new BotCodeService());
    private final ActionExecutionService executor = new ActionExecutionService(stateService);
    private final Arena arena = new Arena(1200, 1200, 1000);
    private final JsonMapper mapper = new JsonMapper();

    private static Bot bot() {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes("dash-channel".getBytes());
        bot.slot = 1;
        bot.x = 200;
        bot.y = 400;
        bot.size = 60;
        bot.rotation = 90;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.moveSpeed = WALK;
        bot.attackSpeedMultiplier = 1.0;
        bot.abilities = Set.of(SLASH, SNIPER, FIREBALL, DASH);
        return bot;
    }

    private static DashAction dashAction() {
        return new DashAction(DASH, 900, 400, "absolute", "east", null);
    }

    private static Action action(double dx, boolean sprint, Integer ability, boolean withDash) {
        return new Action(dx, 0, 0, ability, 900, 400, null, null, null, sprint, false, false, withDash ? dashAction() : null);
    }

    private static Action idle() { return action(0, false, null, false); }

    private void step(Bot bot, Action action) {
        bot.triggeredAbility = null;
        executor.execute(bot, action, arena);
    }

    private static Bot withStatus(String type) {
        Bot bot = bot();
        BotStateService.upsertStatusEffect(bot, new StatusEffectState(type, 1_000, 0));
        return bot;
    }

    @Test
    void dashHasItsOwnCategoryAndIgnoresTheAbilityLock() {
        assertThat(BotLogicContracts.actionContract(DASH).head()).isEqualTo(BotLogicContracts.ActionHead.DASH);
        assertThat(BotLogicContracts.actionContract(SLASH).head()).isEqualTo(BotLogicContracts.ActionHead.ABILITY);
        Bot winding = bot();
        winding.preparingAbility = SNIPER;
        winding.preparingMs = 500;
        assertThat(executor.selectedAbilityReady(winding, DASH)).isTrue();
        Bot fireballActive = bot();
        fireballActive.abilityActiveMs.put(FIREBALL, 300);
        assertThat(executor.selectedAbilityReady(fireballActive, DASH)).isTrue();
        Bot dashing = bot();
        dashing.abilityActiveMs.put(DASH, 300);
        assertThat(executor.selectedAbilityReady(dashing, SLASH)).isTrue();
    }

    @Test
    void aDashAndASwingChosenOnTheSameTickBothStart() {
        Bot both = bot();
        step(both, action(0, false, SLASH, true));
        assertThat(both.triggeredAbility).as("the swing owns the trigger so its hit still resolves").isEqualTo(SLASH);
        assertThat(both.abilityActiveMs.get(SLASH)).isPositive();
        assertThat(both.abilityActiveMs.get(DASH)).isPositive();
        assertThat(both.stamina).isEqualTo(70);
        assertThat(both.dashGapMs).isEqualTo(300);
        assertThat(both.x).isGreaterThan(200);
        Bot alone = bot();
        step(alone, action(0, false, null, true));
        assertThat(alone.triggeredAbility).isEqualTo(DASH);
    }

    @Test
    void aDashStartsDuringAnotherAbilitysWindupAndActivePhaseAndTheWindupCarriesOn() {
        Bot winding = bot();
        step(winding, action(0, false, SNIPER, false));
        assertThat(winding.preparingAbility).isEqualTo(SNIPER);
        int preparingMs = winding.preparingMs;
        step(winding, action(0, false, SNIPER, true));
        assertThat(winding.triggeredAbility).isEqualTo(DASH);
        assertThat(winding.preparingAbility).isEqualTo(SNIPER);
        assertThat(winding.preparingMs).isEqualTo(preparingMs - 100);

        Bot active = bot();
        step(active, action(0, false, SLASH, false));
        assertThat(active.abilityActiveMs.get(SLASH)).isPositive();
        step(active, action(0, false, null, true));
        assertThat(active.triggeredAbility).isEqualTo(DASH);
    }

    @Test
    void anAttackStartsDuringADash() {
        Bot dashing = bot();
        step(dashing, action(0, false, null, true));
        assertThat(dashing.abilityActiveMs.get(DASH)).isPositive();
        step(dashing, action(0, false, SLASH, false));
        assertThat(dashing.triggeredAbility).isEqualTo(SLASH);
        Bot winding = bot();
        step(winding, action(0, false, null, true));
        step(winding, action(0, false, SNIPER, false));
        assertThat(winding.preparingAbility).isEqualTo(SNIPER);
    }

    @Test
    void silenceDoesNotStopDashWhileStunSlowAndMovementLockDo() {
        Bot silenced = withStatus("silence");
        step(silenced, action(0, false, null, true));
        assertThat(silenced.triggeredAbility).isEqualTo(DASH);
        Bot silencedSwing = withStatus("silence");
        step(silencedSwing, action(0, false, SLASH, false));
        assertThat(silencedSwing.triggeredAbility).as("silence still stops abilities").isNull();

        for (String type : List.of("stun", "slow")) {
            Bot blocked = withStatus(type);
            step(blocked, action(0, false, null, true));
            assertThat(blocked.triggeredAbility).as("%s stops the dash", type).isNull();
            assertThat(blocked.stamina).isEqualTo(100);
        }
        // Movement-lock cuts a dash short: the first 75-unit step happens as it starts, the rest never does.
        Bot locked = withStatus("movement-lock");
        step(locked, action(0, false, null, true));
        assertThat(locked.triggeredAbility).isEqualTo(DASH);
        for (int tick = 0; tick < 3; tick += 1) step(locked, idle());
        assertThat(locked.x).isEqualTo(275);
        assertThat(locked.dashRemaining).isZero();
        Bot free = bot();
        step(free, action(0, false, null, true));
        for (int tick = 0; tick < 3; tick += 1) step(free, idle());
        assertThat(free.x).as("an unlocked dash covers its full 150 units").isEqualTo(350);
    }

    @Test
    void theStaminaAndGapGatesAreUnchanged() {
        Bot tired = bot();
        tired.stamina = 29;
        tired.staminaRegenDelayMs = 500;
        step(tired, action(0, false, null, true));
        assertThat(tired.triggeredAbility).isNull();
        Bot enough = bot();
        enough.stamina = 30;
        enough.staminaRegenDelayMs = 500;
        step(enough, action(0, false, null, true));
        assertThat(enough.triggeredAbility).isEqualTo(DASH);
        Bot gapped = bot();
        gapped.dashGapMs = 200;
        step(gapped, action(0, false, null, true));
        assertThat(gapped.triggeredAbility).isNull();
        Bot dashed = bot();
        step(dashed, action(0, false, null, true));
        assertThat(dashed.stamina).isEqualTo(70);
        assertThat(dashed.abilityCooldowns.getOrDefault(DASH, 0)).as("no cooldown").isZero();
    }

    @Test
    void sprintHoldsThroughAnAbilitysStartWindupAndActivePhase() {
        double fast = WALK * 1.5;
        Bot bot = bot();
        step(bot, action(1, true, SLASH, false));
        assertThat(bot.triggeredAbility).isEqualTo(SLASH);
        assertThat(bot.x).isEqualTo(200 + fast);
        assertThat(bot.stamina).isEqualTo(97);
        for (int tick = 1; tick <= 3; tick += 1) {
            double x = bot.x;
            step(bot, action(1, true, null, false));
            assertThat(bot.x - x).as("active tick %d", tick).isEqualTo(fast);
        }
        assertThat(bot.stamina).isEqualTo(88);
        Bot winding = bot();
        step(winding, action(1, true, SNIPER, false));
        assertThat(winding.preparingAbility).isEqualTo(SNIPER);
        assertThat(winding.x).isEqualTo(200 + fast);
        double x = winding.x;
        step(winding, action(1, true, null, false));
        assertThat(winding.x - x).isEqualTo(fast);
        assertThat(winding.stamina).isEqualTo(94);
    }

    private static List<List<Object>> trace(Bot bot, DashChannelTest test, Action... script) {
        List<List<Object>> rows = new ArrayList<>();
        for (Action action : script) {
            test.step(bot, action);
            rows.add(List.of(bot.triggeredAbility == null ? "none" : bot.triggeredAbility, bot.x, bot.stamina,
                    bot.staminaRegenDelayMs, bot.dashGapMs, bot.sprinting));
        }
        return rows;
    }

    @Test
    void parityTraceDashPlusSwing() {
        assertThat(trace(bot(), this, action(0, false, SLASH, true), idle(), idle(), idle(), idle())).containsExactly(
                List.of(SLASH, 275.0, 70, 500, 300, false),
                List.of("none", 350.0, 70, 400, 200, false),
                List.of("none", 350.0, 70, 300, 100, false),
                List.of("none", 350.0, 70, 200, 0, false),
                List.of("none", 350.0, 70, 100, 0, false));
    }

    @Test
    void parityTraceSprintInSwingRunDry() {
        Bot bot = bot();
        bot.stamina = 12;
        bot.staminaRegenDelayMs = 500;
        Action run = action(1, true, null, false);
        assertThat(trace(bot, this, run, action(1, true, SLASH, false), run, run, run)).containsExactly(
                List.of("none", 222.5, 9, 500, 0, true),
                List.of(SLASH, 245.0, 6, 500, 0, true),
                List.of("none", 267.5, 3, 500, 0, true),
                List.of("none", 290.0, 0, 500, 0, true),
                List.of("none", 305.0, 0, 400, 0, false));
    }

    // ---- Through the real selection (two roots, one conditional, a chain) ----

    private DuelSimulationService simulation() {
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actions = new ActionExecutionService(botStateService);
        return new DuelSimulationService(
                new ConditionResolutionService(new ConditionEvaluationService(), actions),
                new ReplayMappingService(), botStateService, actions);
    }

    private JsonNode brain(String roots, String chains) throws Exception {
        return mapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"loadout\":{\"abilities\":[1,3]},\"roots\":" + roots
                + (chains == null ? "" : ",\"chains\":" + chains) + "}");
    }

    private static String root(int priority, String actions) {
        return "{\"priority\":" + priority + ",\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":[{\"type\":\"always\"}],"
                + "\"actions\":[" + actions + "],\"children\":[]}]}";
    }

    private static final String SWING = "{\"action\":1,\"selectable\":\"opponent_1\"}";
    private static final String DASH_TO = "{\"action\":19,\"selectable\":\"opponent_1\"}";

    /** The first tick's ability and dash active times, after running one tick of the real selection. */
    private int[] firstTickActive(JsonNode mainBrain) throws Exception {
        int[] active = new int[2];
        boolean[] seen = {false};
        simulation().simulateWithoutReplay(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("dash-selection".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 7L,
                new DuelArenaRequest(1200, 1200, 200),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 300, 600, 90.0, 60, "custom", mainBrain, null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, 380, 600, 270.0, 60, "custom", brain("[]", null), null, 2))),
                (elapsedMs, bots, entities, arena) -> {
                    if (!seen[0]) {
                        seen[0] = true;
                        active[0] = bots.get(0).abilityActiveMs.getOrDefault(SLASH, 0);
                        active[1] = bots.get(0).abilityActiveMs.getOrDefault(DASH, 0);
                    }
                    return false;
                });
        return active;
    }

    @Test
    void aDashAndAnAttackAreChosenAndStartedTogetherFromTwoRootsOneConditionalAndAChain() throws Exception {
        for (JsonNode brain : List.of(
                brain("[" + root(1, SWING) + "," + root(2, DASH_TO) + "]", null),
                brain("[" + root(1, DASH_TO) + "," + root(2, SWING) + "]", null),
                brain("[" + root(1, SWING + "," + DASH_TO) + "]", null),
                brain("[" + root(1, "{\"action\":\"run_chain\",\"chainId\":\"chain.both\"}") + "]",
                        "[{\"id\":\"chain.both\",\"name\":\"both\",\"steps\":[{\"type\":\"action\",\"action\":1,\"selectable\":\"opponent_1\",\"continue\":\"now\"},"
                                + "{\"type\":\"action\",\"action\":19,\"selectable\":\"opponent_1\",\"continue\":\"now\"}]}]"))) {
            int[] active = firstTickActive(brain);
            assertThat(active[0]).as("swing active on tick one: %s", brain).isPositive();
            assertThat(active[1]).as("dash active on tick one: %s", brain).isPositive();
        }
    }
}
