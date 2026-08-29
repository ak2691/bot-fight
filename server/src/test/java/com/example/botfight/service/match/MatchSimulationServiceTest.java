package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.combat.ProjectileSimulationService;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
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
                {"version":"bot-logic-tree-v1","roots":[{"createdOrder":0,"branches":[{"createdOrder":0,"branchType":"if","actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"conditions":[],"children":[]}]}]}
                """);

        MatchPlaybackDTO playback = service.buildDuelPlayback(session, Map.of(firstUserId, firstSubmission));

        assertThat(playback.status()).isEqualTo("COMPLETED");
        assertThat(duelSimulationService.capturedRequest).isNotNull();
        assertThat(duelSimulationService.capturedRequest.matchId()).isEqualTo(session.matchId());
        assertThat(duelSimulationService.capturedRequest.seed()).isEqualTo(99L);
        assertThat(duelSimulationService.capturedRequest.arena().durationMs()).isEqualTo(90_000);
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
                                "custom:s", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0,
                                "custom:g", true)),
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
                .containsExactlyInAnyOrder(1, 19, 20, 34);
        assertThat(playback.initialState().bots().getFirst().maxHp()).isEqualTo(150);
        assertThat(playback.initialState().bots().getFirst().abilityCooldowns().getOrDefault(1, 0)).isZero();
        assertThat(playback.initialState().bots().getFirst().abilityCooldowns()).doesNotContainKey(2);
        assertThat(playback.initialState().bots().getLast().abilities())
                .containsExactlyInAnyOrder(3, 19, 20, 34);
        assertThat(playback.initialState().bots().getLast().abilityCharges()).containsEntry(3, 6);
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
                                "custom:e", true),
                        new MatchPlayer(secondUserId, "Opponent", "opponent", 2, true, UUID.randomUUID(), 0,
                                "custom:s", true)),
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
                .containsExactlyInAnyOrder(10, 19, 20, 34);
    }

    @Test
    void preparationPlaybackSpreadsTwoTeamsUsingStableSlots() {
        MatchSimulationService service = new MatchSimulationService(
                new JsonMapper(),
                duelSimulationService());
        UUID firstUserId = UUID.nameUUIDFromBytes("team-one-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("team-one-second".getBytes());
        UUID thirdUserId = UUID.nameUUIDFromBytes("team-two-first".getBytes());
        UUID fourthUserId = UUID.nameUUIDFromBytes("team-two-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("team-preparation-match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, 1, true, UUID.randomUUID(), 0, "melee", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, 1, true, UUID.randomUUID(), 0, "melee", true),
                        new MatchPlayer(thirdUserId, "Three", "three", 3, 2, true, UUID.randomUUID(), 0, "melee", true),
                        new MatchPlayer(fourthUserId, "Four", "four", 4, 2, true, UUID.randomUUID(), 0, "melee", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(),
                Map.of());

        MatchPlaybackDTO playback = service.buildPreparationPlayback(session);

        assertThat(playback.initialState().bots())
                .extracting(MatchPlaybackDTO.BotStateDTO::slot, MatchPlaybackDTO.BotStateDTO::teamNumber)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1, 1),
                        org.assertj.core.groups.Tuple.tuple(2, 1),
                        org.assertj.core.groups.Tuple.tuple(3, 2),
                        org.assertj.core.groups.Tuple.tuple(4, 2));
        assertThat(playback.initialState().bots())
                .extracting(MatchPlaybackDTO.BotStateDTO::x, MatchPlaybackDTO.BotStateDTO::y)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(333.333, 150.0),
                        org.assertj.core.groups.Tuple.tuple(666.667, 150.0),
                        org.assertj.core.groups.Tuple.tuple(333.333, 850.0),
                        org.assertj.core.groups.Tuple.tuple(666.667, 850.0));
    }

    @Test
    void preparationPlaybackKeepsDraftOrderAcrossRounds() {
        MatchSimulationService service = new MatchSimulationService(
                new JsonMapper(),
                duelSimulationService());
        UUID firstUserId = UUID.nameUUIDFromBytes("ordered-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("ordered-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("ordered-match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, true, UUID.randomUUID(), 0,
                                "custom:psgR", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0,
                                "custom:", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                2,
                1,
                List.of(),
                Map.of());

        MatchPlaybackDTO playback = service.buildPreparationPlayback(session);

        assertThat(playback.initialState().bots().getFirst().abilities())
                .containsExactly(19, 20, 34, 12, 1, 3, 13);
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
