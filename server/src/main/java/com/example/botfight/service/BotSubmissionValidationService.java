package com.example.botfight.service;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.BotSubmissionValidationResponseDTO;
import com.example.botfight.simulation.combat.CombatCatalog;
import com.example.botfight.simulation.combat.CombatRules;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class BotSubmissionValidationService {

    private static final String VALIDATOR_VERSION = "bot-brain-submission-v1";
    private static final String BRAIN_SCHEMA_VERSION = "bot-logic-tree-v1";
    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TESTING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;
    private static final int MAX_LOGIC_BLOCKS = 100;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final int MAX_CUSTOM_VARIABLE_SLOTS = 100;
    private static final int CUSTOM_INTEGER_LIMIT = 99_999;
    private static final int MAX_CLUSTERS = 100;
    private static final int MAX_CONDITIONS_PER_BLOCK = MAX_TOTAL_CONDITIONS;
    private static final Set<String> MOVEMENT_ACTIONS = Set.of(
            "none",
            "move_walk",
            "move_inward",
            "move_outward",
            "move_tangent_left",
            "move_tangent_right",
            "move_diagonal_in_left",
            "move_diagonal_in_right",
            "move_diagonal_out_left",
            "move_diagonal_out_right",
            "move_center",
            "move_north",
            "move_south",
            "move_east",
            "move_west",
            "move_northeast",
            "move_northwest",
            "move_southeast",
            "move_southwest",
            "move_stop",
            "rotate_toward_enemy");
    private static final Set<String> DASH_ACTIONS = Set.of(
            "no_dash",
            "dash",
            "dash_outward",
            "dash_tangent_left",
            "dash_tangent_right",
            "dash_diagonal_in_left",
            "dash_diagonal_in_right",
            "dash_diagonal_out_left",
            "dash_diagonal_out_right",
            "dash_north",
            "dash_south",
            "dash_east",
            "dash_west",
            "dash_northeast",
            "dash_northwest",
            "dash_southeast",
            "dash_southwest");
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
            "opponent.selectedAbilityCooldownMs",
            "opponent.selectedAbilityAmmo",
            "opponent.selectedAbilityPreparationMs",
            "my.edgeDistance",
            "target.edgeDistance");
    private static final Set<String> BOOLEAN_VARIABLES = Set.of(
            "target.exists",
            "target.alive",
            "my.selectedAbilityReady",
            "my.selectedAbilityPreparing",
            "opponent.selectedAbilityReady",
            "opponent.selectedAbilityPreparing");
    private static final Set<String> NUMERIC_COMPARATORS = Set.of("lt", "lte", "eq", "neq", "gte", "gt");
    private static final Set<String> BOOLEAN_COMPARATORS = Set.of("eq", "neq");
    private static final Set<String> BASE_ALLOWED_TARGETS = Set.of(
            "opponent", "orbital_zone", "opponent_grenade", "opponent_fireball",
            "opponent_concussive_shot", "opponent_proximity_mine", "opponent_gravity_field",
            "opponent_hunter_drone", "opponent_orbital_zone", "opponent_null_zone", "opponent_silence_wave", "opponent_temporal_rewind_zone",
            "my_grenade", "my_fireball", "my_concussive_shot", "my_proximity_mine", "my_gravity_field", "my_hunter_drone",
            "my_orbital_zone", "my_null_zone", "my_silence_wave", "my_temporal_rewind_zone");
    private static final Set<String> ALLOWED_ABILITIES = Set.of(
            "swing", "block", "dash", "fire_gun", "throw_grenade", "shoot_fireball", "stun",
            "heavy_slash", "repulsor_burst", "concussive_shot", "repair_pulse", "proximity_mine",
            "quick_jab", "pistol_shot", "rail_shot", "gravity_grenade", "silence_pulse",
            "reactive_armor", "hunter_drone", "thrust", "micro_dash", "temporal_rewind",
            "orbital_strike", "absolute_guard", "null_zone", "phase_strike");
    private static final Set<String> PROTOTYPE_ACTIONS = Set.of(
            "heavy_slash", "repulsor_burst", "concussive_shot", "repair_pulse", "proximity_mine",
            "quick_jab", "pistol_shot", "rail_shot", "gravity_grenade",
            "silence_pulse", "reactive_armor", "hunter_drone", "thrust", "micro_dash", "micro_dash_outward",
            "micro_dash_left", "micro_dash_right", "micro_dash_toward_left", "micro_dash_toward_right", "micro_dash_away_left", "micro_dash_away_right", "micro_dash_north", "micro_dash_south", "micro_dash_east", "micro_dash_west",
            "micro_dash_northeast", "micro_dash_northwest", "micro_dash_southeast", "micro_dash_southwest",
            "temporal_rewind", "orbital_strike", "absolute_guard", "null_zone", "phase_strike", "phase_strike_keep_facing",
            "phase_strike_face_origin", "phase_strike_mirror_facing");
    private static final Set<String> PREPARING_ABILITIES = Set.of("heavy_slash", "concussive_shot", "repair_pulse", "rail_shot", "silence_pulse", "null_zone");
    private static final Set<String> STAT_POINT_KEYS = Set.of("maxHp", "moveSpeed", "attackDamage", "attackSpeed");

    private final JsonMapper jsonMapper;
    private final CombatCatalog combatLoadoutes;

    public BotSubmissionValidationService(JsonMapper jsonMapper, CombatCatalog combatLoadoutes) {
        this.jsonMapper = jsonMapper;
        this.combatLoadoutes = combatLoadoutes;
    }

    public BotSubmissionValidationResponseDTO validate(BotSubmissionPayloadDTO payload) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (payload == null) {
            errors.add("submission payload is required");
            return response(false, errors, warnings, null, null, false);
        }

        rejectTooLong(errors, payload.getTestingSessionId(), "testingSessionId", MAX_TESTING_SESSION_ID_LENGTH);
        rejectTooLong(errors, payload.getSelectedLoadout(), "selectedLoadout", MAX_SELECTED_LOADOUT_LENGTH);
        rejectTooLong(errors, payload.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        requireText(errors, payload.getTestingSessionId(), "testingSessionId");
        requireUuid(errors, payload.getTestingSessionId(), "testingSessionId");
        CombatRules loadoutSpec = combatLoadoutes.duelV1();
        JsonNode brain = submittedBrain(payload);
        validateBrain(errors, brain, loadoutSpec);

        if (payload.getTestingDurationMs() == null) {
            warnings.add("testingDurationMs will be computed from the server-owned testing session");
        }

        return response(errors.isEmpty(), errors, warnings, null, null,
                payload.getTestingDurationMs() != null);
    }

    private BotSubmissionValidationResponseDTO response(
            boolean accepted,
            List<String> errors,
            List<String> warnings,
            String submittedHash,
            String computedHash,
            boolean testingDurationTrusted) {
        BotSubmissionValidationResponseDTO response = new BotSubmissionValidationResponseDTO();
        response.setAccepted(accepted);
        response.setStatus(accepted ? "ACCEPTED" : "REJECTED");
            response.setMessage(accepted
                ? "Bot brain passed validation"
                : "Bot brain failed validation");
        response.setValidatorVersion(VALIDATOR_VERSION);
        response.setSubmittedBrainHash(submittedHash);
        response.setComputedModelHash(computedHash);
        response.setTestingDurationTrusted(testingDurationTrusted);
        response.setErrors(errors);
        response.setWarnings(warnings);
        return response;
    }

    private void validateBrain(List<String> errors, JsonNode brain, CombatRules loadoutSpec) {
        if (!requireObject(errors, brain, "brain")) {
            return;
        }

        if (!brain.hasNonNull("version") || !brain.get("version").isTextual()) {
            errors.add("brain.version must be a string");
        } else if (!BRAIN_SCHEMA_VERSION.equals(brain.get("version").asText())) {
            errors.add("brain.version must be " + BRAIN_SCHEMA_VERSION);
        }
        validateLoadout(errors, brain.get("loadout"));
        validateCustomVariables(errors, brain);
        if (countConditionSlots(brain) > MAX_TOTAL_CONDITIONS) errors.add("brain exceeds the total condition limit including derived custom variables");
        validateActionsAgainstLoadout(errors, brain);

        JsonNode columns = brain.get("columns");
        if (columns != null) {
            validateLogicColumns(errors, columns, loadoutSpec);
            return;
        }

        if (!brain.hasNonNull("blocks") || !brain.get("blocks").isArray()) {
            errors.add("brain must contain a columns array or legacy blocks array");
            return;
        }

        int blockCount = 0;
        int conditionCount = 0;
        JsonNode blocks = brain.get("blocks");
        for (JsonNode block : blocks) blockCount += executableActionCount(block);
        if (blockCount > MAX_LOGIC_BLOCKS) {
            errors.add("brain.blocks exceeds the logic block limit");
        }
        for (int index = 0; index < blocks.size(); index++) {
            conditionCount += conditionCount(blocks.get(index));
            validateLogicBlock(errors, blocks.get(index), "brain.blocks[" + index + "]", loadoutSpec);
        }

        JsonNode clusters = brain.get("clusters");
        if (clusters != null) {
            if (!clusters.isArray()) {
                errors.add("brain.clusters must be an array");
            } else {
                if (clusters.size() > MAX_CLUSTERS) {
                    errors.add("brain.clusters exceeds the cluster limit");
                }
                for (int clusterIndex = 0; clusterIndex < clusters.size(); clusterIndex++) {
                    JsonNode cluster = clusters.get(clusterIndex);
                    String clusterPath = "brain.clusters[" + clusterIndex + "]";
                    if (!cluster.isObject()) {
                        errors.add(clusterPath + " must be an object");
                        continue;
                    }
                    JsonNode clusterConditions = cluster.get("conditions");
                    if (clusterConditions == null || !clusterConditions.isArray()) {
                        errors.add(clusterPath + ".conditions must be an array");
                    } else if (clusterConditions.size() > MAX_CONDITIONS_PER_BLOCK) {
                        errors.add(clusterPath + ".conditions exceeds the condition limit");
                    } else {
                        conditionCount += clusterConditions.size();
                    }
                    JsonNode clusterBlocks = cluster.get("blocks");
                    if (clusterBlocks == null || !clusterBlocks.isArray()) {
                        errors.add(clusterPath + ".blocks must be an array");
                        continue;
                    }
                    for (JsonNode block : clusterBlocks) blockCount += executableActionCount(block);
                    if (blockCount > MAX_LOGIC_BLOCKS) {
                        errors.add("brain blocks exceed the logic block limit");
                    }
                    for (int blockIndex = 0; blockIndex < clusterBlocks.size(); blockIndex++) {
                        conditionCount += conditionCount(clusterBlocks.get(blockIndex));
                        validateLogicBlock(errors, clusterBlocks.get(blockIndex),
                                clusterPath + ".blocks[" + blockIndex + "]", loadoutSpec);
                    }
                }
            }
        }
        if (conditionCount > MAX_TOTAL_CONDITIONS) errors.add("brain exceeds the total condition limit");
    }

    private void validateLoadout(List<String> errors, JsonNode loadout) {
        if (loadout == null) return; // Legacy replay/submission compatibility.
        if (!loadout.isObject()) {
            errors.add("brain.loadout must be an object");
            return;
        }
        JsonNode abilities = loadout.get("abilities");
        if (abilities == null || !abilities.isArray() || abilities.size() > 6) {
            errors.add("brain.loadout.abilities must contain between 0 and 6 abilities");
        } else {
            Set<String> seen = new HashSet<>();
            abilities.forEach(ability -> {
                if (!ability.isTextual() || !ALLOWED_ABILITIES.contains(ability.asText()) || !seen.add(ability.asText())) {
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

    private void validateCustomVariables(List<String> errors, JsonNode brain) {
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
        validateCustomReferences(errors, brain, "brain", types);
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
        for (String root : java.util.List.of("columns", "blocks", "clusters")) total += countBrainConditionSlots(brain.get(root), costs);
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
        Set<String> equipped = new HashSet<>();
        abilities.forEach(ability -> equipped.add(ability.asText("")));
        validateActionNodes(errors, brain, equipped, "brain");
    }

    private void validateActionNodes(List<String> errors, JsonNode node, Set<String> equipped, String path) {
        if (node == null) return;
        if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                validateActionNodes(errors, node.get(index), equipped, path + "[" + index + "]");
            }
            return;
        }
        if (!node.isObject()) return;
        JsonNode action = node.get("action");
        if (action != null && action.isTextual()) {
            String requiredAbility = abilityForAction(action.asText());
            if (requiredAbility != null && !equipped.contains(requiredAbility)) {
                errors.add(path + ".action requires equipped ability " + requiredAbility);
            }
        }
        JsonNode left = node.get("left");
        JsonNode selectedAbility = node.get("ability");
        if (left != null && left.isTextual() && left.asText().startsWith("my.selectedAbility")
                && selectedAbility != null && selectedAbility.isTextual() && !equipped.contains(selectedAbility.asText())) {
            errors.add(path + ".ability requires equipped ability " + selectedAbility.asText());
        }
        node.properties().forEach(entry -> {
            if (!"loadout".equals(entry.getKey())) {
                validateActionNodes(errors, entry.getValue(), equipped, path + "." + entry.getKey());
            }
        });
    }

    private String abilityForAction(String action) {
        if ("swing".equals(action)) return "swing";
        if ("block".equals(action)) return "block";
        if (DASH_ACTIONS.contains(action)) return "dash";
        if ("fire_gun".equals(action)) return "fire_gun";
        if ("throw_grenade".equals(action)) return "throw_grenade";
        if ("shoot_fireball".equals(action)) return "shoot_fireball";
        if ("stun".equals(action)) return "stun";
        if (action.startsWith("micro_dash")) return "micro_dash";
        if (action.startsWith("phase_strike")) return "phase_strike";
        for (String ability : ALLOWED_ABILITIES) if (ability.equals(action)) return ability;
        return null;
    }

    private void validateLogicColumns(List<String> errors, JsonNode columns, CombatRules loadoutSpec) {
        if (!columns.isArray()) {
            errors.add("brain.columns must be an array");
            return;
        }
        if (columns.size() > MAX_CLUSTERS) errors.add("brain.columns exceeds the column limit");
        int[] branchCount = { 0 };
        int[] conditionCount = { 0 };
        for (int columnIndex = 0; columnIndex < columns.size(); columnIndex++) {
            JsonNode column = columns.get(columnIndex);
            String path = "brain.columns[" + columnIndex + "]";
            if (column == null || !column.isObject()) {
                errors.add(path + " must be an object");
                continue;
            }
            JsonNode branches = column.get("branches");
            if (branches == null || !branches.isArray()) {
                errors.add(path + ".branches must be an array");
                continue;
            }
            validateTreeBranches(errors, branches, path + ".branches", loadoutSpec, branchCount, conditionCount);
        }
        if (branchCount[0] > MAX_LOGIC_BLOCKS) errors.add("brain tree actions exceed the action node limit");
        if (conditionCount[0] > MAX_TOTAL_CONDITIONS) errors.add("brain tree exceeds the total condition limit");
    }

    private void validateTreeBranches(List<String> errors, JsonNode branches, String path,
            CombatRules loadoutSpec, int[] branchCount, int[] conditionCount) {
        for (int index = 0; index < branches.size(); index++) {
            JsonNode branch = branches.get(index);
            String branchPath = path + "[" + index + "]";
            branchCount[0] += executableActionCount(branch);
            conditionCount[0] += conditionCount(branch);
            validateLogicBlock(errors, branch, branchPath, loadoutSpec);
            String expected = index == 0 ? "if" : null;
            String type = branch != null && branch.hasNonNull("branchType") ? branch.get("branchType").asText() : expected;
            if (index == 0 && !"if".equals(type)) errors.add(branchPath + ".branchType must be if for the first sibling");
            if (index > 0 && !"else_if".equals(type) && !"else".equals(type)) errors.add(branchPath + ".branchType must be else_if or else");
            if ("else".equals(type) && index != branches.size() - 1) errors.add(branchPath + " else branch must be last");
            JsonNode children = branch != null ? branch.get("children") : null;
            if (children != null) {
                if (!children.isArray()) errors.add(branchPath + ".children must be an array");
                else validateTreeBranches(errors, children, branchPath + ".children", loadoutSpec, branchCount, conditionCount);
            }
        }
    }

    private int conditionCount(JsonNode block) {
        JsonNode conditions = block != null ? block.get("conditions") : null;
        return conditions != null && conditions.isArray() ? conditions.size() : 0;
    }

    private void validateLogicBlock(List<String> errors, JsonNode block, String path, CombatRules loadoutSpec) {
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
                if (entry == null || !entry.isObject() || !entry.hasNonNull("action") || !entry.get("action").isTextual()) {
                    errors.add(actionPath + ".action must be a string");
                    continue;
                }
                String action = entry.get("action").asText();
                validateActionAllowed(errors, action, actionPath, loadoutSpec);
                validateTarget(errors, entry.get("actionTarget"), actionPath + ".actionTarget");
                if (entry.has("targetOffsetX")) validateSignedCoordinate(errors, entry.get("targetOffsetX"), actionPath + ".targetOffsetX", 1000);
                if (entry.has("targetOffsetY")) validateSignedCoordinate(errors, entry.get("targetOffsetY"), actionPath + ".targetOffsetY", 800);
                if ("orbital_strike".equals(action)) {
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
        } else if (!block.hasNonNull("action") || !block.get("action").isTextual()) {
            errors.add(path + ".action must be a string");
        } else {
            validateActionAllowed(errors, block.get("action").asText(), path, loadoutSpec);
        }
        JsonNode conditions = block.get("conditions");
        if (conditions == null || !conditions.isArray()) {
            errors.add(path + ".conditions must be an array");
        } else if (conditions.size() > MAX_CONDITIONS_PER_BLOCK) {
            errors.add(path + ".conditions exceeds the condition limit");
        } else {
            for (int index = 0; index < conditions.size(); index++) {
                validateConditionAllowed(errors, conditions.get(index), path + ".conditions[" + index + "]", loadoutSpec);
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
        if ("none".equals(action)) return "none";
        if ("variable".equals(action)) return "variable";
        if ("rotate_toward_enemy".equals(action)) return "rotation";
        if (MOVEMENT_ACTIONS.contains(action)) return "movement";
        return "ability";
    }

    private void validateActionAllowed(List<String> errors, String action, String path, CombatRules loadoutSpec) {
        Set<String> allowed = new HashSet<>(MOVEMENT_ACTIONS);
        allowed.add("variable");
        if (loadoutSpec.canSwing()) allowed.add("swing");
        if (loadoutSpec.canBlock()) allowed.add("block");
        if (loadoutSpec.canDash()) allowed.addAll(DASH_ACTIONS);
        if (loadoutSpec.canFireGun()) allowed.add("fire_gun");
        if (loadoutSpec.canThrowGrenade()) allowed.add("throw_grenade");
        if (loadoutSpec.canShootFireball()) allowed.add("shoot_fireball");
        if (loadoutSpec.canStun()) allowed.add("stun");
        // duel-v1 actions are loadout-owned. validateActionsAgainstLoadout()
        // separately rejects actions whose required ability is not equipped.
        if ("duel-v1".equals(loadoutSpec.id())) allowed.addAll(PROTOTYPE_ACTIONS);
        if (!allowed.contains(action)) {
            errors.add(path + ".action is not allowed for " + loadoutSpec.id());
        }
    }

    private void validateConditionAllowed(List<String> errors, JsonNode condition, String path, CombatRules loadoutSpec) {
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
            validateExpressionCondition(errors, condition, path, loadoutSpec);
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

    private void validateExpressionCondition(List<String> errors, JsonNode condition, String path, CombatRules loadoutSpec) {
        JsonNode leftNode = condition.get("left");
        if (leftNode == null || !leftNode.isTextual()) {
            errors.add(path + ".left must be a variable id");
            return;
        }
        String left = leftNode.asText();
        String valueType = left.startsWith("custom.")
                ? ("boolean".equals(condition.path("right").path("type").asText()) ? "boolean" : "number")
                : variableValueType(left);
        if (valueType == null) {
            errors.add(path + ".left is not an allowed variable");
            return;
        }
        if (left.contains(".selectedAbility")) {
            JsonNode ability = condition.get("ability");
            if (ability == null || !ability.isTextual() || !ALLOWED_ABILITIES.contains(ability.asText())) {
                errors.add(path + ".ability must identify an allowed equipped ability");
            } else if (left.endsWith("Preparing") || left.endsWith("PreparationMs")) {
                if (!PREPARING_ABILITIES.contains(ability.asText())) errors.add(path + ".ability does not have preparation time");
            }
        }

        JsonNode comparatorNode = condition.get("comparator");
        String comparator = comparatorNode != null && comparatorNode.isTextual() ? comparatorNode.asText() : "";
        boolean directionRange = Set.of("target.bearingFromMe", "target.movementDirection").contains(left);
        if ("number".equals(valueType) && !directionRange && !NUMERIC_COMPARATORS.contains(comparator)) {
            errors.add(path + ".comparator is not allowed for number variables");
        }
        if (directionRange && !"range".equals(comparator)) {
            errors.add(path + ".comparator must be range for directional variables");
        }
        if ("boolean".equals(valueType) && !BOOLEAN_COMPARATORS.contains(comparator)) {
            errors.add(path + ".comparator is not allowed for boolean variables");
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
                } else if (!Double.isFinite(rightValue.asDouble()) || rightValue.asDouble() < -CUSTOM_INTEGER_LIMIT || rightValue.asDouble() > CUSTOM_INTEGER_LIMIT) {
                    errors.add(path + ".right.value must be between -99999 and 99999");
                } else if (Set.of("match.elapsedSeconds", "target.age").contains(left) && rightValue.asDouble() < 0) {
                    errors.add(path + ".right.value cannot be negative for time variables");
                } else if ("target.age".equals(left) && Math.abs(rightValue.asDouble() * 10.0 - Math.rint(rightValue.asDouble() * 10.0)) > 1e-9) {
                    errors.add(path + ".right.value for target.age must use 0.1 second increments");
                } else if ("match.elapsedSeconds".equals(left) && Math.abs(rightValue.asDouble() * 10.0 - Math.rint(rightValue.asDouble() * 10.0)) > 1e-9) {
                    errors.add(path + ".right.value for elapsed time must use 0.1 second increments");
                }
            } else if ("variable".equals(rightType)) {
                if (rightValue == null || !rightValue.isTextual() || !"number".equals(variableValueType(rightValue.asText()))) {
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

    private String variableValueType(String variable) {
        if (NUMBER_VARIABLES.contains(variable)) return "number";
        if (BOOLEAN_VARIABLES.contains(variable)) return "boolean";
        return null;
    }

    private void validateRoundTestingLimits(List<String> errors, JsonNode metrics) {
        JsonNode testingSamples = metrics.get("testingSamples");
        if (testingSamples != null && testingSamples.isNumber()
                && testingSamples.asInt() != 0) {
            errors.add("testingMetrics.testingSamples must be 0 for deterministic bot brains");
        }

        JsonNode epochsCompleted = metrics.get("epochsCompleted");
        if (epochsCompleted != null && epochsCompleted.isNumber()
                && epochsCompleted.asInt() != 0) {
            errors.add("testingMetrics.epochsCompleted must be 0 for deterministic bot brains");
        }
    }

    private String computeModelHash(JsonNode model, List<String> errors) {
        try {
            return "sha256:" + sha256Hex(jsonMapper.writeValueAsString(model));
        } catch (Exception ex) {
            errors.add("modelHash could not be computed from submitted brain");
            return null;
        }
    }

    private JsonNode submittedBrain(BotSubmissionPayloadDTO payload) {
        return payload.getBrain() != null ? payload.getBrain() : payload.getModel();
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private void requireExact(List<String> errors, String value, String field, String expected) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        if (!expected.equals(value)) {
            errors.add(field + " must be " + expected);
        }
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
