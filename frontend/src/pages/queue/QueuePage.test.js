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

test("route changes do not leave and rejoin an active queue", () => {
    const providerSource = readFileSync(MATCHMAKING_PROVIDER_PATH, "utf8");
    const queueEffect = providerSource.match(/useEffect\(\(\) => \{\s*if \(!isAuthenticated \|\| !queueConnectionEnabled\)[\s\S]*?\}, \[[\s\S]*?queueConnectionEnabled[\s\S]*?\]\);/);

    assert.ok(queueEffect);
    assert.match(providerSource, /const navigateRef = useRef\(navigate\)/);
    assert.match(queueEffect[0], /navigateRef\.current\("\/match"\)/);
    assert.doesNotMatch(queueEffect[0], /\bnavigate\b/);
    assert.match(queueEffect[0], /client\.resumeQueue\?\.\(\)/);
    assert.doesNotMatch(queueEffect[0], /client\.leaveQueue\(\)/);
});

test("queue recovery asks the server instead of using browser storage", () => {
    const providerSource = readFileSync(MATCHMAKING_PROVIDER_PATH, "utf8");

    assert.doesNotMatch(providerSource, /localStorage|sessionStorage/);
    assert.match(providerSource, /queueConnectionEnabled/);
    assert.match(providerSource, /event\.type === "QUEUE_IDLE"/);
    assert.match(providerSource, /event\.queueStartedAt/);
    assert.match(providerSource, /resumeQueue\?\.\(\)/);
    assert.match(providerSource, /queueEntryKnownRef/);
});

test("offline party notices use the section padding when shown alone", () => {
    const queueSource = readFileSync(QUEUE_PAGE_PATH, "utf8");

    assert.match(queueSource, /text-xs leading-5 text-amber-300 \$\{partyQueueBlocked \? "mt-3" : ""\}/);
});
