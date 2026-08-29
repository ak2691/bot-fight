package com.example.botfight.simulation.core.logic;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Operand;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StateValue;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.ValueType;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.geometry.ArenaUnits;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Resolves normalized bot conditions against the live authoritative duel state. */
@Service
public class ConditionResolutionService {
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final int MAX_ENUMERATED_ANGLE_GROUPS = 8;

    private final ConditionEvaluationService comparisonService;
    private final ActionExecutionService actionExecutionService;

    public ConditionResolutionService(
            ConditionEvaluationService comparisonService,
            ActionExecutionService actionExecutionService) {
        this.comparisonService = comparisonService;
        this.actionExecutionService = actionExecutionService;
    }

    public static List<Condition> normalizeConditions(JsonNode conditions) {
        if (conditions == null || !conditions.isArray()) return List.of();
        List<Condition> normalized = new java.util.ArrayList<>();
        int limit = Math.min(conditions.size(), MAX_TOTAL_CONDITIONS);
        for (int index = 0; index < limit; index += 1) {
            JsonNode condition = conditions.get(index);
            String sharedSelectable = textValue(field(condition, "selectable"), null);
            String left = textValue(field(condition, "left"), "");
            JsonNode rightNode = field(condition, "right");
            String rightVariable = "variable".equals(textValue(field(rightNode, "type"), ""))
                    ? textValue(field(rightNode, "value"), "") : "";
            BotLogicContracts.VariableContract leftContract = BotLogicContracts.variableContract(left);
            BotLogicContracts.VariableContract rightContract = BotLogicContracts.variableContract(rightVariable);
            String leftFallback = BotLogicContracts.defaultSelectableForVariable(leftContract);
            String rightFallback = BotLogicContracts.defaultSelectableForVariable(rightContract);
            String pairFirstFallback = BotLogicContracts.defaultSelectable1ForVariable(leftContract);
            String pairSecondFallback = BotLogicContracts.defaultSelectable2ForVariable(leftContract);
            String leftSelectable = leftContract != null && leftContract.isPairVariable()
                    ? textValue(field(condition, "selectable1"),
                            pairFirstFallback)
                    : textValue(field(condition, "leftSelectable"),
                            sharedSelectable != null ? sharedSelectable : leftFallback);
            String pairSecondSelectable = leftContract != null && leftContract.isPairVariable()
                    ? textValue(field(condition, "selectable2"),
                            field(condition, "selectable1") == null
                                    ? (sharedSelectable != null ? sharedSelectable : pairSecondFallback)
                                    : pairSecondFallback)
                    : null;
            String rightSelectable = textValue(field(condition, "rightSelectable"),
                    sharedSelectable != null ? sharedSelectable : rightFallback);
            String normalizedSelectable = leftContract != null && leftContract.isPairVariable()
                    ? normalizeSelectable(pairSecondSelectable, pairSecondFallback,
                            leftContract.pairSelectableIdentities(1), leftContract)
                    : normalizeSelectable(sharedSelectable, BotLogicContracts.SELECTABLE_OPPONENT, null, null);
            String targetMode = normalizeTargetMode(condition, leftContract);
            double targetX = coordinateValue(field(condition, "targetX"), ArenaUnits.WIDTH / 2.0, ArenaUnits.WIDTH);
            double targetY = coordinateValue(field(condition, "targetY"), ArenaUnits.HEIGHT / 2.0, ArenaUnits.HEIGHT);
            double targetAngle = angleValue(field(condition, "targetAngle"), 0.0);
            normalized.add(new Condition(
                    textValue(field(condition, "type"), ""),
                    numberValue(field(condition, "value"), 0.0),
                    normalizedSelectable,
                    normalizeSelectable(leftSelectable,
                            leftContract != null && leftContract.isPairVariable() ? pairFirstFallback : leftFallback,
                            leftContract != null && leftContract.isPairVariable()
                                    ? leftContract.pairSelectableIdentities(0)
                                    : leftContract == null ? null : leftContract.selectableIdentities(),
                            leftContract),
                    normalizeSelectable(rightSelectable, rightFallback,
                            rightContract == null ? null : rightContract.selectableIdentities(),
                            rightContract),
                    left,
                    abilityId(field(condition, "ability")),
                    textValue(field(condition, "statusEffect"), ""),
                    textValue(field(condition, "comparator"), "lt"),
                    normalizeOperand(rightNode),
                    index > 0 && BotLogicContracts.JOIN_OR.equals(textValue(field(condition, "join"), "and")) ? BotLogicContracts.JOIN_OR : "and",
                    targetMode,
                    targetX,
                    targetY,
                    targetAngle));
        }
        return normalized;
    }

    public boolean evaluateConditions(
            List<Condition> conditions,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        List<AngleGroup> angleGroups = collectRepeatedAngleGroups(conditions, player, opponent, entities, arena);
        if (angleGroups.isEmpty()) return evaluateConditionsDirect(conditions, player, opponent, entities, arena, Map.of());
        if (allConditionsUseAnd(conditions)) {
            return evaluateAllAndAngleGroups(conditions, player, opponent, entities, arena, angleGroups);
        }
        if (angleGroups.size() > MAX_ENUMERATED_ANGLE_GROUPS) {
            return evaluateConditionsDirect(conditions, player, opponent, entities, arena, Map.of());
        }
        return evaluateAngleVariants(
                conditions, player, opponent, entities, arena, angleGroups, 0, new HashMap<>());
    }

    private boolean evaluateConditionsDirect(
            List<Condition> conditions,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            Map<String, Double> angleOverrides) {
        boolean matches = true;
        for (int index = 0; index < conditions.size(); index += 1) {
            Condition condition = conditions.get(index);
            boolean conditionMatches = evaluateCondition(
                    condition, player, opponent, entities, arena, angleOverrides);
            matches = comparisonService.combine(matches, conditionMatches, index == 0, condition.join());
        }
        return matches;
    }

    private boolean evaluateAllAndAngleGroups(
            List<Condition> conditions,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            List<AngleGroup> groups) {
        Map<String, List<Condition>> groupedConditions = new LinkedHashMap<>();
        for (AngleGroup group : groups) groupedConditions.put(group.key(), new ArrayList<>());
        for (Condition condition : conditions) {
            if (!BotLogicContracts.CONDITION_EXPRESSION.equals(condition.type())) continue;
            List<Condition> group = groupedConditions.get(angleConditionGroupKey(condition));
            if (group != null) group.add(condition);
        }
        for (AngleGroup group : groups) {
            boolean matches = false;
            for (double value : group.values()) {
                Map<String, Double> overrides = Map.of(group.key(), value);
                boolean groupMatches = true;
                for (Condition condition : groupedConditions.get(group.key())) {
                    if (!evaluateExpressionCondition(condition, player, opponent, entities, arena, overrides)) {
                        groupMatches = false;
                        break;
                    }
                }
                if (groupMatches) {
                    matches = true;
                    break;
                }
            }
            if (!matches) return false;
        }
        for (Condition condition : conditions) {
            if (BotLogicContracts.CONDITION_EXPRESSION.equals(condition.type())
                    && groupedConditions.containsKey(angleConditionGroupKey(condition))) continue;
            if (!evaluateCondition(condition, player, opponent, entities, arena, Map.of())) return false;
        }
        return true;
    }

    private static boolean allConditionsUseAnd(List<Condition> conditions) {
        for (int index = 1; index < conditions.size(); index += 1) {
            if (BotLogicContracts.JOIN_OR.equals(conditions.get(index).join())) return false;
        }
        return true;
    }

    private List<AngleGroup> collectRepeatedAngleGroups(
            List<Condition> conditions,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        Map<String, List<Double>> variantsByKey = new LinkedHashMap<>();
        Map<String, Integer> countsByKey = new HashMap<>();
        for (Condition condition : conditions) {
            if (!BotLogicContracts.CONDITION_EXPRESSION.equals(condition.type())) continue;
            BotLogicContracts.VariableContract contract = BotLogicContracts.variableContract(condition.left());
            if (contract == null || !contract.circularAngle()) continue;
            StateValue left = resolveStateVariable(
                    condition.left(), condition.leftSelectable(), condition,
                    player, opponent, entities, arena);
            if (left == null || left.type() != ValueType.NUMBER || !Double.isFinite(left.numberValue())) continue;
            String key = angleConditionGroupKey(condition);
            variantsByKey.putIfAbsent(key, angleRepresentations(left.numberValue()));
            countsByKey.merge(key, 1, Integer::sum);
        }
        List<AngleGroup> groups = new ArrayList<>();
        for (Map.Entry<String, List<Double>> entry : variantsByKey.entrySet()) {
            if (countsByKey.getOrDefault(entry.getKey(), 0) > 1) {
                groups.add(new AngleGroup(entry.getKey(), entry.getValue()));
            }
        }
        return groups;
    }

    private boolean evaluateAngleVariants(
            List<Condition> conditions,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            List<AngleGroup> groups,
            int groupIndex,
            Map<String, Double> angleOverrides) {
        if (groupIndex >= groups.size()) {
            return evaluateConditionsDirect(conditions, player, opponent, entities, arena, angleOverrides);
        }
        AngleGroup group = groups.get(groupIndex);
        for (double value : group.values()) {
            angleOverrides.put(group.key(), value);
            boolean matches = evaluateAngleVariants(
                    conditions, player, opponent, entities, arena, groups, groupIndex + 1, angleOverrides);
            angleOverrides.remove(group.key());
            if (matches) return true;
        }
        return false;
    }

    private boolean evaluateCondition(
            Condition condition,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            Map<String, Double> angleOverrides) {
        if (BotLogicContracts.CONDITION_EXPRESSION.equals(condition.type())) {
            return evaluateExpressionCondition(condition, player, opponent, entities, arena, angleOverrides);
        }
        return BotLogicContracts.CONDITION_ALWAYS.equals(condition.type());
    }

    private boolean evaluateExpressionCondition(
            Condition condition,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            Map<String, Double> angleOverrides) {
        BotLogicContracts.VariableContract leftContract = BotLogicContracts.variableContract(condition.left());
        String angleKey = leftContract != null && leftContract.circularAngle()
                ? angleConditionGroupKey(condition) : null;
        boolean hasAngleOverride = angleKey != null && angleOverrides.containsKey(angleKey);
        StateValue left = hasAngleOverride
                ? StateValue.number(BotLogicContracts.truncateToNumberPrecision(angleOverrides.get(angleKey)))
                : resolveStateVariable(
                        condition.left(), condition.leftSelectable(), condition,
                        player, opponent, entities, arena);
        if (left == null) return false;
        if (leftContract != null && leftContract.requiresHealthSelectable()
                && !BotLogicContracts.selectableSupportsCapability(condition.leftSelectable(), BotLogicContracts.SELECTABLE_CAPABILITY_HEALTH)) return false;
        StateValue right = "variable".equals(condition.right().type())
                ? resolveStateVariable(condition.right().valueText(), condition.rightSelectable(), condition,
                        player, opponent, entities, arena)
                : condition.right().toStateValue(left.type());
        if (right == null || left.type() != right.type()) return false;
        BotLogicContracts.VariableContract rightContract = "variable".equals(condition.right().type())
                ? BotLogicContracts.variableContract(condition.right().valueText()) : null;
        if (rightContract != null && rightContract.requiresHealthSelectable()
                && !BotLogicContracts.selectableSupportsCapability(condition.rightSelectable(), BotLogicContracts.SELECTABLE_CAPABILITY_HEALTH)) return false;
        return left.type() == ValueType.BOOLEAN
                ? comparisonService.compareBooleans(left.booleanValue(), condition.comparator(), right.booleanValue())
                : leftContract != null && leftContract.circularAngle()
                        ? hasAngleOverride
                                && !"eq".equals(condition.comparator())
                                && !"neq".equals(condition.comparator())
                                ? comparisonService.compareNumbers(left.numberValue(), condition.comparator(), right.numberValue())
                                : comparisonService.compareAngles(left.numberValue(), condition.comparator(), right.numberValue())
                        : comparisonService.compareNumbers(left.numberValue(), condition.comparator(), right.numberValue());
    }

    private static String angleConditionGroupKey(Condition condition) {
        BotLogicContracts.VariableContract contract = BotLogicContracts.variableContract(condition.left());
        if (contract != null && contract.isPairVariable()) {
            return condition.left() + "|" + condition.leftSelectable() + "|" + targetConditionKey(condition, contract);
        }
        return condition.left() + "|" + condition.leftSelectable();
    }

    private static String targetConditionKey(Condition condition, BotLogicContracts.VariableContract contract) {
        String targetMode = conditionTargetMode(condition, contract);
        if (BotLogicContracts.TARGET_MODE_COORDINATES.equals(targetMode)) {
            return BotLogicContracts.TARGET_MODE_COORDINATES + "|" + condition.targetX() + "|" + condition.targetY();
        }
        if (BotLogicContracts.TARGET_MODE_ANGLE.equals(targetMode)) {
            return BotLogicContracts.TARGET_MODE_ANGLE + "|" + condition.targetAngle();
        }
        return BotLogicContracts.TARGET_MODE_TARGET + "|" + condition.selectable();
    }

    private static String conditionTargetMode(Condition condition, BotLogicContracts.VariableContract contract) {
        if (contract == null || contract.targetModes().isEmpty()) return BotLogicContracts.TARGET_MODE_TARGET;
        if (condition.targetMode() != null && contract.targetModes().contains(condition.targetMode())) return condition.targetMode();
        return contract.targetModes().contains(BotLogicContracts.TARGET_MODE_TARGET)
                ? BotLogicContracts.TARGET_MODE_TARGET
                : contract.targetModes().iterator().next();
    }

    private static List<Double> angleRepresentations(double value) {
        double positive = ((value % 360.0) + 360.0) % 360.0;
        double negative = positive - 360.0;
        return positive == negative ? List.of(positive) : List.of(positive, negative);
    }

    private record AngleGroup(String key, List<Double> values) {}

    public StateValue resolveStateVariable(
            String variable,
            String selectableId,
            Condition condition,
            Bot player,
            Bot opponent,
            List<Entity> entities,
            Arena arena) {
        if (variable != null && variable.startsWith(BotLogicContracts.CUSTOM_VARIABLE_PREFIX)) {
            String type = player.customVariableTypes.get(variable);
            if (type == null) return null;
            Object value = player.customVariables.get(variable);
            return "boolean".equals(type)
                    ? StateValue.bool(Boolean.TRUE.equals(value))
                    : StateValue.number(BotLogicContracts.truncateToNumberPrecision(
                            value instanceof Number number ? number.doubleValue() : 0));
        }
        return StateVariableResolver.resolve(variable, selectableId, condition,
                player, opponent, entities, arena, actionExecutionService);
    }

    private static Integer abilityId(JsonNode node) {
        return node != null && node.isIntegralNumber() && node.canConvertToInt() ? node.intValue() : null;
    }

    private static Operand normalizeOperand(JsonNode node) {
        if (node == null || !node.isObject()) return Operand.number(0.0);
        String type = textValue(node.get("type"), "number");
        if ("variable".equals(type)) return Operand.variable(textValue(node.get("value"), ""));
        if ("boolean".equals(type)) return Operand.bool(booleanValue(node.get("value"), true));
        return Operand.number(numberValue(node.get("value"), 0.0));
    }

    private static String normalizeSelectable(String selectable, String fallback,
                                          java.util.Set<BotLogicContracts.SelectableIdentity> requiredSelectableIdentities,
                                          BotLogicContracts.VariableContract variable) {
        if (selectable == null) return BotLogicContracts.canonicalSelectableId(fallback);
        String candidate = variable != null && !variable.selectableOrderable()
                ? selectable.split(":", -1)[0] : selectable;
        candidate = BotLogicContracts.canonicalSelectableId(candidate);
        String base = candidate.split(":", -1)[0];
        if (BotLogicContracts.isAllowedSelectable(candidate)
                && (variable == null || !variable.requiresHealthSelectable()
                    || BotLogicContracts.selectableSupportsCapability(candidate, BotLogicContracts.SELECTABLE_CAPABILITY_HEALTH))
                && BotLogicContracts.selectableMatchesIdentities(base, requiredSelectableIdentities)) return candidate;
        return BotLogicContracts.canonicalSelectableId(fallback);
    }

    private static JsonNode field(JsonNode node, String name) {
        return node != null && node.isObject() ? node.get(name) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber()
                ? BotLogicContracts.truncateToNumberPrecision(node.asDouble())
                : fallback;
    }

    private static String normalizeTargetMode(JsonNode condition, BotLogicContracts.VariableContract contract) {
        if (contract == null || contract.targetModes().isEmpty()) return null;
        String requested = textValue(field(condition, "targetMode"), null);
        if (requested == null) {
            requested = field(condition, "targetX") != null || field(condition, "targetY") != null
                    ? BotLogicContracts.TARGET_MODE_COORDINATES
                    : field(condition, "targetAngle") != null ? BotLogicContracts.TARGET_MODE_ANGLE : BotLogicContracts.TARGET_MODE_TARGET;
        }
        if (contract.targetModes().contains(requested)) return requested;
        return contract.targetModes().contains(BotLogicContracts.TARGET_MODE_TARGET)
                ? BotLogicContracts.TARGET_MODE_TARGET
                : contract.targetModes().iterator().next();
    }

    private static double coordinateValue(JsonNode node, double fallback, double maximum) {
        if (node == null || !node.isNumber() || !Double.isFinite(node.asDouble())) return fallback;
        return BotLogicContracts.truncateToNumberPrecision(Math.max(0.0, Math.min(maximum, node.asDouble())));
    }

    private static double angleValue(JsonNode node, double fallback) {
        if (node == null || !node.isNumber() || !Double.isFinite(node.asDouble())) return fallback;
        return BotLogicContracts.truncateToNumberPrecision(Math.max(BotLogicContracts.ANGLE_MIN,
                Math.min(BotLogicContracts.ANGLE_MAX, node.asDouble())));
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
