package com.example.botfight.DTO;

import java.util.UUID;

public record MatchLoadoutSelectionDTO(
        UUID matchId,
        Integer roundNumber,
        String selectedLoadout) {

    public MatchLoadoutSelectionDTO(String selectedLoadout) {
        this(null, null, selectedLoadout);
    }
}
