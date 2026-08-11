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
const MATCHMAKING_PROVIDER_PATH = fileURLToPath(new URL("../../matchmaking/MatchmakingProvider.jsx", import.meta.url));
const MATCH_ACCEPTANCE_MODAL_PATH = fileURLToPath(new URL("../../matchmaking/MatchAcceptanceModal.jsx", import.meta.url));

test("match acceptance is an identity-free dialog with the requested copy", () => {
    const source = readFileSync(MATCH_ACCEPTANCE_MODAL_PATH, "utf8");

    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-labelledby="match-acceptance-title"/);
    assert.match(source, /\{closing \? "Closing\.\.\." : "Match Found"\}/);
    assert.match(source, />Opponent Found<\/p>/);
    assert.match(source, /Accept to enter the match/);
    assert.match(source, /<button[\s\S]*>\s*\{buttonLabel\}\s*<\/button>/);
    assert.doesNotMatch(source, /MatchPlayerIdentity|acceptedUserId|\bVS\b/);
    assert.doesNotMatch(source, /player\s*,|opponent\s*,/);
});

test("the countdown ring starts full and is explicitly oriented for counterclockwise depletion", () => {
    const source = readFileSync(MATCH_ACCEPTANCE_MODAL_PATH, "utf8");
    const start = acceptanceVisibleStartMs(20_000);

    assert.equal(acceptanceProgressFraction({ nowMs: start, deadlineMs: 20_000, visibleStartMs: start }), 1);
    assert.equal(acceptanceProgressFraction({ nowMs: 10_000, deadlineMs: 20_000, visibleStartMs: start }), 0.5);
    assert.equal(acceptanceProgressFraction({ nowMs: 20_000, deadlineMs: 20_000, visibleStartMs: start }), 0);
    assert.match(source, /strokeDasharray=/);
    assert.match(source, /strokeDashoffset="0"/);
    assert.match(source, /rotate\(-90/);
    assert.match(source, /counterclockwise/);
});

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
        message: null,
    });
    assert.doesNotMatch(JSON.stringify(normalized), /self-secret|opponent-secret|userId|opponent|players/);
});

test("provider keeps only recipient-relative acceptance state and preserves same-match timing", () => {
    const source = readFileSync(MATCHMAKING_PROVIDER_PATH, "utf8");
    const acceptanceStateSource = readFileSync(
        fileURLToPath(new URL("../../matchmaking/matchAcceptance.js", import.meta.url)),
        "utf8",
    );

    assert.match(source, /acceptanceEventForClient\(rawEvent\)/);
    assert.match(acceptanceStateSource, /acceptedByMe/);
    assert.match(source, /otherPlayerAccepted/);
    assert.doesNotMatch(source, /pendingAcceptance\.opponent|pendingAcceptance\.player/);
    assert.doesNotMatch(source, /acceptedUserId/);
    assert.doesNotMatch(source, /<MatchAcceptanceModal[\s\S]*player=|<MatchAcceptanceModal[\s\S]*opponent=/);
    assert.match(source, /samePendingMatch && acceptanceDeadlineRef\.current != null/);
    assert.match(source, /acceptanceAuthoritativeDeadlineRef/);
    assert.match(source, /acceptanceStartDeadlineRef/);
    assert.match(source, /window\.setTimeout/);
    assert.match(source, /acceptanceAuthoritativeDeadlineRef\.current === acceptanceAuthoritativeDeadlineMs/);
    assert.match(source, /clearPendingAcceptance\(\)/);
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
    assert.match(acceptanceBlock, /updatePendingAcceptance\(event\)/);
    assert.doesNotMatch(acceptanceBlock, /navigate\("\/matchmaking"/);
    assert.match(providerSource, /event\.type === "MATCH_STARTED" && event\.status === "LOADOUT_SELECT"/);
    assert.match(providerSource, /navigate\("\/matchmaking", \{ state: \{ matchEvent: event \} \}\)/);
});

test("page client initialization is stable across loadout state updates", () => {
    const pageSource = readFileSync(GAME_PAGE_PATH, "utf8");
    const source = readFileSync(MATCH_LIFECYCLE_HOOK_PATH, "utf8");

    assert.match(pageSource, /useMatchLifecycle\(\{/);
    assert.match(source, /export function useMatchLifecycle\(\{ initialRouteMatchEvent, navigate \}\)/);
    assert.match(source, /const initialMatchEventPayload = useMemo\(/);
    assert.match(source, /\}, \[initialRouteMatchEvent\]\);/);
    assert.match(source, /useMatchmakingSocket\(\{/);
});

test("page fallback acceptance flow also strips identities and supports cancellation", () => {
    const pageSource = readFileSync(GAME_PAGE_PATH, "utf8");
    const source = readFileSync(MATCH_LIFECYCLE_HOOK_PATH, "utf8");

    assert.match(source, /acceptanceEventForClient\(event\)/);
    assert.doesNotMatch(source, /acceptedUserId/);
    assert.match(pageSource, /otherPlayerAccepted=\{matchEvent\?\.otherPlayerAccepted === true\}/);
    assert.match(source, /clientRef\.current\?\.cancelMatch/);
    assert.match(source, /matchAcceptanceAuthoritativeDeadlineRef/);
    assert.match(pageSource, /authoritativeRemaining=\{matchAcceptanceAuthoritativeRemaining\}/);
    assert.match(source, /isMatchAcceptanceUnavailableError/);
    assert.match(source, /updateQueueStatus\("WAITING"\)/);
    assert.match(source, /event\.type === "MATCH_STARTED"/);
});

test("focus management, timer semantics, and reduced-motion-safe rendering remain present", () => {
    const source = readFileSync(MATCH_ACCEPTANCE_MODAL_PATH, "utf8");

    assert.match(source, /useDialogFocus\(dialogRef, \{/);
    assert.match(source, /initialFocusRef: canAccept \? acceptButtonRef : null/);
    assert.match(source, /lockScroll: true/);
    assert.match(source, /role="progressbar"/);
    assert.match(source, /aria-valuetext=/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /aria-atomic="true"/);
    assert.match(source, /closing \? "0" : remaining/);
    assert.match(source, /closing \? "Closing\.\.\." : "Match Found"/);
    assert.match(source, /window\.requestAnimationFrame/);
    assert.match(source, /authoritativeRemaining/);
    assert.match(source, /acceptanceOpen && connected && acceptanceState === "READY"/);
    assert.doesNotMatch(source, /animate-|transition.*stroke/);
});
