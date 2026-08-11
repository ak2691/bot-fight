package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public record BuildingSessionResponseDTO(
        UUID buildingSessionId,
        UUID matchId,
        Instant startedAt,
        long buildingDurationMs,
        boolean trusted,
        String message) {
}
