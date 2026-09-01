import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const QUEUE_PAGE_PATH = fileURLToPath(new URL("./QueuePage.jsx", import.meta.url));
const QUEUE_PICKER_PATH = fileURLToPath(new URL("./QueueAbilityGuaranteePicker.jsx", import.meta.url));
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

test("queue exposes one optional catalogue-backed guarantee slot per round", () => {
    const queueSource = readFileSync(QUEUE_PAGE_PATH, "utf8");
    const pickerSource = readFileSync(QUEUE_PICKER_PATH, "utf8");

    assert.match(queueSource, /<QueueAbilityGuaranteePicker/);
    assert.match(queueSource, /values=\{queueGuarantees\}/);
    assert.match(queueSource, /disabled=\{isQueueing\}/);
    assert.match(pickerSource, /const GUARANTEE_ROUNDS = \[1, 2, 3\]/);
    assert.match(pickerSource, /Guaranteed Offers/i);
    assert.match(pickerSource, /Random Ability/);
    assert.doesNotMatch(pickerSource, /NORMAL RANDOM POOL/);
    assert.match(pickerSource, /getAbilityCatalogueIcon/);
    assert.match(pickerSource, /onChange\?\.\(activeRound, ability\.id\)/);
    assert.match(pickerSource, /onChange\?\.\(activeRound, null\)/);
    assert.match(pickerSource, /className="modal-close-button"/);
    assert.match(pickerSource, /className="info-circle-icon h-5 w-5 opacity-85"/);
    assert.doesNotMatch(pickerSource, /setInfoAbility\(ability\);\s*setOpenRound\(null\);/);
    assert.match(pickerSource, /overlayClassName="z-\[950\]"/);
});
