package com.example.botfight.service.puzzle;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class PuzzleOutcomeEvaluatorTest {
    private final JsonMapper jsonMapper = new JsonMapper();
    private final ConditionResolutionService conditionResolutionService = newConditionResolutionService();

    @Test
    void evaluatesCurrentConditionalNodeExpressionsOnAuthoritativeState() throws Exception {
        PuzzleOutcomeEvaluator evaluator = new PuzzleOutcomeEvaluator(
                conditionResolutionService,
                jsonMapper.readTree("""
                        [{"type":"expression","left":"selectable.hp","leftSelectable":"opponent","comparator":"lte","right":{"type":"number","value":0}}]
                        """),
                jsonMapper.createArrayNode(),
                90_000);
        DuelSimulationService.Bot player = bot(1, 150);
        DuelSimulationService.Bot opponent = bot(2, 0);

        boolean stopped = evaluator.afterTick(
                100,
                List.of(player, opponent),
                List.of(),
                new DuelSimulationService.Arena(1000, 1000, 90_000));

        assertThat(stopped).isTrue();
        assertThat(evaluator.status()).isEqualTo("solved");
        assertThat(evaluator.elapsedMs()).isEqualTo(100);
    }

    @Test
    void appliesLoseConditionsBeforeTheTimeLimit() throws Exception {
        PuzzleOutcomeEvaluator evaluator = new PuzzleOutcomeEvaluator(
                conditionResolutionService,
                jsonMapper.readTree("""
                        [{"type":"expression","left":"selectable.hp","leftSelectable":"opponent","comparator":"lte","right":{"type":"number","value":0}}]
                        """),
                jsonMapper.readTree("""
                        [{"type":"expression","left":"selectable.hp","leftSelectable":"my_bot","comparator":"lte","right":{"type":"number","value":0}}]
                        """),
                90_000);
        DuelSimulationService.Bot player = bot(1, 0);
        DuelSimulationService.Bot opponent = bot(2, 150);

        boolean stopped = evaluator.afterTick(
                100,
                List.of(player, opponent),
                List.of(),
                new DuelSimulationService.Arena(1000, 1000, 90_000));

        assertThat(stopped).isTrue();
        assertThat(evaluator.status()).isEqualTo("failed");
    }

    @Test
    void appliesPuzzleModifyRulesBeforeEvaluatingWinConditions() throws Exception {
        PuzzleOutcomeEvaluator evaluator = new PuzzleOutcomeEvaluator(
                conditionResolutionService,
                newActionExecutionService(),
                jsonMapper.createArrayNode(),
                jsonMapper.createArrayNode(),
                jsonMapper.readTree("""
                        {
                          "version":"bot-logic-tree-v1",
                          "customVariables":[{"id":"custom.puzzle.counter","name":"Counter","valueType":"number","initialValue":0}],
                          "roots":[
                            {"id":"modify","name":"Modify Custom Variable","kind":"modify","branches":[{"conditions":[{"type":"always"}],"actions":[{"action":"variable","variableId":"custom.puzzle.counter","terms":[{"operator":"add","operand":{"type":"number","value":1}}]}],"children":[]}]},
                            {"id":"win","name":"Win Condition","kind":"win","branches":[{"conditions":[{"type":"expression","left":"custom.puzzle.counter","comparator":"gte","right":{"type":"number","value":1}}],"actions":[],"children":[]}]}
                          ]
                        }
                        """),
                90_000);

        boolean stopped = evaluator.afterTick(
                100,
                List.of(bot(1, 150), bot(2, 150)),
                List.of(),
                new DuelSimulationService.Arena(1000, 1000, 90_000));

        assertThat(stopped).isTrue();
        assertThat(evaluator.status()).isEqualTo("solved");
    }

    private DuelSimulationService.Bot bot(int slot, double hp) {
        DuelSimulationService.Bot bot = new DuelSimulationService.Bot();
        bot.slot = slot;
        bot.x = slot == 1 ? 250 : 750;
        bot.y = 500;
        bot.size = 60;
        bot.hp = hp;
        bot.maxHp = 150;
        bot.combatLoadout = "custom";
        bot.brain = jsonMapper.createObjectNode();
        return bot;
    }

    private ConditionResolutionService newConditionResolutionService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(
                catalog,
                new com.example.botfight.simulation.bots.BotCodeService());
        ActionExecutionService actionExecutionService = new ActionExecutionService(botStateService);
        return new ConditionResolutionService(new ConditionEvaluationService(), actionExecutionService);
    }

    private ActionExecutionService newActionExecutionService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(
                catalog,
                new com.example.botfight.simulation.bots.BotCodeService());
        return new ActionExecutionService(botStateService);
    }
}
