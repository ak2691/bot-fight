package com.example.botfight.service.websocket;

import java.security.Principal;

/** Describes removal of one accepted WebSocket session and whether the principal is now offline. */
public record WebSocketSessionDisconnectedEvent(
        Object source,
        String principalName,
        String sessionId,
        boolean finalSession,
        Principal principal) {
}
