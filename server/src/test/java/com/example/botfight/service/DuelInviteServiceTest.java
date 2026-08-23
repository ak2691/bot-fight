package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.DuelInvite;
import com.example.botfight.domain.DuelInviteStatus;
import com.example.botfight.repository.DuelInviteRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.invite.DuelInviteService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class DuelInviteServiceTest {

    private final Instant now = Instant.parse("2026-08-22T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final DuelInviteRepository inviteRepository = mock(DuelInviteRepository.class);
    private final MatchService matchService = mock(MatchService.class);
    private final MatchmakingService matchmakingService = mock(MatchmakingService.class);
    private final SingleUserWebSocketSessionRegistry socketRegistry = mock(SingleUserWebSocketSessionRegistry.class);
    private final Authentication authentication = mock(Authentication.class);
    private final AppUser inviter = user("alice", "alice@example.test");
    private final AppUser invitee = user("bob", "bob@example.test");
    private final DuelInviteService service = new DuelInviteService(
            currentUserService,
            userRepository,
            inviteRepository,
            matchService,
            matchmakingService,
            socketRegistry,
            new TokenBucketRateLimiter<>(clock, 1, Duration.ofSeconds(10)),
            clock);

    @BeforeEach
    void defaultMatchStatus() {
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
    }

    @Test
    void createsOneInviteAndAppliesTheTenSecondPerSenderLimit() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(inviter);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("bob"))
                .thenReturn(Optional.of(invitee));
        when(inviteRepository.findPendingBetweenUsers(inviter.getId(), invitee.getId(), DuelInviteStatus.PENDING))
                .thenReturn(List.of());
        when(inviteRepository.save(any(DuelInvite.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        DuelInviteService.CreatedInvite created = service.createInvite(authentication, " bob ");

        assertThat(created.invite().status()).isEqualTo("PENDING");
        assertThat(created.invite().inviterUsername()).isEqualTo("alice");
        assertThat(created.invite().inviteeUsername()).isEqualTo("bob");
        assertThat(created.invite().expiresAt()).isEqualTo(now.plus(DuelInviteService.INVITE_VALIDITY));
        assertThat(created.recipientPrincipalName()).isEqualTo("bob@example.test");

        assertThatThrownBy(() -> service.createInvite(authentication, "bob"))
                .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    void acceptsOnlyAnInviteOwnedByTheAuthenticatedInviteeAndStartsTheMatch() {
        UUID inviteId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        DuelInvite invite = new DuelInvite();
        invite.setId(inviteId);
        invite.setInviter(inviter);
        invite.setInvitee(invitee);
        invite.setStatus(DuelInviteStatus.PENDING);
        invite.setExpiresAt(now.plus(Duration.ofMinutes(5)));

        MatchmakingEventDTO event = mock(MatchmakingEventDTO.class);
        when(event.matchId()).thenReturn(matchId);
        when(inviteRepository.findForInviteeForUpdate(inviteId, invitee.getId()))
                .thenReturn(Optional.of(invite));
        when(socketRegistry.currentSessionIdForPrincipal(inviter.getEmail())).thenReturn("alice-session");
        when(matchService.startMatch(any(), any())).thenReturn(
                List.of(new OutboundMatchmakingEvent(inviter.getEmail(), event)));
        when(inviteRepository.save(any(DuelInvite.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        DuelInviteService.AcceptedInvite accepted = service.acceptAndStartMatch(
                inviteId,
                invitee.getId(),
                invitee.getEmail(),
                "bob-session");

        assertThat(accepted.matchId()).isEqualTo(matchId);
        assertThat(accepted.events()).hasSize(1);
        assertThat(invite.getStatus()).isEqualTo(DuelInviteStatus.ACCEPTED);
        assertThat(invite.getMatchId()).isEqualTo(matchId);
        verify(matchmakingService).leaveQueue(inviter.getId());
        verify(matchmakingService).leaveQueue(invitee.getId());
    }

    @Test
    void rejectsExpiredInvitesBeforeStartingAnything() {
        UUID inviteId = UUID.randomUUID();
        DuelInvite invite = new DuelInvite();
        invite.setId(inviteId);
        invite.setInviter(inviter);
        invite.setInvitee(invitee);
        invite.setStatus(DuelInviteStatus.PENDING);
        invite.setExpiresAt(now.minusSeconds(1));
        when(inviteRepository.findForInviteeForUpdate(inviteId, invitee.getId()))
                .thenReturn(Optional.of(invite));
        when(inviteRepository.save(any(DuelInvite.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        assertThatThrownBy(() -> service.acceptAndStartMatch(
                inviteId,
                invitee.getId(),
                invitee.getEmail(),
                "bob-session"))
                .isInstanceOf(AuthException.class)
                .hasMessage("the invite has expired");
        assertThat(invite.getStatus()).isEqualTo(DuelInviteStatus.EXPIRED);
    }

    @Test
    void incomingSnapshotOmitsInvitesFromUsersTheViewerBlocked() {
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(invitee.getId());
        DuelInvite invite = new DuelInvite();
        invite.setId(UUID.randomUUID());
        invite.setInviter(inviter);
        invite.setInvitee(invitee);
        invite.setStatus(DuelInviteStatus.PENDING);
        invite.setExpiresAt(now.plus(Duration.ofMinutes(5)));
        when(inviteRepository.findByInviteeIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                eq(invitee.getId()), eq(DuelInviteStatus.PENDING), eq(now)))
                .thenReturn(List.of(invite));
        BlockLookup blocks = (viewerId, actorId) -> viewerId.equals(invitee.getId())
                && actorId.equals(inviter.getId());
        DuelInviteService blockedViewService = new DuelInviteService(
                currentUserService,
                userRepository,
                inviteRepository,
                matchService,
                matchmakingService,
                socketRegistry,
                new TokenBucketRateLimiter<>(clock, 1, Duration.ofSeconds(10)),
                clock,
                blocks);

        assertThat(blockedViewService.incoming(authentication)).isEmpty();
    }

    private static AppUser user(String username, String email) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(email);
        return user;
    }
}
