import assert from "node:assert/strict";
import test from "node:test";
import {
    createQueueTokenBucket,
    QUEUE_TOKEN_CAPACITY,
    QUEUE_TOKEN_REFILL_MS,
    tryConsumeQueueToken,
} from "./queueRateLimit.js";

test("queue token bucket allows three attempts and refills one token every three seconds", () => {
    const start = 1_000;
    const bucket = createQueueTokenBucket(start);

    assert.equal(QUEUE_TOKEN_CAPACITY, 3);
    assert.equal(QUEUE_TOKEN_REFILL_MS, 3_000);
    assert.equal(tryConsumeQueueToken(bucket, start), true);
    assert.equal(tryConsumeQueueToken(bucket, start), true);
    assert.equal(tryConsumeQueueToken(bucket, start), true);
    assert.equal(tryConsumeQueueToken(bucket, start), false);
    assert.equal(tryConsumeQueueToken(bucket, start + QUEUE_TOKEN_REFILL_MS - 1), false);
    assert.equal(tryConsumeQueueToken(bucket, start + QUEUE_TOKEN_REFILL_MS), true);
});

test("queue token bucket accumulates refills up to its capacity", () => {
    const start = 2_000;
    const bucket = createQueueTokenBucket(start);

    assert.equal(tryConsumeQueueToken(bucket, start), true);
    assert.equal(tryConsumeQueueToken(bucket, start), true);
    assert.equal(tryConsumeQueueToken(bucket, start + QUEUE_TOKEN_REFILL_MS * 3), true);
    assert.equal(tryConsumeQueueToken(bucket, start + QUEUE_TOKEN_REFILL_MS * 3), true);
    assert.equal(tryConsumeQueueToken(bucket, start + QUEUE_TOKEN_REFILL_MS * 3), true);
    assert.equal(tryConsumeQueueToken(bucket, start + QUEUE_TOKEN_REFILL_MS * 3), false);
});
