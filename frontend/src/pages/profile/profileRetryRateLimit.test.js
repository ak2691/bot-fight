import assert from "node:assert/strict";
import test from "node:test";
import {
    createProfileRetryTokenBucket,
    PROFILE_RETRY_REFILL_INTERVAL_MS,
} from "./profileRetryRateLimit.js";

test("profile retry bucket allows one attempt and refills after one second", () => {
    let now = 0;
    const bucket = createProfileRetryTokenBucket(() => now);

    assert.equal(bucket.tryConsume(), true);
    assert.equal(bucket.tryConsume(), false);

    now = PROFILE_RETRY_REFILL_INTERVAL_MS - 1;
    assert.equal(bucket.tryConsume(), false);

    now = PROFILE_RETRY_REFILL_INTERVAL_MS;
    assert.equal(bucket.tryConsume(), true);
    assert.equal(bucket.tryConsume(), false);
});

test("profile retry bucket does not accumulate more than one token", () => {
    let now = 0;
    const bucket = createProfileRetryTokenBucket(() => now);

    assert.equal(bucket.tryConsume(), true);
    now = PROFILE_RETRY_REFILL_INTERVAL_MS * 10;
    assert.equal(bucket.tryConsume(), true);
    assert.equal(bucket.tryConsume(), false);
});
