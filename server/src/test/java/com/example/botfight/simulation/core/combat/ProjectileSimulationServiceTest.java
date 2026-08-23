package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ProjectileSimulationServiceTest {
    private final ProjectileSimulationService service = new ProjectileSimulationService(
            new BotStateService(new GameConfigCatalog(), new BotCodeService()));

    @Test
    void fireballUsesLifetimeInsteadOfTraveledRangeToExpire() {
        Bot owner = owner();
        ArenaEntity longTraveled = fireball(0, 10_000);

        ProjectileSimulationService.ProjectileUpdate active = service.updateProjectiles(
                List.of(longTraveled), List.of(owner), new Arena(1000, 800, 1000));
        assertThat(active.projectiles()).singleElement();

        ProjectileSimulationService.ProjectileUpdate expired = service.updateProjectiles(
                List.of(fireball(1_100, 10_000)), List.of(owner), new Arena(1000, 800, 1000));
        assertThat(expired.projectiles()).isEmpty();
    }

    @Test
    void projectileCollisionSweepsAcrossBotDashSegment() {
        Bot owner = owner();
        Bot target = owner();
        target.slot = 2;
        target.x = 425;
        target.y = 432;
        target.movementStartX = 500;
        target.movementStartY = 432;

        ArenaEntity grenade = new ArenaEntity("grenade", "grenade", 1,
                500, 467.6, 12, 0, 0, 0, 0, false, 0, 0, 1.0, 4);
        ProjectileSimulationService.ProjectileUpdate update = service.updateProjectiles(
                List.of(grenade), List.of(owner, target), new Arena(1000, 800, 1000));

        assertThat(update.projectiles()).isEmpty();
        assertThat(update.effects()).singleElement().satisfies(effect ->
                assertThat(effect.hitSlots()).contains(-1));
        assertThat(update.impacts()).singleElement();

        service.applyImpacts(List.of(owner, target), update.impacts());
        assertThat(target.hp).isLessThan(100);
    }

    private static ArenaEntity fireball(int ageMs, double traveled) {
        return new ArenaEntity("fireball", "fireball", 1, 500, 400, 30,
                36, 0, traveled, ageMs, false, 0, 0, 1.0, 5);
    }

    private static Bot owner() {
        Bot bot = new Bot();
        bot.userId = UUID.randomUUID();
        bot.username = "owner";
        bot.slot = 1;
        bot.x = 500;
        bot.y = 400;
        bot.size = 60;
        bot.hp = 100;
        bot.maxHp = 100;
        return bot;
    }
}
