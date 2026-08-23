import { useEffect, useRef, useState } from "react";
import { getActiveMatchmakingClient } from "../../../matchmaking/stompClient";

export default function useMatchmakingSocket({
    clientRef,
    onEvent,
    onChatEvent,
    onStatus,
}) {
    const callbackRef = useRef({ onEvent, onChatEvent, onStatus });
    const [socketStatus, setSocketStatus] = useState("IDLE");

    useEffect(() => {
        callbackRef.current = { onEvent, onChatEvent, onStatus };
    }, [onEvent, onChatEvent, onStatus]);

    useEffect(() => {
        let disposed = false;
        const client = getActiveMatchmakingClient({
            onEvent: (...args) => {
                if (!disposed) callbackRef.current.onEvent?.(...args);
            },
            onChatEvent: (event) => {
                if (!disposed) callbackRef.current.onChatEvent?.(event);
            },
            onStatus: (status) => {
                if (disposed) return;
                setSocketStatus(status);
                callbackRef.current.onStatus?.(status);
            },
        }, { autoReconnect: true, autoJoinOnConnect: false, clearPendingEvents: true });

        clientRef.current = client;
        client.resumeReconnect?.();
        client.clearPendingEvents?.();
        client.subscribeMatch?.();
        client.resumeWhenConnected?.();
        void client.connect();

        return () => {
            disposed = true;
            clientRef.current = null;
            client.unsubscribeMatch?.();
            client.setHandlers();
            client.clearPendingEvents?.();
            // This is a route-level consumer of a shared client. StrictMode and
            // route handoffs may run this cleanup while the session is active;
            // leave transport lifetime and notification reconnects to the
            // notification owner.
        };
    }, [clientRef]);

    return { socketStatus };
}
