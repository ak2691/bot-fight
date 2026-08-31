package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.CustomLobbyDTO;
import com.example.botfight.DTO.CustomLobbyStateEventDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.DTO.MatchChatEventDTO;
import com.example.botfight.DTO.MatchChatRequestDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.matchmaking.MatchmakingEventsReady;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageType;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

class MatchmakingSocketControllerTest {

    @Test
    void schedulesRankedQueueSweepsEveryTwoSeconds() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        when(matchmakingService.sweepQueues()).thenReturn(List.of());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);

        controller.scheduleQueueMatchmakingSweep();
        verify(scheduler).scheduleWithFixedDelay(
                taskCaptor.capture(), eq(Duration.ofSeconds(2)));

        taskCaptor.getValue().run();

        verify(matchmakingService).sweepQueues();
    }

    @Test
    void queueResumeChecksTheServerAndReportsAnIdleQueueWithoutCreatingOne() {
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
        user.setId(userId);
        user.setUsername("pilot");
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(matchmakingService.resumePendingMatch(userId, "socket-new")).thenReturn(List.of());
        when(matchmakingService.resumeQueuedPlayer(userId, "socket-new")).thenReturn(List.of());
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create();
        headers.setSessionId("socket-new");

        controller.resumeQueue(authentication, headers);

        ArgumentCaptor<MatchmakingEventDTO> eventCaptor = ArgumentCaptor.forClass(MatchmakingEventDTO.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq(authentication.getName()),
                eq(MatchmakingSocketDestinations.MATCHMAKING),
                eventCaptor.capture());
        assertThat(eventCaptor.getValue().type()).isEqualTo("QUEUE_IDLE");
        assertThat(eventCaptor.getValue().status()).isEqualTo("IDLE");
        verify(matchmakingService, never()).joinQueue(any(), any(), any(), any());
    }

    @Test
    void matchSubscriptionRecognizesClientFacingUserDestination() {
        assertThat(MatchmakingSocketDestinations.isMatchSubscription(
                "/user" + MatchmakingSocketDestinations.MATCH)).isTrue();
    }

    @Test
    void removingTheMatchSubscriptionStartsConnectionLossDetection() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        doReturn(scheduledFuture).when(scheduler).schedule(any(Runnable.class), any(Instant.class));
        when(matchService.markDisconnected("pilot@example.com", "socket-1"))
                .thenReturn(List.of());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        Principal principal = () -> "pilot@example.com";
        Message<byte[]> subscribeMessage = stompMessage(
                SimpMessageType.SUBSCRIBE,
                MatchmakingSocketDestinations.MATCH,
                "socket-1",
                "match-subscription");
        SessionSubscribeEvent subscribeEvent = mock(SessionSubscribeEvent.class);
        when(subscribeEvent.getMessage()).thenReturn(subscribeMessage);
        controller.handleSubscribe(subscribeEvent);

        Message<byte[]> unsubscribeMessage = stompMessage(
                SimpMessageType.UNSUBSCRIBE,
                null,
                "socket-1",
                "match-subscription");
        SessionUnsubscribeEvent unsubscribeEvent = mock(SessionUnsubscribeEvent.class);
        when(unsubscribeEvent.getMessage()).thenReturn(unsubscribeMessage);
        when(unsubscribeEvent.getUser()).thenReturn(principal);
        controller.handleUnsubscribe(unsubscribeEvent);

        verify(scheduler).schedule(any(Runnable.class), any(Instant.class));
    }

    @Test
    void restoredMatchSubscriptionSkipsConnectionLossDetection() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        doReturn(mock(ScheduledFuture.class))
                .when(scheduler).schedule(taskCaptor.capture(), any(Instant.class));
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        Principal principal = () -> "pilot@example.com";

        SessionSubscribeEvent initialSubscribe = mock(SessionSubscribeEvent.class);
        when(initialSubscribe.getMessage()).thenReturn(stompMessage(
                SimpMessageType.SUBSCRIBE,
                MatchmakingSocketDestinations.MATCH,
                "socket-1",
                "match-subscription-1"));
        controller.handleSubscribe(initialSubscribe);

        SessionUnsubscribeEvent unsubscribe = mock(SessionUnsubscribeEvent.class);
        when(unsubscribe.getMessage()).thenReturn(stompMessage(
                SimpMessageType.UNSUBSCRIBE,
                null,
                "socket-1",
                "match-subscription-1"));
        when(unsubscribe.getUser()).thenReturn(principal);
        controller.handleUnsubscribe(unsubscribe);

        SessionSubscribeEvent restoredSubscribe = mock(SessionSubscribeEvent.class);
        when(restoredSubscribe.getMessage()).thenReturn(stompMessage(
                SimpMessageType.SUBSCRIBE,
                MatchmakingSocketDestinations.MATCH,
                "socket-1",
                "match-subscription-2"));
        controller.handleSubscribe(restoredSubscribe);

        taskCaptor.getValue().run();

        verify(matchService, never()).markDisconnected(any(), any());
    }

    @Test
    void acceptedChatIsPublishedOnlyAfterServerConfirmation() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
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
    void socketCloseStartsQueueGraceWhileMatchGraceWaitsForHeartbeatWindow() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
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

        verify(matchmakingService).markDisconnected("pilot@example.com", "socket-1");
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
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        SingleUserWebSocketSessionRegistry webSocketSessionRegistry =
                mock(SingleUserWebSocketSessionRegistry.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Instant> runAtCaptor = ArgumentCaptor.forClass(Instant.class);
        doReturn(scheduledFuture).when(scheduler).schedule(taskCaptor.capture(), runAtCaptor.capture());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                scheduler,
                webSocketSessionRegistry);
        UUID matchId = UUID.randomUUID();
        Instant closesAt = Instant.parse("2026-07-25T12:00:30Z");
        when(matchService.matchChatCloseAt(matchId)).thenReturn(closesAt.plusSeconds(1));
        when(webSocketSessionRegistry.currentSessionIdForPrincipal("pilot-one@example.com"))
                .thenReturn("socket-one");
        when(webSocketSessionRegistry.currentSessionIdForPrincipal("pilot-two@example.com"))
                .thenReturn("socket-two");
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
                new OutboundMatchmakingEvent("pilot-one@example.com", resultEvent),
                new OutboundMatchmakingEvent("pilot-two@example.com", resultEvent))));

        assertThat(runAtCaptor.getValue()).isEqualTo(closesAt);
        taskCaptor.getValue().run();

        verify(matchService).closeMatchChat(matchId);
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-one@example.com"),
                eq("/queue/match-chat"),
                any(MatchChatEventDTO.class),
                eq(Map.of(SimpMessageHeaderAccessor.SESSION_ID_HEADER, "socket-one")));
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-two@example.com"),
                eq("/queue/match-chat"),
                any(MatchChatEventDTO.class),
                eq(Map.of(SimpMessageHeaderAccessor.SESSION_ID_HEADER, "socket-two")));
    }

    private static Message<byte[]> stompMessage(
            SimpMessageType messageType,
            String destination,
            String sessionId,
            String subscriptionId) {
        MessageBuilder<byte[]> builder = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, messageType)
                .setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, sessionId)
                .setHeader(SimpMessageHeaderAccessor.SUBSCRIPTION_ID_HEADER, subscriptionId);
        if (destination != null) {
            builder.setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, destination);
        }
        return builder.build();
    }

    @Test
    void simulationLoadingSchedulesAuthoritativeSimulationAfterPublishingTheLoadingEvent() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
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
                new OutboundMatchmakingEvent("pilot-one@example.com", preparationEvent))));

        ArgumentCaptor<MatchmakingEventDTO> publishedEvent = ArgumentCaptor.forClass(MatchmakingEventDTO.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-one@example.com"), eq(MatchmakingSocketDestinations.MATCH), publishedEvent.capture());
        assertThat(publishedEvent.getValue().serverNow()).isAfter(loadingStartedAt);
        assertThat(runAtCaptor.getValue()).isNotNull();
        assertThat(runAtCaptor.getValue()).isBeforeOrEqualTo(Instant.now().plusSeconds(1));
        taskCaptor.getValue().run();

        verify(matchService).completeSimulation(matchId);
    }

    @Test
    void delayedReplayBatchesUseTheirAbsolutePublishTimeline() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Instant> runAtCaptor = ArgumentCaptor.forClass(Instant.class);
        doReturn(scheduledFuture).when(scheduler).schedule(any(Runnable.class), runAtCaptor.capture());
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        MatchmakingEventDTO firstBatch = mock(MatchmakingEventDTO.class);
        MatchmakingEventDTO secondBatch = mock(MatchmakingEventDTO.class);
        when(firstBatch.type()).thenReturn("MATCH_REPLAY_BATCH");
        when(secondBatch.type()).thenReturn("MATCH_REPLAY_BATCH");
        Instant firstPublishAt = Instant.parse("2026-07-25T12:00:01Z");
        Instant secondPublishAt = firstPublishAt.plusSeconds(1);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new OutboundMatchmakingEvent(
                        "pilot@example.com", firstBatch, 1_100L, firstPublishAt),
                new OutboundMatchmakingEvent(
                        "pilot@example.com", secondBatch, 2_200L, secondPublishAt))));

        assertThat(runAtCaptor.getAllValues()).containsExactly(firstPublishAt, secondPublishAt);
        verify(messagingTemplate, never()).convertAndSendToUser(any(), any(), any());
    }

    @Test
    void delayedTerminalResultIsScheduledAndDeliveredAtItsRevealTime() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Instant> runAtCaptor = ArgumentCaptor.forClass(Instant.class);
        doReturn(scheduledFuture).when(scheduler).schedule(taskCaptor.capture(), runAtCaptor.capture());
        CustomLobbyService customLobbyService = mock(CustomLobbyService.class);
        CustomLobbyStatePublisher customLobbyStatePublisher = mock(CustomLobbyStatePublisher.class);
        CustomLobbyDTO lobby = mock(CustomLobbyDTO.class);
        UUID lobbyId = UUID.randomUUID();
        CustomLobbyService.LobbyRecipient lobbyRecipient =
                new CustomLobbyService.LobbyRecipient("pilot@example.com", UUID.randomUUID());
        UUID matchId = UUID.randomUUID();
        when(customLobbyService.finishMatch(matchId)).thenReturn(new CustomLobbyService.LobbyChange(
                lobbyId,
                lobby,
                List.of(lobbyRecipient),
                List.of()));
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                null,
                null,
                scheduler,
                Runnable::run,
                new SingleUserWebSocketSessionRegistry(),
                customLobbyService,
                customLobbyStatePublisher);
        Instant revealAt = Instant.parse("2026-07-25T12:00:04Z");
        MatchmakingEventDTO result = mock(MatchmakingEventDTO.class);
        when(result.type()).thenReturn("MATCH_RESULT_READY");
        when(result.matchId()).thenReturn(matchId);
        when(result.withServerNow(any(Instant.class))).thenReturn(result);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new OutboundMatchmakingEvent("pilot@example.com", result, 4_000L, revealAt))));

        assertThat(runAtCaptor.getValue()).isEqualTo(revealAt);
        verify(messagingTemplate, never()).convertAndSendToUser(any(), any(), any());

        taskCaptor.getValue().run();

        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot@example.com"), eq(MatchmakingSocketDestinations.MATCH), eq(result));
        verify(matchService).expireCompletedMatch(matchId);
        verify(customLobbyService).finishMatch(matchId);
        verify(customLobbyStatePublisher).send(
                eq(List.of(lobbyRecipient)), any(CustomLobbyStateEventDTO.class));
    }

    @Test
    void confirmedDisconnectCancelsDelayedReplayAndRoundEvents() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> delayedReplay = mock(ScheduledFuture.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> delayedRound = mock(ScheduledFuture.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> disconnectDetection = mock(ScheduledFuture.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> disconnectTimeout = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        UUID matchId = UUID.randomUUID();
        Instant disconnectDeadline = Instant.now().plusSeconds(30);

        doReturn(delayedReplay, delayedRound, disconnectDetection, disconnectTimeout)
                .when(scheduler).schedule(any(Runnable.class), any(Instant.class));
        when(delayedReplay.isDone()).thenReturn(false);
        when(delayedRound.isDone()).thenReturn(false);

        MatchmakingEventDTO replayBatch = mock(MatchmakingEventDTO.class);
        when(replayBatch.type()).thenReturn("MATCH_REPLAY_BATCH");
        when(replayBatch.matchId()).thenReturn(matchId);
        MatchmakingEventDTO roundReady = mock(MatchmakingEventDTO.class);
        when(roundReady.type()).thenReturn("MATCH_ROUND_READY");
        when(roundReady.matchId()).thenReturn(matchId);
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new OutboundMatchmakingEvent("pilot@example.com", replayBatch, 1_000),
                new OutboundMatchmakingEvent("pilot@example.com", roundReady, 2_000))));

        MatchmakingEventDTO disconnected = mock(MatchmakingEventDTO.class);
        when(disconnected.type()).thenReturn("PLAYER_DISCONNECTED");
        when(disconnected.matchId()).thenReturn(matchId);
        when(disconnected.disconnectEndsAt()).thenReturn(disconnectDeadline);
        MatchmakingEventDTO result = mock(MatchmakingEventDTO.class);
        when(result.type()).thenReturn("MATCH_RESULT_READY");
        when(result.matchId()).thenReturn(matchId);
        when(disconnected.withServerNow(any(Instant.class))).thenReturn(disconnected);
        when(result.withServerNow(any(Instant.class))).thenReturn(result);
        when(matchService.markDisconnected(any(String.class), any(String.class)))
                .thenReturn(List.of(new OutboundMatchmakingEvent("pilot@example.com", disconnected)));
        when(matchService.resolveDisconnectTimeout(any(String.class), eq(disconnectDeadline)))
                .thenReturn(List.of(new OutboundMatchmakingEvent("pilot@example.com", result)));

        SessionDisconnectEvent disconnectEvent = mock(SessionDisconnectEvent.class);
        when(disconnectEvent.getUser()).thenReturn((Principal) () -> "pilot@example.com");
        when(disconnectEvent.getSessionId()).thenReturn("socket-1");

        controller.handleDisconnect(disconnectEvent);

        verify(scheduler, org.mockito.Mockito.times(3)).schedule(taskCaptor.capture(), any(Instant.class));
        taskCaptor.getAllValues().get(2).run();
        verify(scheduler, org.mockito.Mockito.times(4)).schedule(taskCaptor.capture(), any(Instant.class));
        taskCaptor.getAllValues().getLast().run();

        verify(delayedReplay).cancel(false);
        verify(delayedRound).cancel(false);
        verify(messagingTemplate, never()).convertAndSendToUser(
                any(), eq(MatchmakingSocketDestinations.MATCH), eq(replayBatch));
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot@example.com"), eq(MatchmakingSocketDestinations.MATCH), eq(result));
    }

    @Test
    void directTerminalResultCancelsDelayedMatchEvents() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> delayedReplay = mock(ScheduledFuture.class);
        when(delayedReplay.isDone()).thenReturn(false);
        doReturn(delayedReplay).when(scheduler).schedule(any(Runnable.class), any(Instant.class));

        UUID matchId = UUID.randomUUID();
        MatchmakingEventDTO replayBatch = mock(MatchmakingEventDTO.class);
        when(replayBatch.type()).thenReturn("MATCH_REPLAY_BATCH");
        when(replayBatch.matchId()).thenReturn(matchId);
        MatchmakingEventDTO result = mock(MatchmakingEventDTO.class);
        when(result.type()).thenReturn("MATCH_RESULT_READY");
        when(result.matchId()).thenReturn(matchId);
        when(result.withServerNow(any(Instant.class))).thenReturn(result);

        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new OutboundMatchmakingEvent("pilot@example.com", replayBatch, 1_000))));
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new OutboundMatchmakingEvent("pilot@example.com", result))));

        verify(delayedReplay).cancel(false);
    }

    @Test
    void terminalResultInTheSameBatchDoesNotScheduleStaleDelayedMatchEvents() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        UUID matchId = UUID.randomUUID();
        MatchmakingEventDTO replayBatch = mock(MatchmakingEventDTO.class);
        when(replayBatch.type()).thenReturn("MATCH_REPLAY_BATCH");
        when(replayBatch.matchId()).thenReturn(matchId);
        MatchmakingEventDTO result = mock(MatchmakingEventDTO.class);
        when(result.type()).thenReturn("MATCH_RESULT_READY");
        when(result.matchId()).thenReturn(matchId);
        when(result.withServerNow(any(Instant.class))).thenReturn(result);

        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(
                new OutboundMatchmakingEvent("pilot@example.com", replayBatch, 1_000),
                new OutboundMatchmakingEvent("pilot@example.com", result))));

        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot@example.com"), eq(MatchmakingSocketDestinations.MATCH), eq(result));
    }

    @Test
    void staleEventIsDroppedBeforeWebSocketDelivery() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        UUID matchId = UUID.randomUUID();
        MatchmakingEventDTO stale = mock(MatchmakingEventDTO.class);
        when(stale.matchId()).thenReturn(matchId);
        when(stale.type()).thenReturn("MATCH_LOADOUT_SELECTED");
        OutboundMatchmakingEvent outbound =
                new OutboundMatchmakingEvent("pilot@example.com", stale);
        when(matchService.isCurrentEvent(outbound)).thenReturn(false);

        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(outbound)));

        verify(messagingTemplate, never()).convertAndSendToUser(any(), any(), any());
    }

    @Test
    void staleImmediateEventDoesNotScheduleAuthoritativeWork() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        UUID matchId = UUID.randomUUID();
        MatchmakingEventDTO stale = mock(MatchmakingEventDTO.class);
        when(stale.matchId()).thenReturn(matchId);
        when(stale.type()).thenReturn("SIMULATION_LOADING");
        OutboundMatchmakingEvent outbound =
                new OutboundMatchmakingEvent("pilot@example.com", stale);
        when(matchService.isCurrentEvent(outbound)).thenReturn(false);

        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(outbound)));

        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
        verify(messagingTemplate, never()).convertAndSendToUser(any(), any(), any());
    }

    @Test
    void delayedRoundReadyActivatesTheSelectionDeadlineBeforeWebSocketDelivery() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        @SuppressWarnings("unchecked")
        ScheduledFuture<Object> scheduledFuture = mock(ScheduledFuture.class);
        ArgumentCaptor<Runnable> taskCaptor = ArgumentCaptor.forClass(Runnable.class);
        doReturn(scheduledFuture).when(scheduler).schedule(taskCaptor.capture(), any(Instant.class));
        UUID matchId = UUID.randomUUID();
        Instant phaseStart = Instant.parse("2026-07-25T12:01:00Z");
        Instant deadline = phaseStart.plusSeconds(62);
        MatchmakingEventDTO pending = new MatchmakingEventDTO(
                "MATCH_ROUND_READY",
                matchId,
                42L,
                "LOADOUT_SELECT",
                null,
                null,
                List.of(),
                phaseStart.minusSeconds(20),
                null,
                null,
                null,
                null,
                null,
                null,
                "duel-v1",
                null,
                2,
                2,
                "Round 2 loadout ready.",
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
                phaseStart,
                null,
                null,
                null,
                null);
        MatchmakingEventDTO activated = new MatchmakingEventDTO(
                "MATCH_ROUND_READY",
                matchId,
                42L,
                "LOADOUT_SELECT",
                null,
                null,
                List.of(),
                phaseStart,
                deadline,
                null,
                null,
                null,
                null,
                null,
                "duel-v1",
                null,
                2,
                2,
                "Round 2 loadout ready.",
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
                phaseStart,
                null,
                null,
                null,
                null);
        OutboundMatchmakingEvent pendingOutbound =
                new OutboundMatchmakingEvent("pilot@example.com", pending, 5_000);
        when(matchService.activateRoundLoadoutSelection(any()))
                .thenReturn(new OutboundMatchmakingEvent("pilot@example.com", activated));
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(pendingOutbound)));
        assertThat(taskCaptor.getAllValues()).hasSize(1);
        taskCaptor.getAllValues().getFirst().run();

        ArgumentCaptor<MatchmakingEventDTO> payloadCaptor = ArgumentCaptor.forClass(MatchmakingEventDTO.class);
        verify(matchService).activateRoundLoadoutSelection(pendingOutbound);
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot@example.com"), eq(MatchmakingSocketDestinations.MATCH), payloadCaptor.capture());
        assertThat(payloadCaptor.getValue().loadoutSelectionEndsAt()).isEqualTo(deadline);
    }
}
