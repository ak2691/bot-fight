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
        Long clockRemainingMs,
        Instant buildEndsAt,
        String timeoutFallback) {

}
