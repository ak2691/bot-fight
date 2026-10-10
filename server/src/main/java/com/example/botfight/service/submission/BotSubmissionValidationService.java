package com.example.botfight.service.submission;

import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.submission.BotSubmissionValidationResponseDTO;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.simulation.SimWorkerClient;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/**
 * Validates a submission: the request fields around the brain and its variable resets here, the brain itself
 * against {@code shared/schemas/brain.schema.json} ({@link BrainSchemaValidator}), then the brain rules the
 * sim-worker runs with the shared engine's {@code brainRules.js} (one implementation for editor and server).
 */
@Service
public class BotSubmissionValidationService {

    private static final String VALIDATOR_VERSION = "bot-brain-submission-v3";
    private static final int MAX_PHASE_LENGTH = 30;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;
    /** Deepest branch nesting the brain rules allow ({@code MAX_TREE_DEPTH} in brainRules.js). */
    public static final int MAX_TREE_DEPTH = 40;
    private static final int MAX_VARIABLE_RESETS = 100;
    private static final int MAX_VARIABLE_RESET_LENGTH = 64;

    private final BrainSchemaValidator schemaValidator;
    private final SimWorkerClient worker;

    public BotSubmissionValidationService(BrainSchemaValidator schemaValidator, SimWorkerClient worker) {
        this.schemaValidator = schemaValidator;
        this.worker = worker;
    }

    public BotSubmissionValidationResponseDTO validate(BotSubmissionPayloadDTO payload) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (payload == null) {
            errors.add("submission payload is required");
            return response(false, errors, warnings, false);
        }
        rejectTooLong(errors, payload.getPhase(), "phase", MAX_PHASE_LENGTH);
        rejectTooLong(errors, payload.getSelectedLoadout(), "selectedLoadout", MAX_SELECTED_LOADOUT_LENGTH);
        rejectTooLong(errors, payload.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        requireNonNegative(errors, payload.getRoundNumber(), "roundNumber");
        requireOneOf(errors, payload.getPhase(), "phase", "BUILDING");
        JsonNode brain = payload.getBrain();
        errors.addAll(brainErrors(brain, false));
        validateVariableResets(errors, payload.getVariableResets(), brain);
        if (payload.getTimeoutFallback() != null
                && !MatchPlayer.isTimeoutFallback(payload.getTimeoutFallback())) {
            errors.add("timeoutFallback must be CURRENT or PREVIOUS");
        }

        return response(errors.isEmpty(), errors, warnings, false);
    }

    /**
     * Each reset must name a variable the submitted brain declares (by id or by name), so a client can
     * only choose between "keep" and "reset" for state it actually has. The list is bounded.
     */
    private void validateVariableResets(List<String> errors, List<String> resets, JsonNode brain) {
        if (resets == null || resets.isEmpty()) return;
        if (resets.size() > MAX_VARIABLE_RESETS) {
            errors.add("variableResets exceeds the " + MAX_VARIABLE_RESETS + " variable limit");
            return;
        }
        Set<String> declared = new HashSet<>();
        JsonNode variables = brain == null ? null : brain.get("customVariables");
        if (variables != null && variables.isArray()) {
            for (JsonNode variable : variables) {
                if (variable == null || !variable.isObject()) continue;
                String id = variable.path("id").asText("");
                String name = variable.path("name").asText("");
                if (!id.isEmpty()) declared.add(id);
                if (!name.isEmpty()) declared.add(name);
            }
        }
        for (String reset : resets) {
            if (reset == null || reset.isBlank() || reset.length() > MAX_VARIABLE_RESET_LENGTH) {
                errors.add("variableResets contains an invalid variable name");
                return;
            }
            if (!declared.contains(reset)) {
                errors.add("variableResets names a variable the brain does not declare");
                return;
            }
        }
    }

    /** Validates an in-memory brain (a puzzle opponent) with the same checks as a submission. */
    public List<String> validateForSimulation(JsonNode brain) {
        return brainErrors(brain, false);
    }

    /** The worker applies puzzle budgets with the shared slot metrics and namespace rules. */
    public List<String> validatePuzzleBrainForSimulation(JsonNode brain, int actions, int conditions, int variables, boolean player) {
        List<String> errors = schemaValidator.validate(brain);
        if (!errors.isEmpty()) return errors;
        return worker.validateBrain(brain, false, java.util.Map.of(
                "maxActionNodes", actions,
                "maxConditionNodes", conditions,
                "maxCustomVariables", variables,
                "maxLoadoutAbilities", 6,
                "reservePuzzleNamespace", player));
    }

    /** Validates flat puzzle win/lose conditions and custom variable modifications in the worker. */
    public List<String> validateConditionRulesForSimulation(JsonNode rules) {
        return brainErrors(rules, true);
    }

    private BotSubmissionValidationResponseDTO response(
            boolean accepted,
            List<String> errors,
            List<String> warnings,
            boolean buildingDurationTrusted) {
        BotSubmissionValidationResponseDTO response = new BotSubmissionValidationResponseDTO();
        response.setAccepted(accepted);
        response.setStatus(accepted ? "ACCEPTED" : "REJECTED");
        response.setMessage(accepted
                ? "Bot brain passed validation"
                : "Bot brain failed validation");
        response.setValidatorVersion(VALIDATOR_VERSION);
        response.setBuildingDurationTrusted(buildingDurationTrusted);
        response.setErrors(errors);
        response.setWarnings(warnings);
        return response;
    }

    /**
     * The brain checks shared by submissions and puzzles: the brain schema here, then the brain rules a schema
     * cannot express (references, sibling order, depth, totals), which the sim-worker runs with the engine's
     * own {@code brainRules.js}. Puzzle outcome rules carry a root {@code kind} the brain schema does not allow,
     * so the worker checks their schema after it removes it.
     */
    private List<String> brainErrors(JsonNode brain, boolean puzzleRules) {
        List<String> errors = new ArrayList<>();
        if (!requireObject(errors, brain, "brain")) return errors;
        if (!puzzleRules) {
            errors.addAll(schemaValidator.validate(brain));
            if (!errors.isEmpty()) return errors;
        }
        return worker.validateBrain(brain, puzzleRules);
    }

    private void requireOneOf(List<String> errors, String value, String field, String... expectedValues) {
        if (value == null || value.isBlank()) {
            errors.add(field + " is required");
            return;
        }
        for (String expected : expectedValues) {
            if (expected.equals(value)) return;
        }
        errors.add(field + " is not supported");
    }

    private boolean requireObject(List<String> errors, JsonNode value, String field) {
        if (value == null || value.isNull()) {
            errors.add(field + " is required");
            return false;
        }
        if (!value.isObject()) {
            errors.add(field + " must be an object");
            return false;
        }
        return true;
    }

    private void requireNonNegative(List<String> errors, Integer value, String field) {
        if (value == null) {
            errors.add(field + " is required");
        } else if (value < 0) {
            errors.add(field + " cannot be negative");
        }
    }

    private void rejectTooLong(List<String> errors, String value, String field, int maxLength) {
        if (value != null && value.length() > maxLength) {
            errors.add(field + " cannot exceed " + maxLength + " characters");
        }
    }
}
