package com.example.botfight.service.match.simulation;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.simulation.geometry.ArenaUnits;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
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
    private static final int BOT_SIZE = 60;
    private static final int DEFAULT_BOT_HP = 150;
    // Rated rounds run until HP damage ends them or the arena's hard cap is reached.
    public static final int SIMULATION_DURATION_MS = ClosingZoneConfig.duelV1().simulationDurationMs();
    private static final double TEAM_ONE_Y = ArenaUnits.SPAWN_EDGE_MARGIN;
    private static final double TEAM_TWO_Y = ARENA_HEIGHT_UNITS - ArenaUnits.SPAWN_EDGE_MARGIN;
    private final JsonMapper jsonMapper;
    private final DuelSimulationService duelSimulationService;

    public MatchSimulationService(JsonMapper jsonMapper, DuelSimulationService duelSimulationService) {
        this.jsonMapper = jsonMapper;
        this.duelSimulationService = duelSimulationService;
    }

    public MatchPlaybackDTO buildDuelPlayback(
            MatchSession session,
            Map<UUID, BotSubmission> submissionsByUserId) {
        try {
            DuelSimulationRequest request = toRequest(session, submissionsByUserId);
            return duelSimulationService.simulate(request);
        } catch (Exception ex) {
            return failedPlayback(session, "Bot simulation failed: " + ex.getClass().getSimpleName());
        }
    }

    /**
     * Builds the production replay directly in its compact presentation form.
     * The authoritative simulator still keeps full mutable bot state while it
     * runs, but no full per-tick playback DTO is retained.
     */
    public MatchReplayDTO buildDuelReplay(
            MatchSession session,
            Map<UUID, BotSubmission> submissionsByUserId) {
        try {
            DuelSimulationRequest request = toRequest(session, submissionsByUserId);
            return duelSimulationService.simulateCompact(request);
        } catch (Exception ex) {
            return failedReplay(session, "Bot simulation failed: " + ex.getClass().getSimpleName());
        }
    }

    public MatchPlaybackDTO buildPreparationPlayback(MatchSession session) {
        try {
            DuelSimulationRequest request = toRequest(session, Map.of());
            MatchPlaybackDTO.ArenaStateDTO initialState = duelSimulationService.buildInitialState(request);
            return new MatchPlaybackDTO(
                    session.matchId(),
                    DUEL_RULESET_VERSION,
                    "PREPARING",
                    initialState,
                    List.of(),
                    null,
                    null,
                    "Preparing the authoritative round replay.");
        } catch (Exception ex) {
            return failedPlayback(session, "Bot preparation state failed: " + ex.getClass().getSimpleName());
        }
    }

    private DuelSimulationRequest toRequest(
            MatchSession session,
            Map<UUID, BotSubmission> submissionsByUserId) {
        List<DuelBotRequest> bots = session.players().stream()
                .map(player -> toBotRequest(session, player, submissionsByUserId.get(player.userId())))
                .toList();
        return new DuelSimulationRequest(
                session.matchId(),
                DUEL_RULESET_VERSION,
                session.simulationSeed(),
                new DuelArenaRequest(ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS, SIMULATION_DURATION_MS),
                bots);
    }

    private DuelBotRequest toBotRequest(MatchSession session, MatchPlayer player, BotSubmission submission) {
        SpawnPosition position = spawnPosition(session, player);
        return new DuelBotRequest(
                player.userId(),
                player.username(),
                player.slot(),
                position.x(),
                position.y(),
                position.rotation(),
                BOT_SIZE,
                hasText(submission != null ? submission.getSelectedLoadout() : null)
                        ? submission.getSelectedLoadout()
                        : hasText(player.selectedLoadout()) ? player.selectedLoadout() : "melee",
                readBrain(player, submission),
                null,
                player.teamNumber());
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private JsonNode readBrain(MatchPlayer player, BotSubmission submission) {
        if (submission != null && submission.getBrainPayload() != null && !submission.getBrainPayload().isBlank()) {
            try {
                return jsonMapper.readTree(submission.getBrainPayload());
            } catch (Exception exception) {
                throw new IllegalStateException("Persisted bot brain could not be read", exception);
            }
        }
        return readSelectedLoadoutBrain(player != null ? player.selectedLoadout() : null);
    }

    private JsonNode readSelectedLoadoutBrain(String selectedLoadout) {
        if (selectedLoadout == null || (!"custom".equals(selectedLoadout) && !selectedLoadout.startsWith("custom:"))) {
            return jsonMapper.createObjectNode();
        }
        String[] parts = selectedLoadout.split(":", -1);
        var brain = jsonMapper.createObjectNode();
        var loadout = brain.putObject("loadout");
        var abilities = loadout.putArray("abilities");
        boolean validEncoding = parts.length == 2;
        if (validEncoding) {
            for (int index = 0; index < parts[1].length(); index++) {
                Integer ability = CompactAbilityCode.idForCode(String.valueOf(parts[1].charAt(index)));
                if (ability != null) abilities.add(ability);
            }
        }
        return brain;
    }

    private MatchPlaybackDTO failedPlayback(MatchSession session, String message) {
        List<MatchPlaybackDTO.BotStateDTO> bots = session.players().stream()
                .map(player -> {
                    SpawnPosition position = spawnPosition(session, player);
                    return new MatchPlaybackDTO.BotStateDTO(
                        player.userId(),
                        player.username(),
                        player.slot(),
                        position.x(),
                        position.y(),
                        position.rotation(),
                        DEFAULT_BOT_HP,
                        DEFAULT_BOT_HP,
                        hasText(player.selectedLoadout()) ? player.selectedLoadout() : "melee",
                        List.of(),
                        List.of(),
                        Map.of(), Map.of(), Map.of(), Map.of(),
                        null, null, 0, 0,
                        position.x(),
                        position.y(),
                        0, 0,
                        player.teamNumber());
                })
                .toList();
        return new MatchPlaybackDTO(
                session.matchId(),
                DUEL_RULESET_VERSION,
                "FAILED",
                new MatchPlaybackDTO.ArenaStateDTO(
                        ARENA_WIDTH_UNITS,
                        ARENA_HEIGHT_UNITS,
                        bots,
                        List.of()),
                List.of(),
                "ERROR",
                null,
                message);
    }

    private MatchReplayDTO failedReplay(MatchSession session, String message) {
        List<MatchReplayDTO.ReplayBotStaticDTO> bots = session.players().stream()
                .map(player -> {
                    SpawnPosition position = spawnPosition(session, player);
                    return new MatchReplayDTO.ReplayBotStaticDTO(
                        player.slot(),
                        position.x(),
                        position.y(),
                        position.rotation(),
                        DEFAULT_BOT_HP,
                        DEFAULT_BOT_HP,
                        null, null, null, null, null,
                        player.teamNumber());
                })
                .toList();
        return new MatchReplayDTO(
                new MatchReplayDTO.ReplayInitialStateDTO(bots),
                List.of(),
                "ERROR",
                null,
                message,
                null,
                null,
                null);
    }

    private SpawnPosition spawnPosition(MatchSession session, MatchPlayer player) {
        // Slots are assigned in deterministic team order. Spread members of a
        // team across its spawn row so 2v2 and future bounded XvX matches do
        // not overlap at the center while preserving the old 1v1 center spawn.
        List<MatchPlayer> teamPlayers = session.players().stream()
                .filter(candidate -> candidate.teamNumber() == player.teamNumber())
                .sorted(java.util.Comparator.comparingInt(MatchPlayer::slot))
                .toList();
        int teamSize = Math.max(1, teamPlayers.size());
        int teamIndex = Math.max(0, teamPlayers.indexOf(player));
        double x = ARENA_WIDTH_UNITS * (teamIndex + 1.0) / (teamSize + 1.0);
        boolean teamOne = player.teamNumber() == 1;
        return new SpawnPosition(x, teamOne ? TEAM_ONE_Y : TEAM_TWO_Y, teamOne ? 180.0 : 0.0);
    }

    private record SpawnPosition(double x, double y, double rotation) {}

}
