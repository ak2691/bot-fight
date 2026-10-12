package com.example.botfight.service.match;

import com.example.botfight.service.match.state.MatchPhase;

import org.springframework.stereotype.Component;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.state.MatchSubmissionKey;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

/** Owns loadout, countdown, building-deadline, and round-boundary timing. */
@Component
public final class MatchTimingService {
    private final MatchScheduler matchScheduler;
    private static final String BUILDING_PHASE = "BUILDING";

    private final MatchRuntimeState state;
    private final Clock clock;
    private final MatchLockService lockService;
    private final MatchPersistenceService persistenceService;
    private final MatchEventFactory eventFactory;
    private final MatchLoadoutService loadoutService;
    private final MatchSubmissionService submissionService;

    public MatchTimingService(
            MatchRuntimeState state,
            Clock clock,
            MatchLockService lockService,
            MatchPersistenceService persistenceService,
            MatchEventFactory eventFactory,
            MatchLoadoutService loadoutService,
            MatchSubmissionService submissionService,
            MatchScheduler matchScheduler) {
        this.matchScheduler = matchScheduler;
        this.state = state;
        this.clock = clock;
        this.lockService = lockService;
        this.persistenceService = persistenceService;
        this.eventFactory = eventFactory;
        this.loadoutService = loadoutService;
        this.submissionService = submissionService;
    }

    /**
     * Records what a building player wants if their clock runs out: submit their current brain (CURRENT)
     * or resubmit last round's (PREVIOUS). It only matters before the player submits.
     */
    public List<OutboundMatchmakingEvent> setTimeoutFallback(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String timeoutFallback) {
        if (expectedMatchId == null || expectedRoundNumber == null
                || !MatchPlayer.isTimeoutFallback(timeoutFallback)) {
            return List.of();
        }
        return withLock(expectedMatchId, () -> {
            MatchSession session = state.activeSessionForUser(userId);
            if (session == null
                    || !expectedMatchId.equals(session.matchId())
                    || expectedRoundNumber.intValue() != session.roundNumber()
                    || session.countdownEndsAt() == null
                    || session.isReplay()) {
                return List.<OutboundMatchmakingEvent>of();
            }
            MatchPlayer player = playerForUser(session, userId);
            if (player.finished() || timeoutFallback.equals(player.timeoutFallback())) {
                return List.<OutboundMatchmakingEvent>of();
            }
            MatchSession updated = session.withTimeoutFallback(userId, timeoutFallback);
            state.putSession(updated);
            matchScheduler.deadlinesChanged(updated);
            return List.of(eventFactory.forPlayer(updated,
                playerForUser(updated, userId),
                MatchEventType.PLAYER_TIMEOUT_FALLBACK,
                "PREP",
                null,
                "Timeout fallback set to " + timeoutFallback + ".",
                0,
                null,
                null,
                null,
                null));
        });
    }

    public List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeout(UUID matchId) {
        return withLock(matchId, () -> resolveLoadoutSelectionTimeoutLocked(matchId));
    }

    public List<OutboundMatchmakingEvent> resolveExpiredLoadoutSelections() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = state.distinctActiveSessions().stream()
                .filter(session -> session.countdownEndsAt() == null)
                .filter(session -> session.loadoutSelectionEndsAt() != null)
                .filter(session -> !now.isBefore(session.loadoutSelectionEndsAt()))
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            events.addAll(resolveLoadoutSelectionTimeout(session.matchId()));
        }
        return events;
    }

    public List<OutboundMatchmakingEvent> resolveBuildingTimeout(
            UUID matchId,
            Instant expectedDeadline) {
        return withLock(matchId, () -> resolveBuildingTimeoutLocked(matchId, expectedDeadline));
    }

    public List<OutboundMatchmakingEvent> resolveExpiredBuildingSessions() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = state.distinctActiveSessions().stream()
                .filter(session -> session.buildingEndsAt() != null)
                .filter(session -> !expiredBuilders(session, now).isEmpty())
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            events.addAll(resolveBuildingTimeout(session.matchId(), session.buildingEndsAt()));
        }
        return events;
    }

    public List<OutboundMatchmakingEvent> beginNextRound(UUID matchId, int replayRound) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || session.phase() != MatchPhase.REPLAY
                || session.ended() || session.roundNumber() != replayRound || session.roundReadyAt() == null
                || Instant.now(clock).isBefore(session.roundReadyAt())) return List.of();
        MatchSession next = session.nextRound().withCountdown(Instant.now(clock));
        state.putSession(next);
        matchScheduler.deadlinesChanged(next);
        return next.players().stream().map(player -> eventFactory.forPlayer(next, player, MatchEventType.MATCH_ROUND_READY)).toList();
    }

    private List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeoutLocked(UUID matchId) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || session.countdownEndsAt() != null
                || session.loadoutSelectionEndsAt() == null
                || Instant.now(clock).isBefore(session.loadoutSelectionEndsAt())) {
            return List.of();
        }
        return startExpiredLoadoutSelection(session);
    }

    private List<OutboundMatchmakingEvent> resolveBuildingTimeoutLocked(
            UUID matchId,
            Instant expectedDeadline) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null
                || session.buildingEndsAt() == null
                || (expectedDeadline != null && !session.buildingEndsAt().equals(expectedDeadline))) {
            return List.of();
        }
        return resolveExpiredBuilding(session);
    }

    /**
     * The players whose own clocks have run out and who have not submitted. A player is resolved at
     * their own deadline, not the session's: a teammate who is still building keeps their clock.
     */
    private List<MatchPlayer> expiredBuilders(MatchSession session, Instant now) {
        return session.players().stream()
                .filter(player -> !player.finished())
                .filter(player -> player.buildExpiresAt() != null && !now.isBefore(player.buildExpiresAt()))
                .toList();
    }

    private List<OutboundMatchmakingEvent> resolveExpiredBuilding(MatchSession session) {
        MatchSession resolvedSession = session;
        boolean playerTimedOut = false;
        Instant now = Instant.now(clock);
        for (MatchPlayer player : expiredBuilders(session, now)) {
            BotSubmission previous = submissionService.latestRoundSubmission(
                    session.matchId(), player.userId());
            BotSubmission submission = persistenceService.createBuildingTimeoutSubmission(
                    session, player, previous);
            state.matchSubmissionsByKey().put(
                    new MatchSubmissionKey(
                            session.matchId(),
                            session.roundNumber(),
                            BUILDING_PHASE,
                            player.userId()),
                    submission);
            // Past the player's deadline, so the whole clock is spent.
            resolvedSession = resolvedSession.withFinishedPlayer(player.userId(), submission.getId(), now);
            playerTimedOut = true;
        }
        if (!playerTimedOut) return List.of();
        state.putSession(resolvedSession);
        return submissionService.afterPlayerFinished(
                resolvedSession,
                "A player ran out of time; the server resolved their missing bot brain.");
    }

    private List<OutboundMatchmakingEvent> startExpiredLoadoutSelection(MatchSession session) {
        return startCountdown(
                session,
                MatchEventType.BOT_BUILDING_SESSION_READY,
                "Kit reveal complete. Building session is starting.");
    }

    private List<OutboundMatchmakingEvent> startCountdown(
            MatchSession session,
            MatchEventType type,
            String message) {
        Instant now = Instant.now(clock);
        Instant countdownEndsAt = now;
        // Every player's clock gains the increment and starts running here.
        MatchSession countdownSession = session.withCountdown(countdownEndsAt);
        state.putSession(countdownSession);
        matchScheduler.deadlinesChanged(countdownSession);
        for (MatchPlayer player : countdownSession.players()) {
            persistenceService.updateParticipantSelectedLoadout(
                    countdownSession.matchId(), player);
        }
        return countdownSession.players().stream()
                .map(player -> eventFactory.forPlayer(countdownSession,
                player,
                type,
                "PREP",
                null,
                message,
                0,
                null,
                null,
                null,
                null))
                .toList();
    }

    private <T> T withLock(UUID matchId, Supplier<T> operation) {
        return lockService.withLock(matchId, operation);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }
}
