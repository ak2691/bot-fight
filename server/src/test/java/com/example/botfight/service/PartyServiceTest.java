package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.DTO.PartyMemberDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.repository.PartyInviteRepository;
import com.example.botfight.repository.PartyMemberRepository;
import com.example.botfight.repository.PartyRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class PartyServiceTest {

    private final Instant now = Instant.parse("2026-08-27T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final PartyRepository partyRepository = mock(PartyRepository.class);
    private final PartyMemberRepository partyMemberRepository = mock(PartyMemberRepository.class);
    private final PartyInviteRepository partyInviteRepository = mock(PartyInviteRepository.class);
    private final MatchService matchService = mock(MatchService.class);
    private final SingleUserWebSocketSessionRegistry socketRegistry = mock(SingleUserWebSocketSessionRegistry.class);
    private final Authentication authentication = mock(Authentication.class);
    private final AppUser owner = user("owner", "owner@example.test");
    private final AppUser teammate = user("teammate", "teammate@example.test");
    private final PartyService service = new PartyService(
            currentUserService,
            userRepository,
            partyRepository,
            partyMemberRepository,
            partyInviteRepository,
            matchService,
            new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(10)),
            clock,
            BlockLookup.none(),
            socketRegistry);

    @BeforeEach
    void setUp() {
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
        when(socketRegistry.currentSessionIdForPrincipal(owner.getEmail())).thenReturn("owner-socket");
        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail())).thenReturn("teammate-socket");
    }

    @Test
    void createsAnIdempotentTwoPlayerPartyWithTheCreatorInSlotOne() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);

        var first = service.create(authentication);
        var second = service.create(authentication);

        assertThat(second.partyId()).isEqualTo(first.partyId());
        assertThat(first.capacity()).isEqualTo(2);
        assertThat(first.members()).singleElement().satisfies(member -> {
            assertThat(member.username()).isEqualTo("owner");
            assertThat(member.slot()).isEqualTo(1);
            assertThat(member.leader()).isTrue();
        });
        verify(partyRepository, never()).save(any());
        verify(partyMemberRepository, never()).save(any());
        verify(partyInviteRepository, never()).save(any());
    }

    @Test
    void onlyThePartyLeaderCanInviteAPlayer() {
        var party = createPartyWithTeammate();
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(teammate);

        assertThatThrownBy(() -> service.invite(authentication, party.partyId(), owner.getUsername()))
                .isInstanceOf(AuthException.class)
                .hasMessage("only the party leader can invite players");
    }

    @Test
    void acceptsAnInviteIntoTheNextStablePartySlot() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var created = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));
        var invite = service.invite(authentication, created.partyId(), teammate.getUsername());

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        var accepted = service.accept(authentication, invite.invite().inviteId());

        assertThat(accepted.party().members()).hasSize(2);
        assertThat(accepted.party().members()).anySatisfy(member -> {
            assertThat(member.username()).isEqualTo("teammate");
            assertThat(member.slot()).isEqualTo(2);
        });
        assertThat(accepted.recipients()).singleElement().satisfies(recipient ->
                assertThat(recipient.userId()).isEqualTo(owner.getId()));
        assertThat(accepted.partyRecipients()).extracting(PartyService.PartyRecipient::userId)
                .containsExactlyInAnyOrder(owner.getId(), teammate.getId());
    }

    @Test
    void onlyThePartyLeaderCanQueueTheParty() {
        var party = createPartyWithTeammate();

        assertThatThrownBy(() -> service.queueEntrants(
                teammate.getId(),
                teammate.getUsername(),
                teammate.getEmail(),
                "teammate-socket"))
                .isInstanceOf(AuthException.class)
                .hasMessage("only the party leader can queue for the party");
        assertThat(party.partyId()).isNotNull();
    }

    @Test
    void leaderQueueContextContainsTheWholePartyAndAllStateRecipients() {
        createPartyWithTeammate();

        PartyService.QueueContext context = service.queueContext(
                owner.getId(),
                owner.getUsername(),
                owner.getEmail(),
                "owner-socket");

        assertThat(context.partyId()).isNotNull();
        assertThat(context.entrants()).extracting(MatchEntrant::userId)
                .containsExactly(owner.getId(), teammate.getId());
        assertThat(context.entrants()).extracting(MatchEntrant::socketSessionId)
                .containsExactly("owner-socket", "teammate-socket");
        assertThat(context.recipients()).extracting(PartyService.PartyRecipient::userId)
                .containsExactly(owner.getId(), teammate.getId());
    }

    @Test
    void aPartyMemberWithoutALiveSocketCannotJoinTheQueue() {
        createPartyWithTeammate();
        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail())).thenReturn(null);

        assertThatThrownBy(() -> service.queueContext(
                owner.getId(),
                owner.getUsername(),
                owner.getEmail(),
                "owner-socket"))
                .isInstanceOf(AuthException.class)
                .hasMessage("every party member must have an active socket connection");
    }

    @Test
    void aDisconnectMarksTheMemberOfflineWithoutRemovingThemFromTheParty() {
        var party = createPartyWithTeammate();
        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail())).thenReturn(null);

        PartyService.LeaveResult change = service.removeDisconnected(
                teammate.getEmail(),
                "teammate-socket");

        assertThat(change.party()).isNotNull();
        assertThat(change.party().members()).anySatisfy(member -> {
            assertThat(member.userId()).isEqualTo(teammate.getId());
            assertThat(member.online()).isFalse();
        });
        assertThat(service.currentForPrincipal(owner.getEmail()).members())
                .extracting(member -> member.userId())
                .contains(teammate.getId());

        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail()))
                .thenReturn("teammate-socket-new");
        service.registerSocket(teammate.getEmail(), "teammate-socket-new");

        assertThat(service.currentForPrincipal(owner.getEmail()).members())
                .filteredOn(member -> member.userId().equals(teammate.getId()))
                .singleElement()
                .extracting(member -> member.online())
                .isEqualTo(true);
        assertThat(party.partyId()).isNotNull();
    }

    @Test
    void kickingAMemberRemovesTheirPartyMembershipAndReturnsTheirRecipient() {
        var party = createPartyWithTeammate();
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);

        PartyService.LeaveResult result = service.kick(
                authentication,
                party.partyId(),
                teammate.getId());

        assertThat(result.party()).isNotNull();
        assertThat(result.party().members()).extracting(member -> member.userId())
                .containsExactly(owner.getId());
        assertThat(result.removedRecipient().userId()).isEqualTo(teammate.getId());
        assertThat(service.currentForPrincipal(teammate.getEmail())).isNull();
    }

    @Test
    void leavingReturnsASeparateRemovedRecipientSoTheirClientCanClearPartyState() {
        createPartyWithTeammate();
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(teammate);

        PartyService.LeaveResult result = service.leave(
                authentication,
                service.currentForPrincipal(teammate.getEmail()).partyId());

        assertThat(result.party()).isNotNull();
        assertThat(result.removedRecipient().userId()).isEqualTo(teammate.getId());
        assertThat(result.recipients()).extracting(PartyService.PartyRecipient::userId)
                .containsExactly(owner.getId());
        assertThat(service.currentForPrincipal(teammate.getEmail())).isNull();
    }

    @Test
    void aStalePartyInviteCanBeDeclinedAfterTheLastPartyMemberLeaves() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var created = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));
        var invite = service.invite(authentication, created.partyId(), teammate.getUsername());

        service.leave(authentication, created.partyId());
        assertThat(service.currentForPrincipal(owner.getEmail())).isNull();

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        assertThatThrownBy(() -> service.accept(authentication, invite.invite().inviteId()))
                .isInstanceOf(AuthException.class)
                .hasMessage("Party no longer exists");

        assertThat(service.decline(authentication, invite.invite().inviteId()).invite().status())
                .isEqualTo("DECLINED");
    }

    @Test
    void customMatchDisbandsAPartyWhenItsLeaderStartsWithoutEveryMember() {
        createPartyWithTeammate();

        List<PartyService.CustomMatchPartyChange> changes = service.prepareForCustomMatch(
                Set.of(owner.getId()));

        assertThat(changes).singleElement().satisfies(change -> {
            assertThat(change.party()).isNull();
            assertThat(change.detachedRecipients()).extracting(PartyService.PartyRecipient::userId)
                    .containsExactlyInAnyOrder(owner.getId(), teammate.getId());
        });
        assertThat(service.currentForPrincipal(owner.getEmail())).isNull();
        assertThat(service.currentForPrincipal(teammate.getEmail())).isNull();
    }

    @Test
    void customMatchOnlyRemovesTheNonLeaderWhoStartsWithoutTheirPartyMember() {
        createPartyWithTeammate();

        List<PartyService.CustomMatchPartyChange> changes = service.prepareForCustomMatch(
                Set.of(teammate.getId()));

        assertThat(changes).singleElement().satisfies(change -> {
            assertThat(change.party()).isNotNull();
            assertThat(change.party().members()).extracting(PartyMemberDTO::userId)
                    .containsExactly(owner.getId());
            assertThat(change.detachedRecipients()).singleElement()
                    .extracting(PartyService.PartyRecipient::userId)
                    .isEqualTo(teammate.getId());
        });
        assertThat(service.currentForPrincipal(teammate.getEmail())).isNull();
        assertThat(service.currentForPrincipal(owner.getEmail())).isNotNull();
    }

    @Test
    void aNewServiceInstanceStartsWithoutThePreviousParty() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        service.create(authentication);
        PartyService restartedService = new PartyService(
                currentUserService,
                userRepository,
                partyRepository,
                partyMemberRepository,
                partyInviteRepository,
                matchService,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(10)),
                clock,
                BlockLookup.none(),
                socketRegistry);

        PartyService.QueueContext context = restartedService.queueContext(
                owner.getId(),
                owner.getUsername(),
                owner.getEmail(),
                "owner-socket");

        assertThat(context.partyId()).isNull();
        assertThat(context.entrants()).extracting(MatchEntrant::userId)
                .containsExactly(owner.getId());
    }

    private com.example.botfight.DTO.PartyDTO createPartyWithTeammate() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var created = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));
        var invite = service.invite(authentication, created.partyId(), teammate.getUsername());
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        return service.accept(authentication, invite.invite().inviteId()).party();
    }

    private static AppUser user(String username, String email) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(email);
        return user;
    }
}
