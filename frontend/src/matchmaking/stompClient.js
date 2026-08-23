import {
    ActivationState,
    Client,
    ReconnectionTimeMode,
    TickerStrategy,
} from "@stomp/stompjs";
import { API_BASE_URL, apiUrl, websocketUrl } from "../config/api";
import { ensureCsrfHeaders } from "../security/csrf";
import {
    createNetworkDelaySynchronizer,
    estimatedOneWayNetworkDelayMs,
    monotonicEpochNowMs,
    requestBestNetworkDelaySample,
} from "./networkDelayEstimator";

const MATCHMAKING_DESTINATION = "/user/queue/matchmaking";
const MATCH_DESTINATION = "/user/queue/match";
const MATCH_CHAT_DESTINATION = "/user/queue/match-chat";
const NOTIFICATION_DESTINATION = "/user/queue/notifications";
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_ACCEPTED_NETWORK_DELAY_MS = 1_500;
const NETWORK_DELAY_RESAMPLE_INTERVAL_MS = 30_000;
const MATCH_ACCEPTANCE_TERMINAL_EVENT_TYPES = new Set([
    "MATCH_ACCEPTANCE_EXPIRED",
    "MATCH_ACCEPTANCE_CANCELLED",
]);
const networkDelaySynchronizer = createNetworkDelaySynchronizer({
    requestSample: () => requestBestNetworkDelaySample({
        fetchImpl: globalThis.fetch,
        url: apiUrl(`/api/time?sample=${Date.now()}`),
    }),
    acceptSample: (sample) => sample?.valid !== false
        && sample.networkDelayMs <= MAX_ACCEPTED_NETWORK_DELAY_MS,
});

export function getNetworkDelaySample() {
    return networkDelaySynchronizer.getSample();
}

export function getEstimatedOneWayNetworkDelayMs() {
    return estimatedOneWayNetworkDelayMs(getNetworkDelaySample());
}

function sampleNetworkDelay() {
    return networkDelaySynchronizer.synchronize();
}

export function createMatchmakingClient({
    onEvent,
    onChatEvent,
    onNotification,
    onStatus,
    autoReconnect = false,
    autoJoinOnConnect = false,
}) {
    let eventHandler = onEvent;
    let chatEventHandler = onChatEvent;
    let notificationHandler = onNotification;
    let statusHandler = onStatus;
    let stompClient = null;
    let connectInFlight = false;
    let connectGeneration = 0;
    let currentStatus = "IDLE";
    let eventDelivery = Promise.resolve();
    let networkDelayIntervalId = null;
    let resumeOnConnect = false;
    let reconnectEnabled = autoReconnect;
    // The match subscriptions share this transport, so transport connectivity
    // alone is not evidence that the user has a live match to resume.
    let activeMatchId = null;
    let terminalMatchId = null;
    let matchmakingSubscriptionRequested = false;
    let matchSubscriptionRequested = false;
    let matchmakingSubscription = null;
    let matchSubscription = null;
    let matchChatSubscription = null;
    let notificationSubscription = null;
    const pendingEvents = [];
    const pendingChatEvents = [];
    const pendingNotifications = [];

    const isTransportOpen = () => Boolean(
        stompClient?.connected
        && (!stompClient.webSocket || stompClient.webSocket.readyState === 1),
    );

    const stopPeriodicNetworkDelaySampling = () => {
        if (networkDelayIntervalId == null) return;
        clearInterval(networkDelayIntervalId);
        networkDelayIntervalId = null;
    };

    const startPeriodicNetworkDelaySampling = (generation, transport) => {
        stopPeriodicNetworkDelaySampling();
        networkDelayIntervalId = setInterval(() => {
            if (generation !== connectGeneration
                || stompClient !== transport
                || !transport?.connected) return;
            void sampleNetworkDelay();
        }, NETWORK_DELAY_RESAMPLE_INTERVAL_MS);
    };

    const updateMatchSocketBinding = (event) => {
        if (event?.type === "NO_ACTIVE_MATCH") {
            activeMatchId = null;
            terminalMatchId = null;
            return;
        }

        const eventMatchId = event?.matchId == null ? null : String(event.matchId);
        if (eventMatchId == null) return;
        if (terminalMatchId === eventMatchId) return;

        if (event.type === "MATCH_RESULT_READY") {
            if (activeMatchId === eventMatchId) activeMatchId = null;
            terminalMatchId = eventMatchId;
            return;
        }
        if (MATCH_ACCEPTANCE_TERMINAL_EVENT_TYPES.has(event.type)) {
            if (activeMatchId === eventMatchId) activeMatchId = null;
            return;
        }

        terminalMatchId = null;
        activeMatchId = eventMatchId;
    };

    const deliverEvent = (
        event,
        receivedAtMs = monotonicEpochNowMs(),
        fromMatchSubscription = false,
    ) => {
        if (fromMatchSubscription) updateMatchSocketBinding(event);
        if (eventHandler) {
            eventDelivery = eventDelivery
                .then(() => eventHandler?.(event, receivedAtMs))
                .catch(() => {
                    updateStatus("ERROR");
                });
        } else {
            pendingEvents.push({ event, receivedAtMs, fromMatchSubscription });
            if (pendingEvents.length > 100) pendingEvents.shift();
        }
    };

    const deliverChatEvent = (event) => {
        if (chatEventHandler) {
            chatEventHandler(event);
        } else {
            pendingChatEvents.push(event);
            if (pendingChatEvents.length > 100) pendingChatEvents.shift();
        }
    };

    const updateStatus = (status) => {
        currentStatus = status;
        statusHandler?.(status);
    };

    const publish = (destination, body = {}) => {
        if (!isTransportOpen()) return false;
        try {
            stompClient.publish({
                destination,
                body: JSON.stringify(body),
                headers: { "content-type": "application/json" },
            });
            return true;
        } catch {
            updateStatus("CLOSED");
            return false;
        }
    };

    const deliverNotification = (event) => {
        if (notificationHandler) {
            notificationHandler(event);
        } else {
            pendingNotifications.push(event);
            if (pendingNotifications.length > 100) pendingNotifications.shift();
        }
    };

    const unsubscribe = (subscription) => {
        if (!subscription) return;
        try {
            subscription.unsubscribe();
        } catch {
            // The transport may already be closing. The broker will clean up
            // the subscription with the session in that case.
        }
    };

    const clearTransportSubscriptions = () => {
        matchmakingSubscription = null;
        matchSubscription = null;
        matchChatSubscription = null;
        notificationSubscription = null;
    };

    const subscribeRequestedDestinations = (transport) => {
        if (!transport?.connected) return;

        if (!notificationSubscription) {
            notificationSubscription = transport.subscribe(
                NOTIFICATION_DESTINATION,
                (message) => deliverNotification(JSON.parse(message.body)),
            );
        }

        if (matchmakingSubscriptionRequested && !matchmakingSubscription) {
            matchmakingSubscription = transport.subscribe(
                MATCHMAKING_DESTINATION,
                (message) => {
                    const receivedAtMs = monotonicEpochNowMs();
                    deliverEvent(JSON.parse(message.body), receivedAtMs, false);
                },
            );
        }

        if (matchSubscriptionRequested) {
            if (!matchSubscription) {
                matchSubscription = transport.subscribe(
                    MATCH_DESTINATION,
                    (message) => {
                        const receivedAtMs = monotonicEpochNowMs();
                        deliverEvent(JSON.parse(message.body), receivedAtMs, true);
                    },
                );
            }
            if (!matchChatSubscription) {
                matchChatSubscription = transport.subscribe(
                    MATCH_CHAT_DESTINATION,
                    (message) => deliverChatEvent(JSON.parse(message.body)),
                );
            }
        }
    };

    const client = {
        async connect() {
            // STOMP marks a client active while it is connecting or waiting to
            // reconnect. A route handoff must not replace that transport just
            // because the handshake has not completed yet.
            if (connectInFlight || stompClient?.active) {
                statusHandler?.(currentStatus);
                return;
            }

            const generation = ++connectGeneration;
            connectInFlight = true;
            updateStatus("CONNECTING");

            let csrfHeaders;
            try {
                csrfHeaders = await ensureCsrfHeaders("POST", API_BASE_URL);
            } catch {
                connectInFlight = false;
                updateStatus("ERROR");
                return;
            }
            if (generation !== connectGeneration) {
                connectInFlight = false;
                return;
            }

            const transport = new Client({
                brokerURL: websocketUrl(),
                connectHeaders: {
                    host: new URL(websocketUrl()).host,
                    ...csrfHeaders,
                },
                connectionTimeout: 10_000,
                reconnectDelay: reconnectEnabled ? RECONNECT_DELAY_MS : 0,
                reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
                maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
                discardWebsocketOnCommFailure: true,
                heartbeatIncoming: HEARTBEAT_INTERVAL_MS,
                heartbeatOutgoing: HEARTBEAT_INTERVAL_MS,
                heartbeatStrategy: TickerStrategy.Worker,
                debug: () => { },
            });
            stompClient = transport;
            const isCurrentTransport = () => (
                generation === connectGeneration && stompClient === transport
            );
            transport.beforeConnect = async () => {
                if (!isCurrentTransport()) return;
                try {
                    const refreshedCsrfHeaders =
                        await ensureCsrfHeaders("POST", API_BASE_URL);
                    if (!isCurrentTransport()) return;
                    transport.connectHeaders = {
                        host: new URL(websocketUrl()).host,
                        ...refreshedCsrfHeaders,
                    };
                } catch {
                    updateStatus("ERROR");
                }
            };

            transport.onChangeState = (state) => {
                if (!isCurrentTransport()) return;
                if (state === ActivationState.ACTIVE && !transport.connected) {
                    updateStatus("CONNECTING");
                }
            };
            transport.onConnect = async () => {
                if (!isCurrentTransport() || !transport.connected) return;
                stopPeriodicNetworkDelaySampling();
                networkDelaySynchronizer.clear();
                void sampleNetworkDelay().catch(() => null);
                clearTransportSubscriptions();
                subscribeRequestedDestinations(transport);
                if (!isCurrentTransport() || !transport.connected) return;
                startPeriodicNetworkDelaySampling(generation, transport);
                updateStatus("CONNECTED");
                if (autoJoinOnConnect) client.resumeMatch();
                if (resumeOnConnect && !autoJoinOnConnect) {
                    resumeOnConnect = false;
                    client.resumeMatch();
                }
            };
            transport.onStompError = () => {
                if (!isCurrentTransport()) return;
                updateStatus("ERROR");
            };
            transport.onWebSocketError = () => {
                if (!isCurrentTransport()) return;
                updateStatus("ERROR");
            };
            transport.onWebSocketClose = () => {
                if (!isCurrentTransport()) return;
                stopPeriodicNetworkDelaySampling();
                clearTransportSubscriptions();
                updateStatus("CLOSED");
                if (!reconnectEnabled && transport.active) {
                    void transport.deactivate();
                }
            };

            connectInFlight = false;
            transport.activate();
        },
        setHandlers({ onEvent: nextOnEvent, onChatEvent: nextOnChatEvent, onStatus: nextOnStatus } = {}) {
            eventHandler = nextOnEvent;
            chatEventHandler = nextOnChatEvent;
            statusHandler = nextOnStatus;
            if (eventHandler && pendingEvents.length > 0) {
                const events = pendingEvents.splice(0);
                events.forEach(({ event, receivedAtMs, fromMatchSubscription }) => (
                    deliverEvent(event, receivedAtMs, fromMatchSubscription)
                ));
            }
            if (chatEventHandler && pendingChatEvents.length > 0) {
                const events = pendingChatEvents.splice(0);
                events.forEach((event) => chatEventHandler?.(event));
            }
            if (eventHandler && isTransportOpen() && autoJoinOnConnect) {
                client.resumeMatch();
            }
        },
        clearPendingEvents() {
            pendingEvents.splice(0);
            pendingChatEvents.splice(0);
        },
        setNotificationHandler(nextHandler) {
            notificationHandler = nextHandler;
            if (notificationHandler && pendingNotifications.length > 0) {
                const events = pendingNotifications.splice(0);
                events.forEach((event) => notificationHandler?.(event));
            }
        },
        clearPendingNotifications() {
            pendingNotifications.splice(0);
        },
        resumeReconnect() {
            reconnectEnabled = autoReconnect;
            if (stompClient) {
                stompClient.reconnectDelay = reconnectEnabled ? RECONNECT_DELAY_MS : 0;
            }
        },
        isConnected() {
            return isTransportOpen();
        },
        isConnectedForMatch(matchId) {
            return isTransportOpen()
                && matchSubscription != null
                && activeMatchId != null
                && matchId != null
                && activeMatchId === String(matchId);
        },
        subscribeMatchmaking() {
            matchmakingSubscriptionRequested = true;
            if (isTransportOpen()) subscribeRequestedDestinations(stompClient);
        },
        unsubscribeMatchmaking() {
            matchmakingSubscriptionRequested = false;
            unsubscribe(matchmakingSubscription);
            matchmakingSubscription = null;
        },
        subscribeMatch() {
            matchSubscriptionRequested = true;
            if (isTransportOpen()) subscribeRequestedDestinations(stompClient);
        },
        unsubscribeMatch() {
            matchSubscriptionRequested = false;
            resumeOnConnect = false;
            unsubscribe(matchSubscription);
            unsubscribe(matchChatSubscription);
            matchSubscription = null;
            matchChatSubscription = null;
            activeMatchId = null;
            terminalMatchId = null;
        },
        joinQueue() {
            publish("/app/matchmaking.join");
        },
        resumeMatch() {
            publish("/app/matchmaking.resume");
        },
        resumeWhenConnected() {
            if (autoJoinOnConnect) return;
            client.resumeReconnect();
            resumeOnConnect = true;
            if (isTransportOpen()) {
                client.resumeMatch();
                return;
            }
        },
        acceptMatch(matchId) {
            publish("/app/matchmaking.accept", { matchId });
        },
        async acceptDuelInvite(inviteId) {
            await client.connect();
            const deadline = Date.now() + 10_000;
            while (!isTransportOpen()) {
                if (Date.now() >= deadline) {
                    throw new Error("The notification connection is unavailable.");
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (!publish("/app/matchmaking.acceptInvite", { inviteId })) {
                throw new Error("The duel invite could not be sent.");
            }
        },
        cancelMatch(matchId) {
            publish("/app/matchmaking.cancel", { matchId });
        },
        leaveQueue() {
            publish("/app/matchmaking.leave");
        },
        selectLoadout(selectedLoadout, matchId, roundNumber) {
            publish("/app/matchmaking.selectLoadout", { matchId, roundNumber, selectedLoadout });
        },
        surrender() {
            publish("/app/matchmaking.surrender");
        },
        sendChat(matchId, message) {
            publish("/app/matchmaking.chat", { matchId, message });
        },
        disconnect() {
            connectGeneration += 1;
            stopPeriodicNetworkDelaySampling();
            networkDelaySynchronizer.clear();
            matchmakingSubscriptionRequested = false;
            matchSubscriptionRequested = false;
            unsubscribe(matchmakingSubscription);
            unsubscribe(matchSubscription);
            unsubscribe(matchChatSubscription);
            unsubscribe(notificationSubscription);
            clearTransportSubscriptions();
            activeMatchId = null;
            terminalMatchId = null;
            const activeClient = stompClient;
            stompClient = null;
            connectInFlight = false;
            if (!activeClient) return Promise.resolve();
            return activeClient.deactivate();
        },
    };

    return client;
}

let activeMatchmakingClient = null;

export function getActiveMatchmakingClient(handlers, options = {}) {
    if (!activeMatchmakingClient) {
        activeMatchmakingClient = createMatchmakingClient({
            ...handlers,
            autoReconnect: options.autoReconnect ?? true,
            autoJoinOnConnect: options.autoJoinOnConnect ?? true,
        });
    } else {
        if (options.clearPendingEvents) activeMatchmakingClient.clearPendingEvents?.();
        if (handlers && ("onEvent" in handlers || "onChatEvent" in handlers || "onStatus" in handlers)) {
            activeMatchmakingClient.setHandlers(handlers);
        }
        if (handlers && "onNotification" in handlers) {
            activeMatchmakingClient.setNotificationHandler?.(handlers.onNotification);
        }
    }
    return activeMatchmakingClient;
}

export function forceDisconnectActiveMatchmakingClient(client = activeMatchmakingClient) {
    if (activeMatchmakingClient === client) activeMatchmakingClient = null;
    client?.setNotificationHandler?.(null);
    client?.clearPendingNotifications?.();
    return client?.disconnect?.() ?? Promise.resolve();
}

export function isActiveMatchSocketConnected(matchId) {
    return activeMatchmakingClient?.isConnectedForMatch?.(matchId) === true;
}
