package com.example.botfight.service;

import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchmakingPlayerDTO;
import com.example.botfight.service.MatchService.MatchEntrant;
import com.example.botfight.service.MatchService.OutboundMatchmakingEvent;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class MatchmakingService {

    private static final int ROUND_LOGIC_BLOCK_LIMIT = 100;

    private final MatchService matchService;
    private final Clock clock;
    private final List<QueuedPlayer> queue = new ArrayList<>();

    public MatchmakingService(MatchService matchService, Clock clock) {
        this.matchService = matchService;
        this.clock = clock;
    }

    public synchronized List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName) {
        return joinQueue(userId, username, principalName, null);
    }

    public synchronized List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        if (matchService.activeMatchStatus(userId).activeMatch()) {
            throw new AuthException(
                    "An active match already exists. Return to it instead.");
        }
        QueuedPlayer player = new QueuedPlayer(
                userId,
                username,
                principalName,
                socketSessionId);
        int existingIndex = queuedPlayerIndex(userId);
        if (existingIndex >= 0) {
            queue.set(existingIndex, player);
            return List.of(waitingEvent(player));
        }
        if (queue.isEmpty()) {
            queue.add(player);
            return List.of(waitingEvent(player));
        }

        QueuedPlayer opponent = queue.removeFirst();
        return matchService.startMatch(opponent.toMatchEntrant(), player.toMatchEntrant());
    }

    public synchronized void leaveQueue(UUID userId) {
        queue.removeIf(player -> player.userId().equals(userId));
    }

    public synchronized void removeDisconnected(
            String principalName,
            String socketSessionId) {
        queue.removeIf(player -> player.principalName().equals(principalName)
                && (socketSessionId == null
                        || player.socketSessionId() == null
                        || player.socketSessionId().equals(socketSessionId)));
    }

    private int queuedPlayerIndex(UUID userId) {
        for (int index = 0; index < queue.size(); index++) {
            if (queue.get(index).userId().equals(userId)) {
                return index;
            }
        }
        return -1;
    }

    private OutboundMatchmakingEvent waitingEvent(QueuedPlayer player) {
        return new OutboundMatchmakingEvent(
                player.principalName(),
                new MatchmakingEventDTO(
                        "QUEUE_WAITING",
                        null,
                        null,
                        "WAITING",
                        new MatchmakingPlayerDTO(
                                player.userId(),
                                player.username(),
                                1,
                                false,
                                0,
                                "melee",
                                false),
                        null,
                        List.of(),
                        Instant.now(clock),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        null,
                        null,
                        null,
                        null,
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        ROUND_LOGIC_BLOCK_LIMIT));
    }

    private record QueuedPlayer(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {

        private MatchEntrant toMatchEntrant() {
            return new MatchEntrant(
                    userId,
                    username,
                    principalName,
                    socketSessionId);
        }
    }
}
