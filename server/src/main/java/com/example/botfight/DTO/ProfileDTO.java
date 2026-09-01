package com.example.botfight.DTO;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ProfileDTO(
        String username,
        Instant joinedAt,
        String aboutMe,
        long matchesPlayed,
        long wins,
        long losses,
        long draws,
        long puzzlesSolved,
        QueueStats queueStats) {

    /**
     * Keeps callers that only need the aggregate profile fields source-compatible.
     */
    public ProfileDTO(
            String username,
            Instant joinedAt,
            String aboutMe,
            long matchesPlayed,
            long wins,
            long losses,
            long draws,
            long puzzlesSolved) {
        this(
                username,
                joinedAt,
                aboutMe,
                matchesPlayed,
                wins,
                losses,
                draws,
                puzzlesSolved,
                new QueueStats(new ModeStats(0, 0), new ModeStats(0, 0)));
    }

    public record QueueStats(ModeStats ones, ModeStats twos) {
    }

    public record ModeStats(long wins, long losses, long draws, int elo) {
        public ModeStats(long wins, long losses, int elo) {
            this(wins, losses, 0, elo);
        }

        public ModeStats(long wins, long losses) {
            this(wins, losses, 0, 1000);
        }
    }

    public record RecentMatchDTO(
            UUID matchId,
            List<String> participantUsernames,
            String result,
            Instant completedAt,
            String completionReason,
            String mode) {
    }
}
