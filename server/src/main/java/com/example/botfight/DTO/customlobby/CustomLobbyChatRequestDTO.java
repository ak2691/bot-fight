package com.example.botfight.DTO.customlobby;

import java.util.UUID;

public record CustomLobbyChatRequestDTO(UUID lobbyId, String message) {
}
