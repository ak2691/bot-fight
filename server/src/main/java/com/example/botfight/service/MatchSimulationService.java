package com.example.botfight.service;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.ModelSubmission;
import com.example.botfight.simulation.ArenaUnits;
import com.example.botfight.simulation.DuelSimulationService;
import com.example.botfight.simulation.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelFighterRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.service.MatchService.MatchPlayer;
import com.example.botfight.service.MatchService.MatchSession;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchSimulationService {

    public static final String DUEL_RULESET_VERSION = "duel-v1";
    private static final int ARENA_WIDTH_UNITS = ArenaUnits.WIDTH;
    private static final int ARENA_HEIGHT_UNITS = ArenaUnits.HEIGHT;
    private static final int FIGHTER_SIZE = 60;
    // Temporary short replay window for testing: the simulator includes the
    // zero-millisecond frame, so 0..4,900 ms is exactly 50 100 ms ticks.
    private static final int SIMULATION_DURATION_MS = 4_900;
    private static final double SLOT_ONE_X = ARENA_WIDTH_UNITS / 2.0;
    private static final double SLOT_ONE_Y = ARENA_HEIGHT_UNITS * 0.15;
    private static final double SLOT_TWO_X = ARENA_WIDTH_UNITS / 2.0;
    private static final double SLOT_TWO_Y = ARENA_HEIGHT_UNITS * 0.85;

    private final JsonMapper jsonMapper;
    private final DuelSimulationService duelSimulationService;

    public MatchSimulationService(JsonMapper jsonMapper, DuelSimulationService duelSimulationService) {
        this.jsonMapper = jsonMapper;
        this.duelSimulationService = duelSimulationService;
    }

    public MatchPlaybackDTO buildDuelPlayback(
            MatchSession session,
            Map<UUID, ModelSubmission> submissionsByUserId) {
        try {
            DuelSimulationRequest request = toRequest(session, submissionsByUserId);
            return duelSimulationService.simulate(request);
        } catch (Exception ex) {
            return failedPlayback(session, "Bot simulation failed: " + ex.getClass().getSimpleName());
        }
    }

    public List<MatchPlaybackDTO.ObstaclePlacementDTO> buildMatchObstacles(MatchSession session) {
        return List.of();
    }

    private DuelSimulationRequest toRequest(
            MatchSession session,
            Map<UUID, ModelSubmission> submissionsByUserId) {
        List<DuelFighterRequest> fighters = session.players().stream()
                .map(player -> toFighterRequest(player, submissionsByUserId.get(player.userId())))
                .toList();
        return new DuelSimulationRequest(
                session.matchId(),
                DUEL_RULESET_VERSION,
                session.simulationSeed(),
                new DuelArenaRequest(ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS, SIMULATION_DURATION_MS, List.of()),
                fighters);
    }

    private DuelFighterRequest toFighterRequest(MatchPlayer player, ModelSubmission submission) {
        return new DuelFighterRequest(
                player.userId(),
                player.username(),
                player.slot(),
                player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                player.slot() == 1 ? 180.0 : 0.0,
                FIGHTER_SIZE,
                hasText(submission != null ? submission.getSelectedClass() : null)
                        ? submission.getSelectedClass()
                        : hasText(player.selectedClass()) ? player.selectedClass() : "melee",
                readBrain(submission));
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private JsonNode readBrain(ModelSubmission submission) {
        if (submission == null || submission.getBrainPayload() == null || submission.getBrainPayload().isBlank()) {
            return jsonMapper.createObjectNode();
        }
        try {
            return jsonMapper.readTree(submission.getBrainPayload());
        } catch (Exception ex) {
            return jsonMapper.createObjectNode();
        }
    }

    private MatchPlaybackDTO failedPlayback(MatchSession session, String message) {
        List<MatchPlaybackDTO.FighterPlacementDTO> fighters = session.players().stream()
                .map(player -> new MatchPlaybackDTO.FighterPlacementDTO(
                        player.userId(),
                        player.username(),
                        player.slot(),
                        player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                        player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                        player.slot() == 1 ? 90 : 270,
                        100,
                        hasText(player.selectedClass()) ? player.selectedClass() : "melee",
                        false,
                        false,
                        null,
                        null))
                .toList();
        return new MatchPlaybackDTO(
                session.matchId(),
                DUEL_RULESET_VERSION,
                "FAILED",
                new MatchPlaybackDTO.ArenaStateDTO(
                        ARENA_WIDTH_UNITS,
                        ARENA_HEIGHT_UNITS,
                        fighters,
                        session.obstacles() != null ? session.obstacles() : List.of()),
                List.of(),
                "ERROR",
                null,
                message);
    }

}
