package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.service.MatchService.MatchPlayer;
import com.example.botfight.service.MatchService.MatchSession;
import com.example.botfight.simulation.DuelSimulationService;
import com.example.botfight.simulation.DuelSimulationService.DuelFighterRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.combat.CombatCatalog;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchSimulationServiceTest {

    @Test
    void buildsDuelRequestAndUsesInjectedJavaSimulationService() {
        CapturingDuelSimulationService duelSimulationService = new CapturingDuelSimulationService();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), duelSimulationService);
        UUID firstUserId = UUID.nameUUIDFromBytes("first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, true, UUID.randomUUID(), 0, "ranged", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0, "melee", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(
                        new MatchPlaybackDTO.ObstaclePlacementDTO("object_center", "radarJammer", 400.0, 400.0, 92),
                        new MatchPlaybackDTO.ObstaclePlacementDTO("object_1", "healthPack", 300.0, 120.0, 42, 0.0)),
                Map.of());
        BotSubmission firstSubmission = new BotSubmission();
        firstSubmission.setBrainPayload("""
                {"version":"melee-logic-blocks-v2","blocks":[{"action":"move_inward","conditions":[]}],"clusters":[]}
                """);

        MatchPlaybackDTO playback = service.buildDuelPlayback(session, Map.of(firstUserId, firstSubmission));

        assertThat(playback.status()).isEqualTo("COMPLETED");
        assertThat(duelSimulationService.capturedRequest).isNotNull();
        assertThat(duelSimulationService.capturedRequest.matchId()).isEqualTo(session.matchId());
        assertThat(duelSimulationService.capturedRequest.seed()).isEqualTo(99L);
        assertThat(duelSimulationService.capturedRequest.arena().durationMs()).isEqualTo(60_000);
        assertThat(duelSimulationService.capturedRequest.arena().obstacles()).isEmpty();
        assertThat(duelSimulationService.capturedRequest.fighters()).hasSize(2);
        assertThat(duelSimulationService.capturedRequest.fighters().getFirst().x()).isEqualTo(500.0);
        assertThat(duelSimulationService.capturedRequest.fighters().getFirst().y()).isEqualTo(150.0);
        assertThat(duelSimulationService.capturedRequest.fighters().getFirst().brain().get("blocks")).hasSize(1);
    }

    @Test
    void generatesMatchObstaclesFromAuthoritativeSimulator() {
        CapturingDuelSimulationService duelSimulationService = new CapturingDuelSimulationService();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), duelSimulationService);
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(UUID.nameUUIDFromBytes("first".getBytes()), "One", "one", 1, false, null, 0, "melee", false),
                        new MatchPlayer(UUID.nameUUIDFromBytes("second".getBytes()), "Two", "two", 2, false, null, 0, "melee", false)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                2,
                List.of(),
                Map.of());

        List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles = service.buildMatchObstacles(session);

        assertThat(obstacles).isEmpty();
    }

    @Test
    void preparationPlaybackUsesAuthoritativeFighterIdsLoadoutsAndCooldownState() {
        MatchSimulationService service = new MatchSimulationService(
                new JsonMapper(),
                new DuelSimulationService(new CombatCatalog()));
        UUID firstUserId = UUID.nameUUIDFromBytes("preparation-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("preparation-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("preparation-match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, true, UUID.randomUUID(), 0,
                                "custom:sb:2,1,0,0", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0,
                                "custom:g:0,0,0,0", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(),
                Map.of());

        MatchPlaybackDTO playback = service.buildPreparationPlayback(session);

        assertThat(playback.status()).isEqualTo("PREPARING");
        assertThat(playback.initialState().fighters()).hasSize(2);
        assertThat(playback.initialState().fighters())
                .extracting(MatchPlaybackDTO.FighterPlacementDTO::userId)
                .containsExactly(firstUserId, secondUserId);
        assertThat(playback.initialState().fighters().getFirst().abilities())
                .containsExactly("block", "swing");
        assertThat(playback.initialState().fighters().getFirst().maxHp()).isEqualTo(120);
        assertThat(playback.initialState().fighters().getFirst().swingCooldownMs()).isZero();
        assertThat(playback.initialState().fighters().getFirst().blockCooldownMs()).isZero();
        assertThat(playback.initialState().fighters().getLast().abilities())
                .containsExactly("fire_gun");
        assertThat(playback.initialState().fighters().getLast().gunAmmo()).isEqualTo(10);
    }

    private static final class CapturingDuelSimulationService extends DuelSimulationService {
        private DuelSimulationRequest capturedRequest;
        private List<MatchPlaybackDTO.ObstaclePlacementDTO> generatedObstacles = List.of();

        private CapturingDuelSimulationService() {
            super(new CombatCatalog());
        }

        @Override
        public MatchPlaybackDTO simulate(DuelSimulationRequest request) {
            capturedRequest = request;
            return new MatchPlaybackDTO(
                    request.matchId(),
                    DuelSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(1600, 1600, List.of(), List.of()),
                    List.of(),
                    "DRAW",
                    null,
                    "The fight ended in a draw.");
        }

        @Override
        public List<MatchPlaybackDTO.ObstaclePlacementDTO> createMatchObstaclePlacements(
                long seed,
                int arenaWidth,
                int arenaHeight,
                List<DuelFighterRequest> fighterRequests) {
            generatedObstacles = List.of(
                    new MatchPlaybackDTO.ObstaclePlacementDTO("object_1", "healthPack", 450.0, 120.0, 42));
            return generatedObstacles;
        }
    }
}
