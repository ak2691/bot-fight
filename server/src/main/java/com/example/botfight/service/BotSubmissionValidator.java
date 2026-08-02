package com.example.botfight.service;

import com.example.botfight.domain.BotSubmission;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
public class BotSubmissionValidator {

    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TESTING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;

    private final JsonMapper jsonMapper;

    public BotSubmissionValidator(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public BotSubmissionValidationResult validate(BotSubmission submission) {
        List<String> errors = new ArrayList<>();

        if (submission == null) {
            errors.add("submission is required");
            return new BotSubmissionValidationResult(errors);
        }

        if (submission.getUser() == null) {
            errors.add("user is required");
        }

        requireText(errors, submission.getBrainSchemaVersion(), "brainSchemaVersion", MAX_VERSION_LENGTH);

        rejectTooLong(errors, submission.getTestingSessionId(), "testingSessionId", MAX_TESTING_SESSION_ID_LENGTH);
        rejectTooLong(errors, submission.getSelectedLoadout(), "selectedLoadout", MAX_SELECTED_LOADOUT_LENGTH);
        rejectTooLong(errors, submission.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        validateJson(errors, submission.getBrainPayload(), "brainPayload");

        return new BotSubmissionValidationResult(errors);
    }

    private void requireText(List<String> errors, String value, String field, int maxLength) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        rejectTooLong(errors, value, field, maxLength);
    }

    private void rejectNegative(List<String> errors, Integer value, String field) {
        if (value != null && value < 0) {
            errors.add(field + " cannot be negative");
        }
    }

    private void rejectTooLong(List<String> errors, String value, String field, int maxLength) {
        if (value != null && value.length() > maxLength) {
            errors.add(field + " cannot exceed " + maxLength + " characters");
        }
    }

    private void validateJson(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        try {
            jsonMapper.readTree(value);
        } catch (Exception ex) {
            errors.add(field + " must be valid JSON");
        }
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
