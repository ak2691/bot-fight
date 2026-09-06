package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import java.util.List;

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
        AttachedAbilityContracts.AttachedAbilityContract contract,
        double targetX,
        double targetY,
        String movementMode,
        String movementDirection,
        String phaseFacingMode,
        double capturedOriginX,
        double capturedOriginY,
        double capturedRotation) {

    public static AbilityExecutionPayload from(Action action) {
        if (action == null) return null;
        Integer abilityId = AttachedAbilityContracts.abilityForAction(action.abilityAction());
        return abilityId == null ? null : from(abilityId, action);
    }

    public static AbilityExecutionPayload forAbility(Integer abilityId) {
        return abilityId == null ? null : new AbilityExecutionPayload(
                abilityId,
                abilityId,
                Abilities.definition(abilityId),
                AttachedAbilityContracts.forAbility(abilityId),
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
        return new AbilityExecutionPayload(actionId, abilityId, definition, contract,
                targetX, targetY, movementMode, movementDirection, phaseFacingMode,
                bot.x, bot.y, bot.rotation);
    }

    public boolean hasCapturedPose() {
        return Double.isFinite(capturedOriginX) && Double.isFinite(capturedOriginY)
                && Double.isFinite(capturedRotation);
    }

    public AttachedAbilityContracts.Activation activation() {
        return contract == null
                ? AttachedAbilityContracts.activationFor(abilityId)
                : contract.activation();
    }

    /** Returns the active phase list for either an attached or entity ability. */
    public List<AttachedAbilityContracts.AbilityPhase> phases() {
        if (contract != null) return contract.phases();
        EntityContracts.EntityContract entity = EntityContracts.forAbility(abilityId);
        return entity == null ? List.of() : entity.phases();
    }

    private static AbilityExecutionPayload from(int abilityId, Action action) {
        return new AbilityExecutionPayload(
                action.abilityAction(),
                abilityId,
                Abilities.definition(abilityId),
                AttachedAbilityContracts.forAbility(abilityId),
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
