import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./stompClient.js", import.meta.url), "utf8");

test("a connected socket resumes the match without waiting for delay calibration", () => {
    assert.match(source, /void sampleNetworkDelay\(\)\.catch\(\(\) => null\)/);
    assert.doesNotMatch(source, /await initialNetworkDelaySample/);
    assert.doesNotMatch(source, /eventDelivery = eventDelivery\.then\(\(\) => initialNetworkDelaySample\)/);
});

test("publishes are guarded against a closing transport and the active client can resume reconnects", () => {
    assert.match(source, /readyState === 1/);
    assert.match(source, /try \{\s*stompClient\.publish/);
    assert.match(source, /resumeReconnect\(\)/);
    assert.match(source, /isActiveMatchSocketConnected/);
});

test("route handoffs do not replace a transport that is still connecting", () => {
    assert.match(source, /if \(connectInFlight \|\| stompClient\?\.active\)/);
    assert.doesNotMatch(source, /deactivate\(\{ force: true \}\)/);
    assert.match(source, /stompClient !== transport/);
    assert.match(source, /if \(!isCurrentTransport\(\)\) return;/);
});

test("active-match route identity is bound to matchmaking events, not the chat subscription", () => {
    assert.match(source, /MATCH_CHAT_DESTINATION/);
    assert.match(source, /updateMatchSocketBinding\(event\)/);
    assert.match(source, /isConnectedForMatch\(matchId\)/);
    assert.match(source, /activeMatchId === String\(matchId\)/);
    assert.match(source, /event\.type === "MATCH_RESULT_READY"/);
    assert.match(source, /activeMatchId = null/);
});

test("notifications share the authenticated transport through a separate subscription", () => {
    assert.match(source, /NOTIFICATION_DESTINATION = "\/user\/queue\/notifications"/);
    assert.match(source, /notificationSubscription = transport\.subscribe\(/);
    assert.match(source, /NOTIFICATION_DESTINATION/);
    assert.match(source, /setNotificationHandler/);
    assert.match(source, /acceptDuelInvite/);
});

test("party state has its own authenticated user queue and handler lifecycle", () => {
    assert.match(source, /PARTY_DESTINATION = "\/user\/queue\/party"/);
    assert.match(source, /partySubscription = transport\.subscribe\(/);
    assert.match(source, /setPartyHandler/);
    assert.match(source, /subscribeParty\(\)/);
    assert.match(source, /unsubscribeParty\(\)/);
    assert.match(source, /clearPendingPartyEvents/);
    assert.match(source, /partySubscriptionRequested && !partySubscription/);
});

test("custom lobbies have an independent live destination and buffered handler", () => {
    assert.match(source, /CUSTOM_LOBBY_DESTINATION = "\/user\/queue\/custom-lobby"/);
    assert.match(source, /customLobbySubscription = transport\.subscribe\(/);
    assert.match(source, /setCustomLobbyHandler/);
    assert.match(source, /subscribeCustomLobby\(\)/);
    assert.match(source, /unsubscribeCustomLobby\(\)/);
    assert.match(source, /clearPendingCustomLobbyEvents/);
    assert.match(source, /sendCustomLobbyChat\(lobbyId, message\)/);
    assert.match(source, /\/app\/custom-lobby\.chat/);
});

test("match chat publishes an explicit audience channel", () => {
    assert.match(source, /sendChat\(matchId, message, channel = "ALL"\)/);
    assert.match(source, /channel \}\);/);
});

test("queue and active-match subscriptions have independent route lifecycles", () => {
    assert.match(source, /MATCH_DESTINATION = "\/user\/queue\/match"/);
    assert.match(source, /subscribeMatchmaking\(\)/);
    assert.match(source, /unsubscribeMatchmaking\(\)/);
    assert.match(source, /subscribeMatch\(\)/);
    assert.match(source, /unsubscribeMatch\(\)/);
    assert.match(source, /deliverEvent\(JSON\.parse\(message\.body\), receivedAtMs, false\)/);
    assert.match(source, /deliverEvent\(JSON\.parse\(message\.body\), receivedAtMs, true\)/);
});

test("reconnecting queue clients rebind instead of publishing another join", () => {
    assert.match(source, /resumeQueue\(\) \{\s*publish\("\/app\/matchmaking\.resumeQueue"\)/);
});
