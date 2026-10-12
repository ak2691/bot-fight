package com.example.botfight.service.match.state;

import com.example.botfight.service.match.MatchPhaseService;

import org.springframework.stereotype.Component;

import java.util.Objects;
import java.time.Instant;

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
@Component
public final class MatchRuntimeState {
    private final MatchPhaseService phaseService;

    public MatchRuntimeState(MatchPhaseService phaseService) {
        this.phaseService = phaseService;
    }

    private final ConcurrentMap<UUID, MatchSession> sessionsByMatchId = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, UUID> matchIdsByUserId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, UUID> matchIdsByPrincipal = new ConcurrentHashMap<>();
    /** Players reserved while a match roster is being persisted. */
    private final Map<UUID, UUID> startReservationsByUserId = new HashMap<>();
    private final Map<UUID, Set<UUID>> startReservationsById = new HashMap<>();
    private final ConcurrentMap<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId = new ConcurrentHashMap<>();
    private final ConcurrentMap<MatchSubmissionKey, BotSubmission> matchSubmissionsByKey = new ConcurrentHashMap<>();
    private final Set<SimulationKey> simulationsInProgress = ConcurrentHashMap.newKeySet();



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
        UUID matchId = userId == null ? null : matchIdsByUserId.get(userId);
        return matchId == null ? null : sessionsByMatchId.get(matchId);
    }

    public MatchSession activeSessionForMatch(UUID matchId) {
        return matchId == null ? null : sessionsByMatchId.get(matchId);
    }

    public MatchSession activeSessionForPrincipal(String principalName) {
        UUID matchId = principalName == null ? null : matchIdsByPrincipal.get(principalName);
        return matchId == null ? null : sessionsByMatchId.get(matchId);
    }

    public Collection<MatchSession> distinctActiveSessions() {
        return List.copyOf(sessionsByMatchId.values());
    }

    public synchronized void putSession(MatchSession session) {
        MatchSession previous = sessionsByMatchId.get(session.matchId());
        if (previous != null) phaseService.checkTransition(previous.phase(), session.phase());
        sessionsByMatchId.put(session.matchId(), session);
        if (previous != null) return;
        session.players().forEach(player -> {
            matchIdsByUserId.put(player.userId(), session.matchId());
            matchIdsByPrincipal.put(player.principalName(), session.matchId());
        });
    }

    public synchronized void removeUser(UUID userId) {
        MatchSession session = activeSessionForUser(userId);
        if (session == null) return;
        matchIdsByUserId.remove(userId, session.matchId());
        session.players().stream().filter(player -> player.userId().equals(userId))
                .forEach(player -> matchIdsByPrincipal.remove(player.principalName(), session.matchId()));
        if (session.players().stream().noneMatch(player -> session.matchId().equals(matchIdsByUserId.get(player.userId())))) {
            sessionsByMatchId.remove(session.matchId());
        }
    }

    /**
     * Claims every player in a roster as one operation. A null result means
     * at least one player is already active or is being claimed by another
     * match start.
     */
    public synchronized UUID reserveMatchStart(List<UUID> userIds) {
        if (userIds == null || userIds.isEmpty()
                || userIds.stream().anyMatch(Objects::isNull)) {
            return null;
        }
        Set<UUID> uniqueUserIds = new HashSet<>(userIds);
        if (uniqueUserIds.size() != userIds.size()
                || uniqueUserIds.stream().anyMatch(userId ->
                        matchIdsByUserId.containsKey(userId)
                                || startReservationsByUserId.containsKey(userId))) {
            return null;
        }

        UUID reservationId = UUID.randomUUID();
        startReservationsById.put(reservationId, Set.copyOf(uniqueUserIds));
        uniqueUserIds.forEach(userId -> startReservationsByUserId.put(userId, reservationId));
        return reservationId;
    }

    /** Publishes the active session and releases its temporary roster claim atomically. */
    public synchronized boolean publishReservedSession(UUID reservationId, MatchSession session) {
        if (reservationId == null || session == null || session.players().isEmpty()) return false;
        List<UUID> userIds = session.players().stream().map(player -> player.userId()).toList();
        Set<UUID> uniqueUserIds = new HashSet<>(userIds);
        if (uniqueUserIds.size() != userIds.size()
                || !uniqueUserIds.equals(startReservationsById.get(reservationId))
                || uniqueUserIds.stream().anyMatch(userId ->
                        !reservationId.equals(startReservationsByUserId.get(userId))
                                || matchIdsByUserId.containsKey(userId))) {
            return false;
        }

        putSession(session);
        uniqueUserIds.forEach(startReservationsByUserId::remove);
        startReservationsById.remove(reservationId);
        return true;
    }

    /** Releases a whole in-progress claim after validation or persistence fails. */
    public synchronized void releaseMatchStart(UUID reservationId) {
        if (reservationId == null) return;
        Set<UUID> userIds = startReservationsById.remove(reservationId);
        if (userIds != null) userIds.forEach(userId -> startReservationsByUserId.remove(userId, reservationId));
    }

    public synchronized boolean isMatchStartReserved(UUID userId) {
        return userId != null && startReservationsByUserId.containsKey(userId);
    }

    public synchronized void removeSession(MatchSession session) {
        sessionsByMatchId.remove(session.matchId());
        session.players().forEach(player -> {
            matchIdsByUserId.remove(player.userId(), session.matchId());
            matchIdsByPrincipal.remove(player.principalName(), session.matchId());
        });
    }

    public boolean isSchedulingDeadlineCurrent(UUID matchId, MatchPhase phase,
            int round, Instant deadline) {
        MatchSession session = activeSessionForMatch(matchId);
        if (session == null || session.phase() != phase || session.roundNumber() != round) return false;
        return switch (phase) {
            case KIT_REVEAL -> deadline.equals(session.loadoutSelectionEndsAt());
            case BUILDING -> session.players().stream().anyMatch(player -> !player.finished() && deadline.equals(player.buildExpiresAt()));
            case REPLAY -> deadline.equals(session.roundReadyAt()) || deadline.equals(session.resultRevealsAt());
            default -> false;
        };
    }

}
