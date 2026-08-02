package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class BotSubmissionRateLimiterTest {

    @Test
    void allowsTwentySubmissionsPerUserInSlidingOneSecondWindow() {
        MutableClock clock = new MutableClock(Instant.parse("2026-06-05T12:00:00Z"));
        BotSubmissionRateLimiter limiter = new BotSubmissionRateLimiter(clock);
        UUID userId = UUID.randomUUID();

        for (int i = 0; i < 20; i++) {
            limiter.requireAllowed(userId);
        }

        assertThatThrownBy(() -> limiter.requireAllowed(userId))
                .isInstanceOf(RateLimitExceededException.class)
                .hasMessage("Too many bot submissions. Please retry shortly.");

        clock.setInstant(Instant.parse("2026-06-05T12:00:01Z"));
        limiter.requireAllowed(userId);
    }

    @Test
    void tracksUsersIndependently() {
        MutableClock clock = new MutableClock(Instant.parse("2026-06-05T12:00:00Z"));
        BotSubmissionRateLimiter limiter = new BotSubmissionRateLimiter(clock);
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();

        for (int i = 0; i < 20; i++) {
            limiter.requireAllowed(firstUserId);
        }

        limiter.requireAllowed(secondUserId);
    }

    private static final class MutableClock extends Clock {

        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void setInstant(Instant instant) {
            this.instant = instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
