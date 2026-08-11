package com.example.botfight.service;

import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchmakingPlayerDTO;
import com.example.botfight.service.MatchService.MatchEntrant;
import com.example.botfight.service.MatchService.OutboundMatchmakingEvent;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class MatchmakingService {

    private static final int ROUND_LOGIC_BLOCK_LIMIT = 100;
    private static final int MATCH_ACCEPTANCE_SECONDS = 20;
    private static final int SUBMISSION_GRACE_SECONDS = 2;

    private final MatchService matchService;
    private final Clock clock;
    private final MatchmakingRateLimiter matchmakingRateLimiter;
    private final List<QueuedPlayer> queue = new ArrayList<>();
    private final Map<UUID, PendingMatch> pendingMatchesById = new HashMap<>();

    public MatchmakingService(
            MatchService matchService,
            Clock clock,
            MatchmakingRateLimiter matchmakingRateLimiter) {
        this.matchService = matchService;
        this.clock = clock;
        this.matchmakingRateLimiter = matchmakingRateLimiter;
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
        if (pendingMatchForUser(userId) != null) {
            throw new AuthException(
                    "A match is waiting for your acceptance. Return to it instead.");
        }
        matchmakingRateLimiter.requireAllowed(userId);
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
        return createPendingMatch(opponent.toMatchEntrant(), player.toMatchEntrant());
    }

    public synchronized void leaveQueue(UUID userId) {
        queue.removeIf(player -> player.userId().equals(userId));
    }

    public synchronized void removeDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) {
            return;
        }
        queue.removeIf(player -> player.principalName().equals(principalName)
                && (socketSessionId == null
                        || player.socketSessionId() == null
                        || player.socketSessionId().equals(socketSessionId)));
    }

    public synchronized List<OutboundMatchmakingEvent> resumePendingMatch(
            UUID userId,
            String socketSessionId) {
        PendingMatch pending = pendingMatchForUser(userId);
        if (pending == null) {
            return List.of();
        }
        PendingMatch updated = pending.withSocketSession(userId, socketSessionId);
        pendingMatchesById.put(updated.matchId(), updated);
        return pendingEvents(
                updated,
                "MATCH_FOUND",
                "Match found. Accept within 20 seconds.");
    }

    public synchronized List<OutboundMatchmakingEvent> acceptMatch(
            UUID pendingMatchId,
            UUID userId,
            String socketSessionId) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null) {
            throw new AuthException("The match acceptance window is no longer available.");
        }

        MatchEntrant acceptingPlayer = pending.entrantFor(userId);
        if (acceptingPlayer == null || !socketMatches(acceptingPlayer.socketSessionId(), socketSessionId)) {
            throw new AuthException("This match acceptance belongs to another connection.");
        }

        if (!Instant.now(clock).isBefore(pending.acceptanceEndsAt())) {
            pendingMatchesById.remove(pending.matchId());
            return pendingEvents(
                    pending,
                    "MATCH_ACCEPTANCE_EXPIRED",
                    "The match acceptance window has closed.");
        }

        if (pending.acceptedUserIds().contains(userId)) {
            return pendingEvents(
                    pending,
                    "MATCH_ACCEPTED",
                    "You already accepted. Waiting for the other player.");
        }

        PendingMatch accepted = pending.withAcceptedUser(userId);
        if (accepted.acceptedUserIds().size() == 2) {
            List<OutboundMatchmakingEvent> events = matchService.startMatch(
                    accepted.opponent(),
                    accepted.player());
            pendingMatchesById.remove(accepted.matchId());
            return events;
        }

        pendingMatchesById.put(accepted.matchId(), accepted);
        return pendingEvents(
                accepted,
                "MATCH_ACCEPTED",
                "A player accepted the match. Waiting for the other player.");
    }

    public synchronized List<OutboundMatchmakingEvent> cancelPendingMatch(
            UUID pendingMatchId,
            UUID userId,
            String socketSessionId) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null) {
            throw new AuthException("The match acceptance window is no longer available.");
        }

        MatchEntrant cancellingPlayer = pending.entrantFor(userId);
        if (cancellingPlayer == null || !socketMatches(cancellingPlayer.socketSessionId(), socketSessionId)) {
            throw new AuthException("This match acceptance belongs to another connection.");
        }

        pendingMatchesById.remove(pending.matchId());
        return pendingEvents(
                pending,
                "MATCH_ACCEPTANCE_CANCELLED",
                "The match was cancelled before both players accepted.");
    }

    public synchronized List<OutboundMatchmakingEvent> resolvePendingMatchTimeout(
            UUID pendingMatchId,
            Instant expectedDeadline) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null
                || !pending.acceptanceEndsAt().equals(expectedDeadline)
                || Instant.now(clock).isBefore(pending.acceptanceEndsAt())) {
            return List.of();
        }
        pendingMatchesById.remove(pending.matchId());
        return pendingEvents(
                pending,
                "MATCH_ACCEPTANCE_EXPIRED",
                "The match was closed because both players did not accept in time.");
    }

    private List<OutboundMatchmakingEvent> createPendingMatch(
            MatchEntrant opponent,
            MatchEntrant player) {
        PendingMatch pending = new PendingMatch(
                UUID.randomUUID(),
                opponent,
                player,
                Instant.now(clock).plusSeconds(MATCH_ACCEPTANCE_SECONDS + SUBMISSION_GRACE_SECONDS),
                Set.of());
        pendingMatchesById.put(pending.matchId(), pending);
        return pendingEvents(
                pending,
                "MATCH_FOUND",
                "Match found. Accept within 20 seconds.");
    }

    private List<OutboundMatchmakingEvent> pendingEvents(
            PendingMatch pending,
            String type,
            String message) {
        Instant now = Instant.now(clock);
        List<PendingRecipient> recipients = List.of(
                new PendingRecipient(pending.opponent(), 1),
                new PendingRecipient(pending.player(), 2));
        return recipients.stream()
                .map(recipient -> {
                    boolean acceptedByMe = pending.acceptedUserIds().contains(recipient.entrant().userId());
                    boolean otherPlayerAccepted = pending.acceptedUserIds().stream()
                            .anyMatch(acceptedUserId -> !acceptedUserId.equals(recipient.entrant().userId()));
                    return new OutboundMatchmakingEvent(
                            recipient.entrant().principalName(),
                            new MatchmakingEventDTO(
                                    type,
                                    pending.matchId(),
                                    null,
                                    "MATCH_ACCEPT",
                                    null,
                                    null,
                                    List.of(),
                                    now,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    message,
                                    null,
                                    List.of(),
                                    List.of(),
                                    List.of(),
                                    null,
                                    List.of(),
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    pending.acceptanceEndsAt(),
                                    acceptedByMe,
                                    otherPlayerAccepted));
                })
                .toList();
    }

    private PendingMatch pendingMatchForUser(UUID userId) {
        return pendingMatchesById.values().stream()
                .filter(candidate -> candidate.containsUser(userId))
                .findFirst()
                .orElse(null);
    }

    private static boolean socketMatches(String expectedSocketSessionId, String actualSocketSessionId) {
        return expectedSocketSessionId == null
                || actualSocketSessionId == null
                || expectedSocketSessionId.equals(actualSocketSessionId);
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

    private record PendingRecipient(MatchEntrant entrant, int slot) {
    }

    private record PendingMatch(
            UUID matchId,
            MatchEntrant opponent,
            MatchEntrant player,
            Instant acceptanceEndsAt,
            Set<UUID> acceptedUserIds) {

        private boolean containsUser(UUID userId) {
            return opponent.userId().equals(userId) || player.userId().equals(userId);
        }

        private MatchEntrant entrantFor(UUID userId) {
            if (opponent.userId().equals(userId)) return opponent;
            if (player.userId().equals(userId)) return player;
            return null;
        }

        private PendingMatch withAcceptedUser(UUID userId) {
            java.util.Set<UUID> accepted = new java.util.HashSet<>(acceptedUserIds);
            accepted.add(userId);
            return new PendingMatch(matchId, opponent, player, acceptanceEndsAt, Set.copyOf(accepted));
        }

        private PendingMatch withSocketSession(UUID userId, String socketSessionId) {
            MatchEntrant updatedOpponent = opponent.userId().equals(userId)
                    ? new MatchEntrant(
                            opponent.userId(),
                            opponent.username(),
                            opponent.principalName(),
                            socketSessionId)
                    : opponent;
            MatchEntrant updatedPlayer = player.userId().equals(userId)
                    ? new MatchEntrant(
                            player.userId(),
                            player.username(),
                            player.principalName(),
                            socketSessionId)
                    : player;
            return new PendingMatch(
                    matchId,
                    updatedOpponent,
                    updatedPlayer,
                    acceptanceEndsAt,
                    acceptedUserIds);
        }
    }
}
