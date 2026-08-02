package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.service.CurrentUserService;
import com.example.botfight.DTO.MatchChatEventDTO;
import com.example.botfight.DTO.MatchChatRequestDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.MatchService;
import com.example.botfight.service.MatchService.MatchChatClosure;
import com.example.botfight.service.MatchService.MatchChatSubmission;
import com.example.botfight.service.MatchService.MatchChatSubmissionStatus;
import com.example.botfight.service.MatchmakingEventsReady;
import com.example.botfight.service.MatchmakingService;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

class MatchmakingSocketControllerTest {

    @Test
    void acceptedChatIsPublishedOnlyAfterServerConfirmation() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        Authentication authentication = mock(Authentication.class);
        AppUser user = new AppUser();
        UUID userId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        UUID messageId = UUID.randomUUID();
        user.setId(userId);
        user.setUsername("pilot-one");
        when(authentication.getName()).thenReturn("pilot-one@example.com");
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(matchService.submitChatMessage(userId, matchId, "hello")).thenReturn(new MatchChatSubmission(
                MatchChatSubmissionStatus.ACCEPTED,
                messageId,
                matchId,
                "pilot-one",
                "hello",
                Instant.parse("2026-07-25T12:00:00Z"),
                List.of("pilot-one@example.com", "pilot-two@example.com")));

        controller.chat(new MatchChatRequestDTO(matchId, "hello"), authentication);

        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-one@example.com"), eq("/queue/match-chat"), any(MatchChatEventDTO.class));
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-two@example.com"), eq("/queue/match-chat"), any(MatchChatEventDTO.class));
    }

    @Test
    void socketCloseWaitsForHeartbeatWindowBeforeStartingDisconnectGracePeriod() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Instant> runAtCaptor = ArgumentCaptor.forClass(Instant.class);
        doReturn(scheduledFuture).when(scheduler).schedule(taskCaptor.capture(), runAtCaptor.capture());
        when(matchService.markDisconnected("pilot@example.com", "socket-1"))
                .thenReturn(List.of());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                scheduler);
        SessionDisconnectEvent event = mock(SessionDisconnectEvent.class);
        Principal principal = () -> "pilot@example.com";
        when(event.getUser()).thenReturn(principal);
        when(event.getSessionId()).thenReturn("socket-1");
        Instant beforeClose = Instant.now();

        controller.handleDisconnect(event);

        verify(matchmakingService).removeDisconnected("pilot@example.com", "socket-1");
        verify(matchService, never()).markDisconnected(any(), any());
        assertThat(runAtCaptor.getValue())
                .isBetween(beforeClose.plusSeconds(10), Instant.now().plusSeconds(10));

        taskCaptor.getValue().run();

        verify(matchService).markDisconnected("pilot@example.com", "socket-1");
    }

    @Test
    void terminalMatchSchedulesBackendChatClosureAndNotifiesBothPlayers() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Instant> runAtCaptor = ArgumentCaptor.forClass(Instant.class);
        doReturn(scheduledFuture).when(scheduler).schedule(taskCaptor.capture(), runAtCaptor.capture());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        UUID matchId = UUID.randomUUID();
        Instant closesAt = Instant.parse("2026-07-25T12:00:30Z");
        when(matchService.matchChatCloseAt(matchId)).thenReturn(closesAt.plusSeconds(1));
        when(matchService.closeMatchChat(matchId)).thenReturn(new MatchChatClosure(
                matchId,
                "Match chat is now closed.",
                List.of("pilot-one@example.com", "pilot-two@example.com")));
        MatchmakingEventDTO resultEvent = new MatchmakingEventDTO(
                "MATCH_RESULT_READY",
                matchId,
                null,
                "RESULT_READY",
                null,
                null,
                List.of(),
                Instant.parse("2026-07-25T12:00:00Z"),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "The match is complete.",
                null,
                List.of(),
                List.of(),
                List.of(),
                null,
                List.of(),
                null,
                null,
                null,
                null,
                null,
                closesAt);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new MatchService.OutboundMatchmakingEvent("pilot-one@example.com", resultEvent))));

        assertThat(runAtCaptor.getValue()).isEqualTo(closesAt);
        taskCaptor.getValue().run();

        verify(matchService).closeMatchChat(matchId);
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-one@example.com"), eq("/queue/match-chat"), any(MatchChatEventDTO.class));
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-two@example.com"), eq("/queue/match-chat"), any(MatchChatEventDTO.class));
    }

    @Test
    void simulationLoadingSchedulesAuthoritativeSimulationAfterPublishingTheLoadingEvent() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Instant> runAtCaptor = ArgumentCaptor.forClass(Instant.class);
        doReturn(scheduledFuture).when(scheduler).schedule(taskCaptor.capture(), runAtCaptor.capture());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        UUID matchId = UUID.randomUUID();
        Instant loadingStartedAt = Instant.parse("2026-07-25T12:00:00Z");
        MatchmakingEventDTO preparationEvent = new MatchmakingEventDTO(
                "SIMULATION_LOADING",
                matchId,
                42L,
                "SIMULATION_LOADING",
                null,
                null,
                List.of(),
                loadingStartedAt,
                null,
                null,
                null,
                null,
                null,
                null,
                "duel-v1",
                null,
                1,
                2,
                "Loading the authoritative round replay.",
                null,
                List.of(),
                List.of(),
                List.of(),
                null,
                List.of(),
                100,
                null,
                null,
                null,
                null,
                null);
        when(matchService.completeSimulation(matchId)).thenReturn(List.of());

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new MatchService.OutboundMatchmakingEvent("pilot-one@example.com", preparationEvent))));

        ArgumentCaptor<MatchmakingEventDTO> publishedEvent = ArgumentCaptor.forClass(MatchmakingEventDTO.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-one@example.com"), eq("/queue/matchmaking"), publishedEvent.capture());
        assertThat(publishedEvent.getValue().serverNow()).isAfter(loadingStartedAt);
        assertThat(runAtCaptor.getValue()).isNotNull();
        assertThat(runAtCaptor.getValue()).isBeforeOrEqualTo(Instant.now().plusSeconds(1));
        taskCaptor.getValue().run();

        verify(matchService).completeSimulation(matchId);
    }
}
