package com.example.botfight.service.match.state;

import java.util.UUID;

public record SimulationKey(UUID matchId, int roundNumber) {
}
