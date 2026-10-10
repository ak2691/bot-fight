package com.example.botfight.support;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.service.simulation.SimWorkerClient;
import java.util.List;
import tools.jackson.databind.JsonNode;

/** A worker for Spring tests: brain rules live in the shared engine and are tested there (and over HTTP in sim-worker). */
public final class WorkerStub {
    private WorkerStub() {}

    /** A worker whose brain rules accept every brain that reaches them (the schema still runs in Spring). */
    public static SimWorkerClient validating() {
        SimWorkerClient worker = mock(SimWorkerClient.class);
        when(worker.validateBrain(any(JsonNode.class), anyBoolean())).thenReturn(List.of());
        return worker;
    }
}
