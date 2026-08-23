package com.example.botfight.service.match.connection;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class MatchConnectionService {

    private static final int DISCONNECT_GRACE_SECONDS = 30;

    private final Clock clock;
    private final Map<UUID, String> activeSocketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, String> pendingDisconnectSocketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, Instant> disconnectDeadlinesByUserId = new HashMap<>();
    private final Set<UUID> pausedDisconnectUserIds = new HashSet<>();

    public MatchConnectionService(Clock clock) {
        this.clock = clock;
    }

    public synchronized void registerSocket(UUID userId, String socketSessionId) {
        if (socketSessionId != null && !socketSessionId.isBlank()) {
            activeSocketSessionIdsByUserId.put(userId, socketSessionId);
        }
    }

    public synchronized Instant reconnect(UUID userId, String socketSessionId) {
        registerSocket(userId, socketSessionId);
        pendingDisconnectSocketSessionIdsByUserId.remove(userId);
        pausedDisconnectUserIds.remove(userId);
        return disconnectDeadlinesByUserId.remove(userId);
    }

    public synchronized boolean deferDisconnect(UUID userId, String socketSessionId) {
        if (disconnectDeadlinesByUserId.containsKey(userId)
                || pausedDisconnectUserIds.contains(userId)) {
            return false;
        }
        String activeSocketSessionId = activeSocketSessionIdsByUserId.get(userId);
        if (socketSessionId != null && !socketSessionId.equals(activeSocketSessionId)) {
            return false;
        }

        if (socketSessionId == null) {
            activeSocketSessionIdsByUserId.remove(userId);
        } else {
            activeSocketSessionIdsByUserId.remove(userId, socketSessionId);
        }
        pendingDisconnectSocketSessionIdsByUserId.put(userId, socketSessionId);
        return true;
    }

    public synchronized boolean pauseDisconnectForReplay(UUID userId) {
        Instant deadline = disconnectDeadlinesByUserId.remove(userId);
        if (deadline == null) return false;
        pausedDisconnectUserIds.add(userId);
        return true;
    }

    public synchronized boolean hasDeferredDisconnect(UUID userId) {
        return pendingDisconnectSocketSessionIdsByUserId.containsKey(userId);
    }

    public synchronized Instant startDeferredDisconnect(UUID userId) {
        if (!pendingDisconnectSocketSessionIdsByUserId.containsKey(userId)) {
            return null;
        }
        pendingDisconnectSocketSessionIdsByUserId.remove(userId);
        Instant deadline = Instant.now(clock).plusSeconds(DISCONNECT_GRACE_SECONDS);
        disconnectDeadlinesByUserId.put(userId, deadline);
        return deadline;
    }

    public synchronized Instant resumePausedDisconnect(UUID userId) {
        if (!pausedDisconnectUserIds.remove(userId)) return null;
        Instant deadline = Instant.now(clock).plusSeconds(DISCONNECT_GRACE_SECONDS);
        disconnectDeadlinesByUserId.put(userId, deadline);
        return deadline;
    }

    public synchronized Instant beginDisconnect(UUID userId, String socketSessionId) {
        if (disconnectDeadlinesByUserId.containsKey(userId)) {
            return null;
        }
        String activeSocketSessionId = activeSocketSessionIdsByUserId.get(userId);
        if (socketSessionId != null && !socketSessionId.equals(activeSocketSessionId)) {
            return null;
        }

        if (socketSessionId == null) {
            activeSocketSessionIdsByUserId.remove(userId);
        } else {
            activeSocketSessionIdsByUserId.remove(userId, socketSessionId);
        }
        pendingDisconnectSocketSessionIdsByUserId.remove(userId);
        pausedDisconnectUserIds.remove(userId);
        Instant deadline = Instant.now(clock).plusSeconds(DISCONNECT_GRACE_SECONDS);
        disconnectDeadlinesByUserId.put(userId, deadline);
        return deadline;
    }

    public synchronized Instant disconnectDeadline(UUID userId) {
        return disconnectDeadlinesByUserId.get(userId);
    }

    public synchronized boolean isDisconnected(UUID userId) {
        return disconnectDeadlinesByUserId.containsKey(userId);
    }

    public synchronized void clear(UUID userId) {
        activeSocketSessionIdsByUserId.remove(userId);
        pendingDisconnectSocketSessionIdsByUserId.remove(userId);
        disconnectDeadlinesByUserId.remove(userId);
        pausedDisconnectUserIds.remove(userId);
    }
}
