package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.BotSubmission;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class BotSubmissionValidatorTest {

    private final BotSubmissionValidator validator = new BotSubmissionValidator(new JsonMapper());

    @Test
    void acceptsDeterministicBrainSubmission() {
        BotSubmission submission = validSubmission();

        BotSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void rejectsMissingBrainSchemaVersion() {
        BotSubmission submission = validSubmission();
        submission.setBrainSchemaVersion(null);

        BotSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("brainSchemaVersion is required");
    }

    @Test
    void rejectsMissingRequiredSubmissionFields() {
        BotSubmission submission = new BotSubmission();

        BotSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains(
                "user is required",
                "brainSchemaVersion is required");
    }

    @Test
    void rejectsInvalidBrainPayloadJson() {
        BotSubmission submission = validSubmission();
        submission.setBrainPayload("{not-json");

        BotSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("brainPayload must be valid JSON");
    }

    private BotSubmission validSubmission() {
        BotSubmission submission = new BotSubmission();
        submission.setUser(new AppUser());
        submission.setBrainSchemaVersion("bot-logic-tree-v1");
        submission.setBuildingSessionId("local-session-1");
        submission.setBrainPayload("{\"version\":\"bot-logic-tree-v1\"}");
        submission.setClientBuildVersion("local-dev");
        return submission;
    }
}
