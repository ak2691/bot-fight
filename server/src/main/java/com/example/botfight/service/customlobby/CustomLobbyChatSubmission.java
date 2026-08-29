package com.example.botfight.service.customlobby;

import com.example.botfight.service.limits.RateLimitExceededException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CustomLobbyChatSubmission(
        CustomLobbyChatSubmissionStatus status,
        UUID messageId,
        UUID lobbyId,
        String username,
        String message,
        Instant sentAt,
        List<String> recipientPrincipalNames) {

    public static CustomLobbyChatSubmission rateLimited(UUID lobbyId) {
        return new CustomLobbyChatSubmission(
                CustomLobbyChatSubmissionStatus.RATE_LIMITED,
                null,
                lobbyId,
                null,
                RateLimitExceededException.GENERIC_MESSAGE,
                null,
                List.of());
    }

    public static CustomLobbyChatSubmission rejected(UUID lobbyId, String message) {
        return new CustomLobbyChatSubmission(
                CustomLobbyChatSubmissionStatus.REJECTED,
                null,
                lobbyId,
                null,
                message,
                null,
                List.of());
    }
}
