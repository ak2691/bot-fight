package com.example.botfight.simulation.core.state;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.logic.TargetingService;
import com.example.botfight.simulation.core.combat.AbilityExecutionPayload;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.gameconfig.Abilities;
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

    @Test
    void walkingStartsTurnsAndStopsImmediatelyWithoutAcceleration() {
        Bot bot = player(100, 100);
        bot.size = 60;
        bot.moveSpeed = 20;
        DuelSimulationService.Arena arena = new DuelSimulationService.Arena(1000, 800, 1000);

        service.applyTickMovement(bot, action(1, 0), arena, false, false, false);
        assertThat(bot.x).isEqualTo(120);
        assertThat(bot.y).isEqualTo(100);
        assertThat(bot.movementVelocityX).isEqualTo(20);

        service.applyTickMovement(bot, action(0, 1), arena, false, false, false);
        assertThat(bot.x).isEqualTo(120);
        assertThat(bot.y).isEqualTo(120);
        assertThat(bot.movementVelocityX).isZero();
        assertThat(bot.movementVelocityY).isEqualTo(20);

        service.applyTickMovement(bot, action(0, 0), arena, false, false, false);
        assertThat(bot.x).isEqualTo(120);
        assertThat(bot.y).isEqualTo(120);
        assertThat(bot.movementVelocityX).isZero();
        assertThat(bot.movementVelocityY).isZero();
    }

    @Test
    void dashMatchesBrowserInitialStepForShortPhaseDistance() {
        Bot bot = player(400, 400);
        bot.size = 60;
        bot.moveSpeed = 40;
        DuelSimulationService.Arena arena = new DuelSimulationService.Arena(1000, 800, 1000);
        service.applyTickMovement(bot, action(1, 0), arena, false, false, false);
        AbilityContracts.AbilityContract base = AbilityContracts.get(19);
        AbilityContracts.AbilityPhase phase = base.phases().getFirst();
        AbilityContracts.AbilityPhase shortDash = new AbilityContracts.AbilityPhase(
                phase.id(), phase.type(),
                new AbilityContracts.PhaseMovement(75, 20.0, 300, null),
                phase.hitbox(), phase.effects(), phase.events(), phase.durationMs(), phase.visual());
        AbilityContracts.AbilityContract contract = new AbilityContracts.AbilityContract(
                base.abilityId(), base.entityType(), base.runtimeType(), base.category(),
                base.spawn(), base.selectableOwner(), base.lifetime(), base.initialState(),
                base.activation(), List.of(shortDash), base.abilities());
        AbilityExecutionPayload payload = new AbilityExecutionPayload(
                19, 19, Abilities.definition(19), contract,
                Double.NaN, Double.NaN, "absolute", "east", null,
                Double.NaN, Double.NaN, Double.NaN);

        service.startDash(bot, payload, arena);

        assertThat(bot.x).isEqualTo(460);
        assertThat(bot.dashRemaining).isZero();
        assertThat(bot.dashStepDistance).isEqualTo(75);
        assertThat(bot.velocityX).isEqualTo(400);
    }

    private static DuelSimulationService.Action action(double dx, double dy) {
        return new DuelSimulationService.Action(dx, dy, 0, null, 0, 0, null, null, null);
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
                BotLogicContracts.SELECTABLE_OPPONENT,
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
                BotLogicContracts.SELECTABLE_OPPONENT,
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
