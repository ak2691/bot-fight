package com.example.botfight.DTO;

import java.util.UUID;

public record CustomLobbyChatRequestDTO(UUID lobbyId, String message) {
}
