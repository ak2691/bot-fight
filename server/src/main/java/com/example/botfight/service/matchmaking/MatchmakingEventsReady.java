package com.example.botfight.service.matchmaking;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import java.util.List;

public record MatchmakingEventsReady(List<OutboundMatchmakingEvent> events) {
}
