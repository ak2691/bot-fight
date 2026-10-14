package com.example.botfight.service.simulation;

import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** Spring-to-worker transport types; gameplay execution belongs to shared/engine. */
public final class SimulationRequest {
    private SimulationRequest() {}
    public static final String DUEL_RULESET_VERSION = "duel-v1";
    public static final int MAX_SIMULATION_BOTS = 8;

    public record DuelSimulationRequest(
            UUID matchId,
            String rulesetVersion,
            long seed,
            DuelArenaRequest arena,
            List<DuelBotRequest> bots) {
    }

    /**
     * Puzzle rules for a worker puzzle attempt. The worker runs the bots' brains and reports whether the
     * win or lose conditions were met within the time limit.
     */
    public record PuzzleRequest(
            JsonNode logicConfiguration,
            JsonNode winConditions,
            JsonNode loseConditions,
            int timeLimitMs,
            int initialElapsedMs) {
    }

    public record DuelArenaRequest(
            int width,
            int height,
            int durationMs,
            int initialElapsedMs) {
        public DuelArenaRequest(int width, int height, int durationMs) {
            this(width, height, durationMs, 0);
        }
    }

    public record DuelBotRequest(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            Double rotation,
            int size,
            String selectedLoadout,
            JsonNode brain,
            Double initialHp,
            int teamNumber) {
        public DuelBotRequest(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                Double rotation,
                int size,
                String selectedLoadout,
                JsonNode brain,
                Double initialHp) {
            this(userId, username, slot, x, y, rotation, size, selectedLoadout, brain, initialHp, slot);
        }

        public DuelBotRequest(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                Double rotation,
                int size,
                String selectedLoadout,
                JsonNode brain) {
            this(userId, username, slot, x, y, rotation, size, selectedLoadout, brain, null, slot);
        }
    }

}
