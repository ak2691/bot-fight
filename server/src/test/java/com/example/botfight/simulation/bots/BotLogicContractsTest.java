package com.example.botfight.simulation.bots;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import org.junit.jupiter.api.Test;

class BotLogicContractsTest {
    @Test
    void targetsAreDerivedFromEntityContracts() {
        assertThat(BotLogicContracts.targetContract("opponent_grenade").runtimeType()).isEqualTo("grenade");
        assertThat(BotLogicContracts.targetContract("my_null_zone").runtimeType()).isEqualTo("nullZone");
        assertThat(BotLogicContracts.targetContract("opponent_orbital_zone").owner())
                .isEqualTo(EntityContracts.TargetOwner.OWNER);
        assertThat(BotLogicContracts.targetContract("opponent_singularity_zone").runtimeType())
                .isEqualTo("singularityZone");
        assertThat(BotLogicContracts.targetContract("singularity_zone")).isNull();
        assertThat(EntityContracts.all().values())
                .allMatch(entity -> entity.targetOwner() == EntityContracts.TargetOwner.OWNER);
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
        assertThat(BotLogicContracts.variableContract("my.selectedAbilityReady").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("my.selectedAbilityActive").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("my.selectedAbilityActiveMs").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("my.selectedAbilityOnCooldown").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("opponent.selectedAbilityActive").requiresAbility()).isTrue();
        assertThat(BotLogicContracts.variableContract("my.selectedStatusEffectDurationMs").requiresStatusEffect()).isTrue();
        assertThat(BotLogicContracts.variableContract("target.bearingFromMe").angle()).isTrue();
        assertThat(BotLogicContracts.variableContract("target.movementDirection").angle()).isTrue();
        assertThat(BotLogicContracts.variableContract("target.speed").id()).isEqualTo("target.speed");
        assertThat(BotLogicContracts.variableContract("target.speed").source())
                .isEqualTo(BotLogicContracts.VariableSource.TARGET_SPEED);
        assertThat(BotLogicContracts.variableContract("my.closingZoneEdgeDistance").source())
                .isEqualTo(BotLogicContracts.VariableSource.BOT_CLOSING_ZONE_EDGE_DISTANCE);
        assertThat(BotLogicContracts.variableContract("opponent.closingZoneEdgeDistance").scope())
                .isEqualTo(BotLogicContracts.VariableScope.OPPONENT);
        assertThat(BotLogicContracts.variableContract("opponent.closingZoneEdgeDistance").allowsNegativeInteger()).isTrue();
        assertThat(BotLogicContracts.variableContract("my.hpNetChangeLastTick").allowsNegativeInteger()).isTrue();
        assertThat(BotLogicContracts.variableContract("target.hp").requiresHealthTarget()).isTrue();
        assertThat(BotLogicContracts.variableContract("target.facing").botTargetOnly()).isTrue();
        assertThat(BotLogicContracts.variableContract("target.count").targetOrderable()).isFalse();
        assertThat(BotLogicContracts.defaultTargetForVariable(
                BotLogicContracts.variableContract("target.count"))).isEqualTo("opponent_grenade");
        assertThat(BotLogicContracts.targetContract("opponent_hunter_drone").healthBearing()).isTrue();
        assertThat(BotLogicContracts.targetContract("opponent_grenade").healthBearing()).isFalse();
        assertThat(BotLogicContracts.targetContract("opponent_proximity_mine").healthBearing()).isFalse();
        assertThat(BotLogicContracts.variableContracts().values())
                .allMatch(variable -> variable.source() != null);
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
    void legacyCommandLockAndDirectSlowVariablesAreNotExposed() {
        assertThat(BotLogicContracts.variableContract("opponent.commandLockedMs")).isNull();
        assertThat(BotLogicContracts.variableContract("my.slowedMs")).isNull();
    }
}
