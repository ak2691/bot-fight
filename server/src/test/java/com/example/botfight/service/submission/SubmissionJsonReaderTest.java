package com.example.botfight.service.submission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SubmissionJsonReaderTest {

    private final SubmissionJsonReader reader = new SubmissionJsonReader();

    private static String nested(int depth) {
        return "{\"phase\":\"BUILDING\",\"brain\":" + "[".repeat(depth) + "]".repeat(depth) + "}";
    }

    @Test
    void readsAnOrdinarySubmission() {
        var payload = reader.read("{\"phase\":\"BUILDING\",\"roundNumber\":2,\"unknown\":1,"
                + "\"brain\":{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}}");
        assertThat(payload.getPhase()).isEqualTo("BUILDING");
        assertThat(payload.getBrain().path("version").asText()).isEqualTo("bot-logic-tree-v2");
    }

    @Test
    void rejectsADocumentNestedDeeperThanTheLimitBeforeBuildingIt() {
        assertThat(reader.read(nested(SubmissionJsonReader.MAX_NESTING_DEPTH - 5))).isNotNull();
        assertThatThrownBy(() -> reader.read(nested(SubmissionJsonReader.MAX_NESTING_DEPTH + 5)))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> reader.read(nested(5000))).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void rejectsMalformedJson() {
        assertThatThrownBy(() -> reader.read("{not json")).isInstanceOf(ResponseStatusException.class);
    }
}
