package com.example.botfight.service.matchmaking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.loadout.MatchAbilityGuaranteeService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class MatchParticipationMutualExclusionTest {
    private static final Instant NOW = Instant.parse("2026-09-01T12:00:00Z");

    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final MatchParticipationCoordinator coordinator = new MatchParticipationCoordinator();
    private final MatchService matchService = mock(MatchService.class);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final SingleUserWebSocketSessionRegistry socketRegistry =
            mock(SingleUserWebSocketSessionRegistry.class);
    private final AppUser owner = user("owner");
    private final AppUser teammate = user("teammate");
    private final AppUser target = user("target");
    private final AppUser opponent = user("opponent");
    private final Authentication ownerAuthentication = mock(Authentication.class);
    private final Authentication targetAuthentication = mock(Authentication.class);
    private MatchmakingService matchmakingService;
    private CustomLobbyService customLobbyService;

    @BeforeEach
    void setUp() {
        matchmakingService = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(3)),
                null,
                new MatchAbilityGuaranteeService(),
                coordinator);
        customLobbyService = new CustomLobbyService(
                currentUserService,
                userRepository,
                matchService,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(10)),
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofMillis(500)),
                clock,
                BlockLookup.none(),
                socketRegistry,
                mock(PartyService.class),
                new MatchAbilityGuaranteeService(),
                matchmakingService,
                coordinator);
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
        when(matchService.isMatchStartReserved(any())).thenReturn(false);
        when(currentUserService.requireCurrentUser(ownerAuthentication)).thenReturn(owner);
        when(currentUserService.requireCurrentUser(targetAuthentication)).thenReturn(target);
        when(currentUserService.requireCurrentUserId(targetAuthentication)).thenReturn(target.getId());
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(target.getUsername()))
                .thenReturn(Optional.of(target));
    }

    @Test
    void aCustomLobbyMemberRejectsAnEntirePartyQueueWithoutMutatingTheQueue() {
        CustomLobbyDTO lobby = customLobbyService.create(ownerAuthentication);
        UUID leaderId = UUID.randomUUID();
        UUID partyId = UUID.randomUUID();
        matchmakingService.joinQueue(leaderId, "leader", "leader@example.test", "leader-socket");
        List<MatchEntrant> party = List.of(
                new MatchEntrant(leaderId, "leader", "leader@example.test", "leader-socket"),
                new MatchEntrant(owner.getId(), owner.getUsername(), owner.getEmail(), "owner-socket"));

        assertThatThrownBy(() -> matchmakingService.joinQueue(
                leaderId,
                "leader",
                "leader@example.test",
                "leader-socket",
                MatchMode.TWOS,
                party,
                partyId,
                List.of(),
                QueuePool.REGISTERED))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("Leave the custom lobby");

        assertThat(matchmakingService.hasTransientActivity(leaderId)).isTrue();
        assertThat(matchmakingService.hasTransientActivity(owner.getId())).isFalse();
        assertThat(coordinator.isRankedParticipant(leaderId)).isTrue();
        assertThat(coordinator.isCustomLobbyMember(owner.getId())).isTrue();
        assertThat(customLobbyService.currentForPrincipal(owner.getEmail()).lobbyId())
                .isEqualTo(lobby.lobbyId());

        matchmakingService.leaveQueue(leaderId);
        assertThat(matchmakingService.hasTransientActivity(leaderId)).isFalse();
        assertThat(coordinator.isRankedParticipant(leaderId)).isFalse();
    }

    @Test
    void aQueuedUserCannotCreateALobbyUntilTheyExplicitlyLeaveTheQueue() {
        matchmakingService.joinQueue(
                target.getId(), target.getUsername(), target.getEmail(), "target-socket");

        assertThatThrownBy(() -> customLobbyService.create(targetAuthentication))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("Leave ranked matchmaking");
        assertThat(matchmakingService.hasTransientActivity(target.getId())).isTrue();
        assertThat(customLobbyService.currentForPrincipal(target.getEmail())).isNull();
        assertThat(coordinator.isCustomLobbyMember(target.getId())).isFalse();

        matchmakingService.leaveQueue(target.getId());
        assertThat(customLobbyService.create(targetAuthentication)).isNotNull();
    }

    @Test
    void queuedAndPendingInviteAcceptsLeaveBothSystemsUnchangedUntilQueueCancellation() {
        when(currentUserService.requireCurrentUser(targetAuthentication)).thenReturn(target);
        var lobby = customLobbyService.create(ownerAuthentication);
        var invite = customLobbyService.invite(ownerAuthentication, lobby.lobbyId(), target.getUsername());

        matchmakingService.joinQueue(
                target.getId(), target.getUsername(), target.getEmail(), "target-socket");
        assertThatThrownBy(() -> customLobbyService.accept(
                targetAuthentication, invite.invite().inviteId()))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("Leave ranked matchmaking");
        assertThat(customLobbyService.incoming(targetAuthentication))
                .extracting(item -> item.inviteId())
                .containsExactly(invite.invite().inviteId());
        assertThat(customLobbyService.currentForPrincipal(target.getEmail())).isNull();
        matchmakingService.leaveQueue(target.getId());

        matchmakingService.joinQueue(
                target.getId(), target.getUsername(), target.getEmail(), "target-socket");
        List<com.example.botfight.service.match.event.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(
                        opponent.getId(), opponent.getUsername(), opponent.getEmail(), "opponent-socket");
        UUID pendingMatchId = found.getFirst().event().matchId();
        assertThat(matchmakingService.hasTransientActivity(target.getId())).isTrue();
        assertThatThrownBy(() -> customLobbyService.accept(
                targetAuthentication, invite.invite().inviteId()))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("Leave ranked matchmaking");
        assertThat(customLobbyService.currentForPrincipal(target.getEmail())).isNull();
        assertThat(customLobbyService.incoming(targetAuthentication))
                .extracting(item -> item.inviteId())
                .containsExactly(invite.invite().inviteId());

        matchmakingService.cancelPendingMatch(pendingMatchId, target.getId(), "target-socket");
        assertThat(customLobbyService.accept(targetAuthentication, invite.invite().inviteId())
                .lobby().members()).hasSize(2);
        assertThat(matchmakingService.hasTransientActivity(target.getId())).isFalse();
        assertThat(coordinator.isCustomLobbyMember(target.getId())).isTrue();
    }

    @Test
    void anActiveRankedMatchCannotEnterACustomLobby() {
        UUID activeUserId = UUID.randomUUID();
        AppUser activeUser = user("active");
        activeUser.setId(activeUserId);
        Authentication activeAuthentication = mock(Authentication.class);
        when(currentUserService.requireCurrentUser(activeAuthentication)).thenReturn(activeUser);
        when(matchService.activeMatchStatus(activeUserId))
                .thenReturn(new ActiveMatchStatusDTO(true, false, UUID.randomUUID(), null));
        MatchParticipationCoordinator.RankedAdmission admission =
                coordinator.reserveRankedAdmission(List.of(activeUserId));
        assertThat(coordinator.commitRankedAdmission(admission)).isTrue();

        assertThatThrownBy(() -> customLobbyService.create(activeAuthentication))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("outside an active match");
        assertThat(customLobbyService.currentForPrincipal(activeUser.getEmail())).isNull();
        assertThat(coordinator.isRankedParticipant(activeUserId)).isTrue();
    }

    @Test
    void simultaneousQueueAndLobbyEntryCanCommitOnlyOneState() throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> queueAttempt = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    matchmakingService.joinQueue(
                            owner.getId(), owner.getUsername(), owner.getEmail(), "owner-socket");
                    return true;
                } catch (AuthException rejected) {
                    return false;
                }
            });
            Future<Boolean> lobbyAttempt = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    customLobbyService.create(ownerAuthentication);
                    return true;
                } catch (AuthException rejected) {
                    return false;
                }
            });
            assertThat(ready.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            start.countDown();

            boolean queueSucceeded = queueAttempt.get(2, java.util.concurrent.TimeUnit.SECONDS);
            boolean lobbySucceeded = lobbyAttempt.get(2, java.util.concurrent.TimeUnit.SECONDS);
            assertThat((queueSucceeded ? 1 : 0) + (lobbySucceeded ? 1 : 0)).isEqualTo(1);
            assertThat(matchmakingService.hasTransientActivity(owner.getId())).isEqualTo(queueSucceeded);
            assertThat(customLobbyService.currentForPrincipal(owner.getEmail()) != null)
                    .isEqualTo(lobbySucceeded);
            assertThat(coordinator.isRankedParticipant(owner.getId())).isEqualTo(queueSucceeded);
            assertThat(coordinator.isCustomLobbyMember(owner.getId())).isEqualTo(lobbySucceeded);
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    private static AppUser user(String username) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(username + "@example.test");
        user.setNormalizedEmail(user.getEmail());
        user.setEmailVerified(true);
        return user;
    }
}
