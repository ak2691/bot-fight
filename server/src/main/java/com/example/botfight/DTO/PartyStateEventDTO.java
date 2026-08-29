package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

/**
 * Authenticated, user-scoped party state. The party snapshot is sent only to
 * current members, so clients never need to subscribe to a party-id-based
 * broadcast channel.
 */
public record PartyStateEventDTO(
        String type,
        UUID partyId,
        PartyDTO party,
        String queueStatus,
        String queueMode,
        UUID matchId,
        Instant createdAt) {
}
