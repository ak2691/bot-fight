package com.example.botfight.service.match.timing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.domain.MatchMode;
import org.junit.jupiter.api.Test;

class MatchTimingPolicyTest {

    @Test
    void usesTheRankedRoundDefaults() {
        assertThat(MatchTimingPolicy.defaultRoundDurationSeconds(MatchMode.ONES))
                .isEqualTo(300);
        assertThat(MatchTimingPolicy.defaultRoundDurationSeconds(MatchMode.TWOS))
                .isEqualTo(360);
        assertThat(MatchTimingPolicy.defaultRoundDurationSeconds(MatchMode.CUSTOM))
                .isEqualTo(300);
        assertThat(MatchTimingPolicy.resolveRoundDurationSeconds(MatchMode.TWOS, 30))
                .isEqualTo(360);
    }

    @Test
    void acceptsTheCustomBoundsAndRejectsValuesOutsideThem() {
        assertThat(MatchTimingPolicy.requireCustomRoundDurationSeconds(30)).isEqualTo(30);
        assertThat(MatchTimingPolicy.requireCustomRoundDurationSeconds(600)).isEqualTo(600);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomRoundDurationSeconds(29))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomRoundDurationSeconds(601))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomRoundDurationSeconds(null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
