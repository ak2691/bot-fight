package com.example.botfight.simulation.core.logic;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class VersionedCoordinateRuntimeTest {
    private static final String V1 = "bot-logic-tree-v1";
    private static final String V2 = "bot-logic-tree-v2";
    private final JsonMapper jsonMapper = new JsonMapper();
    private final ConditionResolutionService conditions = newConditionResolutionService();
    private final ActionExecutionService actions = newActionExecutionService();

    @Test
    void entityCoordinatesAndCoordinateConditionsDispatchByBrainVersion() throws Exception {
        Bot player = bot(V1, 600, 600, 0);
        var v1CoordinateCondition = ConditionResolutionService.normalizeConditions(jsonMapper.readTree("""
                [{"type":"expression","left":"selectable.y","leftSelectable":"my_bot",
                  "comparator":"eq","right":{"type":"number","value":600}}]
                """), V1).getFirst();
        var v2CoordinateCondition = ConditionResolutionService.normalizeConditions(jsonMapper.readTree("""
                [{"type":"expression","left":"selectable.y","leftSelectable":"my_bot",
                  "comparator":"eq","right":{"type":"number","value":0}}]
                """), V2).getFirst();

        assertThat(conditions.resolveStateVariable("selectable.x", "my_bot", v1CoordinateCondition,
                player, null, List.of(), arena(), V1).numberValue()).isEqualTo(600);
        assertThat(conditions.resolveStateVariable("selectable.y", "my_bot", v1CoordinateCondition,
                player, null, List.of(), arena(), V1).numberValue()).isEqualTo(600);
        assertThat(conditions.resolveStateVariable("selectable.x", "my_bot", v2CoordinateCondition,
                player, null, List.of(), arena(), V2).numberValue()).isEqualTo(0);
        assertThat(conditions.resolveStateVariable("selectable.y", "my_bot", v2CoordinateCondition,
                player, null, List.of(), arena(), V2).numberValue()).isEqualTo(0);
        assertThat(conditions.evaluateConditions(List.of(v1CoordinateCondition), player, null,
                List.of(), arena(), V1)).isTrue();
        assertThat(conditions.evaluateConditions(List.of(v2CoordinateCondition), player, null,
                List.of(), arena(), V2)).isTrue();

        var v1Targets = ConditionResolutionService.normalizeConditions(jsonMapper.readTree("""
                [{"type":"expression","left":"selectable.distance","selectable1":"my_bot","targetMode":"coordinates",
                  "targetX":600,"targetY":150,"comparator":"eq","right":{"type":"number","value":450}},
                 {"type":"expression","left":"selectable.relativeBearing","selectable1":"my_bot","targetMode":"coordinates",
                  "targetX":600,"targetY":150,"comparator":"eq","right":{"type":"number","value":0}}]
                """), V1);
        var v2Targets = ConditionResolutionService.normalizeConditions(jsonMapper.readTree("""
                [{"type":"expression","left":"selectable.distance","selectable1":"my_bot","targetMode":"coordinates",
                  "targetX":0,"targetY":450,"comparator":"eq","right":{"type":"number","value":450}},
                 {"type":"expression","left":"selectable.relativeBearing","selectable1":"my_bot","targetMode":"coordinates",
                  "targetX":0,"targetY":450,"comparator":"eq","right":{"type":"number","value":0}}]
                """), V2);

        assertThat(v2Targets.getFirst().targetX()).isEqualTo(600);
        assertThat(v2Targets.getFirst().targetY()).isEqualTo(150);
        assertThat(conditions.evaluateConditions(v1Targets, player, null, List.of(), arena(), V1)).isTrue();
        assertThat(conditions.evaluateConditions(v2Targets, player, null, List.of(), arena(), V2)).isTrue();
    }

    @Test
    void customVariableActionOperandsReadCoordinatesWithTheirBrainVersion() throws Exception {
        JsonNode xTerms = jsonMapper.readTree("""
                [{"operator":"set","operand":{"type":"variable","value":"selectable.x","selectable":"my_bot"}}]
                """);
        JsonNode yTerms = jsonMapper.readTree("""
                [{"operator":"set","operand":{"type":"variable","value":"selectable.y","selectable":"my_bot"}}]
                """);

        assertThat(readCoordinate(V1, xTerms, "custom.x")).isEqualTo(600);
        assertThat(readCoordinate(V1, yTerms, "custom.y")).isEqualTo(150);
        assertThat(readCoordinate(V2, xTerms, "custom.x")).isEqualTo(0);
        assertThat(readCoordinate(V2, yTerms, "custom.y")).isEqualTo(450);
    }

    private double readCoordinate(String version, JsonNode terms, String variableId) {
        Bot player = bot(version, 600, 150, 0);
        player.customVariableTypes.put(variableId, "number");
        player.customVariables.put(variableId, 0.0);
        StrategyBlock action = new StrategyBlock(0, "variable", "my_bot", 0, 0, null,
                0, 0, null, null, variableId, terms, 1, List.of(), Double.NaN);
        actions.applyCustomVariableAction(player, null, List.of(), arena(), conditions, action, version);
        return ((Number) player.customVariables.get(variableId)).doubleValue();
    }

    private static Bot bot(String version, double x, double y, double rotation) {
        Bot bot = new Bot();
        bot.x = x;
        bot.y = y;
        bot.rotation = rotation;
        bot.size = 60;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.brainSchemaVersion = version;
        return bot;
    }

    private static Arena arena() {
        return new Arena(1200, 1200, 100);
    }

    private static ConditionResolutionService newConditionResolutionService() {
        return new ConditionResolutionService(new ConditionEvaluationService(), newActionExecutionService());
    }

    private static ActionExecutionService newActionExecutionService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botState = new BotStateService(catalog, new BotCodeService());
        return new ActionExecutionService(botState);
    }
}
