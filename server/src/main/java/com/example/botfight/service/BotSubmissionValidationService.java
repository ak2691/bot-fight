package com.example.botfight.service;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.BotSubmissionValidationResponseDTO;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.GameConfig;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
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
    private static final int MAX_BUILDING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;
    private static final int MAX_LOGIC_BLOCKS = 100;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final int MAX_CUSTOM_VARIABLE_SLOTS = 100;
    private static final int CUSTOM_INTEGER_LIMIT = 99_999;
    private static final int MAX_ROOTS = 100;
    private static final int MAX_CONDITIONS_PER_BLOCK = MAX_TOTAL_CONDITIONS;
    private static final String MODULO_COMPARATOR = "modulo";
    private static final Set<String> MOVEMENT_ACTIONS = Set.of(
            "none",
            "move_walk",
            "rotate_toward_enemy");
    private static final Set<String> MOVEMENT_MODES = Set.of("target", "coordinates", "absolute");
    private static final Set<String> RELATIVE_DIRECTIONS = Set.of(
            "toward", "away", "left", "right", "toward_left", "toward_right", "away_left", "away_right");
    private static final Set<String> ABSOLUTE_DIRECTIONS = Set.of(
            "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "stop");
    private static final Set<String> NUMBER_VARIABLES = Set.of(
            "match.elapsedSeconds",
            "my.hp",
            "my.damageTakenLastTick",
            "my.hpNetChangeLastTick",
            "my.x",
            "my.y",
            "opponent.hp",
            "opponent.damageTakenLastTick",
            "opponent.hpNetChangeLastTick",
            "opponent.x",
            "opponent.y",
            "target.distance",
            "target.hp",
            "target.bearingFromMe",
            "target.movementDirection",
            "target.velocity",
            "my.bearingFromTarget",
            "target.relativeBearing",
            "target.relativeBearingClockwise",
            "target.relativeBearingCounterclockwise",
            "target.facing",
            "target.count",
            "target.age",
            "my.selectedAbilityCooldownMs",
            "my.selectedAbilityAmmo",
            "my.selectedAbilityPreparationMs",
            "my.selectedStatusEffectDurationMs",
            "opponent.selectedAbilityCooldownMs",
            "opponent.selectedAbilityAmmo",
            "opponent.selectedAbilityPreparationMs",
            "opponent.selectedStatusEffectDurationMs",
            "my.edgeDistance",
            "target.edgeDistance");
    private static final Set<String> BOOLEAN_VARIABLES = Set.of(
            "target.exists",
            "target.alive",
            "my.selectedAbilityReady",
            "my.selectedAbilityPreparing",
            "opponent.selectedAbilityReady",
            "opponent.selectedAbilityPreparing",
            "my.selectedStatusEffectActive",
            "opponent.selectedStatusEffectActive");
    private static final Set<String> ALLOWED_STATUS_EFFECTS = Set.of("burn", "stun", "bleed", "slow", "shock", "silence");
    private static final Set<String> NUMERIC_COMPARATORS = Set.of("lt", "lte", "eq", "neq", "gte", "gt");
    private static final Set<String> BOOLEAN_COMPARATORS = Set.of("eq", "neq");
    private static final Set<String> BASE_ALLOWED_TARGETS = Set.of(
            "opponent", "orbital_zone", "opponent_grenade", "opponent_fireball",
            "opponent_concussive_shot", "opponent_proximity_mine", "opponent_gravity_field",
            "opponent_hunter_drone", "opponent_orbital_zone", "opponent_null_zone", "opponent_silence_wave", "opponent_temporal_rewind_zone",
            "my_grenade", "my_fireball", "my_concussive_shot", "my_proximity_mine", "my_gravity_field", "my_hunter_drone",
            "my_orbital_zone", "my_null_zone", "my_silence_wave", "my_temporal_rewind_zone");
    private static final Set<Integer> ALLOWED_ABILITIES = Set.copyOf(com.example.botfight.simulation.gameconfig.AbilityRegistry.all().keySet());
    private static final Set<String> STAT_POINT_KEYS = Set.of("maxHp", "moveSpeed", "attackDamage", "attackSpeed");

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

        rejectTooLong(errors, payload.getBuildingSessionId(), "buildingSessionId", MAX_BUILDING_SESSION_ID_LENGTH);
        rejectTooLong(errors, payload.getSelectedLoadout(), "selectedLoadout", MAX_SELECTED_LOADOUT_LENGTH);
        rejectTooLong(errors, payload.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        requireText(errors, payload.getBuildingSessionId(), "buildingSessionId");
        requireUuid(errors, payload.getBuildingSessionId(), "buildingSessionId");
        GameConfig loadoutSpec = combatLoadoutes.duelV1();
        JsonNode brain = submittedBrain(payload);
        validateBrain(errors, brain, loadoutSpec);

        return response(errors.isEmpty(), errors, warnings, false);
    }

    /** Validates an in-memory brain with the same logic contract as a saved submission. */
    public List<String> validateForSimulation(JsonNode brain) {
        List<String> errors = new ArrayList<>();
        validateBrain(errors, brain, combatLoadoutes.duelV1());
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
        Map<String, String> customVariableTypes = customVariableTypes(brain);
        if (countConditionSlots(brain) > MAX_TOTAL_CONDITIONS) errors.add("brain exceeds the total condition limit including derived custom variables");
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
        JsonNode statPoints = loadout.get("statPoints");
        if (statPoints == null || !statPoints.isObject()) {
            errors.add("brain.loadout.statPoints must be an object");
            return;
        }
        int total = 0;
        for (String key : STAT_POINT_KEYS) {
            JsonNode value = statPoints.get(key);
            if (value == null || !value.isIntegralNumber() || value.asInt() < 0 || value.asInt() > 12) {
                errors.add("brain.loadout.statPoints." + key + " must be an integer from 0 to 12");
            } else {
                total += value.asInt();
            }
        }
        if (total > 12) errors.add("brain.loadout.statPoints exceeds the match budget of 12");
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
            if ("number".equals(type) && (initial == null || !initial.isIntegralNumber() || initial.asLong() < -CUSTOM_INTEGER_LIMIT || initial.asLong() > CUSTOM_INTEGER_LIMIT)) errors.add(path + ".initialValue must be an integer from -99999 to 99999");
            if ("boolean".equals(type) && (initial == null || !initial.isBoolean())) errors.add(path + ".initialValue must be boolean");
            JsonNode conditions = variable.get("conditions");
            if (conditions != null && !conditions.isArray()) errors.add(path + ".conditions must be an array");
            if (conditions != null && conditions.isArray() && !"boolean".equals(type)) errors.add(path + ".conditions are only allowed for boolean variables");
        }
        if (countVariableSlots(brain) > MAX_CUSTOM_VARIABLE_SLOTS) errors.add("brain.customVariables exceeds the 100 variable-slot limit");
        for (int index = 0; index < variables.size(); index++) {
            JsonNode variable = variables.get(index);
            JsonNode conditions = variable != null ? variable.get("conditions") : null;
            if (conditions != null && conditions.isArray() && "boolean".equals(variable.path("valueType").asText(""))) {
                for (int conditionIndex = 0; conditionIndex < conditions.size(); conditionIndex++) {
                    validateConditionAllowed(errors, conditions.get(conditionIndex),
                            "brain.customVariables[" + index + "].conditions[" + conditionIndex + "]",
                            loadoutSpec, types);
                }
            }
        }
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
            JsonNode conditions = variable.get("conditions");
            if ("boolean".equals(variable.path("valueType").asText("")) && conditions != null && conditions.isArray()) total += conditions.size();
        }
        return total;
    }

    private int countConditionSlots(JsonNode brain) {
        java.util.Map<String, Integer> costs = new java.util.HashMap<>();
        JsonNode variables = brain.get("customVariables");
        int total = 0;
        if (variables != null && variables.isArray()) for (JsonNode variable : variables) {
            JsonNode conditions = variable.get("conditions");
            int derived = "boolean".equals(variable.path("valueType").asText("")) && conditions != null && conditions.isArray() ? conditions.size() : 0;
            costs.put(variable.path("id").asText(""), 1 + derived);
            total += derived;
        }
        total += countBrainConditionSlots(brain.get("roots"), costs);
        return total;
    }

    private int countBrainConditionSlots(JsonNode node, java.util.Map<String, Integer> costs) {
        if (node == null) return 0;
        if (node.isArray()) { int total = 0; for (JsonNode child : node) total += countBrainConditionSlots(child, costs); return total; }
        if (!node.isObject()) return 0;
        if ("expression".equals(node.path("type").asText(""))) {
            Set<String> referenced = new HashSet<>();
            String left = node.path("left").asText("");
            if (costs.containsKey(left)) referenced.add(left);
            JsonNode right = node.get("right");
            if (right != null && "variable".equals(right.path("type").asText(""))) {
                String rightId = right.path("value").asText("");
                if (costs.containsKey(rightId)) referenced.add(rightId);
            }
            return referenced.isEmpty() ? 1 : referenced.stream().mapToInt(costs::get).sum();
        }
        if (node.hasNonNull("type") && !Set.of("number", "boolean", "variable", "range").contains(node.path("type").asText(""))) return 1;
        int total = 0;
        for (var entry : node.properties()) total += countBrainConditionSlots(entry.getValue(), costs);
        return total;
    }

    private void validateCustomReferences(List<String> errors, JsonNode node, String path, java.util.Map<String, String> types) {
        if (node == null) return;
        if (node.isArray()) { for (int i = 0; i < node.size(); i++) validateCustomReferences(errors, node.get(i), path + "[" + i + "]", types); return; }
        if (!node.isObject()) return;
        if ("expression".equals(node.hasNonNull("type") ? node.get("type").asText() : "")) {
            String left = node.hasNonNull("left") ? node.get("left").asText() : "";
            if (left.startsWith("custom.") && !types.containsKey(left)) errors.add(path + ".left references an unknown custom variable");
            if (types.containsKey(left)) {
                JsonNode rightNode = node.get("right");
                boolean booleanOperand = rightNode != null && "boolean".equals(rightNode.hasNonNull("type") ? rightNode.get("type").asText() : "");
                if (booleanOperand != "boolean".equals(types.get(left))) errors.add(path + ".left uses the wrong custom variable type");
            }
            JsonNode rightNode = node.get("right");
            String right = rightNode != null && rightNode.hasNonNull("value") ? rightNode.get("value").asText() : "";
            if (right.startsWith("custom.") && !"number".equals(types.get(right))) errors.add(path + ".right.value must reference an existing integer custom variable");
        }
        if ("variable".equals(node.hasNonNull("action") ? node.get("action").asText() : "")) {
            String id = node.hasNonNull("variableId") ? node.get("variableId").asText() : "";
            String type = types.get(id);
            if (type == null) errors.add(path + ".variableId references an unknown custom variable");
            JsonNode value = node.get("value");
            String operation = node.hasNonNull("operation") ? node.get("operation").asText() : "set";
            if ("boolean".equals(type) && (value == null || !value.isBoolean() || !"set".equals(operation))) errors.add(path + " boolean variable actions must set true or false");
            JsonNode terms = node.get("terms");
            if ("number".equals(type) && terms != null) {
                if (!terms.isArray() || terms.isEmpty() || terms.size() > 20) errors.add(path + ".terms must contain 1 to 20 operands");
                else for (int index = 0; index < terms.size(); index++) {
                    JsonNode term = terms.get(index);
                    String termOperation = term.path("operator").asText("");
                    if (!Set.of("set", "add", "subtract").contains(termOperation) || (index > 0 && "set".equals(termOperation))) errors.add(path + ".terms[" + index + "].operator is invalid");
                    JsonNode operand = term.path("operand");
                    String operandType = operand.path("type").asText("");
                    if ("number".equals(operandType) && (!operand.path("value").isIntegralNumber() || Math.abs(operand.path("value").asLong()) > CUSTOM_INTEGER_LIMIT)) errors.add(path + ".terms[" + index + "].operand is invalid");
                    else if ("variable".equals(operandType)) {
                        String operandId = operand.path("value").asText("");
                        if (!(NUMBER_VARIABLES.contains(operandId) || "number".equals(types.get(operandId)))) errors.add(path + ".terms[" + index + "].operand must reference a numeric variable");
                    } else if (!"number".equals(operandType)) errors.add(path + ".terms[" + index + "].operand.type is invalid");
                }
            } else if ("number".equals(type) && (value == null || !value.isIntegralNumber() || Math.abs(value.asLong()) > CUSTOM_INTEGER_LIMIT || !Set.of("set", "add", "subtract").contains(operation))) errors.add(path + " integer variable action is invalid");
        }
        node.properties().forEach(entry -> validateCustomReferences(errors, entry.getValue(), path + "." + entry.getKey(), types));
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
        if (left != null && left.isTextual() && left.asText().startsWith("my.selectedAbility")
                && selectedAbility != null && selectedAbility.isIntegralNumber() && selectedAbility.canConvertToInt()
                && !GameConfigCatalog.STANDARD_ABILITIES.contains(selectedAbility.intValue()) && !equipped.contains(selectedAbility.intValue())) {
            errors.add(path + ".ability requires equipped ability " + selectedAbility.intValue());
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
                if (actionNode.isIntegralNumber() && actionNode.intValue() == 22) {
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
                String headKey = "variable".equals(head) ? head + ":" + entry.path("variableId").asText(index + "") : head;
                if (!heads.add(headKey)) errors.add(path + " has multiple " + head + " actions");
            }
            if (heads.contains("none") && heads.size() > 1) errors.add(path + " cannot combine N/A with executable actions");
        } else if (!block.hasNonNull("action") || !(block.get("action").isTextual() || block.get("action").isIntegralNumber())) {
            errors.add(path + ".action must be a movement action string or numeric ability ID");
        } else {
            validateActionAllowed(errors, block.get("action"), path, loadoutSpec);
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
                if (entry != null && entry.isObject() && !"none".equals(entry.path("action").asText("none"))) count++;
            }
            return count;
        }
        return "none".equals(block.path("action").asText("none")) ? 0 : 1;
    }

    private String validationActionHead(String action) {
        if (action == null) return "ability";
        if ("none".equals(action)) return "none";
        if ("variable".equals(action)) return "variable";
        if ("rotate_toward_enemy".equals(action)) return "rotation";
        if (MOVEMENT_ACTIONS.contains(action)) return "movement";
        return "ability";
    }

    private void validateActionAllowed(List<String> errors, JsonNode action, String path, GameConfig loadoutSpec) {
        boolean allowed = action != null && ((action.isTextual()
                && (MOVEMENT_ACTIONS.contains(action.asText()) || "variable".equals(action.asText())))
                || (action.isIntegralNumber() && action.canConvertToInt() && ALLOWED_ABILITIES.contains(action.intValue())));
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
        if ("expression".equals(type)) {
            validateExpressionCondition(errors, condition, path, loadoutSpec, customVariableTypes);
            return;
        }
        if (!"always".equals(type)) {
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
        if (BASE_ALLOWED_TARGETS.contains(target)) return true;
        String[] parts = target.split(":", -1);
        if (parts.length != 3 || !BASE_ALLOWED_TARGETS.contains(parts[0]) || "opponent".equals(parts[0])) return false;
        if (!Set.of("closest", "farthest", "oldest", "newest").contains(parts[1])) return false;
        try {
            int ordinal = Integer.parseInt(parts[2]);
            return ordinal >= 1 && ordinal <= 100;
        } catch (NumberFormatException ignored) {
            return false;
        }
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
        String valueType = left.startsWith("custom.")
                ? customVariableTypes.get(left)
                : variableValueType(left);
        if (valueType == null) {
            errors.add(path + ".left is not an allowed variable");
            return;
        }
        if (left.contains(".selectedAbility")) {
            JsonNode ability = condition.get("ability");
            if (ability == null || !ability.isIntegralNumber() || !ability.canConvertToInt() || !ALLOWED_ABILITIES.contains(ability.intValue())) {
                errors.add(path + ".ability must identify an allowed equipped ability");
            } else if (left.endsWith("Preparing") || left.endsWith("PreparationMs")) {
                if (Abilities.windupMs(ability.intValue()) <= 0) errors.add(path + ".ability does not have preparation time");
            }
        }
        if (left.endsWith(".selectedStatusEffectActive") || left.endsWith(".selectedStatusEffectDurationMs")) {
            JsonNode statusEffect = condition.get("statusEffect");
            if (statusEffect == null || !statusEffect.isTextual() || !ALLOWED_STATUS_EFFECTS.contains(statusEffect.asText())) {
                errors.add(path + ".statusEffect must identify an allowed status effect");
            }
        }

        JsonNode comparatorNode = condition.get("comparator");
        String comparator = comparatorNode != null && comparatorNode.isTextual() ? comparatorNode.asText() : "";
        boolean directionRange = Set.of("target.bearingFromMe", "target.movementDirection").contains(left);
        if ("number".equals(valueType) && !directionRange && !NUMERIC_COMPARATORS.contains(comparator)
                && !MODULO_COMPARATOR.equals(comparator)) {
            errors.add(path + ".comparator is not allowed for number variables");
        }
        if (directionRange && !"range".equals(comparator)) {
            errors.add(path + ".comparator must be range for directional variables");
        }
        if ("boolean".equals(valueType) && !BOOLEAN_COMPARATORS.contains(comparator)) {
            errors.add(path + ".comparator is not allowed for boolean variables");
        }
        if (MODULO_COMPARATOR.equals(comparator)) {
            if (!"number".equals(valueType)) errors.add(path + ".comparator is only allowed for number variables");
            if (directionRange) errors.add(path + ".comparator is not allowed for directional variables");
            validateModuloOperator(errors, condition, path);
        }

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
        if ("number".equals(valueType)) {
            if (directionRange) {
                JsonNode minimum = right.get("min");
                JsonNode maximum = right.get("max");
                if (!"range".equals(rightType) || minimum == null || !minimum.isNumber() || maximum == null || !maximum.isNumber()) {
                    errors.add(path + ".right must be a numeric direction range");
                } else if (minimum.asDouble() < -360 || minimum.asDouble() > 360
                        || maximum.asDouble() < -360 || maximum.asDouble() > 360
                        || Math.abs(maximum.asDouble() - minimum.asDouble()) > 360) {
                    errors.add(path + ".right direction bounds must be within -360 to 360 and span at most 360 degrees");
                }
            } else if ("number".equals(rightType)) {
                if (rightValue == null || !rightValue.isNumber()) {
                    errors.add(path + ".right.value must be a number");
                } else if (MODULO_COMPARATOR.equals(comparator)) {
                    if (!isValidModuloInteger(rightValue)) {
                        errors.add(path + ".right.value must be a finite number from -99999 to 99999 for modulo conditions");
                    }
                } else if (!Double.isFinite(rightValue.asDouble()) || rightValue.asDouble() < -CUSTOM_INTEGER_LIMIT || rightValue.asDouble() > CUSTOM_INTEGER_LIMIT) {
                    errors.add(path + ".right.value must be between -99999 and 99999");
                } else if (Set.of("match.elapsedSeconds", "target.age").contains(left) && rightValue.asDouble() < 0) {
                    errors.add(path + ".right.value cannot be negative for time variables");
                } else if (Set.of("my.selectedStatusEffectDurationMs", "opponent.selectedStatusEffectDurationMs").contains(left)
                        && (rightValue.asDouble() < 0 || rightValue.asDouble() > 60)) {
                    errors.add(path + ".right.value must be between 0 and 60 seconds for status-effect duration variables");
                } else if ("target.age".equals(left) && Math.abs(rightValue.asDouble() * 10.0 - Math.rint(rightValue.asDouble() * 10.0)) > 1e-9) {
                    errors.add(path + ".right.value for target.age must use 0.1 second increments");
                } else if ("match.elapsedSeconds".equals(left) && Math.abs(rightValue.asDouble() * 10.0 - Math.rint(rightValue.asDouble() * 10.0)) > 1e-9) {
                    errors.add(path + ".right.value for elapsed time must use 0.1 second increments");
                } else if (Set.of("my.selectedStatusEffectDurationMs", "opponent.selectedStatusEffectDurationMs").contains(left)
                        && Math.abs(rightValue.asDouble() * 10.0 - Math.rint(rightValue.asDouble() * 10.0)) > 1e-9) {
                    errors.add(path + ".right.value for status-effect duration must use 0.1 second increments");
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

    private void validateActionConfiguration(List<String> errors, JsonNode entry, JsonNode action, String path) {
        if ((action.isTextual() && "move_walk".equals(action.asText())) || (action.isIntegralNumber() && action.intValue() == 19)) {
            String mode = entry.path("movementMode").asText("target");
            if (!MOVEMENT_MODES.contains(mode)) {
                errors.add(path + ".movementMode is not allowed");
                return;
            }
            String direction = entry.path("movementDirection").asText(
                    "absolute".equals(mode) ? "north" : "toward");
            Set<String> allowedDirections = "absolute".equals(mode) ? ABSOLUTE_DIRECTIONS : RELATIVE_DIRECTIONS;
            if (!allowedDirections.contains(direction)) errors.add(path + ".movementDirection is not allowed for its movement mode");
            if ("coordinates".equals(mode)) {
                validateCoordinate(errors, entry.get("targetX"), path + ".targetX", 1000);
                validateCoordinate(errors, entry.get("targetY"), path + ".targetY", 800);
            }
        }
        if (action.isIntegralNumber() && action.intValue() == 25
                && !Set.of("face_target", "keep", "face_origin", "mirror")
                        .contains(entry.path("phaseFacingMode").asText("face_target"))) {
            errors.add(path + ".phaseFacingMode is not allowed");
        }
    }

    private void validateModuloOperator(List<String> errors, JsonNode condition, String path) {
        JsonNode modulo = condition.get("modulo");
        if (modulo == null || !modulo.isObject()) {
            errors.add(path + ".modulo must be an object");
            return;
        }
        JsonNode divisor = modulo.get("divisor");
        if (!isValidModuloInteger(divisor)) {
            errors.add(path + ".modulo.divisor must be a finite number from -99999 to 99999");
        } else if (Math.floor(divisor.asDouble()) == 0) {
            errors.add(path + ".modulo.divisor cannot be 0");
        }
        String comparator = modulo.path("comparator").asText("");
        if (!NUMERIC_COMPARATORS.contains(comparator)) {
            errors.add(path + ".modulo.comparator must be an ordinary numeric comparison operator");
        }
    }

    private static boolean isValidModuloInteger(JsonNode value) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble())) return false;
        double integerValue = Math.floor(value.asDouble());
        return integerValue >= -CUSTOM_INTEGER_LIMIT && integerValue <= CUSTOM_INTEGER_LIMIT;
    }

    private String variableValueType(String variable) {
        if (NUMBER_VARIABLES.contains(variable)) return "number";
        if (BOOLEAN_VARIABLES.contains(variable)) return "boolean";
        return null;
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
