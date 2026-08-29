package com.example.botfight.service.invite;

import com.example.botfight.DTO.DuelInviteDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.DuelInvite;
import com.example.botfight.domain.DuelInviteStatus;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.repository.DuelInviteRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.UsernamePolicy;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DuelInviteService {

    public static final Duration INVITE_VALIDITY = Duration.ofMinutes(10);
    public static final Duration TERMINAL_RETENTION = Duration.ofDays(14);

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final DuelInviteRepository duelInviteRepository;
    private final MatchService matchService;
    private final MatchmakingService matchmakingService;
    private final SingleUserWebSocketSessionRegistry socketSessionRegistry;
    private final TokenBucketRateLimiter<UUID> inviteRateLimiter;
    private final Clock clock;
    private final BlockLookup blockLookup;

    @Autowired
    public DuelInviteService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            DuelInviteRepository duelInviteRepository,
            MatchService matchService,
            MatchmakingService matchmakingService,
            SingleUserWebSocketSessionRegistry socketSessionRegistry,
            @Qualifier("duelInviteRateLimiter") TokenBucketRateLimiter<UUID> inviteRateLimiter,
            Clock clock,
            BlockLookup blockLookup) {
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.duelInviteRepository = duelInviteRepository;
        this.matchService = matchService;
        this.matchmakingService = matchmakingService;
        this.socketSessionRegistry = socketSessionRegistry;
        this.inviteRateLimiter = inviteRateLimiter;
        this.clock = clock;
        this.blockLookup = blockLookup;
    }

    public DuelInviteService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            DuelInviteRepository duelInviteRepository,
            MatchService matchService,
            MatchmakingService matchmakingService,
            SingleUserWebSocketSessionRegistry socketSessionRegistry,
            TokenBucketRateLimiter<UUID> inviteRateLimiter,
            Clock clock) {
        this(
                currentUserService,
                userRepository,
                duelInviteRepository,
                matchService,
                matchmakingService,
                socketSessionRegistry,
                inviteRateLimiter,
                clock,
                BlockLookup.none());
    }

    @Transactional
    public CreatedInvite createInvite(Authentication authentication, String requestedUsername) {
        AppUser inviter = currentUserService.requireCurrentUser(authentication);
        inviteRateLimiter.requireAllowed(inviter.getId());

        String username = UsernamePolicy.clean(requestedUsername);
        UsernamePolicy.validate(username);
        AppUser invitee = userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(username)
                .orElseThrow(() -> new AuthException("player could not be found"));
        if (inviter.getId().equals(invitee.getId())) {
            throw new AuthException("you cannot invite yourself");
        }
        if (matchService.activeMatchStatus(inviter.getId()).activeMatch()
                || matchService.activeMatchStatus(invitee.getId()).activeMatch()) {
            throw new AuthException("both players must be outside an active match");
        }

        Instant now = clock.instant();
        DuelInvite existing = duelInviteRepository
                .findPendingBetweenUsers(inviter.getId(), invitee.getId(), DuelInviteStatus.PENDING)
                .stream()
                .findFirst()
                .orElse(null);
        if (existing != null && existing.getExpiresAt() != null && now.isBefore(existing.getExpiresAt())) {
            throw new AuthException("an invite is already pending for this player");
        }
        if (existing != null) {
            existing.setStatus(DuelInviteStatus.EXPIRED);
            existing.setRespondedAt(now);
            duelInviteRepository.save(existing);
        }

        DuelInvite invite = new DuelInvite();
        invite.setInviter(inviter);
        invite.setInvitee(invitee);
        invite.setStatus(DuelInviteStatus.PENDING);
        invite.setExpiresAt(now.plus(INVITE_VALIDITY));
        DuelInvite saved = duelInviteRepository.save(invite);
        return new CreatedInvite(toDTO(saved), invitee.getEmail(), invitee.getId(), inviter.getId());
    }

    @Transactional(readOnly = true)
    public List<DuelInviteDTO> incoming(Authentication authentication) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        Instant now = clock.instant();
        return duelInviteRepository
                .findByInviteeIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                        inviteeId, DuelInviteStatus.PENDING, now)
                .stream()
                .filter(invite -> !blockLookup.isBlocked(inviteeId, invite.getInviter().getId()))
                .map(this::toDTO)
                .toList();
    }

    @Transactional
    public DeclinedInvite decline(Authentication authentication, UUID inviteId) {
        UUID inviteeId = currentUserService.requireCurrentUserId(authentication);
        DuelInvite invite = requirePendingInvite(inviteId, inviteeId);
        Instant now = clock.instant();
        invite.setStatus(DuelInviteStatus.DECLINED);
        invite.setRespondedAt(now);
        DuelInvite saved = duelInviteRepository.save(invite);
        return new DeclinedInvite(
                toDTO(saved),
                invite.getInviter().getEmail(),
                invite.getInvitee().getUsername(),
                invite.getInviter().getId(),
                invite.getInvitee().getId());
    }

    @Transactional
    public AcceptedInvite acceptAndStartMatch(
            UUID inviteId,
            UUID inviteeId,
            String inviteePrincipalName,
            String inviteeSocketSessionId) {
        DuelInvite invite = requirePendingInvite(inviteId, inviteeId);
        AppUser inviter = invite.getInviter();
        AppUser invitee = invite.getInvitee();
        if (matchService.activeMatchStatus(inviter.getId()).activeMatch()
                || matchService.activeMatchStatus(invitee.getId()).activeMatch()) {
            throw new AuthException("both players must be outside an active match");
        }

        matchmakingService.leaveQueue(inviter.getId());
        matchmakingService.leaveQueue(invitee.getId());

        String inviterSocketSessionId = socketSessionRegistry
                .currentSessionIdForPrincipal(inviter.getEmail());
        List<OutboundMatchmakingEvent> events = matchService.startMatch(
                new MatchEntrant(
                        inviter.getId(),
                        inviter.getUsername(),
                        inviter.getEmail(),
                        inviterSocketSessionId),
                new MatchEntrant(
                        invitee.getId(),
                        invitee.getUsername(),
                        inviteePrincipalName,
                        inviteeSocketSessionId),
                MatchMode.CUSTOM);
        UUID matchId = events.stream()
                .map(OutboundMatchmakingEvent::event)
                .map(event -> event.matchId())
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElseThrow(() -> new AuthException("the duel could not be started"));

        Instant now = clock.instant();
        invite.setStatus(DuelInviteStatus.ACCEPTED);
        invite.setRespondedAt(now);
        invite.setMatchId(matchId);
        duelInviteRepository.save(invite);
        return new AcceptedInvite(
                invite.getId(),
                matchId,
                events,
                inviter.getEmail(),
                inviter.getUsername(),
                invitee.getEmail(),
                invitee.getUsername(),
                inviter.getId(),
                invitee.getId());
    }

    @Transactional
    public int cleanupExpiredInvites() {
        Instant now = clock.instant();
        duelInviteRepository.expirePendingBefore(
                DuelInviteStatus.PENDING,
                DuelInviteStatus.EXPIRED,
                now);
        return duelInviteRepository.deleteTerminalBefore(
                List.of(
                        DuelInviteStatus.EXPIRED,
                        DuelInviteStatus.ACCEPTED,
                        DuelInviteStatus.DECLINED,
                        DuelInviteStatus.CANCELLED),
                now.minus(TERMINAL_RETENTION));
    }

    private DuelInvite requirePendingInvite(UUID inviteId, UUID inviteeId) {
        if (inviteId == null || inviteeId == null) {
            throw new AuthException("the invite is no longer available");
        }
        DuelInvite invite = duelInviteRepository.findForInviteeForUpdate(inviteId, inviteeId)
                .orElseThrow(() -> new AuthException("the invite is no longer available"));
        Instant now = clock.instant();
        if (invite.getStatus() != DuelInviteStatus.PENDING) {
            throw new AuthException("the invite is no longer available");
        }
        if (invite.getExpiresAt() == null || !now.isBefore(invite.getExpiresAt())) {
            invite.setStatus(DuelInviteStatus.EXPIRED);
            invite.setRespondedAt(now);
            duelInviteRepository.save(invite);
            throw new AuthException("the invite has expired");
        }
        return invite;
    }

    private DuelInviteDTO toDTO(DuelInvite invite) {
        Instant createdAt = invite.getCreatedAt() == null
                ? clock.instant()
                : invite.getCreatedAt();
        return new DuelInviteDTO(
                invite.getId(),
                invite.getStatus() == null ? null : invite.getStatus().name(),
                invite.getInviter() == null ? null : invite.getInviter().getUsername(),
                invite.getInvitee() == null ? null : invite.getInvitee().getUsername(),
                createdAt,
                invite.getExpiresAt(),
                invite.getMatchId());
    }

    public record CreatedInvite(
            DuelInviteDTO invite,
            String recipientPrincipalName,
            UUID recipientUserId,
            UUID actorUserId) {
    }

    public record DeclinedInvite(
            DuelInviteDTO invite,
            String recipientPrincipalName,
            String actorUsername,
            UUID recipientUserId,
            UUID actorUserId) {
    }

    public record AcceptedInvite(
            UUID inviteId,
            UUID matchId,
            List<OutboundMatchmakingEvent> events,
            String inviterPrincipalName,
            String inviterUsername,
            String inviteePrincipalName,
            String inviteeUsername,
            UUID inviterUserId,
            UUID inviteeUserId) {
    }

}
