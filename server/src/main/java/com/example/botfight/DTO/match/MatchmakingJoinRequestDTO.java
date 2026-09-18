package com.example.botfight.DTO.match;

import java.util.List;

public record MatchmakingJoinRequestDTO(
        String mode,
        List<Integer> guaranteedAbilityIds,
        // Queue pool is derived from the authenticated session; this field is
        // retained only so older clients can still deserialize their payload.
        Boolean ranked) {
    public MatchmakingJoinRequestDTO(String mode) {
        this(mode, List.of(), null);
    }

    public MatchmakingJoinRequestDTO(String mode, List<Integer> guaranteedAbilityIds) {
        this(mode, guaranteedAbilityIds, null);
    }
}
