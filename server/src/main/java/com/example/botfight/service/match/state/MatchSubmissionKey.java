package com.example.botfight.service.match.state;

import java.util.UUID;

public record MatchSubmissionKey(
        UUID matchId,
        int roundNumber,
        String phase,
        UUID userId) {
}
