package com.example.botfight.service.match;

import com.example.botfight.service.match.state.MatchPhase;

import org.springframework.stereotype.Component;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.domain.submission.BotSubmission;
import java.util.concurrent.TimeUnit;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.state.PreparedReplay;
import com.example.botfight.service.match.state.RoundSubmissionRecord;
import com.example.botfight.service.match.state.SimulationKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Scores an authoritative round and schedules replay/result delivery. */
@Component
public final class MatchRoundResolutionService {
    private final MatchScheduler matchScheduler;
    private static final Logger log = LoggerFactory.getLogger(MatchRoundResolutionService.class);
    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;
    private static final long ROUND_RESULT_HOLD_MILLIS = 3_000L;
    private static final long TERMINAL_RESULT_RECONNECT_MILLIS = 30_000L;
    private static final long MATCH_CHAT_RETENTION_MILLIS = 30_000L;
    private static final int TOTAL_ROUNDS = MatchTimingPolicy.MAX_ROUNDS;

    private final MatchRuntimeState state;
    private final Clock clock;
    private final MatchLockService lockService;
    private final MatchSimulationService simulationService;
    private final MatchPersistenceService persistenceService;
    private final MatchConnectionService connectionService;
    private final MatchEventFactory eventFactory;
    private final MatchReplayService replayService;
    private final MatchSubmissionService submissionService;
    private final MatchChatService chatService;

    public MatchRoundResolutionService(
            MatchRuntimeState state,
            Clock clock,
            MatchLockService lockService,
            MatchSimulationService simulationService,
            MatchPersistenceService persistenceService,
            MatchConnectionService connectionService,
            MatchEventFactory eventFactory,
            MatchReplayService replayService,
            MatchSubmissionService submissionService,
            MatchChatService chatService,
            MatchScheduler matchScheduler) {
        this.matchScheduler = matchScheduler;
        this.state = state;
        this.clock = clock;
        this.lockService = lockService;
        this.simulationService = simulationService;
        this.persistenceService = persistenceService;
        this.connectionService = connectionService;
        this.eventFactory = eventFactory;
        this.replayService = replayService;
        this.submissionService = submissionService;
        this.chatService = chatService;
    }

    public List<OutboundMatchmakingEvent> completeSimulation(UUID matchId) {
        long resolutionStartedNanos = System.nanoTime();
        MatchSession simulationSession = withLock(matchId, () -> claimSimulationLocked(matchId));
        if (simulationSession == null) {
            log.warn("Authoritative round resolution was not claimed matchId={}", matchId);
            return List.of();
        }
        log.info(
                "Authoritative round resolution started matchId={} round={}",
                matchId,
                simulationSession.roundNumber());
        SimulationKey simulationKey = new SimulationKey(matchId, simulationSession.roundNumber());
        try {
            long submissionsStartedNanos = System.nanoTime();
            Map<UUID, BotSubmission> submissionsByUserId =
                    submissionService.submissionsForRound(simulationSession);
            log.info(
                    "Authoritative round submissions loaded matchId={} round={} submissions={} elapsedMs={}",
                    matchId,
                    simulationSession.roundNumber(),
                    submissionsByUserId.size(),
                    elapsedMillis(submissionsStartedNanos));
            if (submissionsByUserId.size() != simulationSession.players().size()) {
                throw new AuthException("authoritative match submissions are incomplete");
            }
            long simulationStartedNanos = System.nanoTime();
            MatchReplayDTO calculatedPlayback = simulationService.buildDuelReplay(
                    simulationSession, submissionsThroughThisRound(simulationSession, submissionsByUserId));
            if (calculatedPlayback == null || "ERROR".equals(calculatedPlayback.result())) {
                throw new IllegalStateException("authoritative duel simulation failed");
            }
            log.info(
                    "Authoritative duel simulation completed matchId={} round={} result={} elapsedMs={}",
                    matchId,
                    simulationSession.roundNumber(),
                    calculatedPlayback.result(),
                    elapsedMillis(simulationStartedNanos));
            MatchReplayDTO playback = calculatedPlayback;
            long replayPreparationStartedNanos = System.nanoTime();
            PreparedReplay preparedReplay = replayService.prepare(playback);
            log.info(
                    "Authoritative replay prepared matchId={} round={} durationMs={} elapsedMs={}",
                    matchId,
                    simulationSession.roundNumber(),
                    preparedReplay.replayDurationMillis(),
                    elapsedMillis(replayPreparationStartedNanos));
            List<OutboundMatchmakingEvent> events = withLock(matchId, () -> completeSimulationLocked(
                    simulationSession,
                    submissionsByUserId,
                    playback,
                    preparedReplay));
            log.info(
                    "Authoritative round resolution completed matchId={} round={} events={} totalElapsedMs={}",
                    matchId,
                    simulationSession.roundNumber(),
                    events.size(),
                    elapsedMillis(resolutionStartedNanos));
            return events;
        } finally {
            withLock(matchId, () -> {
                MatchSession current = state.activeSessionForMatch(matchId);
                if (current != null && current.roundNumber() == simulationKey.roundNumber() && current.phase() == MatchPhase.SIMULATING) {
                    state.putSession(current.simulationFailed());
                }
                state.simulationsInProgress().remove(simulationKey);
                return null;
            });
        }
    }

    /**
     * Ends a match without a rated outcome after the controller exhausts its
     * bounded retries for this authoritative round. The expected round and
     * active phase make delayed failure callbacks harmless after a phase change.
     */
    public List<OutboundMatchmakingEvent> cancelFailedSimulation(UUID matchId, Integer expectedRoundNumber) {
        if (matchId == null || expectedRoundNumber == null) return List.of();
        return withLock(matchId, () -> cancelFailedSimulationLocked(matchId, expectedRoundNumber));
    }

    private List<OutboundMatchmakingEvent> cancelFailedSimulationLocked(
            UUID matchId,
            int expectedRoundNumber) {
        MatchSession session = state.activeSessionForMatch(matchId);
        SimulationKey key = new SimulationKey(matchId, expectedRoundNumber);
        if (session == null
                || session.roundNumber() != expectedRoundNumber
                || session.isReplay()
                || !session.players().stream().allMatch(MatchPlayer::finished)
                || state.simulationsInProgress().contains(key)) {
            return List.of();
        }

        submissionService.persistCodeHistory(session);
        if (!persistenceService.cancelMatchAfterSimulationFailure(matchId)) {
            return List.of();
        }

        String message = "The match was cancelled because the server could not complete its authoritative simulation.";
        List<OutboundMatchmakingEvent> events = session.players().stream()
                .map(player -> eventFactory.forPlayer(session.resultReady(),
                player,
                MatchEventType.MATCH_RESULT_READY,
                "CANCELLED",
                null,
                message,
                0,
                null,
                null,
                null,
                null))
                .toList();

        matchScheduler.cancelAll(matchId);
        state.removeSession(session);
        state.roundHistoryByMatchId().remove(matchId);
        state.initialLoadoutSelectionStartedMatchIds().remove(matchId);
        submissionService.removeAll(matchId);
        state.simulationsInProgress().remove(key);
        session.players().forEach(player -> connectionService.clear(player.userId()));
        log.warn(
                "Cancelled match after authoritative simulation retries failed matchId={} round={} seed={}",
                matchId,
                expectedRoundNumber,
                session.simulationSeed());
        return events;
    }

    private MatchSession claimSimulationLocked(UUID matchId) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null
                || session.phase() != MatchPhase.SIMULATION_LOADING
                || !session.players().stream().allMatch(MatchPlayer::finished)) {
            return null;
        }
        SimulationKey key = new SimulationKey(matchId, session.roundNumber());
        if (!state.simulationsInProgress().add(key)) return null;
        MatchSession claimed = session.simulating();
        state.putSession(claimed);
        return claimed;
    }

    private List<OutboundMatchmakingEvent> completeSimulationLocked(
            MatchSession simulationSession,
            Map<UUID, BotSubmission> submissionsByUserId,
            MatchReplayDTO calculatedPlayback,
            PreparedReplay preparedReplay) {
        MatchSession currentSession = state.activeSessionForMatch(simulationSession.matchId());
        if (!simulationSession.equals(currentSession)) return List.of();

        MatchReplayDTO playback = calculatedPlayback;
        // The worker summary supplies the frozen position for the next round.
        var endState = playback.workerReplay().result().endState();
        MatchSession scoredSession = simulationSession.withSegmentEndState(endState);
        state.roundHistoryByMatchId()
                .computeIfAbsent(simulationSession.matchId(), ignored -> new ArrayList<>())
                .add(new RoundSubmissionRecord(
                        simulationSession.roundNumber(),
                        playback.winnerUserId(),
                        Map.copyOf(submissionsByUserId),
                        Map.of()));
        submissionService.removeForRound(
                simulationSession.matchId(), simulationSession.roundNumber());

        // The fight ends when at most one team is left standing, or after the last round, when the
        // team with more total HP wins. Two teams that fall on the same tick, or finish level, draw.
        boolean timedOut = !"KO".equals(playback.workerReplay().result().endReason());
        boolean knockout = !timedOut;
        boolean lastRound = simulationSession.roundNumber() >= TOTAL_ROUNDS;
        boolean ended = knockout || lastRound;
        String completionReason = "SIMULATION";
        if (ended) {
            if (!knockout) {
                completionReason = MatchPersistenceService.COMPLETION_REASON_HP_DECISION;
                Integer winningTeam = playback.workerReplay().result().winnerTeam();
                UUID hpWinner = winningTeam == null ? null : firstPlayerOnTeam(scoredSession, winningTeam);
                playback = replayService.withWinner(
                        playback,
                        hpWinner,
                        hpWinner == null
                                ? "Both teams finished with equal HP: a draw."
                                : teamLabel(winningTeam) + " wins on HP.");
            } else if (playback.winnerUserId() == null) {
                playback = replayService.withWinner(playback, null, "The fight ended in a draw.");
            }
            long codeHistoryStartedNanos = System.nanoTime();
            log.info(
                    "Terminal round code-history persistence started matchId={} round={}",
                    simulationSession.matchId(),
                    simulationSession.roundNumber());
            submissionService.persistCodeHistory(scoredSession);
            log.info(
                    "Terminal round code-history persistence completed matchId={} round={} elapsedMs={}",
                    simulationSession.matchId(),
                    simulationSession.roundNumber(),
                    elapsedMillis(codeHistoryStartedNanos));
            long matchPersistenceStartedNanos = System.nanoTime();
            log.info(
                    "Terminal match-result persistence started matchId={} round={}",
                    simulationSession.matchId(),
                    simulationSession.roundNumber());
            persistenceService.completeMatch(scoredSession.matchId(), playback, completionReason);
            log.info(
                    "Terminal match-result persistence completed matchId={} round={} elapsedMs={}",
                    simulationSession.matchId(),
                    simulationSession.roundNumber(),
                    elapsedMillis(matchPersistenceStartedNanos));
        } else {
            for (MatchPlayer player : scoredSession.players()) {
                connectionService.pauseDisconnectForReplay(player.userId());
            }
        }
        if (playback != calculatedPlayback) preparedReplay = replayService.prepare(playback);

        Instant preparationCompletedAt = Instant.now(clock);
        Instant playbackStartsAt = preparationCompletedAt.plusMillis(PLAYBACK_PREP_DELAY_MILLIS);
        Instant resultRevealsAt = playbackStartsAt.plusMillis(preparedReplay.replayDurationMillis());
        if (ended) {
            persistenceService.setResultVisibleAt(scoredSession.matchId(), resultRevealsAt);
        }
        Instant roundReadyAt = resultRevealsAt.plusMillis(
                ended ? TERMINAL_RESULT_RECONNECT_MILLIS : ROUND_RESULT_HOLD_MILLIS);
        long roundReadyDelayMillis = Math.max(
                0,
                Duration.between(preparationCompletedAt, roundReadyAt).toMillis());
        MatchSession replaySession = scoredSession.withReplay(
                preparedReplay.replayPlayback(),
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                ended);
        state.putSession(replaySession);
        matchScheduler.replay(replaySession);
        if (ended) {
            chatService.open(scoredSession, resultRevealsAt.plusMillis(MATCH_CHAT_RETENTION_MILLIS));
        }

        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchPlayer player : scoredSession.players()) {
            events.add(eventFactory.forCompactReplay(replaySession,
                player,
                MatchEventType.SIMULATION_PREPARING,
                "SIMULATION_PREPARING",
                replayService.initialBatch(playback),
                "Preparing the authoritative round replay.",
                0,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt));

                replayService.addBatchedEvents(
                        events,
                        replaySession,
                        player,
                        preparedReplay,
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt,
                        request -> eventFactory.forCompactReplay(request.session(),
                request.player(),
                MatchEventType.MATCH_REPLAY_BATCH,
                "READY_FOR_PLAYBACK",
                request.playback(),
                request.message(),
                request.delayMillis(),
                request.playbackStartsAt(),
                request.resultRevealsAt(),
                request.roundReadyAt()));

            if (ended) {
                long resultDelayMillis = Math.max(
                        0,
                        Duration.between(preparationCompletedAt, resultRevealsAt).toMillis());
                events.add(eventFactory.forCompactReplay(replaySession,
                player,
                MatchEventType.MATCH_RESULT_READY,
                "RESULT_READY",
                replayService.resultPayload(playback),
                playback.message(),
                resultDelayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt));
            } else {
                long roundResultDelayMillis = Math.max(
                        0,
                        Duration.between(preparationCompletedAt, resultRevealsAt).toMillis());
                events.add(eventFactory.forCompactReplay(replaySession,
                player,
                MatchEventType.MATCH_REPLAY_BATCH,
                "ROUND_RESULT_READY",
                replayService.resultPayload(playback),
                playback.message(),
                roundResultDelayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt));
            }
        }

        MatchSession nextRoundSession = null;
        if (!ended) {
            nextRoundSession = replaySession.nextRound();
            for (MatchPlayer player : nextRoundSession.players()) {
                events.add(eventFactory.forPlayer(nextRoundSession,
                player,
                MatchEventType.MATCH_ROUND_READY,
                "LOADOUT_SELECT",
                null,
                "Round " + nextRoundSession.roundNumber() + " loadout ready.",
                roundReadyDelayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                null));
            }
        }

        log.info(
                "Active replay session stored matchId={} round={} ended={} recipients={}",
                simulationSession.matchId(),
                simulationSession.roundNumber(),
                ended,
                scoredSession.players().size());
        if (ended) {
            state.roundHistoryByMatchId().remove(simulationSession.matchId());
            submissionService.removeAll(simulationSession.matchId());
        }
        return events;
    }

    private String teamLabel(int teamNumber) {
        return teamNumber == 2 ? "Red Team" : "Blue Team";
    }

    private UUID firstPlayerOnTeam(MatchSession session, int teamNumber) {
        return session.players().stream()
                .filter(player -> player.teamNumber() == teamNumber)
                .map(MatchPlayer::userId)
                .findFirst()
                .orElse(null);
    }

    /**
     * Every round's stored brains up to and including this one. The segment simulator replays the whole
     * match from tick 0 with them, so the current segment is exact whatever the earlier rounds did.
     */
    private Map<Integer, Map<UUID, BotSubmission>> submissionsThroughThisRound(
            MatchSession session,
            Map<UUID, BotSubmission> currentRound) {
        Map<Integer, Map<UUID, BotSubmission>> byRound = new HashMap<>();
        state.roundHistoryByMatchId().getOrDefault(session.matchId(), List.of())
                .forEach(round -> byRound.put(round.roundNumber(), round.submissionsByUser()));
        byRound.put(session.roundNumber(), currentRound);
        return byRound;
    }

    private <T> T withLock(UUID matchId, Supplier<T> operation) {
        return lockService.withLock(matchId, operation);
    }

    private static long elapsedMillis(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }
}
