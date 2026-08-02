package com.example.botfight.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class MatchmakingRateLimiter {

    private static final int MAX_ATTEMPTS_PER_WINDOW = 3;
    private static final Duration WINDOW = Duration.ofSeconds(5);

    private final Clock clock;
    private final Map<UUID, Deque<Instant>> attemptsByUserId = new HashMap<>();

    public MatchmakingRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public synchronized void requireAllowed(UUID userId) {
        Instant now = Instant.now(clock);
        Deque<Instant> attempts = attemptsByUserId.computeIfAbsent(
                userId,
                ignored -> new ArrayDeque<>());
        pruneExpired(attempts, now);

        if (attempts.size() >= MAX_ATTEMPTS_PER_WINDOW) {
            Instant retryAt = attempts.peekFirst().plus(WINDOW);
            throw new RateLimitExceededException(
                    "Too many matchmaking attempts. Please wait before trying again.",
                    Duration.between(now, retryAt));
        }

        attempts.addLast(now);
    }

    private void pruneExpired(Deque<Instant> attempts, Instant now) {
        Instant cutoff = now.minus(WINDOW);
        while (!attempts.isEmpty() && !attempts.peekFirst().isAfter(cutoff)) {
            attempts.removeFirst();
        }
    }
}
