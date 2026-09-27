package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.customlobby.CustomLobbyDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyStateEventDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.DTO.match.MatchChatEventDTO;
import com.example.botfight.DTO.match.MatchChatRequestDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingJoinRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.matchmaking.MatchmakingEventsReady;
import com.example.botfight.service.websocket.WebSocketSessionDisconnectedEvent;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageType;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.handler.TextWebSocketHandler;

class MatchmakingSocketControllerTest {

    @Test
    void queueJoinUsesTheAuthenticatedUserFromAnyTabSession() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        Authentication principal = mock(Authentication.class);
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername("pilot");
        user.setEmail("pilot@example.com");
        when(principal.getName()).thenReturn("pilot@example.com");
        when(currentUserService.requireCurrentUser(principal)).thenReturn(user);
        SimpMessageHeaderAccessor headers = mock(SimpMessageHeaderAccessor.class);
        when(headers.getSessionId()).thenReturn("queue-tab-two");
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);

        controller.joinQueue(new MatchmakingJoinRequestDTO("ONES"), principal, headers);

        verify(matchmakingService).joinQueue(
                eq(user.getId()),
                eq(user.getUsername()),
                eq("pilot@example.com"),
                eq("queue-tab-two"),
                any(),
                any(),
                eq(null),
                any(),
                any());
    }

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
    void removingTheMatchSubscriptionDoesNotStartDisconnectGraceWithoutSocketClose() {
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

        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
    }

    @Test
    void restoredMatchSubscriptionSkipsConnectionLossDetection() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
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

        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
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
        Principal principal = () -> "pilot@example.com";
        Instant beforeClose = Instant.now();

        controller.handleDisconnect(new WebSocketSessionDisconnectedEvent(
                this, principal.getName(), "socket-1", true, principal));

        verify(matchmakingService).markDisconnected("pilot@example.com", "socket-1");
        verify(matchService, never()).markDisconnected(any(), any());
        assertThat(runAtCaptor.getValue())
                .isBetween(beforeClose.plusSeconds(10), Instant.now().plusSeconds(10));

        taskCaptor.getValue().run();

        verify(matchService).markDisconnected("pilot@example.com", "socket-1");
    }

    @Test
    void closingOneOfSeveralTabsUnregistersOnlyThatSocketAndKeepsUserState() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        Principal principal = () -> "pilot@example.com";

        controller.handleDisconnect(new WebSocketSessionDisconnectedEvent(
                this, principal.getName(), "socket-one", false, principal));

        verify(matchService).unregisterSocketSession("pilot@example.com", "socket-one");
        verify(matchmakingService, never()).markDisconnected(any(), any());
        verify(matchService, never()).markDisconnected(any(), any());
        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
    }

    @Test
    void terminalChatEventTargetsEveryActiveTabThroughTheUserDestination() throws Exception {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        SingleUserWebSocketSessionRegistry webSocketSessionRegistry =
                new SingleUserWebSocketSessionRegistry();
        Principal firstPlayer = () -> "pilot-one@example.com";
        WebSocketHandler decorated = webSocketSessionRegistry.decoratorFactory()
                .decorate(new TextWebSocketHandler());
        decorated.afterConnectionEstablished(socketSession("socket-one", firstPlayer));
        decorated.afterConnectionEstablished(socketSession("socket-one-tab-two", firstPlayer));
        assertThat(webSocketSessionRegistry.sessionIdsForPrincipal(firstPlayer.getName()))
                .hasSize(2);
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
                any(MatchChatEventDTO.class));
        verify(messagingTemplate).convertAndSendToUser(
                eq("pilot-two@example.com"),
                eq("/queue/match-chat"),
                any(MatchChatEventDTO.class));
        verify(messagingTemplate, times(2)).convertAndSendToUser(
                any(String.class),
                eq("/queue/match-chat"),
                any(MatchChatEventDTO.class));
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

    private static WebSocketSession socketSession(String id, Principal principal) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.getPrincipal()).thenReturn(principal);
        when(session.isOpen()).thenReturn(true);
        return session;
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

        Principal principal = () -> "pilot@example.com";
        controller.handleDisconnect(new WebSocketSessionDisconnectedEvent(
                this, principal.getName(), "socket-1", true, principal));

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

    @Test
    void duplicateSimulationEventsShareOneInFlightTaskAndSuccessfulWorkReleasesItsKey() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        AsyncTaskExecutor executor = mock(AsyncTaskExecutor.class);
        List<Runnable> simulationTasks = new java.util.ArrayList<>();
        doAnswer(invocation -> {
            simulationTasks.add(invocation.getArgument(0));
            return null;
        }).when(executor).execute(any(Runnable.class));

        UUID matchId = UUID.randomUUID();
        OutboundMatchmakingEvent loading = simulationLoadingEvent(matchId, 1);
        when(matchService.completeSimulation(matchId)).thenReturn(List.of());
        MatchmakingSocketController controller = controllerWithSimulationExecutor(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler, executor);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(loading)));
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(loading)));

        verify(executor, times(1)).execute(any(Runnable.class));
        assertThat(inFlightKeys(controller, "scheduledSimulations")).hasSize(1);

        simulationTasks.getFirst().run();

        verify(matchService, times(1)).completeSimulation(matchId);
        assertThat(inFlightKeys(controller, "scheduledSimulations")).isEmpty();
    }

    @Test
    void transientSimulationFailureRetriesAndCleansUpTheKeyAfterSuccess() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        AsyncTaskExecutor executor = mock(AsyncTaskExecutor.class);
        List<Runnable> simulationTasks = new java.util.ArrayList<>();
        List<Runnable> retryTasks = new java.util.ArrayList<>();
        doAnswer(invocation -> {
            simulationTasks.add(invocation.getArgument(0));
            return null;
        }).when(executor).execute(any(Runnable.class));
        doAnswer(invocation -> {
            retryTasks.add(invocation.getArgument(0));
            return mock(ScheduledFuture.class);
        }).when(scheduler).schedule(any(Runnable.class), any(Instant.class));

        UUID matchId = UUID.randomUUID();
        OutboundMatchmakingEvent loading = simulationLoadingEvent(matchId, 1);
        when(matchService.completeSimulation(matchId))
                .thenThrow(new IllegalStateException("temporary database outage"))
                .thenReturn(List.of());
        MatchmakingSocketController controller = controllerWithSimulationExecutor(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler, executor);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(loading)));
        simulationTasks.getFirst().run();

        assertThat(inFlightKeys(controller, "scheduledSimulations")).hasSize(1);
        assertThat(retryTasks).hasSize(1);
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(loading)));
        verify(executor, times(1)).execute(any(Runnable.class));

        retryTasks.getFirst().run();
        assertThat(simulationTasks).hasSize(2);
        simulationTasks.getLast().run();

        verify(matchService, times(2)).completeSimulation(matchId);
        assertThat(inFlightKeys(controller, "scheduledSimulations")).isEmpty();
        verify(matchService, never()).cancelFailedSimulation(any(), any());
    }

    @Test
    void executorRejectionRetriesWithinTheBoundAndCancelsWithoutAResultAfterExhaustion() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        AsyncTaskExecutor executor = mock(AsyncTaskExecutor.class);
        List<Runnable> retryTasks = new java.util.ArrayList<>();
        doThrow(new RejectedExecutionException("executor queue is full"))
                .when(executor).execute(any(Runnable.class));
        doAnswer(invocation -> {
            retryTasks.add(invocation.getArgument(0));
            return mock(ScheduledFuture.class);
        }).when(scheduler).schedule(any(Runnable.class), any(Instant.class));

        UUID matchId = UUID.randomUUID();
        OutboundMatchmakingEvent loading = simulationLoadingEvent(matchId, 1);
        when(matchService.cancelFailedSimulation(matchId, 1)).thenReturn(List.of());
        MatchmakingSocketController controller = controllerWithSimulationExecutor(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler, executor);

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(loading)));
        assertThat(retryTasks).hasSize(1);
        retryTasks.getFirst().run();
        assertThat(retryTasks).hasSize(2);
        retryTasks.getLast().run();

        verify(executor, times(3)).execute(any(Runnable.class));
        verify(matchService).cancelFailedSimulation(matchId, 1);
        assertThat(inFlightKeys(controller, "scheduledSimulations")).isEmpty();
    }

    @Test
    void staleBuildingAndLoadoutTimeoutCallbacksAreDroppedAndReleaseTheirKeys() {
        assertStaleTimeoutDoesNotResolve(false);
        assertStaleTimeoutDoesNotResolve(true);
    }

    @Test
    void rejectedTimeoutSchedulingReleasesItsDedupeKey() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        doThrow(new RejectedExecutionException("scheduler is stopping"))
                .when(scheduler).schedule(any(Runnable.class), any(Instant.class));
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        OutboundMatchmakingEvent timeoutEvent = buildingTimeoutEvent(
                UUID.randomUUID(), Instant.now().plusSeconds(30));

        assertThatThrownBy(() -> controller.handleMatchmakingEventsReady(
                new MatchmakingEventsReady(List.of(timeoutEvent))))
                .isInstanceOf(RejectedExecutionException.class);

        assertThat(inFlightKeys(controller, "scheduledBuildingTimeouts")).isEmpty();
    }

    @Test
    void timeoutDeduplicationKeysReturnToZeroAcrossManyDeadlines() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true);
        when(matchService.resolveBuildingTimeout(any(), any())).thenReturn(List.of());
        when(matchService.resolveLoadoutSelectionTimeout(any())).thenReturn(List.of());
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        List<Runnable> scheduledTasks = new java.util.ArrayList<>();
        doAnswer(invocation -> {
            scheduledTasks.add(invocation.getArgument(0));
            return mock(ScheduledFuture.class);
        }).when(scheduler).schedule(any(Runnable.class), any(Instant.class));
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        List<OutboundMatchmakingEvent> buildingEvents = new java.util.ArrayList<>();
        List<OutboundMatchmakingEvent> loadoutEvents = new java.util.ArrayList<>();
        Instant baseDeadline = Instant.now().plusSeconds(30);
        for (int index = 0; index < 64; index++) {
            UUID buildingMatchId = UUID.randomUUID();
            buildingEvents.add(buildingTimeoutEvent(
                    buildingMatchId, baseDeadline.plusSeconds(index)));
            UUID loadoutMatchId = UUID.randomUUID();
            loadoutEvents.add(loadoutTimeoutEvent(
                    loadoutMatchId, baseDeadline.plusSeconds(index)));
        }

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(buildingEvents));
        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(loadoutEvents));

        assertThat(scheduledTasks).hasSize(128);
        scheduledTasks.forEach(Runnable::run);
        assertThat(inFlightKeys(controller, "scheduledBuildingTimeouts")).isEmpty();
        assertThat(inFlightKeys(controller, "scheduledLoadoutSelectionTimeouts")).isEmpty();
    }

    private void assertStaleTimeoutDoesNotResolve(boolean loadoutTimeout) {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        when(matchService.isCurrentEvent(any())).thenReturn(true, true, false);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        List<Runnable> scheduledTasks = new java.util.ArrayList<>();
        doAnswer(invocation -> {
            scheduledTasks.add(invocation.getArgument(0));
            return mock(ScheduledFuture.class);
        }).when(scheduler).schedule(any(Runnable.class), any(Instant.class));
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService, matchService, messagingTemplate, currentUserService, scheduler);
        UUID matchId = UUID.randomUUID();
        OutboundMatchmakingEvent timeoutEvent = loadoutTimeout
                ? loadoutTimeoutEvent(matchId, Instant.now().plusSeconds(30))
                : buildingTimeoutEvent(matchId, Instant.now().plusSeconds(30));

        controller.handleMatchmakingEventsReady(new MatchmakingEventsReady(List.of(timeoutEvent)));
        assertThat(scheduledTasks).hasSize(1);
        scheduledTasks.getFirst().run();

        if (loadoutTimeout) {
            verify(matchService, never()).resolveLoadoutSelectionTimeout(matchId);
            assertThat(inFlightKeys(controller, "scheduledLoadoutSelectionTimeouts")).isEmpty();
        } else {
            verify(matchService, never()).resolveBuildingTimeout(any(), any());
            assertThat(inFlightKeys(controller, "scheduledBuildingTimeouts")).isEmpty();
        }
    }

    private static MatchmakingSocketController controllerWithSimulationExecutor(
            MatchmakingService matchmakingService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            CurrentUserService currentUserService,
            TaskScheduler scheduler,
            AsyncTaskExecutor simulationExecutor) {
        return new MatchmakingSocketController(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                null,
                null,
                scheduler,
                simulationExecutor,
                new SingleUserWebSocketSessionRegistry(),
                null,
                null);
    }

    private static OutboundMatchmakingEvent simulationLoadingEvent(UUID matchId, int roundNumber) {
        MatchmakingEventDTO event = mock(MatchmakingEventDTO.class);
        when(event.type()).thenReturn("SIMULATION_LOADING");
        when(event.status()).thenReturn("SIMULATION_LOADING");
        when(event.matchId()).thenReturn(matchId);
        when(event.roundNumber()).thenReturn(roundNumber);
        when(event.withServerNow(any(Instant.class))).thenReturn(event);
        return new OutboundMatchmakingEvent("pilot@example.com", event);
    }

    private static OutboundMatchmakingEvent buildingTimeoutEvent(UUID matchId, Instant deadline) {
        MatchmakingEventDTO event = mock(MatchmakingEventDTO.class);
        when(event.type()).thenReturn("BOT_BUILDING_SESSION_READY");
        when(event.status()).thenReturn("PREP");
        when(event.matchId()).thenReturn(matchId);
        when(event.buildingEndsAt()).thenReturn(deadline);
        when(event.withServerNow(any(Instant.class))).thenReturn(event);
        return new OutboundMatchmakingEvent("pilot@example.com", event);
    }

    private static OutboundMatchmakingEvent loadoutTimeoutEvent(UUID matchId, Instant deadline) {
        MatchmakingEventDTO event = mock(MatchmakingEventDTO.class);
        when(event.type()).thenReturn("MATCH_LOADOUT_SELECTION_READY");
        when(event.status()).thenReturn("LOADOUT_SELECT");
        when(event.matchId()).thenReturn(matchId);
        when(event.loadoutSelectionEndsAt()).thenReturn(deadline);
        when(event.withServerNow(any(Instant.class))).thenReturn(event);
        return new OutboundMatchmakingEvent("pilot@example.com", event);
    }

    @SuppressWarnings("unchecked")
    private static Set<String> inFlightKeys(MatchmakingSocketController controller, String fieldName) {
        return (Set<String>) ReflectionTestUtils.getField(controller, fieldName);
    }
}
