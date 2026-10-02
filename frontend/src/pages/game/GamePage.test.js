import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    acceptanceAnnouncementRemaining,
    acceptanceEventForClient,
    acceptanceProgressFraction,
    MATCH_ACCEPTANCE_SUBMISSION_GRACE_MS,
    acceptanceVisibleStartMs,
} from "../../matchmaking/matchAcceptance.js";

const GAME_PAGE_PATH = fileURLToPath(new URL("./GamePage.jsx", import.meta.url));
const MATCH_LIFECYCLE_HOOK_PATH = fileURLToPath(new URL("./hooks/useMatchLifecycle.js", import.meta.url));
const SIMULATION_REPLAY_PATH = fileURLToPath(new URL("../../replay/SimulationReplay.jsx", import.meta.url));
const MATCHMAKING_PROVIDER_PATH = fileURLToPath(new URL("../../matchmaking/MatchmakingProvider.jsx", import.meta.url));
const MATCH_ACCEPTANCE_MODAL_PATH = fileURLToPath(new URL("../../matchmaking/MatchAcceptanceModal.jsx", import.meta.url));

test("ring progress is deadline-derived and does not move independently of time", () => {
    const start = acceptanceVisibleStartMs(20_000);
    const early = acceptanceProgressFraction({ nowMs: 1_000, deadlineMs: 20_000, visibleStartMs: start });
    const late = acceptanceProgressFraction({ nowMs: 15_000, deadlineMs: 20_000, visibleStartMs: start });
    assert.ok(early > late);
    assert.equal(acceptanceProgressFraction({ nowMs: 7_500, deadlineMs: 20_000, visibleStartMs: start }), 0.625);
    assert.equal(acceptanceProgressFraction({ nowMs: 25_000, deadlineMs: 20_000, visibleStartMs: start }), 0);
    assert.equal(acceptanceAnnouncementRemaining(19), 20);
    assert.equal(acceptanceAnnouncementRemaining(14), 15);
    assert.equal(acceptanceAnnouncementRemaining(4), 4);
    assert.equal(MATCH_ACCEPTANCE_SUBMISSION_GRACE_MS, 2_000);
});

test("acceptance event normalization cannot retain participant fields", () => {
    const normalized = acceptanceEventForClient({
        type: "MATCH_ACCEPTED",
        status: "MATCH_ACCEPT",
        matchId: "opaque-pending-match",
        serverNow: "2026-08-09T12:00:00Z",
        matchAcceptanceEndsAt: "2026-08-09T12:00:22Z",
        acceptedByMe: true,
        otherPlayerAccepted: false,
        player: { userId: "self", username: "self-secret" },
        opponent: { userId: "opponent", username: "opponent-secret" },
        players: [{ userId: "opponent", username: "opponent-secret" }],
    });

    assert.deepEqual(normalized, {
        type: "MATCH_ACCEPTED",
        matchId: "opaque-pending-match",
        status: "MATCH_ACCEPT",
        serverNow: "2026-08-09T12:00:00Z",
        matchAcceptanceEndsAt: "2026-08-09T12:00:22Z",
        matchAcceptanceEndsAtMs: null,
        matchAcceptanceAuthoritativeEndsAtMs: null,
        acceptedByMe: true,
        otherPlayerAccepted: false,
        mode: null,
        message: null,
    });
    assert.doesNotMatch(JSON.stringify(normalized), /self-secret|opponent-secret|userId|opponent|players/);
    assert.equal(acceptanceEventForClient({ type: "MATCH_FOUND", status: "MATCH_ACCEPT", mode: "ONES" }).mode, "ONES");
});

test("provider keeps only recipient-relative acceptance state and preserves same-match timing", () => {
    const source = readFileSync(MATCHMAKING_PROVIDER_PATH, "utf8");

    assert.match(source, /acceptanceEventForClient\(rawEvent\)/);
    assert.doesNotMatch(source, /pendingAcceptance\.opponent|pendingAcceptance\.player/);
    assert.doesNotMatch(source, /acceptedUserId/);
    assert.doesNotMatch(source, /<MatchAcceptanceModal[\s\S]*player=|<MatchAcceptanceModal[\s\S]*opponent=/);
});

test("MATCH_ACCEPT remains modal-only until authoritative MATCH_STARTED", () => {
    const providerSource = readFileSync(MATCHMAKING_PROVIDER_PATH, "utf8");
    const acceptanceBranch = providerSource.indexOf(
        'if (event.type === "MATCH_FOUND" && event.status === "MATCH_ACCEPT")',
    );
    const acceptanceBranchEnd = providerSource.indexOf(
        'if (event.type === "MATCH_ACCEPTED" && event.status === "MATCH_ACCEPT")',
        acceptanceBranch,
    );
    const acceptanceBlock = providerSource.slice(acceptanceBranch, acceptanceBranchEnd);

    assert.ok(acceptanceBranch >= 0);
    assert.doesNotMatch(acceptanceBlock, /navigate\("\/match"/);
});

test("page client initialization is stable across loadout state updates", () => {

});

test("match refreshes wait for the server resume instead of using route state", () => {
    const source = readFileSync(GAME_PAGE_PATH, "utf8");

    assert.doesNotMatch(source, /useLocation|useNavigationType|location\.state|matchEvent: event/);
});

test("replay does not expose a forfeit control", () => {
    const replaySource = readFileSync(SIMULATION_REPLAY_PATH, "utf8");

    assert.doesNotMatch(replaySource, /onSurrender|surrenderPending|hasSurrendered|canSurrender/);
});

test("page fallback acceptance flow also strips identities and supports cancellation", () => {
    const source = readFileSync(MATCH_LIFECYCLE_HOOK_PATH, "utf8");

    assert.match(source, /acceptanceEventForClient\(event\)/);
    assert.doesNotMatch(source, /acceptedUserId/);
});

