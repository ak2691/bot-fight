package com.example.botfight.service.websocket;

import java.io.IOException;
import java.security.Principal;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/** Tracks the active WebSocket transports associated with each authenticated principal. */
@Service
public class SingleUserWebSocketSessionRegistry {

    public static final int DEFAULT_MAX_SESSIONS_PER_PRINCIPAL = 5;
    public static final String SESSION_LIMIT_CLOSE_REASON =
            "Maximum active WebSocket sessions reached";

    private static final Logger log = LoggerFactory.getLogger(SingleUserWebSocketSessionRegistry.class);
    private static final CloseStatus SESSION_LIMIT_CLOSE_STATUS =
            new CloseStatus(1008, SESSION_LIMIT_CLOSE_REASON);

    private final int maxSessionsPerPrincipal;
    private final ApplicationEventPublisher eventPublisher;
    private final Map<String, Map<String, WebSocketSession>> sessionsByPrincipalName = new HashMap<>();
    private final Map<String, WebSocketSession> sessionsById = new HashMap<>();
    private final Map<String, String> principalNamesBySessionId = new HashMap<>();
    private final Map<String, Principal> principalsBySessionId = new HashMap<>();
    private final Set<String> finalDisconnectsInProgress = new HashSet<>();

    @Autowired
    public SingleUserWebSocketSessionRegistry(
            ApplicationEventPublisher eventPublisher,
            @Value("${botfight.websocket.max-sessions-per-principal:5}") int maxSessionsPerPrincipal) {
        if (maxSessionsPerPrincipal < 1) {
            throw new IllegalArgumentException("Maximum WebSocket sessions per principal must be positive");
        }
        this.eventPublisher = eventPublisher;
        this.maxSessionsPerPrincipal = maxSessionsPerPrincipal;
    }

    /** Compatibility constructor for focused registry tests. */
    public SingleUserWebSocketSessionRegistry() {
        this(null, DEFAULT_MAX_SESSIONS_PER_PRINCIPAL);
    }

    public int maxSessionsPerPrincipal() {
        return maxSessionsPerPrincipal;
    }

    /** Supplies the transport decorator that registers sessions as soon as the WebSocket opens. */
    public WebSocketHandlerDecoratorFactory decoratorFactory() {
        return handler -> new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                if (!registerTransportSession(session)) {
                    closeLimitedSession(session);
                    return;
                }
                try {
                    super.afterConnectionEstablished(session);
                } catch (Exception exception) {
                    publishDisconnect(unregisterSession(session.getId()));
                    throw exception;
                }
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus)
                    throws Exception {
                try {
                    super.afterConnectionClosed(session, closeStatus);
                } finally {
                    publishDisconnect(unregisterSession(session.getId()));
                }
            }
        };
    }

    /** Handles STOMP CONNECT when a transport did not expose its principal at handshake time. */
    @EventListener
    public void handleSessionConnect(SessionConnectEvent event) {
        Principal principal = event.getUser();
        if (principal == null) return;
        String sessionId = StompHeaderAccessor.wrap(event.getMessage()).getSessionId();
        WebSocketSession session;
        synchronized (this) {
            session = sessionsById.get(sessionId);
        }
        if (!registerStompSession(sessionId, principal)) {
            closeLimitedSession(session);
        }
    }

    /** Removes a socket once, and publishes one user-level lifecycle event for that removal. */
    @EventListener
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        if (event == null) return;
        publishDisconnect(unregisterSession(event.getSessionId()));
    }

    boolean registerTransportSession(WebSocketSession session) {
        if (session == null || isBlank(session.getId())) return false;
        Principal principal = session.getPrincipal();
        synchronized (this) {
            if (principal == null || isBlank(principal.getName())) {
                sessionsById.put(session.getId(), session);
                return true;
            }
            boolean associated = associateLocked(session.getId(), principal.getName(), session);
            if (associated) principalsBySessionId.put(session.getId(), principal);
            return associated;
        }
    }

    boolean registerStompSession(String sessionId, Principal principal) {
        if (isBlank(sessionId) || principal == null || isBlank(principal.getName())) return true;
        synchronized (this) {
            WebSocketSession session = sessionsById.get(sessionId);
            if (session == null) return true;
            boolean associated = associateLocked(sessionId, principal.getName(), session);
            if (associated) principalsBySessionId.put(sessionId, principal);
            return associated;
        }
    }

    /** Removes one registered transport and reports whether it was the principal's final socket. */
    public synchronized WebSocketSessionDisconnectedEvent unregisterSession(String sessionId) {
        if (isBlank(sessionId)) return null;
        sessionsById.remove(sessionId);
        Principal principal = principalsBySessionId.remove(sessionId);
        String principalName = principalNamesBySessionId.remove(sessionId);
        if (principalName == null) return null;

        Map<String, WebSocketSession> sessions = sessionsByPrincipalName.get(principalName);
        if (sessions == null) return null;
        sessions.remove(sessionId);
        boolean finalSession = sessions.isEmpty();
        if (finalSession) {
            sessionsByPrincipalName.remove(principalName);
            finalDisconnectsInProgress.add(principalName);
        }
        return new WebSocketSessionDisconnectedEvent(this, principalName, sessionId, finalSession, principal);
    }

    public synchronized String currentSessionIdForPrincipal(String principalName) {
        Map<String, WebSocketSession> sessions = sessionsByPrincipalName.get(principalName);
        return sessions == null || sessions.isEmpty() ? null : sessions.keySet().iterator().next();
    }

    public synchronized Set<String> sessionIdsForPrincipal(String principalName) {
        Map<String, WebSocketSession> sessions = sessionsByPrincipalName.get(principalName);
        return sessions == null ? Set.of() : Set.copyOf(sessions.keySet());
    }

    public synchronized boolean hasActiveSessionForPrincipal(String principalName) {
        Map<String, WebSocketSession> sessions = sessionsByPrincipalName.get(principalName);
        return sessions != null && !sessions.isEmpty();
    }

    private boolean associateLocked(
            String sessionId,
            String principalName,
            WebSocketSession session) {
        if (!awaitFinalDisconnectCompletionLocked(principalName)) return false;
        String currentPrincipal = principalNamesBySessionId.get(sessionId);
        if (principalName.equals(currentPrincipal)) {
            sessionsById.put(sessionId, session);
            if (session.getPrincipal() != null) principalsBySessionId.put(sessionId, session.getPrincipal());
            return true;
        }
        if (currentPrincipal != null) removeAssociationLocked(sessionId, currentPrincipal);

        Map<String, WebSocketSession> sessions = sessionsByPrincipalName.get(principalName);
        if (sessions != null && sessions.containsKey(sessionId)) {
            sessions.put(sessionId, session);
            sessionsById.put(sessionId, session);
            principalNamesBySessionId.put(sessionId, principalName);
            if (session.getPrincipal() != null) principalsBySessionId.put(sessionId, session.getPrincipal());
            return true;
        }
        if (sessions != null && sessions.size() >= maxSessionsPerPrincipal) {
            sessionsById.remove(sessionId);
            principalNamesBySessionId.remove(sessionId);
            return false;
        }

        sessionsByPrincipalName.computeIfAbsent(principalName, ignored -> new HashMap<>())
                .put(sessionId, session);
        sessionsById.put(sessionId, session);
        principalNamesBySessionId.put(sessionId, principalName);
        if (session.getPrincipal() != null) principalsBySessionId.put(sessionId, session.getPrincipal());
        return true;
    }

    private void removeAssociationLocked(String sessionId, String principalName) {
        principalsBySessionId.remove(sessionId);
        Map<String, WebSocketSession> sessions = sessionsByPrincipalName.get(principalName);
        if (sessions == null) return;
        sessions.remove(sessionId);
        if (sessions.isEmpty()) sessionsByPrincipalName.remove(principalName);
    }

    private void publishDisconnect(WebSocketSessionDisconnectedEvent event) {
        if (event == null) return;
        try {
            if (eventPublisher != null) eventPublisher.publishEvent(event);
        } finally {
            if (event.finalSession()) {
                synchronized (this) {
                    finalDisconnectsInProgress.remove(event.principalName());
                    notifyAll();
                }
            }
        }
    }

    private boolean awaitFinalDisconnectCompletionLocked(String principalName) {
        while (finalDisconnectsInProgress.contains(principalName)) {
            try {
                wait();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return true;
    }

    private void closeLimitedSession(WebSocketSession session) {
        if (session == null) return;
        try {
            if (session.isOpen()) session.close(SESSION_LIMIT_CLOSE_STATUS);
        } catch (IOException exception) {
            log.debug("Could not close a WebSocket session rejected by the per-account session cap. sessionId={}",
                    session.getId());
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
