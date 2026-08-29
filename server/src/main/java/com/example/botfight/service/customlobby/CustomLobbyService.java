package com.example.botfight.service.customlobby;

import com.example.botfight.DTO.CustomLobbyDTO;
import com.example.botfight.DTO.CustomLobbyInviteDTO;
import com.example.botfight.DTO.CustomLobbyMemberDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.UsernamePolicy;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.timing.MatchTimingPolicy;
import com.example.botfight.service.invite.InviteTargetUnavailableException;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

/**
 * Owns invite-only custom lobbies. Lobby state is intentionally transient and
 * server-owned; it is not a queue snapshot or a persisted match roster. A
 * lobby remains in memory while its custom match is running so its members can
 * return to the same lobby when the match is complete.
 */
@Service
public class CustomLobbyService {

    public static final int CURRENT_LOBBY_CAPACITY = 4;
    public static final int TEAM_NONE = 0;
    public static final int BLUE_TEAM = 1;
    public static final int RED_TEAM = 2;
    public static final int MAX_TEAM_SIZE = 2;
    public static final Duration INVITE_VALIDITY = Duration.ofMinutes(10);

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final MatchService matchService;
    private final TokenBucketRateLimiter<UUID> inviteRateLimiter;
    private final TokenBucketRateLimiter<UUID> teamRateLimiter;
    private final Clock clock;
    private final BlockLookup blockLookup;
    private final SingleUserWebSocketSessionRegistry socketRegistry;
    private final PartyService partyService;

    private final Map<UUID, ActiveLobby> activeLobbiesById = new HashMap<>();
    private final Map<UUID, UUID> lobbyIdsByUserId = new HashMap<>();
    private final Map<UUID, String> socketSessionIdsByUserId = new HashMap<>();
    private final Map<UUID, LobbyInvite> invitesById = new HashMap<>();

    @Autowired
    public CustomLobbyService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            MatchService matchService,
            @Qualifier("customLobbyInviteRateLimiter") TokenBucketRateLimiter<UUID> inviteRateLimiter,
            @Qualifier("customLobbyTeamRateLimiter") TokenBucketRateLimiter<UUID> teamRateLimiter,
            Clock clock,
            BlockLookup blockLookup,
            SingleUserWebSocketSessionRegistry socketRegistry,
            PartyService partyService) {
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.matchService = matchService;
        this.inviteRateLimiter = inviteRateLimiter;
        this.teamRateLimiter = teamRateLimiter;
        this.clock = clock;
        this.blockLookup = blockLookup;
        this.socketRegistry = socketRegistry;
        this.partyService = partyService;
    }

    /** Binds a lobby member to the authenticated socket that subscribed to the lobby channel. */
    public synchronized void registerSocket(String principalName, String socketSessionId) {
        if (principalName == null || principalName.isBlank()
                || socketSessionId == null || socketSessionId.isBlank()) {
            return;
        }
        activeLobbiesById.values().stream()
                .flatMap(lobby -> lobby.members.values().stream())
                .filter(member -> member.user.getEmail() != null
                        && principalName.equals(member.user.getEmail()))
                .findFirst()
                .ifPresent(member -> socketSessionIdsByUserId.put(
                        member.user.getId(), socketSessionId));
    }

    public synchronized CustomLobbyDTO currentForPrincipal(String principalName) {
        if (principalName == null || principalName.isBlank()) return null;
        return activeLobbiesById.values().stream()
                .filter(lobby -> lobby.members.values().stream().anyMatch(member ->
                        member.user.getEmail() != null
                                && principalName.equals(member.user.getEmail())))
                .findFirst()
                .map(this::toDTO)
                .orElse(null);
    }

    public synchronized List<LobbyRecipient> recipientsForLobby(UUID lobbyId) {
        ActiveLobby lobby = lobbyId == null ? null : activeLobbiesById.get(lobbyId);
        return lobby == null ? List.of() : recipientsFor(lobby);
    }

    /**
     * Returns an atomic, membership-checked snapshot for the lobby chat path.
     * The principal is checked against the member's authenticated email so a
     * caller cannot use another member's user id to publish into the lobby.
     */
    public synchronized LobbyChatContext chatContextFor(
            UUID lobbyId,
            UUID userId,
            String principalName) {
        ActiveLobby lobby = lobbyId == null ? null : activeLobbiesById.get(lobbyId);
        LobbyMember member = lobby == null || userId == null
                ? null
                : lobby.members.get(userId);
        if (member == null
                || principalName == null
                || member.user.getEmail() == null
                || !principalName.equals(member.user.getEmail())) {
            return null;
        }
        return new LobbyChatContext(
                lobby.lobbyId,
                member.user.getUsername(),
                recipientsFor(lobby));
    }

    public synchronized CustomLobbyDTO create(Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        rejectActiveMatch(user.getId());
        ActiveLobby existing = activeLobbyForUser(user.getId());
        if (existing != null) return toDTO(existing);

        ActiveLobby lobby = new ActiveLobby(UUID.randomUUID(), user);
        lobby.members.put(user.getId(), new LobbyMember(user, TEAM_NONE, 0L));
        activeLobbiesById.put(lobby.lobbyId, lobby);
        lobbyIdsByUserId.put(user.getId(), lobby.lobbyId);
        bindCurrentSocket(user);
        return toDTO(lobby);
    }

    public synchronized CreatedInvite invite(
            Authentication authentication,
            UUID lobbyId,
            String requestedUsername) {
        AppUser inviter = currentUserService.requireCurrentUser(authentication);
        inviteRateLimiter.requireAllowed(inviter.getId());
        ActiveLobby lobby = requireLobby(lobbyId);
        requireOwner(lobby, inviter.getId());
        requireLobbyAvailable(lobby);
        if (lobby.members.size() >= CURRENT_LOBBY_CAPACITY) {
            throw new AuthException("the custom lobby is already full");
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
        if (activeLobbyForUser(invitee.getId()) != null) {
            throw new AuthException("that player is already in a custom lobby");
        }

        Instant now = clock.instant();
        LobbyInvite existing = pendingInviteFor(lobby.lobbyId, invitee.getId());
        if (existing != null && existing.expiresAt != null && now.isBefore(existing.expiresAt)) {
            throw new AuthException("a custom lobby invite is already pending for this player");
        }
        if (existing != null) invitesById.remove(existing.inviteId);

        LobbyInvite invite = new LobbyInvite(
                UUID.randomUUID(),
                lobby.lobbyId,
                inviter,
                invitee,
                now,
                now.plus(INVITE_VALIDITY),
                lobby.nextMemberOrder++);
        invitesById.put(invite.inviteId, invite);
        return new CreatedInvite(
                toInviteDTO(invite),
                invitee.getEmail(),
                invitee.getId(),
                inviter.getId(),
                inviter.getUsername());
    }

    public synchronized List<CustomLobbyInviteDTO> incoming(Authentication authentication) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        Instant now = clock.instant();
        return invitesById.values().stream()
                .filter(invite -> invite.invitee.getId().equals(inviteeId))
                .filter(invite -> "PENDING".equals(invite.status))
                .filter(invite -> invite.expiresAt != null && now.isBefore(invite.expiresAt))
                .filter(invite -> activeLobbiesById.containsKey(invite.lobbyId))
                .filter(invite -> !blockLookup.isBlocked(
                        inviteeId,
                        invite.inviter == null ? null : invite.inviter.getId()))
                .map(this::toInviteDTO)
                .toList();
    }

    public synchronized AcceptedInvite accept(Authentication authentication, UUID inviteId) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        LobbyInvite invite = requirePendingInviteForAccept(inviteId, inviteeId);
        rejectActiveMatch(inviteeId);
        if (blockLookup.isBlocked(inviteeId, invite.inviter.getId())
                || blockLookup.isBlocked(invite.inviter.getId(), inviteeId)) {
            throw new AuthException("the custom lobby invite is no longer available");
        }
        if (activeLobbyForUser(inviteeId) != null) {
            throw new AuthException("you are already in a custom lobby");
        }
        ActiveLobby lobby = requireLobby(invite.lobbyId);
        requireLobbyAvailable(lobby);
        if (lobby.members.size() >= CURRENT_LOBBY_CAPACITY) {
            throw new AuthException("the custom lobby is already full");
        }

        lobby.members.put(inviteeId, new LobbyMember(
                invite.invitee,
                TEAM_NONE,
                invite.memberOrder));
        lobbyIdsByUserId.put(inviteeId, lobby.lobbyId);
        bindCurrentSocket(invite.invitee);
        invite.status = "ACCEPTED";
        invitesById.remove(invite.inviteId);
        return new AcceptedInvite(
                toInviteDTO(invite),
                toDTO(lobby),
                recipientsFor(lobby),
                invite.invitee.getUsername(),
                inviteeId);
    }

    public synchronized DeclinedInvite decline(Authentication authentication, UUID inviteId) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        LobbyInvite invite = requirePendingInviteForDecline(inviteId, inviteeId);
        invite.status = "DECLINED";
        invitesById.remove(invite.inviteId);
        return new DeclinedInvite(
                toInviteDTO(invite),
                invite.inviter.getEmail(),
                invite.inviter.getId(),
                invite.invitee.getUsername(),
                inviteeId);
    }

    public synchronized LobbyChange setTeam(
            Authentication authentication,
            UUID lobbyId,
            Integer requestedTeamNumber) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        ActiveLobby lobby = requireMember(lobbyId, user.getId());
        requireLobbyAvailable(lobby);
        int teamNumber = requestedTeamNumber == null ? -1 : requestedTeamNumber;
        if (teamNumber < TEAM_NONE || teamNumber > RED_TEAM) {
            throw new AuthException("choose no team, Blue Team, or Red Team");
        }
        LobbyMember member = lobby.members.get(user.getId());
        if (member == null) {
            throw new AuthException("you are not a member of this custom lobby");
        }
        if (member.teamNumber == teamNumber) {
            return stateChange(lobby);
        }
        if ((teamNumber == BLUE_TEAM || teamNumber == RED_TEAM)
                && teamCount(lobby, teamNumber) >= MAX_TEAM_SIZE
                && member.teamNumber != teamNumber) {
            throw new AuthException("that team is full");
        }
        teamRateLimiter.requireAllowed(user.getId());
        member.teamNumber = teamNumber;
        return stateChange(lobby);
    }

    public synchronized LobbyChange updateRoundDuration(
            Authentication authentication,
            UUID lobbyId,
            Integer requestedRoundDurationSeconds) {
        AppUser owner = currentUserService.requireCurrentUser(authentication);
        ActiveLobby lobby = requireLobby(lobbyId);
        requireOwner(lobby, owner.getId());
        requireLobbyAvailable(lobby);
        final int roundDurationSeconds;
        try {
            roundDurationSeconds = MatchTimingPolicy.requireCustomRoundDurationSeconds(
                    requestedRoundDurationSeconds);
        } catch (IllegalArgumentException exception) {
            throw new AuthException(exception.getMessage());
        }
        lobby.roundDurationSeconds = roundDurationSeconds;
        return stateChange(lobby);
    }

    public synchronized LobbyChange leave(Authentication authentication, UUID lobbyId) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        ActiveLobby lobby = requireMember(lobbyId, user.getId());
        requireLobbyAvailable(lobby);
        return removeMember(lobby, user.getId());
    }

    public synchronized LobbyChange kick(
            Authentication authentication,
            UUID lobbyId,
            UUID targetUserId) {
        AppUser owner = currentUserService.requireCurrentUser(authentication);
        ActiveLobby lobby = requireLobby(lobbyId);
        requireOwner(lobby, owner.getId());
        requireLobbyAvailable(lobby);
        if (targetUserId == null || owner.getId().equals(targetUserId)) {
            throw new AuthException("you cannot kick yourself from the custom lobby");
        }
        if (!lobby.members.containsKey(targetUserId)) {
            throw new AuthException("the player is not in this custom lobby");
        }
        return removeMember(lobby, targetUserId);
    }

    /** Starts the authoritative match once every member has joined a team. */
    public synchronized StartedMatch start(Authentication authentication, UUID lobbyId) {
        AppUser owner = currentUserService.requireCurrentUser(authentication);
        ActiveLobby lobby = requireLobby(lobbyId);
        requireOwner(lobby, owner.getId());
        requireLobbyAvailable(lobby);
        if (lobby.members.size() < 2) {
            throw new AuthException("a custom match needs at least two players");
        }
        if (lobby.members.size() > CURRENT_LOBBY_CAPACITY) {
            throw new AuthException("the custom lobby has too many players");
        }
        if (lobby.members.values().stream().anyMatch(member -> member.teamNumber == TEAM_NONE)) {
            throw new AuthException("every player must choose a team before the match can start");
        }
        if (teamCount(lobby, BLUE_TEAM) == 0 || teamCount(lobby, RED_TEAM) == 0) {
            throw new AuthException("both teams need at least one player");
        }
        if (lobby.members.values().stream().anyMatch(member -> !isMemberOnline(member))) {
            throw new AuthException("every player must be online before the match can start");
        }
        lobby.members.values().forEach(member -> rejectActiveMatch(member.user.getId()));

        List<MatchEntrant> entrants = lobby.members.values().stream()
                .map(member -> new MatchEntrant(
                        member.user.getId(),
                        member.user.getUsername(),
                        member.user.getEmail(),
                        currentSocketForPrincipal(member.user.getEmail()),
                        member.teamNumber))
                .toList();
        List<OutboundMatchmakingEvent> events = matchService.startTeamMatch(
                entrants, MatchMode.CUSTOM, lobby.roundDurationSeconds);
        UUID matchId = events.stream()
                .map(OutboundMatchmakingEvent::event)
                .map(event -> event.matchId())
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElseThrow(() -> new AuthException("the custom match could not be started"));
        lobby.activeMatchId = matchId;
        List<LobbyRecipient> lobbyRecipients = recipientsFor(lobby);
        CustomLobbyDTO lobbySnapshot = toDTO(lobby);
        List<PartyService.CustomMatchPartyChange> partyChanges = partyService == null
                ? List.of()
                : partyService.prepareForCustomMatch(
                        entrants.stream().map(MatchEntrant::userId).collect(Collectors.toSet()));
        return new StartedMatch(
                matchId,
                events,
                lobby.lobbyId,
                lobbySnapshot,
                lobbyRecipients,
                partyChanges);
    }

    /**
     * Releases a completed custom match without removing the lobby or its
     * members. The operation is idempotent because terminal events can be
     * delivered once per player.
     */
    public synchronized LobbyChange finishMatch(UUID matchId) {
        if (matchId == null) {
            return new LobbyChange(null, null, List.of(), List.of());
        }
        ActiveLobby lobby = activeLobbiesById.values().stream()
                .filter(candidate -> matchId.equals(candidate.activeMatchId))
                .findFirst()
                .orElse(null);
        if (lobby == null) {
            return new LobbyChange(null, null, List.of(), List.of());
        }
        lobby.members.values().forEach(member -> member.teamNumber = TEAM_NONE);
        lobby.activeMatchId = null;
        return stateChange(lobby);
    }

    /** Marks a member offline only when the disconnect belongs to their current socket. */
    public synchronized LobbyChange removeDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) {
            return new LobbyChange(null, null, List.of(), List.of());
        }
        ActiveLobby lobby = activeLobbiesById.values().stream()
                .filter(candidate -> candidate.members.values().stream().anyMatch(member ->
                        principalName.equals(member.user.getEmail())))
                .findFirst()
                .orElse(null);
        if (lobby == null) return new LobbyChange(null, null, List.of(), List.of());
        LobbyMember member = lobby.members.values().stream()
                .filter(candidate -> principalName.equals(candidate.user.getEmail()))
                .findFirst()
                .orElse(null);
        if (member == null) return new LobbyChange(null, null, List.of(), List.of());

        UUID userId = member.user.getId();
        String registeredSocket = socketSessionIdsByUserId.get(userId);
        if (registeredSocket != null && socketSessionId != null
                && !registeredSocket.equals(socketSessionId)) {
            return new LobbyChange(null, null, List.of(), List.of());
        }
        String currentSocket = currentSocketForPrincipal(principalName);
        if (currentSocket != null && socketSessionId != null
                && !currentSocket.equals(socketSessionId)) {
            return new LobbyChange(null, null, List.of(), List.of());
        }
        if (registeredSocket == null && currentSocket == null) {
            return new LobbyChange(null, null, List.of(), List.of());
        }
        socketSessionIdsByUserId.remove(userId, registeredSocket);
        return stateChange(lobby);
    }

    public synchronized int cleanupExpiredInvites() {
        Instant now = clock.instant();
        List<UUID> expired = invitesById.values().stream()
                .filter(invite -> "PENDING".equals(invite.status)
                        && (invite.expiresAt == null || !now.isBefore(invite.expiresAt)))
                .map(invite -> invite.inviteId)
                .toList();
        expired.forEach(invitesById::remove);
        return expired.size();
    }

    private LobbyChange stateChange(ActiveLobby lobby) {
        return new LobbyChange(lobby.lobbyId, toDTO(lobby), recipientsFor(lobby), List.of());
    }

    private LobbyChange removeMember(ActiveLobby lobby, UUID userId) {
        LobbyMember removed = lobby.members.remove(userId);
        if (removed == null) {
            throw new AuthException("the player is not in this custom lobby");
        }
        lobbyIdsByUserId.remove(userId, lobby.lobbyId);
        socketSessionIdsByUserId.remove(userId);
        List<LobbyRecipient> detached = List.of(new LobbyRecipient(
                removed.user.getEmail(),
                removed.user.getId()));
        if (lobby.members.isEmpty()) {
            clearLobby(lobby);
            return new LobbyChange(lobby.lobbyId, null, List.of(), detached);
        }
        if (lobby.owner != null && lobby.owner.getId().equals(userId)) {
            lobby.owner = lobby.members.values().stream()
                    .min(Comparator.comparingLong(member -> member.memberOrder))
                    .map(member -> member.user)
                    .orElse(null);
        }
        return new LobbyChange(lobby.lobbyId, toDTO(lobby), recipientsFor(lobby), detached);
    }

    private void clearLobby(ActiveLobby lobby) {
        activeLobbiesById.remove(lobby.lobbyId);
        lobby.members.values().forEach(member -> {
            lobbyIdsByUserId.remove(member.user.getId(), lobby.lobbyId);
            socketSessionIdsByUserId.remove(member.user.getId());
        });
    }

    private ActiveLobby requireLobby(UUID lobbyId) {
        if (lobbyId == null) throw new AuthException("the custom lobby is no longer available");
        ActiveLobby lobby = activeLobbiesById.get(lobbyId);
        if (lobby == null) throw new AuthException("the custom lobby is no longer available");
        return lobby;
    }

    private ActiveLobby requireMember(UUID lobbyId, UUID userId) {
        ActiveLobby lobby = requireLobby(lobbyId);
        if (!lobby.members.containsKey(userId)) {
            throw new AuthException("you are not a member of this custom lobby");
        }
        return lobby;
    }

    private void requireOwner(ActiveLobby lobby, UUID userId) {
        if (lobby.owner == null || !lobby.owner.getId().equals(userId)) {
            throw new AuthException("only the custom lobby owner can perform that action");
        }
    }

    private void requireLobbyAvailable(ActiveLobby lobby) {
        if (lobby != null && lobby.activeMatchId != null) {
            throw new AuthException("the custom lobby is currently in a match");
        }
    }

    private ActiveLobby activeLobbyForUser(UUID userId) {
        UUID lobbyId = userId == null ? null : lobbyIdsByUserId.get(userId);
        return lobbyId == null ? null : activeLobbiesById.get(lobbyId);
    }

    private void rejectActiveMatch(UUID userId) {
        if (matchService.activeMatchStatus(userId).activeMatch()) {
            throw new AuthException("players must be outside an active match");
        }
    }

    private int teamCount(ActiveLobby lobby, int teamNumber) {
        return (int) lobby.members.values().stream()
                .filter(member -> member.teamNumber == teamNumber)
                .count();
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

    private boolean isMemberOnline(LobbyMember member) {
        if (member == null || member.user == null || member.user.getId() == null) return false;
        String registeredSocket = socketSessionIdsByUserId.get(member.user.getId());
        if (registeredSocket == null || registeredSocket.isBlank()) return false;
        if (socketRegistry == null) return true;
        String currentSocket = currentSocketForPrincipal(member.user.getEmail());
        return registeredSocket.equals(currentSocket);
    }

    private List<LobbyRecipient> recipientsFor(ActiveLobby lobby) {
        return lobby.members.values().stream()
                .map(member -> new LobbyRecipient(member.user.getEmail(), member.user.getId()))
                .toList();
    }

    private CustomLobbyDTO toDTO(ActiveLobby lobby) {
        UUID ownerId = lobby.owner == null ? null : lobby.owner.getId();
        return new CustomLobbyDTO(
                lobby.lobbyId,
                ownerId,
                lobby.owner == null ? null : lobby.owner.getUsername(),
                CURRENT_LOBBY_CAPACITY,
                lobby.roundDurationSeconds,
                lobby.members.values().stream()
                        .map(member -> new CustomLobbyMemberDTO(
                                member.user.getId(),
                                member.user.getUsername(),
                                member.teamNumber,
                                ownerId != null && ownerId.equals(member.user.getId()),
                                isMemberOnline(member)))
                        .toList());
    }

    private LobbyInvite pendingInviteFor(UUID lobbyId, UUID inviteeId) {
        return invitesById.values().stream()
                .filter(invite -> lobbyId.equals(invite.lobbyId))
                .filter(invite -> invite.invitee.getId().equals(inviteeId))
                .filter(invite -> "PENDING".equals(invite.status))
                .findFirst()
                .orElse(null);
    }

    private LobbyInvite requirePendingInviteForAccept(UUID inviteId, UUID inviteeId) {
        LobbyInvite invite = requirePendingInviteForDecline(inviteId, inviteeId);
        if (!activeLobbiesById.containsKey(invite.lobbyId)) {
            throw new InviteTargetUnavailableException("Lobby no longer exists");
        }
        return invite;
    }

    private LobbyInvite requirePendingInviteForDecline(UUID inviteId, UUID inviteeId) {
        if (inviteId == null || inviteeId == null) {
            throw new AuthException("the custom lobby invite is no longer available");
        }
        LobbyInvite invite = invitesById.get(inviteId);
        Instant now = clock.instant();
        if (invite == null
                || !inviteeId.equals(invite.invitee.getId())
                || !"PENDING".equals(invite.status)) {
            throw new AuthException("the custom lobby invite is no longer available");
        }
        if (invite.expiresAt == null || !now.isBefore(invite.expiresAt)) {
            invitesById.remove(inviteId);
            throw new AuthException("the custom lobby invite has expired");
        }
        return invite;
    }

    private CustomLobbyInviteDTO toInviteDTO(LobbyInvite invite) {
        return new CustomLobbyInviteDTO(
                invite.inviteId,
                invite.lobbyId,
                invite.status,
                invite.inviter.getUsername(),
                invite.invitee.getUsername(),
                invite.createdAt,
                invite.expiresAt);
    }

    public record LobbyRecipient(String principalName, UUID userId) {
    }

    public record LobbyChatContext(
            UUID lobbyId,
            String username,
            List<LobbyRecipient> recipients) {
    }

    public record LobbyChange(
            UUID lobbyId,
            CustomLobbyDTO lobby,
            List<LobbyRecipient> recipients,
            List<LobbyRecipient> detachedRecipients) {
    }

    public record CreatedInvite(
            CustomLobbyInviteDTO invite,
            String recipientPrincipalName,
            UUID recipientUserId,
            UUID actorUserId,
            String actorUsername) {
    }

    public record AcceptedInvite(
            CustomLobbyInviteDTO invite,
            CustomLobbyDTO lobby,
            List<LobbyRecipient> recipients,
            String actorUsername,
            UUID actorUserId) {
    }

    public record DeclinedInvite(
            CustomLobbyInviteDTO invite,
            String recipientPrincipalName,
            UUID recipientUserId,
            String actorUsername,
            UUID actorUserId) {
    }

    public record StartedMatch(
            UUID matchId,
            List<OutboundMatchmakingEvent> events,
            UUID lobbyId,
            CustomLobbyDTO lobby,
            List<LobbyRecipient> lobbyRecipients,
            List<PartyService.CustomMatchPartyChange> partyChanges) {
    }

    private static final class ActiveLobby {
        private final UUID lobbyId;
        private AppUser owner;
        private final Map<UUID, LobbyMember> members = new LinkedHashMap<>();
        private long nextMemberOrder = 1L;
        private UUID activeMatchId;
        private int roundDurationSeconds = MatchTimingPolicy.DEFAULT_CUSTOM_ROUND_SECONDS;

        private ActiveLobby(UUID lobbyId, AppUser owner) {
            this.lobbyId = lobbyId;
            this.owner = owner;
        }
    }

    private static final class LobbyMember {
        private final AppUser user;
        private final long memberOrder;
        private int teamNumber;

        private LobbyMember(AppUser user, int teamNumber, long memberOrder) {
            this.user = user;
            this.teamNumber = teamNumber;
            this.memberOrder = memberOrder;
        }
    }

    private static final class LobbyInvite {
        private final UUID inviteId;
        private final UUID lobbyId;
        private final AppUser inviter;
        private final AppUser invitee;
        private final Instant createdAt;
        private final Instant expiresAt;
        private final long memberOrder;
        private String status = "PENDING";

        private LobbyInvite(
                UUID inviteId,
                UUID lobbyId,
                AppUser inviter,
                AppUser invitee,
                Instant createdAt,
                Instant expiresAt,
                long memberOrder) {
            this.inviteId = inviteId;
            this.lobbyId = lobbyId;
            this.inviter = inviter;
            this.invitee = invitee;
            this.createdAt = createdAt;
            this.expiresAt = expiresAt;
            this.memberOrder = memberOrder;
        }
    }
}
