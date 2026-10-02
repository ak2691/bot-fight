package com.example.botfight.simulation.bots;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ConditionEvaluationServiceTest {
    private final ConditionEvaluationService service = new ConditionEvaluationService();

    @Test
    void comparesCircularAnglesThroughTheirSignedAndPositiveRepresentations() {
        assertThat(service.compareAngles(350, "lt", 50)).isTrue();
        assertThat(service.compareAngles(-10, "lt", 50)).isTrue();
        assertThat(service.compareAngles(50, "eq", -310)).isTrue();
        assertThat(service.compareAngles(270, "gt", 300)).isFalse();
        assertThat(service.compareAngles(10, "gt", -100)).isTrue();
    }
}
