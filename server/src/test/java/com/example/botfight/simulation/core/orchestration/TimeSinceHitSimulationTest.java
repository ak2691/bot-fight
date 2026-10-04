package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Authoritative Time Since Hit; mirrors the frontend AbilitySinceHit tests, keep the scenarios and numbers in step. */
class TimeSinceHitSimulationTest {
    private static final int SLASH = 1;
    private static final int FIREBALL = 5;
    private static final double MAIN_Y = 600;
    private final JsonMapper jsonMapper = new JsonMapper();
    private final DuelSimulationService service = newService();

    private static DuelSimulationService newService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actions = new ActionExecutionService(botStateService);
        return new DuelSimulationService(
                new ConditionResolutionService(new ConditionEvaluationService(), actions),
                new ReplayMappingService(), botStateService, actions);
    }

    /** One bot's state after a tick, as the next tick's logic will see it. */
    private record Snapshot(double x, double y, double hp, double maxHp, Map<Integer, Integer> hitAges) {}

    private record Tick(Snapshot main, Snapshot defender, Snapshot ally) {}

    private JsonNode brain(int ability, String roots) {
        try {
            return jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"loadout\":{\"abilities\":["
                    + ability + "]},\"roots\":" + roots + "}");
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String root(int priority, String conditions, String action) {
        return "{\"priority\":" + priority + ",\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":["
                + conditions + "],\"actions\":[" + action + "],\"children\":[]}]}";
    }

    private static String useAbility(int ability) {
        return root(1, "{\"type\":\"always\"}", "{\"action\":" + ability + ",\"selectable\":\"opponent_1\"}");
    }

    private static String walk(int priority, int direction, String conditions) {
        return root(priority, conditions,
                "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":" + direction + "}");
    }

    private static String sinceHit(int ability, String selectable) {
        return "{\"type\":\"expression\",\"left\":\"bot.selectedAbilitySinceHit\",\"ability\":" + ability
                + ",\"selectable\":\"" + selectable + "\",\"leftSelectable\":\"" + selectable
                + "\",\"comparator\":\"lt\",\"right\":{\"type\":\"number\",\"value\":99999}}";
    }

    private static Snapshot snapshot(Bot bot) {
        return new Snapshot(bot.x, bot.y, bot.hp, bot.maxHp, new HashMap<>(bot.abilityLastHitAgeMs));
    }

    private List<Tick> run(int ability, JsonNode mainBrain, JsonNode defenderBrain, double defenderX,
                           double defenderY, Double allyX, int ticks) {
        List<DuelBotRequest> bots = new ArrayList<>(List.of(
                new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 300, MAIN_Y,
                        90.0, 60, "custom", mainBrain, null, 1),
                new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, defenderX, defenderY,
                        270.0, 60, "custom", defenderBrain, null, 2)));
        if (allyX != null) {
            bots.add(new DuelBotRequest(UUID.nameUUIDFromBytes("ally".getBytes()), "ally", 3, allyX, MAIN_Y,
                    270.0, 60, "custom", brain(ability, "[]"), null, 1));
        }
        List<Tick> history = new ArrayList<>();
        service.simulateWithoutReplay(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("since-hit".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 7L,
                new DuelArenaRequest(1200, 1200, ticks * 100), bots),
                (elapsedMs, tickBots, entities, arena) -> {
                    history.add(new Tick(snapshot(tickBots.get(0)), snapshot(tickBots.get(1)),
                            tickBots.size() > 2 ? snapshot(tickBots.get(2)) : null));
                    return false;
                });
        return history;
    }

    private List<Tick> run(int ability, JsonNode mainBrain, double defenderX, double defenderY, Double allyX, int ticks) {
        return run(ability, mainBrain, brain(ability, "[]"), defenderX, defenderY, allyX, ticks);
    }

    private static int firstTick(List<Tick> history, java.util.function.Predicate<Tick> predicate) {
        for (int tick = 0; tick < history.size(); tick += 1) if (predicate.test(history.get(tick))) return tick;
        return -1;
    }

    @Test
    void variableIsAGenericAbilityNumberWithTheGeneralRange() {
        BotLogicContracts.VariableContract contract = BotLogicContracts.variableContract("bot.selectedAbilitySinceHit");
        assertThat(contract.requiresAbility()).isTrue();
        assertThat(contract.numericRangeFor(BotLogicContracts.BRAIN_SCHEMA_V2).minimum()).isZero();
        assertThat(contract.numericRangeFor(BotLogicContracts.BRAIN_SCHEMA_V2).maximum()).isEqualTo(99_999);
    }

    @Test
    void slashHitReadsPointOneTheNextTickAndKeepsCountingThroughMisses() {
        JsonNode brain = brain(SLASH, "[" + useAbility(SLASH) + "," + walk(2, 270, sinceHit(SLASH, "my_bot")) + "]");
        List<Tick> history = run(SLASH, brain, 380, MAIN_Y, null, 14);
        int hit = firstTick(history, tick -> tick.defender().hp() < tick.defender().maxHp());
        assertThat(hit).isGreaterThanOrEqualTo(0);
        for (int tick = 0; tick < hit; tick += 1) assertThat(history.get(tick).main().hitAges()).doesNotContainKey(SLASH);
        int[][] expected = {{0, 100}, {1, 200}, {2, 300}, {3, 400}};
        for (int[] entry : expected) {
            assertThat(history.get(hit + entry[0]).main().hitAges().get(SLASH)).as("tick %d", hit + entry[0]).isEqualTo(entry[1]);
        }
        // The condition sees 0.1 on the tick after the hit: that is when the walk away starts.
        assertThat(firstTick(history, tick -> tick.main().x() < 300)).isEqualTo(hit + 1);
    }

    @Test
    void fireballHitIsAttributedAtImpactTimeNotCastTime() {
        List<Tick> history = run(FIREBALL, brain(FIREBALL, "[" + useAbility(FIREBALL) + "]"), 800, MAIN_Y, null, 24);
        int impact = firstTick(history, tick -> tick.defender().hp() < tick.defender().maxHp());
        assertThat(impact).isGreaterThan(1);
        for (int tick = 0; tick < impact; tick += 1) {
            assertThat(history.get(tick).main().hitAges()).as("tick %d", tick).doesNotContainKey(FIREBALL);
        }
        assertThat(history.get(impact).main().hitAges().get(FIREBALL)).isEqualTo(100);
        assertThat(history.get(impact + 1).main().hitAges().get(FIREBALL)).isEqualTo(200);
    }

    @Test
    void aHitOnAnAllyDoesNotCount() {
        for (int ability : new int[] {SLASH, FIREBALL}) {
            List<Tick> history = run(ability, brain(ability, "[" + useAbility(ability) + "]"),
                    300, 1150, ability == SLASH ? 380.0 : 700.0, 24);
            assertThat(history).allSatisfy(tick -> {
                assertThat(tick.defender().hp()).isEqualTo(tick.defender().maxHp());
                assertThat(tick.main().hitAges()).doesNotContainKey(ability);
            });
        }
    }

    @Test
    void timeSinceHitCanBeReadForAnOpponentsAbility() {
        JsonNode watcher = brain(SLASH, "[" + walk(1, 180, sinceHit(SLASH, "opponent_1")) + "]");
        List<Tick> history = run(SLASH, watcher, brain(SLASH, "[" + useAbility(SLASH) + "]"), 380, MAIN_Y, null, 8);
        int hit = firstTick(history, tick -> tick.main().hp() < tick.main().maxHp());
        assertThat(hit).isGreaterThanOrEqualTo(0);
        assertThat(history.get(hit).defender().hitAges().get(SLASH)).isEqualTo(100);
        // My Bot starts walking on the tick after it reads 0.1 for the opponent's Slash.
        assertThat(firstTick(history, tick -> tick.main().y() != MAIN_Y)).isEqualTo(hit + 1);
    }

    @Test
    void anAbilityThatNeverHitReadsTheGeneralNumberLimit() {
        List<Tick> history = run(SLASH, brain(SLASH, "[" + useAbility(SLASH) + "]"), 1100, MAIN_Y, null, 8);
        assertThat(history).allSatisfy(tick -> assertThat(tick.main().hitAges()).doesNotContainKey(SLASH));
        Bot bot = new Bot();
        ActionExecutionService actions = new ActionExecutionService(
                new BotStateService(new GameConfigCatalog(), new BotCodeService()));
        assertThat(actions.selectedAbilitySinceHitMs(bot, SLASH) / 1000.0).isEqualTo(99_999.0);
    }
}
