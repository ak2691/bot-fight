package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchmakingRateLimiterTest {

    private final MutableClock clock = new MutableClock(
            Instant.parse("2026-07-24T12:00:00Z"));
    private final MatchmakingRateLimiter limiter = new MatchmakingRateLimiter(clock);

    @Test
    void allowsThreeAttemptsThenRequiresTheWindowToExpire() {
        UUID userId = UUID.randomUUID();

        limiter.requireAllowed(userId);
        limiter.requireAllowed(userId);
        limiter.requireAllowed(userId);

        assertThatThrownBy(() -> limiter.requireAllowed(userId))
                .isInstanceOf(RateLimitExceededException.class)
                .hasMessageContaining("matchmaking attempts")
                .satisfies(exception -> {
                    RateLimitExceededException rateLimit =
                            (RateLimitExceededException) exception;
                    org.assertj.core.api.Assertions.assertThat(rateLimit.getRetryAfter())
                            .isEqualTo(Duration.ofSeconds(5));
                });

        clock.advance(Duration.ofSeconds(5));
        limiter.requireAllowed(userId);
    }

    @Test
    void limitsAreIndependentPerUser() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();

        limiter.requireAllowed(firstUserId);
        limiter.requireAllowed(firstUserId);
        limiter.requireAllowed(firstUserId);
        limiter.requireAllowed(secondUserId);
    }

    private static final class MutableClock extends Clock {

        private Instant currentInstant;

        private MutableClock(Instant currentInstant) {
            this.currentInstant = currentInstant;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return currentInstant;
        }

        private void advance(Duration duration) {
            currentInstant = currentInstant.plus(duration);
        }
    }
}
