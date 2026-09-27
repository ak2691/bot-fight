package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.party.PartyMemberDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.repository.PartyInviteRepository;
import com.example.botfight.repository.PartyMemberRepository;
import com.example.botfight.repository.PartyRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
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
    private final MutableClock clock = new MutableClock(now);
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
            new TokenBucketRateLimiter<>(
                    clock, PartyService.MAX_PENDING_INVITES_PER_PARTY + 2, Duration.ofSeconds(10)),
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
        assertThat(service.cleanupExpiredInvites()).isZero();
    }

    @Test
    void declinedPartyInviteIsRemovedImmediatelyAndExpiredReadPrunesPendingState() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var party = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));
        var declined = service.invite(authentication, party.partyId(), teammate.getUsername());

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
        assertThat(service.decline(authentication, declined.invite().inviteId()).invite().status())
                .isEqualTo("DECLINED");
        assertThat(service.cleanupExpiredInvites()).isZero();

        AppUser third = user("third", "third@example.test");
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(third.getUsername()))
                .thenReturn(Optional.of(third));
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var expiring = service.invite(authentication, party.partyId(), third.getUsername());
        clock.advance(PartyService.INVITE_VALIDITY);
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(third.getId());

        assertThat(service.incoming(authentication)).isEmpty();
        assertThat(service.cleanupExpiredInvites()).isZero();
        assertThatThrownBy(() -> service.decline(authentication, expiring.invite().inviteId()))
                .isInstanceOf(AuthException.class)
                .hasMessage("the party invite is no longer available");
    }

    @Test
    void capsPendingPartyInvitesPerPartyAndInviter() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var party = service.create(authentication);
        for (int index = 0; index < PartyService.MAX_PENDING_INVITES_PER_PARTY; index++) {
            AppUser invitee = user("target" + index, "target" + index + "@example.test");
            when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(invitee.getUsername()))
                    .thenReturn(Optional.of(invitee));
            service.invite(authentication, party.partyId(), invitee.getUsername());
        }

        AppUser finalInvitee = user("last-target", "last-target@example.test");
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(finalInvitee.getUsername()))
                .thenReturn(Optional.of(finalInvitee));
        assertThatThrownBy(() -> service.invite(authentication, party.partyId(), finalInvitee.getUsername()))
                .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    void capsPendingPartyInvitesPerInviteeAcrossParties() {
        AppUser invitedPlayer = user("shared-target", "shared-target@example.test");
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(invitedPlayer.getUsername()))
                .thenReturn(Optional.of(invitedPlayer));

        for (int index = 0; index < PartyService.MAX_PENDING_INVITES_PER_USER; index++) {
            AppUser inviter = user("sender" + index, "sender" + index + "@example.test");
            when(currentUserService.requireCurrentUser(authentication)).thenReturn(inviter);
            var party = service.create(authentication);
            service.invite(authentication, party.partyId(), invitedPlayer.getUsername());
        }

        AppUser finalInviter = user("last-sender", "last-sender@example.test");
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(finalInviter);
        var finalParty = service.create(authentication);
        assertThatThrownBy(() -> service.invite(
                authentication, finalParty.partyId(), invitedPlayer.getUsername()))
                .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    void repeatedDeclinesDoNotAccumulatePartyInviteState() {
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(owner);
        var party = service.create(authentication);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(teammate.getUsername()))
                .thenReturn(Optional.of(teammate));

        for (int index = 0; index < PartyService.MAX_PENDING_INVITES_PER_USER; index++) {
            var invite = service.invite(authentication, party.partyId(), teammate.getUsername());
            when(currentUserService.requireCurrentUserId(authentication)).thenReturn(teammate.getId());
            assertThat(service.decline(authentication, invite.invite().inviteId()).invite().status())
                    .isEqualTo("DECLINED");
            assertThat(service.cleanupExpiredInvites()).isZero();
        }
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
    void aLiveSocketKeepsAReconnectedMemberOnlineBeforePartySubscriptionRefreshesTheBinding() {
        createPartyWithTeammate();
        when(socketRegistry.currentSessionIdForPrincipal(teammate.getEmail()))
                .thenReturn("teammate-socket-new");

        assertThat(service.currentForPrincipal(owner.getEmail()).members())
                .filteredOn(member -> member.userId().equals(teammate.getId()))
                .singleElement()
                .extracting(PartyMemberDTO::online)
                .isEqualTo(true);
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

    private com.example.botfight.DTO.party.PartyDTO createPartyWithTeammate() {
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

    private static final class MutableClock extends Clock {
        private Instant currentInstant;

        private MutableClock(Instant initialInstant) {
            currentInstant = initialInstant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return currentInstant;
        }

        private void advance(Duration duration) {
            currentInstant = currentInstant.plus(duration);
        }
    }
}
