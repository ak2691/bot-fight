package com.example.botfight.simulation.core.state;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.logic.TargetingService;
import com.example.botfight.simulation.core.combat.AbilityExecutionPayload;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import java.util.List;
import org.junit.jupiter.api.Test;

class BotMovementServiceTest {
    private final BotMovementService service = new BotMovementService();

    @Test
    void relativeAnglesUseTheTargetAsZeroAndClockwisePositive() {
        Bot player = player(100, 100);
        Entity target = new DuelSimulationService.TargetPoint(200, 100, 20);

        assertVector(service.movementVector(block("0"), player, target), 1, 0);
        assertVector(service.movementVector(block("90"), player, target), 0, 1);
        assertVector(service.movementVector(block("180"), player, target), -1, 0);
        assertVector(service.movementVector(block("270"), player, target), 0, -1);
        assertVector(service.movementVector(block("-90"), player, target), 0, -1);
    }

    @Test
    void zeroDegreesMovesStraightTowardATargetAboveTheBot() {
        Bot player = player(400, 400);
        Entity target = new DuelSimulationService.TargetPoint(400, 100, 20);

        assertVector(service.movementVector(block("0"), player, target), 0, -1);
    }

    @Test
    void absoluteWalkAnglesFollowTheNorthZeroCompass() {
        Bot player = player(400, 400);

        assertVector(service.movementVector(absoluteBlock("0"), player, null), 0, -1);
        assertVector(service.movementVector(absoluteBlock("90"), player, null), 1, 0);
        assertVector(service.movementVector(absoluteBlock("180"), player, null), 0, 1);
        assertVector(service.movementVector(absoluteBlock("270"), player, null), -1, 0);
        assertVector(service.movementVector(absoluteBlock("-90"), player, null), -1, 0);
    }

    @Test
    void movementTargetOffsetsAreIgnored() {
        StrategyBlock block = block("0");
        Entity target = new DuelSimulationService.TargetPoint(200, 100, 20);

        Entity resolved = TargetingService.offsetTarget(target, block);

        assertThat(resolved.x()).isEqualTo(200);
        assertThat(resolved.y()).isEqualTo(100);
    }

    @Test
    void teleportResetsMovementPathAndVelocityForTheCurrentTick() {
        Bot attacker = player(100, 400);
        attacker.size = 60;
        attacker.velocityX = 75;
        attacker.movementVelocityX = 75;
        Bot defender = player(500, 400);
        defender.size = 60;

        service.applyTeleport(attacker, defender, 0,
                AbilityExecutionPayload.forAbility(25), new DuelSimulationService.Arena(1000, 800, 1000));

        assertThat(attacker.x).isEqualTo(500);
        assertThat(attacker.movementStartX).isEqualTo(attacker.x);
        assertThat(attacker.movementStartY).isEqualTo(attacker.y);
        assertThat(attacker.velocityX).isZero();
        assertThat(attacker.velocityY).isZero();
        assertThat(attacker.movementVelocityX).isZero();
        assertThat(attacker.movementVelocityY).isZero();
    }

    private static Bot player(double x, double y) {
        Bot player = new Bot();
        player.x = x;
        player.y = y;
        player.rotation = 0;
        return player;
    }

    private static StrategyBlock block(String direction) {
        return new StrategyBlock(
                0,
                BotLogicContracts.ACTION_MOVE_WALK,
                BotLogicContracts.TARGET_OPPONENT,
                80,
                -60,
                "target",
                500,
                400,
                "target",
                direction,
                null,
                null,
                1,
                List.of());
    }

    private static StrategyBlock absoluteBlock(String direction) {
        return new StrategyBlock(
                0,
                BotLogicContracts.ACTION_MOVE_WALK,
                BotLogicContracts.TARGET_OPPONENT,
                0,
                0,
                "target",
                500,
                400,
                "absolute",
                direction,
                null,
                null,
                1,
                List.of());
    }

    private static void assertVector(DuelSimulationService.Vector actual, double dx, double dy) {
        assertThat(actual.dx()).isCloseTo(dx, org.assertj.core.data.Offset.offset(0.000001));
        assertThat(actual.dy()).isCloseTo(dy, org.assertj.core.data.Offset.offset(0.000001));
    }
}
