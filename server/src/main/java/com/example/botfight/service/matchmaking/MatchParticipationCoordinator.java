package com.example.botfight.service.matchmaking;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Serializes entry into ranked matchmaking and custom lobbies. The monitor is
 * intentionally limited to in-memory ownership changes; callers never invoke
 * persistence, another service, or WebSocket delivery while holding it.
 */
@Service
public class MatchParticipationCoordinator {
    private final Set<UUID> rankedParticipants = new HashSet<>();
    private final Map<UUID, UUID> customLobbyByUserId = new HashMap<>();
    private final Map<UUID, Set<UUID>> rankedAdmissionIdsByUserId = new HashMap<>();
    private final Map<UUID, Set<UUID>> userIdsByRankedAdmissionId = new HashMap<>();

    /**
     * Reserves a whole queue roster while other validations run. A null result
     * means at least one member already belongs to a custom lobby. The
     * operation is all-or-nothing for party queues.
     */
    public synchronized RankedAdmission reserveRankedAdmission(Collection<UUID> userIds) {
        List<UUID> roster = normalizedRoster(userIds);
        if (roster.isEmpty()
                || roster.size() != userIds.size()
                || roster.stream().anyMatch(customLobbyByUserId::containsKey)) {
            return null;
        }

        UUID admissionId = UUID.randomUUID();
        Set<UUID> admittedUsers = Set.copyOf(roster);
        userIdsByRankedAdmissionId.put(admissionId, admittedUsers);
        admittedUsers.forEach(userId -> rankedAdmissionIdsByUserId
                .computeIfAbsent(userId, ignored -> new HashSet<>())
                .add(admissionId));
        return new RankedAdmission(admissionId, roster);
    }

    /** Converts an admission lease into durable ranked queue/match state. */
    public synchronized boolean commitRankedAdmission(RankedAdmission admission) {
        if (admission == null) return false;
        Set<UUID> users = userIdsByRankedAdmissionId.get(admission.admissionId());
        if (users == null
                || !users.equals(new HashSet<>(admission.userIds()))
                || users.stream().anyMatch(customLobbyByUserId::containsKey)) {
            return false;
        }
        rankedParticipants.addAll(users);
        removeAdmission(admission.admissionId(), users);
        return true;
    }

    /** Releases a temporary admission after validation or mutation fails. */
    public synchronized void releaseRankedAdmission(RankedAdmission admission) {
        if (admission == null) return;
        Set<UUID> users = userIdsByRankedAdmissionId.get(admission.admissionId());
        if (users != null) removeAdmission(admission.admissionId(), users);
    }

    /**
     * Claims custom-lobby membership, rejecting ranked state and all in-flight
     * queue admissions. Reclaiming the same lobby is idempotent for recovery.
     */
    public synchronized boolean claimCustomLobby(UUID userId, UUID lobbyId) {
        if (userId == null || lobbyId == null) return false;
        UUID existingLobbyId = customLobbyByUserId.get(userId);
        if (lobbyId.equals(existingLobbyId)) return true;
        if (existingLobbyId != null
                || rankedParticipants.contains(userId)
                || rankedAdmissionIdsByUserId.containsKey(userId)) {
            return false;
        }
        customLobbyByUserId.put(userId, lobbyId);
        return true;
    }

    public synchronized void releaseCustomLobby(UUID userId, UUID lobbyId) {
        if (userId != null && lobbyId != null) {
            customLobbyByUserId.remove(userId, lobbyId);
        }
    }

    /** Keeps ranked ownership through active match play, until session cleanup. */
    public synchronized void releaseRankedParticipants(Collection<UUID> userIds) {
        if (userIds == null) return;
        userIds.stream().filter(java.util.Objects::nonNull).forEach(rankedParticipants::remove);
    }

    public synchronized boolean isRankedParticipant(UUID userId) {
        return userId != null && (rankedParticipants.contains(userId)
                || rankedAdmissionIdsByUserId.containsKey(userId));
    }

    public synchronized boolean isCustomLobbyMember(UUID userId) {
        return userId != null && customLobbyByUserId.containsKey(userId);
    }

    private void removeAdmission(UUID admissionId, Collection<UUID> users) {
        userIdsByRankedAdmissionId.remove(admissionId);
        users.forEach(userId -> rankedAdmissionIdsByUserId.computeIfPresent(userId, (ignored, ids) -> {
            ids.remove(admissionId);
            return ids.isEmpty() ? null : ids;
        }));
    }

    private List<UUID> normalizedRoster(Collection<UUID> userIds) {
        if (userIds == null || userIds.isEmpty() || userIds.stream().anyMatch(java.util.Objects::isNull)) {
            return List.of();
        }
        return List.copyOf(new HashSet<>(userIds));
    }

    public record RankedAdmission(UUID admissionId, List<UUID> userIds) {
        public RankedAdmission {
            userIds = userIds == null ? List.of() : List.copyOf(userIds);
        }
    }
}
