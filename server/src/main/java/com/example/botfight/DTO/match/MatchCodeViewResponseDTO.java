package com.example.botfight.DTO.match;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** Socket response containing a bounded, structured brain snapshot. */
public record MatchCodeViewResponseDTO(
        UUID requestId,
        UUID matchId,
        UUID targetUserId,
        Integer roundNumber,
        JsonNode brain,
        String selectedLoadout) {
}
