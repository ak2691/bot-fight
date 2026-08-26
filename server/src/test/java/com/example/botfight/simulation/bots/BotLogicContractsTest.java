package com.example.botfight.simulation.bots;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class BotLogicContractsTest {
    @Test
    void targetsAreDerivedFromEntityContracts() {
        assertThat(BotLogicContracts.selectableContract("opponent_grenade").runtimeType()).isEqualTo("grenade");
        assertThat(BotLogicContracts.selectableContract("my_null_zone").runtimeType()).isEqualTo("nullZone");
        assertThat(BotLogicContracts.selectableContract("opponent_orbital_zone").owner())
                .isEqualTo(EntityContracts.SelectableOwner.OWNER);
        assertThat(BotLogicContracts.selectableContract("opponent_singularity_zone").runtimeType())
                .isEqualTo("singularityZone");
        assertThat(BotLogicContracts.selectableContract("singularity_zone")).isNull();
        assertThat(EntityContracts.all().values())
                .allMatch(entity -> entity.selectableOwner() == EntityContracts.SelectableOwner.OWNER);
    }

    @Test
    void actionCapabilitiesAreDerivedFromAbilityAndEntityContracts() {
        assertThat(BotLogicContracts.actionContract(22).locationTarget()).isTrue();
        assertThat(BotLogicContracts.actionContract(24).coordinateTarget()).isTrue();
        assertThat(BotLogicContracts.actionContract(25).orientationConfig()).isTrue();
        assertThat(BotLogicContracts.actionContract(BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET).coordinateTarget()).isTrue();
        assertThat(BotLogicContracts.actionContract(BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET).angleTarget()).isTrue();
        assertThat(BotLogicContracts.actionUsesAbsoluteAngle(BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET, "angle")).isTrue();
        assertThat(BotLogicContracts.actionUsesTarget(BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET)).isTrue();
    }

    @Test
    void statusEffectNamesComeFromAbilityEffects() {
        assertThat(BotLogicContracts.statusEffects()).contains("burn", "bleed", "slow", "silence", "overclock");
    }

    @Test
    void variableContractsDescribeRuntimeResolutionSemantics() {
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityReady").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityActive").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityActiveMs").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityOnCooldown").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("bot.selectedStatusEffectDurationMs").requiresStatusEffect()).isTrue();
        assertThat(BotLogicContracts.variableContract("selectable.absoluteBearing").angle()).isTrue();
        assertThat(BotLogicContracts.variableContract("selectable.absoluteBearing").selectableType())
                .isEqualTo(BotLogicContracts.VariableSelectableType.PAIR);
        assertThat(BotLogicContracts.variableContract("selectable.absoluteBearing").pairSelectableIdentities(0))
                .containsExactly(BotLogicContracts.SelectableIdentity.FACING);
        assertThat(BotLogicContracts.variableContract("selectable.absoluteBearing").pairSelectableIdentities(1))
                .isEmpty();
        assertThat(BotLogicContracts.variableContract("selectable.relativeBearing").pairSelectableIdentities(0))
                .containsExactly(BotLogicContracts.SelectableIdentity.FACING);
        assertThat(BotLogicContracts.variableContract("selectable.distance").selectableType())
                .isEqualTo(BotLogicContracts.VariableSelectableType.PAIR);
        assertThat(BotLogicContracts.variableContract("selectable.distance").pairSelectableIdentities(0))
                .isEmpty();
        assertThat(BotLogicContracts.variableContract("selectable.movementDirection").angle()).isTrue();
        assertThat(BotLogicContracts.variableContract("selectable.movementDirection").selectableIdentities())
                .isEmpty();
        assertThat(BotLogicContracts.variableContract("selectable.speed").id()).isEqualTo("selectable.speed");
        assertThat(BotLogicContracts.variableContract("selectable.speed").source())
                .isEqualTo(BotLogicContracts.VariableSource.SELECTABLE_SPEED);
        assertThat(BotLogicContracts.variableContract("selectable.speed").selectableIdentities())
                .isEmpty();
        assertThat(BotLogicContracts.variableContract("selectable.closingZoneEdgeDistance").source())
                .isEqualTo(BotLogicContracts.VariableSource.SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE);
        assertThat(BotLogicContracts.variableContract("selectable.closingZoneEdgeDistance").scope())
                .isEqualTo(BotLogicContracts.VariableScope.SELECTABLE);
        assertThat(BotLogicContracts.variableContract("selectable.closingZoneEdgeDistance").allowsNegativeInteger()).isTrue();
        assertThat(BotLogicContracts.variableContract("selectable.hpNetChangeLastTick").allowsNegativeInteger()).isTrue();
        assertThat(BotLogicContracts.variableContract("selectable.hp").selectableIdentities())
                .isEmpty();
        assertThat(BotLogicContracts.defaultSelectable1ForVariable(
                BotLogicContracts.variableContract("selectable.distance"))).isEqualTo("my_bot");
        assertThat(BotLogicContracts.defaultSelectableForVariable(
                BotLogicContracts.variableContract("selectable.distance"))).isEqualTo("opponent");
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityActive").scope())
                .isEqualTo(BotLogicContracts.VariableScope.SELECTABLE);
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityActive").selectableIdentities())
                .containsExactly(BotLogicContracts.SelectableIdentity.BOT);
        assertThat(BotLogicContracts.variableContract("bot.selectedAbilityActive").selectableDependency())
                .isEqualTo(BotLogicContracts.SelectableDependency.ABILITY_LOADOUT);
        assertThat(BotLogicContracts.variableContract("selectable.facing").selectableIdentities())
                .containsExactly(BotLogicContracts.SelectableIdentity.FACING);
        assertThat(BotLogicContracts.variableContract("selectable.count").selectableOrderable()).isFalse();
        assertThat(BotLogicContracts.variableContract("selectable.count").selectableIdentities())
                .containsExactly(BotLogicContracts.SelectableIdentity.ABILITY_ENTITY);
        assertThat(BotLogicContracts.defaultSelectableForVariable(
                BotLogicContracts.variableContract("selectable.count"))).isEqualTo("opponent_grenade");
        assertThat(BotLogicContracts.selectableContract("opponent_hunter_drone").healthBearing()).isTrue();
        assertThat(BotLogicContracts.selectableContract("opponent_hunter_drone").selectableIdentities())
                .contains(BotLogicContracts.SelectableIdentity.FACING, BotLogicContracts.SelectableIdentity.MOVEMENT);
        assertThat(BotLogicContracts.selectableContract("opponent_grenade").healthBearing()).isFalse();
        assertThat(BotLogicContracts.selectableContract("opponent_proximity_mine").healthBearing()).isFalse();
        assertThat(BotLogicContracts.variableContracts().values())
                .allMatch(variable -> variable.source() != null);
    }

    @Test
    void serverEntitySelectorsEnforceTheCompleteConditionalIdentityMatrix() {
        assertThat(BotLogicContracts.variableContracts().values().stream()
                .filter(BotLogicContracts.VariableContract::supportsSelectable)
                .map(BotLogicContracts.VariableContract::id)
                .toList())
                .containsExactlyInAnyOrderElementsOf(List.of(
                        "selectable.distance", "selectable.hp", "selectable.damageTakenLastTick", "selectable.hpNetChangeLastTick",
                        "selectable.x", "selectable.y", "selectable.alive", "selectable.absoluteBearing", "selectable.movementDirection",
                        "selectable.speed", "selectable.relativeBearing", "selectable.relativeBearingClockwise",
                        "selectable.relativeBearingCounterclockwise", "selectable.facing", "selectable.count", "selectable.age",
                        "selectable.edgeDistance", "selectable.closingZoneEdgeDistance", "selectable.exists",
                        "bot.selectedAbilityReady", "bot.selectedAbilityActive", "bot.selectedAbilityOnCooldown",
                        "bot.selectedAbilityActiveMs", "bot.selectedAbilityCooldownMs", "bot.selectedAbilityCharges",
                        "bot.selectedAbilityPreparing", "bot.selectedAbilityPreparationMs",
                        "bot.selectedStatusEffectActive", "bot.selectedStatusEffectDurationMs"));
        for (String variable : List.of(
                "selectable.hp", "selectable.damageTakenLastTick", "selectable.hpNetChangeLastTick", "selectable.x",
                "selectable.y", "selectable.alive", "selectable.movementDirection", "selectable.speed",
                "selectable.edgeDistance", "selectable.closingZoneEdgeDistance")) {
            assertSingle(variable);
        }
        for (String variable : List.of("selectable.absoluteBearing", "selectable.relativeBearing",
                "selectable.relativeBearingClockwise", "selectable.relativeBearingCounterclockwise")) {
            assertPair(variable, Set.of(BotLogicContracts.SelectableIdentity.FACING), Set.of());
        }
        assertPair("selectable.distance", Set.of(), Set.of());
        assertSingle("selectable.facing", BotLogicContracts.SelectableIdentity.FACING);
        for (String variable : List.of("selectable.count", "selectable.age", "selectable.exists")) {
            assertSingle(variable, BotLogicContracts.SelectableIdentity.ABILITY_ENTITY);
        }
        for (String variable : List.of(
                "bot.selectedAbilityReady", "bot.selectedAbilityActive", "bot.selectedAbilityOnCooldown",
                "bot.selectedAbilityActiveMs", "bot.selectedAbilityCooldownMs", "bot.selectedAbilityCharges",
                "bot.selectedAbilityPreparing", "bot.selectedAbilityPreparationMs",
                "bot.selectedStatusEffectActive", "bot.selectedStatusEffectDurationMs")) {
            assertSingle(variable, BotLogicContracts.SelectableIdentity.BOT);
        }

        assertThat(BotLogicContracts.selectableMatchesIdentities("my_bot", Set.of(BotLogicContracts.SelectableIdentity.FACING))).isTrue();
        assertThat(BotLogicContracts.selectableMatchesIdentities("opponent_hunter_drone",
                Set.of(BotLogicContracts.SelectableIdentity.FACING))).isTrue();
        assertThat(BotLogicContracts.selectableMatchesIdentities("opponent_grenade",
                Set.of(BotLogicContracts.SelectableIdentity.FACING))).isFalse();
        assertThat(BotLogicContracts.selectableMatchesIdentities("opponent_grenade",
                Set.of(BotLogicContracts.SelectableIdentity.ABILITY_ENTITY))).isTrue();
        assertThat(BotLogicContracts.selectableMatchesIdentities("opponent",
                Set.of(BotLogicContracts.SelectableIdentity.ABILITY_ENTITY))).isFalse();
    }

    private static void assertSingle(String variable, BotLogicContracts.SelectableIdentity... identities) {
        assertThat(BotLogicContracts.variableContract(variable).selectableIdentities())
                .containsExactlyInAnyOrder(identities);
    }

    private static void assertPair(String variable, Set<BotLogicContracts.SelectableIdentity> first,
            Set<BotLogicContracts.SelectableIdentity> second) {
        BotLogicContracts.VariableContract contract = BotLogicContracts.variableContract(variable);
        assertThat(contract.pairSelectableIdentities(0)).containsExactlyInAnyOrderElementsOf(first);
        assertThat(contract.pairSelectableIdentities(1)).containsExactlyInAnyOrderElementsOf(second);
    }

    @Test
    void relativeMovementDirectionsAcceptSignedAnglesAndRejectNamedDirections() {
        assertThat(BotLogicContracts.isRelativeDirection("-90")).isTrue();
        assertThat(BotLogicContracts.isRelativeDirection("12.39")).isTrue();
        assertThat(BotLogicContracts.isRelativeDirection("270")).isTrue();
        assertThat(BotLogicContracts.isRelativeDirection("360")).isTrue();
        assertThat(BotLogicContracts.isRelativeDirection("361")).isFalse();
        assertThat(BotLogicContracts.isRelativeDirection("toward_left")).isFalse();
        assertThat(BotLogicContracts.relativeMovementAngle("-90")).isEqualTo(-90.0);
        assertThat(BotLogicContracts.relativeMovementAngle("12.39")).isEqualTo(12.3);
    }

    @Test
    void absoluteWalkDirectionsUseBoundedCompassDegrees() {
        assertThat(BotLogicContracts.isAbsoluteDirection(BotLogicContracts.ACTION_MOVE_WALK, "-90")).isTrue();
        assertThat(BotLogicContracts.isAbsoluteDirection(BotLogicContracts.ACTION_MOVE_WALK, "360")).isTrue();
        assertThat(BotLogicContracts.isAbsoluteDirection(BotLogicContracts.ACTION_MOVE_WALK, "361")).isFalse();
        assertThat(BotLogicContracts.isAbsoluteDirection(BotLogicContracts.ACTION_MOVE_WALK, "east")).isFalse();
        assertThat(BotLogicContracts.absoluteWalkDirection("-90")).isEqualTo(-90.0);
        assertThat(BotLogicContracts.absoluteWalkDirection("12.39")).isEqualTo(12.3);
        assertThat(BotLogicContracts.isAbsoluteDirection(19, "east")).isTrue();
    }

    @Test
    void userNumbersTruncateTowardZeroAndModuloOperandsCanBeIntegerized() {
        assertThat(BotLogicContracts.truncateToNumberPrecision(3.29)).isEqualTo(3.2);
        assertThat(BotLogicContracts.truncateToNumberPrecision(-3.29)).isEqualTo(-3.2);
        assertThat(BotLogicContracts.truncateToInteger(3.3)).isEqualTo(3L);
        assertThat(BotLogicContracts.truncateToInteger(-3.3)).isEqualTo(-3L);
    }

    @Test
    void unsupportedCommandLockAndDirectSlowVariablesAreNotExposed() {
        assertThat(BotLogicContracts.variableContract("bot.commandLockedMs")).isNull();
        assertThat(BotLogicContracts.variableContract("bot.slowedMs")).isNull();
    }
}
