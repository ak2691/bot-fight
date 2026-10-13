package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.service.submission.BrainSchemaValidator;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * What Spring checks itself: the request fields, variable resets, and the brain schema (before the worker).
 * The brain rules are the shared engine's brainRules.js; the worker runs them, and their tests live with them.
 */
class BotSubmissionValidationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final SimWorkerClient worker = mock(SimWorkerClient.class);
    private final BotSubmissionValidationService service = new BotSubmissionValidationService(new BrainSchemaValidator(), worker);

    BotSubmissionValidationServiceTest() {
        when(worker.validateBrain(any(JsonNode.class), anyBoolean())).thenReturn(List.of());
    }

    @Test
    void acceptsABrainThatPassesTheSchemaAndTheWorkerRules() throws Exception {
        var result = service.validate(validPayload());

        assertThat(result.getErrors()).isEmpty();
        assertThat(result.getStatus()).isEqualTo("ACCEPTED");
        verify(worker).validateBrain(any(JsonNode.class), eq(false));
    }

    @Test
    void schemaErrorsRejectWithoutAskingTheWorker() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"roots\":[]}"));

        assertThat(service.validate(payload).getErrors()).anyMatch(error -> error.startsWith("brain.version"));
        verify(worker, never()).validateBrain(any(JsonNode.class), anyBoolean());
    }

    @Test
    void workerRuleErrorsRejectTheSubmission() throws Exception {
        when(worker.validateBrain(any(JsonNode.class), anyBoolean())).thenReturn(List.of("Conditions nest deeper than 40 levels."));

        var result = service.validate(validPayload());

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).containsExactly("Conditions nest deeper than 40 levels.");
    }

    @Test
    void acceptsALanesBrainThatPassesTheSchemaAndSendsItToTheWorker() throws Exception {
        // Spring does not read lanes: it checks the schema, then hands the brain to the worker's brain rules.
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-lanes-v1","shared":{},
                 "modes":[{"id":"neutral","name":"Neutral","switches":[{"id":"to-punish","to":"punish","conditions":[{"type":"always"}]}],
                   "movement":[{"id":"walk","conditions":[{"type":"always"}],
                     "action":{"action":"move_walk","movementMode":"target","movementDirection":0,"selectable":"opponent_1"}}]},
                  {"id":"punish","name":"Punish"}]}
                """));

        var result = service.validate(payload);

        assertThat(result.getErrors()).isEmpty();
        assertThat(result.getStatus()).isEqualTo("ACCEPTED");
        verify(worker).validateBrain(any(JsonNode.class), eq(false));
    }

    @Test
    void puzzleRulesGoToTheWorkerAsPuzzleRules() throws Exception {
        JsonNode rules = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v2","customVariables":[],"roots":[{"kind":"win","branches":[{"conditions":[{"type":"always"}]}]}]}
                """);

        assertThat(service.validateConditionRulesForSimulation(rules)).isEmpty();
        verify(worker).validateBrain(rules, true);
    }

    @Test
    void puzzleBotBudgetsAndReservedNamespaceAreCheckedByTheWorker() throws Exception {
        JsonNode brain = validPayload().getBrain();
        var constraints = java.util.Map.<String, Object>of(
                "maxActionNodes", 0, "maxConditionNodes", 1, "maxCustomVariables", 2,
                "maxLoadoutAbilities", 6, "reservePuzzleNamespace", true);
        when(worker.validateBrain(brain, false, constraints)).thenReturn(List.of("Puzzle action budget exceeded."));

        assertThat(service.validatePuzzleBrainForSimulation(brain, 0, 1, 2, true))
                .containsExactly("Puzzle action budget exceeded.");
        verify(worker).validateBrain(brain, false, constraints);
    }

    @Test
    void puzzleLanesBrainsPassTheSchemaAndGoToTheWorkerWithTheirBudgets() throws Exception {
        // A lanes puzzle brain (the player's or an enemy's) takes the same path as a tree brain; the worker counts its lanes.
        JsonNode brain = jsonMapper.readTree("""
                {"version":"bot-logic-lanes-v1","shared":{},
                 "modes":[{"id":"neutral","name":"Neutral",
                   "variables":[{"id":"count","conditions":[],
                     "action":{"action":"variable","variableId":"custom.ticks","value":1}}]}],
                 "customVariables":[{"id":"custom.ticks","name":"Ticks","valueType":"number","initialValue":0}]}
                """);
        var constraints = java.util.Map.<String, Object>of(
                "maxActionNodes", 1, "maxConditionNodes", 0, "maxCustomVariables", 2,
                "maxLoadoutAbilities", 6, "reservePuzzleNamespace", true);
        when(worker.validateBrain(brain, false, constraints)).thenReturn(List.of());

        assertThat(service.validatePuzzleBrainForSimulation(brain, 1, 0, 2, true)).isEmpty();
        verify(worker).validateBrain(brain, false, constraints);
    }

    @Test
    void puzzleBotsMustPassTheSchemaBeforeTheirBudgetsAreSentToTheWorker() throws Exception {
        JsonNode brain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v2","roots":[],"loadout":{"abilities":[1,1]}}
                """);
        assertThat(service.validatePuzzleBrainForSimulation(brain, 100, 300, 100, false)).isNotEmpty();
        verify(worker, never()).validateBrain(any(JsonNode.class), anyBoolean(), any());
    }

    @Test
    void requiresABrainObjectAndTheBuildingPhase() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(null);
        payload.setPhase("FIGHTING");
        payload.setRoundNumber(-1);

        assertThat(service.validate(payload).getErrors())
                .contains("brain is required", "phase is not supported", "roundNumber cannot be negative");
    }

    @Test
    void acceptsVariableResetsByIdOrNameForDeclaredVariables() throws Exception {
        BotSubmissionPayloadDTO payload = payloadWithVariables();
        payload.setVariableResets(List.of("custom.counter", "Flag"));
        payload.setTimeoutFallback("PREVIOUS");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).as(String.valueOf(result.getErrors())).isTrue();
    }

    @Test
    void rejectsVariableResetsForUndeclaredVariablesAndOutOfBoundsLists() throws Exception {
        BotSubmissionPayloadDTO undeclared = payloadWithVariables();
        undeclared.setVariableResets(List.of("custom.counter", "custom.ghost"));
        assertThat(service.validate(undeclared).getErrors())
                .contains("variableResets names a variable the brain does not declare");

        BotSubmissionPayloadDTO tooMany = payloadWithVariables();
        tooMany.setVariableResets(Collections.nCopies(101, "custom.counter"));
        assertThat(service.validate(tooMany).getErrors())
                .contains("variableResets exceeds the 100 variable limit");

        BotSubmissionPayloadDTO tooLong = payloadWithVariables();
        tooLong.setVariableResets(List.of("x".repeat(65)));
        assertThat(service.validate(tooLong).getErrors())
                .contains("variableResets contains an invalid variable name");

        // A brain with no variables has nothing to reset.
        BotSubmissionPayloadDTO none = validPayload();
        none.setVariableResets(List.of("custom.counter"));
        assertThat(service.validate(none).isAccepted()).isFalse();
    }

    @Test
    void validatesTheTimeoutFallbackChoice() throws Exception {
        BotSubmissionPayloadDTO current = validPayload();
        current.setTimeoutFallback("CURRENT");
        assertThat(service.validate(current).isAccepted()).isTrue();

        BotSubmissionPayloadDTO invalid = validPayload();
        invalid.setTimeoutFallback("SKIP");
        assertThat(service.validate(invalid).getErrors()).contains("timeoutFallback must be CURRENT or PREVIOUS");
    }

    private BotSubmissionPayloadDTO validPayload() throws Exception {
        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setMatchId(UUID.fromString("11111111-1111-1111-1111-111111111111"));
        payload.setRoundNumber(1);
        payload.setPhase("BUILDING");
        payload.setSelectedLoadout("melee");
        payload.setClientBuildVersion("test");
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v2","roots":[{"branches":[
                  {"id":"node-1","conditions":[],"actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}]}
                ]}]}
                """));
        return payload;
    }

    private BotSubmissionPayloadDTO payloadWithVariables() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v2",
                 "customVariables":[
                   {"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0},
                   {"id":"custom.flag","name":"Flag","valueType":"boolean","initialValue":false}],
                 "roots":[]}
                """));
        return payload;
    }
}
