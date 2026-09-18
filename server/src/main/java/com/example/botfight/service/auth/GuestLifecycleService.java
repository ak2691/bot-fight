package com.example.botfight.service.auth;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import com.example.botfight.security.AuthenticatedUserDetails;
import java.security.Principal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.context.event.EventListener;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Owns the short-lived, non-profile lifecycle of temporary guest accounts. */
@Service
@DependsOn("matchmakingLifecycleScheduler")
public class GuestLifecycleService {

    public static final Duration INACTIVITY_RETENTION = Duration.ofMinutes(5);
    private static final Duration CLEANUP_INTERVAL = Duration.ofSeconds(30);
    private static final Logger log = LoggerFactory.getLogger(GuestLifecycleService.class);

    private final UserRepository userRepository;
    private final MatchRepository matchRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final MatchmakingService matchmakingService;
    private final MatchService matchService;
    private final SingleUserWebSocketSessionRegistry socketRegistry;
    private final Clock clock;
    private final TaskScheduler scheduler;
    private final Map<UUID, Instant> disconnectedAtByGuestId = new ConcurrentHashMap<>();

    public GuestLifecycleService(
            UserRepository userRepository,
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            MatchmakingService matchmakingService,
            MatchService matchService,
            SingleUserWebSocketSessionRegistry socketRegistry,
            Clock clock,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler) {
        this.userRepository = userRepository;
        this.matchRepository = matchRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.matchmakingService = matchmakingService;
        this.matchService = matchService;
        this.socketRegistry = socketRegistry;
        this.clock = clock;
        this.scheduler = scheduler;
    }

    @jakarta.annotation.PostConstruct
    void scheduleCleanup() {
        scheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        cleanupInactiveGuests();
                    } catch (RuntimeException exception) {
                        log.warn("Guest account cleanup failed", exception);
                    }
                },
                CLEANUP_INTERVAL);
    }

    @EventListener
    public void handleSessionConnect(SessionConnectEvent event) {
        UUID guestId = guestId(event == null ? null : event.getUser());
        if (guestId != null) disconnectedAtByGuestId.remove(guestId);
    }

    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        UUID guestId = guestId(event == null ? null : event.getUser());
        if (guestId != null) disconnectedAtByGuestId.put(guestId, clock.instant());
    }

    /** Deletes disconnected guests after five minutes, while preserving active matches. */
    @Transactional
    public synchronized int cleanupInactiveGuests() {
        Instant now = clock.instant();
        List<AppUser> candidates = userRepository.findByGuestTrueOrderByIdAsc();
        if (candidates == null || candidates.isEmpty()) return 0;

        int deleted = 0;
        for (AppUser guest : candidates) {
            if (guest == null || !guest.isGuest()) continue;
            boolean hardExpired = guest.getGuestExpiresAt() == null
                    || !now.isBefore(guest.getGuestExpiresAt());
            if (!hardExpired && hasOpenTransport(guest)) {
                disconnectedAtByGuestId.remove(guest.getId());
                continue;
            }
            Instant disconnectedAt = disconnectedAtByGuestId.computeIfAbsent(guest.getId(), ignored -> now);
            if (!hardExpired && now.isBefore(disconnectedAt.plus(INACTIVITY_RETENTION))) continue;
            if (hasTransientMatchmakingActivity(guest.getId())) continue;
            if (hasActiveMatch(guest.getId())) continue;
            if (deleteGuestAndEphemeralMatches(guest)) {
                disconnectedAtByGuestId.remove(guest.getId());
                deleted++;
            }
        }
        if (deleted > 0) {
            log.info("Deleted {} inactive guest account(s)", deleted);
        }
        return deleted;
    }

    private boolean hasOpenTransport(AppUser guest) {
        return socketRegistry != null
                && guest.getEmail() != null
                && socketRegistry.currentSessionIdForPrincipal(guest.getEmail()) != null;
    }

    private UUID guestId(Principal principal) {
        Object candidate = principal;
        if (candidate instanceof Authentication authentication) {
            candidate = authentication.getPrincipal();
        }
        if (candidate instanceof AuthenticatedUserDetails details && details.isGuest()) {
            return details.getId();
        }
        return null;
    }

    private boolean hasTransientMatchmakingActivity(UUID userId) {
        return matchmakingService != null && matchmakingService.hasTransientActivity(userId);
    }

    private boolean hasActiveMatch(UUID userId) {
        if (matchService == null) return false;
        ActiveMatchStatusDTO status = matchService.activeMatchStatus(userId);
        return status != null && status.activeMatch();
    }

    /**
     * Guest matches are deliberately ephemeral. Delete terminal guest-only
     * match rows before deleting the user so no user-visible history survives.
     */
    private boolean deleteGuestAndEphemeralMatches(AppUser guest) {
        List<MatchParticipant> ownedParticipants = matchParticipantRepository
                .findByUserIdOrderByCreatedAtDesc(guest.getId());
        Set<Match> matches = new LinkedHashSet<>();
        for (MatchParticipant participant : ownedParticipants) {
            if (participant == null || participant.getMatch() == null) continue;
            Match match = participant.getMatch();
            if (match.getStatus() == MatchStatus.RUNNING
                    || match.getStatus() == MatchStatus.PENDING) {
                return false;
            }
            List<MatchParticipant> participants = matchParticipantRepository.findByMatchId(match.getId());
            if (participants == null || participants.isEmpty()
                    || participants.stream().anyMatch(other ->
                            other.getUser() == null || !other.getUser().isGuest())) {
                // Never remove a guest from a match that may contain a real
                // account. That protects registered-player history if an old
                // deployment ever produced a mixed match.
                return false;
            }
            if (participants.stream().map(MatchParticipant::getUser)
                    .map(AppUser::getId)
                    .anyMatch(this::hasActiveMatch)) {
                return false;
            }
            matches.add(match);
        }

        matches.forEach(matchRepository::delete);
        if (!matches.isEmpty()) matchRepository.flush();
        userRepository.delete(guest);
        userRepository.flush();
        return true;
    }
}
