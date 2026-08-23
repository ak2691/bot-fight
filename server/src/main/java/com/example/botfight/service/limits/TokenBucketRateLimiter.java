package com.example.botfight.service.limits;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** A synchronized, per-key token bucket with whole-token refills. */
public final class TokenBucketRateLimiter<K> {

    private static final int DEFAULT_MAX_TRACKED_KEYS = 10_000;

    private final Clock clock;
    private final int capacity;
    private final Duration refillInterval;
    private final long refillIntervalMillis;
    private final int maxTrackedKeys;
    private final Map<K, Bucket> bucketsByKey;

    public TokenBucketRateLimiter(Clock clock, int capacity, Duration refillInterval) {
        this(clock, capacity, refillInterval, DEFAULT_MAX_TRACKED_KEYS);
    }

    public TokenBucketRateLimiter(
            Clock clock,
            int capacity,
            Duration refillInterval,
            int maxTrackedKeys) {
        this.clock = Objects.requireNonNull(clock, "clock");
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
        this.refillInterval = requirePositive(refillInterval, "refillInterval");
        this.refillIntervalMillis = this.refillInterval.toMillis();
        if (refillIntervalMillis <= 0) {
            throw new IllegalArgumentException("refillInterval must be at least one millisecond");
        }
        if (maxTrackedKeys <= 0) {
            throw new IllegalArgumentException("maxTrackedKeys must be positive");
        }
        this.maxTrackedKeys = maxTrackedKeys;
        this.bucketsByKey = new LinkedHashMap<>(16, 0.75f, true);
    }

    public synchronized void requireAllowed(K key) {
        Objects.requireNonNull(key, "key");
        Instant now = Instant.now(clock);
        Bucket bucket = bucketsByKey.get(key);
        if (bucket == null) {
            evictOldestKeyIfNecessary();
            bucket = new Bucket(capacity, now);
            bucketsByKey.put(key, bucket);
        }
        refill(bucket, now);

        if (bucket.tokens == 0) {
            long elapsedMillis = Math.max(0L, Duration.between(bucket.lastRefillAt, now).toMillis());
            long remainderMillis = elapsedMillis % refillIntervalMillis;
            long retryAfterMillis = remainderMillis == 0
                    ? refillIntervalMillis
                    : refillIntervalMillis - remainderMillis;
            throw RateLimitExceededException.tooManyRequests(Duration.ofMillis(retryAfterMillis));
        }

        bucket.tokens -= 1;
    }

    private void evictOldestKeyIfNecessary() {
        if (bucketsByKey.size() < maxTrackedKeys) return;
        Iterator<K> keys = bucketsByKey.keySet().iterator();
        if (keys.hasNext()) {
            keys.next();
            keys.remove();
        }
    }

    public synchronized void forget(K key) {
        if (key != null) {
            bucketsByKey.remove(key);
        }
    }

    private void refill(Bucket bucket, Instant now) {
        if (now.isBefore(bucket.lastRefillAt)) {
            return;
        }

        long elapsedMillis = Duration.between(bucket.lastRefillAt, now).toMillis();
        long refilledTokens = elapsedMillis / refillIntervalMillis;
        if (refilledTokens <= 0) {
            return;
        }

        long nextTokenCount = Math.min((long) capacity, bucket.tokens + refilledTokens);
        bucket.tokens = (int) nextTokenCount;
        if (bucket.tokens == capacity) {
            bucket.lastRefillAt = now;
            return;
        }

        bucket.lastRefillAt = bucket.lastRefillAt.plusMillis(refilledTokens * refillIntervalMillis);
    }

    private static Duration requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    private static final class Bucket {
        private int tokens;
        private Instant lastRefillAt;

        private Bucket(int tokens, Instant lastRefillAt) {
            this.tokens = tokens;
            this.lastRefillAt = lastRefillAt;
        }
    }
}
