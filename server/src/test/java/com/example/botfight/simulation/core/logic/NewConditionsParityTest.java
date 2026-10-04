package com.example.botfight.simulation.core.logic;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SelectableSnapshot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Operand;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StateValue;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Authoritative mirror of frontend NewConditions.test.js; keep the cases in step. */
class NewConditionsParityTest {
    private final ConditionResolutionService resolver = new ConditionResolutionService(
            new ConditionEvaluationService(),
            new ActionExecutionService(new BotStateService(new GameConfigCatalog(), new BotCodeService())));
    private final Arena arena = new Arena(1600, 1600, 1000);

    private static Bot bot(int slot, double x, double y) {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes(("bot-" + slot).getBytes());
        bot.slot = slot;
        bot.x = x;
        bot.y = y;
        bot.movementStartX = x;
        bot.movementStartY = y;
        bot.size = 60;
        bot.hp = 100;
        bot.maxHp = 100;
        return bot;
    }

    /** Opponent at (x, y) that began the last tick at (startX, startY). */
    private static Bot opponent(double x, double y, double startX, double startY) {
        Bot opponent = bot(2, x, y);
        opponent.movementStartX = startX;
        opponent.movementStartY = startY;
        return opponent;
    }

    private StateValue resolve(String variable, String selectable, Bot player, Bot opponent) {
        Condition condition = new Condition("expression", 0, selectable, selectable, null,
                variable, null, "", "eq", Operand.number(0));
        return resolver.resolveStateVariable(variable, selectable, condition, player, opponent, List.of(), arena);
    }

    /** Approach Angle for a moving entity (first slot) and a target entity (second slot). */
    private StateValue approach(String moving, String target, Bot player, Bot opponent, List<Entity> entities) {
        Condition condition = new Condition("expression", 0, target, moving, null,
                "selectable.approachAngle", null, "", "eq", Operand.number(0));
        return resolver.resolveStateVariable("selectable.approachAngle", moving, condition,
                player, opponent, entities, arena);
    }

    private double angle(Bot player, Bot opponent) {
        return approach("opponent", "my_bot", player, opponent, List.of()).numberValue();
    }

    private static SelectableSnapshot entity(String id, String type, int abilityId, int ownerSlot,
                                             double x, double y, double velocityX, double velocityY) {
        return new SelectableSnapshot(id, type, x, y, 20, 1000, 20, velocityX, velocityY, abilityId, ownerSlot);
    }

    private static Condition normalized(String json) throws Exception {
        return ConditionResolutionService.normalizeConditions(
                new tools.jackson.databind.json.JsonMapper().readTree("[" + json + "]")).get(0);
    }

    @Test
    void newVariableContractsAreBoundedAndTyped() {
        var approach = BotLogicContracts.variableContract("selectable.approachAngle");
        assertThat(approach.valueType()).isEqualTo(BotLogicContracts.ValueType.NUMBER);
        assertThat(approach.isPairVariable()).isTrue();
        assertThat(approach.pairSelectableIdentities(0)).isEmpty();
        assertThat(approach.pairSelectableIdentities(1)).isEmpty();
        assertThat(approach.numericRange().minimum()).isZero();
        assertThat(approach.numericRange().maximum()).isEqualTo(180);
        assertThat(BotLogicContracts.variableContract("selectable.moving").valueType())
                .isEqualTo(BotLogicContracts.ValueType.BOOLEAN);
        var preparing = BotLogicContracts.variableContract("bot.anyAbilityPreparing");
        assertThat(preparing.valueType()).isEqualTo(BotLogicContracts.ValueType.BOOLEAN);
        assertThat(preparing.selectableIdentities()).containsExactly(BotLogicContracts.SelectableIdentity.BOT);
        // Speed is still a valid, evaluated variable for saved brains.
        assertThat(BotLogicContracts.variableContract("selectable.speed")).isNotNull();
    }

    @Test
    void approachAngleIsNinetyWhenTheEntityDidNotMove() {
        assertThat(angle(bot(1, 400, 400), opponent(600, 400, 600, 400))).isEqualTo(90.0);
    }

    @Test
    void approachAngleIsZeroHeadOnAndOneEightyWhenFleeing() {
        Bot player = bot(1, 400, 400);
        assertThat(angle(player, opponent(600, 400, 640, 400))).isEqualTo(0.0);
        assertThat(angle(player, opponent(600, 400, 560, 400))).isEqualTo(180.0);
        assertThat(angle(player, opponent(600, 400, 600, 360))).isEqualTo(90.0);
        assertThat(angle(player, opponent(600, 400, 640, 440))).isEqualTo(45.0);
    }

    @Test
    void approachAngleIsMeasuredTowardMyBot() {
        assertThat(angle(bot(1, 600, 700), opponent(600, 400, 600, 360))).isEqualTo(0.0);
        assertThat(angle(bot(1, 600, 100), opponent(600, 400, 600, 360))).isEqualTo(180.0);
    }

    @Test
    void knockbackCountsAsMovingAndAsMovementAwayFromMyBot() {
        Bot player = bot(1, 400, 400);
        Bot pushed = opponent(720, 400, 600, 400);
        pushed.velocityX = 0;
        pushed.velocityY = 0;
        pushed.movementVelocityX = 0;
        pushed.movementVelocityY = 0;
        assertThat(resolve("selectable.moving", "opponent", player, pushed).booleanValue()).isTrue();
        assertThat(angle(player, pushed)).isEqualTo(180.0);
    }

    @Test
    void isMovingIsFalseWhenStandingAndTrueForWalkingAndDash() {
        Bot player = bot(1, 400, 400);
        assertThat(resolve("selectable.moving", "opponent", player, opponent(600, 400, 600, 400)).booleanValue()).isFalse();
        assertThat(resolve("selectable.moving", "opponent", player, opponent(600, 400, 592, 400)).booleanValue()).isTrue();
        assertThat(resolve("selectable.moving", "opponent", player, opponent(600, 250, 600, 400)).booleanValue()).isTrue();
        Bot walker = bot(1, 410, 400);
        walker.movementStartX = 400;
        assertThat(resolve("selectable.moving", "my_bot", walker, opponent(600, 400, 600, 400)).booleanValue()).isTrue();
        assertThat(resolve("selectable.moving", "my_bot", bot(1, 400, 400), opponent(600, 400, 600, 400)).booleanValue()).isFalse();
    }

    @Test
    void anyAbilityWindingUpIsTrueOnlyWhileTheCountdownRuns() {
        Bot player = bot(1, 400, 400);
        Bot winding = opponent(600, 400, 600, 400);
        assertThat(resolve("bot.anyAbilityPreparing", "opponent", player, winding).booleanValue()).isFalse();
        winding.preparingAbility = 36;
        winding.preparingMs = 300;
        assertThat(resolve("bot.anyAbilityPreparing", "opponent", player, winding).booleanValue()).isTrue();
        winding.preparingMs = 0;
        assertThat(resolve("bot.anyAbilityPreparing", "opponent", player, winding).booleanValue()).isFalse();
        winding.preparingAbility = null;
        winding.preparingMs = 300;
        assertThat(resolve("bot.anyAbilityPreparing", "opponent", player, winding).booleanValue()).isFalse();
        Bot selfWinding = bot(1, 400, 400);
        selfWinding.preparingAbility = 9;
        selfWinding.preparingMs = 200;
        assertThat(resolve("bot.anyAbilityPreparing", "my_bot", selfWinding, opponent(600, 400, 600, 400)).booleanValue()).isTrue();
    }

    @Test
    void speedStillEvaluatesForSavedBrains() {
        Bot player = bot(1, 400, 400);
        Bot runner = opponent(600, 400, 600, 400);
        runner.movementVelocityX = 3;
        runner.movementVelocityY = 4;
        assertThat(resolve("selectable.speed", "opponent", player, runner).numberValue()).isEqualTo(5.0);
    }

    private StateValue baseRange(Integer ability, String selectable, Bot player, Bot opponent) {
        Condition condition = new Condition("expression", 0, selectable, selectable, null,
                "bot.selectedAbilityBaseRange", ability, "", "eq", Operand.number(0));
        return resolver.resolveStateVariable("bot.selectedAbilityBaseRange", selectable, condition,
                player, opponent, List.of(), arena);
    }

    @Test
    void baseRangeResolvesForMyBotAndOpponentAndFailsClosedWithoutARange() {
        Bot player = bot(1, 400, 400);
        Bot opponent = opponent(600, 400, 600, 400);
        assertThat(baseRange(5, "my_bot", player, opponent).numberValue()).isEqualTo(700.0);
        assertThat(baseRange(1, "opponent", player, opponent).numberValue()).isEqualTo(92.0);
        assertThat(baseRange(8, "my_bot", player, opponent)).isNull();
        assertThat(baseRange(null, "my_bot", player, opponent)).isNull();
    }

    @Test
    void approachAngleMeasuresAnyEntityTowardAnyOtherEntity() {
        Bot player = bot(1, 400, 400);
        Bot opponent = opponent(600, 400, 640, 400); // moving toward x = 400
        SelectableSnapshot ally = entity("drone-1", "hunterDrone", 17, 1, 600, 700, 0, 0);
        // opponent -> ally: the drone is straight below the opponent while it moves left: sideways.
        assertThat(approach("opponent", "my_bot_hunter_drone", player, opponent, List.of(ally)).numberValue()).isEqualTo(90.0);
        Bot approaching = opponent(600, 400, 600, 360); // moving +y toward the drone
        assertThat(approach("opponent", "my_bot_hunter_drone", player, approaching, List.of(ally)).numberValue()).isEqualTo(0.0);
        // entity -> entity: the opponent's fireball (moving +x) against My Bot's drone ahead and behind.
        SelectableSnapshot fireball = entity("fb-1", "fireball", 5, 2, 800, 800, 10, 0);
        SelectableSnapshot ahead = entity("drone-2", "hunterDrone", 17, 1, 1000, 800, 0, 0);
        SelectableSnapshot behind = entity("drone-3", "hunterDrone", 17, 1, 500, 800, 0, 0);
        assertThat(approach("opponent_1_fireball", "my_bot_hunter_drone", player, opponent, List.of(fireball, ahead)).numberValue())
                .isEqualTo(0.0);
        assertThat(approach("opponent_1_fireball", "my_bot_hunter_drone", player, opponent, List.of(fireball, behind)).numberValue())
                .isEqualTo(180.0);
        // The first entity can be My Bot and the second the opponent.
        Bot walker = bot(1, 410, 400);
        walker.movementStartX = 400;
        assertThat(approach("my_bot", "opponent", walker, opponent(600, 400, 600, 400), List.of()).numberValue()).isEqualTo(0.0);
    }

    @Test
    void approachAngleIsNinetyWhenThePositionsCoincide() {
        Bot player = bot(1, 600, 400);
        Bot opponent = opponent(600, 400, 640, 400);
        assertThat(approach("opponent", "my_bot", player, opponent, List.of()).numberValue()).isEqualTo(90.0);
        assertThat(approach("opponent", "opponent", player, opponent, List.of()).numberValue()).isEqualTo(90.0);
    }

    @Test
    void oldSingleSelectableApproachAngleMapsToTheMovingEntityAndTargetsMyBot() throws Exception {
        Condition legacy = normalized("""
                {"type":"expression","left":"selectable.approachAngle","selectable":"opponent",
                 "comparator":"lt","right":{"type":"number","value":20}}""");
        assertThat(legacy.leftSelectable()).isEqualTo("opponent_1");
        assertThat(legacy.selectable()).isEqualTo("my_bot");
        Condition withLeft = normalized("""
                {"type":"expression","left":"selectable.approachAngle","leftSelectable":"my_bot","selectable":"my_bot",
                 "comparator":"lt","right":{"type":"number","value":20}}""");
        assertThat(withLeft.leftSelectable()).isEqualTo("my_bot");
        assertThat(withLeft.selectable()).isEqualTo("my_bot");
        Condition bare = normalized("""
                {"type":"expression","left":"selectable.approachAngle","comparator":"lt","right":{"type":"number","value":20}}""");
        assertThat(bare.leftSelectable()).isEqualTo("opponent_1");
        assertThat(bare.selectable()).isEqualTo("my_bot");
        Condition migrated = normalized("""
                {"type":"expression","left":"selectable.approachAngle","selectable1":"opponent","selectable2":"my_bot",
                 "comparator":"lt","right":{"type":"number","value":20}}""");
        assertThat(migrated.leftSelectable()).isEqualTo("opponent_1");
        assertThat(migrated.selectable()).isEqualTo("my_bot");

        // The old behavior is unchanged: the opponent heading for My Bot is 0 degrees.
        Bot player = bot(1, 400, 400);
        Bot opponent = opponent(600, 400, 640, 400);
        var held = resolver.evaluateConditions(List.of(legacy), player, opponent, List.of(), arena);
        assertThat(held).isTrue();
        assertThat(resolver.evaluateConditions(List.of(legacy), player, opponent(600, 400, 560, 400), List.of(), arena)).isFalse();
    }

    @Test
    void oldRightSideApproachAngleKeepsItsMovingEntity() throws Exception {
        Condition legacy = normalized("""
                {"type":"expression","left":"selectable.approachAngle","selectable":"my_bot",
                 "comparator":"gt","right":{"type":"variable","value":"selectable.approachAngle"},
                 "rightSelectable":"opponent"}""");
        assertThat(legacy.rightView()).isNotNull();
        assertThat(legacy.rightView().leftSelectable()).isEqualTo("opponent_1");
        assertThat(legacy.rightView().selectable()).isEqualTo("my_bot");
    }
}
