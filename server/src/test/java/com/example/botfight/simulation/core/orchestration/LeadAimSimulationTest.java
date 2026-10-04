package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
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

/** Submitted lead-aim JSON reaches the authoritative executor; old brains are unchanged. */
class LeadAimSimulationTest {
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

    private JsonNode faceBrain(String aimFields) {
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":[]},
                     "roots":[{"priority":1,"branches":[{"priority":1,"branchType":"if",
                       "conditions":[{"type":"always"}],
                       "actions":[{"action":"rotate_toward_enemy","selectable":"opponent"%s}],"children":[]}]}]}
                    """.formatted(aimFields));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private JsonNode runnerBrain() {
        try {
            // Walks due south (compass 180) every tick.
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":[]},
                     "roots":[{"priority":1,"branches":[{"priority":1,"branchType":"if",
                       "conditions":[{"type":"always"}],
                       "actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":180}],"children":[]}]}]}
                    """);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private double rotationAfter(JsonNode attackerBrain, int durationMs) {
        MatchPlaybackDTO result = service.simulate(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("lead".getBytes()), DuelSimulationService.DUEL_RULESET_VERSION, 9L,
                new DuelArenaRequest(1200, 1200, durationMs),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 300, 300,
                                90.0, 60, "custom", attackerBrain, null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, 900, 300,
                                270.0, 60, "custom", runnerBrain(), null, 2))));
        return result.frames().getLast().bots().stream().filter(bot -> bot.slot() == 1).findFirst().orElseThrow().rotation();
    }

    @Test
    void leadAimTurnsFurtherAheadOfAMovingTargetAndLegacyBrainsAreUnchanged() {
        double current = rotationAfter(faceBrain(""), 300);
        double explicitCurrent = rotationAfter(faceBrain(",\"aim\":\"current\",\"leadSeconds\":2"), 300);
        double lead = rotationAfter(faceBrain(",\"aim\":\"lead\",\"leadSeconds\":2"), 300);
        double malformed = rotationAfter(faceBrain(",\"aim\":\"nonsense\",\"leadSeconds\":\"x\""), 300);
        assertThat(explicitCurrent).isEqualTo(current);
        assertThat(malformed).isEqualTo(current);
        // The target runs south, so leading it turns the bot further clockwise (larger compass bearing).
        assertThat(lead).isGreaterThan(current);
        // Out-of-range lead seconds are bounded to the same value as the maximum.
        assertThat(rotationAfter(faceBrain(",\"aim\":\"lead\",\"leadSeconds\":99"), 300)).isEqualTo(lead);
    }

    @Test
    void autoLeadUsesTheChosenAbility() {
        double current = rotationAfter(faceBrain(""), 300);
        double auto = rotationAfter(faceBrain(",\"aim\":\"auto\",\"leadAbilityId\":3"), 300);
        assertThat(auto).isGreaterThan(current);
        // An unknown ability falls back to current aim.
        assertThat(rotationAfter(faceBrain(",\"aim\":\"auto\",\"leadAbilityId\":9999"), 300)).isEqualTo(current);
    }
}
