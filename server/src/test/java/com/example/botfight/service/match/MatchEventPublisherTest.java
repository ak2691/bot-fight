package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.example.botfight.DTO.match.MatchEventType;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class MatchEventPublisherTest {
    private final Instant now = Instant.parse("2026-10-09T12:00:00Z");
    private final UUID id = UUID.randomUUID();
    private final MatchService matches = mock(MatchService.class);
    private final MatchScheduler scheduler = mock(MatchScheduler.class);
    private final SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
    private final MatchEventPublisher publisher = new MatchEventPublisher(messaging, matches, scheduler,
            mock(CustomLobbyService.class), mock(CustomLobbyStatePublisher.class), Clock.fixed(now, ZoneOffset.UTC));

    @BeforeEach void setUp() { when(matches.isCurrentEvent(any())).thenReturn(true); }
    private OutboundMatchmakingEvent event(MatchEventType type, long delay, Instant at) {
        return new OutboundMatchmakingEvent("one", MatchmakingEventDTO.builder().type(type).matchId(id)
                .roundNumber(1).status("SIMULATION_PREPARING").serverNow(now.minusSeconds(1)).build(), delay, at);
    }

    @Test void replayBatchesUseTheirAbsoluteTimelineAndCheckStalenessAtDelivery() {
        OutboundMatchmakingEvent event = event(MatchEventType.MATCH_REPLAY_BATCH, 1000, now.plusSeconds(2));
        publisher.publish(List.of(event));
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        verify(scheduler).publishAt(eq(id), any(), eq(now.plusSeconds(2)), task.capture());
        verifyNoInteractions(messaging);
        when(matches.isCurrentEvent(event)).thenReturn(false);
        task.getValue().run();
        verifyNoInteractions(messaging);
    }

    @Test void terminalResultUsesItsRevealBoundaryAndReleasesMatchResources() {
        OutboundMatchmakingEvent event = new OutboundMatchmakingEvent("one", MatchmakingEventDTO.builder()
                .type(MatchEventType.MATCH_RESULT_READY).matchId(id).resultRevealsAt(now.plusSeconds(3)).build(), 1);
        publisher.publish(List.of(event));
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        verify(scheduler).publishAt(eq(id), any(), eq(now.plusSeconds(3)), task.capture());
        verifyNoInteractions(messaging);
        task.getValue().run();
        verify(matches).revealCompletedMatchResult(id);
        verify(matches).expireCompletedMatch(id);
        verify(messaging).convertAndSendToUser(eq("one"), any(), any(MatchmakingEventDTO.class));
    }

    @Test void immediateTerminalResultCancelsPendingPublicationsAndDropsSiblingReplayEvents() {
        publisher.publish(List.of(event(MatchEventType.MATCH_REPLAY_BATCH, 1000, now.plusSeconds(1)),
                event(MatchEventType.MATCH_RESULT_READY, 0, null)));
        verify(scheduler).cancelPublications(id);
        verify(scheduler, never()).publishAt(any(), any(), any(), any());
        verify(messaging, times(1)).convertAndSendToUser(eq("one"), any(), any(MatchmakingEventDTO.class));
    }

    @Test void staleImmediateEventsNeverReachTheSocket() {
        when(matches.isCurrentEvent(any())).thenReturn(false);
        publisher.publish(event(MatchEventType.MATCH_LOADOUT_SELECTED, 0, null));
        verifyNoInteractions(messaging, scheduler);
    }

    @Test void phaseSchedulingDoesNotDependOnPublishingProjectedRoundEvents() {
        publisher.publish(event(MatchEventType.MATCH_ROUND_READY, 1000, now.plusSeconds(1)).scheduledDelivery());
        verifyNoInteractions(scheduler, messaging);
        verify(matches, never()).beginNextRound(any(), anyInt());
    }

    @Test void preparationRetainsItsAuthoredServerTimeWhileOtherEventsStampDeliveryTime() {
        publisher.publish(List.of(event(MatchEventType.SIMULATION_PREPARING, 0, null),
                event(MatchEventType.MATCH_LOADOUT_SELECTED, 0, null)));
        ArgumentCaptor<MatchmakingEventDTO> events = ArgumentCaptor.forClass(MatchmakingEventDTO.class);
        verify(messaging, times(2)).convertAndSendToUser(eq("one"), any(), events.capture());
        assertThat(events.getAllValues()).extracting(MatchmakingEventDTO::serverNow)
                .containsExactly(now.minusSeconds(1), now);
    }
}
