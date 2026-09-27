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
    private final Map<UUID, Set<String>> activeSocketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, String> pendingDisconnectSocketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, Instant> disconnectDeadlinesByUserId = new HashMap<>();
    private final Set<UUID> pausedDisconnectUserIds = new HashSet<>();

    public MatchConnectionService(Clock clock) {
        this.clock = clock;
    }

    public synchronized void registerSocket(UUID userId, String socketSessionId) {
        if (userId != null && socketSessionId != null && !socketSessionId.isBlank()) {
            activeSocketSessionIdsByUserId.computeIfAbsent(userId, ignored -> new HashSet<>())
                    .add(socketSessionId);
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
        Set<String> activeSocketSessionIds = activeSocketSessionIdsByUserId.get(userId);
        removeSocketLocked(userId, socketSessionId);
        if (activeSocketSessionIds != null && !activeSocketSessionIds.isEmpty()) return false;
        pendingDisconnectSocketSessionIdsByUserId.put(userId, socketSessionId);
        return true;
    }

    /** Removes a closed tab without starting a match disconnect while another tab remains. */
    public synchronized boolean unregisterSocket(UUID userId, String socketSessionId) {
        if (userId == null || socketSessionId == null || socketSessionId.isBlank()) return false;
        removeSocketLocked(userId, socketSessionId);
        Set<String> remaining = activeSocketSessionIdsByUserId.get(userId);
        return remaining == null || remaining.isEmpty();
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
        removeSocketLocked(userId, socketSessionId);
        Set<String> activeSocketSessionIds = activeSocketSessionIdsByUserId.get(userId);
        if (activeSocketSessionIds != null && !activeSocketSessionIds.isEmpty()) return null;
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

    private void removeSocketLocked(UUID userId, String socketSessionId) {
        if (userId == null) return;
        Set<String> active = activeSocketSessionIdsByUserId.get(userId);
        if (active == null) return;
        if (socketSessionId == null) active.clear();
        else active.remove(socketSessionId);
        if (active.isEmpty()) activeSocketSessionIdsByUserId.remove(userId);
    }
}
