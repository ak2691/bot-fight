package com.example.botfight.service.match.state;

import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.match.model.MatchSession;
import java.util.Collection;
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

    public void putSession(MatchSession session) {
        session.players().forEach(player -> activeSessionsByUserId.put(player.userId(), session));
    }

    public void removeSession(MatchSession session) {
        session.players().forEach(player -> activeSessionsByUserId.remove(player.userId(), session));
    }
}
