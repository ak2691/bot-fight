package com.example.botfight.service.match.event;

import com.example.botfight.DTO.match.MatchmakingEventDTO;
import java.time.Instant;

public record OutboundMatchmakingEvent(
        String principalName,
        MatchmakingEventDTO event,
        long delayMillis,
        Instant publishAt) {
    public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event) {
        this(principalName, event, 0, null);
    }

    public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis) {
        this(principalName, event, delayMillis, null);
    }
}
