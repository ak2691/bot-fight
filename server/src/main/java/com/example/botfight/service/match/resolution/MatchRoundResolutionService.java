package com.example.botfight.service.match.resolution;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.coordination.MatchLockService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.HpDecision;
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
import com.example.botfight.service.match.timing.MatchTimingPolicy;
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
            Map<UUID, com.example.botfight.domain.submission.BotSubmission> submissionsByUserId =
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
            state.simulationsInProgress().remove(simulationKey);
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
                .map(player -> eventFactory.forPlayer(
                        session,
                        player,
                        "MATCH_RESULT_READY",
                        "CANCELLED",
                        null,
                        message))
                .toList();

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
        if (session == null || !session.players().stream().allMatch(MatchPlayer::finished)) {
            return null;
        }
        SimulationKey key = new SimulationKey(matchId, session.roundNumber());
        return state.simulationsInProgress().add(key) ? session : null;
    }

    private List<OutboundMatchmakingEvent> completeSimulationLocked(
            MatchSession simulationSession,
            Map<UUID, com.example.botfight.domain.submission.BotSubmission> submissionsByUserId,
            MatchReplayDTO calculatedPlayback,
            PreparedReplay preparedReplay) {
        MatchSession currentSession = state.activeSessionForMatch(simulationSession.matchId());
        if (!simulationSession.equals(currentSession)) return List.of();

        MatchReplayDTO playback = calculatedPlayback;
        // The segment's last frame is the frozen position the next round continues from.
        List<MatchReplayDTO.ReplayBotDTO> endState = playback.frames().isEmpty()
                ? List.of()
                : playback.frames().getLast().bots();
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
        long teamsStanding = endState.stream()
                .filter(bot -> bot.hp() > 0)
                .map(MatchReplayDTO.ReplayBotDTO::teamNumber)
                .distinct()
                .count();
        // The simulator says "CONTINUES" for a segment that ended with the fight still going, and
        // BOT_WIN for a knockout. Anything else ("DRAW") is a knockout only if nobody is left to
        // compare: a final segment that ran out of time with two teams standing is decided on HP.
        String simulatedResult = playback.result();
        boolean timedOut = "CONTINUES".equals(simulatedResult)
                || (!"BOT_WIN".equals(simulatedResult) && teamsStanding > 1);
        boolean knockout = !timedOut;
        boolean lastRound = simulationSession.roundNumber() >= TOTAL_ROUNDS;
        boolean seriesComplete = knockout || lastRound;
        String completionReason = "SIMULATION";
        if (seriesComplete) {
            if (!knockout) {
                HpDecision decision = HpDecision.fromEndState(endState);
                completionReason = MatchPersistenceService.COMPLETION_REASON_HP_DECISION;
                UUID hpWinner = decision == null || decision.winningTeam() == null
                        ? null
                        : firstPlayerOnTeam(scoredSession, decision.winningTeam());
                playback = replayService.withWinner(
                        playback,
                        hpWinner,
                        hpWinner == null
                                ? "Both teams finished with equal HP: a draw."
                                : teamLabel(decision.winningTeam()) + " wins on HP.");
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
            } else {
                long roundResultDelayMillis = Math.max(
                        0,
                        Duration.between(preparationCompletedAt, resultRevealsAt).toMillis());
                events.add(eventFactory.forCompactReplay(
                        replaySession,
                        player,
                        "MATCH_REPLAY_BATCH",
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
    private Map<Integer, Map<UUID, com.example.botfight.domain.submission.BotSubmission>> submissionsThroughThisRound(
            MatchSession session,
            Map<UUID, com.example.botfight.domain.submission.BotSubmission> currentRound) {
        Map<Integer, Map<UUID, com.example.botfight.domain.submission.BotSubmission>> byRound = new HashMap<>();
        state.roundHistoryByMatchId().getOrDefault(session.matchId(), List.of())
                .forEach(round -> byRound.put(round.roundNumber(), round.submissionsByUser()));
        byRound.put(session.roundNumber(), currentRound);
        return byRound;
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
