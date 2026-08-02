package com.example.botfight.service;

import com.example.botfight.service.MatchService.OutboundMatchmakingEvent;
import java.util.List;

public record MatchmakingEventsReady(List<OutboundMatchmakingEvent> events) {
}
