package com.example.botfight.DTO.customlobby;

import java.util.List;
import java.util.UUID;

/** Current server-owned state for an invite-only custom lobby. */
public record CustomLobbyDTO(
        UUID lobbyId,
        UUID ownerId,
        String ownerUsername,
        int capacity,
        int roundDurationSeconds,
        List<CustomLobbyMemberDTO> members) {

    /** Compatibility constructor for callers that do not provide settings. */
    public CustomLobbyDTO(
            UUID lobbyId,
            UUID ownerId,
            String ownerUsername,
            int capacity,
            List<CustomLobbyMemberDTO> members) {
        this(lobbyId, ownerId, ownerUsername, capacity, 5 * 60, members);
    }
}
