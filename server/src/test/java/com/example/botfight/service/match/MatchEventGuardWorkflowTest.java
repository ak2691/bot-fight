package com.example.botfight.service.match;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;


import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.support.TestMatches;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.*;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchEventGuardWorkflowTest extends MatchWorkflowFixture {
    @Test
    void staleSelectionSnapshotIsRejectedAfterTheMatchEntersBuilding() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        List<OutboundMatchmakingEvent> started = matchmakingService.joinQueue(com.example.botfight.support.TestKits.queue(
                firstUserId,
                "pilot-one",
                "pilot-one@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        List<OutboundMatchmakingEvent> selectionEvents = matchmakingService.joinQueue(com.example.botfight.support.TestKits.queue(
                secondUserId,
                "pilot-two",
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));

        TestMatches.beginBuild(service, firstUserId);
        List<OutboundMatchmakingEvent> buildingEvents = TestMatches.beginBuild(service, secondUserId);

        assertThat(started).isNotEmpty();
        assertThat(selectionEvents).hasSize(2);
        assertThat(buildingEvents).hasSize(2);
        assertThat(selectionEvents).allSatisfy(event ->
                assertThat(guard.currentEventRejectionReason(event)).isNotNull());
        assertThat(buildingEvents).allSatisfy(event ->
                assertThat(guard.currentEventRejectionReason(event)).isNull());
        // The 5:00 base plus the 30 second increment, then the 2 second submission grace.
        assertThat(Duration.between(clock.instant(), buildingEvents.get(0).event().buildingEndsAt()))
                .isEqualTo(Duration.ofSeconds(227));
    }
}
