package com.example.botfight.service.limits;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** A synchronized, per-key sliding-window request limiter. */
public final class SlidingWindowRateLimiter<K> {

    private static final int DEFAULT_MAX_TRACKED_KEYS = 10_000;

    private final Clock clock;
    private final int maxRequests;
    private final Duration window;
    private final int maxTrackedKeys;
    private final Map<K, Deque<Instant>> requestTimesByKey;

    public SlidingWindowRateLimiter(Clock clock, int maxRequests, Duration window) {
        this(clock, maxRequests, window, DEFAULT_MAX_TRACKED_KEYS);
    }

    public SlidingWindowRateLimiter(
            Clock clock,
            int maxRequests,
            Duration window,
            int maxTrackedKeys) {
        this.clock = Objects.requireNonNull(clock, "clock");
        if (maxRequests <= 0) {
            throw new IllegalArgumentException("maxRequests must be positive");
        }
        this.maxRequests = maxRequests;
        this.window = requirePositive(window, "window");
        if (maxTrackedKeys <= 0) {
            throw new IllegalArgumentException("maxTrackedKeys must be positive");
        }
        this.maxTrackedKeys = maxTrackedKeys;
        this.requestTimesByKey = new LinkedHashMap<>(16, 0.75f, true);
    }

    public synchronized void requireAllowed(K key) {
        Objects.requireNonNull(key, "key");
        Instant now = Instant.now(clock);
        Deque<Instant> requestTimes = requestTimesByKey.get(key);
        if (requestTimes == null) {
            evictOldestKeyIfNecessary();
            requestTimes = new ArrayDeque<>();
            requestTimesByKey.put(key, requestTimes);
        }
        pruneExpired(requestTimes, now);

        if (requestTimes.size() >= maxRequests) {
            Instant retryAt = requestTimes.peekFirst().plus(window);
            throw RateLimitExceededException.tooManyRequests(Duration.between(now, retryAt));
        }

        requestTimes.addLast(now);
    }

    private void evictOldestKeyIfNecessary() {
        if (requestTimesByKey.size() < maxTrackedKeys) return;
        Iterator<K> keys = requestTimesByKey.keySet().iterator();
        if (keys.hasNext()) {
            keys.next();
            keys.remove();
        }
    }

    private void pruneExpired(Deque<Instant> requestTimes, Instant now) {
        Instant cutoff = now.minus(window);
        while (!requestTimes.isEmpty() && !requestTimes.peekFirst().isAfter(cutoff)) {
            requestTimes.removeFirst();
        }
    }

    private static Duration requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }
}
