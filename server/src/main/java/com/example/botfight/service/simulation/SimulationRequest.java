package com.example.botfight.service.simulation;

import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** Spring-to-worker transport types; gameplay execution belongs to shared/engine. */
public final class SimulationRequest {
    private SimulationRequest() {}
    public static final String DUEL_RULESET_VERSION = "duel-v3";
    public static final int MAX_SEGMENTS = 6;
    public static final int MAX_SIMULATION_BOTS = 8;
    public record DuelSimulationRequest(
            UUID matchId,
            String rulesetVersion,
            long seed,
            DuelArenaRequest arena,
            List<DuelBotRequest> bots,
            List<SegmentRequest> segments,
            Integer recordFromMs) {
        public DuelSimulationRequest(
                UUID matchId,
                String rulesetVersion,
                long seed,
                DuelArenaRequest arena,
                List<DuelBotRequest> bots) {
            this(matchId, rulesetVersion, seed, arena, bots, null, null);
        }
    }

    /**
     * One timed-rounds segment: it ends at {@code endsAtMs} of the match and starts where the previous
     * one ended. The first segment's bots are the request's bots; later segments swap in the listed
     * bots' brain at their boundary.
     */
    public record SegmentRequest(int endsAtMs, List<SegmentBotRequest> bots) {
    }

    /**
     * A bot's brain schedule entry. {@code variableResets} names the custom variables (by id or name)
     * to reset to their declared default instead of keeping their last value.
     */
    public record SegmentBotRequest(int slot, String selectedLoadout, JsonNode brain, List<String> variableResets) {
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
