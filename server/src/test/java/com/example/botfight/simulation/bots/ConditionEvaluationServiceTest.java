package com.example.botfight.simulation.bots;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class ConditionEvaluationServiceTest {
    private final ConditionEvaluationService service = new ConditionEvaluationService();

    @Test
    void comparesCircularAnglesThroughTheirSignedAndPositiveRepresentations() {
        assertThat(service.compareAngles(350, "lt", 50)).isTrue();
        assertThat(service.compareAngles(-10, "lt", 50)).isTrue();
        assertThat(service.compareAngles(50, "eq", -310)).isTrue();
    }

    @Test
    void evaluatesOrSeparatedGroupsWithAndPrecedence() {
        assertThat(service.evaluateJoined(
                List.of(true, true, false, false),
                List.of("and", "and", "or", "and"))).isTrue();
        assertThat(service.evaluateJoined(
                List.of(false, true, true, true),
                List.of("and", "and", "or", "and"))).isTrue();
        assertThat(service.evaluateJoined(
                List.of(true, false, true, false),
                List.of("and", "and", "or", "and"))).isFalse();
    }
}
