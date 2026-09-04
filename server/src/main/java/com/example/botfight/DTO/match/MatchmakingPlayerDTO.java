package com.example.botfight.DTO.match;

import java.util.UUID;

public record MatchmakingPlayerDTO(
        UUID userId,
        String username,
        int slot,
        int teamNumber,
        boolean finished,
        int roundWins,
        String selectedLoadout,
        boolean loadoutSelected,
        boolean entityPlacementSubmitted) {
    public MatchmakingPlayerDTO(
            UUID userId,
            String username,
            int slot,
            boolean finished,
            int roundWins,
            String selectedLoadout,
            boolean loadoutSelected) {
        this(userId, username, slot, slot <= 2 ? slot : 1, finished, roundWins,
                selectedLoadout, loadoutSelected, false);
    }
}
