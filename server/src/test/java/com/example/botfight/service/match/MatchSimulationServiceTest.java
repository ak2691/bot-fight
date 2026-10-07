package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.state.BotStateService;
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
                List.of(),
                Map.of());
        BotSubmission firstSubmission = new BotSubmission();
        firstSubmission.setBrainPayload("""
                {"version":"bot-logic-tree-v1","roots":[{"priority":1,"branches":[{"priority":1,"branchType":"if","actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"conditions":[],"children":[]}]}]}
                """);

        MatchPlaybackDTO playback = service.buildDuelPlayback(session, Map.of(firstUserId, firstSubmission));

        assertThat(playback.status()).isEqualTo("COMPLETED");
        assertThat(duelSimulationService.capturedRequest).isNotNull();
        assertThat(duelSimulationService.capturedRequest.matchId()).isEqualTo(session.matchId());
        assertThat(duelSimulationService.capturedRequest.seed()).isEqualTo(99L);
        assertThat(duelSimulationService.capturedRequest.arena().durationMs()).isEqualTo(90_000);
        assertThat(duelSimulationService.capturedRequest.bots()).hasSize(2);
        assertThat(duelSimulationService.capturedRequest.bots().getFirst().x()).isEqualTo(600.0);
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
                                "custom:p", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
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
                .containsExactlyInAnyOrder(1, 19);
        assertThat(playback.initialState().bots().getFirst().maxHp()).isEqualTo(300);
        assertThat(playback.initialState().bots().getFirst().abilityCooldowns().getOrDefault(1, 0)).isZero();
        assertThat(playback.initialState().bots().getFirst().abilityCooldowns()).doesNotContainKey(2);
        assertThat(playback.initialState().bots().getLast().abilities())
                .containsExactlyInAnyOrder(12, 19);
        assertThat(playback.initialState().bots().getLast().abilityCharges()).containsEntry(12, 10);
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
                List.of(),
                Map.of());

        MatchPlaybackDTO playback = service.buildPreparationPlayback(session);

        assertThat(playback.initialState().bots().getFirst().abilities())
                .containsExactlyInAnyOrder(10, 19);
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
                        org.assertj.core.groups.Tuple.tuple(400.0, 150.0),
                        org.assertj.core.groups.Tuple.tuple(800.0, 150.0),
                        org.assertj.core.groups.Tuple.tuple(400.0, 1050.0),
                        org.assertj.core.groups.Tuple.tuple(800.0, 1050.0));
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
                List.of(),
                Map.of());

        MatchPlaybackDTO playback = service.buildPreparationPlayback(session);

        assertThat(playback.initialState().bots().getFirst().abilities())
                .containsExactly(19, 12, 1, 3, 13);
    }

    private static BotSubmission brainSubmission(String loadout, List<String> variableResets, String marker) {
        BotSubmission submission = new BotSubmission();
        submission.setSelectedLoadout(loadout);
        submission.setBrainPayload("{\"version\":\"bot-logic-tree-v1\",\"marker\":\"" + marker
                + "\",\"loadout\":{\"abilities\":[1]},\"roots\":[]}");
        submission.setVariableResets(variableResets);
        return submission;
    }

    @Test
    void buildsTheSegmentRequestFromEveryRoundsStoredBrainsAndRecordsOnlyTheCurrentSegment() {
        CapturingDuelSimulationService duelSimulationService = new CapturingDuelSimulationService();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), duelSimulationService);
        UUID firstUserId = UUID.nameUUIDFromBytes("seg-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("seg-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("seg-match".getBytes()),
                77L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, true, UUID.randomUUID(), 0, "custom:s", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0, "custom:s", true)),
                Instant.now(), Instant.now(), Instant.now(), Instant.now(),
                3,
                List.of(),
                Map.of());
        Map<Integer, Map<UUID, BotSubmission>> rounds = Map.of(
                1, Map.of(firstUserId, brainSubmission("custom:s", List.of(), "one-r1"),
                        secondUserId, brainSubmission("custom:s", List.of(), "two-r1")),
                2, Map.of(firstUserId, brainSubmission("custom:sr", List.of("custom.a"), "one-r2")),
                3, Map.of(firstUserId, brainSubmission("custom:srg", List.of("Counter", "custom.b"), "one-r3"),
                        secondUserId, brainSubmission("custom:sf", List.of(), "two-r3")));

        MatchReplayDTO replay = service.buildDuelReplay(session, rounds);

        assertThat(replay).isNotNull();
        DuelSimulationRequest request = duelSimulationService.capturedRequest;
        assertThat(request.rulesetVersion()).isEqualTo("duel-v2");
        assertThat(request.seed()).isEqualTo(77L);
        // Only round 3's segment is recorded; the first two are re-simulated from tick 0.
        assertThat(request.recordFromMs()).isEqualTo(40_000);
        assertThat(request.segments()).extracting(DuelSimulationService.SegmentRequest::endsAtMs)
                .containsExactly(20_000, 40_000, 60_000);
        // Segment 1 is the request's own bots, from round 1.
        assertThat(request.segments().getFirst().bots()).isEmpty();
        assertThat(request.bots()).extracting(bot -> bot.brain().path("marker").asText())
                .containsExactly("one-r1", "two-r1");
        // Round 2: only the first player submitted a new brain, so the second keeps theirs (no swap needed).
        var second = request.segments().get(1).bots();
        assertThat(second).extracting(DuelSimulationService.SegmentBotRequest::slot).containsExactly(1, 2);
        assertThat(second.get(0).brain().path("marker").asText()).isEqualTo("one-r2");
        assertThat(second.get(0).variableResets()).containsExactly("custom.a");
        assertThat(second.get(1).brain().path("marker").asText()).isEqualTo("two-r1");
        assertThat(second.get(1).variableResets()).isEmpty();
        // Round 3 carries each player's own resets.
        var third = request.segments().get(2).bots();
        assertThat(third.get(0).brain().path("marker").asText()).isEqualTo("one-r3");
        assertThat(third.get(0).variableResets()).containsExactly("Counter", "custom.b");
        assertThat(third.get(1).brain().path("marker").asText()).isEqualTo("two-r3");
        assertThat(third.get(0).selectedLoadout()).isEqualTo("custom:srg");
    }

    @Test
    void roundOneRecordsTheFirstSegmentOnly() {
        CapturingDuelSimulationService duelSimulationService = new CapturingDuelSimulationService();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), duelSimulationService);
        UUID firstUserId = UUID.nameUUIDFromBytes("one-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("one-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("one-match".getBytes()), 5L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, true, UUID.randomUUID(), 0, "custom:s", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0, "custom:s", true)),
                Instant.now(), Instant.now(), Instant.now(), Instant.now(), 1, List.of(), Map.of());

        service.buildDuelReplay(session, Map.of(1, Map.of(
                firstUserId, brainSubmission("custom:s", List.of(), "a"),
                secondUserId, brainSubmission("custom:s", List.of(), "b"))));

        assertThat(duelSimulationService.capturedRequest.recordFromMs()).isZero();
        assertThat(duelSimulationService.capturedRequest.segments()).hasSize(1);
        assertThat(duelSimulationService.capturedRequest.segments().getFirst().endsAtMs()).isEqualTo(20_000);
    }

    private DuelSimulationService duelSimulationService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actionExecutionService = new ActionExecutionService(botStateService);
        ConditionResolutionService conditionResolutionService = new ConditionResolutionService(new ConditionEvaluationService(), actionExecutionService);
        return new DuelSimulationService(conditionResolutionService, new ReplayMappingService(),
                botStateService, actionExecutionService);
    }

    private static final class CapturingDuelSimulationService extends DuelSimulationService {
        private DuelSimulationRequest capturedRequest;
        private CapturingDuelSimulationService() {
            super(serviceConditions(), new ReplayMappingService(), serviceBotState(),
                    serviceActions());
        }

        private static GameConfigCatalog serviceCatalog() {
            return new GameConfigCatalog();
        }

        private static BotStateService serviceBotState() {
            return new BotStateService(serviceCatalog(), new BotCodeService());
        }

        private static ActionExecutionService serviceActions() {
            return new ActionExecutionService(serviceBotState());
        }

        private static ConditionResolutionService serviceConditions() {
            return new ConditionResolutionService(new ConditionEvaluationService(), serviceActions());
        }

        @Override
        public MatchReplayDTO simulateCompact(DuelSimulationRequest request) {
            capturedRequest = request;
            return new MatchReplayDTO(
                    new MatchReplayDTO.ReplayInitialStateDTO(List.of()), List.of(), "CONTINUES", null,
                    "The fight continues.", null, null, null, null);
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
