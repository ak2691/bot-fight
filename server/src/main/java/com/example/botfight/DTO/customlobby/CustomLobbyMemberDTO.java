package com.example.botfight.DTO.customlobby;

import java.util.UUID;

/** A server-owned member snapshot for the transient custom lobby. */
public record CustomLobbyMemberDTO(
        UUID userId,
        String username,
        int teamNumber,
        boolean owner,
        boolean online) {
}
