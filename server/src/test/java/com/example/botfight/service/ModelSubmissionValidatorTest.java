package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.ModelSubmission;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionValidatorTest {

    private final ModelSubmissionValidator validator = new ModelSubmissionValidator(new JsonMapper());

    @Test
    void acceptsDeterministicBrainSubmission() {
        ModelSubmission submission = validSubmission();

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void rejectsMissingBrainSchemaVersion() {
        ModelSubmission submission = validSubmission();
        submission.setBrainSchemaVersion(null);

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("brainSchemaVersion is required");
    }

    @Test
    void rejectsMissingRequiredSubmissionFields() {
        ModelSubmission submission = new ModelSubmission();

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains(
                "user is required",
                "brainSchemaVersion is required");
    }

    @Test
    void rejectsInvalidBrainPayloadJson() {
        ModelSubmission submission = validSubmission();
        submission.setBrainPayload("{not-json");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("brainPayload must be valid JSON");
    }

    private ModelSubmission validSubmission() {
        ModelSubmission submission = new ModelSubmission();
        submission.setUser(new AppUser());
        submission.setBrainSchemaVersion("melee-logic-tree-v1");
        submission.setTrainingSessionId("local-session-1");
        submission.setBrainPayload("{\"version\":\"melee-logic-tree-v1\"}");
        submission.setClientBuildVersion("local-dev");
        return submission;
    }
}
