package com.example.botfight.service.match.model;

import com.example.botfight.service.limits.RateLimitExceededException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record MatchChatSubmission(
        MatchChatSubmissionStatus status,
        UUID messageId,
        UUID matchId,
        String username,
        String message,
        Instant sentAt,
        List<String> recipientPrincipalNames) {
    public static MatchChatSubmission rateLimited(UUID matchId) {
        return new MatchChatSubmission(
                MatchChatSubmissionStatus.RATE_LIMITED,
                null,
                matchId,
                null,
                RateLimitExceededException.GENERIC_MESSAGE,
                null,
                List.of());
    }

    public static MatchChatSubmission rejected(UUID matchId, String message) {
        return new MatchChatSubmission(
                MatchChatSubmissionStatus.REJECTED,
                null,
                matchId,
                null,
                message,
                null,
                List.of());
    }
}
