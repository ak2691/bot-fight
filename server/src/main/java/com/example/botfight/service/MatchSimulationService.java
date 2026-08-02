package com.example.botfight.service;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.BotSubmission;
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
    // Rated rounds run for a full minute unless HP damage ends them sooner.
    private static final int SIMULATION_DURATION_MS = 60_000;
    private static final double SLOT_ONE_X = ARENA_WIDTH_UNITS / 2.0;
    private static final double SLOT_ONE_Y = ARENA_HEIGHT_UNITS * 0.15;
    private static final double SLOT_TWO_X = ARENA_WIDTH_UNITS / 2.0;
    private static final double SLOT_TWO_Y = ARENA_HEIGHT_UNITS * 0.85;
    private static final Map<Character, String> ABILITY_BY_CODE = Map.ofEntries(
            Map.entry('s', "swing"), Map.entry('b', "block"), Map.entry('d', "dash"),
            Map.entry('g', "fire_gun"), Map.entry('r', "throw_grenade"), Map.entry('f', "shoot_fireball"),
            Map.entry('t', "stun"), Map.entry('h', "heavy_slash"), Map.entry('u', "repulsor_burst"),
            Map.entry('c', "concussive_shot"), Map.entry('e', "repair_pulse"), Map.entry('m', "proximity_mine"),
            Map.entry('j', "quick_jab"), Map.entry('p', "pistol_shot"), Map.entry('R', "rail_shot"),
            Map.entry('G', "gravity_grenade"), Map.entry('S', "silence_pulse"), Map.entry('A', "reactive_armor"),
            Map.entry('H', "hunter_drone"), Map.entry('T', "thrust"), Map.entry('M', "micro_dash"),
            Map.entry('w', "temporal_rewind"), Map.entry('o', "orbital_strike"), Map.entry('a', "absolute_guard"),
            Map.entry('n', "null_zone"), Map.entry('P', "phase_strike"));

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

    public List<MatchPlaybackDTO.ObstaclePlacementDTO> buildMatchObstacles(MatchSession session) {
        return List.of();
    }

    private DuelSimulationRequest toRequest(
            MatchSession session,
            Map<UUID, BotSubmission> submissionsByUserId) {
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

    private DuelFighterRequest toFighterRequest(MatchPlayer player, BotSubmission submission) {
        return new DuelFighterRequest(
                player.userId(),
                player.username(),
                player.slot(),
                player.slot() == 1 ? SLOT_ONE_X : SLOT_TWO_X,
                player.slot() == 1 ? SLOT_ONE_Y : SLOT_TWO_Y,
                player.slot() == 1 ? 180.0 : 0.0,
                FIGHTER_SIZE,
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
                return jsonMapper.readTree(submission.getBrainPayload());
            } catch (Exception ignored) {
                // A validated submission should already be parseable. Keep the
                // preparation path bounded if a legacy row is malformed.
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
        boolean validEncoding = parts.length == 3 && parts[2].split(",", -1).length == 4;
        if (validEncoding) {
            for (int index = 0; index < parts[1].length(); index++) {
                String ability = ABILITY_BY_CODE.get(parts[1].charAt(index));
                if (ability != null) abilities.add(ability);
            }
        }
        var statPoints = loadout.putObject("statPoints");
        String[] points = validEncoding ? parts[2].split(",", -1) : new String[0];
        for (int index = 0; index < 4; index++) {
            int value;
            try {
                value = Math.max(0, Math.min(12, Integer.parseInt(points[index])));
            } catch (NumberFormatException exception) {
                value = 0;
            }
            statPoints.put(List.of("maxHp", "moveSpeed", "attackDamage", "attackSpeed").get(index), value);
        }
        return brain;
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
                        hasText(player.selectedLoadout()) ? player.selectedLoadout() : "melee",
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
