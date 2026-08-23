package com.example.botfight.service.submission;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.BotSubmissionValidationResponseDTO;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.GameConfig;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.bots.BotLogicContracts;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class BotSubmissionValidationService {

    private static final String VALIDATOR_VERSION = "bot-brain-submission-v1";
    private static final String BRAIN_SCHEMA_VERSION = "bot-logic-tree-v1";
    private static final int MAX_PHASE_LENGTH = 30;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;
    private static final int MAX_LOGIC_BLOCKS = 100;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final int MAX_CUSTOM_VARIABLE_SLOTS = 100;
    private static final int MAX_NODE_POSITIONS = 1000;
    private static final int MAX_NODE_POSITION_ID_LENGTH = 200;
    private static final double MAX_NODE_COORDINATE = 1_000_000d;
    private static final double CUSTOM_NUMBER_LIMIT = BotLogicContracts.CUSTOM_NUMBER_LIMIT;
    private static final int MAX_ROOTS = 100;
    private static final int MAX_CONDITIONS_PER_BLOCK = MAX_TOTAL_CONDITIONS;
    private static final Set<Integer> ALLOWED_ABILITIES = Set.copyOf(AbilityContracts.actions());

    private final JsonMapper jsonMapper;
    private final GameConfigCatalog combatLoadoutes;

    public BotSubmissionValidationService(JsonMapper jsonMapper, GameConfigCatalog combatLoadoutes) {
        this.jsonMapper = jsonMapper;
        this.combatLoadoutes = combatLoadoutes;
    }

    public BotSubmissionValidationResponseDTO validate(BotSubmissionPayloadDTO payload) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (payload == null) {
            errors.add("submission payload is required");
            return response(false, errors, warnings, false);
        }
        if (payload.getBrain() != null) {
            payload.setBrain(LegacyAbilityPayloadMigration.normalize(payload.getBrain()));
        }

        rejectTooLong(errors, payload.getPhase(), "phase", MAX_PHASE_LENGTH);
        rejectTooLong(errors, payload.getSelectedLoadout(), "selectedLoadout", MAX_SELECTED_LOADOUT_LENGTH);
        rejectTooLong(errors, payload.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        requireNonNegative(errors, payload.getRoundNumber(), "roundNumber");
        requireOneOf(errors, payload.getPhase(), "phase", "BUILDING");
        GameConfig loadoutSpec = combatLoadoutes.duelV1();
        JsonNode brain = submittedBrain(payload);
        validateBrain(errors, brain, loadoutSpec);

        return response(errors.isEmpty(), errors, warnings, false);
    }

    /** Validates an in-memory brain with the same logic contract as a saved submission. */
    public List<String> validateForSimulation(JsonNode brain) {
        List<String> errors = new ArrayList<>();
        validateBrain(errors, LegacyAbilityPayloadMigration.normalize(brain), combatLoadoutes.duelV1());
        return List.copyOf(errors);
    }

    private BotSubmissionValidationResponseDTO response(
            boolean accepted,
            List<String> errors,
            List<String> warnings,
            boolean buildingDurationTrusted) {
        BotSubmissionValidationResponseDTO response = new BotSubmissionValidationResponseDTO();
        response.setAccepted(accepted);
        response.setStatus(accepted ? "ACCEPTED" : "REJECTED");
            response.setMessage(accepted
                ? "Bot brain passed validation"
                : "Bot brain failed validation");
        response.setValidatorVersion(VALIDATOR_VERSION);
        response.setBuildingDurationTrusted(buildingDurationTrusted);
        response.setErrors(errors);
        response.setWarnings(warnings);
        return response;
    }

    private void validateBrain(List<String> errors, JsonNode brain, GameConfig loadoutSpec) {
        if (!requireObject(errors, brain, "brain")) {
            return;
        }

        if (!brain.hasNonNull("version") || !brain.get("version").isTextual()) {
            errors.add("brain.version must be a string");
        } else if (!BRAIN_SCHEMA_VERSION.equals(brain.get("version").asText())) {
            errors.add("brain.version must be " + BRAIN_SCHEMA_VERSION);
        }
        validateLoadout(errors, brain.get("loadout"));
        validateCustomVariables(errors, brain, loadoutSpec);
        validateNodePositions(errors, brain.get("nodePositions"));
        Map<String, String> customVariableTypes = customVariableTypes(brain);
        if (countConditionSlots(brain) > MAX_TOTAL_CONDITIONS) errors.add("brain exceeds the total condition limit");
        validateActionsAgainstLoadout(errors, brain);

        if (brain.has("blocks")) errors.add("brain.blocks is no longer supported");
        if (brain.has("clusters")) errors.add("brain.clusters is no longer supported");

        JsonNode roots = brain.get("roots");
        if (roots == null || !roots.isArray()) {
            errors.add("brain.roots must be an array");
            return;
        }
        validateLogicRoots(errors, roots, loadoutSpec, customVariableTypes);
    }

    private void validateNodePositions(List<String> errors, JsonNode positions) {
        if (positions == null) return;
        if (!positions.isObject()) {
            errors.add("brain.nodePositions must be an object");
            return;
        }
        if (positions.size() > MAX_NODE_POSITIONS) {
            errors.add("brain.nodePositions exceeds the node position limit");
        }
        positions.properties().forEach(entry -> {
            String path = "brain.nodePositions." + entry.getKey();
            JsonNode position = entry.getValue();
            if (entry.getKey().isBlank() || entry.getKey().length() > MAX_NODE_POSITION_ID_LENGTH) {
                errors.add(path + " has an invalid node id");
                return;
            }
            if (position == null || !position.isObject()) {
                errors.add(path + " must be an object");
                return;
            }
            validateNodeCoordinate(errors, position.get("x"), path + ".x");
            validateNodeCoordinate(errors, position.get("y"), path + ".y");
        });
    }

    private void validateNodeCoordinate(List<String> errors, JsonNode coordinate, String path) {
        if (coordinate == null || !coordinate.isNumber()
                || !Double.isFinite(coordinate.asDouble())
                || coordinate.asDouble() < 0
                || coordinate.asDouble() > MAX_NODE_COORDINATE) {
            errors.add(path + " must be a finite coordinate from 0 to " + (int) MAX_NODE_COORDINATE);
        }
    }

    private void validateLoadout(List<String> errors, JsonNode loadout) {
        if (loadout == null) return;
        if (!loadout.isObject()) {
            errors.add("brain.loadout must be an object");
            return;
        }
        JsonNode abilities = loadout.get("abilities");
        if (abilities == null || !abilities.isArray() || abilities.size() > 6) {
            errors.add("brain.loadout.abilities must contain between 0 and 6 abilities");
        } else {
            Set<Integer> seen = new HashSet<>();
            abilities.forEach(ability -> {
                if (!ability.isIntegralNumber() || !ability.canConvertToInt()
                        || !ALLOWED_ABILITIES.contains(ability.intValue())
                        || GameConfigCatalog.STANDARD_ABILITIES.contains(ability.intValue())
                        || !seen.add(ability.intValue())) {
                    errors.add("brain.loadout.abilities contains an invalid or duplicate ability");
                }
            });
        }
    }

    private void validateCustomVariables(List<String> errors, JsonNode brain, GameConfig loadoutSpec) {
        JsonNode variables = brain.get("customVariables");
        if (variables == null) return;
        if (!variables.isArray()) {
            errors.add("brain.customVariables must be an array");
            return;
        }
        Set<String> ids = new HashSet<>();
        Set<String> names = new HashSet<>();
        java.util.Map<String, String> types = new java.util.HashMap<>();
        for (int index = 0; index < variables.size(); index++) {
            JsonNode variable = variables.get(index);
            String path = "brain.customVariables[" + index + "]";
            if (variable == null || !variable.isObject()) { errors.add(path + " must be an object"); continue; }
            String id = variable.path("id").asText("");
            String name = variable.path("name").asText("").trim();
            String type = variable.path("valueType").asText("");
            if (!id.matches("custom\\.[A-Za-z0-9_.-]{1,52}") || !ids.add(id)) errors.add(path + ".id must be a unique custom variable id");
            if (!name.matches("[A-Za-z][A-Za-z0-9 _-]{0,39}") || !names.add(name.toLowerCase(java.util.Locale.ROOT))) errors.add(path + ".name must be valid and unique");
            if (!Set.of("number", "boolean").contains(type)) errors.add(path + ".valueType must be number or boolean");
            types.put(id, type);
            JsonNode initial = variable.get("initialValue");
            if ("number".equals(type) && (initial == null || !initial.isNumber() || !Double.isFinite(initial.asDouble())
                    || initial.asDouble() < -CUSTOM_NUMBER_LIMIT || initial.asDouble() > CUSTOM_NUMBER_LIMIT)) {
                errors.add(path + ".initialValue must be a number from -99999 to 99999");
            }
            if ("boolean".equals(type) && (initial == null || !initial.isBoolean())) errors.add(path + ".initialValue must be boolean");
            if (variable.has("conditions")) errors.add(path + ".conditions are no longer supported");
        }
        if (countVariableSlots(brain) > MAX_CUSTOM_VARIABLE_SLOTS) errors.add("brain.customVariables exceeds the 100 variable-slot limit");
        validateCustomReferences(errors, brain, "brain", types);
    }

    private Map<String, String> customVariableTypes(JsonNode brain) {
        Map<String, String> types = new HashMap<>();
        JsonNode variables = brain == null ? null : brain.get("customVariables");
        if (variables == null || !variables.isArray()) return types;
        for (JsonNode variable : variables) {
            if (variable == null || !variable.isObject()) continue;
            String id = variable.path("id").asText("");
            String type = variable.path("valueType").asText("");
            if (!id.isEmpty() && !type.isEmpty()) types.putIfAbsent(id, type);
        }
        return types;
    }

    private int countVariableSlots(JsonNode brain) {
        JsonNode variables = brain != null ? brain.get("customVariables") : null;
        if (variables == null || !variables.isArray()) return 0;
        int total = 0;
        for (JsonNode variable : variables) {
            total += 1;
        }
        return total;
    }

    private int countConditionSlots(JsonNode brain) {
        java.util.Map<String, Integer> costs = new java.util.HashMap<>();
        JsonNode variables = brain.get("customVariables");
        if (variables != null && variables.isArray()) for (JsonNode variable : variables) {
            costs.put(variable.path("id").asText(""), 1);
        }
        Set<String> referenced = new HashSet<>();
        int rootConditions = countBrainConditionSlots(brain.get("roots"), costs, referenced);
        return rootConditions;
    }

    private int countBrainConditionSlots(JsonNode node, java.util.Map<String, Integer> costs, Set<String> referenced) {
        if (node == null) return 0;
        if (node.isArray()) { int total = 0; for (JsonNode child : node) total += countBrainConditionSlots(child, costs, referenced); return total; }
        if (!node.isObject()) return 0;
        if (BotLogicContracts.CONDITION_EXPRESSION.equals(node.path("type").asText(""))) {
            Set<String> conditionReferences = new HashSet<>();
            String left = node.path("left").asText("");
            if (costs.containsKey(left)) conditionReferences.add(left);
            JsonNode right = node.get("right");
            if (right != null && "variable".equals(right.path("type").asText(""))) {
                String rightId = right.path("value").asText("");
                if (costs.containsKey(rightId)) conditionReferences.add(rightId);
            }
            referenced.addAll(conditionReferences);
            return conditionReferences.isEmpty() ? 1 : conditionReferences.stream().mapToInt(costs::get).sum();
        }
        if (node.hasNonNull("type") && !Set.of("number", "boolean", "variable").contains(node.path("type").asText(""))) return 1;
        int total = 0;
        for (var entry : node.properties()) total += countBrainConditionSlots(entry.getValue(), costs, referenced);
        return total;
    }

    private void validateCustomReferences(List<String> errors, JsonNode node, String path, java.util.Map<String, String> types) {
        if (node == null) return;
        if (node.isArray()) { for (int i = 0; i < node.size(); i++) validateCustomReferences(errors, node.get(i), path + "[" + i + "]", types); return; }
        if (!node.isObject()) return;
        if (BotLogicContracts.CONDITION_EXPRESSION.equals(node.hasNonNull("type") ? node.get("type").asText() : "")) {
            String left = node.hasNonNull("left") ? node.get("left").asText() : "";
            if (left.startsWith(BotLogicContracts.CUSTOM_VARIABLE_PREFIX) && !types.containsKey(left)) errors.add(path + ".left references an unknown custom variable");
            if (types.containsKey(left)) {
                JsonNode rightNode = node.get("right");
                boolean booleanOperand = rightNode != null && "boolean".equals(rightNode.hasNonNull("type") ? rightNode.get("type").asText() : "");
                if (booleanOperand != "boolean".equals(types.get(left))) errors.add(path + ".left uses the wrong custom variable type");
            }
            JsonNode rightNode = node.get("right");
            String right = rightNode != null && rightNode.hasNonNull("value") ? rightNode.get("value").asText() : "";
            if (right.startsWith(BotLogicContracts.CUSTOM_VARIABLE_PREFIX) && !"number".equals(types.get(right))) errors.add(path + ".right.value must reference an existing number custom variable");
        }
        if ("variable".equals(node.hasNonNull("action") ? node.get("action").asText() : "")) {
            String id = node.hasNonNull("variableId") ? node.get("variableId").asText() : "";
            String type = types.get(id);
            if (type == null) errors.add(path + ".variableId references an unknown custom variable");
            JsonNode value = node.get("value");
            String operation = node.hasNonNull("operation") ? node.get("operation").asText() : "set";
            if ("boolean".equals(type) && (value == null || !value.isBoolean() || !"set".equals(operation))) errors.add(path + " boolean variable actions must set true or false");
            JsonNode terms = node.get("terms");
            JsonNode operand = node.get("operand");
            if ("number".equals(type) && terms != null) {
                if (!terms.isArray() || terms.isEmpty() || terms.size() > 20) errors.add(path + ".terms must contain 1 to 20 operands");
                else for (int index = 0; index < terms.size(); index++) {
                    JsonNode term = terms.get(index);
                    String termOperation = term.path("operator").asText("");
                    if (!BotLogicContracts.isAllowedCustomVariableOperation(termOperation)
                            || (index > 0 && BotLogicContracts.CUSTOM_VARIABLE_OPERATION_SET.equals(termOperation))) {
                        errors.add(path + ".terms[" + index + "].operator is invalid");
                    }
                    JsonNode termOperand = term.path("operand");
                    String operandType = termOperand.path("type").asText("");
                    JsonNode termValue = termOperand.path("value");
                    if ("number".equals(operandType) && (!termValue.isNumber() || !Double.isFinite(termValue.asDouble())
                            || Math.abs(termValue.asDouble()) > CUSTOM_NUMBER_LIMIT)) {
                        errors.add(path + ".terms[" + index + "].operand is invalid");
                    } else if (BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO.equals(termOperation)
                            && "number".equals(operandType) && BotLogicContracts.truncateToInteger(termValue.asDouble()) == 0) {
                        errors.add(path + ".terms[" + index + "].modulo operand cannot be 0");
                    }
                    else if ("variable".equals(operandType)) {
                        String operandId = termOperand.path("value").asText("");
                        if (!("number".equals(BotLogicContracts.variableValueType(operandId)) || "number".equals(types.get(operandId)))) errors.add(path + ".terms[" + index + "].operand must reference a numeric variable");
                    } else if (!"number".equals(operandType)) errors.add(path + ".terms[" + index + "].operand.type is invalid");
                }
            } else if ("number".equals(type) && operand != null) {
                if (!BotLogicContracts.isAllowedCustomVariableOperation(operation)) {
                    errors.add(path + ".operation is invalid");
                }
                validateCustomVariableOperand(errors, operand, path + ".operand", operation, types);
            } else if ("number".equals(type) && (value == null || !value.isNumber() || !Double.isFinite(value.asDouble()) || Math.abs(value.asDouble()) > CUSTOM_NUMBER_LIMIT
                    || !BotLogicContracts.isAllowedCustomVariableOperation(operation)
                    || (BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO.equals(operation) && BotLogicContracts.truncateToInteger(value.asDouble()) == 0))) {
                errors.add(path + " number variable action is invalid");
            }
        }
        node.properties().forEach(entry -> validateCustomReferences(errors, entry.getValue(), path + "." + entry.getKey(), types));
    }

    private void validateCustomVariableOperand(List<String> errors, JsonNode operand, String path, String operation,
            java.util.Map<String, String> types) {
        if (operand == null || !operand.isObject()) {
            errors.add(path + " must be a number or numeric variable");
            return;
        }
        String operandType = operand.path("type").asText("");
        if ("number".equals(operandType)) {
            JsonNode value = operand.get("value");
            if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble()) || Math.abs(value.asDouble()) > CUSTOM_NUMBER_LIMIT
                    || (BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO.equals(operation) && BotLogicContracts.truncateToInteger(value.asDouble()) == 0)) {
                errors.add(BotLogicContracts.CUSTOM_VARIABLE_OPERATION_MODULO.equals(operation) && value != null && value.isNumber()
                        && Double.isFinite(value.asDouble()) && BotLogicContracts.truncateToInteger(value.asDouble()) == 0
                        ? path + " modulo operand cannot be 0" : path + " is invalid");
            }
            return;
        }
        if ("variable".equals(operandType)) {
            String operandId = operand.path("value").asText("");
            if (!("number".equals(BotLogicContracts.variableValueType(operandId)) || "number".equals(types.get(operandId)))) {
                errors.add(path + " must reference a numeric variable");
            }
            return;
        }
        errors.add(path + ".type is invalid");
    }

    private void validateActionsAgainstLoadout(List<String> errors, JsonNode brain) {
        JsonNode abilities = brain.path("loadout").path("abilities");
        if (!abilities.isArray()) return;
        Set<Integer> equipped = new HashSet<>();
        abilities.forEach(ability -> { if (ability.isIntegralNumber() && ability.canConvertToInt()) equipped.add(ability.intValue()); });
        validateActionNodes(errors, brain, equipped, "brain");
    }

    private void validateActionNodes(List<String> errors, JsonNode node, Set<Integer> equipped, String path) {
        if (node == null) return;
        if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                validateActionNodes(errors, node.get(index), equipped, path + "[" + index + "]");
            }
            return;
        }
        if (!node.isObject()) return;
        JsonNode action = node.get("action");
        if (action != null) {
            Integer requiredAbility = abilityForAction(action);
            if (requiredAbility != null && !GameConfigCatalog.STANDARD_ABILITIES.contains(requiredAbility) && !equipped.contains(requiredAbility)) {
                errors.add(path + ".action requires equipped ability " + requiredAbility);
            }
        }
        JsonNode left = node.get("left");
        JsonNode selectedAbility = node.get("ability");
        JsonNode right = node.get("right");
        String rightVariable = right != null && right.isObject()
                && "variable".equals(right.path("type").asText())
                ? right.path("value").asText("") : "";
        if ((left != null && left.isTextual() && left.asText().startsWith("my.selectedAbility"))
                || rightVariable.startsWith("my.selectedAbility")) {
            validateSelectedAbilityLoadout(errors, selectedAbility, equipped, path);
        }
        node.properties().forEach(entry -> {
            if (!"loadout".equals(entry.getKey())) {
                validateActionNodes(errors, entry.getValue(), equipped, path + "." + entry.getKey());
            }
        });
    }

    private Integer abilityForAction(JsonNode action) {
        return action != null && action.isIntegralNumber() && action.canConvertToInt()
                ? AbilityContracts.abilityForAction(action.intValue()) : null;
    }

    private void validateLogicRoots(List<String> errors, JsonNode roots, GameConfig loadoutSpec, Map<String, String> customVariableTypes) {
        if (!roots.isArray()) {
            errors.add("brain.roots must be an array");
            return;
        }
        if (roots.size() > MAX_ROOTS) errors.add("brain.roots exceeds the root limit");
        int[] branchCount = { 0 };
        int[] conditionCount = { 0 };
        for (int rootIndex = 0; rootIndex < roots.size(); rootIndex++) {
            JsonNode root = roots.get(rootIndex);
            String path = "brain.roots[" + rootIndex + "]";
            if (root == null || !root.isObject()) {
                errors.add(path + " must be an object");
                continue;
            }
            JsonNode createdOrder = root.get("createdOrder");
            if (createdOrder != null && (!createdOrder.isNumber()
                    || !Double.isFinite(createdOrder.asDouble())
                    || createdOrder.asDouble() < 0
                    || createdOrder.asDouble() >= MAX_ROOTS
                    || createdOrder.asDouble() != Math.rint(createdOrder.asDouble()))) {
                errors.add(path + ".createdOrder must be an integer between 0 and " + (MAX_ROOTS - 1));
            }
            JsonNode name = root.get("name");
            if (name != null && (!name.isTextual() || name.asText().trim().isEmpty() || name.asText().length() > 40)) {
                errors.add(path + ".name must be 1 to 40 characters");
            }
            JsonNode branches = root.get("branches");
            if (branches == null || !branches.isArray()) {
                errors.add(path + ".branches must be an array");
                continue;
            }
            validateTreeBranches(errors, branches, path + ".branches", loadoutSpec, customVariableTypes, branchCount, conditionCount);
        }
        if (branchCount[0] > MAX_LOGIC_BLOCKS) errors.add("brain tree actions exceed the action node limit");
        if (conditionCount[0] > MAX_TOTAL_CONDITIONS) errors.add("brain tree exceeds the total condition limit");
    }

    private void validateTreeBranches(List<String> errors, JsonNode branches, String path,
            GameConfig loadoutSpec, Map<String, String> customVariableTypes, int[] branchCount, int[] conditionCount) {
        for (int index = 0; index < branches.size(); index++) {
            JsonNode branch = branches.get(index);
            String branchPath = path + "[" + index + "]";
            branchCount[0] += executableActionCount(branch);
            conditionCount[0] += conditionCount(branch);
            validateLogicBlock(errors, branch, branchPath, loadoutSpec, customVariableTypes);
            String type = branch != null && branch.hasNonNull("branchType") ? branch.get("branchType").asText() : "if";
            if (index == 0 && !"if".equals(type)) errors.add(branchPath + ".branchType must be if for the first sibling");
            if (index > 0 && !"if".equals(type) && !"else".equals(type)) errors.add(branchPath + ".branchType must be if or else");
            if ("else".equals(type) && index != branches.size() - 1) errors.add(branchPath + " else branch must be last");
            JsonNode children = branch != null ? branch.get("children") : null;
            if (children != null) {
                if (!children.isArray()) errors.add(branchPath + ".children must be an array");
                else validateTreeBranches(errors, children, branchPath + ".children", loadoutSpec, customVariableTypes, branchCount, conditionCount);
            }
        }
    }

    private int conditionCount(JsonNode block) {
        JsonNode conditions = block != null ? block.get("conditions") : null;
        return conditions != null && conditions.isArray() ? conditions.size() : 0;
    }

    private void validateLogicBlock(List<String> errors, JsonNode block, String path, GameConfig loadoutSpec, Map<String, String> customVariableTypes) {
        if (!block.isObject()) {
            errors.add(path + " must be an object");
            return;
        }
        validateTarget(errors, block.get("actionTarget"), path + ".actionTarget");
        JsonNode actions = block.get("actions");
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            Set<String> heads = new HashSet<>();
            for (int index = 0; index < actions.size(); index++) {
                JsonNode entry = actions.get(index);
                String actionPath = path + ".actions[" + index + "]";
                if (entry == null || !entry.isObject() || !entry.hasNonNull("action")
                        || !(entry.get("action").isTextual() || entry.get("action").isIntegralNumber())) {
                    errors.add(actionPath + ".action must be a movement action string or numeric ability ID");
                    continue;
                }
                JsonNode actionNode = entry.get("action");
                String action = actionNode.isTextual() ? actionNode.asText() : null;
                validateActionAllowed(errors, actionNode, actionPath, loadoutSpec);
                validateActionConfiguration(errors, entry, actionNode, actionPath);
                validateTarget(errors, entry.get("actionTarget"), actionPath + ".actionTarget");
                if (entry.has("targetOffsetX")) validateSignedCoordinate(errors, entry.get("targetOffsetX"), actionPath + ".targetOffsetX", 1000);
                if (entry.has("targetOffsetY")) validateSignedCoordinate(errors, entry.get("targetOffsetY"), actionPath + ".targetOffsetY", 800);
                if (actionNode.isIntegralNumber() && BotLogicContracts.actionContract(actionNode.intValue()) != null
                        && BotLogicContracts.actionContract(actionNode.intValue()).locationTarget()) {
                    JsonNode targetModeNode = entry.get("targetMode");
                    String targetMode = targetModeNode != null && targetModeNode.isTextual()
                            ? targetModeNode.asText()
                            : entry.has("targetX") || entry.has("targetY") ? "coordinates" : "target";
                    if (!"target".equals(targetMode) && !"coordinates".equals(targetMode)) {
                        errors.add(actionPath + ".targetMode must be target or coordinates");
                    } else if ("coordinates".equals(targetMode)) {
                        validateCoordinate(errors, entry.get("targetX"), actionPath + ".targetX", 1000);
                        validateCoordinate(errors, entry.get("targetY"), actionPath + ".targetY", 800);
                    }
                }
                String head = validationActionHead(action);
                String headKey = BotLogicContracts.ACTION_VARIABLE.equals(action) ? head + ":" + index : head;
                if (!heads.add(headKey)) errors.add(path + " has multiple " + head + " actions");
            }
            if (heads.contains(BotLogicContracts.ACTION_NONE) && heads.size() > 1) errors.add(path + " cannot combine N/A with executable actions");
        } else if (!block.hasNonNull("action") || !(block.get("action").isTextual() || block.get("action").isIntegralNumber())) {
            errors.add(path + ".action must be a movement action string or numeric ability ID");
        } else {
            validateActionAllowed(errors, block.get("action"), path, loadoutSpec);
            validateActionConfiguration(errors, block, block.get("action"), path);
            if (block.has("targetOffsetX")) validateSignedCoordinate(errors, block.get("targetOffsetX"), path + ".targetOffsetX", 1000);
            if (block.has("targetOffsetY")) validateSignedCoordinate(errors, block.get("targetOffsetY"), path + ".targetOffsetY", 800);
        }
        JsonNode conditions = block.get("conditions");
        if (conditions == null || !conditions.isArray()) {
            errors.add(path + ".conditions must be an array");
        } else if (conditions.size() > MAX_CONDITIONS_PER_BLOCK) {
            errors.add(path + ".conditions exceeds the condition limit");
        } else {
            for (int index = 0; index < conditions.size(); index++) {
                validateConditionAllowed(errors, conditions.get(index), path + ".conditions[" + index + "]", loadoutSpec, customVariableTypes);
            }
        }
    }

    private int executableActionCount(JsonNode block) {
        if (block == null || !block.isObject()) return 0;
        JsonNode actions = block.get("actions");
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            int count = 0;
            for (JsonNode entry : actions) {
                count += executableActionCost(entry);
            }
            return count;
        }
        return BotLogicContracts.ACTION_NONE.equals(block.path("action").asText(BotLogicContracts.ACTION_NONE)) ? 0 : 1;
    }

    private int executableActionCost(JsonNode entry) {
        if (entry == null || !entry.isObject() || BotLogicContracts.ACTION_NONE.equals(entry.path("action").asText(BotLogicContracts.ACTION_NONE))) return 0;
        JsonNode terms = entry.get("terms");
        return BotLogicContracts.ACTION_VARIABLE.equals(entry.path("action").asText())
                && terms != null && terms.isArray() && !terms.isEmpty() ? terms.size() : 1;
    }

    private String validationActionHead(String action) {
        if (action == null) return BotLogicContracts.ActionHead.ABILITY.name().toLowerCase();
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
        return contract == null ? BotLogicContracts.ActionHead.ABILITY.name().toLowerCase()
                : contract.head().name().toLowerCase();
    }

    private void validateActionAllowed(List<String> errors, JsonNode action, String path, GameConfig loadoutSpec) {
        boolean allowed = action != null && ((action.isTextual()
                && BotLogicContracts.isAllowedAction(action.asText()))
                || (action.isIntegralNumber() && action.canConvertToInt()
                && BotLogicContracts.isAllowedAction(action.intValue())));
        // duel-v1 actions are loadout-owned. validateActionsAgainstLoadout()
        // separately rejects actions whose required ability is not equipped.
        if (!allowed) {
            errors.add(path + ".action is not allowed for " + loadoutSpec.id());
        }
    }

    private void validateConditionAllowed(List<String> errors, JsonNode condition, String path, GameConfig loadoutSpec, Map<String, String> customVariableTypes) {
        if (condition == null || !condition.isObject()) {
            errors.add(path + " must be an object");
            return;
        }
        JsonNode typeNode = condition.get("type");
        if (typeNode == null || !typeNode.isTextual()) {
            errors.add(path + ".type must be a string");
            return;
        }
        String type = typeNode.asText();
        validateTarget(errors, condition.get("target"), path + ".target");
        validateTarget(errors, condition.get("leftTarget"), path + ".leftTarget");
        validateTarget(errors, condition.get("rightTarget"), path + ".rightTarget");
        if (BotLogicContracts.CONDITION_EXPRESSION.equals(type)) {
            validateExpressionCondition(errors, condition, path, loadoutSpec, customVariableTypes);
            return;
        }
        if (!BotLogicContracts.CONDITION_ALWAYS.equals(type)) {
            errors.add(path + ".type must be always or expression");
        }
    }

    private void validateTarget(List<String> errors, JsonNode target, String path) {
        if (target == null || target.isNull()) return;
        if (!target.isTextual() || !isAllowedTarget(target.asText())) {
            errors.add(path + " is not an allowed fight target");
        }
    }

    private static boolean isAllowedTarget(String target) {
        return BotLogicContracts.isAllowedTarget(target);
    }

    private void validateCoordinate(List<String> errors, JsonNode value, String path, int maximum) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble()) || value.asDouble() < 0 || value.asDouble() > maximum) {
            errors.add(path + " must be a number from 0 to " + maximum);
        }
    }

    private void validateSignedCoordinate(List<String> errors, JsonNode value, String path, int magnitude) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble())
                || value.asDouble() < -magnitude || value.asDouble() > magnitude) {
            errors.add(path + " must be a number from " + (-magnitude) + " to " + magnitude);
        }
    }

    private void validateExpressionCondition(List<String> errors, JsonNode condition, String path, GameConfig loadoutSpec, Map<String, String> customVariableTypes) {
        JsonNode leftNode = condition.get("left");
        if (leftNode == null || !leftNode.isTextual()) {
            errors.add(path + ".left must be a variable id");
            return;
        }
        String left = leftNode.asText();
        BotLogicContracts.VariableContract variableContract = BotLogicContracts.variableContract(left);
        String valueType = left.startsWith(BotLogicContracts.CUSTOM_VARIABLE_PREFIX)
                ? customVariableTypes.get(left)
                : variableValueType(left);
        if (valueType == null) {
            errors.add(path + ".left is not an allowed variable");
            return;
        }
        JsonNode comparatorNode = condition.get("comparator");
        String comparator = comparatorNode != null && comparatorNode.isTextual() ? comparatorNode.asText() : "";
        if ("number".equals(valueType) && !BotLogicContracts.numericComparators().contains(comparator)) {
            errors.add(path + ".comparator is not allowed for number variables");
        }
        if ("boolean".equals(valueType) && !BotLogicContracts.booleanComparators().contains(comparator)) {
            errors.add(path + ".comparator is not allowed for boolean variables");
        }
        String selectedLeftTarget = selectedConditionTarget(condition, "leftTarget", variableContract);
        validateConditionTarget(errors, path + ".leftTarget", selectedLeftTarget, variableContract,
                condition.has("leftTarget") || condition.has("target"));

        JsonNode right = condition.get("right");
        if (right == null || !right.isObject()) {
            errors.add(path + ".right must be an operand object");
            return;
        }
        JsonNode rightTypeNode = right.get("type");
        if (rightTypeNode == null || !rightTypeNode.isTextual()) {
            errors.add(path + ".right.type must be a string");
            return;
        }
        String rightType = rightTypeNode.asText();
        JsonNode rightValue = right.get("value");
        BotLogicContracts.VariableContract rightContract = "variable".equals(rightType) && rightValue != null && rightValue.isTextual()
                ? BotLogicContracts.variableContract(rightValue.asText()) : null;
        validateSelectedConditionMetadata(errors, condition, path, variableContract, rightContract);
        if ("variable".equals(rightType) && rightValue != null && rightValue.isTextual()) {
            String selectedRightTarget = selectedConditionTarget(condition, "rightTarget", rightContract);
            validateConditionTarget(errors, path + ".rightTarget", selectedRightTarget, rightContract,
                    condition.has("rightTarget") || condition.has("target"));
        }
        if ("number".equals(valueType)) {
            if ("number".equals(rightType)) {
                if (rightValue == null || !rightValue.isNumber()) {
                    errors.add(path + ".right.value must be a number");
                } else if (variableContract != null && variableContract.angle()
                        && (!Double.isFinite(rightValue.asDouble())
                        || rightValue.asDouble() < BotLogicContracts.ANGLE_MIN
                        || rightValue.asDouble() > BotLogicContracts.ANGLE_MAX)) {
                    errors.add(path + ".right.value must be an angle from -360 to 360 degrees");
                } else if (!Double.isFinite(rightValue.asDouble()) || rightValue.asDouble() < -CUSTOM_NUMBER_LIMIT || rightValue.asDouble() > CUSTOM_NUMBER_LIMIT) {
                    errors.add(path + ".right.value must be between -99999 and 99999");
                } else if (variableContract != null && variableContract.nonNegativeTime() && rightValue.asDouble() < 0) {
                    errors.add(path + ".right.value cannot be negative for time variables");
                } else if (variableContract != null && variableContract.durationSeconds()
                        && (rightValue.asDouble() < 0 || rightValue.asDouble() > 60)) {
                    errors.add(path + ".right.value must be between 0 and 60 seconds for status-effect duration variables");
                } else if (variableContract != null && !variableContract.angle()
                        && !variableContract.allowsNegativeInteger() && rightValue.asDouble() < 0) {
                    errors.add(path + ".right.value cannot be negative for this number variable");
                }
            } else if ("variable".equals(rightType)) {
                if (rightValue == null || !rightValue.isTextual() || !"number".equals(variableValueType(rightValue.asText())) && !"number".equals(customVariableTypes.get(rightValue.asText()))) {
                    errors.add(path + ".right.value must be a number variable");
                } else {
                }
            } else {
                errors.add(path + ".right.type is not allowed for number variables");
            }
        } else if ("boolean".equals(valueType)) {
            if (!"boolean".equals(rightType)) {
                errors.add(path + ".right.type is not allowed for boolean variables");
            } else if (rightValue == null || !rightValue.isBoolean()) {
                errors.add(path + ".right.value must be a boolean");
            }
        }
    }

    private static String selectedConditionTarget(JsonNode condition, String field,
            BotLogicContracts.VariableContract variableContract) {
        if (condition.has(field)) return condition.path(field).asText(BotLogicContracts.TARGET_OPPONENT);
        if (condition.has("target")) return condition.path("target").asText(BotLogicContracts.TARGET_OPPONENT);
        return BotLogicContracts.defaultTargetForVariable(variableContract);
    }

    private static void validateConditionTarget(List<String> errors, String path, String target,
            BotLogicContracts.VariableContract variableContract, boolean explicitlySelected) {
        if (variableContract == null) return;
        String base = target.split(":", -1)[0];
        BotLogicContracts.TargetContract targetContract = BotLogicContracts.targetContract(base);
        if (variableContract.objectTargetOnly()
                && (targetContract == null || targetContract.entityType() == null)) {
            errors.add(path + " must reference an ability entity target");
        }
        if (!variableContract.targetOrderable() && explicitlySelected && target.contains(":")) {
            errors.add(path + " does not support target ordering");
        }
        if (variableContract.requiresHealthTarget()
                && !BotLogicContracts.targetSupportsCapability(target, BotLogicContracts.TARGET_CAPABILITY_HEALTH)) {
            errors.add(path + " must reference a health-bearing target");
        }
        if (variableContract.botTargetOnly()
                && !BotLogicContracts.TARGET_OPPONENT.equals(base)) {
            errors.add(path + " must reference a bot target");
        }
    }

    private void validateSelectedConditionMetadata(
            List<String> errors,
            JsonNode condition,
            String path,
            BotLogicContracts.VariableContract leftContract,
            BotLogicContracts.VariableContract rightContract) {
        boolean requiresAbility = (leftContract != null && leftContract.requiresAbility())
                || (rightContract != null && rightContract.requiresAbility());
        if (requiresAbility) {
            JsonNode ability = condition.get("ability");
            if (ability == null || !ability.isIntegralNumber() || !ability.canConvertToInt() || !ALLOWED_ABILITIES.contains(ability.intValue())) {
                errors.add(path + ".ability must identify an allowed equipped ability");
            } else if ((leftContract != null && leftContract.source() == BotLogicContracts.VariableSource.SELECTED_ABILITY_CHARGES)
                    || (rightContract != null && rightContract.source() == BotLogicContracts.VariableSource.SELECTED_ABILITY_CHARGES)) {
                if (!Abilities.hasCharges(ability.intValue())) errors.add(path + ".ability must identify an ability with charges");
            } else if ((leftContract != null && (leftContract.source() == BotLogicContracts.VariableSource.SELECTED_ABILITY_PREPARING
                    || leftContract.source() == BotLogicContracts.VariableSource.SELECTED_ABILITY_PREPARATION_MS))
                    || (rightContract != null && (rightContract.source() == BotLogicContracts.VariableSource.SELECTED_ABILITY_PREPARING
                    || rightContract.source() == BotLogicContracts.VariableSource.SELECTED_ABILITY_PREPARATION_MS))) {
                if (Abilities.windupMs(ability.intValue()) <= 0) errors.add(path + ".ability does not have preparation time");
            }
        }
        boolean requiresStatusEffect = (leftContract != null && leftContract.requiresStatusEffect())
                || (rightContract != null && rightContract.requiresStatusEffect());
        if (requiresStatusEffect) {
            JsonNode statusEffect = condition.get("statusEffect");
            if (statusEffect == null || !statusEffect.isTextual() || !BotLogicContracts.statusEffects().contains(statusEffect.asText())) {
                errors.add(path + ".statusEffect must identify an allowed status effect");
            }
        }
    }

    private void validateSelectedAbilityLoadout(List<String> errors, JsonNode selectedAbility, Set<Integer> equipped, String path) {
        if (selectedAbility != null && selectedAbility.isIntegralNumber() && selectedAbility.canConvertToInt()
                && !GameConfigCatalog.STANDARD_ABILITIES.contains(selectedAbility.intValue()) && !equipped.contains(selectedAbility.intValue())) {
            errors.add(path + ".ability requires equipped ability " + selectedAbility.intValue());
        }
    }

    private void validateActionConfiguration(List<String> errors, JsonNode entry, JsonNode action, String path) {
        Object actionValue = action.isTextual() ? action.asText()
                : action.isIntegralNumber() && action.canConvertToInt() ? action.intValue() : null;
        BotLogicContracts.ActionContract actionContract = BotLogicContracts.actionContract(actionValue);
        if (actionContract != null && actionContract.movementConfig()) {
            String mode = entry.path("movementMode").asText("target");
            if (!BotLogicContracts.movementModes().contains(mode)) {
                errors.add(path + ".movementMode is not allowed");
                return;
            }
            String direction = entry.has("movementDirection")
                    ? entry.path("movementDirection").asText("")
                    : "absolute".equals(mode) ? BotLogicContracts.ACTION_MOVE_WALK.equals(actionValue) ? "0" : "north" : "0";
            boolean allowedDirection = "absolute".equals(mode)
                    ? BotLogicContracts.isAbsoluteDirection(actionValue, direction)
                    : BotLogicContracts.isRelativeDirection(direction);
            if (!allowedDirection) errors.add(path + ".movementDirection is not allowed for its movement mode");
            if ("coordinates".equals(mode)) {
                validateCoordinate(errors, entry.get("targetX"), path + ".targetX", 1000);
                validateCoordinate(errors, entry.get("targetY"), path + ".targetY", 800);
            }
        }
        if (actionContract != null && actionContract.coordinateTarget() && !actionContract.movementConfig()) {
            String mode = entry.path("targetMode").asText(entry.has("targetX") || entry.has("targetY") ? "coordinates" : "target");
            boolean validMode = "target".equals(mode) || "coordinates".equals(mode)
                    || (actionContract.angleTarget() && "angle".equals(mode));
            if (!validMode) {
                errors.add(path + ".targetMode is not allowed");
            } else if ("coordinates".equals(mode)) {
                validateCoordinate(errors, entry.get("targetX"), path + ".targetX", 1000);
                validateCoordinate(errors, entry.get("targetY"), path + ".targetY", 800);
            } else if ("angle".equals(mode)) {
                JsonNode angle = entry.get("targetAngle");
                if (angle == null || !angle.isNumber() || !Double.isFinite(angle.asDouble())
                        || angle.asDouble() < BotLogicContracts.ANGLE_MIN || angle.asDouble() > BotLogicContracts.ANGLE_MAX) {
                    errors.add(path + ".targetAngle must be an angle from -360 to 360 degrees");
                }
            }
        }
        if (actionContract != null && actionContract.orientationConfig()
                && !BotLogicContracts.facingModes().contains(entry.path("phaseFacingMode").asText("face_target"))) {
            errors.add(path + ".phaseFacingMode is not allowed");
        }
    }

    private String variableValueType(String variable) {
        return BotLogicContracts.variableValueType(variable);
    }

    private JsonNode submittedBrain(BotSubmissionPayloadDTO payload) {
        return payload.getBrain();
    }

    private void requireOneOf(List<String> errors, String value, String field, String... expectedValues) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        for (String expected : expectedValues) {
            if (expected.equals(value)) {
                return;
            }
        }

        errors.add(field + " is not supported");
    }

    private void requireText(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            errors.add(field + " is required");
        }
    }

    private void requireUuid(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            return;
        }

        try {
            UUID.fromString(value.trim());
        } catch (IllegalArgumentException ex) {
            errors.add(field + " must be a server-issued UUID");
        }
    }

    private boolean requireObject(List<String> errors, JsonNode value, String field) {
        if (value == null || value.isNull()) {
            errors.add(field + " is required");
            return false;
        }

        if (!value.isObject()) {
            errors.add(field + " must be an object");
            return false;
        }

        return true;
    }

    private void requireNonNegative(List<String> errors, Integer value, String field) {
        if (value == null) {
            errors.add(field + " is required");
            return;
        }

        rejectNegative(errors, value, field);
    }

    private void rejectNegative(List<String> errors, Integer value, String field) {
        if (value != null && value < 0) {
            errors.add(field + " cannot be negative");
        }
    }

    private void rejectTooLong(List<String> errors, String value, String field, int maxLength) {
        if (value != null && value.length() > maxLength) {
            errors.add(field + " cannot exceed " + maxLength + " characters");
        }
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
