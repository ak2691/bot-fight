package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

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
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Authoritative hit stamina refund through the real tick loop; mirrors the frontend StaminaRefund tests. */
class StaminaRefundSimulationTest {
    private static final int SLASH = 1;
    private static final int FIREBALL = 5;
    private static final double MAIN_Y = 600;
    private static final int PAUSED = 100_000;
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

    private record Sample(int stamina, int delay, double defenderHp) {}

    private JsonNode brain(int ability, boolean cast) {
        String root = cast
                ? "[{\"priority\":1,\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":[{\"type\":\"always\"}],"
                        + "\"actions\":[{\"action\":" + ability + ",\"selectable\":\"opponent_1\"}],\"children\":[]}]}]"
                : "[]";
        try {
            return jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"loadout\":{\"abilities\":["
                    + ability + "]},\"roots\":" + root + "}");
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** Samples the caster's stamina after every tick; after tick 0 its stamina is set to 40 with the pause held. */
    private List<Sample> run(int ability, double defenderX, int ticks) {
        List<Sample> samples = new ArrayList<>();
        service.simulateWithoutReplay(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("stamina-refund".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 7L,
                new DuelArenaRequest(1200, 1200, ticks * 100),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 300, MAIN_Y,
                                90.0, 60, "custom", brain(ability, true), null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, defenderX, MAIN_Y,
                                270.0, 60, "custom", brain(ability, false), null, 2))),
                (elapsedMs, bots, entities, arena) -> {
                    Bot main = bots.get(0);
                    if (samples.isEmpty()) {
                        main.stamina = 40;
                        main.staminaRegenDelayMs = PAUSED;
                    }
                    samples.add(new Sample(main.stamina, main.staminaRegenDelayMs, bots.get(1).hp));
                    return false;
                });
        return samples;
    }

    @Test
    void aSlashActivationPaysTenOnEachHitAndNeverTouchesThePause() {
        List<Sample> samples = run(SLASH, 380, 14);
        int refunds = 0;
        for (int tick = 1; tick < samples.size(); tick += 1) {
            Sample before = samples.get(tick - 1);
            Sample after = samples.get(tick);
            boolean damaged = after.defenderHp() < before.defenderHp();
            assertThat(after.stamina() - before.stamina()).as("tick %d", tick).isEqualTo(damaged ? 10 : 0);
            assertThat(before.delay() - after.delay()).as("pause at tick %d", tick).isEqualTo(100);
            if (damaged) refunds += 1;
        }
        assertThat(refunds).as("Slash lands again after its cooldown").isGreaterThanOrEqualTo(1);
    }

    @Test
    void aFireballPaysOnceForItsActivationAndBurnTicksPayNothing() {
        List<Sample> samples = run(FIREBALL, 800, 40);
        int impact = -1;
        for (int tick = 1; tick < samples.size(); tick += 1) {
            if (impact < 0 && samples.get(tick).defenderHp() < samples.get(tick - 1).defenderHp()) impact = tick;
        }
        assertThat(impact).isGreaterThan(1);
        assertThat(samples.get(impact - 1).stamina()).isEqualTo(40);
        assertThat(samples.get(impact).stamina()).isEqualTo(50);
        boolean burned = false;
        for (int tick = impact + 1; tick < samples.size(); tick += 1) {
            if (samples.get(tick).defenderHp() < samples.get(tick - 1).defenderHp()) burned = true;
            assertThat(samples.get(tick).stamina()).as("tick %d", tick).isEqualTo(50);
        }
        assertThat(burned).as("the burn keeps damaging after the impact").isTrue();
    }
}
