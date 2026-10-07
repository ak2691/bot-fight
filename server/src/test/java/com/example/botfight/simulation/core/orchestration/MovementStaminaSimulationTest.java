package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Submitted brains reach the authoritative executor through the real brain -> plan -> execution path. */
class MovementStaminaSimulationTest {
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

    private JsonNode brain(String abilities, String roots) {
        try {
            return jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"loadout\":{\"abilities\":" + abilities
                    + "},\"roots\":" + roots + "}");
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String root(int priority, String conditions, String actions) {
        return "{\"priority\":" + priority + ",\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":["
                + conditions + "],\"actions\":[" + actions + "],\"children\":[]}]}";
    }

    private static final String ALWAYS = "{\"type\":\"always\"}";
    private static final String USE_SNIPER = "{\"action\":3,\"selectable\":\"opponent\"}";
    private static final String CANCEL = "{\"action\":\"cancel_windup\"}";
    private static final String CANCEL_CONDITIONS =
            "{\"type\":\"expression\",\"left\":\"bot.selectedAbilityPreparing\",\"ability\":3,\"selectable\":\"my_bot\",\"leftSelectable\":\"my_bot\",\"comparator\":\"eq\",\"right\":{\"type\":\"boolean\",\"value\":true}},"
                    + "{\"type\":\"expression\",\"left\":\"bot.selectedAbilityPreparationMs\",\"ability\":3,\"selectable\":\"my_bot\",\"leftSelectable\":\"my_bot\",\"comparator\":\"lt\",\"right\":{\"type\":\"number\",\"value\":0.4}}";

    private MatchPlaybackDTO simulate(JsonNode first, int durationMs) {
        return service.simulate(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("stamina-match".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 11L,
                new DuelArenaRequest(1200, 1200, durationMs),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 300, 600,
                                90.0, 60, "custom", first, null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, 900, 600,
                                270.0, 60, "custom", brain("[]", "[]"), null, 2))));
    }

    private static MatchPlaybackDTO.BotStateDTO first(MatchPlaybackDTO.ReplayFrameDTO frame) {
        return frame.bots().stream().filter(bot -> bot.slot() == 1).findFirst().orElseThrow();
    }

    @Test
    void cancelWindupFiresEvenWhenAHigherPriorityRootUsesTheWindingUpAbility() {
        for (JsonNode brain : List.of(
                brain("[3]", "[" + root(1, ALWAYS, USE_SNIPER) + "," + root(2, CANCEL_CONDITIONS, CANCEL) + "]"),
                brain("[3]", "[" + root(1, CANCEL_CONDITIONS, CANCEL) + "," + root(2, ALWAYS, USE_SNIPER) + "]"))) {
            MatchPlaybackDTO result = simulate(brain, 1_200);
            var frames = result.frames();
            assertThat(first(frames.get(0)).preparingMs()).isEqualTo(800);
            assertThat(first(frames.get(5)).preparingMs()).isEqualTo(300);
            var cancelled = first(frames.get(6));
            assertThat(cancelled.preparingAbility()).isNull();
            assertThat(cancelled.stamina()).isEqualTo(75);
            assertThat(cancelled.triggeredAbility()).isNull();
            assertThat(cancelled.abilityCooldowns().getOrDefault(3, 0)).isZero();
            // Nothing blocks the ability: it starts winding up again on the next tick.
            assertThat(first(frames.get(7)).preparingAbility()).isEqualTo(3);
            assertThat(first(frames.get(7)).stamina()).isEqualTo(75);
        }
    }

    @Test
    void aCancelRootThatIsTrueWhileNotWindingUpDoesNotBlockALowerPriorityAbility() {
        MatchPlaybackDTO result = simulate(
                brain("[3]", "[" + root(1, ALWAYS, CANCEL) + "," + root(2, ALWAYS, USE_SNIPER) + "]"), 300);
        var firstTick = first(result.frames().get(0));
        assertThat(firstTick.preparingAbility()).isEqualTo(3);
        assertThat(firstTick.stamina()).isEqualTo(100);
    }

    @Test
    void sprintFlagReachesTheExecutorAndOldBrainsAreUnchanged() {
        String walkEast = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90%s}";
        MatchPlaybackDTO plain = simulate(brain("[]", "[" + root(1, ALWAYS, walkEast.formatted("")) + "]"), 500);
        MatchPlaybackDTO off = simulate(brain("[]", "[" + root(1, ALWAYS, walkEast.formatted(",\"sprint\":false")) + "]"), 500);
        MatchPlaybackDTO bad = simulate(brain("[]", "[" + root(1, ALWAYS, walkEast.formatted(",\"sprint\":\"yes\"")) + "]"), 500);
        MatchPlaybackDTO sprint = simulate(brain("[]", "[" + root(1, ALWAYS, walkEast.formatted(",\"sprint\":true")) + "]"), 500);
        for (int tick = 0; tick < plain.frames().size(); tick += 1) {
            assertThat(first(off.frames().get(tick)).x()).isEqualTo(first(plain.frames().get(tick)).x());
            assertThat(first(bad.frames().get(tick)).x()).isEqualTo(first(plain.frames().get(tick)).x());
            assertThat(first(plain.frames().get(tick)).stamina()).isEqualTo(100);
        }
        double start = 300;
        double walked = first(plain.frames().getLast()).x() - start;
        double sprinted = first(sprint.frames().getLast()).x() - start;
        assertThat(sprinted).isEqualTo(walked * 1.5);
        assertThat(first(sprint.frames().get(0)).stamina()).isEqualTo(97);
        assertThat(first(sprint.frames().get(4)).stamina()).isEqualTo(85);
    }

    @Test
    void staminaConditionsReadMyBotAndTheOpponent() {
        String lowStamina = "{\"type\":\"expression\",\"left\":\"bot.stamina\",\"leftSelectable\":\"my_bot\",\"selectable\":\"my_bot\",\"comparator\":\"lt\",\"right\":{\"type\":\"number\",\"value\":90}}";
        String walkEast = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90}";
        String sprintEast = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90,\"sprint\":true}";
        // Sprint until stamina drops below 90, then walk: sprinting is read back through the variable.
        String roots = "[" + root(1, lowStamina, walkEast) + "," + root(2, ALWAYS, sprintEast) + "]";
        MatchPlaybackDTO result = simulate(brain("[]", roots), 800);
        var frames = result.frames();
        assertThat(first(frames.get(0)).stamina()).isEqualTo(97);
        assertThat(first(frames.get(3)).stamina()).isEqualTo(88);
        // Tick 5 sees stamina 88 (< 90) and walks: no drain, no bonus.
        double before = first(frames.get(3)).x();
        assertThat(first(frames.get(4)).stamina()).isEqualTo(88);
        assertThat(first(frames.get(4)).x() - before).isEqualTo(15.0);
    }

    @Test
    void compactReplayFramesCarryStaminaAndSprinting() {
        String sprintEast = "{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90,\"sprint\":true}";
        MatchReplayDTO replay = service.simulateCompact(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("stamina-replay".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 11L,
                new DuelArenaRequest(1200, 1200, 1_400),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 100, 600,
                                90.0, 60, "custom", brain("[]", "[" + root(1, ALWAYS, sprintEast) + "]"), null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, 1100, 600,
                                270.0, 60, "custom", brain("[]", "[]"), null, 2))));
        var frames = replay.frames();
        assertThat(frames.get(0).bots().get(0).stamina()).isEqualTo(97);
        assertThat(frames.get(0).bots().get(0).sprinting()).isTrue();
        // 100 / 3 = 34 sprint ticks to empty; the opponent never spends and stays full and quiet.
        assertThat(frames.get(0).bots().get(1).stamina()).isEqualTo(100);
        assertThat(frames.get(0).bots().get(1).sprinting()).isNull();
        // Compact frames keep the same integer stamina the authoritative state holds.
        assertThat(frames.get(8).bots().get(0).stamina()).isEqualTo(100 - 3 * 9);
    }

    @Test
    void anAlwaysDashBrainChainsOnStaminaAndTheGapThroughTheRealExecutor() {
        String dash = "{\"action\":19,\"movementMode\":\"absolute\",\"movementDirection\":90}";
        MatchPlaybackDTO result = simulate(brain("[]", "[" + root(1, ALWAYS, dash) + "]"), 1_600);
        var frames = result.frames();
        // Dash at ticks 0, 4 and 8 (30 stamina each, one per 300 ms gap); a fourth needs 30 and only 10 is left.
        assertThat(first(frames.get(0)).stamina()).isEqualTo(70);
        assertThat(first(frames.get(3)).stamina()).isEqualTo(70);
        assertThat(first(frames.get(4)).stamina()).isEqualTo(40);
        assertThat(first(frames.get(7)).stamina()).isEqualTo(40);
        assertThat(first(frames.get(8)).stamina()).isEqualTo(10);
        for (int tick = 9; tick <= 12; tick += 1) assertThat(first(frames.get(tick)).stamina()).isLessThan(30);
        // Dash never carries a fixed cooldown.
        for (var frame : frames) assertThat(first(frame).abilityCooldowns().getOrDefault(19, 0)).isZero();
    }
}
