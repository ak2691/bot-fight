import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    AUTH_SESSION_INVALID,
    AUTH_SESSION_TEMPORARY_FAILURE,
    AUTH_SESSION_VALID,
} from "../auth/authSession.js";
import { createMatchmakingClient } from "./stompClient.js";

const source = readFileSync(new URL("./stompClient.js", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("./MatchmakingProvider.jsx", import.meta.url), "utf8");

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
    assert.match(source, /allowNotificationSubscription/);
    assert.match(source, /setNotificationSubscriptionEnabled/);
    assert.match(source, /activeMatchmakingIdentityKey/);
    assert.match(source, /NOTIFICATION_DESTINATION/);
    assert.match(source, /setNotificationHandler/);
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

test("custom-lobby membership drops the ranked matchmaking subscription", () => {
    assert.match(providerSource, /hasCustomLobby[\s\S]*?client\.unsubscribeMatchmaking\?\./);
    assert.match(providerSource, /client\.subscribeMatchmaking\?\.[\s\S]*?\[\s*activeMatchStatus\.activeMatch,[\s\S]*?customLobbyEvent/);
});

test("reconnecting queue clients rebind instead of publishing another join", () => {
    assert.match(source, /resumeQueue\(\) \{\s*publish\("\/app\/matchmaking\.resumeQueue"\)/);
});

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function makeTransportFactory(transports) {
    return (configuration) => {
        const transport = {
            configuration,
            active: false,
            connected: false,
            reconnectDelay: configuration.reconnectDelay,
            subscriptions: [],
            deactivationCount: 0,
            activate() { this.active = true; },
            async deactivate() {
                this.active = false;
                this.connected = false;
                this.deactivationCount += 1;
            },
            subscribe(destination, handler) {
                const subscription = {
                    destination,
                    handler,
                    unsubscribeCount: 0,
                    unsubscribe() { this.unsubscribeCount += 1; },
                };
                this.subscriptions.push(subscription);
                return subscription;
            },
            publish() {},
        };
        transports.push(transport);
        return transport;
    };
}

async function flushPromises() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeClient({
    transports,
    authenticationProbe,
    onAuthenticationLost = () => {},
    onStatus,
    csrfHeadersProvider = async () => ({ "X-XSRF-TOKEN": "test" }),
    setTimeoutImpl,
    clearTimeoutImpl,
}) {
    return createMatchmakingClient({
        onAuthenticationLost,
        onStatus,
        autoReconnect: true,
        transportFactory: makeTransportFactory(transports),
        csrfHeadersProvider,
        websocketUrlProvider: () => "ws://localhost/ws",
        authenticationProbe,
        ...(setTimeoutImpl ? { setTimeoutImpl } : {}),
        ...(clearTimeoutImpl ? { clearTimeoutImpl } : {}),
    });
}

test("transient WebSocket failures retain bounded exponential reconnect settings", async () => {
    const transports = [];
    const client = makeClient({
        transports,
        authenticationProbe: async () => AUTH_SESSION_TEMPORARY_FAILURE,
    });

    await client.connect();
    const transport = transports[0];
    assert.equal(transport.configuration.reconnectDelay, 2_000);
    assert.equal(transport.configuration.maxReconnectDelay, 10_000);
    assert.equal(transport.configuration.reconnectTimeMode, 1);

    transport.onWebSocketClose({ code: 1006, reason: "backend unavailable" });
    await flushPromises();

    assert.equal(transport.active, true);
    assert.equal(transport.reconnectDelay, 2_000);
    assert.equal(transport.deactivationCount, 0);
});

test("transient CSRF bootstrap failures retry with bounded exponential delays", async () => {
    const transports = [];
    const scheduled = [];
    let csrfAttemptCount = 0;
    let probeCount = 0;
    const client = makeClient({
        transports,
        csrfHeadersProvider: async () => {
            csrfAttemptCount += 1;
            if (csrfAttemptCount < 3) throw new Error("backend unavailable");
            return { "X-XSRF-TOKEN": "test" };
        },
        authenticationProbe: async () => {
            probeCount += 1;
            return AUTH_SESSION_TEMPORARY_FAILURE;
        },
        setTimeoutImpl: (callback, delay) => {
            scheduled.push({ callback, delay });
            return scheduled.length;
        },
        clearTimeoutImpl: () => {},
    });

    await client.connect();
    await flushPromises();
    assert.deepEqual(scheduled.map(({ delay }) => delay), [2_000]);

    scheduled[0].callback();
    await flushPromises();
    assert.deepEqual(scheduled.map(({ delay }) => delay), [2_000, 4_000]);

    scheduled[1].callback();
    await flushPromises();
    assert.equal(csrfAttemptCount, 3);
    assert.equal(probeCount, 2);
    assert.equal(transports.length, 1);
});

test("confirmed session loss in a STOMP ERROR stops transport and notifies auth state", async () => {
    const transports = [];
    let authenticationLostCount = 0;
    const client = makeClient({
        transports,
        authenticationProbe: async () => AUTH_SESSION_INVALID,
        onAuthenticationLost: () => { authenticationLostCount += 1; },
    });

    await client.connect();
    const transport = transports[0];
    transport.connected = true;
    transport.webSocket = { readyState: 1 };
    client.subscribeMatchmaking();
    const matchmakingSubscription = transport.subscriptions.find(
        (subscription) => subscription.destination === "/user/queue/matchmaking",
    );
    matchmakingSubscription.handler({ body: JSON.stringify({ type: "QUEUED" }) });
    transport.onStompError({ headers: { message: "session expired" } });
    await flushPromises();

    assert.equal(authenticationLostCount, 1);
    assert.equal(transport.deactivationCount, 1);
    assert.equal(transport.reconnectDelay, 0);
    assert.ok(matchmakingSubscription.unsubscribeCount > 0);
    assert.equal(client.isConnected(), false);
    assert.equal(transports.length, 1);
    client.setHandlers({ onEvent: () => assert.fail("stale event was replayed") });
    await client.connect();
    assert.equal(transports.length, 1);
});

test("duplicate auth probes are shared and stale probe results cannot stop a newer socket", async () => {
    const transports = [];
    const pendingProbe = deferred();
    let probeCount = 0;
    let authenticationLostCount = 0;
    const client = makeClient({
        transports,
        authenticationProbe: () => {
            probeCount += 1;
            return pendingProbe.promise;
        },
        onAuthenticationLost: () => { authenticationLostCount += 1; },
    });

    await client.connect();
    const oldTransport = transports[0];
    oldTransport.onStompError({ headers: { message: "rejected" } });
    oldTransport.onWebSocketError({});
    await flushPromises();
    assert.equal(probeCount, 1);

    await client.disconnect();
    await client.connect();
    assert.equal(transports.length, 2);
    pendingProbe.resolve(AUTH_SESSION_INVALID);
    await flushPromises();

    assert.equal(authenticationLostCount, 0);
    assert.equal(transports[1].deactivationCount, 0);
});

test("a socket replaced by a newer connection stops without probing or reconnecting", async () => {
    const transports = [];
    let probeCount = 0;
    const client = makeClient({
        transports,
        authenticationProbe: async () => {
            probeCount += 1;
            return AUTH_SESSION_VALID;
        },
    });

    await client.connect();
    transports[0].onWebSocketClose({
        code: 1000,
        reason: "Replaced by a newer connection",
    });
    await flushPromises();
    await client.connect();

    assert.equal(probeCount, 0);
    assert.equal(transports[0].deactivationCount, 1);
    assert.equal(transports.length, 1);
});

test("a capped tab stops reconnecting and reports a terminal session limit", async () => {
    const transports = [];
    const statuses = [];
    let probeCount = 0;
    const client = makeClient({
        transports,
        onStatus: (status) => statuses.push(status),
        authenticationProbe: async () => {
            probeCount += 1;
            return AUTH_SESSION_VALID;
        },
    });

    await client.connect();
    const transport = transports[0];
    transport.onWebSocketClose({
        code: 1008,
        reason: "Maximum active WebSocket sessions reached",
    });
    await flushPromises();
    await client.connect();

    assert.equal(statuses.at(-1), "SESSION_LIMIT_REACHED");
    assert.equal(transport.deactivationCount, 1);
    assert.equal(transport.reconnectDelay, 0);
    assert.equal(probeCount, 0);
    assert.equal(transports.length, 1);
});

test("an authentication probe survives a reconnect-attempt generation change on the same client", async () => {
    const transports = [];
    const pendingProbe = deferred();
    let authenticationLostCount = 0;
    const client = makeClient({
        transports,
        authenticationProbe: () => pendingProbe.promise,
        onAuthenticationLost: () => { authenticationLostCount += 1; },
    });

    await client.connect();
    const transport = transports[0];
    transport.onStompError({ headers: { message: "session expired" } });
    await flushPromises();
    await transport.beforeConnect();
    pendingProbe.resolve(AUTH_SESSION_INVALID);
    await flushPromises();

    assert.equal(authenticationLostCount, 1);
    assert.equal(transport.deactivationCount, 1);
});
