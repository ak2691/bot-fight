package com.example.botfight.service.match.model;

import com.example.botfight.DTO.MatchmakingPlayerDTO;
import java.util.UUID;

public record MatchPlayer(
        UUID userId,
        String username,
        String principalName,
        int slot,
        int teamNumber,
        boolean finished,
        UUID botSubmissionId,
        int roundWins,
        String selectedLoadout,
        boolean loadoutSelected) {
    /** Backward-compatible constructor for existing 1v1 callers and fixtures. */
    public MatchPlayer(
            UUID userId,
            String username,
            String principalName,
            int slot,
            boolean finished,
            UUID botSubmissionId,
            int roundWins,
            String selectedLoadout,
            boolean loadoutSelected) {
        this(
                userId,
                username,
                principalName,
                slot,
                slot <= 2 ? slot : 1,
                finished,
                botSubmissionId,
                roundWins,
                selectedLoadout,
                loadoutSelected);
    }

    public MatchmakingPlayerDTO toDto() {
        return toDto(false);
    }

    public MatchmakingPlayerDTO toDto(boolean entityPlacementSubmitted) {
        return new MatchmakingPlayerDTO(
                userId,
                username,
                slot,
                teamNumber,
                finished,
                roundWins,
                selectedLoadout,
                loadoutSelected,
                entityPlacementSubmitted);
    }
}
