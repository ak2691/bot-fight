package com.example.botfight.DTO.customlobby;

import java.util.List;
import java.util.UUID;

/** Current server-owned state for an invite-only custom lobby. */
public record CustomLobbyDTO(
        UUID lobbyId,
        UUID ownerId,
        String ownerUsername,
        int capacity,
        int baseClockSeconds,
        int incrementSeconds,
        List<CustomLobbyMemberDTO> members) {

}
