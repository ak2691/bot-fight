package com.example.botfight.DTO.match;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.example.botfight.service.simulation.WorkerReplay;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import tools.jackson.databind.util.RawValue;

/** Authorized replay envelope; engine render JSON passes through unchanged. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MatchReplayDTO(
        String result, UUID winnerUserId, String message, Integer batchSequence,
        Integer replayCursorElapsedMs,
        @JsonInclude(JsonInclude.Include.NON_DEFAULT) Boolean terminalBatch,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) Map<UUID, Integer> roundWinsBeforeResult,
        Integer ratingBefore, Integer ratingAfter,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) List<RatingChangeDTO> ratingChanges,
        @JsonIgnore WorkerReplay workerReplay) {
    public MatchReplayDTO(String result, UUID winnerUserId, String message, Integer batchSequence,
            Integer replayCursorElapsedMs, Boolean terminalBatch, Map<UUID, Integer> scores) {
        this(result, winnerUserId, message, batchSequence, replayCursorElapsedMs, terminalBatch,
                scores, null, null, null, null);
    }
    @JsonProperty("initialState") public Object wireInitialState() {
        return workerReplay == null || workerReplay.initialState() == null ? null
                : new RawValue(workerReplay.initialState());
    }
    @JsonProperty("frames") public Object wireFrames() {
        return new RawValue(workerReplay == null ? "[]" : workerReplay.frames());
    }
    public MatchReplayDTO withWorkerReplay(WorkerReplay replay) {
        return new MatchReplayDTO(result, winnerUserId, message, batchSequence, replayCursorElapsedMs,
                terminalBatch, roundWinsBeforeResult, ratingBefore, ratingAfter, ratingChanges, replay);
    }
    public MatchReplayDTO withRatingChange(Integer before, Integer after) {
        return new MatchReplayDTO(result, winnerUserId, message, batchSequence, replayCursorElapsedMs,
                terminalBatch, roundWinsBeforeResult, before, after, ratingChanges, workerReplay);
    }
    public MatchReplayDTO withRatingChanges(List<RatingChangeDTO> changes) {
        return new MatchReplayDTO(result, winnerUserId, message, batchSequence, replayCursorElapsedMs,
                terminalBatch, roundWinsBeforeResult, ratingBefore, ratingAfter,
                changes == null || changes.isEmpty() ? null : List.copyOf(changes), workerReplay);
    }
    public static MatchReplayDTO from(MatchPlaybackDTO result) {
        return result == null ? null : new MatchReplayDTO(result.result(), result.winnerUserId(),
                result.message(), null, null, true, null);
    }
    public record RatingChangeDTO(String username, Integer before, Integer after) {}
}
