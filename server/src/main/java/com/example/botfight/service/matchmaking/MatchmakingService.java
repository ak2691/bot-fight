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
    private static final int QUEUE_RECONNECT_GRACE_SECONDS = 10;
    private static final Duration QUEUE_RECONNECT_GRACE =
            Duration.ofSeconds(QUEUE_RECONNECT_GRACE_SECONDS);

    private final MatchService matchService;
    private final Clock clock;
    private final TokenBucketRateLimiter<UUID> matchmakingRateLimiter;
    private final EloRatingService eloRatingService;
    private final MatchAbilityGuaranteeService guaranteeService;
    /** Insertion order is the fairness source; entry keys make removal and replacement O(1). */
    private final LinkedHashMap<UUID, QueuedGroup> queueOrderById = new LinkedHashMap<>();
    /** Rating indexes keep candidate lookup bounded to the relevant Elo window. */
    private final Map<MatchMode, NavigableMap<Double, LinkedHashSet<QueuedGroup>>> queueByRating =
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

    @Autowired
    public MatchmakingService(
            MatchService matchService,
            Clock clock,
            @Qualifier("matchmakingRateLimiter") TokenBucketRateLimiter<UUID> matchmakingRateLimiter,
            EloRatingService eloRatingService,
            MatchAbilityGuaranteeService guaranteeService) {
        this.matchService = matchService;
        this.clock = clock;
        this.matchmakingRateLimiter = matchmakingRateLimiter;
        this.eloRatingService = eloRatingService;
        this.guaranteeService = guaranteeService == null
                ? new MatchAbilityGuaranteeService()
                : guaranteeService;
        queueByRating.put(MatchMode.ONES, new TreeMap<>());
        queueByRating.put(MatchMode.TWOS, new TreeMap<>());
    }

    public synchronized List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName) {
        return joinQueue(userId, username, principalName, null);
    }

    public synchronized List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        return joinQueue(userId, username, principalName, socketSessionId, MatchMode.ONES);
    }

    public synchronized List<OutboundMatchmakingEvent> joinQueue(
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

    /** Joins a ranked queue as one atomic party-sized group. */
    public synchronized List<OutboundMatchmakingEvent> joinQueue(
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
    public synchronized List<OutboundMatchmakingEvent> joinQueue(
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
    public synchronized List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId,
            MatchMode mode,
            List<MatchEntrant> requestedGroup,
            UUID partyId,
            List<Integer> guaranteedAbilityIds) {
        // A stale disconnected entry must not remain eligible when another
        // player joins after its grace window has elapsed.
        expireDisconnectedGroups(Instant.now(clock));
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        if (resolvedMode != MatchMode.ONES && resolvedMode != MatchMode.TWOS) {
            throw new AuthException("Only ranked 1v1 and 2v2 matchmaking are available in the queue.");
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
        if (pendingMatchForUser(userId) != null) {
            throw new AuthException(
                    "A match is waiting for your acceptance. Return to it instead.");
        }
        matchmakingRateLimiter.requireAllowed(userId);
        for (MatchEntrant entrant : group) {
            if (matchService.activeMatchStatus(entrant.userId()).activeMatch()) {
                throw new AuthException(
                        "A party member has an active match. Return to it instead.");
            }
            if (pendingMatchForUser(entrant.userId()) != null) {
                throw new AuthException(
                        "A party member is waiting for match acceptance. Return to it instead.");
            }
        }

        QueueGroupType groupType = partyId == null && group.size() == 1
                ? QueueGroupType.SOLO
                : QueueGroupType.PARTY;
        Map<UUID, Integer> ratings = ratingsFor(group, resolvedMode);
        if (resolvedMode == MatchMode.TWOS && group.size() > 1
                && ratingSpread(ratings) > MAX_PARTY_RATING_SPREAD) {
            throw new AuthException(
                    "Party members must be within " + MAX_PARTY_RATING_SPREAD
                            + " Elo of each other to queue for 2v2.");
        }
        removeQueuedGroupsForMembers(group);
        Instant queuedAt = Instant.now(clock);
        QueuedGroup joined = new QueuedGroup(
                UUID.randomUUID(),
                group,
                resolvedMode,
                groupType,
                partyId,
                ratings,
                queuedAt);
        if (resolvedMode == MatchMode.ONES) {
            QueuedGroup opponent = findBestOneOpponent(joined, queuedAt);
            if (opponent == null) {
                addQueuedGroup(joined);
                return waitingEvents(joined);
            }
            removeQueuedGroup(opponent);
            List<MatchEntrant> entrants = new ArrayList<>();
            entrants.addAll(opponent.toMatchEntrants(1));
            entrants.addAll(joined.toMatchEntrants(2));
            return createPendingMatch(entrants, resolvedMode);
        }

        addQueuedGroup(joined);
        TwosSelection selection = findTwosSelection();
        if (selection == null) return waitingEvents(joined);
        selection.groups().forEach(this::removeQueuedGroup);
        List<MatchEntrant> entrants = selection.groups().stream()
                .flatMap(groupEntry -> groupEntry.toMatchEntrants(
                        selection.teamFor(groupEntry)).stream())
                .toList();
        return createPendingMatch(entrants, resolvedMode);
    }

    /**
     * Rechecks queued groups without requiring another player to join. The
     * caller publishes the returned events to the affected sockets.
     */
    public synchronized List<OutboundMatchmakingEvent> sweepQueues() {
        Instant now = Instant.now(clock);
        List<OutboundMatchmakingEvent> events = new ArrayList<>(expireDisconnectedGroups(now));
        events.addAll(matchWaitingOnes());
        events.addAll(matchWaitingTwos());
        return List.copyOf(events);
    }

    public synchronized void leaveQueue(UUID userId) {
        QueuedGroup queuedGroup = queuedGroupsByUserId.get(userId);
        if (queuedGroup != null) {
            removeQueuedGroup(queuedGroup);
        }
    }

    /**
     * Starts the queue reconnect grace period for the socket that went away.
     * The queue entry remains in FIFO and rating indexes, but is ineligible for
     * matching until that player reconnects or the deadline expires.
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
                .filter(player -> socketSessionId == null
                        || player.socketSessionId() == null
                        || player.socketSessionId().equals(socketSessionId))
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
                "MATCH_FOUND",
                "Match found. Accept within 20 seconds.");
    }

    public synchronized List<OutboundMatchmakingEvent> acceptMatch(
            UUID pendingMatchId,
            UUID userId,
            String socketSessionId) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null) {
            throw new AuthException("The match acceptance window is no longer available.");
        }

        MatchEntrant acceptingPlayer = pending.entrantFor(userId);
        if (acceptingPlayer == null || !socketMatches(acceptingPlayer.socketSessionId(), socketSessionId)) {
            throw new AuthException("This match acceptance belongs to another connection.");
        }

        if (!Instant.now(clock).isBefore(pending.acceptanceEndsAt())) {
            pendingMatchesById.remove(pending.matchId());
            return pendingEvents(
                    pending,
                    "MATCH_ACCEPTANCE_EXPIRED",
                    "The match acceptance window has closed.");
        }

        if (pending.acceptedUserIds().contains(userId)) {
            return pendingEvents(
                    pending,
                    "MATCH_ACCEPTED",
                    "You already accepted. Waiting for the other players.");
        }

        PendingMatch accepted = pending.withAcceptedUser(userId);
        if (accepted.acceptedUserIds().size() == accepted.entrants().size()) {
            List<OutboundMatchmakingEvent> events = accepted.mode() == MatchMode.ONES
                    ? matchService.startMatch(accepted.entrants().get(0), accepted.entrants().get(1))
                    : matchService.startTeamMatch(accepted.entrants(), accepted.mode());
            pendingMatchesById.remove(accepted.matchId());
            return events;
        }

        pendingMatchesById.put(accepted.matchId(), accepted);
        return pendingEvents(
                accepted,
                "MATCH_ACCEPTED",
                "A player accepted the match. Waiting for the other players.");
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
        if (cancellingPlayer == null || !socketMatches(cancellingPlayer.socketSessionId(), socketSessionId)) {
            throw new AuthException("This match acceptance belongs to another connection.");
        }

        pendingMatchesById.remove(pending.matchId());
        return pendingEvents(
                pending,
                "MATCH_ACCEPTANCE_CANCELLED",
                "The match was cancelled before both players accepted.");
    }

    public synchronized List<OutboundMatchmakingEvent> resolvePendingMatchTimeout(
            UUID pendingMatchId,
            Instant expectedDeadline) {
        PendingMatch pending = pendingMatchesById.get(pendingMatchId);
        if (pending == null
                || !pending.acceptanceEndsAt().equals(expectedDeadline)
                || Instant.now(clock).isBefore(pending.acceptanceEndsAt())) {
            return List.of();
        }
        pendingMatchesById.remove(pending.matchId());
        return pendingEvents(
                pending,
                "MATCH_ACCEPTANCE_EXPIRED",
                "The match was closed because both players did not accept in time.");
    }

    private List<OutboundMatchmakingEvent> createPendingMatch(
            List<MatchEntrant> entrants,
            MatchMode mode) {
        PendingMatch pending = new PendingMatch(
                UUID.randomUUID(),
                List.copyOf(entrants),
                Instant.now(clock).plusSeconds(MATCH_ACCEPTANCE_SECONDS + SUBMISSION_GRACE_SECONDS),
                Set.of(),
                mode);
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
                                    .withMode(pending.mode().name()));
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
            throw new AuthException("A ranked party can contain at most two players.");
        }
        Map<UUID, MatchEntrant> unique = new java.util.LinkedHashMap<>();
        for (MatchEntrant entrant : source) {
            if (entrant == null || entrant.userId() == null || !unique.isEmpty() && unique.containsKey(entrant.userId())) {
                throw new AuthException("The ranked party could not be queued.");
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

    private TwosSelection findTwosSelection() {
        Instant now = Instant.now(clock);
        List<QueuedGroup> candidates = queueOrderById.values().stream()
                .filter(group -> group.mode() == MatchMode.TWOS)
                .filter(this::isMatchEligible)
                .toList();
        return selectGroups(candidates, 0, new ArrayList<>(), 0, now);
    }

    private List<OutboundMatchmakingEvent> matchWaitingOnes() {
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        while (true) {
            Instant now = Instant.now(clock);
            QueuedGroup oldestEligibleGroup = null;
            QueuedGroup opponent = null;
            for (QueuedGroup queuedGroup : queueOrderById.values()) {
                if (queuedGroup.mode() != MatchMode.ONES
                        || !isMatchEligible(queuedGroup)) continue;
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
            events.addAll(createPendingMatch(entrants, MatchMode.ONES));
        }
        return events;
    }

    private List<OutboundMatchmakingEvent> matchWaitingTwos() {
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        while (true) {
            TwosSelection selection = findTwosSelection();
            if (selection == null) break;
            selection.groups().forEach(this::removeQueuedGroup);
            List<MatchEntrant> entrants = selection.groups().stream()
                    .flatMap(group -> group.toMatchEntrants(selection.teamFor(group)).stream())
                    .toList();
            events.addAll(createPendingMatch(entrants, MatchMode.TWOS));
        }
        return events;
    }

    private QueuedGroup findBestOneOpponent(QueuedGroup target, Instant now) {
        NavigableMap<Double, LinkedHashSet<QueuedGroup>> index = queueByRating.get(MatchMode.ONES);
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
        queueOrderById.put(group.queueEntryId(), group);
        queueByRating.get(group.mode())
                .computeIfAbsent(group.matchRating(), ignored -> new LinkedHashSet<>())
                .add(group);
        indexQueuedGroup(group);
    }

    /** Replaces a queue record without changing its FIFO or rating-index position. */
    private void replaceQueuedGroup(QueuedGroup current, QueuedGroup replacement) {
        if (current == null || replacement == null || current.equals(replacement)) return;
        QueuedGroup queuedGroup = queueOrderById.get(current.queueEntryId());
        if (queuedGroup == null || !queuedGroup.equals(current)) return;
        // Replacing an existing key in a LinkedHashMap preserves its insertion position.
        queueOrderById.put(current.queueEntryId(), replacement);

        NavigableMap<Double, LinkedHashSet<QueuedGroup>> index = queueByRating.get(current.mode());
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
        unindexQueuedGroup(current);
        indexQueuedGroup(replacement);
    }

    private void removeQueuedGroup(QueuedGroup group) {
        if (group == null) return;
        QueuedGroup queuedGroup = queueOrderById.remove(group.queueEntryId());
        if (queuedGroup == null) return;
        NavigableMap<Double, LinkedHashSet<QueuedGroup>> index = queueByRating.get(queuedGroup.mode());
        if (index != null) {
            LinkedHashSet<QueuedGroup> bucket = index.get(queuedGroup.matchRating());
            if (bucket != null) {
                bucket.remove(queuedGroup);
                if (bucket.isEmpty()) index.remove(queuedGroup.matchRating());
            }
        }
        unindexQueuedGroup(queuedGroup);
        queuedGroup.members().forEach(member -> reconnectDeadlinesByUserId.remove(member.userId()));
    }

    private void removeQueuedGroupsForMembers(List<MatchEntrant> members) {
        Set<QueuedGroup> queuedGroups = new LinkedHashSet<>();
        for (MatchEntrant member : members) {
            QueuedGroup queuedGroup = queuedGroupsByUserId.get(member.userId());
            if (queuedGroup != null) {
                queuedGroups.add(queuedGroup);
            }
        }
        queuedGroups.forEach(this::removeQueuedGroup);
    }

    private List<OutboundMatchmakingEvent> expireDisconnectedGroups(Instant now) {
        Set<QueuedGroup> expiredGroups = reconnectDeadlinesByUserId.entrySet().stream()
                .filter(entry -> !now.isBefore(entry.getValue()))
                .map(entry -> queuedGroupsByUserId.get(entry.getKey()))
                .filter(group -> group != null)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        expiredGroups.forEach(this::removeQueuedGroup);
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
        int ratingComparison = Double.compare(
                candidate.ratingDifference(), current.ratingDifference());
        if (ratingComparison != 0) return ratingComparison < 0;
        return false;
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

    private static boolean socketMatches(String expectedSocketSessionId, String actualSocketSessionId) {
        return expectedSocketSessionId == null
                || actualSocketSessionId == null
                || expectedSocketSessionId.equals(actualSocketSessionId);
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
        return new OutboundMatchmakingEvent(
                player.principalName(),
                new MatchmakingEventDTO(
                        type,
                        null,
                        null,
                        status,
                        new MatchmakingPlayerDTO(
                                player.userId(),
                                player.username(),
                                1,
                                false,
                                0,
                                "melee",
                                false),
                        null,
                        List.of(),
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
            Instant queuedAt) {
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
                    queuedAt);
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

    private record PendingMatch(
            UUID matchId,
            List<MatchEntrant> entrants,
            Instant acceptanceEndsAt,
            Set<UUID> acceptedUserIds,
            MatchMode mode) {

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
            return new PendingMatch(matchId, entrants, acceptanceEndsAt, Set.copyOf(accepted), mode);
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
                    mode);
        }
    }
}
