package com.example.botfight.simulation.core.logic;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetSnapshot;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TargetingServiceTest {
    @Test
    void targetSelectorsUseAbilityIdentityOwnerSlotAndEntityAge() {
        Bot player = bot(UUID.fromString("00000000-0000-0000-0000-000000000001"), 1, 100, 100);
        Bot opponent = bot(UUID.fromString("00000000-0000-0000-0000-000000000002"), 2, 700, 700);
        List<Entity> entities = List.of(
                target("hunter-old", "hunterDrone", 17, 2, 5_000, 200, 100),
                target("repeller-old", "hunterDrone", 31, 2, 5_000, 300, 100),
                target("repeller-new", "hunterDrone", 31, 2, 1_000, 400, 100),
                target("other-owner-repeller", "hunterDrone", 31, 1, 9_000, 500, 100));

        assertThat(TargetingService.matchingTargets("opponent_hunter_drone", player, opponent, entities))
                .extracting(entity -> ((TargetSnapshot) entity).id())
                .containsExactly("hunter-old");
        assertThat(TargetingService.targetEntity("opponent_repeller_drone:oldest:1", player, opponent, entities))
                .isInstanceOfSatisfying(TargetSnapshot.class,
                        target -> assertThat(target.id()).isEqualTo("repeller-old"));
        assertThat(TargetingService.targetEntity("opponent_repeller_drone:newest:1", player, opponent, entities))
                .isInstanceOfSatisfying(TargetSnapshot.class,
                        target -> assertThat(target.id()).isEqualTo("repeller-new"));
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

    private static TargetSnapshot target(String id, String type, int abilityId, int ownerSlot,
                                         int ageMs, double x, double y) {
        return new TargetSnapshot(id, type, x, y, 20, ageMs, 20, 0, 0, abilityId, ownerSlot);
    }
}
