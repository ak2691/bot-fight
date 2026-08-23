package com.example.botfight.simulation.core.logic;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Operand;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import java.util.List;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Applies validated custom-variable action blocks to authoritative bot state. */
@Service
public final class CustomVariableActionService {
    private static final int MAX_VARIABLE_ACTION_TERMS = 20;

    public CustomVariableActionService() {}

    public void apply(Bot bot, Bot opponent, List<Entity> entities, Arena arena,
               ConditionResolutionService conditionResolutionService, StrategyBlock block) {
        String id = block.phaseFacingMode();
        String type = bot.customVariableTypes.get(id);
        if (type == null) return;
        if ("boolean".equals(type)) {
            bot.customVariables.put(id, block.targetOffsetX() != 0);
            return;
        }
        double current = ((Number) bot.customVariables.getOrDefault(id, 0.0)).doubleValue();
        JsonNode terms = block.variableTerms();
        if (terms == null || !terms.isArray() || terms.isEmpty()) {
            double amount = resolveAmount(terms, block.targetOffsetX(), block, bot, opponent, entities, arena, conditionResolutionService);
            double next = applyOperation(current, amount, block.movementDirection());
            bot.customVariables.put(id, clampNumber(next));
            return;
        }
        double next = BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SET.equals(textValue(field(terms.get(0), "operator"), BotLogicContracts.CUSTOM_VARIABLE_OPERATION_ADD)) ? 0 : current;
        Condition context = new Condition(BotLogicContracts.CONDITION_EXPRESSION, 0, BotLogicContracts.TARGET_OPPONENT, null, null, "", null, "", "eq",
                Operand.number(0), "and");
        for (int index = 0; index < Math.min(terms.size(), MAX_VARIABLE_ACTION_TERMS); index++) {
            JsonNode term = terms.get(index);
            JsonNode operand = field(term, "operand");
            double amount = resolveAmount(operand, 0, context, bot, opponent, entities, arena, conditionResolutionService);
            String operation = normalizeOperation(textValue(field(term, "operator"), BotLogicContracts.CUSTOM_VARIABLE_OPERATION_ADD), index);
            if (BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO.equals(operation)) {
                next = modulo(next, amount);
            } else {
                next += BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SUBTRACT.equals(operation) ? -amount : amount;
            }
        }
        bot.customVariables.put(id, clampNumber(next));
    }

    private static double resolveAmount(JsonNode operand, double fallback, StrategyBlock block, Bot bot, Bot opponent,
            List<Entity> entities, Arena arena, ConditionResolutionService service) {
        return resolveAmount(operand, fallback,
                new Condition(BotLogicContracts.CONDITION_EXPRESSION, 0, BotLogicContracts.TARGET_OPPONENT, null, null, "", null, "", "eq", Operand.number(0), "and"),
                bot, opponent, entities, arena, service);
    }

    private static double resolveAmount(JsonNode operand, double fallback, Condition context, Bot bot, Bot opponent,
            List<Entity> entities, Arena arena, ConditionResolutionService service) {
        if (operand == null || !operand.isObject()) return fallback;
        if ("variable".equals(textValue(field(operand, "type"), "number"))) {
            return java.util.Optional.ofNullable(service.resolveStateVariable(
                    textValue(field(operand, "value"), ""), textValue(field(operand, "target"), "opponent"), context,
                    bot, opponent, entities, arena)).map(DuelSimulationService.StateValue::numberValue).orElse(0.0);
        }
        return numberValue(field(operand, "value"), fallback);
    }

    private static double applyOperation(double current, double amount, String operation) {
        return switch (operation) {
            case BotLogicContracts.CUSTOM_VARIABLE_OPERATION_ADD -> current + amount;
            case BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SUBTRACT -> current - amount;
            case BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO -> modulo(current, amount);
            default -> amount;
        };
    }

    private static double clampNumber(double value) {
        return BotLogicContracts.truncateToNumberPrecision(Math.max(-BotLogicContracts.CUSTOM_NUMBER_LIMIT,
                Math.min(BotLogicContracts.CUSTOM_NUMBER_LIMIT, value)));
    }

    private static String normalizeOperation(String operation, int index) {
        if (index == 0 && BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SET.equals(operation)) {
            return BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SET;
        }
        if (BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SUBTRACT.equals(operation)
                || BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO.equals(operation)) return operation;
        return BotLogicContracts.CUSTOM_VARIABLE_OPERATION_ADD;
    }

    private static double modulo(double value, double divisor) {
        long integerDivisor = BotLogicContracts.truncateToInteger(divisor);
        if (integerDivisor == 0 || !Double.isFinite(value)) return value;
        return BotLogicContracts.truncateToInteger(value) % integerDivisor;
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
}
