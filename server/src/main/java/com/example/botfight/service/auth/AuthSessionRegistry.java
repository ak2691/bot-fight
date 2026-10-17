package com.example.botfight.service.auth;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionBindingEvent;
import jakarta.servlet.http.HttpSessionBindingListener;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.WeakHashMap;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;

/** Tracks local authenticated sessions so credential changes can revoke them. */
public final class AuthSessionRegistry {
    private static final String BINDING_KEY = AuthSessionRegistry.class.getName() + ".binding";
    private static final Map<HttpSession, UUID> OWNERS = new WeakHashMap<>();
    private static volatile SingleUserWebSocketSessionRegistry webSocketSessions;

    private AuthSessionRegistry() {}

    public static void setWebSocketSessions(SingleUserWebSocketSessionRegistry registry) {
        webSocketSessions = registry;
    }

    public static void register(UUID userId, String principalName, HttpSession session) {
        if (userId == null || session == null) return;
        session.setAttribute(BINDING_KEY, new SessionBinding(session, principalName));
        synchronized (OWNERS) {
            OWNERS.put(session, userId);
        }
    }

    public static void revoke(UUID userId, HttpSession keep) {
        if (userId == null) return;
        List<HttpSession> revoked = new ArrayList<>();
        synchronized (OWNERS) {
            OWNERS.entrySet().removeIf(entry -> {
                if (!userId.equals(entry.getValue()) || entry.getKey() == keep) return false;
                revoked.add(entry.getKey());
                return true;
            });
        }
        for (HttpSession session : revoked) {
            try {
                session.invalidate();
            } catch (IllegalStateException ignored) {
                // An already-invalidated session is revoked.
            }
        }
    }

    public static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()
                && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { action.run(); }
            });
        } else {
            action.run();
        }
    }

    private record SessionBinding(HttpSession session, String principalName) implements HttpSessionBindingListener {
        @Override
        public void valueUnbound(HttpSessionBindingEvent event) {
            synchronized (OWNERS) {
                OWNERS.remove(session);
            }
            if (webSocketSessions != null && principalName != null) {
                webSocketSessions.closeSessionsForPrincipal(principalName);
            }
        }
    }
}
