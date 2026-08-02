package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public record MatchChatEventDTO(
        String type,
        UUID messageId,
        UUID matchId,
        String username,
        String message,
        Instant sentAt,
        Instant endsAt,
        Instant serverNow) {

    public MatchChatEventDTO(
            String type,
            UUID messageId,
            UUID matchId,
            String username,
            String message,
            Instant sentAt) {
        this(type, messageId, matchId, username, message, sentAt, null, null);
    }
}
