package com.example.botfight.support;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.simulation.WorkerResult;
import java.util.List;

/** A simulation worker for Spring-level tests: the real rules run in sim-worker and are tested there. */
public final class WorkerStub {
    private WorkerStub() {}

    /** A worker that answers every duel with an empty draw and every puzzle as failed at the time limit. */
    public static SimWorkerClient answering() {
        SimWorkerClient worker = mock(SimWorkerClient.class);
        when(worker.simulate(any())).thenReturn(new WorkerResult("test", drawReplay(), null));
        when(worker.simulatePuzzle(any(), any())).thenReturn(
                new WorkerResult("test", drawReplay(), new WorkerResult.PuzzleResult("failed", 0)));
        return worker;
    }

    private static MatchReplayDTO drawReplay() {
        return new MatchReplayDTO(
                new MatchReplayDTO.ReplayInitialStateDTO(List.of()),
                List.of(),
                "DRAW",
                null,
                "The fight ended in a draw.",
                null,
                null,
                null);
    }
}
