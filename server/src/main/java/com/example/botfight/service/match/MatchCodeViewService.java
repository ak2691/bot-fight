package com.example.botfight.service.match;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.DTO.match.MatchCodeViewResponseDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class MatchCodeViewService {
    private final Clock clock;
    private final MatchRuntimeState runtimeState;
    private final MatchLockService matchLockService;
    private final MatchEventFactory matchEventFactory;
    private final SlidingWindowRateLimiter<UUID> matchCodeViewRateLimiter;
    private final ConcurrentMap<UUID, CodeViewRequest> pendingCodeViewRequests = new ConcurrentHashMap<>();
    private static final Duration CODE_VIEW_REQUEST_TTL = Duration.ofSeconds(15);
    private static final int MAX_CODE_VIEW_BRAIN_BYTES = 120_000;
    private static final int MAX_CODE_VIEW_LOADOUT_LENGTH = 40;
    public MatchCodeViewService(Clock clock, MatchRuntimeState runtimeState, MatchLockService matchLockService,
            MatchEventFactory matchEventFactory,
            @Qualifier("matchCodeViewRateLimiter") SlidingWindowRateLimiter<UUID> matchCodeViewRateLimiter) {
        this.clock = clock;
        this.runtimeState = runtimeState;
        this.matchLockService = matchLockService;
        this.matchEventFactory = matchEventFactory;
        this.matchCodeViewRateLimiter = matchCodeViewRateLimiter;
    }
    private <T> T withMatchLock(UUID matchId, Supplier<T> operation) {
        return matchLockService.withLock(matchId, operation);
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
            MatchSession session = runtimeState.activeSessionForUser(requesterId);
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
            OutboundMatchmakingEvent requestEvent = matchEventFactory.forPlayer(session,
                target,
                MatchEventType.MATCH_CODE_VIEW_REQUEST,
                session.phase().wireStatus(),
                null,
                "A participant requested a read-only snapshot of your current bot code.",
                0,
                null,
                null,
                null,
                null);
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
            MatchSession session = runtimeState.activeSessionForUser(targetUserId);
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
            OutboundMatchmakingEvent resultEvent = matchEventFactory.forPlayer(session,
                requester,
                MatchEventType.MATCH_CODE_VIEW_RESULT,
                session.phase().wireStatus(),
                null,
                "Read-only bot code snapshot received.",
                0,
                null,
                null,
                null,
                null);
            return withCodeViewState(
                    resultEvent,
                    request.requestId(),
                    target,
                    response.brain(),
                    response.selectedLoadout());
        });
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
        MatchmakingEventDTO event = outbound.event().toBuilder().codeViewRequestId(requestId).codeViewTargetUserId(target.userId()).codeViewTargetUsername(target.username()).codeViewBrain(brain).codeViewSelectedLoadout(selectedLoadout).build();
        return new OutboundMatchmakingEvent(
                outbound.principalName(),
                event,
                outbound.delayMillis(),
                outbound.publishAt(), outbound.phase(), outbound.schedulerOwned());
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
