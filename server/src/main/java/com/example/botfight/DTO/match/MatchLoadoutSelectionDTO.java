package com.example.botfight.DTO.match;

import java.util.UUID;

public record MatchLoadoutSelectionDTO(
        UUID matchId,
        Integer roundNumber,
        String selectedLoadout) {

    public MatchLoadoutSelectionDTO(String selectedLoadout) {
        this(null, null, selectedLoadout);
    }
}
