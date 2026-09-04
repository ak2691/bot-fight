package com.example.botfight.DTO.customlobby;

import java.time.Instant;
import java.util.UUID;

public record CustomLobbyInviteDTO(
        UUID inviteId,
        UUID lobbyId,
        String status,
        String inviterUsername,
        String inviteeUsername,
        Instant createdAt,
        Instant expiresAt) {
}
