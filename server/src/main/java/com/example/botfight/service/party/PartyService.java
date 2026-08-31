package com.example.botfight.service.party;

import com.example.botfight.DTO.PartyDTO;
import com.example.botfight.DTO.PartyInviteDTO;
import com.example.botfight.DTO.PartyMemberDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Party;
import com.example.botfight.domain.PartyInvite;
import com.example.botfight.domain.PartyInviteStatus;
import com.example.botfight.domain.PartyMember;
import com.example.botfight.domain.PartyStatus;
import com.example.botfight.repository.PartyInviteRepository;
import com.example.botfight.repository.PartyMemberRepository;
import com.example.botfight.repository.PartyRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.UsernamePolicy;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.invite.InviteTargetUnavailableException;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the live party boundary. Party membership is deliberately process
 * memory only: a party exists until its members leave or the process restarts.
 * A disconnected member remains in the transient roster as offline so the
 * party can resume when that member reconnects. The JPA party types remain
 * DTO/domain compatibility carriers, but this service never reads or writes
 * party membership rows.
 */
@Service
public class PartyService {

    public static final short CURRENT_PARTY_CAPACITY = 2;
    public static final Duration INVITE_VALIDITY = Duration.ofMinutes(10);
    public static final Duration TERMINAL_RETENTION = Duration.ofDays(14);

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final MatchService matchService;
    private final TokenBucketRateLimiter<UUID> inviteRateLimiter;
    private final Clock clock;
    private final BlockLookup blockLookup;
    private final SingleUserWebSocketSessionRegistry socketRegistry;

    private final Map<UUID, Party> activePartiesById = new HashMap<>();
    private final Map<UUID, UUID> partyIdsByUserId = new HashMap<>();
    private final Map<UUID, List<PartyMember>> membersByPartyId = new HashMap<>();
    private final Map<UUID, String> socketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, PartyInvite> invitesById = new HashMap<>();

    @Autowired
    public PartyService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            PartyRepository partyRepository,
            PartyMemberRepository partyMemberRepository,
            PartyInviteRepository partyInviteRepository,
            MatchService matchService,
            @Qualifier("partyInviteRateLimiter") TokenBucketRateLimiter<UUID> inviteRateLimiter,
            Clock clock,
            BlockLookup blockLookup,
            SingleUserWebSocketSessionRegistry socketRegistry) {
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.matchService = matchService;
        this.inviteRateLimiter = inviteRateLimiter;
        this.clock = clock;
        this.blockLookup = blockLookup;
        this.socketRegistry = socketRegistry;
    }

    /** Compatibility constructor for unit fixtures without a socket registry. */
    public PartyService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            PartyRepository partyRepository,
            PartyMemberRepository partyMemberRepository,
            PartyInviteRepository partyInviteRepository,
            MatchService matchService,
            TokenBucketRateLimiter<UUID> inviteRateLimiter,
            Clock clock,
            BlockLookup blockLookup) {
        this(
                currentUserService,
                userRepository,
                partyRepository,
                partyMemberRepository,
                partyInviteRepository,
                matchService,
                inviteRateLimiter,
                clock,
                blockLookup,
                null);
    }

    public PartyService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            PartyRepository partyRepository,
            PartyMemberRepository partyMemberRepository,
            PartyInviteRepository partyInviteRepository,
            MatchService matchService,
            TokenBucketRateLimiter<UUID> inviteRateLimiter,
            Clock clock) {
        this(
                currentUserService,
                userRepository,
                partyRepository,
                partyMemberRepository,
                partyInviteRepository,
                matchService,
                inviteRateLimiter,
                clock,
                BlockLookup.none(),
                null);
    }

    /** Binds a party member to the socket that authenticated the party session. */
    public synchronized void registerSocket(String principalName, String socketSessionId) {
        if (principalName == null || principalName.isBlank()
                || socketSessionId == null || socketSessionId.isBlank()) {
            return;
        }
        activePartiesById.values().stream()
                .flatMap(party -> membersFor(party).stream())
                .filter(member -> member.getUser() != null
                        && principalName.equals(member.getUser().getEmail()))
                .findFirst()
                .ifPresent(member -> socketSessionIdsByUserId.put(
                        member.getUser().getId(), socketSessionId));
    }

    /** Returns the party visible to a principal after its party subscription. */
    public synchronized PartyDTO currentForPrincipal(String principalName) {
        if (principalName == null || principalName.isBlank()) return null;
        return activePartiesById.values().stream()
                .filter(party -> membersFor(party).stream().anyMatch(member ->
                        member.getUser() != null
                                && principalName.equals(member.getUser().getEmail())))
                .findFirst()
                .map(this::toDTO)
                .orElse(null);
    }

    public synchronized List<PartyRecipient> recipientsForParty(UUID partyId) {
        Party party = partyId == null ? null : activePartiesById.get(partyId);
        return party == null ? List.of() : recipientsFor(party);
    }

    /**
     * Returns the authenticated user's party as one atomic queue group. The
     * party member list and each member's socket are resolved server-side.
     */
    public List<MatchEntrant> queueEntrants(
            UUID requesterId,
            String requesterUsername,
            String requesterPrincipalName,
            String requesterSocketSessionId) {
        return queueContext(
                requesterId,
                requesterUsername,
                requesterPrincipalName,
                requesterSocketSessionId).entrants();
    }

    public synchronized QueueContext queueContext(
            UUID requesterId,
            String requesterUsername,
            String requesterPrincipalName,
            String requesterSocketSessionId) {
        Party party = activePartyForUser(requesterId);
        if (party == null) {
            return new QueueContext(
                    null,
                    null,
                    List.of(new MatchEntrant(
                            requesterId,
                            requesterUsername,
                            requesterPrincipalName,
                            requesterSocketSessionId)),
                    List.of(new PartyRecipient(requesterPrincipalName, requesterId)));
        }
        requireQueueLeader(party, requesterId);
        List<PartyMember> members = membersFor(party);
        if (members.isEmpty() || members.size() > CURRENT_PARTY_CAPACITY) {
            throw new AuthException("the party roster is invalid");
        }

        List<MatchEntrant> entrants = members.stream()
                .map(member -> entrantForMember(
                        member,
                        requesterId,
                        requesterUsername,
                        requesterPrincipalName,
                        requesterSocketSessionId))
                .toList();
        return new QueueContext(
                party.getId(),
                toDTO(party),
                entrants,
                recipientsFor(party));
    }

    @Transactional
    public synchronized PartyDTO create(Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        rejectActiveMatch(user.getId());

        Party existing = activePartyForUser(user.getId());
        if (existing != null) return toDTO(existing);

        Party party = new Party();
        party.setId(UUID.randomUUID());
        party.setOwner(user);
        party.setCapacity(CURRENT_PARTY_CAPACITY);
        party.setStatus(PartyStatus.ACTIVE);
        activePartiesById.put(party.getId(), party);
        membersByPartyId.put(party.getId(), new ArrayList<>());
        addMember(party, user, (short) 1);
        bindCurrentSocket(user);
        return toDTO(party);
    }

    @Transactional
    public synchronized CreatedInvite invite(
            Authentication authentication,
            UUID partyId,
            String requestedUsername) {
        AppUser inviter = currentUserService.requireCurrentUser(authentication);
        inviteRateLimiter.requireAllowed(inviter.getId());
        Party party = requirePartyForUpdate(partyId);
        requireLeader(party, inviter.getId());

        List<PartyMember> members = membersFor(party);
        if (members.stream().noneMatch(member -> inviter.getId().equals(member.getUser().getId()))) {
            throw new AuthException("you are not a member of this party");
        }
        if (members.size() >= capacityFor(party)) {
            throw new AuthException("your party is already full");
        }

        String username = UsernamePolicy.clean(requestedUsername);
        UsernamePolicy.validate(username);
        AppUser invitee = userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(username)
                .orElseThrow(() -> new AuthException("player could not be found"));
        if (inviter.getId().equals(invitee.getId())) {
            throw new AuthException("you cannot invite yourself");
        }
        if (blockLookup.isBlocked(invitee.getId(), inviter.getId())
                || blockLookup.isBlocked(inviter.getId(), invitee.getId())) {
            throw new AuthException("player could not be invited");
        }
        rejectActiveMatch(invitee.getId());
        if (activePartyForUser(invitee.getId()) != null) {
            throw new AuthException("that player is already in a party");
        }

        Instant now = clock.instant();
        PartyInvite existing = pendingInviteFor(party.getId(), invitee.getId());
        if (existing != null && existing.getExpiresAt() != null
                && now.isBefore(existing.getExpiresAt())) {
            throw new AuthException("a party invite is already pending for this player");
        }
        if (existing != null) invitesById.remove(existing.getId());

        PartyInvite invite = new PartyInvite();
        invite.setId(UUID.randomUUID());
        invite.setParty(party);
        invite.setInviter(inviter);
        invite.setInvitee(invitee);
        invite.setStatus(PartyInviteStatus.PENDING);
        invite.setExpiresAt(now.plus(INVITE_VALIDITY));
        invitesById.put(invite.getId(), invite);
        return new CreatedInvite(
                toInviteDTO(invite),
                invitee.getEmail(),
                invitee.getId(),
                inviter.getId(),
                inviter.getUsername());
    }

    @Transactional(readOnly = true)
    public synchronized List<PartyInviteDTO> incoming(Authentication authentication) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        Instant now = clock.instant();
        return invitesById.values().stream()
                .filter(invite -> invite.getInvitee() != null
                        && inviteeId.equals(invite.getInvitee().getId()))
                .filter(invite -> invite.getStatus() == PartyInviteStatus.PENDING)
                .filter(invite -> invite.getExpiresAt() != null
                        && now.isBefore(invite.getExpiresAt()))
                .filter(invite -> invite.getParty() != null
                        && activePartiesById.containsKey(invite.getParty().getId()))
                .filter(invite -> !blockLookup.isBlocked(
                        inviteeId,
                        invite.getInviter() == null ? null : invite.getInviter().getId()))
                .map(this::toInviteDTO)
                .toList();
    }

    @Transactional
    public synchronized AcceptedInvite accept(Authentication authentication, UUID inviteId) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        PartyInvite invite = requirePendingInviteForAccept(inviteId, inviteeId);
        Party party = requirePartyForUpdate(invite.getParty().getId());
        AppUser invitee = invite.getInvitee();
        if (party.getStatus() != PartyStatus.ACTIVE) {
            throw new InviteTargetUnavailableException("Party no longer exists");
        }
        rejectActiveMatch(inviteeId);
        if (activePartyForUser(inviteeId) != null) {
            throw new AuthException("you are already in a party");
        }

        List<PartyMember> members = membersFor(party);
        if (members.size() >= capacityFor(party)) {
            throw new AuthException("the party is already full");
        }
        addMember(party, invitee, nextSlot(members, capacityFor(party)));
        bindCurrentSocket(invitee);

        invite.setStatus(PartyInviteStatus.ACCEPTED);
        invite.setRespondedAt(clock.instant());
        PartyDTO partyDTO = toDTO(party);
        List<PartyRecipient> recipients = recipientsFor(party).stream()
                .filter(recipient -> !inviteeId.equals(recipient.userId()))
                .toList();
        return new AcceptedInvite(
                toInviteDTO(invite),
                partyDTO,
                recipients,
                recipientsFor(party),
                invitee.getUsername(),
                invitee.getId());
    }

    @Transactional
    public synchronized DeclinedInvite decline(Authentication authentication, UUID inviteId) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        PartyInvite invite = requirePendingInviteForDecline(inviteId, inviteeId);
        invite.setStatus(PartyInviteStatus.DECLINED);
        invite.setRespondedAt(clock.instant());
        AppUser inviter = invite.getInviter();
        return new DeclinedInvite(
                toInviteDTO(invite),
                inviter.getEmail(),
                inviter.getId(),
                invite.getInvitee().getUsername(),
                invite.getInvitee().getId());
    }

    @Transactional
    public synchronized LeaveResult leave(Authentication authentication, UUID partyId) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        Party party = requirePartyForUpdate(partyId);
        if (partyIdsByUserId.get(user.getId()) == null
                || !partyId.equals(partyIdsByUserId.get(user.getId()))) {
            throw new AuthException("you are not a member of this party");
        }
        return removeMember(party, user.getId());
    }

    @Transactional
    public synchronized LeaveResult kick(
            Authentication authentication,
            UUID partyId,
            UUID targetUserId) {
        AppUser leader = currentUserService.requireCurrentUser(authentication);
        Party party = requirePartyForUpdate(partyId);
        requireLeader(party, leader.getId());
        if (targetUserId == null || leader.getId().equals(targetUserId)) {
            throw new AuthException("you cannot kick yourself");
        }
        boolean targetIsMember = membersFor(party).stream()
                .anyMatch(member -> member.getUser() != null
                        && targetUserId.equals(member.getUser().getId()));
        if (!targetIsMember) {
            throw new AuthException("the player is not in this party");
        }
        return removeMember(party, targetUserId);
    }

    /** Marks a party member offline only when the disconnected socket is current. */
    public synchronized LeaveResult removeDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) {
            return new LeaveResult(null, null, List.of());
        }
        Party party = activePartiesById.values().stream()
                .filter(candidate -> membersFor(candidate).stream().anyMatch(member ->
                        member.getUser() != null
                                && principalName.equals(member.getUser().getEmail())))
                .findFirst()
                .orElse(null);
        if (party == null) return new LeaveResult(null, null, List.of());

        UUID userId = membersFor(party).stream()
                .filter(member -> member.getUser() != null
                        && principalName.equals(member.getUser().getEmail()))
                .map(member -> member.getUser().getId())
                .findFirst()
                .orElse(null);
        if (userId == null) return new LeaveResult(null, null, List.of());

        String registeredSocket = socketSessionIdsByUserId.get(userId);
        if (registeredSocket != null && socketSessionId != null
                && !registeredSocket.equals(socketSessionId)) {
            return new LeaveResult(null, null, List.of());
        }
        String currentSocket = currentSocketForPrincipal(principalName);
        if (currentSocket != null && socketSessionId != null
                && !currentSocket.equals(socketSessionId)) {
            return new LeaveResult(null, null, List.of());
        }
        if (registeredSocket == null && currentSocket == null) {
            return new LeaveResult(null, null, List.of());
        }
        socketSessionIdsByUserId.remove(userId, registeredSocket);
        return new LeaveResult(toDTO(party), party.getId(), recipientsFor(party));
    }

    /**
     * Removes party membership that cannot carry into a custom match. A party
     * leader starting without every party member disbands the party; a
     * non-leader starting without the party leaves only their own membership.
     */
    public synchronized List<CustomMatchPartyChange> prepareForCustomMatch(
            Collection<UUID> matchUserIds) {
        Set<UUID> entrants = matchUserIds == null
                ? Set.of()
                : matchUserIds.stream().filter(java.util.Objects::nonNull).collect(java.util.stream.Collectors.toSet());
        List<CustomMatchPartyChange> changes = new ArrayList<>();
        for (Party party : List.copyOf(activePartiesById.values())) {
            List<PartyMember> members = membersFor(party);
            Set<UUID> partyUserIds = members.stream()
                    .filter(member -> member.getUser() != null && member.getUser().getId() != null)
                    .map(member -> member.getUser().getId())
                    .collect(java.util.stream.Collectors.toSet());
            if (partyUserIds.isEmpty() || entrants.containsAll(partyUserIds)) {
                continue;
            }

            UUID ownerId = party.getOwner() == null ? null : party.getOwner().getId();
            if (ownerId != null && entrants.contains(ownerId)) {
                List<PartyRecipient> detachedRecipients = members.stream()
                        .filter(member -> member.getUser() != null)
                        .map(member -> new PartyRecipient(
                                member.getUser().getEmail(),
                                member.getUser().getId()))
                        .toList();
                clearParty(party);
                changes.add(new CustomMatchPartyChange(
                        party.getId(),
                        null,
                        List.of(),
                        detachedRecipients));
                continue;
            }

            List<PartyMember> departing = members.stream()
                    .filter(member -> member.getUser() != null
                            && entrants.contains(member.getUser().getId()))
                    .toList();
            if (departing.isEmpty()) continue;
            List<PartyRecipient> detachedRecipients = departing.stream()
                    .map(member -> new PartyRecipient(
                            member.getUser().getEmail(),
                            member.getUser().getId()))
                    .toList();
            members.removeAll(departing);
            departing.forEach(member -> {
                UUID userId = member.getUser().getId();
                partyIdsByUserId.remove(userId, party.getId());
                socketSessionIdsByUserId.remove(userId);
            });
            if (members.isEmpty()) {
                activePartiesById.remove(party.getId());
                membersByPartyId.remove(party.getId());
                changes.add(new CustomMatchPartyChange(
                        party.getId(),
                        null,
                        List.of(),
                        detachedRecipients));
            } else {
                membersByPartyId.put(party.getId(), members);
                changes.add(new CustomMatchPartyChange(
                        party.getId(),
                        toDTO(party),
                        recipientsFor(party),
                        detachedRecipients));
            }
        }
        return List.copyOf(changes);
    }

    @Transactional
    public synchronized int cleanupExpiredInvites() {
        Instant now = clock.instant();
        List<UUID> expired = invitesById.values().stream()
                .filter(invite -> invite.getStatus() == PartyInviteStatus.PENDING
                        && (invite.getExpiresAt() == null
                                || !now.isBefore(invite.getExpiresAt())))
                .map(invite -> {
                    invite.setStatus(PartyInviteStatus.EXPIRED);
                    invite.setRespondedAt(now);
                    return invite.getId();
                })
                .toList();
        expired.forEach(invitesById::remove);
        return expired.size();
    }

    private MatchEntrant entrantForMember(
            PartyMember member,
            UUID requesterId,
            String requesterUsername,
            String requesterPrincipalName,
            String requesterSocketSessionId) {
        AppUser user = member.getUser();
        if (user == null || user.getId() == null || user.getEmail() == null) {
            throw new AuthException("the party roster is invalid");
        }
        boolean requester = requesterId.equals(user.getId());
        String principalName = requester ? requesterPrincipalName : user.getEmail();
        String liveSocket = currentSocketForPrincipal(principalName);
        String socketSessionId;
        if (socketRegistry != null) {
            // The registry is authoritative. A cached socket id must never
            // keep a disconnected member eligible for a new match.
            if (liveSocket == null || liveSocket.isBlank()) {
                throw new AuthException("every party member must have an active socket connection");
            }
            socketSessionId = liveSocket;
        } else {
            socketSessionId = requester
                    ? requesterSocketSessionId
                    : socketSessionIdsByUserId.get(user.getId());
        }
        if (socketSessionId == null || socketSessionId.isBlank()) {
            throw new AuthException("every party member must have an active socket connection");
        }
        if (requester && (requesterPrincipalName == null || requesterPrincipalName.isBlank())) {
            throw new AuthException("the queue connection is not authenticated");
        }
        if (socketRegistry != null && liveSocket != null
                && requester && requesterSocketSessionId != null
                && !liveSocket.equals(requesterSocketSessionId)) {
            throw new AuthException("the queue request belongs to another connection");
        }
        if (socketSessionId != null && !socketSessionId.isBlank()) {
            socketSessionIdsByUserId.put(user.getId(), socketSessionId);
        }
        return new MatchEntrant(
                user.getId(),
                requester ? requesterUsername : user.getUsername(),
                principalName,
                socketSessionId);
    }

    private void addMember(Party party, AppUser user, short slot) {
        PartyMember member = new PartyMember();
        member.setId(UUID.randomUUID());
        member.setParty(party);
        member.setUser(user);
        member.setSlot(slot);
        membersByPartyId.computeIfAbsent(party.getId(), ignored -> new ArrayList<>()).add(member);
        partyIdsByUserId.put(user.getId(), party.getId());
    }

    private LeaveResult removeMember(Party party, UUID userId) {
        List<PartyMember> members = membersFor(party);
        PartyRecipient removedRecipient = members.stream()
                .filter(member -> member.getUser() != null
                        && userId.equals(member.getUser().getId()))
                .map(member -> new PartyRecipient(
                        member.getUser().getEmail(),
                        member.getUser().getId()))
                .findFirst()
                .orElse(null);
        List<PartyRecipient> recipients = members.stream()
                .filter(member -> member.getUser() != null
                        && !userId.equals(member.getUser().getId()))
                .map(member -> new PartyRecipient(
                        member.getUser().getEmail(),
                        member.getUser().getId()))
                .toList();
        membersByPartyId.put(
                party.getId(),
                members.stream()
                        .filter(member -> !userId.equals(member.getUser().getId()))
                        .sorted(Comparator.comparingInt(PartyMember::getSlot))
                        .collect(java.util.stream.Collectors.toCollection(ArrayList::new)));
        partyIdsByUserId.remove(userId, party.getId());
        socketSessionIdsByUserId.remove(userId);
        List<PartyMember> remaining = membersFor(party);
        if (remaining.isEmpty()) {
            activePartiesById.remove(party.getId());
            membersByPartyId.remove(party.getId());
            return new LeaveResult(null, party.getId(), recipients, removedRecipient);
        }
        if (party.getOwner() != null && userId.equals(party.getOwner().getId())) {
            party.setOwner(remaining.getFirst().getUser());
        }
        return new LeaveResult(toDTO(party), party.getId(), recipients, removedRecipient);
    }

    private void clearParty(Party party) {
        activePartiesById.remove(party.getId());
        List<PartyMember> members = membersByPartyId.remove(party.getId());
        if (members == null) return;
        members.forEach(member -> {
            if (member.getUser() == null || member.getUser().getId() == null) return;
            partyIdsByUserId.remove(member.getUser().getId(), party.getId());
            socketSessionIdsByUserId.remove(member.getUser().getId());
        });
    }

    private void bindCurrentSocket(AppUser user) {
        String socket = currentSocketForPrincipal(user == null ? null : user.getEmail());
        if (socket != null) socketSessionIdsByUserId.put(user.getId(), socket);
    }

    private String currentSocketForPrincipal(String principalName) {
        return socketRegistry == null
                ? null
                : socketRegistry.currentSessionIdForPrincipal(principalName);
    }

    private Party activePartyForUser(UUID userId) {
        UUID partyId = userId == null ? null : partyIdsByUserId.get(userId);
        return partyId == null ? null : activePartiesById.get(partyId);
    }

    private Party requirePartyForUpdate(UUID partyId) {
        if (partyId == null) {
            throw new AuthException("the party is no longer available");
        }
        Party party = activePartiesById.get(partyId);
        if (party == null || party.getStatus() != PartyStatus.ACTIVE) {
            throw new AuthException("the party is no longer available");
        }
        return party;
    }

    private void requireLeader(Party party, UUID userId) {
        if (party.getStatus() != PartyStatus.ACTIVE
                || party.getOwner() == null
                || !party.getOwner().getId().equals(userId)) {
            throw new AuthException("only the party leader can invite players");
        }
    }

    private void requireQueueLeader(Party party, UUID userId) {
        if (party.getStatus() != PartyStatus.ACTIVE
                || party.getOwner() == null
                || !party.getOwner().getId().equals(userId)) {
            throw new AuthException("only the party leader can queue for the party");
        }
    }

    private void rejectActiveMatch(UUID userId) {
        if (matchService.activeMatchStatus(userId).activeMatch()) {
            throw new AuthException("players must be outside an active match");
        }
    }

    private PartyInvite pendingInviteFor(UUID partyId, UUID inviteeId) {
        return invitesById.values().stream()
                .filter(invite -> invite.getParty() != null
                        && partyId.equals(invite.getParty().getId()))
                .filter(invite -> invite.getInvitee() != null
                        && inviteeId.equals(invite.getInvitee().getId()))
                .filter(invite -> invite.getStatus() == PartyInviteStatus.PENDING)
                .findFirst()
                .orElse(null);
    }

    private PartyInvite requirePendingInviteForAccept(UUID inviteId, UUID inviteeId) {
        PartyInvite invite = requirePendingInviteForDecline(inviteId, inviteeId);
        if (invite.getParty() == null
                || !activePartiesById.containsKey(invite.getParty().getId())
                || invite.getParty().getStatus() != PartyStatus.ACTIVE) {
            throw new InviteTargetUnavailableException("Party no longer exists");
        }
        return invite;
    }

    private PartyInvite requirePendingInviteForDecline(UUID inviteId, UUID inviteeId) {
        if (inviteId == null || inviteeId == null) {
            throw new AuthException("the party invite is no longer available");
        }
        PartyInvite invite = invitesById.get(inviteId);
        Instant now = clock.instant();
        if (invite == null
                || invite.getInvitee() == null
                || !inviteeId.equals(invite.getInvitee().getId())
                || invite.getStatus() != PartyInviteStatus.PENDING) {
            throw new AuthException("the party invite is no longer available");
        }
        if (invite.getExpiresAt() == null || !now.isBefore(invite.getExpiresAt())) {
            invite.setStatus(PartyInviteStatus.EXPIRED);
            invite.setRespondedAt(now);
            invitesById.remove(inviteId);
            throw new AuthException("the party invite has expired");
        }
        return invite;
    }

    private List<PartyMember> membersFor(Party party) {
        return new ArrayList<>(membersByPartyId.getOrDefault(party.getId(), List.of()));
    }

    private List<PartyRecipient> recipientsFor(Party party) {
        return membersFor(party).stream()
                .map(member -> new PartyRecipient(
                        member.getUser().getEmail(),
                        member.getUser().getId()))
                .toList();
    }

    private short capacityFor(Party party) {
        return party.getCapacity() > 0 ? party.getCapacity() : CURRENT_PARTY_CAPACITY;
    }

    private short nextSlot(List<PartyMember> members, short capacity) {
        for (short slot = 1; slot <= capacity; slot++) {
            short candidate = slot;
            if (members.stream().noneMatch(member -> member.getSlot() == candidate)) {
                return candidate;
            }
        }
        throw new AuthException("the party is already full");
    }

    private PartyDTO toDTO(Party party) {
        UUID ownerId = party.getOwner() == null ? null : party.getOwner().getId();
        List<PartyMemberDTO> members = membersFor(party).stream()
                .map(member -> new PartyMemberDTO(
                        member.getUser().getId(),
                        member.getUser().getUsername(),
                        member.getSlot(),
                        ownerId != null && ownerId.equals(member.getUser().getId()),
                        isMemberOnline(member)))
                .toList();
        return new PartyDTO(
                party.getId(),
                party.getOwner() == null ? null : party.getOwner().getUsername(),
                capacityFor(party),
                members);
    }

    private PartyInviteDTO toInviteDTO(PartyInvite invite) {
        Instant createdAt = invite.getCreatedAt() == null
                ? clock.instant()
                : invite.getCreatedAt();
        return new PartyInviteDTO(
                invite.getId(),
                invite.getParty() == null ? null : invite.getParty().getId(),
                invite.getStatus() == null ? null : invite.getStatus().name(),
                invite.getInviter() == null ? null : invite.getInviter().getUsername(),
                invite.getInvitee() == null ? null : invite.getInvitee().getUsername(),
                createdAt,
                invite.getExpiresAt());
    }

    private boolean isMemberOnline(PartyMember member) {
        if (member == null || member.getUser() == null || member.getUser().getId() == null) {
            return false;
        }
        if (socketRegistry != null) {
            String currentSocket = currentSocketForPrincipal(member.getUser().getEmail());
            if (currentSocket == null || currentSocket.isBlank()) {
                return false;
            }
            // The transport registry sees reconnects before the party
            // subscription handler can refresh this cached party binding.
            socketSessionIdsByUserId.put(member.getUser().getId(), currentSocket);
            return true;
        }
        String registeredSocket = socketSessionIdsByUserId.get(member.getUser().getId());
        return registeredSocket != null && !registeredSocket.isBlank();
    }

    public record CreatedInvite(
            PartyInviteDTO invite,
            String recipientPrincipalName,
            UUID recipientUserId,
            UUID actorUserId,
            String actorUsername) {
    }

    public record AcceptedInvite(
            PartyInviteDTO invite,
            PartyDTO party,
            List<PartyRecipient> recipients,
            List<PartyRecipient> partyRecipients,
            String actorUsername,
            UUID actorUserId) {
    }

    public record LeaveResult(
            PartyDTO party,
            UUID partyId,
            List<PartyRecipient> recipients,
            PartyRecipient removedRecipient) {
        public LeaveResult(
                PartyDTO party,
                UUID partyId,
                List<PartyRecipient> recipients) {
            this(party, partyId, recipients, null);
        }
    }

    public record CustomMatchPartyChange(
            UUID partyId,
            PartyDTO party,
            List<PartyRecipient> recipients,
            List<PartyRecipient> detachedRecipients) {
    }

    public record QueueContext(
            UUID partyId,
            PartyDTO party,
            List<MatchEntrant> entrants,
            List<PartyRecipient> recipients) {
    }

    public record DeclinedInvite(
            PartyInviteDTO invite,
            String recipientPrincipalName,
            UUID recipientUserId,
            String actorUsername,
            UUID actorUserId) {
    }

    public record PartyRecipient(String principalName, UUID userId) {
    }
}
