package com.example.botfight.simulation.core.logic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Aim;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Authoritative mirror of frontend aimPrediction.test.js; keep the cases in step. */
class AimPredictionParityTest {
    private final Arena arena = new Arena(1200, 1200, 1000);

    private static Bot bot(double x, double y, double startX, double startY) {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes(("bot-" + x + y).getBytes());
        bot.slot = 2;
        bot.x = x;
        bot.y = y;
        bot.movementStartX = startX;
        bot.movementStartY = startY;
        bot.size = 60;
        bot.hp = 100;
        return bot;
    }

    private static Bot player() {
        Bot player = bot(200, 400, 200, 400);
        player.rotation = 90;
        return player;
    }

    private static StrategyBlock block(Aim aim) {
        return new StrategyBlock(0, BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET, "opponent", 0, 0, "target",
                0, 0, null, null, null, null, 1, List.of(), 0, aim);
    }

    private static Aim lead(double seconds) {
        return new Aim(BotLogicContracts.AIM_LEAD, seconds, null);
    }

    private static Aim auto(int abilityId) {
        return new Aim(BotLogicContracts.AIM_AUTO, 0, abilityId);
    }

    @Test
    void currentAimReturnsTheTargetUntouched() {
        Bot moving = bot(600, 400, 580, 400);
        assertThat(AimPrediction.leadTarget(moving, block(Aim.CURRENT), player(), arena)).isSameAs(moving);
        assertThat(AimPrediction.leadTarget(moving, block(null), player(), arena)).isSameAs(moving);
        assertThat(AimPrediction.leadTarget(moving, null, player(), arena)).isSameAs(moving);
    }

    @Test
    void aStationaryTargetGetsNoLead() {
        Bot standing = bot(600, 400, 600, 400);
        for (Aim aim : List.of(lead(1.5), auto(5))) {
            Entity predicted = AimPrediction.leadTarget(standing, block(aim), player(), arena);
            assertThat(predicted.x()).isEqualTo(600);
            assertThat(predicted.y()).isEqualTo(400);
        }
    }

    @Test
    void aStraightLineMoverIsPredictedByLastTickVelocityTimesLeadSeconds() {
        // 20 units in the last 0.1 s tick is 200 units per second.
        Entity predicted = AimPrediction.leadTarget(bot(600, 400, 580, 400), block(lead(1)), player(), arena);
        assertThat(predicted.x()).isEqualTo(800);
        assertThat(predicted.y()).isEqualTo(400);
        Entity diagonal = AimPrediction.leadTarget(bot(600, 400, 590, 410), block(lead(0.5)), player(), arena);
        assertThat(diagonal.x()).isCloseTo(650, within(0.001));
        assertThat(diagonal.y()).isCloseTo(350, within(0.001));
    }

    @Test
    void thePredictedPointIsClampedToTheArena() {
        assertThat(AimPrediction.leadTarget(bot(1150, 400, 1130, 400), block(lead(2)), player(), arena).x()).isEqualTo(1200);
        Entity corner = AimPrediction.leadTarget(bot(40, 40, 60, 60), block(lead(2)), player(), arena);
        assertThat(corner.x()).isZero();
        assertThat(corner.y()).isZero();
    }

    @Test
    void aTargetThatChangesDirectionDefeatsThePrediction() {
        // It only moved +y last tick, so the prediction ignores any earlier +x travel.
        Entity predicted = AimPrediction.leadTarget(bot(600, 420, 600, 400), block(lead(1)), player(), arena);
        assertThat(predicted.x()).isEqualTo(600);
        assertThat(predicted.y()).isEqualTo(620);
        assertThat(predicted.x()).isNotEqualTo(800);
    }

    @Test
    void autoLeadIsWindupPlusProjectileTravelTime() {
        Bot target = bot(600, 400, 580, 400);
        // Fireball: no wind-up, 50 per tick = 500 per second, 400 units away = 0.8 s.
        assertThat(AimPrediction.projectileSpeedPerSecond(5)).isEqualTo(500);
        assertThat(AimPrediction.leadSeconds(auto(5), player(), target)).isCloseTo(0.8, within(1e-9));
        // Sniper is hitscan: only the 900 ms wind-up counts, full when unstarted and the remainder once begun.
        assertThat(AimPrediction.projectileSpeedPerSecond(3)).isZero();
        assertThat(AimPrediction.leadSeconds(auto(3), player(), target)).isCloseTo(0.9, within(1e-9));
        Bot winding = player();
        winding.preparingAbility = 3;
        winding.preparingMs = 300;
        assertThat(AimPrediction.leadSeconds(auto(3), winding, target)).isCloseTo(0.3, within(1e-9));
        Bot otherWindup = player();
        otherWindup.preparingAbility = 9;
        otherWindup.preparingMs = 300;
        assertThat(AimPrediction.leadSeconds(auto(3), otherWindup, target)).isCloseTo(0.9, within(1e-9));
        // Melee has neither wind-up nor travel.
        assertThat(AimPrediction.leadSeconds(auto(1), player(), target)).isZero();
        assertThat(AimPrediction.leadTarget(target, block(auto(3)), player(), arena).x()).isCloseTo(600 + 200 * 0.9, within(1e-9));
    }

    @Test
    void leadSecondsAreBounded() {
        Bot target = bot(600, 400, 580, 400);
        assertThat(AimPrediction.leadSeconds(lead(99), player(), target)).isEqualTo(2);
        assertThat(AimPrediction.leadSeconds(lead(-4), player(), target)).isZero();
    }
}
