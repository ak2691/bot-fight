package com.example.botfight.service.customlobby;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.domain.chatmoderation.ChatContextType;
import com.example.botfight.service.chatmoderation.ChatEvidenceRecorder;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class CustomLobbyChatServiceTest {

    private final Clock clock = Clock.fixed(
            Instant.parse("2026-08-28T12:00:00Z"),
            ZoneOffset.UTC);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final MatchService matchService = mock(MatchService.class);
    private final SingleUserWebSocketSessionRegistry socketRegistry =
            mock(SingleUserWebSocketSessionRegistry.class);
    private final PartyService partyService = mock(PartyService.class);
    private final Authentication authentication = mock(Authentication.class);
    private final AppUser owner = user("owner", "owner@example.test");
    private final AppUser teammate = user("teammate", "teammate@example.test");
    private final AppUser outsider = user("outsider", "outsider@example.test");
    private final CustomLobbyService lobbyService = new CustomLobbyService(
            currentUserService,
            userRepository,
            matchService,
            new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(10)),
            new TokenBucketRateLimiter<>(clock, 1, Duration.ofMillis(500)),
            clock,
            BlockLookup.none(),
            socketRegistry,
            partyService);
    private final CustomLobbyChatService chatService = new CustomLobbyChatService(
            clock,
            lobbyService,
            new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)),
            BlockLookup.none());

    @BeforeEach
    void setUp() {
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
        when(socketRegistry.currentSessionIdForPrincipal(owner.getEmail())).thenReturn("owner-socket");
        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail())).thenReturn("teammate-socket");
        when(partyService.prepareForCustomMatch(anyCollection())).thenReturn(List.of());
    }

    @Test
    void lobbyChatRequiresMembershipAndSendsOnlyToCurrentLobbyMembers() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = lobbyService.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("teammate"))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite invite = lobbyService.invite(
                authentication,
                lobby.lobbyId(),
                teammate.getUsername());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        lobbyService.accept(authentication, invite.invite().inviteId());

        CustomLobbyChatSubmission accepted = chatService.submit(
                owner.getId(),
                owner.getEmail(),
                lobby.lobbyId(),
                "hello lobby");
        CustomLobbyChatSubmission rejected = chatService.submit(
                outsider.getId(),
                outsider.getEmail(),
                lobby.lobbyId(),
                "sneaking in");

        assertThat(accepted.status()).isEqualTo(CustomLobbyChatSubmissionStatus.ACCEPTED);
        assertThat(accepted.recipientPrincipalNames())
                .containsExactlyInAnyOrder(owner.getEmail(), teammate.getEmail());
        assertThat(rejected.status()).isEqualTo(CustomLobbyChatSubmissionStatus.REJECTED);
        assertThat(rejected.recipientPrincipalNames()).isEmpty();
    }

    @Test
    void acceptedMessageEvidenceCapturesOnlyServerComputedLobbyRecipients() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = lobbyService.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("teammate"))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite invite = lobbyService.invite(
                authentication, lobby.lobbyId(), teammate.getUsername());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        lobbyService.accept(authentication, invite.invite().inviteId());
        AtomicReference<CapturedEvidence> captured = new AtomicReference<>();
        ChatEvidenceRecorder recorder = (messageId, contextType, contextId, userId, username, sentAt, text, recipients) ->
                captured.set(new CapturedEvidence(messageId, contextType, contextId, userId, username, sentAt, text, List.copyOf(recipients)));
        CustomLobbyChatService recordingChat = new CustomLobbyChatService(
                clock,
                lobbyService,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)),
                BlockLookup.none(),
                recorder);

        var accepted = recordingChat.submit(owner.getId(), owner.getEmail(), lobby.lobbyId(), "  safe snapshot  ");

        assertThat(captured.get().messageId()).isEqualTo(accepted.messageId());
        assertThat(captured.get().contextType()).isEqualTo(ChatContextType.CUSTOM_LOBBY);
        assertThat(captured.get().contextId()).isEqualTo(lobby.lobbyId());
        assertThat(captured.get().senderId()).isEqualTo(owner.getId());
        assertThat(captured.get().text()).isEqualTo("safe snapshot");
        assertThat(captured.get().recipientIds()).containsExactlyInAnyOrder(owner.getId(), teammate.getId());
    }

    private record CapturedEvidence(
            UUID messageId,
            ChatContextType contextType,
            UUID contextId,
            UUID senderId,
            String senderUsername,
            Instant sentAt,
            String text,
            List<UUID> recipientIds) {
    }

    private static AppUser user(String username, String email) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(email);
        return user;
    }
}
