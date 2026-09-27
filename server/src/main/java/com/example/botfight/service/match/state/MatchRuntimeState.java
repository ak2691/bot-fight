package com.example.botfight.service.match.state;

import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.match.model.MatchSession;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * In-memory authoritative state for active matches. Workflow services share
 * this state; they do not keep competing copies of a session or submission.
 */
public final class MatchRuntimeState {
    private final ConcurrentMap<UUID, MatchSession> activeSessionsByUserId = new ConcurrentHashMap<>();
    /** Players reserved while a match roster is being persisted. */
    private final Map<UUID, UUID> startReservationsByUserId = new HashMap<>();
    private final Set<UUID> initialLoadoutSelectionStartedMatchIds = ConcurrentHashMap.newKeySet();
    private final ConcurrentMap<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId = new ConcurrentHashMap<>();
    private final ConcurrentMap<MatchSubmissionKey, BotSubmission> matchSubmissionsByKey = new ConcurrentHashMap<>();
    private final Set<SimulationKey> simulationsInProgress = ConcurrentHashMap.newKeySet();

    public ConcurrentMap<UUID, MatchSession> activeSessionsByUserId() {
        return activeSessionsByUserId;
    }

    public Set<UUID> initialLoadoutSelectionStartedMatchIds() {
        return initialLoadoutSelectionStartedMatchIds;
    }

    public ConcurrentMap<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId() {
        return roundHistoryByMatchId;
    }

    public ConcurrentMap<MatchSubmissionKey, BotSubmission> matchSubmissionsByKey() {
        return matchSubmissionsByKey;
    }

    public Set<SimulationKey> simulationsInProgress() {
        return simulationsInProgress;
    }

    public MatchSession activeSessionForUser(UUID userId) {
        return activeSessionsByUserId.get(userId);
    }

    public MatchSession activeSessionForMatch(UUID matchId) {
        return activeSessionsByUserId.values().stream()
                .filter(session -> matchId.equals(session.matchId()))
                .findFirst()
                .orElse(null);
    }

    public MatchSession activeSessionForPrincipal(String principalName) {
        return activeSessionsByUserId.values().stream()
                .distinct()
                .filter(session -> session.players().stream()
                        .anyMatch(player -> principalName.equals(player.principalName())))
                .findFirst()
                .orElse(null);
    }

    public Collection<MatchSession> distinctActiveSessions() {
        return activeSessionsByUserId.values().stream().distinct().toList();
    }

    public synchronized void putSession(MatchSession session) {
        session.players().forEach(player -> activeSessionsByUserId.put(player.userId(), session));
    }

    /**
     * Claims every player in a roster as one operation. A null result means
     * at least one player is already active or is being claimed by another
     * match start.
     */
    public synchronized UUID reserveMatchStart(List<UUID> userIds) {
        if (userIds == null || userIds.isEmpty()
                || userIds.stream().anyMatch(java.util.Objects::isNull)) {
            return null;
        }
        Set<UUID> uniqueUserIds = new HashSet<>(userIds);
        if (uniqueUserIds.size() != userIds.size()
                || uniqueUserIds.stream().anyMatch(userId ->
                        activeSessionsByUserId.containsKey(userId)
                                || startReservationsByUserId.containsKey(userId))) {
            return null;
        }

        UUID reservationId = UUID.randomUUID();
        uniqueUserIds.forEach(userId -> startReservationsByUserId.put(userId, reservationId));
        return reservationId;
    }

    /** Publishes the active session and releases its temporary roster claim atomically. */
    public synchronized boolean publishReservedSession(UUID reservationId, MatchSession session) {
        if (reservationId == null || session == null || session.players().isEmpty()) return false;
        List<UUID> userIds = session.players().stream().map(player -> player.userId()).toList();
        Set<UUID> uniqueUserIds = new HashSet<>(userIds);
        if (uniqueUserIds.size() != userIds.size()
                || startReservationsByUserId.values().stream()
                        .filter(reservationId::equals)
                        .count() != uniqueUserIds.size()
                || uniqueUserIds.stream().anyMatch(userId ->
                        !reservationId.equals(startReservationsByUserId.get(userId))
                                || activeSessionsByUserId.containsKey(userId))) {
            return false;
        }

        userIds.forEach(userId -> activeSessionsByUserId.put(userId, session));
        uniqueUserIds.forEach(startReservationsByUserId::remove);
        return true;
    }

    /** Releases a whole in-progress claim after validation or persistence fails. */
    public synchronized void releaseMatchStart(UUID reservationId) {
        if (reservationId == null) return;
        startReservationsByUserId.entrySet().removeIf(entry -> reservationId.equals(entry.getValue()));
    }

    public synchronized boolean isMatchStartReserved(UUID userId) {
        return userId != null && startReservationsByUserId.containsKey(userId);
    }

    public synchronized void removeSession(MatchSession session) {
        session.players().forEach(player -> activeSessionsByUserId.computeIfPresent(
                player.userId(),
                (userId, current) -> current.matchId().equals(session.matchId()) ? null : current));
    }
}
