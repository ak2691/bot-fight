package com.example.botfight.service.websocket;

import java.io.IOException;
import java.security.Principal;
import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;

/**
 * Keeps one live transport session per authenticated principal.
 *
 * <p>The matchmaking connection bookkeeping is intentionally separate from this registry. A
 * connection can be opened before it joins a queue or resumes a match, so duplicate transport
 * sessions must be handled at the WebSocket layer rather than only in match services.</p>
 */
@Service
public class SingleUserWebSocketSessionRegistry {

    private static final Logger log = LoggerFactory.getLogger(SingleUserWebSocketSessionRegistry.class);
    private static final CloseStatus REPLACED_CLOSE_STATUS =
            new CloseStatus(1000, "Replaced by a newer connection");

    private final Map<String, WebSocketSession> sessionsByPrincipalName = new HashMap<>();
    private final Map<String, WebSocketSession> sessionsById = new HashMap<>();
    private final Map<String, String> principalNamesBySessionId = new HashMap<>();

    /**
     * Supplies the transport decorator that registers the session as soon as the WebSocket opens.
     */
    public WebSocketHandlerDecoratorFactory decoratorFactory() {
        return handler -> new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                registerTransportSession(session);
                try {
                    super.afterConnectionEstablished(session);
                } catch (Exception exception) {
                    unregister(session);
                    throw exception;
                }
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus)
                    throws Exception {
                try {
                    super.afterConnectionClosed(session, closeStatus);
                } finally {
                    unregister(session);
                }
            }
        };
    }

    /**
     * Handles the STOMP-level CONNECT as a fallback for transports whose WebSocket session does
     * not expose the authenticated principal until the sub-protocol handshake.
     */
    @EventListener
    public void handleSessionConnect(SessionConnectEvent event) {
        Principal principal = event.getUser();
        if (principal == null) {
            return;
        }
        String sessionId = StompHeaderAccessor.wrap(event.getMessage()).getSessionId();
        registerStompSession(sessionId, principal);
    }

    void registerTransportSession(WebSocketSession session) {
        if (session == null || isBlank(session.getId())) {
            return;
        }
        Principal principal = session.getPrincipal();
        WebSocketSession replaced;
        synchronized (this) {
            sessionsById.put(session.getId(), session);
            replaced = associateLocked(
                    session.getId(),
                    principal == null ? null : principal.getName(),
                    session);
        }
        closeReplacedSession(replaced, session.getId());
    }

    void registerStompSession(String sessionId, Principal principal) {
        if (isBlank(sessionId) || principal == null || isBlank(principal.getName())) {
            return;
        }
        WebSocketSession replaced;
        synchronized (this) {
            WebSocketSession session = sessionsById.get(sessionId);
            replaced = associateLocked(sessionId, principal.getName(), session);
        }
        closeReplacedSession(replaced, sessionId);
    }

    synchronized void unregister(WebSocketSession session) {
        if (session == null || isBlank(session.getId())) {
            return;
        }
        String sessionId = session.getId();
        sessionsById.remove(sessionId, session);
        String principalName = principalNamesBySessionId.remove(sessionId);
        if (principalName == null) {
            return;
        }
        WebSocketSession current = sessionsByPrincipalName.get(principalName);
        if (sameSession(current, sessionId)) {
            sessionsByPrincipalName.remove(principalName);
        }
    }

    public synchronized String currentSessionIdForPrincipal(String principalName) {
        if (isBlank(principalName)) {
            return null;
        }
        WebSocketSession session = sessionsByPrincipalName.get(principalName);
        return session == null ? null : session.getId();
    }

    private WebSocketSession associateLocked(
            String sessionId,
            String principalName,
            WebSocketSession session) {
        if (isBlank(principalName)) {
            return null;
        }

        WebSocketSession previous = sessionsByPrincipalName.get(principalName);
        if (sameSession(previous, sessionId)) {
            principalNamesBySessionId.put(sessionId, principalName);
            return null;
        }

        if (previous != null) {
            sessionsById.remove(previous.getId(), previous);
            principalNamesBySessionId.remove(previous.getId());
        }

        if (session == null) {
            sessionsByPrincipalName.remove(principalName);
        } else {
            sessionsByPrincipalName.put(principalName, session);
            sessionsById.put(sessionId, session);
        }
        principalNamesBySessionId.put(sessionId, principalName);
        return previous;
    }

    private void closeReplacedSession(WebSocketSession replaced, String replacementSessionId) {
        if (replaced == null || sameSession(replaced, replacementSessionId)) {
            return;
        }
        try {
            if (replaced.isOpen()) {
                replaced.close(REPLACED_CLOSE_STATUS);
            }
        } catch (IOException exception) {
            log.warn("Could not close a replaced WebSocket session. sessionId={}",
                    replaced.getId(),
                    exception);
        }
    }

    private static boolean sameSession(WebSocketSession session, String sessionId) {
        return session != null && sessionId != null && sessionId.equals(session.getId());
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
