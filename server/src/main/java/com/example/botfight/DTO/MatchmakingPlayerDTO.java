package com.example.botfight.DTO;

import java.util.UUID;

public record MatchmakingPlayerDTO(
        UUID userId,
        String username,
        int slot,
        boolean finished,
        int roundWins,
        String selectedLoadout,
        boolean loadoutSelected,
        boolean objectPlacementSubmitted) {
    public MatchmakingPlayerDTO(
            UUID userId,
            String username,
            int slot,
            boolean finished,
            int roundWins,
            String selectedLoadout,
            boolean loadoutSelected) {
        this(userId, username, slot, finished, roundWins, selectedLoadout, loadoutSelected, false);
    }
}
