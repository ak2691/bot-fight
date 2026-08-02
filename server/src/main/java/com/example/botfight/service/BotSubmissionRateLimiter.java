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
public class BotSubmissionRateLimiter {

    private static final int MAX_SUBMISSIONS_PER_WINDOW = 20;
    private static final Duration WINDOW = Duration.ofSeconds(1);

    private final Clock clock;
    private final Map<UUID, Deque<Instant>> submissionsByUserId = new HashMap<>();

    public BotSubmissionRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public synchronized void requireAllowed(UUID userId) {
        Instant now = Instant.now(clock);
        Deque<Instant> submissions = submissionsByUserId.computeIfAbsent(userId, ignored -> new ArrayDeque<>());
        pruneExpired(submissions, now);

        if (submissions.size() >= MAX_SUBMISSIONS_PER_WINDOW) {
            Instant retryAt = submissions.peekFirst().plus(WINDOW);
            throw new RateLimitExceededException(
                    "Too many bot submissions. Please retry shortly.",
                    Duration.between(now, retryAt));
        }

        submissions.addLast(now);
    }

    private void pruneExpired(Deque<Instant> submissions, Instant now) {
        Instant cutoff = now.minus(WINDOW);
        while (!submissions.isEmpty() && !submissions.peekFirst().isAfter(cutoff)) {
            submissions.removeFirst();
        }
    }
}
