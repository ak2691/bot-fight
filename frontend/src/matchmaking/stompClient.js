import {
    ActivationState,
    Client,
    ReconnectionTimeMode,
    TickerStrategy,
} from "@stomp/stompjs";
import { API_BASE_URL, websocketUrl } from "../config/api";
import { ensureCsrfHeaders } from "../security/csrf";

const MATCHMAKING_DESTINATION = "/user/queue/matchmaking";
const MATCH_CHAT_DESTINATION = "/user/queue/match-chat";
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

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
    let currentStatus = "IDLE";
    const pendingEvents = [];
    const pendingChatEvents = [];

    const deliverEvent = (event) => {
        if (eventHandler) {
            eventHandler(event);
        } else {
            pendingEvents.push(event);
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
            stompClient.onConnect = () => {
                stompClient.subscribe(MATCHMAKING_DESTINATION, (message) => {
                    const event = JSON.parse(message.body);
                    deliverEvent(event);
                });
                stompClient.subscribe(MATCH_CHAT_DESTINATION, (message) => {
                    deliverChatEvent(JSON.parse(message.body));
                });
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
                events.forEach((event) => eventHandler?.(event));
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
        leaveQueue() {
            publish("/app/matchmaking.leave");
        },
        finish(modelSubmissionId) {
            publish("/app/matchmaking.finish", { modelSubmissionId });
        },
        selectClass(selectedClass) {
            publish("/app/matchmaking.selectClass", { selectedClass });
        },
        placeObjects(objects) {
            publish("/app/matchmaking.placeObjects", { objects });
        },
        surrender() {
            publish("/app/matchmaking.surrender");
        },
        sendChat(matchId, message) {
            publish("/app/matchmaking.chat", { matchId, message });
        },
        disconnect() {
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
