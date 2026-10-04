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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Authoritative action chains. Runs the same scenarios as the browser's ChainRuntime.test.js, tick by tick, and
 * compares the step paths and the actions each tick issues. The scenario file is shared: keep both copies identical.
 */
class ChainRuntimeSimulationTest {
    private static final double MAIN_X = 300;
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

    private JsonNode scenarios() throws Exception {
        try (InputStream stream = getClass().getResourceAsStream("/botlogic/chainScenarios.json")) {
            return jsonMapper.readTree(stream);
        }
    }

    @TestFactory
    Stream<DynamicTest> chainScenariosMatchTheBrowserTickByTick() throws Exception {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode scenario : scenarios()) {
            tests.add(DynamicTest.dynamicTest(scenario.get("name").asText(), () -> {
                List<String> expected = new ArrayList<>();
                scenario.get("expected").forEach(line -> expected.add(line.asText()));
                assertThat(trace(scenario)).containsExactlyElementsOf(expected);
            }));
        }
        return tests.stream();
    }

    private JsonNode brain(JsonNode abilities, JsonNode roots, JsonNode chains) {
        ObjectNode brain = jsonMapper.createObjectNode();
        brain.put("version", "bot-logic-tree-v1");
        brain.putObject("loadout").set("abilities", abilities);
        brain.set("roots", roots);
        if (chains != null) brain.set("chains", chains);
        return brain;
    }

    private List<String> trace(JsonNode scenario) {
        JsonNode mainBrain = brain(scenario.get("abilities"), scenario.get("roots"), scenario.get("chains"));
        JsonNode idle = brain(jsonMapper.createArrayNode(), jsonMapper.createArrayNode(), null);
        double rotation = scenario.has("mainRotation") ? scenario.get("mainRotation").asDouble() : 90.0;
        int ticks = scenario.get("ticks").asInt();
        int stunAtTick = scenario.has("stunAtTick") ? scenario.get("stunAtTick").asInt() : -1;
        List<String> lines = new ArrayList<>();
        int[] tick = { 0 };
        service.simulateWithoutReplay(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("chain".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 7L,
                new DuelArenaRequest(1200, 1200, ticks * 100),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, MAIN_X, MAIN_Y,
                                rotation, 60, "custom", mainBrain, null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2,
                                scenario.get("defenderX").asDouble(), MAIN_Y, 270.0, 60, "custom", idle, null, 2))),
                (elapsedMs, bots, entities, arena) -> {
                    Bot main = bots.get(0);
                    if (tick[0] == stunAtTick) {
                        BotStateService.upsertStatusEffect(main, new StatusEffectState("stun", 500, 0)
                                .addEffect(new StatusEffectState.Effect("stun", "constant")));
                    }
                    lines.add(formatStack(main.chainStack) + " | " + formatAction(main.lastPredictedAction));
                    // The browser checks these same replay fields against the shared tick trace.
                    var running = new ReplayMappingService().toReplayFrame(elapsedMs, bots, entities)
                            .bots().getFirst().runningChain();
                    String expectedStack = scenario.get("expected").get(tick[0]).asText().split(" \\| ")[0];
                    if ("idle".equals(expectedStack)) {
                        assertThat(running).isNull();
                    } else {
                        String[] frames = expectedStack.split(">");
                        String[] top = frames[frames.length - 1].split("@");
                        String chainId = "chain." + top[0];
                        List<Object> path = java.util.Arrays.stream(top[1].split("\\."))
                                .map(part -> part.matches("\\d+") ? (Object) Integer.valueOf(part) : part).toList();
                        assertThat(running.chainId()).isEqualTo(chainId);
                        assertThat(running.path()).isEqualTo(path);
                        assertThat(running.callDepth()).isEqualTo(frames.length);
                        for (JsonNode chain : scenario.get("chains")) {
                            if (chainId.equals(chain.get("id").asText())) {
                                assertThat(running.name()).isEqualTo(chain.get("name").asText());
                            }
                        }
                    }
                    tick[0] += 1;
                    return false;
                });
        return lines;
    }

    private static String formatStack(List<ChainRuntime.Frame> stack) {
        return stack.isEmpty() ? "idle"
                : stack.stream().map(ChainRuntime.Frame::describe).collect(Collectors.joining(">"));
    }

    private static int sign(double value) {
        return Math.abs(value) < 1e-6 ? 0 : (int) Math.signum(value);
    }

    private static String formatAction(Action action) {
        String moves = new String[] {"W", "", "E"}[sign(action.dx()) + 1] + new String[] {"N", "", "S"}[sign(action.dy()) + 1];
        return String.join(" ",
                action.abilityAction() == null ? "-" : String.valueOf(action.abilityAction()),
                moves.isEmpty() ? "-" : moves,
                action.dRot() != 0 ? "rot" : "-",
                action.cancelWindup() ? "cancel" : "-");
    }
}
