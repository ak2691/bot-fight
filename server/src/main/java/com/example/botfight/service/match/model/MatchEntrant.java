package com.example.botfight.service.match.model;

import java.util.UUID;

public record MatchEntrant(
        UUID userId,
        String username,
        String principalName,
        String socketSessionId,
        int teamNumber,
        String kit) {
    public MatchEntrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        this(userId, username, principalName, socketSessionId, 0, null);
    }

    public MatchEntrant(UUID userId, String username, String principalName, String socketSessionId, int teamNumber) {
        this(userId, username, principalName, socketSessionId, teamNumber, null);
    }

    public MatchEntrant withKit(String value) {
        return new MatchEntrant(userId, username, principalName, socketSessionId, teamNumber, value);
    }

    public MatchEntrant withTeam(int team) {
        return new MatchEntrant(userId, username, principalName, socketSessionId, team, kit);
    }
}
