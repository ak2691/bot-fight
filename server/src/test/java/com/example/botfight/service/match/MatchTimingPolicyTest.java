package com.example.botfight.service.match;


import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.domain.match.MatchMode;
import org.junit.jupiter.api.Test;

class MatchTimingPolicyTest {
    @Test
    void rankedModesUseTheirFixedBaseClockAndIncrement() {
        assertThat(MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS).isEqualTo(300);
        assertThat(MatchTimingPolicy.TWOS_BASE_CLOCK_SECONDS).isEqualTo(420);
        assertThat(MatchTimingPolicy.DEFAULT_INCREMENT_SECONDS).isEqualTo(30);
        assertThat(MatchTimingPolicy.defaultBaseClockSeconds(MatchMode.ONES)).isEqualTo(300);
        assertThat(MatchTimingPolicy.defaultBaseClockSeconds(MatchMode.TWOS)).isEqualTo(420);
        assertThat(MatchTimingPolicy.defaultBaseClockSeconds(MatchMode.CUSTOM)).isEqualTo(300);
        // A ranked match ignores any requested clock.
        assertThat(MatchTimingPolicy.resolveBaseClockSeconds(MatchMode.ONES, 600)).isEqualTo(300);
        assertThat(MatchTimingPolicy.resolveBaseClockSeconds(MatchMode.TWOS, 30)).isEqualTo(420);
        assertThat(MatchTimingPolicy.resolveIncrementSeconds(MatchMode.TWOS, 60)).isEqualTo(30);
    }

    @Test
    void picksSegmentsAndRoundsFollowTheTimedRoundsPolicy() {
        assertThat(MatchTimingPolicy.pickSeconds(1)).isEqualTo(30);
        assertThat(MatchTimingPolicy.pickSeconds(2)).isEqualTo(20);
        assertThat(MatchTimingPolicy.pickSeconds(6)).isEqualTo(20);
        assertThat(MatchTimingPolicy.SEGMENT_SECONDS).isEqualTo(20);
        assertThat(MatchTimingPolicy.MAX_ROUNDS).isEqualTo(6);
        assertThat(MatchTimingPolicy.SUBMISSION_GRACE_SECONDS).isEqualTo(2);
    }

    @Test
    void customLobbiesChooseABoundedBaseClockAndIncrement() {
        assertThat(MatchTimingPolicy.resolveBaseClockSeconds(MatchMode.CUSTOM, null)).isEqualTo(300);
        assertThat(MatchTimingPolicy.resolveBaseClockSeconds(MatchMode.CUSTOM, 420)).isEqualTo(420);
        assertThat(MatchTimingPolicy.resolveIncrementSeconds(MatchMode.CUSTOM, null)).isEqualTo(30);
        assertThat(MatchTimingPolicy.resolveIncrementSeconds(MatchMode.CUSTOM, 0)).isZero();

        assertThat(MatchTimingPolicy.requireCustomBaseClockSeconds(30)).isEqualTo(30);
        assertThat(MatchTimingPolicy.requireCustomBaseClockSeconds(600)).isEqualTo(600);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomBaseClockSeconds(29))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomBaseClockSeconds(601))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomBaseClockSeconds(null))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(MatchTimingPolicy.requireCustomIncrementSeconds(0)).isZero();
        assertThat(MatchTimingPolicy.requireCustomIncrementSeconds(60)).isEqualTo(60);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomIncrementSeconds(-1))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomIncrementSeconds(61))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MatchTimingPolicy.requireCustomIncrementSeconds(null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
