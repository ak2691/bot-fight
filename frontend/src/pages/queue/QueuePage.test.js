import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const QUEUE_PAGE_PATH = fileURLToPath(new URL("./QueuePage.jsx", import.meta.url));
const MATCHMAKING_PROVIDER_PATH = fileURLToPath(new URL("../../matchmaking/MatchmakingProvider.jsx", import.meta.url));

test("queue errors use only the shared red popup instead of an inline queue card", () => {
    const queueSource = readFileSync(QUEUE_PAGE_PATH, "utf8");
    const providerSource = readFileSync(MATCHMAKING_PROVIDER_PATH, "utf8");

    assert.doesNotMatch(queueSource, /queueError/);
    assert.match(providerSource, /queueError && !pendingAcceptance/);
    assert.match(providerSource, /bg-red-950/);
});
