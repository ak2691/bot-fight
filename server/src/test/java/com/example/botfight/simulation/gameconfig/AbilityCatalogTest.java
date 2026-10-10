package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AbilityCatalogTest {
    @Test
    void loadoutCodesRoundTripToAbilityIds() {
        for (int id = 1; id <= 40; id++) {
            String code = AbilityCatalog.codeForId(id);
            if (code != null) {
                assertThat(code).hasSize(1);
                assertThat(AbilityCatalog.idForCode(code)).isEqualTo(id);
                assertThat(AbilityCatalog.exists(id)).isTrue();
            }
        }
        assertThat(AbilityCatalog.codeForId(1)).isEqualTo("s");
    }

    @Test
    void dashIsStandardAndHasNoLoadoutCode() {
        assertThat(AbilityCatalog.isStandard(19)).isTrue();
        assertThat(AbilityCatalog.codeForId(19)).isNull();
        assertThat(AbilityCatalog.isStandard(1)).isFalse();
    }

    @Test
    void unknownCodesAndIdsFailClosed() {
        assertThat(AbilityCatalog.idForCode(null)).isNull();
        assertThat(AbilityCatalog.idForCode("?")).isNull();
        assertThat(AbilityCatalog.codeForId(0)).isNull();
        assertThat(AbilityCatalog.exists(0)).isFalse();
        assertThat(AbilityCatalog.exists(999)).isFalse();
    }
}
