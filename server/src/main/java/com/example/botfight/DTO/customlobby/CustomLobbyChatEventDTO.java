package com.example.botfight.DTO.customlobby;

import java.time.Instant;
import java.util.UUID;

public record CustomLobbyChatEventDTO(
        String type,
        UUID messageId,
        UUID lobbyId,
        String username,
        String message,
        Instant sentAt) {
}
