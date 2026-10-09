package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SegmentBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SegmentRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.example.botfight.simulation.core.state.LegacyAbility;

/**
 * Timed rounds: a match is one continuous simulation with a brain schedule. Each segment boundary swaps
 * brains, loadouts and custom variables and ends a running chain, while everything else carries over.
 */
class SegmentedSimulationTest {
    private static final int WALL_MS = 1_000;
    private final JsonMapper jsonMapper = new JsonMapper();
    private final DuelSimulationService service = newService();

    private static DuelSimulationService newService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actions = new ActionExecutionService(botStateService);
        return new DuelSimulationService(
                new ConditionResolutionService(new ConditionEvaluationService(), actions),
                new ReplayMappingService(), botStateService, actions);
    }

    // ---- request helpers -------------------------------------------------------------------------

    private JsonNode brain(String abilities, String roots) {
        return brain(abilities, "[]", roots, "[]");
    }

    private JsonNode brain(String abilities, String customVariables, String roots, String chains) {
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":%s},
                     "customVariables":%s,"roots":%s,"chains":%s}
                    """.formatted(abilities, customVariables, roots, chains));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** One always-true action under a single root. */
    private String always(String actionJson) {
        return """
                [{"priority":1,"branches":[{"branchType":"if","priority":1,"conditions":[{"type":"always"}],
                  "actions":[%s],"children":[]}]}]
                """.formatted(actionJson);
    }

    private static final String WALK_EAST = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90}";
    private static final String WALK_WEST = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":270}";
    private static final String SPRINT_EAST = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90,\"sprint\":true}";
    private static final String SLASH = "{\"action\":\"rotate_toward_enemy\",\"selectable\":\"opponent_1\"},{\"action\":1,\"selectable\":\"opponent_1\"}";

    private DuelBotRequest bot(int slot, double x, double y, JsonNode brain) {
        return new DuelBotRequest(UUID.nameUUIDFromBytes(("bot" + slot).getBytes()), "bot" + slot, slot, x, y,
                slot == 1 ? 90.0 : 270.0, 60, "custom", brain, null, slot);
    }

    private SegmentRequest first(int endsAtMs) {
        return new SegmentRequest(endsAtMs, List.of());
    }

    private SegmentRequest swap(int endsAtMs, int slot, JsonNode brain, String... variableResets) {
        return new SegmentRequest(endsAtMs, List.of(new SegmentBotRequest(slot, "custom", brain, List.of(variableResets))));
    }

    private DuelSimulationRequest segmented(List<DuelBotRequest> bots, List<SegmentRequest> segments, Integer recordFromMs) {
        return new DuelSimulationRequest(UUID.nameUUIDFromBytes("match".getBytes()),
                DuelSimulationService.DUEL_RULESET_VERSION, 11L, new DuelArenaRequest(1200, 1200, 0),
                bots, segments, recordFromMs);
    }

    /** Per-tick observation of the first bot, keyed by the elapsed time of the tick that just ran. */
    private record Seen(int elapsedMs, double x, double y, double hp, int stamina, boolean sprinting,
                        Integer preparingAbility, int preparingMs, Integer triggeredAbility,
                        java.util.Map<Integer, Integer> cooldowns, java.util.Set<Integer> abilities,
                        java.util.Map<String, Object> variables, java.util.Map<String, String> variableTypes,
                        int chainDepth) {}

    private List<Seen> observe(DuelSimulationRequest request) {
        List<Seen> seen = new ArrayList<>();
        service.simulateWithoutReplay(request, (elapsedMs, bots, entities, arena) -> {
            Bot bot = bots.get(0);
            seen.add(new Seen(elapsedMs, bot.x, bot.y, bot.hp, bot.stamina, bot.sprinting, LegacyAbility.preparingAbility(bot),
                    LegacyAbility.preparingMs(bot), bot.triggeredAbility, new java.util.HashMap<>(com.example.botfight.simulation.core.state.AbilityState.legacyCooldowns(bot)),
                    new java.util.LinkedHashSet<>(bot.abilities), new java.util.HashMap<>(bot.customVariables),
                    new java.util.HashMap<>(bot.customVariableTypes), bot.chainStack.size()));
            return false;
        });
        return seen;
    }

    private static Seen at(List<Seen> seen, int elapsedMs) {
        return seen.stream().filter(entry -> entry.elapsedMs() == elapsedMs).findFirst().orElseThrow();
    }

    // ---- tests -----------------------------------------------------------------------------------

    @Test
    void aSegmentIsIdenticalWhetherProducedAloneOrReSimulatedAfterTheLaterSegments() {
        JsonNode idle = brain("[]", "[]");
        JsonNode approach = brain("[]", always(WALK_EAST));
        JsonNode armed = brain("[1]", always(SLASH));
        JsonNode sprinting = brain("[1]", always(SPRINT_EAST));
        List<DuelBotRequest> bots = List.of(bot(1, 300, 600, idle), bot(2, 800, 600, idle));
        List<SegmentRequest> all = List.of(
                first(20_000),
                swap(40_000, 1, approach),
                swap(60_000, 1, armed),
                swap(80_000, 1, sprinting),
                swap(100_000, 1, armed),
                swap(120_000, 1, sprinting));

        MatchReplayDTO atRoundSix = service.simulateCompact(segmented(bots, all, 60_000));
        MatchReplayDTO alone = service.simulateCompact(segmented(bots, all.subList(0, 4), 60_000));
        MatchReplayDTO whole = service.simulateCompact(segmented(bots, all, null));

        assertThat(atRoundSix.frames()).isNotEmpty();
        assertThat(atRoundSix.initialState()).isEqualTo(alone.initialState());
        assertThat(atRoundSix.frames()).isEqualTo(alone.frames());
        // The recorded window is the same slice of the uninterrupted run, with frames relative to its start.
        int ticksBefore = 600;
        for (int index = 0; index < atRoundSix.frames().size(); index += 1) {
            MatchReplayDTO.ReplayFrameDTO windowed = atRoundSix.frames().get(index);
            MatchReplayDTO.ReplayFrameDTO uninterrupted = whole.frames().get(ticksBefore + index);
            assertThat(windowed.elapsedMs()).isEqualTo((index + 1) * 100);
            assertThat(windowed.bots()).isEqualTo(uninterrupted.bots());
            assertThat(windowed.entities()).isEqualTo(uninterrupted.entities());
        }
        assertThat(atRoundSix.frames().size()).isLessThanOrEqualTo(200);
    }

    @Test
    void aBrainSwapTakesEffectExactlyAtTheBoundaryTick() {
        JsonNode east = brain("[]", always(WALK_EAST));
        JsonNode west = brain("[]", always(WALK_WEST));
        List<Seen> seen = observe(segmented(
                List.of(bot(1, 600, 600, east), bot(2, 100, 100, brain("[]", "[]"))),
                List.of(first(WALL_MS), swap(2 * WALL_MS, 1, west)), null));

        for (int elapsedMs = 100; elapsedMs <= WALL_MS; elapsedMs += 100) {
            assertThat(at(seen, elapsedMs).x()).isGreaterThan(at(seen, elapsedMs - 100 > 0 ? elapsedMs - 100 : 100).x() - 1e-9);
        }
        assertThat(at(seen, WALL_MS).x()).isGreaterThan(at(seen, 100).x());
        // The first tick after the boundary already runs the new brain.
        assertThat(at(seen, WALL_MS + 100).x()).isLessThan(at(seen, WALL_MS).x());
        assertThat(at(seen, 2 * WALL_MS).x()).isLessThan(at(seen, WALL_MS).x());
    }

    @Test
    void customVariablesKeepResetAndDropAtTheBoundary() {
        String bumps = always("""
                {"action":"variable","variableId":"custom.keep","terms":[{"operator":"add","operand":{"type":"number","value":1}}]},
                {"action":"variable","variableId":"custom.reset","terms":[{"operator":"add","operand":{"type":"number","value":1}}]},
                {"action":"variable","variableId":"custom.named","terms":[{"operator":"add","operand":{"type":"number","value":1}}]},
                {"action":"variable","variableId":"custom.retyped","terms":[{"operator":"add","operand":{"type":"number","value":1}}]},
                {"action":"variable","variableId":"custom.gone","terms":[{"operator":"add","operand":{"type":"number","value":1}}]}
                """);
        JsonNode before = brain("[]", """
                [{"id":"custom.keep","name":"Keep","valueType":"number","initialValue":5},
                 {"id":"custom.reset","name":"Reset","valueType":"number","initialValue":7},
                 {"id":"custom.named","name":"Named","valueType":"number","initialValue":2},
                 {"id":"custom.retyped","name":"Retyped","valueType":"number","initialValue":3},
                 {"id":"custom.gone","name":"Gone","valueType":"number","initialValue":4}]
                """, bumps, "[]");
        JsonNode after = brain("[]", """
                [{"id":"custom.keep","name":"Keep","valueType":"number","initialValue":5},
                 {"id":"custom.reset","name":"Reset","valueType":"number","initialValue":7},
                 {"id":"custom.named","name":"Named","valueType":"number","initialValue":2},
                 {"id":"custom.retyped","name":"Retyped","valueType":"boolean","initialValue":true},
                 {"id":"custom.fresh","name":"Fresh","valueType":"number","initialValue":9}]
                """, "[]", "[]");
        List<Seen> seen = observe(segmented(
                List.of(bot(1, 600, 600, before), bot(2, 100, 100, brain("[]", "[]"))),
                List.of(first(300), swap(600, 1, after, "custom.reset", "Named")), null));

        java.util.Map<String, Object> beforeBoundary = at(seen, 300).variables();
        assertThat(beforeBoundary).containsEntry("custom.keep", 8.0).containsEntry("custom.reset", 10.0)
                .containsEntry("custom.gone", 7.0);

        Seen boundary = at(seen, 400);
        assertThat(boundary.variables())
                .containsEntry("custom.keep", 8.0)         // same name and type, not reset: keeps its value
                .containsEntry("custom.reset", 7.0)        // reset by id: its declared default
                .containsEntry("custom.named", 2.0)        // reset by name: its declared default
                .containsEntry("custom.retyped", true)     // type changed: the new default
                .containsEntry("custom.fresh", 9.0)        // new: its default
                .doesNotContainKey("custom.gone");         // no longer declared: dropped
        assertThat(boundary.variableTypes()).containsEntry("custom.retyped", "boolean").doesNotContainKey("custom.gone");
    }

    @Test
    void aNewAbilityStartsReadyAndEverythingInPlayCarriesAcrossTheBoundary() {
        JsonNode slashing = brain("[1]", always(SLASH));
        JsonNode slashingWithFireball = brain("[1,5]", always(SLASH));
        List<DuelBotRequest> base = List.of(bot(1, 600, 600, slashing), bot(2, 600, 690, brain("[]", "[]")));

        // A control run keeps the same brain throughout; the swapped run only adds an ability.
        List<Seen> control = observe(segmented(base, List.of(first(2_000)), null));
        List<Seen> swapped = observe(segmented(base,
                List.of(first(1_000), swap(2_000, 1, slashingWithFireball)), null));

        for (int elapsedMs = 100; elapsedMs <= 2_000; elapsedMs += 100) {
            Seen expected = at(control, elapsedMs);
            Seen actual = at(swapped, elapsedMs);
            assertThat(actual.hp()).as("hp at %d", elapsedMs).isEqualTo(expected.hp());
            assertThat(actual.x()).as("x at %d", elapsedMs).isEqualTo(expected.x());
            assertThat(actual.triggeredAbility()).as("triggered at %d", elapsedMs).isEqualTo(expected.triggeredAbility());
            assertThat(actual.cooldowns().getOrDefault(1, 0)).as("slash cooldown at %d", elapsedMs)
                    .isEqualTo(expected.cooldowns().getOrDefault(1, 0));
        }
        // The cooldown being carried across is a real, running one.
        assertThat(at(swapped, 1_000).cooldowns().getOrDefault(1, 0)
                + at(swapped, 900).cooldowns().getOrDefault(1, 0)
                + at(swapped, 800).cooldowns().getOrDefault(1, 0)).isGreaterThan(0);
        assertThat(at(swapped, 1_000).abilities()).doesNotContain(5);
        Seen boundary = at(swapped, 1_100);
        assertThat(boundary.abilities()).contains(1, 5);
        assertThat(boundary.cooldowns().getOrDefault(5, 0)).isZero();
    }

    @Test
    void staminaCarriesAcrossTheBoundary() {
        JsonNode sprint = brain("[]", always(SPRINT_EAST));
        JsonNode sprintAgain = brain("[]", always(SPRINT_EAST));
        List<DuelBotRequest> base = List.of(bot(1, 100, 600, sprint), bot(2, 100, 100, brain("[]", "[]")));
        List<Seen> control = observe(segmented(base, List.of(first(1_500)), null));
        List<Seen> swapped = observe(segmented(base, List.of(first(700), swap(1_500, 1, sprintAgain)), null));

        assertThat(at(swapped, 700).stamina()).isLessThan(100);
        assertThat(at(swapped, 800).stamina()).isLessThan(at(swapped, 700).stamina() + 1);
        for (int elapsedMs = 100; elapsedMs <= 1_500; elapsedMs += 100) {
            assertThat(at(swapped, elapsedMs).stamina()).as("stamina at %d", elapsedMs)
                    .isEqualTo(at(control, elapsedMs).stamina());
            assertThat(at(swapped, elapsedMs).sprinting()).isEqualTo(at(control, elapsedMs).sprinting());
        }
    }

    @Test
    void aWindUpInProgressFinishesAfterTheBrainThatStartedItIsGone() {
        JsonNode aiming = brain("[3]", always("{\"action\":3,\"selectable\":\"opponent_1\"}"));
        JsonNode idle = brain("[3]", "[]");
        List<Seen> seen = observe(segmented(
                List.of(bot(1, 600, 300, aiming), bot(2, 600, 900, brain("[]", "[]"))),
                List.of(first(500), swap(2_000, 1, idle)), null));

        assertThat(at(seen, 500).preparingAbility()).isEqualTo(3);
        Seen afterBoundary = at(seen, 600);
        assertThat(afterBoundary.preparingAbility()).isEqualTo(3);
        assertThat(afterBoundary.preparingMs()).isGreaterThan(0);
        // The idle brain never fires it again, so the only release is the carried wind-up.
        assertThat(seen.stream().filter(entry -> entry.elapsedMs() > 500)
                .anyMatch(entry -> Integer.valueOf(3).equals(entry.triggeredAbility()))).isTrue();
    }

    @Test
    void aRunningChainEndsAtTheBoundary() {
        String chains = """
                [{"id":"chain.hold","name":"hold","steps":[{"type":"wait","forMs":5000}]}]
                """;
        JsonNode running = brain("[]", "[]",
                always("{\"action\":\"run_chain\",\"chainId\":\"chain.hold\"}"), chains);
        JsonNode plain = brain("[]", "[]", "[]", chains);
        List<Seen> seen = observe(segmented(
                List.of(bot(1, 600, 600, running), bot(2, 100, 100, brain("[]", "[]"))),
                List.of(first(500), swap(1_500, 1, plain)), null));

        assertThat(at(seen, 100).chainDepth()).isEqualTo(1);
        assertThat(at(seen, 500).chainDepth()).isEqualTo(1);
        assertThat(at(seen, 600).chainDepth()).isZero();
        assertThat(at(seen, 1_500).chainDepth()).isZero();
    }

    @Test
    void aKnockoutMidSegmentEndsTheRun() {
        JsonNode idle = brain("[]", "[]");
        JsonNode slashing = brain("[1]", always(SLASH));
        // The defender starts wounded so the knockout lands inside the second segment.
        List<DuelBotRequest> bots = List.of(bot(1, 600, 600, idle), new DuelBotRequest(
                UUID.nameUUIDFromBytes("bot2".getBytes()), "bot2", 2, 600, 680, 270.0, 60, "custom", idle, 50.0, 2));
        List<SegmentRequest> segments = List.of(first(20_000), swap(40_000, 1, slashing), swap(60_000, 1, slashing));

        MatchPlaybackDTO result = service.simulate(segmented(bots, segments, null));

        assertThat(result.result()).isEqualTo("BOT_WIN");
        assertThat(result.winnerUserId()).isEqualTo(UUID.nameUUIDFromBytes("bot1".getBytes()));
        int lastElapsed = result.frames().getLast().elapsedMs();
        assertThat(lastElapsed).isGreaterThan(20_000).isLessThan(40_000);
        assertThat(result.frames().getLast().bots().get(1).hp()).isZero();

        // Asking for a later segment after the fight is already over leaves nothing to replay.
        MatchReplayDTO afterwards = service.simulateCompact(segmented(bots, segments, 40_000));
        assertThat(afterwards.result()).isEqualTo("BOT_WIN");
        assertThat(afterwards.frames()).isEmpty();
    }

    @Test
    void aSegmentThatEndsWithoutAKnockoutSaysTheFightContinues() {
        JsonNode idle = brain("[]", "[]");
        List<DuelBotRequest> bots = List.of(bot(1, 300, 600, idle), bot(2, 900, 600, idle));
        List<SegmentRequest> segments = List.of(first(20_000), swap(40_000, 1, idle));

        MatchReplayDTO firstSegment = service.simulateCompact(segmented(bots, segments, 0));
        assertThat(firstSegment.frames()).hasSize(200);
        assertThat(firstSegment.result()).isEqualTo(DuelSimulationService.SEGMENT_CONTINUES);
        // The last segment is not a continuation: with no knockout it ends as today's timeout does.
        MatchReplayDTO lastSegment = service.simulateCompact(segmented(bots, segments, 20_000));
        assertThat(lastSegment.frames()).hasSize(200);
        assertThat(lastSegment.result()).isEqualTo("DRAW");
        assertThat(service.simulateCompact(segmented(bots, segments, null)).result()).isEqualTo("DRAW");
    }

    @Test
    void theClosingZoneOnlyAppearsInRoundsFiveAndSix() {
        JsonNode idle = brain("[]", "[]");
        List<SegmentRequest> segments = new ArrayList<>();
        segments.add(first(20_000));
        for (int end = 40_000; end <= 120_000; end += 20_000) segments.add(swap(end, 1, idle));
        MatchPlaybackDTO result = service.simulate(segmented(
                List.of(bot(1, 600, 560, idle), bot(2, 600, 640, idle)), segments, null));

        assertThat(result.frames()).hasSize(1_200);
        List<MatchPlaybackDTO.ReplayFrameDTO> withZone = result.frames().stream()
                .filter(frame -> frame.entities().stream().anyMatch(entity -> "closingZone".equals(entity.type())))
                .toList();
        assertThat(withZone.getFirst().elapsedMs()).isEqualTo(80_000);
        assertThat(zoneSize(result, 80_000)).isEqualTo(1_200);
        assertThat(zoneSize(result, 85_000)).isEqualTo(900);
        assertThat(zoneSize(result, 100_000)).isEqualTo(900);
        assertThat(zoneSize(result, 105_000)).isEqualTo(600);
        assertThat(zoneSize(result, 120_000)).isEqualTo(600);
    }

    private static int zoneSize(MatchPlaybackDTO result, int elapsedMs) {
        return result.frames().stream().filter(frame -> frame.elapsedMs() == elapsedMs).findFirst().orElseThrow()
                .entities().stream().filter(entity -> "closingZone".equals(entity.type())).findFirst().orElseThrow().size();
    }

    @Test
    void theSingleSegmentPathKeepsItsZoneAndNinetySecondCap() {
        JsonNode idle = brain("[]", "[]");
        DuelSimulationRequest tooLong = new DuelSimulationRequest(UUID.randomUUID(),
                DuelSimulationService.DUEL_RULESET_VERSION, 1L, new DuelArenaRequest(1200, 1200, 95_000),
                List.of(bot(1, 300, 600, idle), bot(2, 900, 600, idle)));
        assertThatThrownBy(() -> service.simulate(tooLong)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("90 second");

        MatchPlaybackDTO plain = service.simulate(new DuelSimulationRequest(UUID.randomUUID(),
                DuelSimulationService.DUEL_RULESET_VERSION, 1L, new DuelArenaRequest(1200, 1200, 16_000),
                List.of(bot(1, 600, 560, idle), bot(2, 600, 640, idle))));
        // duel-v1 starts its zone at 15 s, not the timed-rounds 80 s.
        assertThat(plain.frames().stream().anyMatch(frame -> frame.elapsedMs() == 15_000
                && frame.entities().stream().anyMatch(entity -> "closingZone".equals(entity.type())))).isTrue();
    }

    @Test
    void hostileSegmentSchedulesAreRejected() {
        JsonNode idle = brain("[]", "[]");
        List<DuelBotRequest> bots = List.of(bot(1, 300, 600, idle), bot(2, 900, 600, idle));
        Consumer<List<SegmentRequest>> run = segments -> service.simulateCompact(segmented(bots, segments, null));

        assertThatThrownBy(() -> run.accept(List.of(first(20_000), first(20_000)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> run.accept(List.of(first(20_000), first(40_000), first(60_000), first(80_000),
                first(100_000), first(120_000), first(140_000)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> run.accept(List.of(first(20_050)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> run.accept(List.of(first(20_000), first(60_000)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> run.accept(List.of(first(20_000), swap(40_000, 9, idle)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> run.accept(List.of(swap(20_000, 1, idle)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> run.accept(List.of(first(20_000), swap(40_000, 1, idle, repeat("x", 101)))))
                .isInstanceOf(IllegalArgumentException.class);
        List<SegmentRequest> seven = new ArrayList<>();
        for (int index = 1; index <= 7; index += 1) seven.add(first(index * 1_000));
        assertThatThrownBy(() -> run.accept(seven)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.simulateCompact(segmented(bots, List.of(first(20_000), first(40_000)), 5_000)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static String[] repeat(String value, int times) {
        String[] result = new String[times];
        java.util.Arrays.fill(result, value);
        return result;
    }
}
