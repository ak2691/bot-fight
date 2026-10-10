package com.example.botfight.service.match;

import org.springframework.stereotype.Component;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.simulation.WorkerReplay;
import java.time.Duration;
import java.time.Instant;
import java.util.function.Function;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.PreparedReplay;
import com.example.botfight.service.match.state.PreparedReplayBatch;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Prepares batched and reconnect-authorized replay payloads. */
@Component
public final class MatchReplayService {
    public static final int REPLAY_BATCH_MILLIS = 1_000;
    public static final int REPLAY_LOOKAHEAD_MILLIS = 2_000;

    public PreparedReplay prepare(MatchReplayDTO playback) {
        MatchReplayDTO replayPlayback = playback;
        int replayDurationMillis = finalElapsedMs(replayPlayback);
        List<PreparedReplayBatch> batches = prepareBatches(replayPlayback);
        return new PreparedReplay(replayPlayback, replayDurationMillis, batches);
    }

    public List<PreparedReplayBatch> prepareBatches(MatchReplayDTO playback) {
        if (playback.workerReplay() == null) return List.of();
        return playback.workerReplay().batches().stream()
                .map(batch -> new PreparedReplayBatch(workerBatch(playback, null, List.of(batch), batch.sequence(),
                        batch.endMs(), batch.terminal(), playback.roundWinsBeforeResult()), batch.terminal())).toList();
    }

    public MatchReplayDTO authorizedReplayForReconnect(
            MatchReplayDTO playback,
            Instant playbackStartsAt,
            Instant now) {
        long signedElapsedMs = Duration.between(playbackStartsAt, now).toMillis();
        long authorizationCursorMs = signedElapsedMs + REPLAY_LOOKAHEAD_MILLIS;
        int finalElapsedMs = finalElapsedMs(playback);
        long authorizedThroughMs = authorizationCursorMs >= finalElapsedMs
                ? finalElapsedMs
                : Math.max(0, authorizationCursorMs / REPLAY_BATCH_MILLIS * REPLAY_BATCH_MILLIS);
        long displayElapsedMs = Math.max(0, Math.min(finalElapsedMs, signedElapsedMs));
        long currentBatchStartMs = displayElapsedMs / REPLAY_BATCH_MILLIS * REPLAY_BATCH_MILLIS;
        long windowStartMs = Math.max(0, currentBatchStartMs - REPLAY_BATCH_MILLIS);
        if (playback.workerReplay() != null) {
            var batches = playback.workerReplay().batches().stream()
                    .filter(batch -> batch.endMs() > windowStartMs && batch.endMs() <= authorizedThroughMs).toList();
            int cursor = batches.isEmpty() ? 0 : batches.getLast().endMs();
            return workerBatch(playback, playback.workerReplay().initialState(), batches,
                    batches.isEmpty() ? 0 : batches.getLast().sequence(), cursor,
                    cursor >= finalElapsedMs, playback.roundWinsBeforeResult());
        }
        return new MatchReplayDTO(null, null, null, 0, 0, true, playback.roundWinsBeforeResult());
    }

    public MatchReplayDTO initialBatch(MatchReplayDTO playback) {
        return initialBatch(playback, playback.roundWinsBeforeResult());
    }

    public MatchReplayDTO initialBatch(
            MatchReplayDTO playback,
            Map<UUID, Integer> roundWinsBeforeResult) {
        return workerBatch(playback, playback.workerReplay() == null ? null : playback.workerReplay().initialState(),
                List.of(), 0, 0, finalElapsedMs(playback) == 0, roundWinsBeforeResult);
    }

    public MatchReplayDTO resultPayload(MatchReplayDTO playback) {
        return new MatchReplayDTO(
                playback.result(),
                playback.winnerUserId(),
                playback.message(),
                playback.batchSequence(),
                finalElapsedMs(playback),
                true,
                playback.roundWinsBeforeResult(),
                playback.ratingBefore(),
                playback.ratingAfter(),
                playback.ratingChanges(), null);
    }

    public MatchReplayDTO withWinner(
            MatchReplayDTO playback,
            UUID winnerUserId,
            String message) {
        return new MatchReplayDTO(
                winnerUserId == null ? "DRAW" : "BOT_WIN",
                winnerUserId,
                message,
                playback.batchSequence(),
                playback.replayCursorElapsedMs(),
                playback.terminalBatch(),
                playback.roundWinsBeforeResult()).withWorkerReplay(playback.workerReplay());
    }

    public MatchReplayDTO withRoundWinsBeforeResult(
            MatchReplayDTO playback,
            Map<UUID, Integer> roundWinsBeforeResult) {
        return new MatchReplayDTO(
                playback.result(),
                playback.winnerUserId(),
                playback.message(),
                playback.batchSequence(),
                playback.replayCursorElapsedMs(),
                playback.terminalBatch(),
                roundWinsBeforeResult).withWorkerReplay(playback.workerReplay());
    }

    public int finalElapsedMs(MatchReplayDTO playback) {
        return playback.workerReplay() == null ? 0 : playback.workerReplay().durationMs();
    }

    public void addBatchedEvents(
            List<OutboundMatchmakingEvent> events,
            MatchSession session,
            MatchPlayer player,
            PreparedReplay preparedReplay,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            Function<ReplayBatchRequest, OutboundMatchmakingEvent> eventFactory) {
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

    private MatchReplayDTO workerBatch(MatchReplayDTO playback, String initialState,
            List<WorkerReplay.Batch> batches, int sequence,
            int cursor, boolean terminal, Map<UUID, Integer> scores) {
        var raw = playback.workerReplay() == null ? null : new WorkerReplay(playback.workerReplay().result(),
                initialState, batches);
        return new MatchReplayDTO(null, null, null, sequence, cursor, terminal, scores)
                .withWorkerReplay(raw);
    }

    public record ReplayBatchRequest(
            MatchSession session,
            MatchPlayer player,
            MatchReplayDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt) {
    }
}
