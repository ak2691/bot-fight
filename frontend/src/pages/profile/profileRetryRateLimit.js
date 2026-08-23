export const PROFILE_RETRY_BUCKET_CAPACITY = 1;
export const PROFILE_RETRY_REFILL_INTERVAL_MS = 1_000;

export function createProfileRetryTokenBucket(now = () => Date.now()) {
    let tokens = PROFILE_RETRY_BUCKET_CAPACITY;
    let lastRefillAt = now();

    return {
        tryConsume() {
            const currentTime = now();
            if (currentTime >= lastRefillAt) {
                const refilledTokens = Math.floor(
                    (currentTime - lastRefillAt) / PROFILE_RETRY_REFILL_INTERVAL_MS,
                );
                if (refilledTokens > 0) {
                    tokens = Math.min(PROFILE_RETRY_BUCKET_CAPACITY, tokens + refilledTokens);
                    lastRefillAt = tokens === PROFILE_RETRY_BUCKET_CAPACITY
                        ? currentTime
                        : lastRefillAt + (refilledTokens * PROFILE_RETRY_REFILL_INTERVAL_MS);
                }
            }

            if (tokens === 0) return false;
            tokens -= 1;
            return true;
        },
    };
}
