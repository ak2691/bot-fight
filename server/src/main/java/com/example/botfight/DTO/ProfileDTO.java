package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public record ProfileDTO(
        String username,
        Instant joinedAt,
        String aboutMe,
        long matchesPlayed,
        long wins,
        long losses,
        long draws) {

    public record RecentMatchDTO(
            UUID matchId,
            String opponentUsername,
            String result,
            Instant completedAt,
            String completionReason) {
    }
}
