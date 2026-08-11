package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.normalizeDegrees;
import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.DistanceCalculator.between;

import com.example.botfight.simulation.DuelSimulationService.Arena;
import com.example.botfight.simulation.DuelSimulationService.Condition;
import com.example.botfight.simulation.DuelSimulationService.Entity;
import com.example.botfight.simulation.DuelSimulationService.Bot;
import com.example.botfight.simulation.DuelSimulationService.Modulo;
import com.example.botfight.simulation.DuelSimulationService.Operand;
import com.example.botfight.simulation.DuelSimulationService.StateValue;
import com.example.botfight.simulation.DuelSimulationService.TargetSnapshot;
import com.example.botfight.simulation.DuelSimulationService.ValueType;
import com.example.botfight.simulation.DuelSimulationService.Velocity;
import com.example.botfight.simulation.bot.ConditionEvaluationService;
import java.util.List;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Resolves normalized bot conditions against the live authoritative duel state. */
@Service
public class ConditionResolutionService {
    private static final int CUSTOM_INTEGER_LIMIT = 99_999;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final java.util.Set<String> NUMERIC_COMPARATORS = java.util.Set.of("lt", "lte", "eq", "neq", "gte", "gt");

    private final ConditionEvaluationService comparisonService;
    private final ActionExecutionService actionExecutionService;

    public ConditionResolutionService(
            ConditionEvaluationService comparisonService,
            ActionExecutionService actionExecutionService) {
        this.comparisonService = comparisonService;
        this.actionExecutionService = actionExecutionService;
    }

    static List<Condition> normalizeConditions(JsonNode conditions) {
        if (conditions == null || !conditions.isArray()) return List.of();
        List<Condition> normalized = new java.util.ArrayList<>();
        int limit = Math.min(conditions.size(), MAX_TOTAL_CONDITIONS);
        for (int index = 0; index < limit; index += 1) {
            JsonNode condition = conditions.get(index);
            normalized.add(new Condition(
                    textValue(field(condition, "type"), ""),
                    numberValue(field(condition, "value"), 0.0),
                    normalizeTarget(textValue(field(condition, "target"), "opponent"), "opponent"),
                    normalizeTarget(textValue(field(condition, "leftTarget"), textValue(field(condition, "target"), "opponent")), "opponent"),
                    normalizeTarget(textValue(field(condition, "rightTarget"), textValue(field(condition, "target"), "opponent")), "opponent"),
                    textValue(field(condition, "left"), ""),
                    abilityId(field(condition, "ability")),
                    textValue(field(condition, "statusEffect"), ""),
                    textValue(field(condition, "comparator"), "lt"),
                    normalizeOperand(field(condition, "right")),
                    normalizeModulo(field(condition, "modulo"), field(condition, "right")),
                    numberValue(field(field(condition, "right"), "min"), -30.0),
                    numberValue(field(field(condition, "right"), "max"), 30.0),
                    index > 0 && "or".equals(textValue(field(condition, "join"), "and")) ? "or" : "and"));
        }
        return normalized;
    }

    boolean evaluateConditions(
            List<Condition> conditions,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        boolean matches = true;
        for (int index = 0; index < conditions.size(); index += 1) {
            Condition condition = conditions.get(index);
            boolean conditionMatches = evaluateCondition(condition, player, opponent, entities, arena);
            matches = comparisonService.combine(matches, conditionMatches, index == 0, condition.join());
        }
        return matches;
    }

    boolean selectedAbilityReady(Bot bot, int ability) {
        return actionExecutionService.selectedAbilityReady(bot, ability);
    }

    int selectedAbilityCooldownMs(Bot bot, int ability) {
        return actionExecutionService.selectedAbilityCooldownMs(bot, ability);
    }

    int selectedAbilityAmmo(Bot bot, int ability) {
        return actionExecutionService.selectedAbilityAmmo(bot, ability);
    }

    private boolean evaluateCondition(
            Condition condition,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        if ("expression".equals(condition.type())) {
            return evaluateExpressionCondition(condition, player, opponent, entities, arena);
        }
        return "always".equals(condition.type());
    }

    private boolean evaluateExpressionCondition(
            Condition condition,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        StateValue left = resolveStateVariable(
                condition.left(), condition.leftTarget(), condition,
                player, opponent, entities, arena);
        if (left == null) return false;
        if ("target.bearingFromMe".equals(condition.left())) {
            return directionFallsInRange(left.numberValue(), condition.rangeMin(), condition.rangeMax());
        }
        StateValue right = "variable".equals(condition.right().type())
                ? resolveStateVariable(condition.right().valueText(), condition.rightTarget(), condition,
                        player, opponent, entities, arena)
                : condition.right().toStateValue(left.type());
        if (right == null || left.type() != right.type()) return false;
        if ("modulo".equals(condition.comparator())) {
            if (left.type() != ValueType.NUMBER || condition.modulo() == null || !condition.modulo().valid()
                    || condition.modulo().divisor() == 0.0 || !Double.isFinite(condition.modulo().divisor())
                    || !Double.isFinite(left.numberValue()) || !Double.isFinite(right.numberValue())) return false;
            return comparisonService.compareModulo(
                    left.numberValue(), condition.modulo().divisor(),
                    condition.modulo().comparator(), right.numberValue());
        }
        return left.type() == ValueType.BOOLEAN
                ? comparisonService.compareBooleans(left.booleanValue(), condition.comparator(), right.booleanValue())
                : comparisonService.compareNumbers(left.numberValue(), condition.comparator(), right.numberValue());
    }

    StateValue resolveStateVariable(
            String variable,
            String targetId,
            Condition condition,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        if (variable != null && variable.startsWith("custom.")) {
            String type = player.customVariableTypes.get(variable);
            if (type == null) return null;
            var derived = player.customVariableConditions.get(variable);
            if (derived != null) {
                if (!player.resolvingCustomVariables.add(variable)) return StateValue.bool(false);
                boolean value = evaluateConditions(
                        normalizeConditions(derived),
                        player, opponent, entities, arena);
                player.resolvingCustomVariables.remove(variable);
                return StateValue.bool(value);
            }
            Object value = player.customVariables.get(variable);
            return "boolean".equals(type)
                    ? StateValue.bool(Boolean.TRUE.equals(value))
                    : StateValue.number(value instanceof Number number ? number.doubleValue() : 0);
        }
        Entity target = TargetingService.targetEntity(targetId, player, opponent, entities);
        if (variable.matches("^(my|opponent)\\.selectedAbility(Ready|CooldownMs|Ammo|Preparing|PreparationMs)$")) {
            Bot observed = variable.startsWith("my.") ? player : opponent;
            if (condition.ability() == null) return variable.endsWith("Ready") || variable.endsWith("Preparing")
                    ? StateValue.bool(false) : StateValue.number(0);
            int ability = condition.ability();
            if (variable.endsWith("Ready")) return StateValue.bool(selectedAbilityReady(observed, ability));
            if (variable.endsWith("CooldownMs")) return StateValue.number(millisecondsToSeconds(selectedAbilityCooldownMs(observed, ability)));
            if (variable.endsWith("Ammo")) return StateValue.number(selectedAbilityAmmo(observed, ability));
            if (variable.endsWith("Preparing")) return StateValue.bool(observed.preparingAbility != null && ability == observed.preparingAbility);
            return StateValue.number(observed.preparingAbility != null && ability == observed.preparingAbility
                    ? millisecondsToSeconds(observed.preparingMs) : 0);
        }
        if (variable.matches("^(my|opponent)\\.selectedStatusEffect(Active|DurationMs)$")) {
            Bot observed = variable.startsWith("my.") ? player : opponent;
            if (variable.endsWith("Active")) return StateValue.bool(statusEffectActive(observed, condition.statusEffect()));
            return StateValue.number(millisecondsToSeconds(statusEffectDurationMs(observed, condition.statusEffect())));
        }
        return switch (variable) {
            case "match.elapsedSeconds" -> StateValue.number(millisecondsToSeconds((int) player.matchElapsedMs));
            case "my.hp" -> StateValue.number(player.hp);
            case "my.damageTakenLastTick" -> StateValue.number(player.damageTakenLastTick);
            case "my.hpNetChangeLastTick" -> StateValue.number(player.hpNetChangeLastTick);
            case "my.x" -> StateValue.number(player.x);
            case "my.y" -> StateValue.number(player.y);
            case "opponent.hp" -> StateValue.number(opponent.hp);
            case "opponent.damageTakenLastTick" -> StateValue.number(opponent.damageTakenLastTick);
            case "opponent.hpNetChangeLastTick" -> StateValue.number(opponent.hpNetChangeLastTick);
            case "opponent.x" -> StateValue.number(opponent.x);
            case "opponent.y" -> StateValue.number(opponent.y);
            case "my.slowedMs" -> StateValue.number(millisecondsToSeconds(player.slowedMs));
            case "opponent.slowedMs" -> StateValue.number(millisecondsToSeconds(opponent.slowedMs));
            case "target.distance" -> StateValue.number(target != null
                    ? between(player.x, player.y, target.x(), target.y()) : Double.POSITIVE_INFINITY);
            case "target.hp" -> StateValue.number(target instanceof TargetSnapshot targetSnapshot ? Math.max(0, targetSnapshot.hp())
                    : target instanceof Bot bot ? bot.hp : 0);
            case "target.bearingFromMe" -> {
                double bearing = target != null ? TargetingService.compassBearing(player, target) : 0.0;
                yield StateValue.number(bearing > 180 ? bearing - 360 : bearing);
            }
            case "target.movementDirection" -> {
                Velocity velocity = TargetingService.entityVelocity(target);
                if (velocity == null || Math.hypot(velocity.x(), velocity.y()) <= 0.001) yield StateValue.number(Double.NaN);
                double bearing = normalizeDegrees(Math.toDegrees(Math.atan2(velocity.x(), -velocity.y())));
                yield StateValue.number(bearing > 180 ? bearing - 360 : bearing);
            }
            case "target.velocity" -> {
                Velocity velocity = TargetingService.entityVelocity(target);
                yield StateValue.number(velocity == null ? 0 : Math.hypot(velocity.x(), velocity.y()));
            }
            case "my.bearingFromTarget" -> StateValue.number(target != null ? TargetingService.compassBearing(target, player) : 0.0);
            case "target.relativeBearing" -> StateValue.number(target != null
                    ? Math.abs(shortestDelta(player.rotation, TargetingService.compassBearing(player, target))) : 0.0);
            case "target.relativeBearingClockwise" -> StateValue.number(target != null
                    ? TargetingService.clockwiseAngleDelta(player.rotation, TargetingService.compassBearing(player, target)) : 0.0);
            case "target.relativeBearingCounterclockwise" -> StateValue.number(target != null
                    ? TargetingService.clockwiseAngleDelta(TargetingService.compassBearing(player, target), player.rotation) : 0.0);
            case "target.facing" -> StateValue.number(target instanceof Bot bot ? normalizeDegrees(bot.rotation) : 0.0);
            case "target.count" -> StateValue.number(TargetingService.matchingTargets(
                    targetId, player, opponent, entities).size());
            case "target.age" -> StateValue.number(target instanceof TargetSnapshot targetSnapshot
                    && targetSnapshot.id().startsWith("ability:")
                    ? millisecondsToSeconds(targetSnapshot.usesRemaining()) : 0.0);
            case "my.edgeDistance" -> StateValue.number(edgeDistanceUnits(player, arena));
            case "target.edgeDistance" -> StateValue.number(target != null ? edgeDistanceUnits(target, arena) : 0.0);
            case "target.exists" -> StateValue.bool(target != null);
            case "target.alive" -> StateValue.bool(target instanceof TargetSnapshot targetSnapshot
                    ? targetSnapshot.hp() > 0 : target instanceof Bot bot && bot.hp > 0);
            case "my.jammed" -> StateValue.bool(player.jammedMs > 0);
            case "my.commandLocked" -> StateValue.bool(player.commandLockedMs > 0);
            case "opponent.jammed" -> StateValue.bool(opponent.jammedMs > 0);
            case "opponent.commandLocked" -> StateValue.bool(opponent.commandLockedMs > 0);
            default -> null;
        };
    }

    private static Integer abilityId(JsonNode node) {
        return node != null && node.isIntegralNumber() && node.canConvertToInt() ? node.intValue() : null;
    }

    private static boolean statusEffectActive(Bot bot, String statusEffect) {
        return statusEffectDurationMs(bot, statusEffect) > 0
                || ("silence".equals(statusEffect) && bot.nullZoneSilenced);
    }

    private static int statusEffectDurationMs(Bot bot, String statusEffect) {
        return switch (statusEffect) {
            case "burn" -> bot.burnRemainingMs;
            case "stun" -> bot.stunnedMs;
            case "bleed" -> bot.bleedRemainingMs;
            case "slow" -> bot.slowedMs;
            case "shock" -> bot.shockRemainingMs;
            case "silence" -> bot.silencedMs;
            default -> 0;
        };
    }

    private static double millisecondsToSeconds(int value) {
        return value / 1000.0;
    }

    private static boolean directionFallsInRange(double value, double start, double end) {
        double rawSpan = end - start;
        if (!Double.isFinite(value) || !Double.isFinite(start) || !Double.isFinite(end) || Math.abs(rawSpan) > 360) return false;
        double span = Math.abs(rawSpan) == 360 ? 360 : rawSpan >= 0 ? rawSpan : 360 + rawSpan;
        double distance = ((value - start) % 360 + 360) % 360;
        return distance <= span + 1e-9;
    }

    private static double edgeDistanceUnits(Entity entity, Arena arena) {
        double radius = entity.size() / 2.0;
        return Math.min(Math.min(entity.x() - radius, arena.width() - entity.x() - radius),
                Math.min(entity.y() - radius, arena.height() - entity.y() - radius));
    }

    private static Modulo normalizeModulo(JsonNode modulo, JsonNode right) {
        if (modulo == null || !modulo.isObject()) return null;
        JsonNode divisorNode = modulo.get("divisor");
        String comparator = textValue(modulo.get("comparator"), "");
        boolean validDivisor = isValidModuloInteger(divisorNode);
        boolean validComparator = NUMERIC_COMPARATORS.contains(comparator);
        boolean validRight = right != null && right.isObject()
                && ("number".equals(textValue(right.get("type"), ""))
                    ? isValidModuloInteger(right.get("value"))
                    : "variable".equals(textValue(right.get("type"), ""))
                        && right.get("value") != null && right.get("value").isTextual());
        return new Modulo(validDivisor ? Math.floor(divisorNode.asDouble()) : 0.0,
                comparator, validDivisor && validComparator && validRight);
    }

    private static boolean isValidModuloInteger(JsonNode value) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble())) return false;
        double integerValue = Math.floor(value.asDouble());
        return integerValue >= -CUSTOM_INTEGER_LIMIT && integerValue <= CUSTOM_INTEGER_LIMIT;
    }

    private static Operand normalizeOperand(JsonNode node) {
        if (node == null || !node.isObject()) return Operand.number(0.0);
        String type = textValue(node.get("type"), "number");
        if ("variable".equals(type)) return Operand.variable(textValue(node.get("value"), ""));
        if ("boolean".equals(type)) return Operand.bool(booleanValue(node.get("value"), true));
        return Operand.number(numberValue(node.get("value"), 0.0));
    }

    private static String normalizeTarget(String target, String fallback) {
        if (target == null) return fallback;
        if ("opponent".equals(target) || "orbital_zone".equals(target)
                || target.startsWith("opponent_")) return target;
        return fallback;
    }

    private static JsonNode field(JsonNode node, String name) {
        return node != null && node.isObject() ? node.get(name) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber() ? node.asDouble() : fallback;
    }

    private static boolean booleanValue(JsonNode node, boolean fallback) {
        if (node == null) return fallback;
        if (node.isBoolean()) return node.asBoolean();
        if (node.isNumber()) return node.asInt() != 0;
        if (node.isTextual()) {
            if ("true".equalsIgnoreCase(node.asText()) || "1".equals(node.asText())) return true;
            if ("false".equalsIgnoreCase(node.asText()) || "0".equals(node.asText())) return false;
        }
        return fallback;
    }
}
