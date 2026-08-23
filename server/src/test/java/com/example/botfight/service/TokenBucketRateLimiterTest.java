package com.example.botfight.service;

import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TokenBucketRateLimiterTest {

    @Test
    void allowsTheCapacityThenRefillsOneTokenPerInterval() {
        MutableClock clock = new MutableClock(Instant.parse("2026-07-24T12:00:00Z"));
        TokenBucketRateLimiter<UUID> limiter = new TokenBucketRateLimiter<>(
                clock,
                10,
                Duration.ofSeconds(1));
        UUID userId = UUID.randomUUID();

        for (int attempt = 0; attempt < 10; attempt++) {
            limiter.requireAllowed(userId);
        }

        assertThatThrownBy(() -> limiter.requireAllowed(userId))
                .isInstanceOf(RateLimitExceededException.class)
                .hasMessage(RateLimitExceededException.GENERIC_MESSAGE)
                .satisfies(exception -> assertThat(((RateLimitExceededException) exception).getRetryAfter())
                        .isEqualTo(Duration.ofSeconds(1)));

        clock.advance(Duration.ofSeconds(1));
        limiter.requireAllowed(userId);
    }

    @Test
    void keepsBucketsIndependentPerKey() {
        Clock clock = Clock.fixed(Instant.parse("2026-07-24T12:00:00Z"), ZoneOffset.UTC);
        TokenBucketRateLimiter<UUID> limiter = new TokenBucketRateLimiter<>(
                clock,
                1,
                Duration.ofSeconds(1));

        limiter.requireAllowed(UUID.randomUUID());
        limiter.requireAllowed(UUID.randomUUID());
    }

    @Test
    void boundsTrackedKeysWhenAttackersRotateKeys() {
        Clock clock = Clock.fixed(Instant.parse("2026-07-24T12:00:00Z"), ZoneOffset.UTC);
        TokenBucketRateLimiter<UUID> limiter = new TokenBucketRateLimiter<>(
                clock,
                1,
                Duration.ofMinutes(1),
                1);
        UUID firstKey = UUID.randomUUID();
        UUID secondKey = UUID.randomUUID();

        limiter.requireAllowed(firstKey);
        limiter.requireAllowed(secondKey);

        // The oldest key was evicted instead of being retained forever.
        limiter.requireAllowed(firstKey);
    }

    private static final class MutableClock extends Clock {
        private Instant currentInstant;

        private MutableClock(Instant currentInstant) {
            this.currentInstant = currentInstant;
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
            return currentInstant;
        }

        private void advance(Duration duration) {
            currentInstant = currentInstant.plus(duration);
        }
    }
}
