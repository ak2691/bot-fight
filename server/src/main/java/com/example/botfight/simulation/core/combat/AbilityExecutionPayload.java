package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityChannels;
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

    /** The tick's ability channel: the selected ability, never one of the dash channel. */
    public static AbilityExecutionPayload abilityChannel(Action action) {
        if (action == null) return null;
        Integer abilityId = AbilityContracts.abilityForAction(action.abilityAction());
        return abilityId == null || AbilityChannels.isDash(abilityId) ? null : from(abilityId, action);
    }

    /** The tick's dash channel: the planned dash, or a dash-channel ability selected through the ability slot (older callers). */
    public static AbilityExecutionPayload dashChannel(Action action) {
        if (action == null) return null;
        DuelSimulationService.DashAction dash = action.dash();
        if (dash != null && dash.abilityId() != null) {
            Integer abilityId = AbilityContracts.abilityForAction(dash.abilityId());
            if (abilityId == null) return null;
            return new AbilityExecutionPayload(
                    dash.abilityId(), abilityId, Abilities.definition(abilityId), AbilityContracts.forAbility(abilityId),
                    dash.targetX(), dash.targetY(), dash.movementMode(), dash.movementDirection(), dash.phaseFacingMode(),
                    Double.NaN, Double.NaN, Double.NaN);
        }
        Integer abilityId = AbilityContracts.abilityForAction(action.abilityAction());
        return abilityId != null && AbilityChannels.isDash(abilityId) ? from(abilityId, action) : null;
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

    public static AbilityExecutionPayload fromTriggered(Bot bot) {
        return bot == null ? null : bot.triggeredAbilityPayload != null
                ? bot.triggeredAbilityPayload : forAbility(bot.triggeredAbility);
    }

    /** The pose a verb fires from when it is fired on the bot where it stands now, from {@code origin} on the owner. */
    public Pose currentPose(Bot bot, AbilityContracts.Spawn origin) {
        return spawnPose(bot, origin);
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

    /** Resolves the pose used by the trigger hit geometry and presentation. */
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

    /** The ability's trigger {@code hit} verbs. */
    public List<AbilityContracts.HitVerb> hitVerbs() {
        return verbs().stream().filter(AbilityContracts.HitVerb.class::isInstance)
                .map(AbilityContracts.HitVerb.class::cast).toList();
    }

    /** The ability's trigger verbs. */
    public List<AbilityContracts.Verb> verbs() {
        AbilityContracts.AbilityContract resolved = contract != null ? contract : AbilityContracts.forAbility(abilityId);
        return resolved == null ? List.of() : resolved.onTrigger();
    }

    private Pose spawnPose(Bot bot) {
        if (bot == null) return new Pose(0, 0, 0);
        // A hit verb fires from its origin on the owner; an ability with no hit verb acts from the owner itself.
        AbilityContracts.AbilityContract resolved = contract != null ? contract : AbilityContracts.forAbility(abilityId);
        AbilityContracts.HitVerb hit = resolved == null || resolved.hitVerbs().isEmpty()
                ? null : resolved.hitVerbs().getFirst();
        return spawnPose(bot, hit == null ? null : hit.origin());
    }

    private Pose spawnPose(Bot bot, AbilityContracts.Spawn spawn) {
        if (bot == null) return new Pose(0, 0, 0);
        if (spawn == null) {
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
