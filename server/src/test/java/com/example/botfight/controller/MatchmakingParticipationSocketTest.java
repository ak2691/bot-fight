package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.anyList;

import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingJoinRequestDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyStateEventDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.customlobby.CustomLobbyChatService;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.loadout.MatchAbilityGuaranteeService;
import com.example.botfight.service.matchmaking.MatchParticipationCoordinator;
import com.example.botfight.service.matchmaking.MatchmakingService;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.security.core.Authentication;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.mockito.ArgumentCaptor;

class MatchmakingParticipationSocketTest {

    @Test
    void craftedStompQueueJoinCannotQueueACustomLobbyMember() {
        Clock clock = Clock.fixed(java.time.Instant.parse("2026-09-01T12:00:00Z"), ZoneOffset.UTC);
        UUID userId = UUID.randomUUID();
        AppUser user = new AppUser();
        user.setId(userId);
        user.setUsername("lobby-member");
        user.setEmail("lobby-member@example.test");
        MatchParticipationCoordinator coordinator = new MatchParticipationCoordinator();
        assertThat(coordinator.claimCustomLobby(userId, UUID.randomUUID())).isTrue();

        MatchService matchService = mock(MatchService.class);
        when(matchService.activeMatchStatus(userId))
                .thenReturn(com.example.botfight.DTO.match.ActiveMatchStatusDTO.none());
        when(matchService.isMatchStartReserved(userId)).thenReturn(false);
        MatchmakingService matchmakingService = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)),
                null,
                new MatchAbilityGuaranteeService(),
                coordinator);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        Authentication authentication = mock(Authentication.class);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(authentication.getName()).thenReturn(user.getEmail());
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        MatchmakingSocketController controller = new MatchmakingSocketController(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                mock(TaskScheduler.class));
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create();
        headers.setSessionId("lobby-member-socket");

        Throwable failure = catchThrowable(() -> controller.joinQueue(
                new MatchmakingJoinRequestDTO("ONES"), authentication, headers));

        assertThat(failure)
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("Leave the custom lobby");
        controller.handleMatchmakingError((AuthException) failure, authentication);

        ArgumentCaptor<MatchmakingEventDTO> event = ArgumentCaptor.forClass(MatchmakingEventDTO.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq(authentication.getName()),
                eq(MatchmakingSocketDestinations.MATCHMAKING),
                event.capture());
        assertThat(event.getValue().type()).isEqualTo("MATCH_ERROR");
        assertThat(event.getValue().message()).contains("Leave the custom lobby");
        assertThat(matchmakingService.hasTransientActivity(userId)).isFalse();
        assertThat(coordinator.isCustomLobbyMember(userId)).isTrue();
    }

    @Test
    void customLobbySubscriptionDoesNotExposeLobbyStateToRankedParticipants() {
        UUID userId = UUID.randomUUID();
        AppUser user = new AppUser();
        user.setId(userId);
        user.setUsername("ranked-player");
        user.setEmail("ranked-player@example.test");
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn(user.getEmail());
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        CustomLobbyService customLobbyService = mock(CustomLobbyService.class);
        when(customLobbyService.isRankedParticipant(userId)).thenReturn(true);
        CustomLobbyStatePublisher statePublisher = mock(CustomLobbyStatePublisher.class);
        CustomLobbySocketController controller = new CustomLobbySocketController(
                customLobbyService,
                statePublisher,
                mock(CustomLobbyChatService.class),
                currentUserService);
        var message = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.SUBSCRIBE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/user/queue/custom-lobby")
                .setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, "ranked-socket")
                .setHeader(SimpMessageHeaderAccessor.SUBSCRIPTION_ID_HEADER, "custom-lobby-subscription")
                .build();
        SessionSubscribeEvent event = mock(SessionSubscribeEvent.class);
        when(event.getMessage()).thenReturn(message);
        when(event.getUser()).thenReturn(authentication);

        controller.handleSubscribe(event);

        ArgumentCaptor<CustomLobbyStateEventDTO> stateEvent =
                ArgumentCaptor.forClass(CustomLobbyStateEventDTO.class);
        verify(statePublisher).send(anyList(), stateEvent.capture());
        assertThat(stateEvent.getValue().lobby()).isNull();
        assertThat(stateEvent.getValue().message()).contains("Leave ranked matchmaking");
        verify(customLobbyService, never()).registerSocket(any(), any());
        verify(customLobbyService, never()).currentForPrincipal(any());
    }
}
