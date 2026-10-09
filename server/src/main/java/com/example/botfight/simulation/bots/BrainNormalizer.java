package com.example.botfight.simulation.bots;

import com.example.botfight.simulation.core.logic.ChainRuntime;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Aim;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.geometry.ArenaCoordinates;
import com.example.botfight.simulation.geometry.ArenaUnits;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/**
 * Turns a submitted brain's JSON into the bounded, typed structures the duel runs: the priority tree
 * of roots and branches, and the action chains. Every field is read defensively and clamped, because
 * the brain is hostile input; nothing here executes user text.
 */
public final class BrainNormalizer {
    private static final int ARENA_WIDTH_UNITS = ArenaUnits.WIDTH;
    private static final int ARENA_HEIGHT_UNITS = ArenaUnits.HEIGHT;
    private static final int MAX_LOGIC_BLOCKS = 100;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final double CUSTOM_NUMBER_LIMIT = BotLogicContracts.CUSTOM_NUMBER_LIMIT;
    private static final int MAX_ROOTS = 100;
    private static final int MIN_PRIORITY = 1;
    private static final int MAX_PRIORITY = 10;

    private BrainNormalizer() {
    }

    /** A normalized brain: its coordinate schema version, priority tree and chains. */
    public record Result(String schemaVersion, List<TreeRoot> roots, Map<String, ChainRuntime.Chain> chains) {
    }

    public record TreeRoot(int index, double priority, List<TreeBranch> branches, List<StrategyBlock> actions) {
    }

    public record TreeBranch(String branchType, double priority, List<StrategyBlock> blocks, List<TreeBranch> children) {
    }

    public static Result normalize(JsonNode brain) {
        JsonNode roots = brain != null ? brain.get("roots") : null;
        String schemaVersion = brain != null
                && BotLogicContracts.BRAIN_SCHEMA_V2.equals(textValue(field(brain, "version"), ""))
                ? BotLogicContracts.BRAIN_SCHEMA_V2 : BotLogicContracts.BRAIN_SCHEMA_V1;
        // Chains share the roots' action and condition budget.
        int[] remainingActions = { MAX_LOGIC_BLOCKS };
        int[] remainingConditions = { MAX_TOTAL_CONDITIONS };
        List<TreeRoot> tree = normalizeTreeRoots(roots, schemaVersion, remainingActions, remainingConditions);
        JsonNode chains = brain != null ? brain.get("chains") : null;
        Map<String, ChainRuntime.Chain> normalizedChains = ChainRuntime.normalize(chains, schemaVersion,
                chainBlockNormalizer(schemaVersion), remainingActions, remainingConditions);
        return new Result(schemaVersion, tree, normalizedChains);
    }

    private static ChainRuntime.BlockNormalizer chainBlockNormalizer(String coordinateVersion) {
        return new ChainRuntime.BlockNormalizer() {
            @Override
            public StrategyBlock normalize(JsonNode node) {
                return normalizeStrategyBlock(node, 0, coordinateVersion);
            }

            @Override
            public String head(Object action) {
                BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
                return contract == null ? null : contract.head().name().toLowerCase();
            }

            @Override
            public Object action(JsonNode node) {
                return actionValue(field(node, "action"));
            }

            @Override
            public int cost(StrategyBlock block) {
                return strategyBlockActionCost(block);
            }
        };
    }

    private static List<TreeRoot> normalizeTreeRoots(JsonNode roots, String coordinateVersion,
            int[] remainingActions, int[] remainingConditions) {
        if (roots == null || !roots.isArray()) return List.of();
        List<TreeRoot> normalized = new ArrayList<>();
        int limit = Math.min(roots.size(), MAX_ROOTS);
        for (int index = 0; index < limit; index += 1) {
            JsonNode root = roots.get(index);
            normalized.add(new TreeRoot(
                    index,
                    clamp(numberValue(field(root, "priority"), index + 1), 1, MAX_ROOTS),
                    normalizeTreeBranches(field(root, "branches"), remainingActions, remainingConditions, coordinateVersion),
                    normalizeRootActions(root, index, remainingActions, coordinateVersion)));
        }
        normalized.sort(Comparator.comparingDouble(TreeRoot::priority));
        return List.copyOf(normalized);
    }

    private static List<StrategyBlock> normalizeRootActions(JsonNode root, int index, int[] remainingActions, String version) {
        if (field(root, "actions") == null) return List.of();
        List<StrategyBlock> actions = new ArrayList<>();
        for (StrategyBlock block : normalizeTreeActions(root, index, version)) {
            if (BotLogicContracts.ACTION_NONE.equals(block.action())) continue;
            int cost = strategyBlockActionCost(block);
            if (cost > remainingActions[0]) break;
            remainingActions[0] -= cost;
            actions.add(block);
        }
        return List.copyOf(actions);
    }

    private static List<TreeBranch> normalizeTreeBranches(JsonNode branches, int[] remainingActions, int[] remainingConditions,
            String coordinateVersion) {
        if (branches == null || !branches.isArray() || remainingConditions[0] <= 0) return List.of();
        List<TreeBranch> normalized = new ArrayList<>();
        for (int index = 0; index < branches.size() && remainingConditions[0] > 0; index += 1) {
            JsonNode branch = branches.get(index);
            List<StrategyBlock> blocks = new ArrayList<>();
            for (StrategyBlock block : normalizeTreeActions(branch, index, coordinateVersion)) {
                if (BotLogicContracts.ACTION_NONE.equals(block.action())) continue;
                int cost = strategyBlockActionCost(block);
                if (cost > remainingActions[0]) break;
                blocks.add(block);
                remainingActions[0] -= cost;
            }
            if (blocks.isEmpty()) {
                blocks = List.of(new StrategyBlock(index, BotLogicContracts.ACTION_NONE, BotLogicContracts.SELECTABLE_OPPONENT, 0, 0, "target", ARENA_WIDTH_UNITS / 2.0, ARENA_HEIGHT_UNITS / 2.0, null, null, null, null, 1, ConditionResolutionService.normalizeConditions(field(branch, "conditions"), coordinateVersion)));
            }
            String branchType = index == 0 ? "if" : "else".equals(textValue(field(branch, "branchType"), "if")) ? "else" : "if";
            if ("else".equals(branchType)) {
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.selectable(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), List.of(), block.targetAngle(), block.aim(), block.sprint(), block.fastTurn())).toList();
            } else {
                int conditionLimit = Math.min(remainingConditions[0], blocks.isEmpty() ? 0 : blocks.get(0).conditions().size());
                List<Condition> limitedConditions = blocks.isEmpty() ? List.of() : blocks.get(0).conditions().subList(0, conditionLimit);
                remainingConditions[0] -= conditionLimit;
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.selectable(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), limitedConditions, block.targetAngle(), block.aim(), block.sprint(), block.fastTurn())).toList();
            }
            normalized.add(new TreeBranch(
                    branchType,
                    clamp(numberValue(field(branch, "priority"), index + 1), 1, MAX_LOGIC_BLOCKS),
                    blocks,
                    normalizeTreeBranches(field(branch, "children"), remainingActions, remainingConditions, coordinateVersion)));
        }
        normalized.sort(Comparator.comparingDouble(TreeBranch::priority));
        return List.copyOf(normalized);
    }

    private static List<StrategyBlock> normalizeTreeActions(JsonNode branch, int index, String coordinateVersion) {
        JsonNode actions = field(branch, "actions");
        List<StrategyBlock> blocks = new ArrayList<>();
        Set<String> heads = new HashSet<>();
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            for (JsonNode actionNode : actions) {
                Object action = actionValue(field(actionNode, "action"));
                String head = actionHead(action);
                String headKey = BotLogicContracts.ACTION_VARIABLE.equals(action) ? head + ":" + blocks.size() : head;
                if (!heads.add(headKey)) continue;
                double offsetX = offsetCoordinate(field(actionNode, "targetOffsetX"), coordinateVersion);
                double offsetY = offsetCoordinate(field(actionNode, "targetOffsetY"), coordinateVersion);
                double targetX = absoluteCoordinate(field(actionNode, "targetX"), coordinateVersion, true);
                double targetY = absoluteCoordinate(field(actionNode, "targetY"), coordinateVersion, false);
                if (isCenteredCoordinates(coordinateVersion)) {
                    ArenaCoordinates.Offset offset = ArenaCoordinates.offsetToInternal(offsetX, offsetY);
                    ArenaCoordinates.Point target = ArenaCoordinates.toInternal(targetX, targetY);
                    offsetX = offset.x();
                    offsetY = offset.y();
                    targetX = target.x();
                    targetY = target.y();
                }
                blocks.add(new StrategyBlock(index, action,
                normalizeSelectable(textValue(field(actionNode, "selectable"), BotLogicContracts.SELECTABLE_OPPONENT), BotLogicContracts.SELECTABLE_OPPONENT),
                        BotLogicContracts.ACTION_VARIABLE.equals(action)
                                ? clamp(variableValue(firstNonNull(field(actionNode, "value"), field(actionNode, "operand"))), -CUSTOM_NUMBER_LIMIT, CUSTOM_NUMBER_LIMIT)
                                : offsetX,
                        offsetY,
                        normalizeActionTargetMode(action, actionNode),
                        targetX,
                        targetY,
                        textValue(field(actionNode, "movementMode"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? textValue(field(actionNode, "operation"), "set") : movementDirectionValue(field(actionNode, "movementDirection"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? textValue(field(actionNode, "variableId"), "") : movementDirectionValue(field(actionNode, "phaseFacingMode"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? variableActionPayload(actionNode) : chainActionPayload(action, actionNode),
                        actionPriority(branch),
                        ConditionResolutionService.normalizeConditions(field(branch, "conditions"), coordinateVersion),
                        clamp(numberValue(field(actionNode, "targetAngle"), 0), BotLogicContracts.ANGLE_MIN, BotLogicContracts.ANGLE_MAX),
                        normalizeAim(action, actionNode),
                        normalizeSprint(action, actionNode),
                        normalizeFastTurn(action, actionNode)));
            }
        }
        if (blocks.isEmpty()) blocks.add(normalizeStrategyBlock(branch, index, coordinateVersion));
        if (blocks.stream().anyMatch(block -> !BotLogicContracts.ACTION_NONE.equals(block.action()))) {
            blocks.removeIf(block -> BotLogicContracts.ACTION_NONE.equals(block.action()));
        }
        return blocks;
    }

    private static int strategyBlockActionCost(StrategyBlock block) {
        if (block == null || BotLogicContracts.ACTION_NONE.equals(block.action())) return 0;
        JsonNode terms = block.variableTerms();
        return BotLogicContracts.ACTION_VARIABLE.equals(block.action())
                && terms != null && terms.isArray() && !terms.isEmpty() ? terms.size() : 1;
    }

    private static StrategyBlock normalizeStrategyBlock(JsonNode block, int index, String coordinateVersion) {
        Object action = actionValue(field(block, "action"));
        double offsetX = offsetCoordinate(field(block, "targetOffsetX"), coordinateVersion);
        double offsetY = offsetCoordinate(field(block, "targetOffsetY"), coordinateVersion);
        double targetX = absoluteCoordinate(field(block, "targetX"), coordinateVersion, true);
        double targetY = absoluteCoordinate(field(block, "targetY"), coordinateVersion, false);
        if (isCenteredCoordinates(coordinateVersion)) {
            ArenaCoordinates.Offset offset = ArenaCoordinates.offsetToInternal(offsetX, offsetY);
            ArenaCoordinates.Point target = ArenaCoordinates.toInternal(targetX, targetY);
            offsetX = offset.x();
            offsetY = offset.y();
            targetX = target.x();
            targetY = target.y();
        }
        return new StrategyBlock(
                index,
                action,
                normalizeSelectable(textValue(field(block, "selectable"), BotLogicContracts.SELECTABLE_OPPONENT), BotLogicContracts.SELECTABLE_OPPONENT),
                BotLogicContracts.ACTION_VARIABLE.equals(action)
                        ? clamp(variableValue(firstNonNull(field(block, "value"), field(block, "operand"))), -CUSTOM_NUMBER_LIMIT, CUSTOM_NUMBER_LIMIT)
                        : offsetX,
                offsetY,
                normalizeActionTargetMode(action, block),
                targetX,
                targetY,
                textValue(field(block, "movementMode"), null),
                movementDirectionValue(field(block, "movementDirection"), null),
                BotLogicContracts.ACTION_VARIABLE.equals(action)
                        ? textValue(field(block, "phaseFacingMode"), null)
                        : movementDirectionValue(field(block, "phaseFacingMode"), null),
                BotLogicContracts.ACTION_VARIABLE.equals(action) ? variableActionPayload(block) : chainActionPayload(action, block),
                actionPriority(block),
                ConditionResolutionService.normalizeConditions(field(block, "conditions"), coordinateVersion),
                clamp(numberValue(field(block, "targetAngle"), 0), BotLogicContracts.ANGLE_MIN, BotLogicContracts.ANGLE_MAX),
                normalizeAim(action, block),
                normalizeSprint(action, block),
                normalizeFastTurn(action, block));
    }

    /** Run chain carries its chain ID in the block's payload node; other actions carry none. */
    private static JsonNode chainActionPayload(Object action, JsonNode node) {
        if (!BotLogicContracts.ACTION_RUN_CHAIN.equals(action)) return null;
        return tools.jackson.databind.node.JsonNodeFactory.instance.objectNode()
                .put("chainId", textValue(field(node, "chainId"), ""));
    }

    /** Fast turn is a Rotate setting and only a literal boolean true turns it on; anything else is off. */
    private static boolean normalizeFastTurn(Object action, JsonNode node) {
        return BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET.equals(action)
                && field(node, "fastTurn") != null && field(node, "fastTurn").isBoolean()
                && field(node, "fastTurn").asBoolean();
    }

    /** Sprint is a Walk setting and only a literal boolean true turns it on; anything else is off. */
    private static boolean normalizeSprint(Object action, JsonNode node) {
        return BotLogicContracts.ACTION_MOVE_WALK.equals(action)
                && field(node, "sprint") != null && field(node, "sprint").isBoolean()
                && field(node, "sprint").asBoolean();
    }

    /**
     * Lead aim is only honored on actions that aim at a selected entity. Anything missing or
     * malformed normalizes to `current`, so brains saved before this setting behave as before.
     */
    private static Aim normalizeAim(Object action, JsonNode node) {
        if (!BotLogicContracts.actionSupportsAim(action)) return Aim.CURRENT;
        String mode = textValue(field(node, "aim"), BotLogicContracts.AIM_CURRENT);
        if (BotLogicContracts.AIM_LEAD.equals(mode)) {
            double seconds = BotLogicContracts.truncateToNumberPrecision(
                    clamp(numberValue(field(node, "leadSeconds"), 0), 0, BotLogicContracts.MAX_LEAD_SECONDS));
            return new Aim(BotLogicContracts.AIM_LEAD, seconds, null);
        }
        if (BotLogicContracts.AIM_AUTO.equals(mode)) {
            JsonNode abilityNode = field(node, "leadAbilityId");
            if (abilityNode != null && abilityNode.isIntegralNumber() && abilityNode.canConvertToInt()
                    && com.example.botfight.simulation.gameconfig.AbilityRegistry.contains(abilityNode.intValue())) {
                return new Aim(BotLogicContracts.AIM_AUTO, 0.0, abilityNode.intValue());
            }
        }
        return Aim.CURRENT;
    }

    private static String normalizeActionTargetMode(Object action, JsonNode node) {
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
        if (contract == null || !contract.coordinateTarget()) return "target";
        String fallback = field(node, "targetX") != null || field(node, "targetY") != null ? "coordinates" : "target";
        String requested = textValue(field(node, "targetMode"), fallback);
        if (contract.angleTarget() && "angle".equals(requested)) return "angle";
        if ("coordinates".equals(requested)) return "coordinates";
        return "target";
    }

    private static boolean isCenteredCoordinates(String coordinateVersion) {
        return BotLogicContracts.BRAIN_SCHEMA_V2.equals(coordinateVersion);
    }

    private static double absoluteCoordinate(JsonNode node, String coordinateVersion, boolean xAxis) {
        boolean centered = isCenteredCoordinates(coordinateVersion);
        double fallback = centered ? 0.0 : (xAxis ? ARENA_WIDTH_UNITS : ARENA_HEIGHT_UNITS) / 2.0;
        if (node == null || !node.isNumber() || !Double.isFinite(node.asDouble())) return fallback;
        double minimum = centered ? -ARENA_WIDTH_UNITS / 2.0 : 0.0;
        double maximum = centered ? ARENA_WIDTH_UNITS / 2.0 : (xAxis ? ARENA_WIDTH_UNITS : ARENA_HEIGHT_UNITS);
        return BotLogicContracts.truncateToNumberPrecision(Math.max(minimum, Math.min(maximum, node.asDouble())));
    }

    private static double offsetCoordinate(JsonNode node, String coordinateVersion) {
        if (node == null || !node.isNumber() || !Double.isFinite(node.asDouble())) return 0.0;
        double limit = isCenteredCoordinates(coordinateVersion)
                ? ARENA_WIDTH_UNITS / 2.0 : ARENA_WIDTH_UNITS;
        return BotLogicContracts.truncateToNumberPrecision(Math.max(-limit, Math.min(limit, node.asDouble())));
    }

    public static String actionHead(Object action) {
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
        return contract == null ? "movement" : contract.head().name().toLowerCase();
    }

    private static Object actionValue(JsonNode node) {
        if (node != null && node.isIntegralNumber() && node.canConvertToInt()) return node.intValue();
        return textValue(node, BotLogicContracts.ACTION_NONE);
    }

    private static int normalizePriority(double value) {
        return (int) clamp(Math.round(Double.isFinite(value) ? value : 1.0), MIN_PRIORITY, MAX_PRIORITY);
    }

    private static String normalizeSelectable(String selectableId, String fallback) {
        String canonical = BotLogicContracts.canonicalSelectableId(selectableId);
        if (BotLogicContracts.isAllowedSelectable(canonical)) return canonical;
        return BotLogicContracts.canonicalSelectableId(fallback);
    }

    private static JsonNode field(JsonNode node, String field) {
        return node != null && node.isObject() ? node.get(field) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static String movementDirectionValue(JsonNode node, String fallback) {
        if (node != null && (node.isTextual() || (node.isNumber() && Double.isFinite(node.asDouble())))) {
            return node.asText();
        }
        return fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber()
                ? BotLogicContracts.truncateToNumberPrecision(node.asDouble())
                : fallback;
    }

    private static int actionPriority(JsonNode node) {
        JsonNode explicitActionPriority = field(node, "actionPriority");
        if (explicitActionPriority != null && explicitActionPriority.isNumber()) {
            return normalizePriority(numberValue(explicitActionPriority, 1.0));
        }
        return 1;
    }

    /** A variable write carries its operand or its terms. */
    private static JsonNode variableActionPayload(JsonNode node) {
        return firstNonNull(field(node, "operand"), field(node, "terms"));
    }

    private static double variableValue(JsonNode node) {
        if (node != null && node.isBoolean()) return node.asBoolean() ? 1 : 0;
        if (node != null && node.isObject()) return numberValue(field(node, "value"), 0);
        return numberValue(node, 0);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T value : values) {
            if (value != null) return value;
        }
        return null;
    }
}
