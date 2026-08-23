package com.example.botfight.service.match.resolution;

import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.coordination.MatchLockService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.replay.MatchReplayService;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.state.PreparedReplay;
import com.example.botfight.service.match.state.RoundSubmissionRecord;
import com.example.botfight.service.match.state.SimulationKey;
import com.example.botfight.service.match.submission.MatchSubmissionService;
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
public final class MatchRoundResolutionService {
    private static final Logger log = LoggerFactory.getLogger(MatchRoundResolutionService.class);
    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;
    private static final long ROUND_RESULT_HOLD_MILLIS = 3_000L;
    private static final long TERMINAL_RESULT_RECONNECT_MILLIS = 30_000L;
    private static final long MATCH_CHAT_RETENTION_MILLIS = 30_000L;
    private static final int WINS_REQUIRED = 2;
    private static final int TOTAL_ROUNDS = 3;

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
            MatchChatService chatService) {
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
            Map<UUID, com.example.botfight.domain.BotSubmission> submissionsByUserId =
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
            MatchReplayDTO playback = simulationService.buildDuelReplay(
                    simulationSession, submissionsByUserId);
            log.info(
                    "Authoritative duel simulation completed matchId={} round={} result={} elapsedMs={}",
                    matchId,
                    simulationSession.roundNumber(),
                    playback.result(),
                    elapsedMillis(simulationStartedNanos));
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
            state.simulationsInProgress().remove(simulationKey);
        }
    }

    private MatchSession claimSimulationLocked(UUID matchId) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || !session.players().stream().allMatch(MatchPlayer::finished)) {
            return null;
        }
        SimulationKey key = new SimulationKey(matchId, session.roundNumber());
        return state.simulationsInProgress().add(key) ? session : null;
    }

    private List<OutboundMatchmakingEvent> completeSimulationLocked(
            MatchSession simulationSession,
            Map<UUID, com.example.botfight.domain.BotSubmission> submissionsByUserId,
            MatchReplayDTO calculatedPlayback,
            PreparedReplay preparedReplay) {
        MatchSession currentSession = state.activeSessionForMatch(simulationSession.matchId());
        if (!simulationSession.equals(currentSession)) return List.of();

        MatchReplayDTO playback = calculatedPlayback;
        MatchSession scoredSession = simulationSession.withRoundResult(playback.winnerUserId());
        state.roundHistoryByMatchId()
                .computeIfAbsent(simulationSession.matchId(), ignored -> new ArrayList<>())
                .add(new RoundSubmissionRecord(
                        simulationSession.roundNumber(),
                        playback.winnerUserId(),
                        Map.copyOf(submissionsByUserId),
                        replayService.roundLossScores(simulationSession, playback)));
        submissionService.removeForRound(
                simulationSession.matchId(), simulationSession.roundNumber());

        boolean seriesComplete = simulationSession.roundNumber() >= TOTAL_ROUNDS
                || scoredSession.players().stream()
                        .anyMatch(player -> player.roundWins() >= WINS_REQUIRED);
        if (seriesComplete) {
            UUID seriesWinner = seriesWinner(scoredSession);
            playback = replayService.withWinner(
                    playback,
                    seriesWinner,
                    seriesWinner == null
                            ? "The best-of-three match ended tied."
                            : playerForUser(scoredSession, seriesWinner).username()
                                    + " wins the best-of-three match.");
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
            persistenceService.completeMatch(scoredSession.matchId(), playback);
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
        if (seriesComplete) {
            persistenceService.setResultVisibleAt(scoredSession.matchId(), resultRevealsAt);
        }
        Instant roundReadyAt = resultRevealsAt.plusMillis(
                seriesComplete ? TERMINAL_RESULT_RECONNECT_MILLIS : ROUND_RESULT_HOLD_MILLIS);
        long roundReadyDelayMillis = Math.max(
                0,
                Duration.between(preparationCompletedAt, roundReadyAt).toMillis());
        MatchSession replaySession = scoredSession.withReplay(
                preparedReplay.replayPlayback(),
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
        state.putSession(replaySession);
        if (seriesComplete) {
            chatService.open(scoredSession, resultRevealsAt.plusMillis(MATCH_CHAT_RETENTION_MILLIS));
        }

        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchPlayer player : scoredSession.players()) {
            events.add(eventFactory.forCompactReplay(
                    replaySession,
                    player,
                    "SIMULATION_PREPARING",
                    "SIMULATION_PREPARING",
                    replayService.initialBatch(playback),
                    "Preparing the authoritative round replay.",
                    0,
                    playbackStartsAt,
                    resultRevealsAt,
                    roundReadyAt));
            if (replayService.isFullDelivery()) {
                events.add(eventFactory.forCompactReplay(
                        replaySession,
                        player,
                        "MATCH_REPLAY_BATCH",
                        "READY_FOR_PLAYBACK",
                        preparedReplay.fullReplay(),
                        "Complete replay ready.",
                        0,
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt));
            } else {
                replayService.addBatchedEvents(
                        events,
                        replaySession,
                        player,
                        preparedReplay,
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt,
                        request -> eventFactory.forCompactReplay(
                                request.session(),
                                request.player(),
                                "MATCH_REPLAY_BATCH",
                                "READY_FOR_PLAYBACK",
                                request.playback(),
                                request.message(),
                                request.delayMillis(),
                                request.playbackStartsAt(),
                                request.resultRevealsAt(),
                                request.roundReadyAt()));
            }
            if (seriesComplete) {
                long resultDelayMillis = Math.max(
                        0,
                        Duration.between(preparationCompletedAt, resultRevealsAt).toMillis());
                events.add(eventFactory.forCompactReplay(
                        replaySession,
                        player,
                        "MATCH_RESULT_READY",
                        "RESULT_READY",
                        replayService.resultPayload(playback),
                        playback.message(),
                        resultDelayMillis,
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt));
            }
        }

        MatchSession nextRoundSession = null;
        if (!seriesComplete) {
            nextRoundSession = scoredSession.nextRound();
            for (MatchPlayer player : nextRoundSession.players()) {
                events.add(eventFactory.forPlayer(
                        nextRoundSession,
                        player,
                        "MATCH_ROUND_READY",
                        "LOADOUT_SELECT",
                        null,
                        "Round " + nextRoundSession.roundNumber() + " loadout ready.",
                        roundReadyDelayMillis,
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt));
            }
        }

        log.info(
                "Active replay session stored matchId={} round={} seriesComplete={} recipients={}",
                simulationSession.matchId(),
                simulationSession.roundNumber(),
                seriesComplete,
                scoredSession.players().size());
        if (seriesComplete) {
            state.roundHistoryByMatchId().remove(simulationSession.matchId());
            submissionService.removeAll(simulationSession.matchId());
        }
        return events;
    }

    private UUID seriesWinner(MatchSession session) {
        MatchPlayer first = session.players().get(0);
        MatchPlayer second = session.players().get(1);
        if (first.roundWins() != second.roundWins()) {
            return first.roundWins() > second.roundWins() ? first.userId() : second.userId();
        }
        Map<UUID, Double> totals = new HashMap<>();
        state.roundHistoryByMatchId().getOrDefault(session.matchId(), List.of()).forEach(round ->
                round.lossScores().forEach((userId, score) -> totals.merge(userId, score, Double::sum)));
        double firstScore = totals.getOrDefault(first.userId(), 0.0);
        double secondScore = totals.getOrDefault(second.userId(), 0.0);
        if (Math.abs(firstScore - secondScore) < 0.000001) return null;
        return firstScore > secondScore ? first.userId() : second.userId();
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }

    private <T> T withLock(UUID matchId, Supplier<T> operation) {
        return lockService.withLock(matchId, operation);
    }

    private static long elapsedMillis(long startedNanos) {
        return java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }
}
