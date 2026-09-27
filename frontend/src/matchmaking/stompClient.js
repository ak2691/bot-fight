import {
    ActivationState,
    Client,
    ReconnectionTimeMode,
    TickerStrategy,
} from "@stomp/stompjs";
import { API_BASE_URL, apiUrl, websocketUrl } from "../config/api.js";
import {
    AUTH_SESSION_INVALID,
    dispatchAuthenticationLoss,
    probeCurrentAuthentication,
} from "../auth/authSession.js";
import { ensureCsrfHeaders } from "../security/csrf.js";
import {
    createNetworkDelaySynchronizer,
    estimatedOneWayNetworkDelayMs,
    monotonicEpochNowMs,
    requestBestNetworkDelaySample,
} from "./networkDelayEstimator.js";

const MATCHMAKING_DESTINATION = "/user/queue/matchmaking";
const MATCH_DESTINATION = "/user/queue/match";
const MATCH_CHAT_DESTINATION = "/user/queue/match-chat";
const NOTIFICATION_DESTINATION = "/user/queue/notifications";
const PARTY_DESTINATION = "/user/queue/party";
const CUSTOM_LOBBY_DESTINATION = "/user/queue/custom-lobby";
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const REPLACED_CONNECTION_REASON = "Replaced by a newer connection";
const SESSION_LIMIT_CLOSE_REASON = "Maximum active WebSocket sessions reached";
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
    onPartyEvent,
    onCustomLobbyEvent,
    onStatus,
    autoReconnect = false,
    autoJoinOnConnect = false,
    allowNotificationSubscription = true,
    transportFactory = (configuration) => new Client(configuration),
    csrfHeadersProvider = ensureCsrfHeaders,
    websocketUrlProvider = websocketUrl,
    authenticationProbe = () => probeCurrentAuthentication({
        fetchImpl: globalThis.fetch,
        url: apiUrl("/api/auth/me"),
    }),
    onAuthenticationLost = dispatchAuthenticationLoss,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
}) {
    let eventHandler = onEvent;
    let chatEventHandler = onChatEvent;
    let notificationHandler = onNotification;
    let partyEventHandler = onPartyEvent;
    let customLobbyEventHandler = onCustomLobbyEvent;
    let statusHandler = onStatus;
    let stompClient = null;
    let connectInFlight = false;
    let connectGeneration = 0;
    let socketAttemptGeneration = 0;
    let currentStatus = "IDLE";
    let eventDelivery = Promise.resolve();
    let networkDelayIntervalId = null;
    let resumeOnConnect = false;
    let reconnectEnabled = autoReconnect;
    let terminallyStopped = false;
    let bootstrapRetryTimer = null;
    let bootstrapRetryDelayMs = RECONNECT_DELAY_MS;
    let authenticationProbeInFlight = null;
    // The match subscriptions share this transport, so transport connectivity
    // alone is not evidence that the user has a live match to resume.
    let activeMatchId = null;
    let terminalMatchId = null;
    let matchmakingSubscriptionRequested = false;
    let matchSubscriptionRequested = false;
    let partySubscriptionRequested = false;
    let customLobbySubscriptionRequested = false;
    let notificationSubscriptionEnabled = allowNotificationSubscription;
    let matchmakingSubscription = null;
    let matchSubscription = null;
    let matchChatSubscription = null;
    let notificationSubscription = null;
    let partySubscription = null;
    let customLobbySubscription = null;
    const pendingEvents = [];
    const pendingChatEvents = [];
    const pendingNotifications = [];
    const pendingPartyEvents = [];
    const pendingCustomLobbyEvents = [];

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

    const deliverPartyEvent = (event) => {
        if (partyEventHandler) {
            partyEventHandler(event);
        } else {
            pendingPartyEvents.push(event);
            if (pendingPartyEvents.length > 100) pendingPartyEvents.shift();
        }
    };

    const deliverCustomLobbyEvent = (event) => {
        if (customLobbyEventHandler) {
            customLobbyEventHandler(event);
        } else {
            pendingCustomLobbyEvents.push(event);
            if (pendingCustomLobbyEvents.length > 100) pendingCustomLobbyEvents.shift();
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
        partySubscription = null;
        customLobbySubscription = null;
    };

    const clearPendingReconnectState = () => {
        resumeOnConnect = false;
        activeMatchId = null;
        terminalMatchId = null;
        pendingEvents.splice(0);
        pendingChatEvents.splice(0);
        pendingNotifications.splice(0);
        pendingPartyEvents.splice(0);
        pendingCustomLobbyEvents.splice(0);
    };

    const isCurrentProbeContext = (context) => (
        context.generation === connectGeneration
        && context.transport === stompClient
    );

    const stopTerminalTransport = (context, status, authenticationLost = false) => {
        if (!isCurrentProbeContext(context)) return false;
        terminallyStopped = true;
        reconnectEnabled = false;
        connectInFlight = false;
        if (bootstrapRetryTimer != null) {
            clearTimeoutImpl(bootstrapRetryTimer);
            bootstrapRetryTimer = null;
        }
        if (context.transport) context.transport.reconnectDelay = 0;
        if (stompClient === context.transport) stompClient = null;
        connectGeneration += 1;
        socketAttemptGeneration += 1;
        stopPeriodicNetworkDelaySampling();
        networkDelaySynchronizer.clear();
        matchmakingSubscriptionRequested = false;
        matchSubscriptionRequested = false;
        partySubscriptionRequested = false;
        customLobbySubscriptionRequested = false;
        unsubscribe(matchmakingSubscription);
        unsubscribe(matchSubscription);
        unsubscribe(matchChatSubscription);
        unsubscribe(notificationSubscription);
        unsubscribe(partySubscription);
        unsubscribe(customLobbySubscription);
        clearTransportSubscriptions();
        clearPendingReconnectState();
        updateStatus(status);
        if (context.transport) {
            try {
                Promise.resolve(context.transport.deactivate()).catch(() => {});
            } catch {
                // A closing transport may reject deactivation synchronously.
            }
        }
        if (authenticationLost) {
            try {
                onAuthenticationLost?.();
            } catch {
                // Auth state listeners are isolated from transport cleanup.
            }
        }
        return true;
    };

    const scheduleBootstrapRetry = (context) => {
        if (!reconnectEnabled || terminallyStopped || bootstrapRetryTimer != null
                || !isCurrentProbeContext(context)) return;
        const delay = bootstrapRetryDelayMs;
        bootstrapRetryDelayMs = Math.min(bootstrapRetryDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        bootstrapRetryTimer = setTimeoutImpl(() => {
            bootstrapRetryTimer = null;
            if (terminallyStopped
                    || !reconnectEnabled
                    || context.generation !== connectGeneration
                    || stompClient !== null) return;
            void client.connect();
        }, delay);
    };

    const probeForAuthenticationLoss = (context, onTemporaryFailure = null) => {
        const contextKey = `${context.generation}:${context.attemptGeneration}`;
        let probe = authenticationProbeInFlight;
        if (!probe) {
            probe = { contexts: new Map() };
            authenticationProbeInFlight = probe;
            probe.promise = Promise.resolve()
                .then(() => authenticationProbe())
                .catch(() => null)
                .then((result) => {
                    const currentContexts = [...probe.contexts.values()]
                        .filter((entry) => isCurrentProbeContext(entry.context));
                    if (result === AUTH_SESSION_INVALID) {
                        const current = currentContexts[0];
                        if (current) stopTerminalTransport(
                            current.context,
                            "AUTHENTICATION_LOST",
                            true,
                        );
                        return;
                    }
                    currentContexts.forEach((entry) => entry.onTemporaryFailure?.());
                })
                .finally(() => {
                    if (authenticationProbeInFlight === probe) {
                        authenticationProbeInFlight = null;
                    }
                });
        }
        probe.contexts.set(contextKey, { context, onTemporaryFailure });
        return probe.promise;
    };

    const subscribeRequestedDestinations = (transport) => {
        if (!transport?.connected) return;

        if (notificationSubscriptionEnabled && !notificationSubscription) {
            notificationSubscription = transport.subscribe(
                NOTIFICATION_DESTINATION,
                (message) => deliverNotification(JSON.parse(message.body)),
            );
        } else if (!notificationSubscriptionEnabled && notificationSubscription) {
            unsubscribe(notificationSubscription);
            notificationSubscription = null;
        }

        if (partySubscriptionRequested && !partySubscription) {
            partySubscription = transport.subscribe(
                PARTY_DESTINATION,
                (message) => deliverPartyEvent(JSON.parse(message.body)),
            );
        }

        if (customLobbySubscriptionRequested && !customLobbySubscription) {
            customLobbySubscription = transport.subscribe(
                CUSTOM_LOBBY_DESTINATION,
                (message) => deliverCustomLobbyEvent(JSON.parse(message.body)),
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
            if (terminallyStopped) {
                statusHandler?.(currentStatus);
                return;
            }
            // STOMP marks a client active while it is connecting or waiting to
            // reconnect. A route handoff must not replace that transport just
            // because the handshake has not completed yet.
            if (connectInFlight || stompClient?.active) {
                statusHandler?.(currentStatus);
                return;
            }

            const generation = ++connectGeneration;
            const attemptGeneration = ++socketAttemptGeneration;
            connectInFlight = true;
            updateStatus("CONNECTING");

            let csrfHeaders;
            try {
                csrfHeaders = await csrfHeadersProvider("POST", API_BASE_URL);
            } catch {
                if (generation !== connectGeneration || terminallyStopped) return;
                connectInFlight = false;
                updateStatus("ERROR");
                const context = { generation, transport: null, attemptGeneration };
                probeForAuthenticationLoss(context, () => scheduleBootstrapRetry(context));
                return;
            }
            if (generation !== connectGeneration || terminallyStopped) {
                connectInFlight = false;
                return;
            }

            const transport = transportFactory({
                brokerURL: websocketUrlProvider(),
                connectHeaders: {
                    host: new URL(websocketUrlProvider()).host,
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
                const attempt = ++socketAttemptGeneration;
                try {
                    const refreshedCsrfHeaders = await csrfHeadersProvider("POST", API_BASE_URL);
                    if (!isCurrentTransport()) return;
                    transport.connectHeaders = {
                        host: new URL(websocketUrlProvider()).host,
                        ...refreshedCsrfHeaders,
                    };
                } catch {
                    updateStatus("ERROR");
                    // STOMP owns the reconnect schedule once a transport exists.
                    // Its subsequent ERROR/close callback probes the session.
                    if (attempt !== socketAttemptGeneration) return;
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
                bootstrapRetryDelayMs = RECONNECT_DELAY_MS;
                if (bootstrapRetryTimer != null) {
                    clearTimeoutImpl(bootstrapRetryTimer);
                    bootstrapRetryTimer = null;
                }
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
                probeForAuthenticationLoss({
                    generation,
                    transport,
                    attemptGeneration: socketAttemptGeneration,
                });
            };
            transport.onWebSocketError = () => {
                if (!isCurrentTransport()) return;
                updateStatus("ERROR");
                probeForAuthenticationLoss({
                    generation,
                    transport,
                    attemptGeneration: socketAttemptGeneration,
                });
            };
            transport.onWebSocketClose = (event) => {
                if (!isCurrentTransport()) return;
                stopPeriodicNetworkDelaySampling();
                clearTransportSubscriptions();
                updateStatus("CLOSED");
                const context = {
                    generation,
                    transport,
                    attemptGeneration: socketAttemptGeneration,
                };
                if (event?.code === 1000 && event?.reason === REPLACED_CONNECTION_REASON) {
                    stopTerminalTransport(context, "CLOSED");
                    return;
                }
                if (event?.code === 1008 && event?.reason === SESSION_LIMIT_CLOSE_REASON) {
                    stopTerminalTransport(context, "SESSION_LIMIT_REACHED");
                    return;
                }
                probeForAuthenticationLoss(context);
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
        setNotificationSubscriptionEnabled(enabled) {
            notificationSubscriptionEnabled = enabled !== false;
            if (!notificationSubscriptionEnabled) {
                unsubscribe(notificationSubscription);
                notificationSubscription = null;
                return;
            }
            if (isTransportOpen()) subscribeRequestedDestinations(stompClient);
        },
        setPartyHandler(nextHandler) {
            partyEventHandler = nextHandler;
            if (partyEventHandler && pendingPartyEvents.length > 0) {
                const events = pendingPartyEvents.splice(0);
                events.forEach((event) => partyEventHandler?.(event));
            }
        },
        setCustomLobbyHandler(nextHandler) {
            customLobbyEventHandler = nextHandler;
            if (customLobbyEventHandler && pendingCustomLobbyEvents.length > 0) {
                const events = pendingCustomLobbyEvents.splice(0);
                events.forEach((event) => customLobbyEventHandler?.(event));
            }
        },
        clearPendingPartyEvents() {
            pendingPartyEvents.splice(0);
        },
        clearPendingCustomLobbyEvents() {
            pendingCustomLobbyEvents.splice(0);
        },
        clearPendingNotifications() {
            pendingNotifications.splice(0);
        },
        resumeReconnect() {
            if (terminallyStopped) return;
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
        subscribeParty() {
            partySubscriptionRequested = true;
            if (isTransportOpen()) subscribeRequestedDestinations(stompClient);
        },
        unsubscribeParty() {
            partySubscriptionRequested = false;
            unsubscribe(partySubscription);
            partySubscription = null;
        },
        subscribeCustomLobby() {
            customLobbySubscriptionRequested = true;
            if (isTransportOpen()) subscribeRequestedDestinations(stompClient);
        },
        unsubscribeCustomLobby() {
            customLobbySubscriptionRequested = false;
            unsubscribe(customLobbySubscription);
            customLobbySubscription = null;
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
        joinQueue(mode = "ONES", guaranteedAbilityIds = []) {
            publish("/app/matchmaking.join", {
                mode,
                guaranteedAbilityIds: Array.isArray(guaranteedAbilityIds)
                    ? guaranteedAbilityIds.slice(0, 3)
                    : [],
            });
        },
        resumeMatch() {
            publish("/app/matchmaking.resume");
        },
        resumeQueue() {
            publish("/app/matchmaking.resumeQueue");
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
        requestCodeView(matchId, targetUserId, roundNumber) {
            publish("/app/matchmaking.codeView.request", {
                matchId,
                targetUserId,
                roundNumber,
            });
        },
        respondToCodeView(requestId, matchId, targetUserId, roundNumber, brain, selectedLoadout) {
            publish("/app/matchmaking.codeView.response", {
                requestId,
                matchId,
                targetUserId,
                roundNumber,
                brain,
                selectedLoadout,
            });
        },
        sendChat(matchId, message, channel = "ALL") {
            return publish("/app/matchmaking.chat", { matchId, message, channel });
        },
        sendCustomLobbyChat(lobbyId, message) {
            return publish("/app/custom-lobby.chat", { lobbyId, message });
        },
        disconnect() {
            connectGeneration += 1;
            socketAttemptGeneration += 1;
            stopPeriodicNetworkDelaySampling();
            if (bootstrapRetryTimer != null) {
                clearTimeoutImpl(bootstrapRetryTimer);
                bootstrapRetryTimer = null;
            }
            networkDelaySynchronizer.clear();
            matchmakingSubscriptionRequested = false;
            matchSubscriptionRequested = false;
            partySubscriptionRequested = false;
            customLobbySubscriptionRequested = false;
            unsubscribe(matchmakingSubscription);
            unsubscribe(matchSubscription);
            unsubscribe(matchChatSubscription);
            unsubscribe(notificationSubscription);
            unsubscribe(partySubscription);
            unsubscribe(customLobbySubscription);
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
let activeMatchmakingIdentityKey = null;

export function getActiveMatchmakingClient(handlers, options = {}) {
    const hasIdentityKey = Object.prototype.hasOwnProperty.call(options, "identityKey");
    if (activeMatchmakingClient
        && hasIdentityKey
        && activeMatchmakingIdentityKey !== options.identityKey) {
        const previousClient = activeMatchmakingClient;
        activeMatchmakingClient = null;
        activeMatchmakingIdentityKey = null;
        void previousClient.disconnect?.();
    }
    if (!activeMatchmakingClient) {
        activeMatchmakingClient = createMatchmakingClient({
            ...handlers,
            autoReconnect: options.autoReconnect ?? true,
            autoJoinOnConnect: options.autoJoinOnConnect ?? true,
            allowNotificationSubscription: options.allowNotificationSubscription ?? true,
        });
        activeMatchmakingIdentityKey = hasIdentityKey ? options.identityKey : null;
    } else {
        if (options.clearPendingEvents) activeMatchmakingClient.clearPendingEvents?.();
        if (Object.prototype.hasOwnProperty.call(options, "allowNotificationSubscription")) {
            activeMatchmakingClient.setNotificationSubscriptionEnabled?.(
                options.allowNotificationSubscription,
            );
        }
        if (handlers && ("onEvent" in handlers || "onChatEvent" in handlers || "onStatus" in handlers)) {
            activeMatchmakingClient.setHandlers(handlers);
        }
        if (handlers && "onNotification" in handlers) {
            activeMatchmakingClient.setNotificationHandler?.(handlers.onNotification);
        }
        if (handlers && "onPartyEvent" in handlers) {
            activeMatchmakingClient.setPartyHandler?.(handlers.onPartyEvent);
        }
        if (handlers && "onCustomLobbyEvent" in handlers) {
            activeMatchmakingClient.setCustomLobbyHandler?.(handlers.onCustomLobbyEvent);
        }
    }
    return activeMatchmakingClient;
}

export function forceDisconnectActiveMatchmakingClient(client = activeMatchmakingClient) {
    if (activeMatchmakingClient === client) {
        activeMatchmakingClient = null;
        activeMatchmakingIdentityKey = null;
    }
    client?.setNotificationHandler?.(null);
    client?.clearPendingNotifications?.();
    client?.setPartyHandler?.(null);
    client?.clearPendingPartyEvents?.();
    client?.setCustomLobbyHandler?.(null);
    client?.clearPendingCustomLobbyEvents?.();
    return client?.disconnect?.() ?? Promise.resolve();
}

export function isActiveMatchSocketConnected(matchId) {
    return activeMatchmakingClient?.isConnectedForMatch?.(matchId) === true;
}
