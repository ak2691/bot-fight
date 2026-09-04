package com.example.botfight.DTO.party;

import java.time.Instant;
import java.util.UUID;

public record PartyInviteDTO(
        UUID inviteId,
        UUID partyId,
        String status,
        String inviterUsername,
        String inviteeUsername,
        Instant createdAt,
        Instant expiresAt) {
}
