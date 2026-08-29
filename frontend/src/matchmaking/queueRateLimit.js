export const QUEUE_TOKEN_CAPACITY = 3;
export const QUEUE_TOKEN_REFILL_MS = 3_000;

export function createQueueTokenBucket(now = Date.now()) {
    return {
        tokens: QUEUE_TOKEN_CAPACITY,
        lastRefillAt: now,
    };
}

export function tryConsumeQueueToken(bucket, now = Date.now()) {
    if (now >= bucket.lastRefillAt) {
        const elapsedMs = now - bucket.lastRefillAt;
        const refilledTokens = Math.floor(elapsedMs / QUEUE_TOKEN_REFILL_MS);
        if (refilledTokens > 0) {
            bucket.tokens = Math.min(
                QUEUE_TOKEN_CAPACITY,
                bucket.tokens + refilledTokens,
            );
            bucket.lastRefillAt = bucket.tokens === QUEUE_TOKEN_CAPACITY
                ? now
                : bucket.lastRefillAt + refilledTokens * QUEUE_TOKEN_REFILL_MS;
        }
    }

    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
}
