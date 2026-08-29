import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./useMatchLifecycle.js", import.meta.url));

test("match lifecycle hook retains authoritative event and timer transitions", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /export function useMatchLifecycle\(\{ navigate \}\)/);
    assert.match(source, /const handleMatchEvent = \(rawEvent/);
    assert.match(source, /MATCH_ACCEPTED/);
    assert.match(source, /MATCH_LOADOUT_SELECTION_READY/);
    assert.match(source, /MATCH_REPLAY_BATCH/);
    assert.match(source, /MATCH_RESULT_READY/);
    assert.match(source, /matchAcceptanceAuthoritativeDeadlineRef/);
    assert.match(source, /updateQueueStatus\("WAITING"\)/);
    assert.match(source, /isMatchAcceptanceUnavailableError/);
    assert.match(source, /setInterval\(update, 100\)/);
    assert.match(source, /setInterval\(\(\) => \{/);
    assert.match(source, /preloadShapes: arenaPreloadShapes\(matchEvent\)/);
    assert.match(source, /function stableLocalDeadline/);
    assert.match(source, /matchEventRef\.current,\s*\)/);
    assert.match(source, /match-loadout-draft:/);
    assert.match(source, /window\.sessionStorage/);
    assert.match(source, /readLoadoutDraft\(event\)/);
    assert.match(source, /writeLoadoutDraft\(matchEvent, loadoutChoice\)/);
    assert.match(source, /channel: String\(event\.channel/);
    assert.match(source, /sendChat\(matchEventRef\.current\.matchId, message, channel\)/);
});

test("match errors preserve the current rendered phase", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const errorHandler = source.slice(
        source.indexOf('if (event.type === "MATCH_ERROR")'),
        source.indexOf('if (event.type === "SIMULATION_PREPARING")'),
    );

    assert.doesNotMatch(errorHandler, /updateQueueStatus\("BUILDING"\)/);
    assert.match(errorHandler, /setLoadoutSubmitPending\(false\)/);
});

test("a terminal result keeps delayed replay batches from overwriting it", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const replayHandler = source.slice(
        source.indexOf('if (event.type === "MATCH_REPLAY_BATCH")'),
        source.indexOf('if (event.type === "MATCH_RESULT_READY")'),
    );
    const resultHandler = source.slice(source.indexOf('if (event.type === "MATCH_RESULT_READY")'));

    assert.match(replayHandler, /terminalResultRef\.current/);
    assert.match(resultHandler, /terminalResultRef\.current = true/);
});

test("a non-terminal round result is revealed by the round-result batch", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const replayHandler = source.slice(
        source.indexOf('if (event.type === "MATCH_REPLAY_BATCH")'),
        source.indexOf('if (event.type === "MATCH_RESULT_READY")'),
    );

    assert.match(replayHandler, /event\.status === "ROUND_RESULT_READY"/);
    assert.match(replayHandler, /const isRoundResultReveal = event\.status === "ROUND_RESULT_READY"/);
    assert.match(replayHandler, /incomingBatchIsStale = !isRoundResultReveal/);
    assert.match(replayHandler, /event\.playback\?\.frames\?\.length/);
    assert.match(replayHandler, /roundResultRevealReceived/);
});

test("a terminal result still accepts a terminal frame batch that arrives afterward", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const replayHandler = source.slice(
        source.indexOf('if (event.type === "MATCH_REPLAY_BATCH")'),
        source.indexOf('if (event.type === "MATCH_RESULT_READY")'),
    );

    assert.match(source, /canCompleteTerminalReplay/);
    assert.match(replayHandler, /terminalResultRef\.current && playbackRef\.current\?\.terminalBatch === true/);
    assert.match(source, /terminalBatch: currentPlayback\?\.terminalBatch === true/);
});

test("the official replay result clears the cached active-match state", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const resultHandler = source.slice(source.indexOf('if (event.type === "MATCH_RESULT_READY")'));

    assert.match(resultHandler, /clearActiveMatch\(\)/);
    assert.match(resultHandler, /resultRevealReceived: true/);
});

test("code view requests are client-filtered to teammates and expose team forfeit state", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /participantTeamNumber\(target\) !== participantTeamNumber\(event\?\.player\)/);
    assert.match(source, /surrenderVoteCount: matchEvent\?\.surrenderVoteCount/);
    assert.match(source, /surrenderVoteRequired: matchEvent\?\.surrenderVoteRequired/);
    assert.match(source, /winnerIsOnOpposingTeam\(event\)/);
});

test("reconnect notifications clear the banner across replay phase boundaries", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const reconnectHandler = source.slice(
        source.indexOf('if (event.type === "PLAYER_RECONNECTED")'),
        source.indexOf('if (event.type === "SIMULATION_LOADING")'),
    );

    assert.match(source, /const isPlayerReconnectedEvent = event\.type === "PLAYER_RECONNECTED"/);
    assert.match(source, /!isPlayerReconnectedEvent && \(isOlderMatchRoundEvent/);
    assert.match(source, /event\.type !== "MATCH_RESULT_READY"\s+&& !isPlayerReconnectedEvent/);
    assert.match(reconnectHandler, /setDisconnectNotice\(null\)/);
    assert.match(reconnectHandler, /setDisconnectRemaining\(0\)/);
});

test("a server-confirmed missing match clears the cached active-match state", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const noActiveMatchBlock = source.slice(
        source.indexOf('if (event.type === "NO_ACTIVE_MATCH")'),
        source.indexOf('if (redirectToHomeForTerminalEvent', source.indexOf('if (event.type === "NO_ACTIVE_MATCH")')),
    );

    assert.match(noActiveMatchBlock, /clearActiveMatch\(\)/);
    assert.doesNotMatch(noActiveMatchBlock, /disconnectActiveMatchmakingClient/);
});

test("leaving the match is a route handoff and never closes the shared transport", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const exitBlock = source.slice(
        source.indexOf("const exitToHome = () =>"),
        source.indexOf("const handleChatEvent", source.indexOf("const exitToHome = () =>")),
    );

    assert.doesNotMatch(exitBlock, /activeMatchStatus/);
    assert.doesNotMatch(exitBlock, /refreshActiveMatchStatus/);
    assert.doesNotMatch(exitBlock, /disconnectActiveMatchmakingClient/);
    assert.match(exitBlock, /navigate\("\/home"\)/);
});

test("repeated match-home clicks remain a local route handoff", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const exitBlock = source.slice(
        source.indexOf("const exitToHome = () =>"),
        source.indexOf("const handleChatEvent", source.indexOf("const exitToHome = () =>")),
    );

    assert.match(exitBlock, /exitToHomeInFlightRef/);
    assert.doesNotMatch(exitBlock, /isConnectedForMatch\?\./);
    assert.doesNotMatch(exitBlock, /refreshActiveMatchStatus/);
});
