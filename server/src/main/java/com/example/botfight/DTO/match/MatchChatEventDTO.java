package com.example.botfight.DTO.match;

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
        Instant serverNow,
        String channel) {

    /** Keeps the existing closure/event call sites on the server-wide channel. */
    public MatchChatEventDTO(
            String type,
            UUID messageId,
            UUID matchId,
            String username,
            String message,
            Instant sentAt,
            Instant endsAt,
            Instant serverNow) {
        this(type, messageId, matchId, username, message, sentAt, endsAt, serverNow, "ALL");
    }

    public MatchChatEventDTO(
            String type,
            UUID messageId,
            UUID matchId,
            String username,
            String message,
            Instant sentAt) {
        this(type, messageId, matchId, username, message, sentAt, null, null, "ALL");
    }
}
