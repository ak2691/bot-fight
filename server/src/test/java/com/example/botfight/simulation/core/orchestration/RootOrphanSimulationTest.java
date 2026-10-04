package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ChainRuntime;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

class RootOrphanSimulationTest {
    private final JsonMapper mapper = new JsonMapper();
    private static DuelSimulationService newService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actions = new ActionExecutionService(botStateService);
        return new DuelSimulationService(
                new ConditionResolutionService(new ConditionEvaluationService(), actions),
                new ReplayMappingService(), botStateService, actions);
    }


    private Action action(String extra, String branches) {
        JsonNode main = mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[{\"priority\":1,\"branches\":"+branches+",\"actions\":[{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90}]}]"+extra+"}");
        JsonNode idle = mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}");
        List<Action> actions = new ArrayList<>();
        newService().simulateWithoutReplay(new DuelSimulationRequest(UUID.randomUUID(), DuelSimulationService.DUEL_RULESET_VERSION, 7L,
            new DuelArenaRequest(1200, 1200, 100), List.of(
            new DuelBotRequest(UUID.randomUUID(), "a", 1, 400, 400, 0.0, 60, "custom", main, null, 1),
            new DuelBotRequest(UUID.randomUUID(), "b", 2, 900, 400, 180.0, 60, "custom", idle, null, 2))),
            (elapsed, bots, entities, arena) -> { actions.add(bots.getFirst().lastPredictedAction); return false; });
        return actions.getFirst();
    }
    @Test void rootOnlyMovesAndOrphansNeverRun() {
        assertThat(action("", "[]").dx()).isPositive();
        var orphan = action(",\"orphans\":[{\"id\":\"loose\",\"kind\":\"action\",\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":270}]", "[]");
        assertThat(orphan.dx()).isPositive();
    }
    @Test void branchMovementBeatsRootMovementButRotationRunsAlongsideIt() {
        String branch = "[{\"priority\":1,\"conditions\":[{\"type\":\"always\"}],\"actions\":[{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":270}],\"children\":[]}]";
        assertThat(action("", branch).dx()).isNegative();
        var combined = action("", "[{\"priority\":1,\"conditions\":[{\"type\":\"always\"}],\"actions\":[{\"action\":\"rotate_toward_enemy\"}],\"children\":[]}]");
        assertThat(combined.dx()).isPositive();
        assertThat(combined.dRot()).isNotZero();
    }
}
