package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public record NotificationEventDTO(
        String type,
        UUID notificationId,
        UUID inviteId,
        String actorUsername,
        String message,
        Instant createdAt,
        Instant expiresAt,
        UUID matchId) {
}
