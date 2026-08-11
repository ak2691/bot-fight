package com.example.botfight.simulation.bot;

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
    void moduloUsesFlooredValuesAndJavaRemainderSemantics() {
        assertThat(service.compareModulo(-5, 3, "eq", -2)).isTrue();
        assertThat(service.compareModulo(5, 0, "eq", 0)).isFalse();
    }
}
