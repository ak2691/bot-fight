package com.example.botfight.service.match.model;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import java.util.List;

public record MatchSubmissionResult(
        boolean accepted,
        boolean duplicate,
        String message,
        List<OutboundMatchmakingEvent> events) {
    public static MatchSubmissionResult accepted(List<OutboundMatchmakingEvent> events) {
        return new MatchSubmissionResult(true, false, null, List.copyOf(events));
    }

    public static MatchSubmissionResult duplicateResult() {
        return new MatchSubmissionResult(true, true, null, List.of());
    }

    public static MatchSubmissionResult rejected(String message) {
        return new MatchSubmissionResult(false, false, message, List.of());
    }
}
