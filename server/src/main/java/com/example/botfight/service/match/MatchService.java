package com.example.botfight.service.match;

import com.example.botfight.service.match.state.MatchPhase;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.match.MatchCodeViewResponseDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.connection.MatchReconnectionService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.model.MatchSubmissionResult;
import com.example.botfight.service.match.event.MatchEventGuard;
import com.example.botfight.service.match.state.MatchRuntimeState;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MatchService {
    private final MatchRuntimeState runtimeState;
    private final MatchLockService matchLockService;
    private final MatchChatService matchChatService;
    private final MatchSubmissionService matchSubmissionService;
    private final MatchLifecycleService matchLifecycleService;
    private final MatchEventGuard matchEventGuard;
    private final MatchReconnectionService matchReconnectionService;
    private final MatchTimingService matchTimingService;
    private final MatchRoundResolutionService matchRoundResolutionService;
    private final MatchCodeViewService codeViewService;

    public MatchService(
            MatchRuntimeState runtimeState,
            MatchLockService matchLockService,
            MatchChatService matchChatService,
            MatchSubmissionService matchSubmissionService,
            MatchLifecycleService matchLifecycleService,
            MatchEventGuard matchEventGuard,
            MatchReconnectionService matchReconnectionService,
            MatchTimingService matchTimingService,
            MatchRoundResolutionService matchRoundResolutionService,
            MatchCodeViewService codeViewService) {
        this.runtimeState = runtimeState;
        this.matchLockService = matchLockService;
        this.matchChatService = matchChatService;
        this.matchSubmissionService = matchSubmissionService;
        this.matchLifecycleService = matchLifecycleService;
        this.matchEventGuard = matchEventGuard;
        this.matchReconnectionService = matchReconnectionService;
        this.matchTimingService = matchTimingService;
        this.matchRoundResolutionService = matchRoundResolutionService;
        this.codeViewService = codeViewService;
    }

    public List<OutboundMatchmakingEvent> simulationLoadingEvents(UUID matchId, int round) {
        return matchSubmissionService.simulationLoadingEvents(matchId, round);
    }

    public MatchSession sessionForScheduling(UUID matchId) { return runtimeState.activeSessionForMatch(matchId); }

    public boolean isSchedulingDeadlineCurrent(UUID matchId, MatchPhase phase,
            int round, Instant deadline) {
        return runtimeState.isSchedulingDeadlineCurrent(matchId, phase, round, deadline);
    }

    public List<OutboundMatchmakingEvent> beginNextRound(UUID matchId, int replayRound) {
        return withMatchLock(matchId, () -> matchTimingService.beginNextRound(matchId, replayRound));
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

    /** Reports an in-flight roster claim so matchmaking cannot enqueue a player mid-start. */
    public boolean isMatchStartReserved(UUID userId) {
        return runtimeState.isMatchStartReserved(userId);
    }

    public void expireCompletedMatch(UUID matchId) {
        if (matchId == null) return;
        withMatchLock(matchId, () -> {
            matchReconnectionService.expireCompletedMatch(matchId);
            return null;
        });
    }

    public void revealCompletedMatchResult(UUID matchId) {
        matchLifecycleService.revealCompletedMatchResult(matchId);
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
            return matchReconnectionService.resumeMatch(userId, username, principalName, socketSessionId);
        }
        return withMatchLock(matchId, () -> matchReconnectionService.resumeMatch(
                userId, username, principalName, socketSessionId));
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player,
            MatchMode mode,
            boolean ranked) {
        return matchLifecycleService.startMatch(opponent, player, mode, ranked);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startTeamMatch(
            List<MatchEntrant> entrants,
            MatchMode mode,
            boolean ranked,
            Integer baseClockSeconds,
            Integer incrementSeconds) {
        return matchLifecycleService.startTeamMatch(entrants, mode, mode != MatchMode.CUSTOM, baseClockSeconds, incrementSeconds);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> setTimeoutFallback(
            UUID userId,
            UUID matchId,
            Integer roundNumber,
            String timeoutFallback) {
        return matchTimingService.setTimeoutFallback(userId, matchId, roundNumber, timeoutFallback);
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


    public List<OutboundMatchmakingEvent> markDisconnected(String principalName) {
        return markDisconnected(principalName, null);
    }

    public void registerSocketSession(UUID userId, String socketSessionId) {
        matchReconnectionService.registerSocketSession(userId, socketSessionId);
    }

    public void unregisterSocketSession(String principalName, String socketSessionId) {
        matchReconnectionService.unregisterSocketSession(principalName, socketSessionId);
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
        matchSubmissionService.requireActiveMatchForUser(userId, matchId);
    }

    /**
     * Performs the cheap pre-validation snapshot for a match-bound brain.
     * The authoritative acceptance method repeats this check while holding
     * the match lock because validation itself can run after this snapshot.
     */
    public String kitForSubmission(UUID userId, UUID matchId) {
        MatchSession session = runtimeState.activeSessionForUser(userId);
        if (session == null || !session.matchId().equals(matchId)) return null;
        return session.players().stream().filter(player -> player.userId().equals(userId))
                .map(com.example.botfight.service.match.model.MatchPlayer::selectedLoadout).findFirst().orElse(null);
    }

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

    @Transactional
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

    public OutboundMatchmakingEvent requestCodeView(UUID requesterId, UUID matchId, UUID targetUserId, Integer roundNumber) {
        return codeViewService.requestCodeView(requesterId, matchId, targetUserId, roundNumber);
    }

    public OutboundMatchmakingEvent respondCodeView(UUID targetUserId, MatchCodeViewResponseDTO response) {
        return codeViewService.respondCodeView(targetUserId, response);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> completeSimulation(UUID matchId) {
        return matchRoundResolutionService.completeSimulation(matchId);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> cancelFailedSimulation(UUID matchId, Integer roundNumber) {
        return matchRoundResolutionService.cancelFailedSimulation(matchId, roundNumber);
    }

    public boolean isCurrentEvent(OutboundMatchmakingEvent outbound) {
        return matchEventGuard.isCurrentEvent(outbound);
    }

    public String currentEventRejectionReason(OutboundMatchmakingEvent outbound) {
        return matchEventGuard.currentEventRejectionReason(outbound);
    }
}
