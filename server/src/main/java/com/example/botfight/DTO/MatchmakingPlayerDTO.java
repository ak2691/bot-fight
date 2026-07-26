package com.example.botfight.DTO;

import java.util.UUID;

public record MatchmakingPlayerDTO(
        UUID userId,
        String username,
        int slot,
        boolean finished,
        int roundWins,
        String selectedClass,
        boolean classSelected,
        boolean objectPlacementSubmitted) {
    public MatchmakingPlayerDTO(
            UUID userId,
            String username,
            int slot,
            boolean finished,
            int roundWins,
            String selectedClass,
            boolean classSelected) {
        this(userId, username, slot, finished, roundWins, selectedClass, classSelected, false);
    }
}
