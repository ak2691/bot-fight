package com.example.botfight.controller;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueueJoinRequest;
import com.example.botfight.service.party.PartyStatePublisher;
import com.example.botfight.support.TestDependencies;
import java.util.Objects;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;

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

import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.DTO.match.MatchChatEventDTO;
import com.example.botfight.DTO.match.MatchChatRequestDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingJoinRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.websocket.WebSocketSessionDisconnectedEvent;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
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
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;
import org.springframework.web.socket.WebSocketSession;

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
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));

        controller.joinQueue(new MatchmakingJoinRequestDTO("ONES"), principal, headers);

        verify(matchmakingService).joinQueue(ArgumentMatchers.argThat(request -> Objects.equals(request.userId(), user.getId()) && Objects.equals(request.username(), user.getUsername()) && Objects.equals(request.principalName(), "pilot@example.com") && Objects.equals(request.socketSessionId(), "queue-tab-two") && Objects.equals(request.partyId(), null)));
    }

    @Test
    void queueResumeChecksTheServerAndReportsAnIdleQueueWithoutCreatingOne() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));
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
        assertThat(eventCaptor.getValue().type()).isEqualTo(MatchEventType.QUEUE_IDLE);
        assertThat(eventCaptor.getValue().status()).isEqualTo("IDLE");
        verify(matchmakingService, never()).joinQueue(ArgumentMatchers.any(QueueJoinRequest.class));
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
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));
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
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));
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
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));
        Authentication authentication = mock(Authentication.class);
        AppUser user = new AppUser();
        UUID userId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        UUID messageId = UUID.randomUUID();
        user.setId(userId);
        user.setUsername("pilot-one");
        when(authentication.getName()).thenReturn("pilot-one@example.com");
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(matchService.submitChatMessage(userId, matchId, "hello", "ALL")).thenReturn(new MatchChatSubmission(MatchChatSubmissionStatus.ACCEPTED, messageId, matchId, "pilot-one", "hello", Instant.parse("2026-07-25T12:00:00Z"), List.of("pilot-one@example.com", "pilot-two@example.com"), "ALL", List.of()));

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
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));
        Principal principal = () -> "pilot@example.com";
        Instant beforeClose = Instant.now();

        controller.handleDisconnect(new WebSocketSessionDisconnectedEvent(
                this, principal.getName(), "socket-1", true, principal));

        verify(matchmakingService).markDisconnected("pilot@example.com", "socket-1");
        verify(matchService, never()).markDisconnected(any(), any());
        assertThat(runAtCaptor.getValue())
                .isBetween(beforeClose.plusSeconds(10), Instant.now().plusSeconds(10));

        taskCaptor.getValue().run();

        verify(matchService, never()).markDisconnected("pilot@example.com", "socket-1");
    }

    @Test
    void closingOneOfSeveralTabsUnregistersOnlyThatSocketAndKeepsUserState() {
        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        MatchService matchService = mock(MatchService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        MatchmakingSocketController controller = com.example.botfight.support.TestMatchSockets.controller(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                TestDependencies.partyService(),
                Mockito.mock(PartyStatePublisher.class),
                scheduler,
                task -> scheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(event -> {}, SingleUserWebSocketSessionRegistry.DEFAULT_MAX_SESSIONS_PER_PRINCIPAL),
                Mockito.mock(CustomLobbyService.class),
                Mockito.mock(CustomLobbyStatePublisher.class));
        Principal principal = () -> "pilot@example.com";

        controller.handleDisconnect(new WebSocketSessionDisconnectedEvent(
                this, principal.getName(), "socket-one", false, principal));

        verify(matchService).unregisterSocketSession("pilot@example.com", "socket-one");
        verify(matchmakingService, never()).markDisconnected(any(), any());
        verify(matchService, never()).markDisconnected(any(), any());
        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
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

}
