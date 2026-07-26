package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public record ActiveMatchStatusDTO(
        boolean activeMatch,
        boolean disconnected,
        UUID matchId,
        Instant disconnectEndsAt) {

    public static ActiveMatchStatusDTO none() {
        return new ActiveMatchStatusDTO(false, false, null, null);
    }
}
