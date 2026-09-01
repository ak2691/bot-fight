package com.example.botfight.service.match.model;

import java.util.Map;
import java.util.UUID;

public record MatchEntrant(
        UUID userId,
        String username,
        String principalName,
        String socketSessionId,
        int teamNumber,
        Map<Integer, Integer> guaranteedAbilities) {
    public MatchEntrant {
        guaranteedAbilities = guaranteedAbilities == null
                ? Map.of()
                : Map.copyOf(guaranteedAbilities);
    }

    public MatchEntrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        this(userId, username, principalName, socketSessionId, 0, Map.of());
    }

    public MatchEntrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            int teamNumber) {
        this(userId, username, principalName, socketSessionId, teamNumber, Map.of());
    }

    public MatchEntrant withTeam(int team) {
        return new MatchEntrant(
                userId, username, principalName, socketSessionId, team, guaranteedAbilities);
    }

    public MatchEntrant withGuaranteedAbilities(Map<Integer, Integer> guarantees) {
        return new MatchEntrant(
                userId, username, principalName, socketSessionId, teamNumber, guarantees);
    }
}
