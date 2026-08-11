package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CompactAbilityCodeTest {
    @Test
    void selectableAbilityCodesRoundTripToCanonicalNumericIds() {
        for (int id = 1; id <= 25; id++) {
            String code = CompactAbilityCode.codeForId(id);
            if (id == 19 || id == 20) {
                assertThat(code).isNull();
            } else {
                assertThat(code).hasSize(1);
                assertThat(CompactAbilityCode.idForCode(code)).isEqualTo(id);
            }
        }
    }

    @Test
    void unknownCompactCodesFailClosed() {
        assertThat(CompactAbilityCode.idForCode(null)).isNull();
        assertThat(CompactAbilityCode.idForCode("?")).isNull();
        assertThat(CompactAbilityCode.codeForId(0)).isNull();
        assertThat(CompactAbilityCode.codeForId(26)).isNull();
    }
}
