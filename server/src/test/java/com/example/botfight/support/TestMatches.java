package com.example.botfight.support;

import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.model.MatchSubmissionResult;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.domain.submission.BotSubmission;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.test.util.ReflectionTestUtils;

/** Fixture access to the server-owned context used by the canonical match APIs. */
public final class TestMatches {
    private TestMatches() {}

    @SuppressWarnings("unchecked")
    private static MatchSession session(MatchService service, UUID userId) {
        return ((com.example.botfight.service.match.state.MatchRuntimeState) ReflectionTestUtils.getField(service,
                "runtimeState")).activeSessionForUser(userId);
    }

    public static List<OutboundMatchmakingEvent> selectLoadout(
            MatchService service, UUID userId, String loadout) {
        MatchSession session = session(service, userId);
        return service.selectLoadout(userId, session == null ? null : session.matchId(),
                session == null ? null : session.roundNumber(), loadout);
    }

    public static MatchSubmissionResult acceptMatchSubmission(
            MatchService service, UUID userId, UUID matchId, BotSubmission submission) {
        MatchSession session = session(service, userId);
        return service.acceptMatchSubmission(userId, matchId,
                session == null ? null : session.roundNumber(), "BUILDING", submission);
    }
}
