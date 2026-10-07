package com.example.botfight.DTO.match;

import java.time.Instant;
import java.util.UUID;

/**
 * A participant in a match event. {@code clockRemainingMs} is the player's build clock as it stood when
 * the current build began (or as it ended once they submitted); {@code buildEndsAt} is the absolute
 * instant a building player's clock reaches zero, and is null outside the build phase.
 */
public record MatchmakingPlayerDTO(
        UUID userId,
        String username,
        int slot,
        int teamNumber,
        boolean finished,
        int roundWins,
        String selectedLoadout,
        boolean loadoutSelected,
        boolean entityPlacementSubmitted,
        Long clockRemainingMs,
        Instant buildEndsAt,
        String timeoutFallback) {
    public MatchmakingPlayerDTO(
            UUID userId,
            String username,
            int slot,
            int teamNumber,
            boolean finished,
            int roundWins,
            String selectedLoadout,
            boolean loadoutSelected,
            boolean entityPlacementSubmitted) {
        this(userId, username, slot, teamNumber, finished, roundWins, selectedLoadout, loadoutSelected,
                entityPlacementSubmitted, null, null, null);
    }

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
