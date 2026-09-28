package com.example.botfight.service.match.timing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.domain.match.MatchMode;
import org.junit.jupiter.api.Test;

class MatchTimingPolicyTest {

    @Test
    void usesTheRankedDurationsAndIndependentCustomDefault() {
        assertThat(MatchTimingPolicy.LOADOUT_SELECTION_SECONDS).isEqualTo(60);
        assertThat(MatchTimingPolicy.SUBMISSION_GRACE_SECONDS).isEqualTo(2);
        assertThat(MatchTimingPolicy.MIN_CUSTOM_ROUND_SECONDS).isEqualTo(30);
        assertThat(MatchTimingPolicy.MAX_CUSTOM_ROUND_SECONDS).isEqualTo(600);
        assertThat(MatchTimingPolicy.defaultRoundDurationSeconds(MatchMode.ONES))
                .isEqualTo(180);
        assertThat(MatchTimingPolicy.defaultRoundDurationSeconds(MatchMode.TWOS))
                .isEqualTo(300);
        assertThat(MatchTimingPolicy.defaultRoundDurationSeconds(MatchMode.CUSTOM))
                .isEqualTo(300);
        assertThat(MatchTimingPolicy.resolveRoundDurationSeconds(MatchMode.ONES, 600))
                .isEqualTo(180);
        assertThat(MatchTimingPolicy.resolveRoundDurationSeconds(MatchMode.TWOS, 30))
                .isEqualTo(300);
        assertThat(MatchTimingPolicy.resolveRoundDurationSeconds(MatchMode.CUSTOM, null))
                .isEqualTo(300);
        assertThat(MatchTimingPolicy.resolveRoundDurationSeconds(MatchMode.CUSTOM, 420))
                .isEqualTo(420);
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
