package com.example.botfight.service.match.event;

import com.example.botfight.DTO.match.MatchmakingEventDTO;
import java.time.Instant;
import com.example.botfight.service.match.state.MatchPhase;

public record OutboundMatchmakingEvent(
        String principalName,
        MatchmakingEventDTO event,
        long delayMillis,
        Instant publishAt,
        MatchPhase phase,
        boolean schedulerOwned) {
    public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis, Instant publishAt, MatchPhase phase) {
        this(principalName, event, delayMillis, publishAt, phase, false);
    }

    /** The scheduler publishes phase announcements after commit and before starting simulation. */
    public OutboundMatchmakingEvent scheduledDelivery() {
        return new OutboundMatchmakingEvent(principalName, event, delayMillis, publishAt, phase, true);
    }

    public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis, Instant publishAt) {
        this(principalName, event, delayMillis, publishAt, null, false);
    }

    public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event) {
        this(principalName, event, 0, null, null, false);
    }

    public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis) {
        this(principalName, event, delayMillis, null, null, false);
    }
}
