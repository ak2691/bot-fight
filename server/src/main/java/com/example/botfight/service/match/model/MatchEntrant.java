package com.example.botfight.service.match.model;

import java.util.UUID;

public record MatchEntrant(
        UUID userId,
        String username,
        String principalName,
        String socketSessionId) {
}
