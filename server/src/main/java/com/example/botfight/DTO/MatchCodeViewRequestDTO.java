package com.example.botfight.DTO;

import java.util.UUID;

/** Client request to ask one current match participant for a read-only code snapshot. */
public record MatchCodeViewRequestDTO(
        UUID matchId,
        UUID targetUserId,
        Integer roundNumber) {
}
