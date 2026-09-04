package com.example.botfight.DTO.match;

import java.util.UUID;

public record MatchChatRequestDTO(UUID matchId, String message, String channel) {

    /** Keeps older clients on the server-wide match channel. */
    public MatchChatRequestDTO(UUID matchId, String message) {
        this(matchId, message, null);
    }
}
