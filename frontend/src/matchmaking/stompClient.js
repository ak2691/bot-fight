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
const MATCH_CHAT_DESTINATION = "/user/queue/match-chat";
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_ACCEPTED_NETWORK_DELAY_MS = 1_500;
const NETWORK_DELAY_RESAMPLE_INTERVAL_MS = 30_000;

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
    onStatus,
    autoReconnect = false,
    autoJoinOnConnect = false,
}) {
    let eventHandler = onEvent;
    let chatEventHandler = onChatEvent;
    let statusHandler = onStatus;
    let stompClient = null;
    let connectInFlight = false;
    let connectGeneration = 0;
    let currentStatus = "IDLE";
    let eventDelivery = Promise.resolve();
    let networkDelayIntervalId = null;
    const pendingEvents = [];
    const pendingChatEvents = [];

    const stopPeriodicNetworkDelaySampling = () => {
        if (networkDelayIntervalId == null) return;
        clearInterval(networkDelayIntervalId);
        networkDelayIntervalId = null;
    };

    const startPeriodicNetworkDelaySampling = (generation) => {
        stopPeriodicNetworkDelaySampling();
        networkDelayIntervalId = setInterval(() => {
            if (generation !== connectGeneration || !stompClient?.connected) return;
            void sampleNetworkDelay();
        }, NETWORK_DELAY_RESAMPLE_INTERVAL_MS);
    };

    const deliverEvent = (event, receivedAtMs = monotonicEpochNowMs()) => {
        if (eventHandler) {
            eventDelivery = eventDelivery
                .then(() => eventHandler?.(event, receivedAtMs))
                .catch(() => {
                    updateStatus("ERROR");
                });
        } else {
            pendingEvents.push({ event, receivedAtMs });
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
        if (!stompClient?.connected) return;
        stompClient.publish({
            destination,
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
        });
    };

    const client = {
        async connect() {
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

            stompClient = new Client({
                brokerURL: websocketUrl(),
                connectHeaders: {
                    host: new URL(websocketUrl()).host,
                    ...csrfHeaders,
                },
                connectionTimeout: 10_000,
                reconnectDelay: autoReconnect ? RECONNECT_DELAY_MS : 0,
                reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
                maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
                discardWebsocketOnCommFailure: true,
                heartbeatIncoming: HEARTBEAT_INTERVAL_MS,
                heartbeatOutgoing: HEARTBEAT_INTERVAL_MS,
                heartbeatStrategy: TickerStrategy.Worker,
                debug: () => { },
            });
            stompClient.beforeConnect = async () => {
                try {
                    const refreshedCsrfHeaders =
                        await ensureCsrfHeaders("POST", API_BASE_URL);
                    stompClient.connectHeaders = {
                        host: new URL(websocketUrl()).host,
                        ...refreshedCsrfHeaders,
                    };
                } catch {
                    updateStatus("ERROR");
                }
            };

            stompClient.onChangeState = (state) => {
                if (state === ActivationState.ACTIVE && !stompClient.connected) {
                    updateStatus("CONNECTING");
                }
            };
            stompClient.onConnect = async () => {
                stopPeriodicNetworkDelaySampling();
                networkDelaySynchronizer.clear();
                const initialNetworkDelaySample = sampleNetworkDelay().catch(() => null);
                eventDelivery = eventDelivery.then(() => initialNetworkDelaySample);
                stompClient.subscribe(MATCHMAKING_DESTINATION, (message) => {
                    const event = JSON.parse(message.body);
                    deliverEvent(event, monotonicEpochNowMs());
                });
                stompClient.subscribe(MATCH_CHAT_DESTINATION, (message) => {
                    deliverChatEvent(JSON.parse(message.body));
                });
                await initialNetworkDelaySample;
                if (generation !== connectGeneration || !stompClient?.connected) return;
                startPeriodicNetworkDelaySampling(generation);
                updateStatus("CONNECTED");
                if (autoJoinOnConnect) client.resumeMatch();
            };
            stompClient.onStompError = () => {
                updateStatus("ERROR");
            };
            stompClient.onWebSocketError = () => {
                updateStatus("ERROR");
            };
            stompClient.onWebSocketClose = () => {
                stopPeriodicNetworkDelaySampling();
                updateStatus("CLOSED");
            };

            connectInFlight = false;
            stompClient.activate();
        },
        setHandlers({ onEvent: nextOnEvent, onChatEvent: nextOnChatEvent, onStatus: nextOnStatus } = {}) {
            eventHandler = nextOnEvent;
            chatEventHandler = nextOnChatEvent;
            statusHandler = nextOnStatus;
            if (eventHandler && pendingEvents.length > 0) {
                const events = pendingEvents.splice(0);
                events.forEach(({ event, receivedAtMs }) => deliverEvent(event, receivedAtMs));
            }
            if (chatEventHandler && pendingChatEvents.length > 0) {
                const events = pendingChatEvents.splice(0);
                events.forEach((event) => chatEventHandler?.(event));
            }
            if (eventHandler && stompClient?.connected && autoJoinOnConnect) {
                client.resumeMatch();
            }
        },
        joinQueue() {
            publish("/app/matchmaking.join");
        },
        resumeMatch() {
            publish("/app/matchmaking.resume");
        },
        acceptMatch(matchId) {
            publish("/app/matchmaking.accept", { matchId });
        },
        leaveQueue() {
            publish("/app/matchmaking.leave");
        },
        selectLoadout(selectedLoadout) {
            publish("/app/matchmaking.selectLoadout", { selectedLoadout });
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

export function getActiveMatchmakingClient(handlers) {
    if (!activeMatchmakingClient) {
        activeMatchmakingClient = createMatchmakingClient({
            ...handlers,
            autoReconnect: true,
            autoJoinOnConnect: true,
        });
    } else {
        activeMatchmakingClient.setHandlers(handlers);
    }
    return activeMatchmakingClient;
}

export function disconnectActiveMatchmakingClient(client = activeMatchmakingClient) {
    if (activeMatchmakingClient === client) activeMatchmakingClient = null;
    return client?.disconnect?.() ?? Promise.resolve();
}
