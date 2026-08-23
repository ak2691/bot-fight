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
import com.example.botfight.service.submission.LegacyAbilityPayloadMigration;
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
                .map(player -> toBotRequest(player, submissionsByUserId.get(player.userId())))
                .toList();
        return new DuelSimulationRequest(
                session.matchId(),
                DUEL_RULESET_VERSION,
                session.simulationSeed(),
                new DuelArenaRequest(ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS, SIMULATION_DURATION_MS),
                bots);
    }

    private DuelBotRequest toBotRequest(MatchPlayer player, BotSubmission submission) {
        return new DuelBotRequest(
                player.userId(),
                player.username(),
                player.slot(),
                player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                player.slot() == 1 ? 180.0 : 0.0,
                BOT_SIZE,
                hasText(submission != null ? submission.getSelectedLoadout() : null)
                        ? submission.getSelectedLoadout()
                        : hasText(player.selectedLoadout()) ? player.selectedLoadout() : "melee",
                readBrain(player, submission));
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private JsonNode readBrain(MatchPlayer player, BotSubmission submission) {
        if (submission != null && submission.getBrainPayload() != null && !submission.getBrainPayload().isBlank()) {
            try {
                return LegacyAbilityPayloadMigration.normalize(jsonMapper.readTree(submission.getBrainPayload()));
            } catch (Exception exception) {
                throw new IllegalStateException("Persisted bot brain could not be normalized", exception);
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
                .map(player -> new MatchPlaybackDTO.BotStateDTO(
                        player.userId(),
                        player.username(),
                        player.slot(),
                        player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                        player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                        player.slot() == 1 ? 90 : 270,
                        DEFAULT_BOT_HP,
                        DEFAULT_BOT_HP,
                        hasText(player.selectedLoadout()) ? player.selectedLoadout() : "melee",
                        List.of(),
                        List.of(),
                        Map.of(), Map.of(), Map.of(), Map.of(),
                        null, null, 0, 0,
                        player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                        player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                        0, 0))
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
                .map(player -> new MatchReplayDTO.ReplayBotStaticDTO(
                        player.slot(),
                        player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                        player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                        player.slot() == 1 ? 90.0 : 270.0,
                        DEFAULT_BOT_HP,
                        DEFAULT_BOT_HP))
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

}
