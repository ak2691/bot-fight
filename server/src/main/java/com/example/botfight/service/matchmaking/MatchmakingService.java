package com.example.botfight.service.matchmaking;

import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingPlayerDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.loadout.MatchAbilityGuaranteeService;
import com.example.botfight.service.match.loadout.MatchLoadoutService;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class MatchmakingService {

    private static final int ROUND_LOGIC_BLOCK_LIMIT = 100;
    private static final int MATCH_ACCEPTANCE_SECONDS = 20;
    private static final int SUBMISSION_GRACE_SECONDS = 2;
    private static final int INITIAL_RATING_RANGE = 50;
    private static final int RATING_RANGE_STEP = 50;
    private static final long RATING_RANGE_INTERVAL_SECONDS = 15;
    private static final int MAX_RATING_RANGE = 400;
    private static final int MAX_PARTY_RATING_SPREAD = 300;
    private static final int MAX_TWOS_CANDIDATES = 32;
    private static final int MAX_TWOS_NEIGHBORS_PER_ANCHOR = 3;
    private static final int MAX_TWOS_SEARCH_ANCHORS = 8;
    private static final int MAX_TWOS_ANCHOR_SCAN = 16;
    private static final int MAX_TWOS_BUCKET_SCAN = 32;
    private static final int MAX_TWOS_COMMIT_RETRIES = 2;
    private static final int QUEUE_RECONNECT_GRACE_SECONDS = 10;
    private static final Duration QUEUE_RECONNECT_GRACE =
            Duration.ofSeconds(QUEUE_RECONNECT_GRACE_SECONDS);

    private final MatchService matchService;
    private final Clock clock;
    private final TokenBucketRateLimiter<UUID> matchmakingRateLimiter;
    private final EloRatingService eloRatingService;
    private final MatchAbilityGuaranteeService guaranteeService;
    private final MatchParticipationCoordinator participationCoordinator;
    /** Registered FIFO order is the fairness source; entry keys make removal O(1). */
    private final LinkedHashMap<UUID, QueuedGroup> registeredQueueOrderById = new LinkedHashMap<>();
    /** Rotating registered 2v2 search order; queue FIFO remains in the map above. */
    private final LinkedHashMap<UUID, QueuedGroup> registeredTwosSearchOrder = new LinkedHashMap<>();
    /** Registered rating indexes keep candidate lookup bounded to the relevant Elo window. */
    private final Map<MatchMode, NavigableMap<Double, LinkedHashSet<QueuedGroup>>> registeredQueueByRating =
            new EnumMap<>(MatchMode.class);
    /** External starts hold these leases while lifecycle persistence runs outside this monitor. */
    private final Map<UUID, UUID> externalStartReservationsByUserId = new HashMap<>();
    /** Monotonic tie-breaker for players whose injected clocks report the same instant. */
    private long nextQueueOrder;
    /**
     * Guests have no Elo and therefore use an independent FIFO queue per mode.
     * They never enter the registered queue's rating indexes.
     */
    private final Map<MatchMode, LinkedHashMap<UUID, QueuedGroup>> guestQueueOrderByMode =
            new EnumMap<>(MatchMode.class);
    /** Direct membership lookup for disconnect and reconnect handling. */
    private final Map<UUID, QueuedGroup> queuedGroupsByUserId = new HashMap<>();
    /** Principal lookup avoids scanning the FIFO when a socket disconnects. */
    private final Map<String, UUID> queuedUserIdsByPrincipal = new HashMap<>();
    /** Only disconnected members are stored here; absence means queue-connected. */
    private final Map<UUID, Instant> reconnectDeadlinesByUserId = new HashMap<>();
    private final Map<UUID, PendingMatch> pendingMatchesById = new HashMap<>();

    public MatchmakingService(
            MatchService matchService,
            Clock clock,
            @Qualifier("matchmakingRateLimiter") TokenBucketRateLimiter<UUID> matchmakingRateLimiter) {
        this(matchService, clock, matchmakingRateLimiter, null, new MatchAbilityGuaranteeService());
    }

    public MatchmakingService(
            MatchService matchService,
            Clock clock,
            @Qualifier("matchmakingRateLimiter") TokenBucketRateLimiter<UUID> matchmakingRateLimiter,
            EloRatingService eloRatingService) {
        this(matchService, clock, matchmakingRateLimiter, eloRatingService, new MatchAbilityGuaranteeService());
    }

    public MatchmakingService(
            MatchService matchService,
            Clock clock,
            @Qualifier("matchmakingRateLimiter") TokenBucketRateLimiter<UUID> matchmakingRateLimiter,
            EloRatingService eloRatingService,
            MatchAbilityGuaranteeService guaranteeService) {
        this(
                matchService,
                clock,
                matchmakingRateLimiter,
                eloRatingService,
                guaranteeService,
                new MatchParticipationCoordinator());
    }

    @Autowired
    public MatchmakingService(
            MatchService matchService,
            Clock clock,
            @Qualifier("matchmakingRateLimiter") TokenBucketRateLimiter<UUID> matchmakingRateLimiter,
            EloRatingService eloRatingService,
            MatchAbilityGuaranteeService guaranteeService,
            MatchParticipationCoordinator participationCoordinator) {
        this.matchService = matchService;
        this.clock = clock;
        this.matchmakingRateLimiter = matchmakingRateLimiter;
        this.eloRatingService = eloRatingService;
        this.guaranteeService = guaranteeService == null
                ? new MatchAbilityGuaranteeService()
                : guaranteeService;
        this.participationCoordinator = participationCoordinator == null
                ? new MatchParticipationCoordinator()
                : participationCoordinator;
        registeredQueueByRating.put(MatchMode.ONES, new TreeMap<>());
        registeredQueueByRating.put(MatchMode.TWOS, new TreeMap<>());
        guestQueueOrderByMode.put(MatchMode.ONES, new LinkedHashMap<>());
        guestQueueOrderByMode.put(MatchMode.TWOS, new LinkedHashMap<>());
    }

    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName) {
        return joinQueue(userId, username, principalName, null);
    }

    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        return joinQueue(userId, username, principalName, socketSessionId, MatchMode.ONES);
    }

    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode) {
        return joinQueue(
                userId,
                username,
                principalName,
                socketSessionId,
                mode,
                List.of(new MatchEntrant(userId, username, principalName, socketSessionId)));
    }

    /** Joins a queue as one atomic party-sized group. */
    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode,
            List<MatchEntrant> requestedGroup) {
        return joinQueue(
                userId,
                username,
                principalName,
                socketSessionId,
                mode,
                requestedGroup,
                null);
    }

    /** Joins a queue with an optional live party identity for queue-state fanout. */
    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode,
            List<MatchEntrant> requestedGroup,
            UUID partyId) {
        return joinQueue(
                userId,
                username,
                principalName,
                socketSessionId,
                mode,
                requestedGroup,
                partyId,
                List.of());
    }

    /** Joins a queue while carrying the authenticated player's queue-time guarantees. */
    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode,
            List<MatchEntrant> requestedGroup,
            UUID partyId,
            List<Integer> guaranteedAbilityIds) {
        return joinQueue(
                userId,
                username,
                principalName,
                socketSessionId,
                mode,
                requestedGroup,
                partyId,
                guaranteedAbilityIds,
                true);
    }

    /**
     * Compatibility entry point for older callers. New queue requests use a
     * server-derived {@link QueuePool}; a false value is treated as the guest
     * pool rather than as a client-selectable unranked mode.
     */
    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode,
            List<MatchEntrant> requestedGroup,
            UUID partyId,
            List<Integer> guaranteedAbilityIds,
            boolean ranked) {
        return joinQueue(
                userId,
                username,
                principalName,
                socketSessionId,
                mode,
                requestedGroup,
                partyId,
                guaranteedAbilityIds,
                ranked ? QueuePool.REGISTERED : QueuePool.GUEST);
    }

    /** Joins the server-selected pool. Registered and guest pools never cross-match. */
    public List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode,
            List<MatchEntrant> requestedGroup,
            UUID partyId,
            List<Integer> guaranteedAbilityIds,
            QueuePool pool) {
        QueuePool resolvedPool = pool == null ? QueuePool.REGISTERED : pool;
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        if (resolvedMode != MatchMode.ONES && resolvedMode != MatchMode.TWOS) {
            throw new AuthException("Only 1v1 and 2v2 matchmaking are available in the queue.");
        }
        List<MatchEntrant> group = normalizeGroup(
                userId, username, principalName, socketSessionId, requestedGroup, resolvedMode);
        group = group.stream()
                .map(entrant -> entrant.guaranteedAbilities().isEmpty()
                        ? entrant.withGuaranteedAbilities(guaranteeService.forUser(entrant.userId()))
                        : entrant)
                .toList();
        Map<Integer, Integer> guarantees = MatchLoadoutService.normalizeAbilityGuarantees(
                guaranteedAbilityIds);
        // New clients always send the three positional slots, including nulls
        // for "Random Ability". Older callers send an empty list, which keeps
        // the server-side preference fallback intact.
        if (guaranteedAbilityIds != null && !guaranteedAbilityIds.isEmpty()) {
            group = group.stream()
                    .map(entrant -> entrant.userId().equals(userId)
                            ? entrant.withGuaranteedAbilities(guarantees)
                            : entrant)
                    .toList();
        }
        if (resolvedMode == MatchMode.ONES && group.size() != 1) {
            throw new AuthException("A party can only queue for 2v2.");
        }
        if (resolvedPool == QueuePool.GUEST && (partyId != null || group.size() != 1)) {
            throw new AuthException("Guests cannot join parties.");
        }

        // These checks and reads can consult shared runtime state or the
        // database, so do them before entering the queue monitor.
        matchmakingRateLimiter.requireAllowed(userId);
        for (MatchEntrant entrant : group) {
            if (matchService.activeMatchStatus(entrant.userId()).activeMatch()
                    || matchService.isMatchStartReserved(entrant.userId())) {
                throw new AuthException(
                        "A party member has an active match. Return to it instead.");
            }
        }

        QueueGroupType groupType = partyId == null && group.size() == 1
                ? QueueGroupType.SOLO
                : QueueGroupType.PARTY;
        Map<UUID, Integer> ratings = resolvedPool == QueuePool.GUEST
                ? Map.of()
                : ratingsFor(group, resolvedMode);
        if (resolvedPool == QueuePool.REGISTERED
                && resolvedMode == MatchMode.TWOS && group.size() > 1
                && ratingSpread(ratings) > MAX_PARTY_RATING_SPREAD) {
            throw new AuthException(
                    "Party members must be within " + MAX_PARTY_RATING_SPREAD
                            + " Elo of each other to queue for 2v2.");
        }
        Instant queuedAt = Instant.now(clock);
        QueuedGroup joined;
        List<QueuedGroup> twosCandidates = List.of();
        synchronized (this) {
            // A stale disconnected entry must not remain eligible when another
            // player joins after its grace window has elapsed.
            expireDisconnectedGroups(Instant.now(clock));
            MatchParticipationCoordinator.RankedAdmission participationAdmission = resolvedPool.ranked()
                    ? participationCoordinator.reserveRankedAdmission(
                            group.stream().map(MatchEntrant::userId).toList())
                    : null;
            if (resolvedPool.ranked() && participationAdmission == null) {
                throw new AuthException(
                        "Leave the custom lobby before joining ranked matchmaking.");
            }

            try {
                if (pendingMatchForUser(userId) != null) {
                    throw new AuthException(
                            "A match is waiting for your acceptance. Return to it instead.");
                }
                for (MatchEntrant entrant : group) {
                    if (externalStartReservationsByUserId.containsKey(entrant.userId())) {
                        throw new AuthException("A party member is already starting another match.");
                    }
                    if (pendingMatchForUser(entrant.userId()) != null) {
                        throw new AuthException(
                                "A party member is waiting for match acceptance. Return to it instead.");
                    }
                    if (matchService.activeMatchStatus(entrant.userId()).activeMatch()
                            || matchService.isMatchStartReserved(entrant.userId())) {
                        throw new AuthException(
                                "A party member has an active match. Return to it instead.");
                    }
                }
            } catch (RuntimeException | Error exception) {
                participationCoordinator.releaseRankedAdmission(participationAdmission);
                throw exception;
            }

            if (participationAdmission != null
                    && !participationCoordinator.commitRankedAdmission(participationAdmission)) {
                participationCoordinator.releaseRankedAdmission(participationAdmission);
                throw new AuthException(
                        "Leave the custom lobby before joining ranked matchmaking.");
            }

            joined = new QueuedGroup(
                    UUID.randomUUID(),
                    group,
                    resolvedMode,
                    groupType,
                    partyId,
                    ratings,
                    queuedAt,
                    resolvedPool,
                    nextQueueOrder++);

            Set<UUID> displacedMembers = removeQueuedGroupsForMembers(group);
            if (resolvedMode == MatchMode.ONES) {
                QueuedGroup opponent = findBestOneOpponent(joined, queuedAt);
                if (opponent == null) {
                    addQueuedGroup(joined);
                    releaseRankedParticipationIfIdle(displacedMembers);
                    return waitingEvents(joined);
                }
                removeQueuedGroup(opponent);
                List<MatchEntrant> entrants = new ArrayList<>();
                entrants.addAll(opponent.toMatchEntrants(1));
                entrants.addAll(joined.toMatchEntrants(2));
                List<OutboundMatchmakingEvent> pendingEvents = createPendingMatch(
                        entrants, resolvedMode, resolvedPool);
                releaseRankedParticipationIfIdle(displacedMembers);
                return pendingEvents;
            }

            addQueuedGroup(joined);
            releaseRankedParticipationIfIdle(displacedMembers);
            twosCandidates = twosCandidateSnapshot(resolvedPool, joined.queueEntryId());
        }

        TwosSelection selection = findTwosSelection(twosCandidates, resolvedPool, queuedAt);
        if (selection != null) {
            List<OutboundMatchmakingEvent> events = commitTwosSelection(selection, resolvedPool);
            if (events != null) {
                List<OutboundMatchmakingEvent> requesterState = currentQueueEventsForUser(userId);
                if (!requesterState.isEmpty()
                        && "QUEUE_WAITING".equals(requesterState.getFirst().event().type())) {
                    List<OutboundMatchmakingEvent> combined = new ArrayList<>(events);
                    combined.addAll(requesterState);
                    return List.copyOf(combined);
                }
                return events;
            }
        }
        return currentQueueEventsForUser(userId);
    }

    /**
     * Rechecks queued groups without requiring another player to join. The
     * caller publishes the returned events to the affected sockets.
     */
    public List<OutboundMatchmakingEvent> sweepQueues() {
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        synchronized (this) {
            Instant now = Instant.now(clock);
            events.addAll(expireDisconnectedGroups(now));
            events.addAll(matchWaitingOnes(QueuePool.REGISTERED));
            events.addAll(matchWaitingOnes(QueuePool.GUEST));
        }
        events.addAll(matchWaitingTwos(QueuePool.REGISTERED));
        events.addAll(matchWaitingTwos(QueuePool.GUEST));
        return List.copyOf(events);
    }

    /** Returns whether a guest still owns queue or match-acceptance state. */
    public synchronized boolean hasTransientActivity(UUID userId) {
        if (userId == null) return false;
        if (queuedGroupsByUserId.containsKey(userId)) return true;
        return pendingMatchesById.values().stream().anyMatch(pending -> pending.containsUser(userId));
    }

    public synchronized void leaveQueue(UUID userId) {
        QueuedGroup queuedGroup = queuedGroupsByUserId.get(userId);
        if (queuedGroup != null) {
            removeQueuedGroup(queuedGroup);
            releaseRankedParticipationIfIdle(
                    queuedGroup.members().stream().map(MatchEntrant::userId).toList());
        }
    }

    /** Rejects an external match start when any roster member still has ranked state. */
    public synchronized List<OutboundMatchmakingEvent> cancelConflictingQueueState(
            Collection<UUID> userIds) {
        ExternalMatchStartPreparation preparation = prepareExternalMatchStart(userIds);
        releaseExternalMatchStart(preparation.reservationId());
        return preparation.cancellationEvents();
    }

    /**
     * Fences new queue joins while an external match lifecycle persists its
     * roster outside this monitor. Existing queue or acceptance state is
     * rejected and preserved; it is never silently removed by a match start.
     * Call {@link #releaseExternalMatchStart(UUID)} in a finally block after
     * the lifecycle start attempt completes.
     */
    public synchronized ExternalMatchStartPreparation prepareExternalMatchStart(
            Collection<UUID> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return new ExternalMatchStartPreparation(null, List.of());
        }
        Set<UUID> roster = userIds.stream()
                .filter(java.util.Objects::nonNull)
                .collect(java.util.stream.Collectors.toSet());
        if (roster.isEmpty() || roster.size() != userIds.size()) {
            throw new AuthException("the match roster could not be reserved");
        }
        if (roster.stream().anyMatch(externalStartReservationsByUserId::containsKey)) {
            throw new AuthException("a match is already starting for one or more players");
        }

        List<PendingMatch> pendingConflicts = pendingMatchesById.values().stream()
                .filter(pending -> pending.entrants().stream()
                        .anyMatch(entrant -> roster.contains(entrant.userId())))
                .toList();
        if (pendingConflicts.stream().anyMatch(PendingMatch::starting)) {
            throw new AuthException("a queue match is already starting for one or more players");
        }

        if (roster.stream().anyMatch(queuedGroupsByUserId::containsKey)
                || !pendingConflicts.isEmpty()
                || roster.stream().anyMatch(userId ->
                        matchService.activeMatchStatus(userId).activeMatch()
                                || matchService.isMatchStartReserved(userId))) {
            throw new AuthException(
                    "Leave ranked matchmaking or return to the active match before starting another match.");
        }
        UUID reservationId = UUID.randomUUID();
        roster.forEach(userId -> externalStartReservationsByUserId.put(userId, reservationId));
        return new ExternalMatchStartPreparation(reservationId, List.of());
    }

    /** Releases an external-start admission fence after lifecycle success or failure. */
    public synchronized void releaseExternalMatchStart(UUID reservationId) {
        if (reservationId == null) return;
        externalStartReservationsByUserId.entrySet()
                .removeIf(entry -> reservationId.equals(entry.getValue()));
    }

    /**
     * Starts the queue reconnect grace period for the socket that went away.
     * The queue entry remains in its pool's FIFO (and, for registered users,
     * rating index), but is ineligible for matching until that player
     * reconnects or the deadline expires.
     */
    public synchronized boolean markDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) {
            return false;
        }
        UUID userId = queuedUserIdsByPrincipal.get(principalName);
        QueuedGroup group = userId == null ? null : queuedGroupsByUserId.get(userId);
        if (group == null) return false;
        Instant reconnectDeadline = Instant.now(clock).plus(QUEUE_RECONNECT_GRACE);
        MatchEntrant disconnectedPlayer = group.members().stream()
                .filter(player -> player.userId().equals(userId))
                .filter(player -> player.principalName().equals(principalName))
                .findFirst()
                .orElse(null);
        if (disconnectedPlayer == null) return false;
        if (reconnectDeadlinesByUserId.containsKey(userId)) {
            // Do not extend the grace window if the broker delivers a
            // duplicate disconnect event for the same socket.
            return true;
        }
        reconnectDeadlinesByUserId.put(userId, reconnectDeadline);
        return true;
    }

    /**
     * Retained as a source-compatible alias for callers that used the old
     * immediate-removal name. Disconnects now enter the grace period instead.
     */
    @Deprecated
    public synchronized boolean removeDisconnected(
            String principalName,
            String socketSessionId) {
        return markDisconnected(principalName, socketSessionId);
    }

    /** Rebinds a reconnecting socket to its existing queue entry. */
    public synchronized List<OutboundMatchmakingEvent> resumeQueuedPlayer(
            UUID userId,
            String socketSessionId) {
        if (userId == null) return List.of();
        Instant now = Instant.now(clock);
        expireDisconnectedGroups(now);
        QueuedGroup group = queuedGroupsByUserId.get(userId);
        if (group == null) return List.of();
                QueuedGroup rebound = group.withSocketSession(userId, socketSessionId);
        reconnectDeadlinesByUserId.remove(userId);
        replaceQueuedGroup(group, rebound);
        return waitingEvents(rebound);
    }

    public synchronized List<OutboundMatchmakingEvent> resumePendingMatch(
            UUID userId,
            String socketSessionId) {
        PendingMatch pending = pendingMatchForUser(userId);
        if (pending == null) {
            return List.of();
        }
        PendingMatch updated = pending.withSocketSession(userId, socketSessionId);
        pendingMatchesById.put(updated.matchId(), updated);
        return pendingEvents(
                updated,
                updated.starting() ? "MATCH_ACCEPTED" : "MATCH_FOUND",
                updated.starting()
                        ? "All players accepted. The match is starting."
                        : "Match found. Accept within 20 seconds.");
    }

    public List<OutboundMatchmakingEvent> acceptMatch(
            UUID pendingMatchId,
            UUID userId,
            String socketSessionId) {
        PendingMatch previous;
        PendingMatch starting;
        synchronized (this) {
            previous = pendingMatchesById.get(pendingMatchId);
            if (previous == null) {
                throw new AuthException("The match acceptance window is no longer available.");
            }

            MatchEntrant acceptingPlayer = previous.entrantFor(userId);
            if (acceptingPlayer == null) {
                throw new AuthException("This match acceptance is not available to this player.");
            }

            if (previous.starting()) {
                return pendingEvents(
                        previous,
                        "MATCH_ACCEPTED",
                        "All players accepted. The match is starting.");
            }
            if (!Instant.now(clock).isBefore(previous.acceptanceEndsAt())) {
                pendingMatchesById.remove(previous.matchId(), previous);
                releaseRankedParticipationIfIdle(
                        previous.entrants().stream().map(MatchEntrant::userId).toList());
                return pendingEvents(
                        previous,
                        "MATCH_ACCEPTANCE_EXPIRED",
                        "The match acceptance window has closed.");
            }

            if (previous.acceptedUserIds().contains(userId)) {
                return pendingEvents(
                        previous,
                        "MATCH_ACCEPTED",
                        "You already accepted. Waiting for the other players.");
            }

            PendingMatch accepted = previous.withAcceptedUser(userId);
            if (accepted.acceptedUserIds().size() != accepted.entrants().size()) {
                pendingMatchesById.put(accepted.matchId(), accepted);
                return pendingEvents(
                        accepted,
                        "MATCH_ACCEPTED",
                        "A player accepted the match. Waiting for the other players.");
            }

            starting = accepted.withStarting(true);
            pendingMatchesById.put(starting.matchId(), starting);
        }

        try {
            List<OutboundMatchmakingEvent> events = startQueueMatch(starting);
            synchronized (this) {
                pendingMatchesById.remove(starting.matchId());
            }
            releaseRankedParticipationIfIdle(
                    starting.entrants().stream().map(MatchEntrant::userId).toList());
            return events;
        } catch (AuthException exception) {
            PendingMatch cancelled;
            synchronized (this) {
                cancelled = pendingMatchesById.get(starting.matchId());
                pendingMatchesById.remove(starting.matchId());
            }
            releaseRankedParticipationIfIdle(
                    starting.entrants().stream().map(MatchEntrant::userId).toList());
            return pendingEvents(
                    cancelled == null ? starting : cancelled,
                    "MATCH_ACCEPTANCE_CANCELLED",
                    "The match was cancelled because one or more players entered another match.");
        } catch (RuntimeException | Error exception) {
            synchronized (this) {
                PendingMatch current = pendingMatchesById.get(starting.matchId());
                if (current != null && current.starting()) {
                    pendingMatchesById.put(
                            current.matchId(),
                            current.withAcceptedUserIds(previous.acceptedUserIds()).withStarting(false));
                }
            }
            throw exception;
        }
    }

    private List<OutboundMatchmakingEvent> startQueueMatch(PendingMatch accepted) {
        if (accepted.mode() == MatchMode.ONES) {
            return accepted.pool().ranked()
                    ? matchService.startMatch(accepted.entrants().get(0), accepted.entrants().get(1))
                    : matchService.startMatch(
                            accepted.entrants().get(0),
                            accepted.entrants().get(1),
                            accepted.mode(),
                            false);
        }
        return accepted.pool().ranked()
                ? matchService.startTeamMatch(accepted.entrants(), accepted.mode())
                : matchService.startTeamMatch(accepted.entrants(), accepted.mode(), false);
    }

    public synchronized List<OutboundMatchmakingEvent> cancelPendingMatch(
            UUID pendingMatchId,
            UUID userId,
            String socketSessionId) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null) {
            throw new AuthException("The match acceptance window is no longer available.");
        }

        MatchEntrant cancellingPlayer = pending.entrantFor(userId);
        if (cancellingPlayer == null) {
            throw new AuthException("This match acceptance is not available to this player.");
        }
        if (pending.starting()) {
            throw new AuthException("The match is already starting and cannot be cancelled.");
        }

        pendingMatchesById.remove(pending.matchId());
        List<OutboundMatchmakingEvent> events = pendingEvents(
                pending,
                "MATCH_ACCEPTANCE_CANCELLED",
                "The match was cancelled before both players accepted.");
        releaseRankedParticipationIfIdle(
                pending.entrants().stream().map(MatchEntrant::userId).toList());
        return events;
    }

    public synchronized List<OutboundMatchmakingEvent> resolvePendingMatchTimeout(
            UUID pendingMatchId,
            Instant expectedDeadline) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null
                || pending.starting()
                || !pending.acceptanceEndsAt().equals(expectedDeadline)
                || Instant.now(clock).isBefore(pending.acceptanceEndsAt())) {
            return List.of();
        }
        pendingMatchesById.remove(pending.matchId());
        List<OutboundMatchmakingEvent> events = pendingEvents(
                pending,
                "MATCH_ACCEPTANCE_EXPIRED",
                "The match was closed because both players did not accept in time.");
        releaseRankedParticipationIfIdle(
                pending.entrants().stream().map(MatchEntrant::userId).toList());
        return events;
    }

    private List<OutboundMatchmakingEvent> createPendingMatch(
            List<MatchEntrant> entrants,
            MatchMode mode,
            QueuePool pool) {
        PendingMatch pending = new PendingMatch(
                UUID.randomUUID(),
                List.copyOf(entrants),
                Instant.now(clock).plusSeconds(MATCH_ACCEPTANCE_SECONDS + SUBMISSION_GRACE_SECONDS),
                Set.of(),
                mode,
                pool,
                false);
        pendingMatchesById.put(pending.matchId(), pending);
        return pendingEvents(
                pending,
                "MATCH_FOUND",
                "Match found. Accept within 20 seconds.");
    }

    private List<OutboundMatchmakingEvent> pendingEvents(
            PendingMatch pending,
            String type,
            String message) {
        Instant now = Instant.now(clock);
        return pending.entrants().stream()
                .map(entrant -> {
                    boolean acceptedByMe = pending.acceptedUserIds().contains(entrant.userId());
                    boolean otherPlayerAccepted = pending.acceptedUserIds().stream()
                            .anyMatch(acceptedUserId -> !acceptedUserId.equals(entrant.userId()));
                    return new OutboundMatchmakingEvent(
                            entrant.principalName(),
                            new MatchmakingEventDTO(
                                    type,
                                    pending.matchId(),
                                    null,
                                    "MATCH_ACCEPT",
                                    null,
                                    null,
                                    List.of(),
                                    now,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    message,
                                    null,
                                    List.of(),
                                    List.of(),
                                    List.of(),
                                    null,
                                    List.of(),
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    null,
                                    pending.acceptanceEndsAt(),
                                    acceptedByMe,
                                    otherPlayerAccepted,
                                    null)
                                    .withMode(pending.mode().name())
                                    .withViewerUserId(entrant.userId()));
                })
                .toList();
    }

    private List<MatchEntrant> normalizeGroup(
            UUID requesterId,
            String requesterUsername,
            String requesterPrincipalName,
            String requesterSocketSessionId,
            List<MatchEntrant> requestedGroup,
            MatchMode mode) {
        List<MatchEntrant> source = requestedGroup == null || requestedGroup.isEmpty()
                ? List.of(new MatchEntrant(
                        requesterId,
                        requesterUsername,
                        requesterPrincipalName,
                        requesterSocketSessionId))
                : requestedGroup;
        if (source.size() > 2) {
            throw new AuthException("A party can contain at most two players.");
        }
        Map<UUID, MatchEntrant> unique = new java.util.LinkedHashMap<>();
        for (MatchEntrant entrant : source) {
            if (entrant == null || entrant.userId() == null || !unique.isEmpty() && unique.containsKey(entrant.userId())) {
                throw new AuthException("The party could not be queued.");
            }
            unique.put(entrant.userId(), entrant);
        }
        if (!unique.containsKey(requesterId)) {
            throw new AuthException("The queue request must include the authenticated player.");
        }
        // Always trust the authenticated socket's identity and session for the
        // requester, even if a caller supplied a stale group snapshot.
        MatchEntrant requester = unique.get(requesterId);
        unique.put(requesterId, new MatchEntrant(
                requesterId,
                requesterUsername,
                requesterPrincipalName,
                requesterSocketSessionId,
                requester == null ? 0 : requester.teamNumber(),
                requester == null ? Map.of() : requester.guaranteedAbilities()));
        return List.copyOf(unique.values());
    }

    private List<QueuedGroup> queuedGroups(QueuePool pool, MatchMode mode) {
        if (pool == QueuePool.GUEST) {
            return List.copyOf(guestQueueOrderByMode.get(mode).values());
        }
        return registeredQueueOrderById.values().stream()
                .filter(group -> group.mode() == mode)
                .toList();
    }

    private TwosSelection selectGuestGroups(List<QueuedGroup> candidates) {
        List<QueuedGroup> selected = new ArrayList<>(4);
        for (QueuedGroup candidate : candidates) {
            if (candidate.members().size() != 1) continue;
            selected.add(candidate);
            if (selected.size() == 4) {
                Map<QueuedGroup, Integer> assignments = new LinkedHashMap<>();
                for (int index = 0; index < selected.size(); index++) {
                    assignments.put(selected.get(index), index < 2 ? 1 : 2);
                }
                return new TwosSelection(List.copyOf(selected), Map.copyOf(assignments), 0d);
            }
        }
        return null;
    }

    /** Must be called under this monitor; the returned bounded snapshot is searched outside it. */
    private List<QueuedGroup> twosCandidateSnapshot(QueuePool pool, UUID focusQueueEntryId) {
        if (pool == QueuePool.GUEST) {
            List<QueuedGroup> candidates = new ArrayList<>(4);
            for (QueuedGroup group : guestQueueOrderByMode.get(MatchMode.TWOS).values()) {
                if (isMatchEligible(group)) candidates.add(group);
                if (candidates.size() == 4) break;
            }
            return List.copyOf(candidates);
        }

        Instant now = Instant.now(clock);
        List<UUID> scannedIds = new ArrayList<>(MAX_TWOS_ANCHOR_SCAN);
        List<QueuedGroup> anchors = new ArrayList<>(MAX_TWOS_SEARCH_ANCHORS);
        for (QueuedGroup group : registeredTwosSearchOrder.values()) {
            scannedIds.add(group.queueEntryId());
            if (isMatchEligible(group) && anchors.size() < MAX_TWOS_SEARCH_ANCHORS - 1) {
                anchors.add(group);
            }
            if (scannedIds.size() == MAX_TWOS_ANCHOR_SCAN) break;
        }
        // Rotate only the search cursor. The authoritative FIFO and queuedAt
        // values stay unchanged, so every bounded sweep eventually examines
        // later rating regions without changing match fairness.
        for (UUID queueEntryId : scannedIds) {
            QueuedGroup group = registeredTwosSearchOrder.remove(queueEntryId);
            if (group != null) registeredTwosSearchOrder.put(queueEntryId, group);
        }

        QueuedGroup focus = focusQueueEntryId == null
                ? null
                : registeredQueueOrderById.get(focusQueueEntryId);
        if (focus != null && focus.mode() == MatchMode.TWOS && isMatchEligible(focus)) {
            anchors.remove(focus);
            anchors.add(focus);
        }
        if (focus == null && anchors.size() < MAX_TWOS_SEARCH_ANCHORS) {
            for (QueuedGroup group : registeredTwosSearchOrder.values()) {
                if (isMatchEligible(group) && !anchors.contains(group)) anchors.add(group);
                if (anchors.size() == MAX_TWOS_SEARCH_ANCHORS) break;
            }
        }

        LinkedHashSet<QueuedGroup> candidates = new LinkedHashSet<>();
        NavigableMap<Double, LinkedHashSet<QueuedGroup>> ratingIndex =
                registeredQueueByRating.get(MatchMode.TWOS);
        for (QueuedGroup anchor : anchors) {
            if (candidates.size() >= MAX_TWOS_CANDIDATES) break;
            candidates.add(anchor);
            addNearestTwosCandidates(anchor, candidates, ratingIndex, now);
        }
        return candidates.stream()
                .sorted(Comparator.comparing(QueuedGroup::queuedAt)
                        .thenComparingLong(QueuedGroup::queueOrder)
                        .thenComparing(this::stableGroupKey))
                .limit(MAX_TWOS_CANDIDATES)
                .toList();
    }

    private void addNearestTwosCandidates(
            QueuedGroup anchor,
            LinkedHashSet<QueuedGroup> candidates,
            NavigableMap<Double, LinkedHashSet<QueuedGroup>> ratingIndex,
            Instant now) {
        if (ratingIndex == null || ratingIndex.isEmpty()) return;
        int added = addTwosCandidatesFromBucket(
                anchor,
                candidates,
                ratingIndex.get(anchor.matchRating()),
                MAX_TWOS_NEIGHBORS_PER_ANCHOR,
                now);
        Map.Entry<Double, LinkedHashSet<QueuedGroup>> lower = ratingIndex.lowerEntry(anchor.matchRating());
        Map.Entry<Double, LinkedHashSet<QueuedGroup>> higher = ratingIndex.higherEntry(anchor.matchRating());
        while (added < MAX_TWOS_NEIGHBORS_PER_ANCHOR && (lower != null || higher != null)) {
            boolean takeLower = higher == null
                    || (lower != null
                            && anchor.matchRating() - lower.getKey()
                                    <= higher.getKey() - anchor.matchRating());
            Map.Entry<Double, LinkedHashSet<QueuedGroup>> next = takeLower ? lower : higher;
            if (next == null) break;
            added += addTwosCandidatesFromBucket(
                    anchor,
                    candidates,
                    next.getValue(),
                    MAX_TWOS_NEIGHBORS_PER_ANCHOR - added,
                    now);
            if (takeLower) lower = ratingIndex.lowerEntry(next.getKey());
            else higher = ratingIndex.higherEntry(next.getKey());
        }
    }

    /** Scans and rotates a small slice of a rating bucket so disconnected entries cannot pin it. */
    private int addTwosCandidatesFromBucket(
            QueuedGroup anchor,
            LinkedHashSet<QueuedGroup> candidates,
            LinkedHashSet<QueuedGroup> bucket,
            int limit,
            Instant now) {
        if (bucket == null || bucket.isEmpty() || limit <= 0) return 0;
        List<QueuedGroup> scanned = new ArrayList<>(Math.min(MAX_TWOS_BUCKET_SCAN, bucket.size()));
        int added = 0;
        for (QueuedGroup candidate : bucket) {
            scanned.add(candidate);
            if (!candidate.queueEntryId().equals(anchor.queueEntryId())
                    && isMatchEligible(candidate)
                    && candidates.add(candidate)) {
                added++;
            }
            if (added == limit || scanned.size() == MAX_TWOS_BUCKET_SCAN) break;
        }
        for (QueuedGroup candidate : scanned) bucket.remove(candidate);
        bucket.addAll(scanned);
        return added;
    }

    private TwosSelection findTwosSelection(
            List<QueuedGroup> candidates,
            QueuePool pool,
            Instant now) {
        if (pool == QueuePool.GUEST) return selectGuestGroups(candidates);
        return selectGroups(candidates, 0, new ArrayList<>(), 0, now);
    }

    private List<OutboundMatchmakingEvent> matchWaitingOnes(QueuePool pool) {
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        while (true) {
            Instant now = Instant.now(clock);
            QueuedGroup oldestEligibleGroup = null;
            QueuedGroup opponent = null;
            for (QueuedGroup queuedGroup : queuedGroups(pool, MatchMode.ONES)) {
                if (!isMatchEligible(queuedGroup)) continue;
                QueuedGroup candidate = findBestOneOpponent(queuedGroup, now);
                if (candidate == null) continue;
                oldestEligibleGroup = queuedGroup;
                opponent = candidate;
                break;
            }
            if (oldestEligibleGroup == null) break;

            removeQueuedGroup(oldestEligibleGroup);
            removeQueuedGroup(opponent);
            List<MatchEntrant> entrants = new ArrayList<>();
            entrants.addAll(oldestEligibleGroup.toMatchEntrants(1));
            entrants.addAll(opponent.toMatchEntrants(2));
            events.addAll(createPendingMatch(entrants, MatchMode.ONES, oldestEligibleGroup.pool()));
        }
        return events;
    }

    private List<OutboundMatchmakingEvent> matchWaitingTwos(QueuePool pool) {
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        int staleSnapshots = 0;
        while (true) {
            List<QueuedGroup> candidates;
            synchronized (this) {
                candidates = twosCandidateSnapshot(pool, null);
            }
            if (candidates.isEmpty()) break;
            TwosSelection selection = findTwosSelection(candidates, pool, Instant.now(clock));
            if (selection == null) break;
            List<OutboundMatchmakingEvent> committed = commitTwosSelection(selection, pool);
            if (committed == null) {
                if (++staleSnapshots >= MAX_TWOS_COMMIT_RETRIES) break;
                continue;
            }
            staleSnapshots = 0;
            events.addAll(committed);
        }
        return events;
    }

    private List<OutboundMatchmakingEvent> commitTwosSelection(
            TwosSelection selection,
            QueuePool pool) {
        synchronized (this) {
            boolean stillAvailable = selection.groups().stream().allMatch(group -> {
                QueuedGroup current = group.pool() == QueuePool.GUEST
                        ? guestQueueOrderByMode.get(MatchMode.TWOS).get(group.queueEntryId())
                        : registeredQueueOrderById.get(group.queueEntryId());
                return group.equals(current)
                        && isMatchEligible(current)
                        && current.members().stream().noneMatch(member ->
                                externalStartReservationsByUserId.containsKey(member.userId())
                                        || matchService.activeMatchStatus(member.userId()).activeMatch()
                                        || matchService.isMatchStartReserved(member.userId()));
            });
            if (!stillAvailable) return null;
            selection.groups().forEach(this::removeQueuedGroup);
            List<MatchEntrant> entrants = selection.groups().stream()
                    .flatMap(group -> group.toMatchEntrants(selection.teamFor(group)).stream())
                    .toList();
            return createPendingMatch(entrants, MatchMode.TWOS, pool);
        }
    }

    private List<OutboundMatchmakingEvent> currentQueueEventsForUser(UUID userId) {
        synchronized (this) {
            PendingMatch pending = pendingMatchForUser(userId);
            if (pending != null) {
                return pendingEvents(pending, "MATCH_FOUND", "Match found. Accept within 20 seconds.");
            }
            QueuedGroup current = queuedGroupsByUserId.get(userId);
            return current == null ? List.of() : waitingEvents(current);
        }
    }

    private QueuedGroup findBestOneOpponent(QueuedGroup target, Instant now) {
        if (target.pool() == QueuePool.GUEST) {
            return guestQueueOrderByMode.get(MatchMode.ONES).values().stream()
                    .filter(candidate -> !candidate.queueEntryId().equals(target.queueEntryId()))
                    .filter(this::isMatchEligible)
                    .findFirst()
                    .orElse(null);
        }

        NavigableMap<Double, LinkedHashSet<QueuedGroup>> index =
                registeredQueueByRating.get(MatchMode.ONES);
        if (index == null || index.isEmpty()) return null;

        double targetRating = target.matchRating();
        Map.Entry<Double, LinkedHashSet<QueuedGroup>> lower = index.floorEntry(targetRating);
        Map.Entry<Double, LinkedHashSet<QueuedGroup>> higher = index.higherEntry(targetRating);
        QueuedGroup best = null;
        while (lower != null || higher != null) {
            boolean takeLower = higher == null
                    || (lower != null
                            && targetRating - lower.getKey() <= higher.getKey() - targetRating);
            if (takeLower) {
                double rating = lower.getKey();
                if (targetRating - rating > MAX_RATING_RANGE) {
                    lower = null;
                    continue;
                }
                best = bestOpponentInBucket(target, best, lower.getValue(), now);
                lower = index.lowerEntry(rating);
            } else {
                double rating = higher.getKey();
                if (rating - targetRating > MAX_RATING_RANGE) {
                    higher = null;
                    continue;
                }
                best = bestOpponentInBucket(target, best, higher.getValue(), now);
                higher = index.higherEntry(rating);
            }
        }
        return best;
    }

    private QueuedGroup bestOpponentInBucket(
            QueuedGroup target,
            QueuedGroup currentBest,
            Set<QueuedGroup> bucket,
            Instant now) {
        QueuedGroup best = currentBest;
        for (QueuedGroup candidate : bucket) {
            if (candidate.queueEntryId().equals(target.queueEntryId())
                    || !isMatchEligible(candidate)
                    || !withinRatingRange(candidate, target, now)) {
                continue;
            }
            if (best == null || isBetterOneOpponent(candidate, best, target)) {
                best = candidate;
            }
        }
        return best;
    }

    private boolean isBetterOneOpponent(
            QueuedGroup candidate,
            QueuedGroup current,
            QueuedGroup target) {
        int ratingComparison = Double.compare(
                ratingDifference(candidate, target),
                ratingDifference(current, target));
        if (ratingComparison != 0) return ratingComparison < 0;
        return candidate.queuedAt().isBefore(current.queuedAt());
    }

    private void addQueuedGroup(QueuedGroup group) {
        if (group.pool() == QueuePool.GUEST) {
            guestQueueOrderByMode.get(group.mode()).put(group.queueEntryId(), group);
        } else {
            registeredQueueOrderById.put(group.queueEntryId(), group);
            if (group.mode() == MatchMode.TWOS) {
                registeredTwosSearchOrder.put(group.queueEntryId(), group);
            }
            registeredQueueByRating.get(group.mode())
                    .computeIfAbsent(group.matchRating(), ignored -> new LinkedHashSet<>())
                    .add(group);
        }
        indexQueuedGroup(group);
    }

    /** Replaces a queue record without changing its FIFO or rating-index position. */
    private void replaceQueuedGroup(QueuedGroup current, QueuedGroup replacement) {
        if (current == null || replacement == null || current.equals(replacement)) return;
        if (current.pool() == QueuePool.GUEST) {
            LinkedHashMap<UUID, QueuedGroup> queue = guestQueueOrderByMode.get(current.mode());
            QueuedGroup queuedGroup = queue.get(current.queueEntryId());
            if (queuedGroup == null || !queuedGroup.equals(current)) return;
            // Replacing an existing key in a LinkedHashMap preserves its insertion position.
            queue.put(current.queueEntryId(), replacement);
        } else {
            QueuedGroup queuedGroup = registeredQueueOrderById.get(current.queueEntryId());
            if (queuedGroup == null || !queuedGroup.equals(current)) return;
            // Replacing an existing key in a LinkedHashMap preserves its insertion position.
            registeredQueueOrderById.put(current.queueEntryId(), replacement);
            if (current.mode() == MatchMode.TWOS) {
                registeredTwosSearchOrder.put(current.queueEntryId(), replacement);
            }

            NavigableMap<Double, LinkedHashSet<QueuedGroup>> index =
                    registeredQueueByRating.get(current.mode());
            if (index != null) {
                LinkedHashSet<QueuedGroup> bucket = index.get(current.matchRating());
                if (bucket == null) {
                    index.computeIfAbsent(replacement.matchRating(), ignored -> new LinkedHashSet<>())
                            .add(replacement);
                } else {
                    List<QueuedGroup> bucketGroups = new ArrayList<>(bucket);
                    int bucketIndex = bucketGroups.indexOf(current);
                    if (bucketIndex < 0) {
                        bucket.add(replacement);
                    } else {
                        bucketGroups.set(bucketIndex, replacement);
                        bucket.clear();
                        bucket.addAll(bucketGroups);
                    }
                }
            }
        }
        unindexQueuedGroup(current);
        indexQueuedGroup(replacement);
    }

    private void removeQueuedGroup(QueuedGroup group) {
        if (group == null) return;
        QueuedGroup queuedGroup;
        if (group.pool() == QueuePool.GUEST) {
            queuedGroup = guestQueueOrderByMode.get(group.mode()).remove(group.queueEntryId());
        } else {
            queuedGroup = registeredQueueOrderById.remove(group.queueEntryId());
            if (group.mode() == MatchMode.TWOS) {
                registeredTwosSearchOrder.remove(group.queueEntryId());
            }
        }
        if (queuedGroup == null) return;
        if (queuedGroup.pool() == QueuePool.REGISTERED) {
            NavigableMap<Double, LinkedHashSet<QueuedGroup>> index =
                    registeredQueueByRating.get(queuedGroup.mode());
            if (index != null) {
                LinkedHashSet<QueuedGroup> bucket = index.get(queuedGroup.matchRating());
                if (bucket != null) {
                    bucket.remove(queuedGroup);
                    if (bucket.isEmpty()) index.remove(queuedGroup.matchRating());
                }
            }
        }
        unindexQueuedGroup(queuedGroup);
        queuedGroup.members().forEach(member -> reconnectDeadlinesByUserId.remove(member.userId()));
    }

    private Set<UUID> removeQueuedGroupsForMembers(List<MatchEntrant> members) {
        Set<QueuedGroup> queuedGroups = new LinkedHashSet<>();
        for (MatchEntrant member : members) {
            QueuedGroup queuedGroup = queuedGroupsByUserId.get(member.userId());
            if (queuedGroup != null) {
                queuedGroups.add(queuedGroup);
            }
        }
        Set<UUID> affectedUsers = queuedGroups.stream()
                .flatMap(group -> group.members().stream())
                .map(MatchEntrant::userId)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        queuedGroups.forEach(this::removeQueuedGroup);
        return affectedUsers;
    }

    private List<OutboundMatchmakingEvent> expireDisconnectedGroups(Instant now) {
        Set<QueuedGroup> expiredGroups = reconnectDeadlinesByUserId.entrySet().stream()
                .filter(entry -> !now.isBefore(entry.getValue()))
                .map(entry -> queuedGroupsByUserId.get(entry.getKey()))
                .filter(group -> group != null)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        expiredGroups.forEach(this::removeQueuedGroup);
        releaseRankedParticipationIfIdle(expiredGroups.stream()
                .flatMap(group -> group.members().stream())
                .map(MatchEntrant::userId)
                .toList());
        return expiredGroups.stream()
                .flatMap(group -> group.members().stream()
                        .map(player -> queueStatusEvent(
                                player,
                                group.mode(),
                                "MATCH_ERROR",
                                "BUILDING",
                                "The queue ended because the connection was not restored within "
                                        + QUEUE_RECONNECT_GRACE_SECONDS + " seconds.")))
                .toList();
    }

    /** Must be called while holding this service monitor after queue state changes. */
    private void releaseRankedParticipationIfIdle(Collection<UUID> userIds) {
        if (userIds == null || userIds.isEmpty()) return;
        for (UUID userId : userIds) {
            if (userId == null
                    || queuedGroupsByUserId.containsKey(userId)
                    || pendingMatchForUser(userId) != null
                    || externalStartReservationsByUserId.containsKey(userId)) {
                continue;
            }
            var activeMatch = matchService.activeMatchStatus(userId);
            if ((activeMatch != null && activeMatch.activeMatch())
                    || matchService.isMatchStartReserved(userId)) {
                continue;
            }
            participationCoordinator.releaseRankedParticipants(List.of(userId));
        }
    }

    private boolean isMatchEligible(QueuedGroup group) {
        return group != null && group.members().stream()
                .allMatch(member -> !reconnectDeadlinesByUserId.containsKey(member.userId()));
    }

    private void indexQueuedGroup(QueuedGroup group) {
        group.members().forEach(member -> {
            queuedGroupsByUserId.put(member.userId(), group);
            queuedUserIdsByPrincipal.put(member.principalName(), member.userId());
        });
    }

    private void unindexQueuedGroup(QueuedGroup group) {
        group.members().forEach(member -> {
            queuedGroupsByUserId.remove(member.userId(), group);
            queuedUserIdsByPrincipal.remove(member.principalName(), member.userId());
        });
    }

    private TwosSelection selectGroups(
            List<QueuedGroup> candidates,
            int start,
            List<QueuedGroup> selected,
            int playerCount,
            Instant now) {
        if (playerCount == 4) return assignTeams(selected, now);
        if (playerCount > 4) return null;
        TwosSelection best = null;
        for (int index = start; index < candidates.size(); index++) {
            QueuedGroup candidate = candidates.get(index);
            if (playerCount + candidate.members().size() > 4) continue;
            selected.add(candidate);
            TwosSelection result = selectGroups(
                    candidates,
                    index + 1,
                    selected,
                    playerCount + candidate.members().size(),
                    now);
            if (isBetterSelection(result, best)) best = result;
            selected.removeLast();
        }
        return best;
    }

    private TwosSelection assignTeams(List<QueuedGroup> groups, Instant now) {
        return assignTeams(groups, 0, new int[] {0, 0}, new HashMap<>(), now);
    }

    private TwosSelection assignTeams(
            List<QueuedGroup> groups,
            int index,
            int[] teamSizes,
            Map<QueuedGroup, Integer> assignments,
            Instant now) {
        if (index >= groups.size()) {
            if (teamSizes[0] != 2 || teamSizes[1] != 2) return null;
            double teamOneRating = teamRating(groups, assignments, 1);
            double teamTwoRating = teamRating(groups, assignments, 2);
            double ratingDifference = Math.abs(teamOneRating - teamTwoRating);
            if (!teamsWithinMutualRatingRange(
                    groups, assignments, teamOneRating, teamTwoRating, now)) return null;
            return new TwosSelection(
                    List.copyOf(groups),
                    Map.copyOf(assignments),
                    ratingDifference);
        }
        QueuedGroup group = groups.get(index);
        TwosSelection best = null;
        for (int team = 1; team <= 2; team++) {
            int teamIndex = team - 1;
            int nextSize = teamSizes[teamIndex] + group.members().size();
            if (nextSize > 2) continue;
            teamSizes[teamIndex] = nextSize;
            assignments.put(group, team);
            TwosSelection result = assignTeams(groups, index + 1, teamSizes, assignments, now);
            if (isBetterSelection(result, best)) best = result;
            assignments.remove(group);
            teamSizes[teamIndex] -= group.members().size();
        }
        return best;
    }

    private Map<UUID, Integer> ratingsFor(List<MatchEntrant> group, MatchMode mode) {
        List<UUID> userIds = group.stream().map(MatchEntrant::userId).toList();
        if (eloRatingService == null) {
            return userIds.stream().collect(java.util.stream.Collectors.toMap(
                    userId -> userId,
                    userId -> EloRatingService.DEFAULT_RATING,
                    (left, right) -> left,
                    java.util.LinkedHashMap::new));
        }
        Map<UUID, Integer> ratings = eloRatingService.ratingsFor(userIds, mode);
        return userIds.stream().collect(java.util.stream.Collectors.toMap(
                userId -> userId,
                userId -> ratings == null
                        ? EloRatingService.DEFAULT_RATING
                        : ratings.getOrDefault(userId, EloRatingService.DEFAULT_RATING),
                (left, right) -> left,
                java.util.LinkedHashMap::new));
    }

    private boolean withinRatingRange(
            QueuedGroup first,
            QueuedGroup second,
            Instant now) {
        double difference = ratingDifference(first, second);
        return difference <= ratingRangeFor(first.queuedAt(), now)
                && difference <= ratingRangeFor(second.queuedAt(), now);
    }

    private boolean teamsWithinMutualRatingRange(
            List<QueuedGroup> groups,
            Map<QueuedGroup, Integer> assignments,
            double teamOneRating,
            double teamTwoRating,
            Instant now) {
        return groups.stream().allMatch(group -> {
            boolean onTeamOne = assignments.getOrDefault(group, 0) == 1;
            double ownTeamRating = onTeamOne ? teamOneRating : teamTwoRating;
            double opponentTeamRating = onTeamOne ? teamTwoRating : teamOneRating;
            return Math.abs(ownTeamRating - opponentTeamRating)
                    <= ratingRangeFor(group.queuedAt(), now);
        });
    }

    private double ratingDifference(QueuedGroup first, QueuedGroup second) {
        return Math.abs(first.matchRating() - second.matchRating());
    }

    private double teamRating(
            List<QueuedGroup> groups,
            Map<QueuedGroup, Integer> assignments,
            int teamNumber) {
        return groups.stream()
                .filter(group -> assignments.getOrDefault(group, 0) == teamNumber)
                .flatMap(group -> group.members().stream()
                        .map(member -> group.ratings().getOrDefault(
                                member.userId(), EloRatingService.DEFAULT_RATING)))
                .mapToDouble(Integer::doubleValue)
                .average()
                .orElse(EloRatingService.DEFAULT_RATING);
    }

    private Instant oldestQueuedAt(List<QueuedGroup> groups) {
        return groups.stream()
                .map(QueuedGroup::queuedAt)
                .min(Comparator.naturalOrder())
                .orElse(Instant.now(clock));
    }

    private int ratingRangeFor(Instant queuedAt, Instant now) {
        long waitedSeconds = Math.max(0, Duration.between(queuedAt, now).getSeconds());
        long expansions = waitedSeconds / RATING_RANGE_INTERVAL_SECONDS;
        long range = INITIAL_RATING_RANGE + expansions * RATING_RANGE_STEP;
        return (int) Math.min(MAX_RATING_RANGE, range);
    }

    private boolean isBetterSelection(TwosSelection candidate, TwosSelection current) {
        if (candidate == null) return false;
        if (current == null) return true;
        int ageComparison = oldestQueuedAt(candidate.groups())
                .compareTo(oldestQueuedAt(current.groups()));
        if (ageComparison != 0) return ageComparison < 0;
        int queueOrderComparison = compareSelectionKeys(candidate, current);
        if (queueOrderComparison != 0) return queueOrderComparison < 0;
        int ratingComparison = Double.compare(
                candidate.ratingDifference(), current.ratingDifference());
        if (ratingComparison != 0) return ratingComparison < 0;
        return false;
    }

    private int compareSelectionKeys(TwosSelection first, TwosSelection second) {
        List<QueuedGroup> firstGroups = first.groups().stream()
                .sorted(Comparator.comparingLong(QueuedGroup::queueOrder)
                        .thenComparing(this::stableGroupKey))
                .toList();
        List<QueuedGroup> secondGroups = second.groups().stream()
                .sorted(Comparator.comparingLong(QueuedGroup::queueOrder)
                        .thenComparing(this::stableGroupKey))
                .toList();
        for (int index = 0; index < Math.min(firstGroups.size(), secondGroups.size()); index++) {
            int comparison = Long.compare(
                    firstGroups.get(index).queueOrder(), secondGroups.get(index).queueOrder());
            if (comparison != 0) return comparison;
        }
        int groupCountComparison = Integer.compare(firstGroups.size(), secondGroups.size());
        if (groupCountComparison != 0) return groupCountComparison;

        List<UUID> firstUsers = first.groups().stream()
                .flatMap(group -> group.members().stream())
                .map(MatchEntrant::userId)
                .sorted()
                .toList();
        List<UUID> secondUsers = second.groups().stream()
                .flatMap(group -> group.members().stream())
                .map(MatchEntrant::userId)
                .sorted()
                .toList();
        for (int index = 0; index < Math.min(firstUsers.size(), secondUsers.size()); index++) {
            int comparison = firstUsers.get(index).compareTo(secondUsers.get(index));
            if (comparison != 0) return comparison;
        }
        return Integer.compare(firstUsers.size(), secondUsers.size());
    }

    private UUID stableGroupKey(QueuedGroup group) {
        return group.members().stream()
                .map(MatchEntrant::userId)
                .min(Comparator.naturalOrder())
                .orElse(group.queueEntryId());
    }

    private int ratingSpread(Map<UUID, Integer> ratings) {
        if (ratings == null || ratings.size() < 2) return 0;
        int minimum = ratings.values().stream().mapToInt(Integer::intValue).min().orElse(
                EloRatingService.DEFAULT_RATING);
        int maximum = ratings.values().stream().mapToInt(Integer::intValue).max().orElse(
                EloRatingService.DEFAULT_RATING);
        return maximum - minimum;
    }

    private PendingMatch pendingMatchForUser(UUID userId) {
        return pendingMatchesById.values().stream()
                .filter(candidate -> candidate.containsUser(userId))
                .findFirst()
                .orElse(null);
    }

    private List<OutboundMatchmakingEvent> waitingEvents(QueuedGroup group) {
        return group.members().stream()
                .map(player -> waitingEvent(player, group.mode(), group.queuedAt()))
                .toList();
    }

    private OutboundMatchmakingEvent waitingEvent(
            MatchEntrant player,
            MatchMode mode,
            Instant queueStartedAt) {
        return queueStatusEvent(
                player,
                mode,
                "QUEUE_WAITING",
                "WAITING",
                null,
                queueStartedAt);
    }

    private OutboundMatchmakingEvent queueStatusEvent(
            MatchEntrant player,
            MatchMode mode,
            String type,
            String status,
            String message) {
        return queueStatusEvent(player, mode, type, status, message, null);
    }

    private OutboundMatchmakingEvent queueStatusEvent(
            MatchEntrant player,
            MatchMode mode,
            String type,
            String status,
            String message,
            Instant queueStartedAt) {
        MatchmakingPlayerDTO participant = new MatchmakingPlayerDTO(
                player.userId(),
                player.username(),
                1,
                false,
                0,
                "melee",
                false);
        return new OutboundMatchmakingEvent(
                player.principalName(),
                new MatchmakingEventDTO(
                        type,
                        null,
                        null,
                        status,
                        participant,
                        null,
                        List.of(participant),
                        Instant.now(clock),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        null,
                        null,
                        null,
                        message,
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        ROUND_LOGIC_BLOCK_LIMIT)
                .withMode(mode.name())
                .withQueueStartedAt(queueStartedAt));
    }

    private record QueuedGroup(
            UUID queueEntryId,
            List<MatchEntrant> members,
            MatchMode mode,
            QueueGroupType groupType,
            UUID partyId,
            Map<UUID, Integer> ratings,
            Instant queuedAt,
            QueuePool pool,
            long queueOrder) {
        private QueuedGroup {
            members = List.copyOf(members);
            ratings = Map.copyOf(ratings);
        }

        private QueuedGroup withSocketSession(UUID userId, String socketSessionId) {
            List<MatchEntrant> nextMembers = members.stream()
                    .map(member -> member.userId().equals(userId)
                            ? new MatchEntrant(
                                    member.userId(),
                                    member.username(),
                                    member.principalName(),
                                    socketSessionId,
                                    member.teamNumber(),
                                    member.guaranteedAbilities())
                            : member)
                    .toList();
            return new QueuedGroup(
                    queueEntryId,
                    nextMembers,
                    mode,
                    groupType,
                    partyId,
                    ratings,
                    queuedAt,
                    pool,
                    queueOrder);
        }

        private double matchRating() {
            return members.stream()
                    .mapToInt(member -> ratings.getOrDefault(
                            member.userId(), EloRatingService.DEFAULT_RATING))
                    .average()
                    .orElse(EloRatingService.DEFAULT_RATING);
        }

        private boolean containsUser(UUID userId) {
            return members.stream().anyMatch(member -> member.userId().equals(userId));
        }

        private List<MatchEntrant> toMatchEntrants(int teamNumber) {
            return members.stream().map(member -> member.withTeam(teamNumber)).toList();
        }
    }

    private record TwosSelection(
            List<QueuedGroup> groups,
            Map<QueuedGroup, Integer> teamAssignments,
            double ratingDifference) {
        private int teamFor(QueuedGroup group) {
            return teamAssignments.getOrDefault(group, 1);
        }
    }

    public record ExternalMatchStartPreparation(
            UUID reservationId,
            List<OutboundMatchmakingEvent> cancellationEvents) {
        public ExternalMatchStartPreparation {
            cancellationEvents = cancellationEvents == null
                    ? List.of()
                    : List.copyOf(cancellationEvents);
        }
    }

    private record PendingMatch(
            UUID matchId,
            List<MatchEntrant> entrants,
            Instant acceptanceEndsAt,
            Set<UUID> acceptedUserIds,
            MatchMode mode,
            QueuePool pool,
            boolean starting) {

        private boolean containsUser(UUID userId) {
            return entrants.stream().anyMatch(entrant -> entrant.userId().equals(userId));
        }

        private MatchEntrant entrantFor(UUID userId) {
            return entrants.stream()
                    .filter(entrant -> entrant.userId().equals(userId))
                    .findFirst()
                    .orElse(null);
        }

        private PendingMatch withAcceptedUser(UUID userId) {
            java.util.Set<UUID> accepted = new java.util.HashSet<>(acceptedUserIds);
            accepted.add(userId);
            return new PendingMatch(
                    matchId, entrants, acceptanceEndsAt, Set.copyOf(accepted), mode, pool, starting);
        }

        private PendingMatch withAcceptedUserIds(Set<UUID> userIds) {
            return new PendingMatch(
                    matchId,
                    entrants,
                    acceptanceEndsAt,
                    Set.copyOf(userIds),
                    mode,
                    pool,
                    starting);
        }

        private PendingMatch withStarting(boolean value) {
            return new PendingMatch(
                    matchId,
                    entrants,
                    acceptanceEndsAt,
                    acceptedUserIds,
                    mode,
                    pool,
                    value);
        }

        private PendingMatch withSocketSession(UUID userId, String socketSessionId) {
            List<MatchEntrant> updatedEntrants = entrants.stream()
                    .map(entrant -> entrant.userId().equals(userId)
                            ? new MatchEntrant(
                                    entrant.userId(),
                                    entrant.username(),
                                    entrant.principalName(),
                                    socketSessionId,
                                    entrant.teamNumber(),
                                    entrant.guaranteedAbilities())
                            : entrant)
                    .toList();
            return new PendingMatch(
                    matchId,
                    updatedEntrants,
                    acceptanceEndsAt,
                    acceptedUserIds,
                    mode,
                    pool,
                    starting);
        }
    }
}
