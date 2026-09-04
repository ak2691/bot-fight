package com.example.botfight.service.customlobby;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.timing.MatchTimingPolicy;
import com.example.botfight.service.party.PartyService;
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

class CustomLobbyServiceTest {

    private final Instant now = Instant.parse("2026-08-28T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final MatchService matchService = mock(MatchService.class);
    private final SingleUserWebSocketSessionRegistry socketRegistry =
            mock(SingleUserWebSocketSessionRegistry.class);
    private final PartyService partyService = mock(PartyService.class);
    private final Authentication authentication = mock(Authentication.class);
    private final AppUser owner = user("owner", "owner@example.test");
    private final AppUser teammate = user("teammate", "teammate@example.test");
    private final AppUser third = user("third", "third@example.test");
    private final CustomLobbyService service = new CustomLobbyService(
            currentUserService,
            userRepository,
            matchService,
            new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(10)),
            new TokenBucketRateLimiter<>(clock, 1, Duration.ofMillis(500)),
            clock,
            BlockLookup.none(),
            socketRegistry,
            partyService);

    @BeforeEach
    void setUp() {
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
        when(socketRegistry.currentSessionIdForPrincipal(owner.getEmail())).thenReturn("owner-socket");
        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail())).thenReturn("teammate-socket");
        when(socketRegistry.currentSessionIdForPrincipal(third.getEmail())).thenReturn("third-socket");
        when(partyService.prepareForCustomMatch(anyCollection())).thenReturn(List.of());
    }

    @Test
    void createsAnIdempotentLobbyWithTheOwnerNotReady() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);

        CustomLobbyDTO first = service.create(authentication);
        CustomLobbyDTO second = service.create(authentication);

        assertThat(second.lobbyId()).isEqualTo(first.lobbyId());
        assertThat(first.capacity()).isEqualTo(4);
        assertThat(first.members()).singleElement().satisfies(member -> {
            assertThat(member.userId()).isEqualTo(owner.getId());
            assertThat(member.teamNumber()).isZero();
            assertThat(member.owner()).isTrue();
            assertThat(member.online()).isTrue();
        });
    }

    @Test
    void acceptsInviteIntoAnEmptyTeamAndRequiresBothTeamsToStart() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("teammate"))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite created = service.invite(
                authentication, lobby.lobbyId(), teammate.getUsername());

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        CustomLobbyService.AcceptedInvite accepted = service.accept(
                authentication, created.invite().inviteId());

        assertThat(accepted.lobby().members()).extracting(member -> member.teamNumber())
                .containsExactly(0, 0);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        assertThatThrownBy(() -> service.start(authentication, lobby.lobbyId()))
                .isInstanceOf(AuthException.class)
                .hasMessage("every player must choose a team before the match can start");
    }

    @Test
    void promotesTheEarliestInvitedRemainingMemberWhenOwnerLeaves() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);

        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite teammateInvite = service.invite(
                authentication, lobby.lobbyId(), teammate.getUsername());
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(third.getUsername()))
                .thenReturn(Optional.of(third));
        CustomLobbyService.CreatedInvite thirdInvite = service.invite(
                authentication, lobby.lobbyId(), third.getUsername());

        // Accept out of order to prove succession follows invitation order, not arrival order.
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(third.getId());
        service.accept(authentication, thirdInvite.invite().inviteId());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        service.accept(authentication, teammateInvite.invite().inviteId());

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyService.LobbyChange change = service.leave(authentication, lobby.lobbyId());

        assertThat(change.lobby()).isNotNull();
        assertThat(change.lobby().ownerId()).isEqualTo(teammate.getId());
        assertThat(change.lobby().ownerUsername()).isEqualTo(teammate.getUsername());
        assertThat(change.lobby().members()).hasSize(2);
        assertThat(change.lobby().members())
                .filteredOn(member -> member.userId().equals(teammate.getId()))
                .singleElement()
                .extracting(member -> member.owner())
                .isEqualTo(true);
        assertThat(change.recipients())
                .extracting(CustomLobbyService.LobbyRecipient::userId)
                .containsExactlyInAnyOrder(teammate.getId(), third.getId());
        assertThat(change.detachedRecipients())
                .singleElement()
                .extracting(CustomLobbyService.LobbyRecipient::userId)
                .isEqualTo(owner.getId());
        assertThat(service.currentForPrincipal(owner.getEmail())).isNull();
        assertThat(service.currentForPrincipal(teammate.getEmail()).ownerId())
                .isEqualTo(teammate.getId());
    }

    @Test
    void aStaleLobbyInviteCanBeDeclinedAfterTheLastLobbyMemberLeaves() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite created = service.invite(
                authentication, lobby.lobbyId(), teammate.getUsername());

        service.leave(authentication, lobby.lobbyId());
        assertThat(service.currentForPrincipal(owner.getEmail())).isNull();

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        assertThatThrownBy(() -> service.accept(authentication, created.invite().inviteId()))
                .isInstanceOf(AuthException.class)
                .hasMessage("Lobby no longer exists");

        assertThat(service.decline(authentication, created.invite().inviteId()).invite().status())
                .isEqualTo("DECLINED");
    }

    @Test
    void onlyTheOwnerCanStartAndTheStartedMatchUsesCustomMode() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("teammate"))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite created = service.invite(
                authentication, lobby.lobbyId(), teammate.getUsername());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        service.accept(authentication, created.invite().inviteId());

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(teammate);
        assertThatThrownBy(() -> service.start(authentication, lobby.lobbyId()))
                .isInstanceOf(AuthException.class)
                .hasMessage("only the custom lobby owner can perform that action");

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        service.setTeam(authentication, lobby.lobbyId(), CustomLobbyService.BLUE_TEAM);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(teammate);
        service.setTeam(authentication, lobby.lobbyId(), CustomLobbyService.RED_TEAM);

        UUID matchId = UUID.randomUUID();
        MatchmakingEventDTO event = mock(MatchmakingEventDTO.class);
        when(event.matchId()).thenReturn(matchId);
        when(matchService.startTeamMatch(any(), eq(MatchMode.CUSTOM),
                eq(MatchTimingPolicy.DEFAULT_CUSTOM_ROUND_SECONDS))).thenReturn(
                List.of(new OutboundMatchmakingEvent(owner.getEmail(), event)));
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);

        CustomLobbyService.StartedMatch started = service.start(authentication, lobby.lobbyId());

        assertThat(started.matchId()).isEqualTo(matchId);
        assertThat(started.lobby()).isNotNull();
        assertThat(started.lobby().lobbyId()).isEqualTo(lobby.lobbyId());
        assertThat(service.currentForPrincipal(owner.getEmail())).isNotNull();
        CustomLobbyService.LobbyChange finished = service.finishMatch(matchId);
        assertThat(finished.lobby()).isNotNull();
        assertThat(finished.lobby().members())
                .extracting(member -> member.teamNumber())
                .containsOnly(CustomLobbyService.TEAM_NONE);
        assertThat(service.currentForPrincipal(owner.getEmail())).isNotNull();
        verify(matchService).startTeamMatch(any(), eq(MatchMode.CUSTOM),
                eq(MatchTimingPolicy.DEFAULT_CUSTOM_ROUND_SECONDS));
        verify(partyService).prepareForCustomMatch(anyCollection());
    }

    @Test
    void ownerCanSetAValidatedCustomRoundDuration() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);

        CustomLobbyService.LobbyChange updated = service.updateRoundDuration(
                authentication, lobby.lobbyId(), 90);

        assertThat(updated.lobby().roundDurationSeconds()).isEqualTo(90);
        assertThatThrownBy(() -> service.updateRoundDuration(
                authentication, lobby.lobbyId(), 29))
                .isInstanceOf(AuthException.class)
                .hasMessage("round duration must be between 30 seconds and 10 minutes");
        assertThatThrownBy(() -> service.updateRoundDuration(
                authentication, lobby.lobbyId(), 601))
                .isInstanceOf(AuthException.class)
                .hasMessage("round duration must be between 30 seconds and 10 minutes");
    }

    @Test
    void limitsEachTeamToTwoPlayers() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("teammate"))
                .thenReturn(Optional.of(teammate));
        CustomLobbyService.CreatedInvite created = service.invite(
                authentication, lobby.lobbyId(), teammate.getUsername());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        service.accept(authentication, created.invite().inviteId());
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("third"))
                .thenReturn(Optional.of(third));
        CustomLobbyService.CreatedInvite thirdInvite = service.invite(
                authentication, lobby.lobbyId(), third.getUsername());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(third.getId());
        service.accept(authentication, thirdInvite.invite().inviteId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        service.setTeam(authentication, lobby.lobbyId(), CustomLobbyService.BLUE_TEAM);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(teammate);
        service.setTeam(authentication, lobby.lobbyId(), CustomLobbyService.BLUE_TEAM);

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(third);
        assertThatThrownBy(() -> service.setTeam(
                authentication, lobby.lobbyId(), CustomLobbyService.BLUE_TEAM))
                .isInstanceOf(AuthException.class)
                .hasMessage("that team is full");
        assertThat(service.currentForPrincipal(owner.getEmail()).members()).hasSize(3);
    }

    @Test
    void throttlesRapidTeamSwitchesWithoutChangingTheRoster() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        CustomLobbyDTO lobby = service.create(authentication);

        service.setTeam(authentication, lobby.lobbyId(), CustomLobbyService.BLUE_TEAM);

        assertThatThrownBy(() -> service.setTeam(
                authentication, lobby.lobbyId(), CustomLobbyService.RED_TEAM))
                .isInstanceOf(RateLimitExceededException.class);
        assertThat(service.currentForPrincipal(owner.getEmail()).members())
                .singleElement()
                .satisfies(member -> assertThat(member.teamNumber())
                        .isEqualTo(CustomLobbyService.BLUE_TEAM));
    }

    private static AppUser user(String username, String email) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(email);
        return user;
    }
}
