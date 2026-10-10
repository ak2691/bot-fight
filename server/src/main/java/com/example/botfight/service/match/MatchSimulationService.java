package com.example.botfight.service.match;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Objects;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.simulation.geometry.ArenaUnits;
import com.example.botfight.service.simulation.SimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelArenaRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelBotRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.SegmentBotRequest;
import com.example.botfight.service.simulation.SimulationRequest.SegmentRequest;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import com.example.botfight.service.simulation.SimWorkerClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchSimulationService {

    public static final String DUEL_RULESET_VERSION = "duel-v2";
    private static final int ARENA_WIDTH_UNITS = ArenaUnits.WIDTH;
    private static final int ARENA_HEIGHT_UNITS = ArenaUnits.HEIGHT;
    private static final int BOT_SIZE = 60;
    // A timed-rounds match is six 20 second segments of one continuous fight.
    public static final int SEGMENT_DURATION_MS = MatchTimingPolicy.SEGMENT_SECONDS * 1_000;
    public static final int SIMULATION_DURATION_MS = ClosingZoneConfig.timedRoundsV2().simulationDurationMs();
    private static final double TEAM_ONE_Y = ArenaUnits.SPAWN_EDGE_MARGIN;
    private static final double TEAM_TWO_Y = ARENA_HEIGHT_UNITS - ArenaUnits.SPAWN_EDGE_MARGIN;
    private final JsonMapper jsonMapper;
    private final SimWorkerClient worker;

    public MatchSimulationService(JsonMapper jsonMapper, SimWorkerClient worker) {
        this.worker = Objects.requireNonNull(worker);
        this.jsonMapper = jsonMapper;
    }

    /**
     * Simulates the current round's 20 second segment. The server re-runs the whole match from tick 0
     * with the original seed, swapping each player's brain, loadout and variable resets in at the start
     * of each round's segment, and records only the segment of {@code session.roundNumber()}. Nothing is
     * snapshotted: a finished match re-simulates exactly from the seed and the stored rounds.
     *
     * @param submissionsByRound every round up to and including the current one, by round and user
     */
    public MatchReplayDTO buildDuelReplay(
            MatchSession session,
            Map<Integer, Map<UUID, BotSubmission>> submissionsByRound) {
        try {
            DuelSimulationRequest request = toSegmentRequest(session, submissionsByRound);
            var replay = worker.simulate(request, null);
            return new MatchReplayDTO(replay.result().outcome(),
                    winnerForTeam(session, replay.result().winnerTeam()), "Worker simulation completed.",
                    null, replay.durationMs(), true, null).withWorkerReplay(replay);
        } catch (Exception ex) {
            return failedReplay("Bot simulation failed: " + ex.getClass().getSimpleName());
        }
    }

    private UUID winnerForTeam(MatchSession session, Integer team) {
        return team == null ? null : session.players().stream().filter(player -> player.teamNumber() == team)
                .map(MatchPlayer::userId).findFirst().orElseThrow();
    }

    private DuelSimulationRequest toSegmentRequest(
            MatchSession session,
            Map<Integer, Map<UUID, BotSubmission>> submissionsByRound) {
        int rounds = session.roundNumber();
        Map<UUID, BotSubmission> firstRound = submissionsByRound.getOrDefault(1, Map.of());
        List<DuelBotRequest> bots = session.players().stream()
                .map(player -> toBotRequest(session, player, firstRound.get(player.userId())))
                .toList();
        List<SegmentRequest> segments = new ArrayList<>();
        segments.add(new SegmentRequest(SEGMENT_DURATION_MS, List.of()));
        Map<UUID, BotSubmission> latest = new HashMap<>(firstRound);
        for (int round = 2; round <= rounds; round++) {
            Map<UUID, BotSubmission> thisRound = submissionsByRound.getOrDefault(round, Map.of());
            List<SegmentBotRequest> updates = new ArrayList<>();
            for (MatchPlayer player : session.players()) {
                // A round with no stored brain keeps the player's last one, so replays stay deterministic.
                BotSubmission submission = thisRound.getOrDefault(player.userId(), latest.get(player.userId()));
                if (submission == null) continue;
                latest.put(player.userId(), submission);
                updates.add(new SegmentBotRequest(
                        player.slot(),
                        submission.getSelectedLoadout(),
                        readBrain(player, submission),
                        thisRound.containsKey(player.userId()) ? submission.getVariableResets() : List.of()));
            }
            segments.add(new SegmentRequest(round * SEGMENT_DURATION_MS, updates));
        }
        // The engine's final scheduled boundary defines the match horizon. Future boundaries carry
        // no brain updates and are never executed when recording the current segment.
        for (int round = rounds + 1; round <= SimulationRequest.MAX_SEGMENTS; round++) {
            segments.add(new SegmentRequest(round * SEGMENT_DURATION_MS, List.of()));
        }
        return new DuelSimulationRequest(
                session.matchId(),
                DUEL_RULESET_VERSION,
                session.simulationSeed(),
                new DuelArenaRequest(ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS, SIMULATION_DURATION_MS),
                bots,
                segments,
                (rounds - 1) * SEGMENT_DURATION_MS);
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
                Integer ability = AbilityCatalog.idForCode(String.valueOf(parts[1].charAt(index)));
                if (ability != null) abilities.add(ability);
            }
        }
        return brain;
    }

    private MatchReplayDTO failedReplay(String message) {
        return new MatchReplayDTO("ERROR", null, message, null, null, true, null);
    }

    private SpawnPosition spawnPosition(MatchSession session, MatchPlayer player) {
        // Slots are assigned in deterministic team order. Spread members of a
        // team across its spawn row so 2v2 and future bounded XvX matches do
        // not overlap at the center while preserving the old 1v1 center spawn.
        List<MatchPlayer> teamPlayers = session.players().stream()
                .filter(candidate -> candidate.teamNumber() == player.teamNumber())
                .sorted(Comparator.comparingInt(MatchPlayer::slot))
                .toList();
        int teamSize = Math.max(1, teamPlayers.size());
        int teamIndex = Math.max(0, teamPlayers.indexOf(player));
        double x = ARENA_WIDTH_UNITS * (teamIndex + 1.0) / (teamSize + 1.0);
        boolean teamOne = player.teamNumber() == 1;
        return new SpawnPosition(x, teamOne ? TEAM_ONE_Y : TEAM_TWO_Y, teamOne ? 180.0 : 0.0);
    }

    private record SpawnPosition(double x, double y, double rotation) {}

}
