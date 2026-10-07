package com.example.botfight.service.match.model;

import java.util.UUID;

public record MatchEntrant(
        UUID userId,
        String username,
        String principalName,
        String socketSessionId,
        int teamNumber) {
    public MatchEntrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        this(userId, username, principalName, socketSessionId, 0);
    }

    public MatchEntrant withTeam(int team) {
        return new MatchEntrant(userId, username, principalName, socketSessionId, team);
    }
}
