package com.example.botfight.DTO.match;

import java.util.List;

public record MatchmakingJoinRequestDTO(
        String mode,
        List<Integer> guaranteedAbilityIds) {
    public MatchmakingJoinRequestDTO(String mode) {
        this(mode, List.of());
    }
}
