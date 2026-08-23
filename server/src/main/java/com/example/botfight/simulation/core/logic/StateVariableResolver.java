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
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetSnapshot;
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
            Map.entry(VariableSource.BOT_HP, context -> number(context.bot().hp)),
            Map.entry(VariableSource.BOT_DAMAGE_TAKEN_LAST_TICK,
                    context -> number(context.bot().damageTakenLastTick)),
            Map.entry(VariableSource.BOT_HP_NET_CHANGE_LAST_TICK,
                    context -> number(context.bot().hpNetChangeLastTick)),
            Map.entry(VariableSource.BOT_X, context -> number(context.bot().x)),
            Map.entry(VariableSource.BOT_Y, context -> number(context.bot().y)),
            Map.entry(VariableSource.TARGET_DISTANCE,
                    context -> number(context.target() != null
                            ? between(context.player().x, context.player().y,
                                    context.target().x(), context.target().y())
                            : Double.POSITIVE_INFINITY)),
            Map.entry(VariableSource.TARGET_HP, context -> number(targetHp(context.target()))),
            Map.entry(VariableSource.TARGET_BEARING_FROM_ME,
                    context -> number(signedBearing(context.player(), context.target()))),
            Map.entry(VariableSource.TARGET_MOVEMENT_DIRECTION,
                    context -> number(movementDirection(context.target()))),
            Map.entry(VariableSource.TARGET_SPEED,
                    context -> number(movementSpeed(context.target()))),
            Map.entry(VariableSource.BEARING_FROM_TARGET,
                    context -> number(context.target() != null
                            ? TargetingService.compassBearing(context.target(), context.player()) : 0.0)),
            Map.entry(VariableSource.TARGET_RELATIVE_BEARING,
                    context -> number(context.target() != null
                            ? Math.abs(shortestDelta(context.player().rotation,
                                    TargetingService.compassBearing(context.player(), context.target()))) : 0.0)),
            Map.entry(VariableSource.TARGET_RELATIVE_BEARING_CLOCKWISE,
                    context -> number(context.target() != null
                            ? TargetingService.clockwiseAngleDelta(context.player().rotation,
                                    TargetingService.compassBearing(context.player(), context.target())) : 0.0)),
            Map.entry(VariableSource.TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE,
                    context -> number(context.target() != null
                            ? TargetingService.clockwiseAngleDelta(
                                    TargetingService.compassBearing(context.player(), context.target()),
                                    context.player().rotation) : 0.0)),
            Map.entry(VariableSource.TARGET_FACING,
                    context -> number(context.target() instanceof Bot bot ? normalizeDegrees(bot.rotation) : 0.0)),
            Map.entry(VariableSource.TARGET_COUNT,
                    context -> number(TargetingService.matchingTargets(
                            context.targetId(), context.player(), context.opponent(), context.entities()).size())),
            Map.entry(VariableSource.TARGET_AGE,
                    context -> number(context.target() instanceof TargetSnapshot snapshot
                            ? millisecondsToSeconds(snapshot.ageMs()) : 0.0)),
            Map.entry(VariableSource.BOT_EDGE_DISTANCE,
                    context -> number(edgeDistanceUnits(context.bot(), context.arena()))),
            Map.entry(VariableSource.BOT_CLOSING_ZONE_EDGE_DISTANCE,
                    StateVariableResolver::closingZoneEdgeDistance),
            Map.entry(VariableSource.TARGET_EDGE_DISTANCE,
                    context -> number(context.target() != null
                            ? edgeDistanceUnits(context.target(), context.arena()) : 0.0)),
            Map.entry(VariableSource.TARGET_EXISTS,
                    context -> bool(context.target() != null)),
            Map.entry(VariableSource.TARGET_ALIVE,
                    context -> bool(targetHp(context.target()) > 0)),
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

    static StateValue resolve(String variable, String targetId, Condition condition,
                              Bot player, Bot opponent, java.util.List<Entity> entities, Arena arena,
                              ActionExecutionService actionExecutionService) {
        VariableContract contract = BotLogicContracts.variableContract(variable);
        if (contract == null || contract.source() == null) return null;
        if (contract.requiresHealthTarget()
                && !BotLogicContracts.targetSupportsCapability(targetId, BotLogicContracts.TARGET_CAPABILITY_HEALTH)) return null;
        Entity target = TargetingService.targetEntity(targetId, player, opponent, entities);
        ResolutionContext context = new ResolutionContext(
                contract, targetId, condition, player, opponent, target, entities, arena,
                actionExecutionService);
        Function<ResolutionContext, StateValue> resolver = RESOLVERS.get(contract.source());
        return resolver == null ? null : resolver.apply(context);
    }

    private static boolean selectedAbilityReady(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability != null && context.actionExecutionService().selectedAbilityReady(context.bot(), ability);
    }

    private static int selectedAbilityCooldownMs(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability == null ? 0 : context.actionExecutionService().selectedAbilityCooldownMs(context.bot(), ability);
    }

    private static boolean selectedAbilityOnCooldown(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability != null && context.actionExecutionService().selectedAbilityOnCooldown(context.bot(), ability);
    }

    private static boolean selectedAbilityActive(ResolutionContext context) {
        return selectedAbilityActiveMs(context) > 0;
    }

    private static int selectedAbilityActiveMs(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability == null ? 0 : context.bot().abilityActiveMs.getOrDefault(ability, 0);
    }

    private static int selectedAbilityCharges(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability == null ? 0 : context.actionExecutionService().selectedAbilityCharges(context.bot(), ability);
    }

    private static boolean selectedAbilityPreparing(ResolutionContext context) {
        Integer ability = context.condition().ability();
        return ability != null && ability.equals(context.bot().preparingAbility) && context.bot().preparingMs > 0;
    }

    private static double selectedAbilityPreparationMs(ResolutionContext context) {
        // Bot.preparingMs is the remaining countdown for the active wind-up.
        return selectedAbilityPreparing(context) ? millisecondsToSeconds(context.bot().preparingMs) : 0.0;
    }

    private static boolean statusEffectActive(Bot bot, String statusEffect) {
        return BotStateService.statusActive(bot, statusEffect);
    }

    private static int statusEffectDurationMs(Bot bot, String statusEffect) {
        return BotStateService.statusRemainingMs(bot, statusEffect);
    }

    private static double targetHp(Entity target) {
        return target instanceof TargetSnapshot snapshot ? Math.max(0, snapshot.hp())
                : target instanceof Bot bot ? bot.hp : 0;
    }

    private static double signedBearing(Entity from, Entity target) {
        if (target == null) return 0.0;
        double bearing = TargetingService.compassBearing(from, target);
        return bearing > 180 ? bearing - 360 : bearing;
    }

    private static double movementDirection(Entity target) {
        Velocity velocity = TargetingService.entityVelocity(target);
        if (velocity == null || Math.hypot(velocity.x(), velocity.y()) <= 0.001) return Double.NaN;
        double bearing = normalizeDegrees(Math.toDegrees(Math.atan2(velocity.x(), -velocity.y())));
        return bearing > 180 ? bearing - 360 : bearing;
    }

    private static double velocityMagnitude(Entity target) {
        Velocity velocity = TargetingService.entityVelocity(target);
        return velocity == null ? 0.0 : Math.hypot(velocity.x(), velocity.y());
    }

    private static double movementSpeed(Entity target) {
        if (target instanceof Bot bot) return Math.hypot(bot.movementVelocityX, bot.movementVelocityY);
        return velocityMagnitude(target);
    }

    private static double edgeDistanceUnits(Entity entity, Arena arena) {
        double radius = entity.size() / 2.0;
        return Math.max(0.0, Math.min(Math.min(entity.x() - radius, arena.width() - entity.x() - radius),
                Math.min(entity.y() - radius, arena.height() - entity.y() - radius)));
    }

    private static StateValue closingZoneEdgeDistance(ResolutionContext context) {
        int elapsedMs = (int) Math.min(Integer.MAX_VALUE, Math.max(0, context.player().matchElapsedMs));
        if (elapsedMs < CLOSING_ZONE_CONFIG.startDelayMs()) return null;
        int updateIntervalMs = Math.max(1, CLOSING_ZONE_CONFIG.geometryUpdateMs());
        int activeElapsedMs = Math.max(0, elapsedMs - CLOSING_ZONE_CONFIG.startDelayMs());
        int geometryElapsedMs = activeElapsedMs / updateIntervalMs * updateIntervalMs;
        double safeRadius = ClosingZoneSystem.safeRadiusAt(
                CLOSING_ZONE_CONFIG.startDelayMs() + geometryElapsedMs,
                context.arena().width(), context.arena().height(), CLOSING_ZONE_CONFIG);
        if (!Double.isFinite(safeRadius)) return null;
        Entity entity = context.bot();
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
            String targetId,
            Condition condition,
            Bot player,
            Bot opponent,
            Entity target,
            java.util.List<Entity> entities,
            Arena arena,
            ActionExecutionService actionExecutionService) {
        Bot bot() {
            return switch (contract.scope()) {
                case MY -> player;
                case OPPONENT -> opponent;
                case NONE, TARGET -> null;
            };

        }

    }
}
