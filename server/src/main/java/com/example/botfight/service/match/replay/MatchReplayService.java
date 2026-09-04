package com.example.botfight.service.match.replay;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.state.PreparedReplay;
import com.example.botfight.service.match.state.PreparedReplayBatch;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Prepares full, batched, and reconnect-authorized replay payloads. */
public final class MatchReplayService {
    public static final int REPLAY_BATCH_MILLIS = 1_000;
    public static final int REPLAY_LOOKAHEAD_MILLIS = 2_000;

    private final ReplayDeliveryMode deliveryMode;

    public MatchReplayService(ReplayDeliveryMode deliveryMode) {
        this.deliveryMode = deliveryMode;
    }

    public PreparedReplay prepare(MatchReplayDTO playback) {
        MatchReplayDTO replayPlayback = playback;
        int replayDurationMillis = finalElapsedMs(replayPlayback);
        MatchReplayDTO fullReplay = deliveryMode == ReplayDeliveryMode.FULL
                ? fullReplayPayload(replayPlayback)
                : null;
        List<PreparedReplayBatch> batches = deliveryMode == ReplayDeliveryMode.BATCHED
                ? prepareBatches(replayPlayback)
                : List.of();
        return new PreparedReplay(replayPlayback, fullReplay, replayDurationMillis, batches);
    }

    public List<PreparedReplayBatch> prepareBatches(MatchReplayDTO playback) {
        int finalElapsedMs = finalElapsedMs(playback);
        if (finalElapsedMs <= 0) return List.of();
        List<PreparedReplayBatch> batches = new ArrayList<>();
        int sequence = 1;
        for (int startMs = 0; startMs < finalElapsedMs; startMs += REPLAY_BATCH_MILLIS) {
            int windowStartMs = startMs;
            int endMs = Math.min(finalElapsedMs, windowStartMs + REPLAY_BATCH_MILLIS);
            List<MatchReplayDTO.ReplayFrameDTO> frames = playback.frames().stream()
                    .filter(frame -> frame.elapsedMs() > windowStartMs
                            || (windowStartMs == 0 && frame.elapsedMs() == 0))
                    .filter(frame -> frame.elapsedMs() <= endMs)
                    .toList();
            if (!frames.isEmpty()) {
                boolean terminalBatch = frames.getLast().elapsedMs() >= finalElapsedMs;
                batches.add(new PreparedReplayBatch(
                        replayBatch(
                                playback,
                                null,
                                frames,
                                sequence,
                                frames.getLast().elapsedMs(),
                                terminalBatch,
                                playback.roundWinsBeforeResult()),
                        terminalBatch));
            }
            sequence++;
        }
        return List.copyOf(batches);
    }

    public MatchReplayDTO authorizedReplayForReconnect(
            MatchReplayDTO playback,
            java.time.Instant playbackStartsAt,
            java.time.Instant now) {
        if (deliveryMode == ReplayDeliveryMode.FULL) {
            return fullReplayPayload(playback);
        }
        long signedElapsedMs = java.time.Duration.between(playbackStartsAt, now).toMillis();
        long authorizationCursorMs = signedElapsedMs + REPLAY_LOOKAHEAD_MILLIS;
        int finalElapsedMs = finalElapsedMs(playback);
        long authorizedThroughMs = authorizationCursorMs >= finalElapsedMs
                ? finalElapsedMs
                : Math.max(0, authorizationCursorMs / REPLAY_BATCH_MILLIS * REPLAY_BATCH_MILLIS);
        long displayElapsedMs = Math.max(0, Math.min(finalElapsedMs, signedElapsedMs));
        long currentBatchStartMs = displayElapsedMs / REPLAY_BATCH_MILLIS * REPLAY_BATCH_MILLIS;
        long windowStartMs = Math.max(0, currentBatchStartMs - REPLAY_BATCH_MILLIS);
        List<MatchReplayDTO.ReplayFrameDTO> frames = playback.frames().stream()
                .filter(frame -> frame.elapsedMs() > windowStartMs
                        || (windowStartMs == 0 && frame.elapsedMs() == 0))
                .filter(frame -> frame.elapsedMs() <= authorizedThroughMs)
                .toList();
        int cursor = frames.isEmpty() ? 0 : frames.getLast().elapsedMs();
        boolean terminal = cursor >= finalElapsedMs(playback);
        int sequence = cursor <= 0 ? 0 : Math.max(1, (cursor - 1) / REPLAY_BATCH_MILLIS + 1);
        return replayBatch(
                playback,
                playback.initialState(),
                frames,
                sequence,
                cursor,
                terminal,
                playback.roundWinsBeforeResult());
    }

    public MatchReplayDTO initialBatch(MatchReplayDTO playback) {
        return initialBatch(playback, playback.roundWinsBeforeResult());
    }

    public MatchReplayDTO initialBatch(
            MatchReplayDTO playback,
            Map<UUID, Integer> roundWinsBeforeResult) {
        return replayBatch(
                playback,
                playback.initialState(),
                List.of(),
                0,
                0,
                finalElapsedMs(playback) == 0,
                roundWinsBeforeResult);
    }

    public MatchReplayDTO fullReplayPayload(MatchReplayDTO playback) {
        return replayBatch(
                playback,
                playback.initialState(),
                playback.frames(),
                1,
                finalElapsedMs(playback),
                true,
                playback.roundWinsBeforeResult());
    }

    public MatchReplayDTO resultPayload(MatchReplayDTO playback) {
        return new MatchReplayDTO(
                null,
                List.of(),
                playback.result(),
                playback.winnerUserId(),
                playback.message(),
                playback.batchSequence(),
                finalElapsedMs(playback),
                true,
                playback.roundWinsBeforeResult(),
                playback.ratingBefore(),
                playback.ratingAfter(),
                playback.ratingChanges());
    }

    public MatchReplayDTO withWinner(
            MatchReplayDTO playback,
            UUID winnerUserId,
            String message) {
        return new MatchReplayDTO(
                playback.initialState(),
                playback.frames(),
                winnerUserId == null ? "DRAW" : "BOT_WIN",
                winnerUserId,
                message,
                playback.batchSequence(),
                playback.replayCursorElapsedMs(),
                playback.terminalBatch(),
                playback.roundWinsBeforeResult());
    }

    public MatchReplayDTO withRoundWinsBeforeResult(
            MatchReplayDTO playback,
            Map<UUID, Integer> roundWinsBeforeResult) {
        return new MatchReplayDTO(
                playback.initialState(),
                playback.frames(),
                playback.result(),
                playback.winnerUserId(),
                playback.message(),
                playback.batchSequence(),
                playback.replayCursorElapsedMs(),
                playback.terminalBatch(),
                roundWinsBeforeResult);
    }

    public Map<UUID, Double> roundLossScores(
            MatchSession session,
            MatchReplayDTO playback) {
        Map<UUID, Double> scores = new HashMap<>();
        session.players().forEach(player -> scores.put(player.userId(), 0.0));
        if (playback.winnerUserId() == null) return Map.copyOf(scores);
        MatchPlayer winner = playerForUser(session, playback.winnerUserId());
        if (session.players().size() > 2) {
            int elapsedMs = playback.frames().isEmpty()
                    ? 0
                    : playback.frames().getLast().elapsedMs();
            double lossScore = Math.max(0.0, Math.min(1.0,
                    elapsedMs / (double) MatchSimulationService.SIMULATION_DURATION_MS));
            session.players().stream()
                    .filter(player -> player.teamNumber() != winner.teamNumber())
                    .forEach(player -> scores.put(player.userId(), lossScore));
            return Map.copyOf(scores);
        }
        MatchPlayer loser = session.players().stream()
                .filter(player -> !player.userId().equals(winner.userId()))
                .findFirst()
                .orElseThrow();
        if (loser.slot() == 2) {
            MatchReplayDTO.ReplayBotDTO finalWinner = playback.frames().isEmpty()
                    ? null
                    : playback.frames().getLast().bots().stream()
                            .filter(bot -> winner.slot() == bot.slot())
                            .findFirst()
                            .orElse(null);
            MatchReplayDTO.ReplayBotStaticDTO initialWinner = playback.initialState() == null
                    ? null
                    : playback.initialState().bots().stream()
                            .filter(bot -> winner.slot() == bot.slot())
                            .findFirst()
                            .orElse(null);
            double winnerMaxHp = initialWinner == null
                    ? 150.0
                    : Math.max(1.0, initialWinner.maxHp());
            double winnerHp = finalWinner == null
                    ? winnerMaxHp
                    : Math.max(0.0, finalWinner.hp());
            scores.put(
                    loser.userId(),
                    Math.max(0.0, Math.min(1.0, (winnerMaxHp - winnerHp) / winnerMaxHp)));
        } else {
            int elapsedMs = playback.frames().isEmpty()
                    ? 0
                    : playback.frames().getLast().elapsedMs();
            scores.put(
                    loser.userId(),
                    Math.max(0.0, Math.min(1.0,
                            elapsedMs / (double) MatchSimulationService.SIMULATION_DURATION_MS)));
        }
        return Map.copyOf(scores);
    }

    public int finalElapsedMs(MatchReplayDTO playback) {
        return playback.frames().isEmpty() ? 0 : playback.frames().getLast().elapsedMs();
    }

    public boolean isFullDelivery() {
        return deliveryMode == ReplayDeliveryMode.FULL;
    }

    public void addBatchedEvents(
            List<com.example.botfight.service.match.event.OutboundMatchmakingEvent> events,
            MatchSession session,
            MatchPlayer player,
            PreparedReplay preparedReplay,
            java.time.Instant playbackStartsAt,
            java.time.Instant resultRevealsAt,
            java.time.Instant roundReadyAt,
            java.util.function.Function<ReplayBatchRequest, com.example.botfight.service.match.event.OutboundMatchmakingEvent> eventFactory) {
        for (PreparedReplayBatch batch : preparedReplay.batches()) {
            events.add(eventFactory.apply(new ReplayBatchRequest(
                    session,
                    player,
                    batch.playback(),
                    batch.terminalBatch() ? "Terminal replay frame ready." : "Replay frames ready.",
                    Math.max(
                            0,
                            3_000L
                                    + batch.playback().replayCursorElapsedMs()
                                    - REPLAY_LOOKAHEAD_MILLIS),
                    playbackStartsAt,
                    resultRevealsAt,
                    roundReadyAt)));
        }
    }

    private MatchReplayDTO replayBatch(
            MatchReplayDTO playback,
            MatchReplayDTO.ReplayInitialStateDTO initialState,
            List<MatchReplayDTO.ReplayFrameDTO> frames,
            int sequence,
            int cursorElapsedMs,
            boolean terminalBatch,
            Map<UUID, Integer> roundWinsBeforeResult) {
        return new MatchReplayDTO(
                initialState,
                List.copyOf(frames),
                null,
                null,
                null,
                sequence,
                cursorElapsedMs,
                terminalBatch,
                roundWinsBeforeResult);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow();
    }

    public record ReplayBatchRequest(
            MatchSession session,
            MatchPlayer player,
            MatchReplayDTO playback,
            String message,
            long delayMillis,
            java.time.Instant playbackStartsAt,
            java.time.Instant resultRevealsAt,
            java.time.Instant roundReadyAt) {
    }
}
