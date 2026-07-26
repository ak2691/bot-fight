package com.example.botfight.DTO;

import java.util.UUID;

public record MatchChatRequestDTO(UUID matchId, String message) {
}
