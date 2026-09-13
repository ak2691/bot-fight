package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import java.util.List;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;

/**
 * Server-owned, allowlisted description of one ability execution.
 *
 * Strategy input contains only a canonical ability action. This payload joins
 * that action to the authoritative numeric definition and the matching phase
 * contract so execution systems do not need to identify abilities by number.
 */
public record AbilityExecutionPayload(
        int actionId,
        int abilityId,
        Abilities.AbilityDefinition definition,
        AbilityContracts.AbilityContract contract,
        double targetX,
        double targetY,
        String movementMode,
        String movementDirection,
        String phaseFacingMode,
        double capturedOriginX,
        double capturedOriginY,
        double capturedRotation) {

    /** The resolved origin and facing of the ability's active hitbox/visual. */
    public record Pose(double x, double y, double rotation) {}

    public static AbilityExecutionPayload from(Action action) {
        if (action == null) return null;
        Integer abilityId = AbilityContracts.abilityForAction(action.abilityAction());
        return abilityId == null ? null : from(abilityId, action);
    }

    public static AbilityExecutionPayload forAbility(Integer abilityId) {
        return abilityId == null ? null : new AbilityExecutionPayload(
                abilityId,
                abilityId,
                Abilities.definition(abilityId),
                AbilityContracts.forAbility(abilityId),
                Double.NaN,
                Double.NaN,
                null,
                null,
                null,
                Double.NaN,
                Double.NaN,
                Double.NaN);
    }

    public static AbilityExecutionPayload fromTriggered(DuelSimulationService.Bot bot) {
        return bot == null ? null : bot.triggeredAbilityPayload != null
                ? bot.triggeredAbilityPayload : forAbility(bot.triggeredAbility);
    }

    public AbilityExecutionPayload withPreparationTarget(double preparationTargetX, double preparationTargetY) {
        return new AbilityExecutionPayload(actionId, abilityId, definition, contract,
                preparationTargetX, preparationTargetY, movementMode, movementDirection,
                phaseFacingMode, capturedOriginX, capturedOriginY, capturedRotation);
    }

    public AbilityExecutionPayload capture(Bot bot) {
        if (!activation().captureAtActivation()) return this;
        Pose pose = spawnPose(bot);
        return new AbilityExecutionPayload(actionId, abilityId, definition, contract,
                targetX, targetY, movementMode, movementDirection, phaseFacingMode,
                pose.x(), pose.y(), pose.rotation());
    }

    public boolean hasCapturedPose() {
        return Double.isFinite(capturedOriginX) && Double.isFinite(capturedOriginY)
                && Double.isFinite(capturedRotation);
    }

    /** Resolves the pose used by direct attached geometry and presentation. */
    public Pose pose(Bot bot) {
        if (hasCapturedPose()) {
            return new Pose(capturedOriginX, capturedOriginY, capturedRotation);
        }
        return spawnPose(bot);
    }

    public AbilityContracts.Activation activation() {
        return contract == null
                ? AbilityContracts.activationFor(abilityId)
                : contract.activation();
    }

    /** Returns the active phase list for either an attached or entity ability. */
    public List<AbilityContracts.AbilityPhase> phases() {
        if (contract != null) return contract.phases();
        AbilityContracts.AbilityContract entity = AbilityContracts.entityContractForAbility(abilityId);
        return entity == null ? List.of() : entity.phases();
    }

    private Pose spawnPose(Bot bot) {
        if (bot == null) return new Pose(0, 0, 0);
        AbilityContracts.Spawn spawn = contract == null ? null : contract.spawn();
        if (spawn == null || !AbilityContracts.isAttachedAbility(abilityId)) {
            return new Pose(bot.x, bot.y, bot.rotation);
        }

        double rotation = spawn.rotationSpace() == AbilityContracts.RotationSpace.WORLD
                ? spawn.rotation() : bot.rotation + spawn.rotation();
        if (spawn.targetPosition()) {
            double x = Double.isFinite(targetX) ? targetX : spawn.defaultX();
            double y = Double.isFinite(targetY) ? targetY : spawn.defaultY();
            return new Pose(x, y, rotation);
        }

        double radians = compassRadians(bot.rotation);
        double forwardX = Math.cos(radians);
        double forwardY = Math.sin(radians);
        double rightRadians = compassRadians(bot.rotation + 90);
        double rightX = Math.cos(rightRadians);
        double rightY = Math.sin(rightRadians);
        return new Pose(
                bot.x + rightX * spawn.offsetX() + forwardX * spawn.offsetY(),
                bot.y + rightY * spawn.offsetX() + forwardY * spawn.offsetY(),
                rotation);
    }

    private static AbilityExecutionPayload from(int abilityId, Action action) {
        return new AbilityExecutionPayload(
                action.abilityAction(),
                abilityId,
                Abilities.definition(abilityId),
                AbilityContracts.forAbility(abilityId),
                action.abilityTargetX(),
                action.abilityTargetY(),
                action.movementMode(),
                action.movementDirection(),
                action.phaseFacingMode(),
                Double.NaN,
                Double.NaN,
                Double.NaN);
    }
}
