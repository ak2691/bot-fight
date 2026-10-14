package com.example.botfight.service.simulation;

import com.example.botfight.DTO.match.MatchReplayDTO;

/**
 * A validated worker answer. {@code puzzle} is present only for puzzle attempts; the replay is the
 * authoritative match or puzzle replay exactly as the worker produced it.
 */
public record WorkerResult(String engineVersion, MatchReplayDTO replay, PuzzleResult puzzle) {

    /** The worker's puzzle verdict: {@code solved} or {@code failed}, and the elapsed time in ms. */
    public record PuzzleResult(String status, int elapsedMs) {
    }
}
