package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public record DuelInviteDTO(
        UUID inviteId,
        String status,
        String inviterUsername,
        String inviteeUsername,
        Instant createdAt,
        Instant expiresAt,
        UUID matchId) {
}
