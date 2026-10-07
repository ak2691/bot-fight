package com.example.botfight.DTO.match;

import java.util.UUID;

/** A player's choice, made while building, of what happens when their clock runs out. */
public record MatchTimeoutFallbackDTO(UUID matchId, Integer roundNumber, String timeoutFallback) {
}
