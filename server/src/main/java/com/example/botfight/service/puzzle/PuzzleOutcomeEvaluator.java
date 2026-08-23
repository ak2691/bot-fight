package com.example.botfight.service.puzzle;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Evaluates a saved puzzle's conditions against authoritative duel ticks. */
final class PuzzleOutcomeEvaluator {
    private static final Set<String> FULL_CONDITION_TYPES = Set.of(
            BotLogicContracts.CONDITION_ALWAYS,
            BotLogicContracts.CONDITION_EXPRESSION);
    private static final String PUZZLE_VARIABLE_PREFIX = "custom.puzzle.";
    private static final String PUZZLE_LOGIC_VERSION = "bot-logic-tree-v1";

    private final ConditionResolutionService conditionResolutionService;
    private final ActionExecutionService actionExecutionService;
    private final JsonNode winConditions;
    private final JsonNode loseConditions;
    private final JsonNode logicConfiguration;
    private final List<Condition> normalizedWinConditions;
    private final List<Condition> normalizedLoseConditions;
    private final int timeLimitMs;
    private final int initialElapsedMs;
    private final boolean usesPuzzleLogic;

    private boolean puzzleVariablesInitialized;
    private double previousPlayerHp = Double.NaN;
    private double previousOpponentHp = Double.NaN;
    private double playerDamageTaken;
    private double opponentDamageTaken;
    private int playerHitsLanded;
    private int opponentHitsLanded;
    private int playerAbilityUses;
    private int opponentAbilityUses;
    private int elapsedMs;
    private String status;

    PuzzleOutcomeEvaluator(
            ConditionResolutionService conditionResolutionService,
            JsonNode winConditions,
            JsonNode loseConditions,
            int timeLimitMs) {
        this(conditionResolutionService, null, winConditions, loseConditions, null, timeLimitMs, 0);
    }

    PuzzleOutcomeEvaluator(
            ConditionResolutionService conditionResolutionService,
            ActionExecutionService actionExecutionService,
            JsonNode winConditions,
            JsonNode loseConditions,
            JsonNode logicConfiguration,
            int timeLimitMs) {
        this(conditionResolutionService, actionExecutionService, winConditions, loseConditions,
                logicConfiguration, timeLimitMs, 0);
    }

    PuzzleOutcomeEvaluator(
            ConditionResolutionService conditionResolutionService,
            ActionExecutionService actionExecutionService,
            JsonNode winConditions,
            JsonNode loseConditions,
            JsonNode logicConfiguration,
            int timeLimitMs,
            int initialElapsedMs) {
        this.conditionResolutionService = conditionResolutionService;
        this.actionExecutionService = actionExecutionService;
        this.winConditions = winConditions;
        this.loseConditions = loseConditions;
        this.logicConfiguration = logicConfiguration;
        this.normalizedWinConditions = ConditionResolutionService.normalizeConditions(winConditions);
        this.normalizedLoseConditions = ConditionResolutionService.normalizeConditions(loseConditions);
        this.timeLimitMs = Math.max(0, timeLimitMs);
        this.initialElapsedMs = Math.max(0, initialElapsedMs);
        this.usesPuzzleLogic = logicConfiguration != null
                && logicConfiguration.isObject()
                && PUZZLE_LOGIC_VERSION.equals(logicConfiguration.path("version").asText(""))
                && logicConfiguration.path("roots").isArray();
    }

    boolean afterTick(int nextElapsedMs, List<Bot> bots, List<ArenaEntity> entities, Arena arena) {
        if (status != null) return true;
        elapsedMs = Math.max(0, nextElapsedMs);
        if (bots == null || bots.size() < 2) {
            status = "failed";
            return true;
        }

        Bot player = bots.get(0);
        Bot opponent = bots.get(1);
        updateMetrics(player, opponent);
        List<DuelSimulationService.Entity> targetEntities = entities == null
                ? List.of()
                : entities.stream()
                        .<DuelSimulationService.Entity>map(entity -> new DuelSimulationService.TargetSnapshot(
                                "puzzle:" + entity.id(),
                                entity.type(),
                                entity.x(),
                                entity.y(),
                                entity.size(),
                                entity.ageMs(),
                                entity.hp(),
                                entity.velocityX(),
                                entity.velocityY(),
                                entity.abilityId(),
                                entity.ownerSlot()))
                        .toList();

        if (usesPuzzleLogic) {
            initializePuzzleVariables(player);
            applyPuzzleModifyRules(player, opponent, targetEntities, arena);
        }

        if (matchesWin(player, opponent, targetEntities, arena)) {
            status = "solved";
        } else if (matchesLose(player, opponent, targetEntities, arena)) {
            status = "failed";
        } else if (elapsedMs >= timeLimitMs) {
            status = "failed";
        }
        return status != null;
    }

    String status() {
        return status == null ? "failed" : status;
    }

    int elapsedMs() {
        return elapsedMs;
    }

    private void updateMetrics(Bot player, Bot opponent) {
        double playerHp = numeric(player.hp);
        double opponentHp = numeric(opponent.hp);
        playerDamageTaken += Math.max(0, numeric(player.damageTakenLastTick));
        opponentDamageTaken += Math.max(0, numeric(opponent.damageTakenLastTick));
        if (Double.isFinite(previousOpponentHp) && opponentHp < previousOpponentHp) playerHitsLanded += 1;
        if (Double.isFinite(previousPlayerHp) && playerHp < previousPlayerHp) opponentHitsLanded += 1;
        if (player.triggeredAbility != null) playerAbilityUses += 1;
        if (opponent.triggeredAbility != null) opponentAbilityUses += 1;
        previousPlayerHp = playerHp;
        previousOpponentHp = opponentHp;
    }

    private boolean matchesWin(Bot player, Bot opponent, List<DuelSimulationService.Entity> entities, Arena arena) {
        if (usesPuzzleLogic) return matchesPuzzleRules("win", player, opponent, entities, arena);
        return matches(winConditions, normalizedWinConditions, true, player, opponent, entities, arena);
    }

    private boolean matchesLose(Bot player, Bot opponent, List<DuelSimulationService.Entity> entities, Arena arena) {
        if (usesPuzzleLogic) return matchesPuzzleRules("lose", player, opponent, entities, arena);
        return matches(loseConditions, normalizedLoseConditions, false, player, opponent, entities, arena);
    }

    private boolean matchesPuzzleRules(
            String kind,
            Bot player,
            Bot opponent,
            List<DuelSimulationService.Entity> entities,
            Arena arena) {
        JsonNode roots = logicConfiguration.path("roots");
        for (JsonNode root : roots) {
            if (!kind.equals(root.path("kind").asText(""))) continue;
            JsonNode branches = root.get("branches");
            if (branches == null || !branches.isArray()) continue;
            for (JsonNode branch : branches) {
                if (matchesPuzzleBranch(branch, player, opponent, entities, arena)) return true;
            }
        }
        return false;
    }

    private boolean matchesPuzzleBranch(
            JsonNode branch,
            Bot player,
            Bot opponent,
            List<DuelSimulationService.Entity> entities,
            Arena arena) {
        JsonNode conditions = branch == null ? null : branch.get("conditions");
        if (conditions == null || !conditions.isArray() || conditions.isEmpty()) return false;
        return conditionResolutionService.evaluateConditions(
                ConditionResolutionService.normalizeConditions(conditions),
                player,
                opponent,
                entities,
                arena);
    }

    private void initializePuzzleVariables(Bot player) {
        if (puzzleVariablesInitialized) return;
        JsonNode variables = logicConfiguration.get("customVariables");
        if (variables != null && variables.isArray()) {
            for (JsonNode variable : variables) {
                String id = variable.path("id").asText("");
                if (!id.startsWith(PUZZLE_VARIABLE_PREFIX)) continue;
                String type = variable.path("valueType").asText("number");
                player.customVariableTypes.put(id, type);
                if ("boolean".equals(type)) {
                    player.customVariables.put(id, variable.path("initialValue").asBoolean(false));
                } else {
                    double initial = variable.path("initialValue").asDouble(0);
                    player.customVariables.put(id, BotLogicContracts.truncateToNumberPrecision(
                            Math.max(-BotLogicContracts.CUSTOM_NUMBER_LIMIT,
                                    Math.min(BotLogicContracts.CUSTOM_NUMBER_LIMIT, initial))));
                }
            }
        }
        puzzleVariablesInitialized = true;
    }

    private void applyPuzzleModifyRules(
            Bot player,
            Bot opponent,
            List<DuelSimulationService.Entity> entities,
            Arena arena) {
        if (actionExecutionService == null) return;
        JsonNode roots = logicConfiguration.path("roots");
        for (JsonNode root : roots) {
            if (!"modify".equals(root.path("kind").asText(""))) continue;
            JsonNode branches = root.get("branches");
            if (branches == null || !branches.isArray()) continue;
            for (JsonNode branch : branches) {
                if (!matchesPuzzleBranch(branch, player, opponent, entities, arena)) continue;
                JsonNode actions = branch.get("actions");
                if (actions == null || !actions.isArray()) continue;
                for (JsonNode action : actions) applyPuzzleVariableAction(action, branch, player, opponent, entities, arena);
            }
        }
    }

    private void applyPuzzleVariableAction(
            JsonNode action,
            JsonNode branch,
            Bot player,
            Bot opponent,
            List<DuelSimulationService.Entity> entities,
            Arena arena) {
        if (action == null || !BotLogicContracts.ACTION_VARIABLE.equals(action.path("action").asText(""))) return;
        String variableId = action.path("variableId").asText("");
        if (!player.customVariableTypes.containsKey(variableId)) return;
        String operation = action.path("operation").asText(BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SET);
        JsonNode terms = action.get("terms");
        double targetOffset = action.path("value").isNumber() ? action.path("value").asDouble(0) : 0;
        if ("boolean".equals(player.customVariableTypes.get(variableId))) {
            targetOffset = action.path("value").asBoolean(false) ? 1 : 0;
        }
        StrategyBlock block = new StrategyBlock(
                0,
                BotLogicContracts.ACTION_VARIABLE,
                BotLogicContracts.TARGET_OPPONENT,
                targetOffset,
                0,
                "target",
                500,
                400,
                "target",
                operation,
                variableId,
                terms,
                1,
                ConditionResolutionService.normalizeConditions(branch.path("conditions")));
        actionExecutionService.applyCustomVariableAction(
                player,
                opponent,
                entities,
                arena,
                conditionResolutionService,
                block);
    }

    private boolean matches(
            JsonNode source,
            List<Condition> normalized,
            boolean requireAll,
            Bot player,
            Bot opponent,
            List<DuelSimulationService.Entity> entities,
            Arena arena) {
        if (source == null || !source.isArray() || source.isEmpty()) return false;
        if (isFullConditionList(source)) {
            return conditionResolutionService.evaluateConditions(normalized, player, opponent, entities, arena);
        }
        boolean result = requireAll;
        for (JsonNode condition : source) {
            boolean passed = evaluateLegacyCondition(condition, player, opponent);
            result = requireAll ? result && passed : result || passed;
        }
        return result;
    }

    private boolean isFullConditionList(JsonNode source) {
        for (JsonNode condition : source) {
            if (condition == null || !condition.isObject()
                    || !condition.path("type").isTextual()
                    || !FULL_CONDITION_TYPES.contains(condition.path("type").asText())) return false;
        }
        return true;
    }

    private boolean evaluateLegacyCondition(JsonNode condition, Bot player, Bot opponent) {
        if (condition == null || !condition.isObject()) return false;
        String subject = condition.path("subject").asText("");
        Object actual = switch (subject) {
            case "player.hp" -> player.hp;
            case "opponent.hp" -> opponent.hp;
            case "time.elapsedMs" -> initialElapsedMs + elapsedMs;
            case "player.damageTaken" -> playerDamageTaken;
            case "opponent.damageTaken" -> opponentDamageTaken;
            case "player.hitsLanded" -> playerHitsLanded;
            case "opponent.hitsLanded" -> opponentHitsLanded;
            case "player.abilityUses" -> playerAbilityUses;
            case "opponent.abilityUses" -> opponentAbilityUses;
            case "player.alive" -> player.hp > 0;
            case "opponent.alive" -> opponent.hp > 0;
            case "player.customVariable" -> player.customVariables.get(condition.path("variableId").asText(""));
            case "opponent.customVariable" -> opponent.customVariables.get(condition.path("variableId").asText(""));
            default -> null;
        };
        if (actual == null) return false;
        String operator = condition.path("operator").asText("");
        if (actual instanceof Boolean booleanActual) {
            return "eq".equals(operator)
                    && booleanActual == condition.path("value").asBoolean(false);
        }
        double expected = numeric(condition.path("value").asDouble(Double.NaN));
        double actualNumber = numeric(actual instanceof Number number ? number.doubleValue() : Double.NaN);
        if (!Double.isFinite(expected) || !Double.isFinite(actualNumber)) return false;
        return switch (operator) {
            case "lt" -> actualNumber < expected;
            case "lte" -> actualNumber <= expected;
            case "eq" -> Math.abs(actualNumber - expected) < 0.000001;
            case "gte" -> actualNumber >= expected;
            case "gt" -> actualNumber > expected;
            default -> false;
        };
    }

    private static double numeric(Object value) {
        if (value instanceof Number number && Double.isFinite(number.doubleValue())) return number.doubleValue();
        return Double.NaN;
    }
}
