package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.service.MatchService.MatchPlayer;
import com.example.botfight.service.MatchService.MatchSession;
import com.example.botfight.simulation.DuelSimulationService;
import com.example.botfight.simulation.ActionExecutionService;
import com.example.botfight.simulation.ConditionResolutionService;
import com.example.botfight.simulation.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.BotStateService;
import com.example.botfight.simulation.ProjectileSimulationService;
import com.example.botfight.simulation.ReplayMappingService;
import com.example.botfight.simulation.bot.BotCodeService;
import com.example.botfight.simulation.bot.ConditionEvaluationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
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
                List.of(),
                Map.of());
        BotSubmission firstSubmission = new BotSubmission();
        firstSubmission.setBrainPayload("""
                {"version":"bot-logic-tree-v1","roots":[{"createdOrder":0,"branches":[{"createdOrder":0,"branchType":"if","actions":[{"action":"move_walk","movementMode":"target","movementDirection":"toward"}],"conditions":[],"children":[]}]}]}
                """);

        MatchPlaybackDTO playback = service.buildDuelPlayback(session, Map.of(firstUserId, firstSubmission));

        assertThat(playback.status()).isEqualTo("COMPLETED");
        assertThat(duelSimulationService.capturedRequest).isNotNull();
        assertThat(duelSimulationService.capturedRequest.matchId()).isEqualTo(session.matchId());
        assertThat(duelSimulationService.capturedRequest.seed()).isEqualTo(99L);
        assertThat(duelSimulationService.capturedRequest.arena().durationMs()).isEqualTo(60_000);
        assertThat(duelSimulationService.capturedRequest.bots()).hasSize(2);
        assertThat(duelSimulationService.capturedRequest.bots().getFirst().x()).isEqualTo(500.0);
        assertThat(duelSimulationService.capturedRequest.bots().getFirst().y()).isEqualTo(150.0);
        assertThat(duelSimulationService.capturedRequest.bots().getFirst().brain().get("roots")).hasSize(1);
    }

    @Test
    void preparationPlaybackUsesAuthoritativeBotIdsLoadoutsAndCooldownState() {
        MatchSimulationService service = new MatchSimulationService(
                new JsonMapper(),
                duelSimulationService());
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
        assertThat(playback.initialState().bots()).hasSize(2);
        assertThat(playback.initialState().bots())
                .extracting(MatchPlaybackDTO.BotStateDTO::userId)
                .containsExactly(firstUserId, secondUserId);
        assertThat(playback.initialState().bots().getFirst().abilities())
                .containsExactlyInAnyOrder(2, 1, 19, 20);
        assertThat(playback.initialState().bots().getFirst().maxHp()).isEqualTo(120);
        assertThat(playback.initialState().bots().getFirst().abilityCooldowns().getOrDefault(1, 0)).isZero();
        assertThat(playback.initialState().bots().getFirst().abilityCooldowns().getOrDefault(2, 0)).isZero();
        assertThat(playback.initialState().bots().getLast().abilities())
                .containsExactlyInAnyOrder(3, 19, 20);
        assertThat(playback.initialState().bots().getLast().abilityCharges()).containsEntry(3, 10);
    }

    @Test
    void preparationPlaybackDecodesCompactEAsBasicHeal() {
        MatchSimulationService service = new MatchSimulationService(
                new JsonMapper(),
                duelSimulationService());
        UUID firstUserId = UUID.nameUUIDFromBytes("compact-heal-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("compact-heal-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("compact-heal-match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "Healer", "healer", 1, true, UUID.randomUUID(), 0,
                                "custom:e:0,0,0,0", true),
                        new MatchPlayer(secondUserId, "Opponent", "opponent", 2, true, UUID.randomUUID(), 0,
                                "custom:s:0,0,0,0", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(),
                Map.of());

        MatchPlaybackDTO playback = service.buildPreparationPlayback(session);

        assertThat(playback.initialState().bots().getFirst().abilities())
                .containsExactlyInAnyOrder(10, 19, 20);
    }

    private DuelSimulationService duelSimulationService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ProjectileSimulationService projectileSimulationService = new ProjectileSimulationService(botStateService);
        ActionExecutionService actionExecutionService = new ActionExecutionService(botStateService, projectileSimulationService);
        ConditionResolutionService conditionResolutionService = new ConditionResolutionService(new ConditionEvaluationService(), actionExecutionService);
        return new DuelSimulationService(conditionResolutionService, new ReplayMappingService(),
                botStateService, projectileSimulationService, actionExecutionService);
    }

    private static final class CapturingDuelSimulationService extends DuelSimulationService {
        private DuelSimulationRequest capturedRequest;
        private CapturingDuelSimulationService() {
            super(serviceConditions(), new ReplayMappingService(), serviceBotState(),
                    serviceProjectiles(), serviceActions());
        }

        private static GameConfigCatalog serviceCatalog() {
            return new GameConfigCatalog();
        }

        private static BotStateService serviceBotState() {
            return new BotStateService(serviceCatalog(), new BotCodeService());
        }

        private static ProjectileSimulationService serviceProjectiles() {
            return new ProjectileSimulationService(serviceBotState());
        }

        private static ActionExecutionService serviceActions() {
            return new ActionExecutionService(serviceBotState(), serviceProjectiles());
        }

        private static ConditionResolutionService serviceConditions() {
            return new ConditionResolutionService(new ConditionEvaluationService(), serviceActions());
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

    }
}
