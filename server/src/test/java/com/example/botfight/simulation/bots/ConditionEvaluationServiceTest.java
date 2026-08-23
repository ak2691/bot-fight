package com.example.botfight.simulation.bots;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ConditionEvaluationServiceTest {
    private final ConditionEvaluationService service = new ConditionEvaluationService();

    @Test
    void combinesConditionsInDeclaredAndOrOrder() {
        assertThat(service.combine(true, false, false, "and")).isFalse();
        assertThat(service.combine(false, true, false, "or")).isTrue();
        assertThat(service.combine(false, true, true, "and")).isTrue();
    }

    @Test
    void comparesCircularAnglesThroughTheirSignedAndPositiveRepresentations() {
        assertThat(service.compareAngles(350, "lt", 50)).isTrue();
        assertThat(service.compareAngles(-10, "lt", 50)).isTrue();
        assertThat(service.compareAngles(50, "eq", -310)).isTrue();
    }
}
