package com.example.botfight.service.match.state;

import java.time.Instant;

public record CurrentPhase(
        MatchPhase phase,
        int roundNumber,
        Instant selectionDeadline) {
}
