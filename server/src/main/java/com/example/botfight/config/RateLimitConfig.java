package com.example.botfight.config;

import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Centralizes rate-limit policies while keeping the limiter implementations generic. */
@Configuration
public class RateLimitConfig {

    @Bean(name = "botSubmissionRateLimiter")
    public SlidingWindowRateLimiter<UUID> botSubmissionRateLimiter(Clock clock) {
        return new SlidingWindowRateLimiter<>(clock, 20, Duration.ofSeconds(1));
    }

    @Bean(name = "matchmakingRateLimiter")
    public SlidingWindowRateLimiter<UUID> matchmakingRateLimiter(Clock clock) {
        return new SlidingWindowRateLimiter<>(clock, 3, Duration.ofSeconds(5));
    }

    @Bean(name = "profileUpdateRateLimiter")
    public SlidingWindowRateLimiter<UUID> profileUpdateRateLimiter(Clock clock) {
        return new SlidingWindowRateLimiter<>(clock, 10, Duration.ofMinutes(1));
    }

    @Bean(name = "puzzleAttemptRateLimiter")
    public TokenBucketRateLimiter<UUID> puzzleAttemptRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 5, Duration.ofSeconds(3));
    }

    @Bean(name = "adminPuzzleCreationRateLimiter")
    public TokenBucketRateLimiter<UUID> adminPuzzleCreationRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(5));
    }

    @Bean(name = "authIpRateLimiter")
    public TokenBucketRateLimiter<String> authIpRateLimiter(Clock clock) {
        // A generous shared-network burst limit; account/email keys provide the stricter control.
        return new TokenBucketRateLimiter<>(clock, 30, Duration.ofSeconds(1));
    }

    @Bean(name = "authEmailRateLimiter")
    public TokenBucketRateLimiter<String> authEmailRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 5, Duration.ofSeconds(30));
    }

    @Bean(name = "matchChatRateLimiter")
    public TokenBucketRateLimiter<String> matchChatRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1));
    }

    @Bean(name = "duelInviteRateLimiter")
    public TokenBucketRateLimiter<UUID> duelInviteRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 1, Duration.ofSeconds(10));
    }

    @Bean(name = "authenticatedGetRateLimiter")
    public TokenBucketRateLimiter<String> authenticatedGetRateLimiter(Clock clock) {
        // The generic bucket is partitioned by user and read category at the call site.
        return new TokenBucketRateLimiter<>(clock, 1, Duration.ofSeconds(1));
    }
}
