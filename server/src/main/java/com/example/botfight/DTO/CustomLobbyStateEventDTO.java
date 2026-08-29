package com.example.botfight.DTO;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record CustomLobbyStateEventDTO(
        String type,
        UUID lobbyId,
        CustomLobbyDTO lobby,
        UUID matchId,
        String message) {
}
