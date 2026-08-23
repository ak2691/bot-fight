package com.example.botfight.service.match.model;

import com.example.botfight.DTO.MatchmakingPlayerDTO;
import java.util.UUID;

public record MatchPlayer(
        UUID userId,
        String username,
        String principalName,
        int slot,
        boolean finished,
        UUID botSubmissionId,
        int roundWins,
        String selectedLoadout,
        boolean loadoutSelected) {
    public MatchmakingPlayerDTO toDto() {
        return toDto(false);
    }

    public MatchmakingPlayerDTO toDto(boolean entityPlacementSubmitted) {
        return new MatchmakingPlayerDTO(
                userId,
                username,
                slot,
                finished,
                roundWins,
                selectedLoadout,
                loadoutSelected,
                entityPlacementSubmitted);
    }
}
