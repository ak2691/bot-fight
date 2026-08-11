import { useEffect, useRef, useState } from "react";
import {
    disconnectActiveMatchmakingClient,
    getActiveMatchmakingClient,
} from "../../../matchmaking/stompClient";

export default function useMatchmakingSocket({
    clientRef,
    closeSocketAfterChatRef,
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
        }, { autoReconnect: true, autoJoinOnConnect: false });

        clientRef.current = client;
        client.resumeWhenConnected?.();
        if (closeSocketAfterChatRef.current) {
            void disconnectActiveMatchmakingClient(client);
            return undefined;
        }
        void client.connect();

        return () => {
            disposed = true;
            clientRef.current = null;
            client.setHandlers();
            void disconnectActiveMatchmakingClient(client);
        };
    }, [clientRef, closeSocketAfterChatRef]);

    return { socketStatus };
}
