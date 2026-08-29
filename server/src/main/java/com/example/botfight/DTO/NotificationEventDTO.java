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
        UUID matchId,
        UUID partyId,
        UUID customLobbyId) {

    /** Backward-compatible constructor for existing notification producers. */
    public NotificationEventDTO(
            String type,
            UUID notificationId,
            UUID inviteId,
            String actorUsername,
            String message,
            Instant createdAt,
            Instant expiresAt,
            UUID matchId,
            UUID partyId) {
        this(
                type,
                notificationId,
                inviteId,
                actorUsername,
                message,
                createdAt,
                expiresAt,
                matchId,
                partyId,
                null);
    }

    /** Backward-compatible constructor for existing notification producers. */
    public NotificationEventDTO(
            String type,
            UUID notificationId,
            UUID inviteId,
            String actorUsername,
            String message,
            Instant createdAt,
            Instant expiresAt,
            UUID matchId) {
        this(
                type,
                notificationId,
                inviteId,
                actorUsername,
                message,
                createdAt,
                expiresAt,
                matchId,
                null,
                null);
    }
}
