package com.example.botfight.service;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class MatchConnectionService {

    private static final int DISCONNECT_GRACE_SECONDS = 30;

    private final Clock clock;
    private final Map<UUID, String> activeSocketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, Instant> disconnectDeadlinesByUserId = new HashMap<>();

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
        return disconnectDeadlinesByUserId.remove(userId);
    }

    public synchronized Instant beginDisconnect(UUID userId, String socketSessionId) {
        String activeSocketSessionId = activeSocketSessionIdsByUserId.get(userId);
        if (socketSessionId != null && !socketSessionId.equals(activeSocketSessionId)) {
            return null;
        }

        if (socketSessionId == null) {
            activeSocketSessionIdsByUserId.remove(userId);
        } else {
            activeSocketSessionIdsByUserId.remove(userId, socketSessionId);
        }
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
        disconnectDeadlinesByUserId.remove(userId);
    }
}
