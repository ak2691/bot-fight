package com.example.botfight.service.simulation;

import java.util.List;
import tools.jackson.databind.JsonNode;

/** Only metadata is interpreted by Spring; render payloads are retained verbatim. */
public record WorkerReplay(Result result, String initialState, List<Batch> batches) {
    public record TeamHp(int teamNumber, double hp) {}
    public record Result(String engineVersion, String outcome, String endReason, Integer winnerTeam,
                         List<TeamHp> teamHp, int segmentEndMs,
                         List<EndBotState> endState, String puzzleStatus) {}
    /** Frozen segment summary for the next-round preview and result presentation. */
    public record EndBotState(int slot, double x, double y, Double rotation, double hp, int teamNumber,
                              Integer stamina, Boolean sprinting, JsonNode runningChain) {}
    public record Batch(int sequence, int endMs, boolean terminal, String frames) {}

    public String frames() {
        return "[" + String.join(",", batches.stream()
                .map(batch -> batch.frames().substring(1, batch.frames().length() - 1))
                .filter(value -> !value.isBlank()).toList()) + "]";
    }
    public int durationMs() { return batches.isEmpty() ? 0 : batches.getLast().endMs(); }
}
