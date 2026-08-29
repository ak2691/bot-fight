package com.example.botfight.simulation.core.logic;

import static com.example.botfight.simulation.geometry.AngleCalculator.normalizeDegrees;
import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.DistanceCalculator.between;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.BotLogicContracts.VariableContract;
import com.example.botfight.simulation.bots.BotLogicContracts.VariableSource;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StateValue;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SelectableSnapshot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetPoint;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Velocity;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.entities.ClosingZoneSystem;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import java.util.Map;
import java.util.function.Function;

/** Resolves built-in bot variables from contract metadata and live duel state. */
final class StateVariableResolver {
    private static final ClosingZoneConfig CLOSING_ZONE_CONFIG = ClosingZoneConfig.duelV1();

    private static final Map<VariableSource, Function<ResolutionContext, StateValue>> RESOLVERS = Map.ofEntries(
            Map.entry(VariableSource.MATCH_ELAPSED_SECONDS,
                    context -> number(millisecondsToSeconds((int) context.player().matchElapsedMs))),
            Map.entry(VariableSource.SELECTABLE_DISTANCE,
                    context -> number(context.selectable() != null && context.target() != null
                            ? between(context.selectable().x(), context.selectable().y(),
                                    context.target().x(), context.target().y())
                            : Double.POSITIVE_INFINITY)),
            Map.entry(VariableSource.SELECTABLE_DAMAGE_TAKEN_LAST_TICK,
                    context -> number(selectableDamageTaken(context.selectableId(), context.selectable()))),
            Map.entry(VariableSource.SELECTABLE_HP_NET_CHANGE_LAST_TICK,
                    context -> number(selectableHpNetChange(context.selectableId(), context.selectable()))),
            Map.entry(VariableSource.SELECTABLE_X,
                    context -> number(context.selectable() == null ? 0.0 : context.selectable().x())),
            Map.entry(VariableSource.SELECTABLE_Y,
                    context -> number(context.selectable() == null ? 0.0 : context.selectable().y())),
            Map.entry(VariableSource.SELECTABLE_HP, context -> number(selectableHp(context.selectableId(), context.selectable()))),
            Map.entry(VariableSource.SELECTABLE_ABSOLUTE_BEARING,
                    context -> number(signedBearing(context.selectable(), context.target()))),
            Map.entry(VariableSource.SELECTABLE_MOVEMENT_DIRECTION,
                    context -> number(movementDirection(context.selectable()))),
            Map.entry(VariableSource.SELECTABLE_SPEED,
                    context -> number(movementSpeed(context.selectable()))),
            Map.entry(VariableSource.SELECTABLE_RELATIVE_BEARING,
                    context -> number(relativeBearing(context, false))),
            Map.entry(VariableSource.SELECTABLE_RELATIVE_BEARING_CLOCKWISE,
                    context -> number(relativeBearing(context, true))),
            Map.entry(VariableSource.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE,
                    context -> number(relativeBearing(context, false))),
            Map.entry(VariableSource.SELECTABLE_FACING,
                    context -> number(entityRotation(context.selectable()))),
            Map.entry(VariableSource.SELECTABLE_COUNT,
                    context -> number(TargetingService.matchingSelectables(
                            context.selectableId(), context.player(), context.opponent(), context.entities()).size())),
            Map.entry(VariableSource.SELECTABLE_AGE,
                    context -> number(context.selectable() instanceof SelectableSnapshot snapshot
                            ? millisecondsToSeconds(snapshot.ageMs()) : 0.0)),
            Map.entry(VariableSource.SELECTABLE_EDGE_DISTANCE,
                    context -> number(context.selectable() != null
                            ? edgeDistanceUnits(context.selectable(), context.arena()) : 0.0)),
            Map.entry(VariableSource.SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE,
                    context -> closingZoneEdgeDistance(context, context.selectable())),
            Map.entry(VariableSource.SELECTABLE_EXISTS,
                    context -> bool(context.selectable() != null)),
            Map.entry(VariableSource.SELECTABLE_ALIVE,
                    context -> bool(selectableHp(context.selectableId(), context.selectable()) > 0)),
            Map.entry(VariableSource.SELECTED_ABILITY_READY,
                    context -> bool(selectedAbilityReady(context))),
            Map.entry(VariableSource.SELECTED_ABILITY_ACTIVE,
                    context -> bool(selectedAbilityActive(context))),
            Map.entry(VariableSource.SELECTED_ABILITY_ACTIVE_MS,
                    context -> number(millisecondsToSeconds(selectedAbilityActiveMs(context)))),
            Map.entry(VariableSource.SELECTED_ABILITY_ON_COOLDOWN,
                    context -> bool(selectedAbilityOnCooldown(context))),
            Map.entry(VariableSource.SELECTED_ABILITY_COOLDOWN_MS,
                    context -> number(millisecondsToSeconds(selectedAbilityCooldownMs(context)))),
            Map.entry(VariableSource.SELECTED_ABILITY_CHARGES,
                    context -> number(selectedAbilityCharges(context))),
            Map.entry(VariableSource.SELECTED_ABILITY_PREPARING,
                    context -> bool(selectedAbilityPreparing(context))),
            Map.entry(VariableSource.SELECTED_ABILITY_PREPARATION_MS,
                    context -> number(selectedAbilityPreparationMs(context))),
            Map.entry(VariableSource.SELECTED_STATUS_EFFECT_ACTIVE,
                    context -> bool(statusEffectActive(context.bot(), context.condition().statusEffect()))),
            Map.entry(VariableSource.SELECTED_STATUS_EFFECT_DURATION_MS,
                    context -> number(millisecondsToSeconds(
                            statusEffectDurationMs(context.bot(), context.condition().statusEffect())))));

    private StateVariableResolver() {}

    static StateValue resolve(String variable, String selectableId, Condition condition,
                              Bot player, Bot opponent, java.util.List<Entity> entities, Arena arena,
                              ActionExecutionService actionExecutionService) {
        VariableContract contract = BotLogicContracts.variableContract(variable);
        if (contract == null || contract.source() == null) return null;
        if (contract.requiresHealthSelectable()
                && !BotLogicContracts.selectableSupportsCapability(selectableId, BotLogicContracts.SELECTABLE_CAPABILITY_HEALTH)) return null;
        Entity selectable = TargetingService.selectableEntity(selectableId, player, opponent, entities);
        String targetMode = normalizeTargetMode(contract, condition);
        String selectable2Id = contract.isPairVariable() && BotLogicContracts.TARGET_MODE_TARGET.equals(targetMode)
                ? condition.selectable() : null;
        Entity selectable2 = selectable2Id == null ? null : TargetingService.selectableEntity(selectable2Id, player, opponent, entities);
        Entity target = BotLogicContracts.TARGET_MODE_COORDINATES.equals(targetMode)
                ? new TargetPoint(condition.targetX(), condition.targetY(), 0)
                : BotLogicContracts.TARGET_MODE_TARGET.equals(targetMode) ? selectable2 : null;
        if (!BotLogicContracts.selectableMatchesIdentities(selectableId,
                contract.isPairVariable() ? contract.pairSelectableIdentities(0) : contract.selectableIdentities())) return null;
        if (contract.isPairVariable() && BotLogicContracts.TARGET_MODE_TARGET.equals(targetMode)
                && !BotLogicContracts.selectableMatchesIdentities(selectable2Id, contract.pairSelectableIdentities(1))) return null;
        ResolutionContext context = new ResolutionContext(
                contract, selectableId, selectable2Id, condition, targetMode, player, opponent, selectable, selectable2, target, entities, arena,
                actionExecutionService);
        Function<ResolutionContext, StateValue> resolver = RESOLVERS.get(contract.source());
        return resolver == null ? null : resolver.apply(context);
    }

    private static boolean selectedAbilityReady(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability != null && context.bot() != null
                && context.actionExecutionService().selectedAbilityReady(context.bot(), ability);
    }

    private static int selectedAbilityCooldownMs(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability == null || context.bot() == null ? 0
                : context.actionExecutionService().selectedAbilityCooldownMs(context.bot(), ability);
    }

    private static boolean selectedAbilityOnCooldown(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability != null && context.bot() != null
                && context.actionExecutionService().selectedAbilityOnCooldown(context.bot(), ability);
    }

    private static boolean selectedAbilityActive(ResolutionContext context) {
        return selectedAbilityActiveMs(context) > 0;
    }

    private static int selectedAbilityActiveMs(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability == null || context.bot() == null ? 0
                : context.actionExecutionService().selectedAbilityActiveMs(context.bot(), ability);
    }

    private static int selectedAbilityCharges(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability == null || context.bot() == null ? 0
                : context.actionExecutionService().selectedAbilityCharges(context.bot(), ability);
    }

    private static boolean selectedAbilityPreparing(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability != null && context.bot() != null
                && context.actionExecutionService().selectedAbilityPresent(context.bot(), ability)
                && ability.equals(context.bot().preparingAbility) && context.bot().preparingMs > 0;
    }

    private static double selectedAbilityPreparationMs(ResolutionContext context) {
        // Bot.preparingMs is the remaining countdown for the active wind-up.
        return selectedAbilityPreparing(context) ? millisecondsToSeconds(context.bot().preparingMs) : 0.0;
    }

    private static boolean statusEffectActive(Bot bot, String statusEffect) {
        return bot != null && BotStateService.statusActive(bot, statusEffect);
    }

    private static int statusEffectDurationMs(Bot bot, String statusEffect) {
        return bot == null ? 0 : BotStateService.statusRemainingMs(bot, statusEffect);
    }

    private static double selectableHp(String selectableId, Entity selectable) {
        if (!selectableHasUsableHealth(selectableId, selectable)) return 0;
        return selectable instanceof SelectableSnapshot snapshot ? Math.max(0, snapshot.hp())
                : selectable instanceof Bot bot ? bot.hp : 0;
    }

    private static double selectableDamageTaken(String selectableId, Entity selectable) {
        if (!selectableHasUsableHealth(selectableId, selectable)) return 0;
        return selectable instanceof SelectableSnapshot snapshot ? Math.max(0, snapshot.damageTakenLastTick())
                : selectable instanceof Bot bot ? Math.max(0, bot.damageTakenLastTick) : 0;
    }

    private static double selectableHpNetChange(String selectableId, Entity selectable) {
        if (!selectableHasUsableHealth(selectableId, selectable)) return 0;
        return selectable instanceof SelectableSnapshot snapshot ? snapshot.hpNetChangeLastTick()
                : selectable instanceof Bot bot ? bot.hpNetChangeLastTick : 0;
    }

    private static boolean selectableHasUsableHealth(String selectableId, Entity selectable) {
        return selectable != null
                && BotLogicContracts.selectableSupportsCapability(selectableId, BotLogicContracts.SELECTABLE_CAPABILITY_HEALTH);
    }

    private static double signedBearing(Entity from, Entity to) {
        if (from == null || to == null) return 0.0;
        double bearing = TargetingService.compassBearing(from, to);
        return bearing > 180 ? bearing - 360 : bearing;
    }

    private static double relativeBearing(ResolutionContext context, boolean clockwise) {
        if (context.selectable() == null) return 0.0;
        Double bearing = targetBearing(context);
        if (bearing == null) return 0.0;
        if (clockwise) {
            return TargetingService.clockwiseAngleDelta(entityRotation(context.selectable()), bearing);
        }
        if (VariableSource.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE.equals(context.contract().source())) {
            return TargetingService.clockwiseAngleDelta(bearing, entityRotation(context.selectable()));
        }
        return Math.abs(shortestDelta(entityRotation(context.selectable()), bearing));
    }

    private static Double targetBearing(ResolutionContext context) {
        if (BotLogicContracts.TARGET_MODE_ANGLE.equals(context.targetMode())) {
            return normalizeDegrees(context.condition().targetAngle());
        }
        return context.target() == null ? null : TargetingService.compassBearing(context.selectable(), context.target());
    }

    private static String normalizeTargetMode(VariableContract contract, Condition condition) {
        if (contract.targetModes().isEmpty()) return BotLogicContracts.TARGET_MODE_TARGET;
        String requested = condition == null ? null : condition.targetMode();
        if (requested != null && contract.targetModes().contains(requested)) return requested;
        return contract.targetModes().contains(BotLogicContracts.TARGET_MODE_TARGET)
                ? BotLogicContracts.TARGET_MODE_TARGET
                : contract.targetModes().iterator().next();
    }

    private static double entityRotation(Entity entity) {
        if (entity instanceof Bot bot) return normalizeDegrees(bot.rotation);
        if (entity instanceof SelectableSnapshot snapshot) return normalizeDegrees(snapshot.rotation());
        return 0.0;
    }

    private static double movementDirection(Entity selectable) {
        Velocity velocity = TargetingService.entityVelocity(selectable);
        if (velocity == null || Math.hypot(velocity.x(), velocity.y()) <= 0.001) return Double.NaN;
        double bearing = normalizeDegrees(Math.toDegrees(Math.atan2(velocity.x(), -velocity.y())));
        return bearing > 180 ? bearing - 360 : bearing;
    }

    private static double velocityMagnitude(Entity selectable) {
        Velocity velocity = TargetingService.entityVelocity(selectable);
        return velocity == null ? 0.0 : Math.hypot(velocity.x(), velocity.y());
    }

    private static double movementSpeed(Entity selectable) {
        if (selectable instanceof Bot bot) return Math.hypot(bot.movementVelocityX, bot.movementVelocityY);
        return velocityMagnitude(selectable);
    }

    private static double edgeDistanceUnits(Entity entity, Arena arena) {
        double radius = entity.size() / 2.0;
        return Math.max(0.0, Math.min(Math.min(entity.x() - radius, arena.width() - entity.x() - radius),
                Math.min(entity.y() - radius, arena.height() - entity.y() - radius)));
    }

    private static StateValue closingZoneEdgeDistance(ResolutionContext context) {
        return closingZoneEdgeDistance(context, context.bot());
    }

    private static StateValue closingZoneEdgeDistance(ResolutionContext context, Entity entity) {
        if (entity == null) return null;
        int elapsedMs = (int) Math.min(Integer.MAX_VALUE, Math.max(0, context.player().matchElapsedMs));
        if (elapsedMs < CLOSING_ZONE_CONFIG.startDelayMs()) return null;
        int updateIntervalMs = Math.max(1, CLOSING_ZONE_CONFIG.geometryUpdateMs());
        int activeElapsedMs = Math.max(0, elapsedMs - CLOSING_ZONE_CONFIG.startDelayMs());
        int geometryElapsedMs = activeElapsedMs / updateIntervalMs * updateIntervalMs;
        double safeRadius = ClosingZoneSystem.safeRadiusAt(
                CLOSING_ZONE_CONFIG.startDelayMs() + geometryElapsedMs,
                context.arena().width(), context.arena().height(), CLOSING_ZONE_CONFIG);
        if (!Double.isFinite(safeRadius)) return null;
        double centerDistance = between(entity.x(), entity.y(), context.arena().width() / 2.0, context.arena().height() / 2.0);
        return number(safeRadius - centerDistance - entity.size() / 2.0);
    }

    private static double millisecondsToSeconds(int value) {
        return value / 1000.0;
    }

    private static StateValue number(double value) {
        return StateValue.number(BotLogicContracts.truncateToNumberPrecision(value));
    }

    private static StateValue bool(boolean value) {
        return StateValue.bool(value);
    }

    private record ResolutionContext(
            VariableContract contract,
            String selectableId,
            String selectable2Id,
            Condition condition,
            String targetMode,
            Bot player,
            Bot opponent,
            Entity selectable,
            Entity selectable2,
            Entity target,
            java.util.List<Entity> entities,
            Arena arena,
            ActionExecutionService actionExecutionService) {
        Bot bot() { return selectable instanceof Bot bot ? bot : null; }

    }
}
