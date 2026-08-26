package com.example.botfight.simulation.core.logic;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Operand;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SelectableSnapshot;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.combat.ProjectileSimulationService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TargetingServiceTest {
    @Test
    void selectableSelectorsUseAbilityIdentityOwnerSlotAndEntityAge() {
        Bot player = bot(UUID.fromString("00000000-0000-0000-0000-000000000001"), 1, 100, 100);
        Bot opponent = bot(UUID.fromString("00000000-0000-0000-0000-000000000002"), 2, 700, 700);
        List<Entity> entities = List.of(
                target("hunter-old", "hunterDrone", 17, 2, 5_000, 200, 100),
                target("repeller-old", "hunterDrone", 31, 2, 5_000, 300, 100),
                target("repeller-new", "hunterDrone", 31, 2, 1_000, 400, 100),
                target("other-owner-repeller", "hunterDrone", 31, 1, 9_000, 500, 100));

        assertThat(TargetingService.matchingSelectables("opponent_hunter_drone", player, opponent, entities))
                .extracting(entity -> ((SelectableSnapshot) entity).id())
                .containsExactly("hunter-old");
        assertThat(TargetingService.selectableEntity("opponent_repeller_drone:oldest:1", player, opponent, entities))
                .isInstanceOfSatisfying(SelectableSnapshot.class,
                        target -> assertThat(target.id()).isEqualTo("repeller-old"));
        assertThat(TargetingService.selectableEntity("opponent_repeller_drone:newest:1", player, opponent, entities))
                .isInstanceOfSatisfying(SelectableSnapshot.class,
                        target -> assertThat(target.id()).isEqualTo("repeller-new"));
    }

    @Test
    void botTargetsIncludeBothSidesOfTheDuel() {
        Bot player = bot(UUID.fromString("00000000-0000-0000-0000-000000000001"), 1, 100, 100);
        Bot opponent = bot(UUID.fromString("00000000-0000-0000-0000-000000000002"), 2, 700, 700);

        assertThat(TargetingService.selectableEntity("my_bot", player, opponent, List.of())).isSameAs(player);
        assertThat(TargetingService.selectableEntity("opponent", player, opponent, List.of())).isSameAs(opponent);
        assertThat(TargetingService.matchingSelectables("my_bot", player, opponent, List.of()))
                .containsExactly(player);
    }

    @Test
    void selectablePairDistanceAndNonHealthMetricsResolveAuthoritatively() {
        Bot player = bot(UUID.fromString("00000000-0000-0000-0000-000000000001"), 1, 100, 100);
        Bot opponent = bot(UUID.fromString("00000000-0000-0000-0000-000000000002"), 2, 700, 700);
        SelectableSnapshot grenade = target("grenade-1", "grenade", 4, 2, 100, 150, 100);
        List<Entity> entities = List.of(grenade);
        BotStateService botStateService = new BotStateService(new GameConfigCatalog(), new BotCodeService());
        ActionExecutionService actionExecutionService = new ActionExecutionService(
                botStateService, new ProjectileSimulationService(botStateService));
        ConditionResolutionService resolver = new ConditionResolutionService(
                new ConditionEvaluationService(), actionExecutionService);
        Arena arena = new Arena(1000, 1000, 1000);

        Condition distance = new Condition("expression", 0, "opponent_grenade", "my_bot", null,
                "selectable.distance", null, "", "eq", Operand.number(0), "and");
        assertThat(resolver.resolveStateVariable("selectable.distance", "my_bot", distance,
                player, opponent, entities, arena).numberValue()).isEqualTo(50.0);

        opponent.rotation = 270;
        Condition bearing = new Condition("expression", 0, "my_bot", "opponent", null,
                "selectable.absoluteBearing", null, "", "eq", Operand.number(0), "and");
        assertThat(resolver.resolveStateVariable("selectable.absoluteBearing", "opponent", bearing,
                player, opponent, entities, arena).numberValue()).isEqualTo(-45.0);

        Condition invalidBearing = new Condition("expression", 0, "opponent_grenade", "opponent", null,
                "selectable.absoluteBearing", null, "", "eq", Operand.number(0), "and");
        assertThat(resolver.resolveStateVariable("selectable.absoluteBearing", "opponent_grenade", invalidBearing,
                player, opponent, entities, arena)).isNull();

        Condition relative = new Condition("expression", 0, "my_bot", "opponent", null,
                "selectable.relativeBearing", null, "", "eq", Operand.number(0), "and");
        assertThat(resolver.resolveStateVariable("selectable.relativeBearing", "opponent", relative,
                player, opponent, entities, arena).numberValue()).isEqualTo(45.0);

        Condition hp = new Condition("expression", 0, "opponent_grenade", "opponent_grenade", null,
                "selectable.hp", null, "", "eq", Operand.number(0), "and");
        assertThat(resolver.resolveStateVariable("selectable.hp", "opponent_grenade", hp,
                player, opponent, entities, arena).numberValue()).isEqualTo(0.0);
    }

    private static Bot bot(UUID id, int slot, double x, double y) {
        Bot bot = new Bot();
        bot.userId = id;
        bot.slot = slot;
        bot.x = x;
        bot.y = y;
        bot.size = 60;
        return bot;
    }

    private static SelectableSnapshot target(String id, String type, int abilityId, int ownerSlot,
                                         int ageMs, double x, double y) {
        return new SelectableSnapshot(id, type, x, y, 20, ageMs, 20, 0, 0, abilityId, ownerSlot);
    }
}
