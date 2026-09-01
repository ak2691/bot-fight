package com.example.botfight.service.match;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.DTO.MatchCodeViewResponseDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchmakingEventDTO.RoundBrainDTO;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.connection.MatchReconnectionService;
import com.example.botfight.service.match.coordination.MatchLockService;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.loadout.MatchLoadoutService;
import com.example.botfight.service.match.lifecycle.MatchLifecycleService;
import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.model.MatchSubmissionResult;
import com.example.botfight.service.match.phase.MatchPhaseService;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.replay.ReplayDeliveryMode;
import com.example.botfight.service.match.replay.MatchReplayService;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.resolution.MatchRoundResolutionService;
import com.example.botfight.service.match.submission.MatchSubmissionService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.timing.MatchTimingService;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchService {
    private final Clock clock;
    private final MatchPersistenceService matchPersistenceService;
    private final MatchRuntimeState runtimeState = new MatchRuntimeState();
    private final ConcurrentMap<UUID, MatchSession> activeSessionsByUserId = runtimeState.activeSessionsByUserId();
    private final MatchLockService matchLockService = new MatchLockService();
    private final MatchChatService matchChatService;
    private final MatchEventFactory matchEventFactory;
    private final MatchReplayService matchReplayService;
    private final MatchLoadoutService matchLoadoutService;
    private final MatchSubmissionService matchSubmissionService;
    private final MatchLifecycleService matchLifecycleService;
    private final MatchPhaseService matchPhaseService;
    private final MatchReconnectionService matchReconnectionService;
    private final MatchTimingService matchTimingService;
    private final MatchRoundResolutionService matchRoundResolutionService;
    private final SlidingWindowRateLimiter<UUID> matchCodeViewRateLimiter;
    private final ConcurrentMap<UUID, CodeViewRequest> pendingCodeViewRequests = new ConcurrentHashMap<>();

    private static final Duration CODE_VIEW_REQUEST_TTL = Duration.ofSeconds(15);
    private static final int MAX_CODE_VIEW_BRAIN_BYTES = 120_000;
    private static final int MAX_CODE_VIEW_LOADOUT_LENGTH = 40;

    public MatchService(
            MatchSimulationService matchSimulationService,
            MatchPersistenceService matchPersistenceService,
            MatchConnectionService matchConnectionService,
            Clock clock,
            @Value("${botfight.replay.delivery-mode:full}") ReplayDeliveryMode replayDeliveryMode,
            @Qualifier("matchChatRateLimiter") TokenBucketRateLimiter<String> matchChatRateLimiter) {
        this(
                matchSimulationService,
                matchPersistenceService,
                matchConnectionService,
                clock,
                replayDeliveryMode,
                matchChatRateLimiter,
                BlockLookup.none(),
                new SlidingWindowRateLimiter<>(clock, 1, Duration.ofSeconds(1)));
    }

    public MatchService(
            MatchSimulationService matchSimulationService,
            MatchPersistenceService matchPersistenceService,
            MatchConnectionService matchConnectionService,
            Clock clock,
            @Value("${botfight.replay.delivery-mode:full}") ReplayDeliveryMode replayDeliveryMode,
            @Qualifier("matchChatRateLimiter") TokenBucketRateLimiter<String> matchChatRateLimiter,
            BlockLookup blockLookup) {
        this(
                matchSimulationService,
                matchPersistenceService,
                matchConnectionService,
                clock,
                replayDeliveryMode,
                matchChatRateLimiter,
                blockLookup,
                new SlidingWindowRateLimiter<>(clock, 1, Duration.ofSeconds(1)));
    }

    @Autowired
    public MatchService(
            MatchSimulationService matchSimulationService,
            MatchPersistenceService matchPersistenceService,
            MatchConnectionService matchConnectionService,
            Clock clock,
            @Value("${botfight.replay.delivery-mode:full}") ReplayDeliveryMode replayDeliveryMode,
            @Qualifier("matchChatRateLimiter") TokenBucketRateLimiter<String> matchChatRateLimiter,
            BlockLookup blockLookup,
            @Qualifier("matchCodeViewRateLimiter")
            SlidingWindowRateLimiter<UUID> matchCodeViewRateLimiter) {
        this.clock = clock;
        this.matchPersistenceService = matchPersistenceService;
        this.matchCodeViewRateLimiter = matchCodeViewRateLimiter;
        JsonMapper jsonMapper = new JsonMapper();
        this.matchChatService = new MatchChatService(
                clock,
                activeSessionsByUserId,
                matchChatRateLimiter,
                blockLookup);
        this.matchLoadoutService = new MatchLoadoutService(jsonMapper);
        this.matchReplayService = new MatchReplayService(replayDeliveryMode);
        this.matchEventFactory = new MatchEventFactory(
                clock,
                matchConnectionService,
                matchPersistenceService,
                matchChatService,
                runtimeState.initialLoadoutSelectionStartedMatchIds(),
                matchLoadoutService::abilityOffersForPlayer,
                this::roundBrainsForPlayer,
                this::previousRoundWon);
        this.matchSubmissionService = new MatchSubmissionService(
                runtimeState.activeSessionsByUserId(),
                runtimeState.matchSubmissionsByKey(),
                runtimeState.roundHistoryByMatchId(),
                clock,
                jsonMapper,
                matchPersistenceService,
                matchLoadoutService,
                matchEventFactory);
        this.matchLifecycleService = new MatchLifecycleService(
                runtimeState,
                matchPersistenceService,
                matchConnectionService,
                matchEventFactory,
                matchSubmissionService,
                matchChatService,
                clock);
        this.matchPhaseService = new MatchPhaseService(runtimeState, clock);
        this.matchReconnectionService = new MatchReconnectionService(
                runtimeState,
                clock,
                matchConnectionService,
                matchPersistenceService,
                matchEventFactory,
                matchReplayService,
                matchLifecycleService::clearSession);
        this.matchTimingService = new MatchTimingService(
                runtimeState,
                clock,
                matchLockService,
                matchPersistenceService,
                matchEventFactory,
                matchLoadoutService,
                matchSubmissionService);
        this.matchRoundResolutionService = new MatchRoundResolutionService(
                runtimeState,
                clock,
                matchLockService,
                matchSimulationService,
                matchPersistenceService,
                matchConnectionService,
                matchEventFactory,
                matchReplayService,
                matchSubmissionService,
                matchChatService);
    }

    private UUID matchIdForUser(UUID userId) {
        return matchReconnectionService.matchIdForUser(userId);
    }

    private <T> T withMatchLock(UUID matchId, Supplier<T> operation) {
        return matchLockService.withLock(matchId, operation);
    }

    public ActiveMatchStatusDTO activeMatchStatus(UUID userId) {
        return matchReconnectionService.activeMatchStatus(userId);
    }

    public void expireCompletedMatch(UUID matchId) {
        if (matchId == null) return;
        withMatchLock(matchId, () -> {
            matchReconnectionService.expireCompletedMatch(matchId);
            return null;
        });
    }

    public void revealCompletedMatchResult(UUID matchId) {
        if (matchPersistenceService != null) {
            matchPersistenceService.invalidateAfterResultReveal(matchId);
        }
    }

    public void leaveCompletedMatch(UUID userId) {
        UUID matchId = matchIdForUser(userId);
        if (matchId == null) return;
        withMatchLock(matchId, () -> {
            if (matchReconnectionService.leaveCompletedMatch(userId)) {
                matchChatService.leave(matchId, userId);
            }
            return null;
        });
    }

    public List<OutboundMatchmakingEvent> resumeMatch(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        UUID matchId = matchIdForUser(userId);
        if (matchId == null) {
            return List.of(matchEventFactory.noActiveMatchEvent(userId, username, principalName));
        }
        return withMatchLock(matchId, () -> matchReconnectionService.resumeMatch(
                userId, username, principalName, socketSessionId));
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player) {
        return matchLifecycleService.startMatch(opponent, player);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player,
            MatchMode mode) {
        return matchLifecycleService.startMatch(opponent, player, mode);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startTeamMatch(
            List<MatchEntrant> entrants,
            MatchMode mode) {
        return matchLifecycleService.startTeamMatch(entrants, mode);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startTeamMatch(
            List<MatchEntrant> entrants,
            MatchMode mode,
            Integer roundDurationSeconds) {
        return matchLifecycleService.startTeamMatch(entrants, mode, roundDurationSeconds);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> selectLoadout(UUID userId, String selectedLoadout) {
        return matchTimingService.selectLoadout(userId, selectedLoadout);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> selectLoadout(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String selectedLoadout) {
        return matchTimingService.selectLoadout(
                userId, expectedMatchId, expectedRoundNumber, selectedLoadout);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeout(UUID matchId) {
        return matchTimingService.resolveLoadoutSelectionTimeout(matchId);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveExpiredLoadoutSelections() {
        return matchTimingService.resolveExpiredLoadoutSelections();
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveBuildingTimeout(
            UUID matchId,
            Instant expectedDeadline) {
        return matchTimingService.resolveBuildingTimeout(matchId, expectedDeadline);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveExpiredBuildingSessions() {
        return matchTimingService.resolveExpiredBuildingSessions();
    }

    public List<OutboundMatchmakingEvent> beginInitialLoadoutSelection(UUID matchId) {
        return matchTimingService.beginInitialLoadoutSelection(matchId);
    }

    public OutboundMatchmakingEvent activateRoundLoadoutSelection(
            OutboundMatchmakingEvent pendingEvent) {
        return matchTimingService.activateRoundLoadoutSelection(pendingEvent);
    }

    public List<OutboundMatchmakingEvent> markDisconnected(String principalName) {
        return markDisconnected(principalName, null);
    }

    public List<OutboundMatchmakingEvent> markDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) return List.of();
        MatchSession session = matchReconnectionService.findSessionForPrincipal(principalName);
        if (session == null) return List.of();
        return withMatchLock(session.matchId(), () -> matchReconnectionService.markDisconnected(
                principalName, socketSessionId));
    }

    public List<OutboundMatchmakingEvent> promotePendingDisconnect(String principalName) {
        MatchSession session = matchReconnectionService.findSessionForPrincipal(principalName);
        if (session == null) return List.of();
        return withMatchLock(session.matchId(), () ->
                matchReconnectionService.promotePendingDisconnect(principalName));
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveDisconnectTimeout(
            String principalName,
            Instant expectedDeadline) {
        MatchSession session = matchReconnectionService.findSessionForPrincipal(principalName);
        if (session == null) return List.of();
        return withMatchLock(session.matchId(), () -> matchReconnectionService.resolveDisconnectTimeout(
                principalName, expectedDeadline));
    }

    public void requireActiveMatchForUser(UUID userId, UUID matchId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null || matchId == null || !session.matchId().equals(matchId)) {
            throw new AuthException("user is not active in this match");
        }
        playerForUser(session, userId);
    }

    /**
     * Performs the cheap pre-validation snapshot for a match-bound brain.
     * The authoritative acceptance method repeats this check while holding
     * the match lock because validation itself can run after this snapshot.
     */
    public boolean isCurrentMatchSubmission(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String expectedPhase) {
        if (userId == null || expectedMatchId == null || expectedRoundNumber == null) {
            return false;
        }
        return withMatchLock(expectedMatchId, () -> matchSubmissionService.isCurrent(
                userId,
                expectedMatchId,
                expectedRoundNumber,
                expectedPhase));
    }

    @Transactional
    public MatchSubmissionResult acceptMatchSubmission(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String expectedPhase,
            BotSubmission submission) {
        if (expectedMatchId == null) {
            return MatchSubmissionResult.rejected("match submission context is invalid");
        }
        return withMatchLock(expectedMatchId, () -> matchSubmissionService.accept(
                userId,
                expectedMatchId,
                expectedRoundNumber,
                expectedPhase,
                submission));
    }

    /** Convenience entry point for callers that already have the active match brain. */
    @Transactional
    public MatchSubmissionResult acceptMatchSubmission(
            UUID userId,
            UUID expectedMatchId,
            BotSubmission submission) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (expectedMatchId == null || session == null || !expectedMatchId.equals(session.matchId())) {
            return MatchSubmissionResult.rejected("match submission context is invalid");
        }
        return acceptMatchSubmission(
                userId,
                expectedMatchId,
                session.roundNumber(),
                MatchSubmissionService.BUILDING_PHASE,
                submission);
    }

    public MatchChatSubmission submitChatMessage(UUID userId, UUID matchId, String rawMessage) {
        if (matchId == null) return MatchChatSubmission.rejected(null, "Match chat is closed.");
        return withMatchLock(matchId, () -> matchChatService.submit(userId, matchId, rawMessage));
    }

    public MatchChatSubmission submitChatMessage(
            UUID userId,
            UUID matchId,
            String rawMessage,
            String channel) {
        if (matchId == null) return MatchChatSubmission.rejected(null, "Match chat is closed", channel);
        return withMatchLock(matchId, () -> matchChatService.submit(userId, matchId, rawMessage, channel));
    }

    public Instant matchChatCloseAt(UUID matchId) {
        return matchChatService.closeAt(matchId);
    }

    public MatchChatClosure closeMatchChat(UUID matchId) {
        return withMatchLock(matchId, () -> matchChatService.close(matchId));
    }

    @Transactional
    public List<OutboundMatchmakingEvent> surrender(UUID userId) {
        UUID matchId = matchIdForUser(userId);
        if (matchId == null) return List.of();
        return withMatchLock(matchId, () -> matchLifecycleService.surrender(userId));
    }

    /** Sends a one-shot, read-only code request to another current participant. */
    public OutboundMatchmakingEvent requestCodeView(
            UUID requesterId,
            UUID matchId,
            UUID targetUserId,
            Integer roundNumber) {
        if (requesterId == null || matchId == null || targetUserId == null
                || requesterId.equals(targetUserId) || roundNumber == null) {
            throw new AuthException("the code view request is invalid");
        }
        return withMatchLock(matchId, () -> {
            MatchSession session = activeSessionsByUserId.get(requesterId);
            if (session == null || !matchId.equals(session.matchId())) {
                throw new AuthException("you are not active in this match");
            }
            if (session.roundNumber() != roundNumber) {
                throw new AuthException("the code view request is stale");
            }
            MatchPlayer requester = playerForUserOrNull(session, requesterId);
            MatchPlayer target = playerForUserOrNull(session, targetUserId);
            if (requester == null || target == null) {
                throw new AuthException("the requested player is not in this match");
            }
            if (requester.teamNumber() != target.teamNumber()) {
                throw new AuthException("you can only view real code from a teammate");
            }
            matchCodeViewRateLimiter.requireAllowed(requesterId);
            Instant now = Instant.now(clock);
            pendingCodeViewRequests.entrySet().removeIf(entry ->
                    !now.isBefore(entry.getValue().createdAt().plus(CODE_VIEW_REQUEST_TTL)));
            UUID requestId = UUID.randomUUID();
            pendingCodeViewRequests.put(
                    requestId,
                    new CodeViewRequest(
                            requestId,
                            matchId,
                            requesterId,
                            targetUserId,
                            roundNumber,
                            now));
            OutboundMatchmakingEvent requestEvent = matchEventFactory.forPlayer(
                    session,
                    target,
                    "MATCH_CODE_VIEW_REQUEST",
                    codeViewStatus(session),
                    null,
                    "A participant requested a read-only snapshot of your current bot code.");
            return withCodeViewState(requestEvent, requestId, target, null, null);
        });
    }

    /** Accepts a response only from the participant that owns the request. */
    public OutboundMatchmakingEvent respondCodeView(
            UUID targetUserId,
            MatchCodeViewResponseDTO response) {
        if (targetUserId == null || response == null || response.requestId() == null) {
            throw new AuthException("the code view response is invalid");
        }
        CodeViewRequest request = pendingCodeViewRequests.get(response.requestId());
        if (request == null
                || !targetUserId.equals(request.targetUserId())
                || !request.matchId().equals(response.matchId())
                || !targetUserId.equals(response.targetUserId())
                || !request.roundNumber().equals(response.roundNumber())) {
            throw new AuthException("the code view request is no longer available");
        }
        if (response.brain() == null || !response.brain().isObject()
                || response.brain().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length
                        > MAX_CODE_VIEW_BRAIN_BYTES) {
            throw new AuthException("the code snapshot is too large or invalid");
        }
        if (response.selectedLoadout() != null
                && response.selectedLoadout().length() > MAX_CODE_VIEW_LOADOUT_LENGTH) {
            throw new AuthException("the code snapshot loadout is invalid");
        }

        return withMatchLock(request.matchId(), () -> {
            MatchSession session = activeSessionsByUserId.get(targetUserId);
            if (session == null || !request.matchId().equals(session.matchId())
                    || session.roundNumber() != request.roundNumber()) {
                pendingCodeViewRequests.remove(request.requestId());
                throw new AuthException("the code view request is stale");
            }
            MatchPlayer target = playerForUserOrNull(session, targetUserId);
            MatchPlayer requester = playerForUserOrNull(session, request.requesterId());
            if (target == null || requester == null) {
                pendingCodeViewRequests.remove(request.requestId());
                throw new AuthException("the code view request is no longer available");
            }
            if (requester.teamNumber() != target.teamNumber()) {
                pendingCodeViewRequests.remove(request.requestId());
                throw new AuthException("you can only view real code from a teammate");
            }
            if (!pendingCodeViewRequests.remove(request.requestId(), request)) {
                throw new AuthException("the code view request is no longer available");
            }
            OutboundMatchmakingEvent resultEvent = matchEventFactory.forPlayer(
                    session,
                    requester,
                    "MATCH_CODE_VIEW_RESULT",
                    codeViewStatus(session),
                    null,
                    "Read-only bot code snapshot received.");
            return withCodeViewState(
                    resultEvent,
                    request.requestId(),
                    target,
                    response.brain(),
                    response.selectedLoadout());
        });
    }

    @Transactional
    public List<OutboundMatchmakingEvent> completeSimulation(UUID matchId) {
        return matchRoundResolutionService.completeSimulation(matchId);
    }

    /**
     * Matchmaking events are snapshots, not commands. They may be delayed by
     * the scheduler or by concurrent socket handlers, so they must still
     * describe the authoritative match phase when they are delivered.
     */
    public boolean isCurrentEvent(OutboundMatchmakingEvent outbound) {
        String rejectionReason = currentEventRejectionReason(outbound);
        return rejectionReason == null;
    }

    public String currentEventRejectionReason(OutboundMatchmakingEvent outbound) {
        if (outbound == null || outbound.event() == null) {
            return matchPhaseService.currentEventRejectionReason(outbound);
        }
        if (outbound.event().matchId() == null
                || "MATCH_ACCEPT".equals(outbound.event().status())
                || "MATCH_RESULT_READY".equals(outbound.event().type())) {
            return matchPhaseService.currentEventRejectionReason(outbound);
        }
        return withMatchLock(
                outbound.event().matchId(),
                () -> matchPhaseService.currentEventRejectionReason(outbound));
    }

    private List<RoundBrainDTO> roundBrainsForPlayer(UUID matchId, UUID userId) {
        return matchSubmissionService.roundBrainsForPlayer(matchId, userId);
    }

    private Boolean previousRoundWon(UUID matchId, UUID userId) {
        return matchSubmissionService.previousRoundWon(matchId, userId);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }

    private MatchPlayer playerForUserOrNull(MatchSession session, UUID userId) {
        if (session == null || userId == null) return null;
        return session.players().stream()
                .filter(player -> userId.equals(player.userId()))
                .findFirst()
                .orElse(null);
    }

    private OutboundMatchmakingEvent withCodeViewState(
            OutboundMatchmakingEvent outbound,
            UUID requestId,
            MatchPlayer target,
            tools.jackson.databind.JsonNode brain,
            String selectedLoadout) {
        MatchmakingEventDTO event = outbound.event().withCodeViewState(
                requestId,
                target.userId(),
                target.username(),
                brain,
                selectedLoadout);
        return new OutboundMatchmakingEvent(
                outbound.principalName(),
                event,
                outbound.delayMillis(),
                outbound.publishAt());
    }

    private String codeViewStatus(MatchSession session) {
        if (session.isReplay()) return "SIMULATION_PREPARING";
        if (session.players().stream().allMatch(MatchPlayer::finished)) return "SIMULATION_LOADING";
        if (session.countdownEndsAt() != null) return "PREP";
        if (session.entityPlacementEndsAt() != null) return "OBJECT_PLACEMENT";
        if (session.buildingEndsAt() != null) return "BUILDING";
        return "LOADOUT_SELECT";
    }

    private record CodeViewRequest(
            UUID requestId,
            UUID matchId,
            UUID requesterId,
            UUID targetUserId,
            Integer roundNumber,
            Instant createdAt) {
    }

}
