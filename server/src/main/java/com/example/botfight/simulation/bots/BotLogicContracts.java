package com.example.botfight.simulation.bots;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.contracts.EntityContracts.EntityContract;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * The server-side bot-code grammar.  Ability and entity behavior remains in
 * their own registries; this registry only describes how those contracts are
 * exposed to the submitted logic tree.
 */
public final class BotLogicContracts {
    public static final String ACTION_NONE = "none";
    public static final String ACTION_VARIABLE = "variable";
    public static final String ACTION_MOVE_WALK = "move_walk";
    public static final String ACTION_ROTATE_TOWARD_TARGET = "rotate_toward_enemy";

    public static final String CONDITION_ALWAYS = "always";
    public static final String CONDITION_EXPRESSION = "expression";
    public static final String TARGET_OPPONENT = "opponent";
    public static final String CUSTOM_VARIABLE_PREFIX = "custom.";
    public static final String CUSTOM_VARIABLE_OPERATION_SET = "set";
    public static final String CUSTOM_VARIABLE_OPERATION_ADD = "add";
    public static final String CUSTOM_VARIABLE_OPERATION_SUBTRACT = "subtract";
    public static final String CUSTOM_VARIABLE_OPERATION_MODULO = "modulo";
    public static final String JOIN_OR = "or";
    public static final double ANGLE_MIN = -360.0;
    public static final double ANGLE_MAX = 360.0;
    public static final int NUMBER_DECIMAL_PLACES = 1;
    public static final double CUSTOM_NUMBER_LIMIT = 99_999.0;
    public static final String VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER = "allow-negative-integer";
    public static final String TARGET_CAPABILITY_HEALTH = "health";

    public enum ActionHead { NONE, VARIABLE, MOVEMENT, ROTATION, ABILITY }
    public enum ValueType { NUMBER, BOOLEAN }
    public enum VariableScope { NONE, MY, OPPONENT, TARGET }
    public enum VariableSource {
        MATCH_ELAPSED_SECONDS,
        BOT_HP,
        BOT_DAMAGE_TAKEN_LAST_TICK,
        BOT_HP_NET_CHANGE_LAST_TICK,
        BOT_X,
        BOT_Y,
        TARGET_DISTANCE,
        TARGET_HP,
        TARGET_BEARING_FROM_ME,
        TARGET_MOVEMENT_DIRECTION,
        TARGET_SPEED,
        BEARING_FROM_TARGET,
        TARGET_RELATIVE_BEARING,
        TARGET_RELATIVE_BEARING_CLOCKWISE,
        TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE,
        TARGET_FACING,
        TARGET_COUNT,
        TARGET_AGE,
        BOT_EDGE_DISTANCE,
        TARGET_EDGE_DISTANCE,
        BOT_CLOSING_ZONE_EDGE_DISTANCE,
        TARGET_EXISTS,
        TARGET_ALIVE,
        SELECTED_ABILITY_READY,
        SELECTED_ABILITY_ACTIVE,
        SELECTED_ABILITY_ACTIVE_MS,
        SELECTED_ABILITY_ON_COOLDOWN,
        SELECTED_ABILITY_COOLDOWN_MS,
        SELECTED_ABILITY_CHARGES,
        SELECTED_ABILITY_PREPARING,
        SELECTED_ABILITY_PREPARATION_MS,
        SELECTED_STATUS_EFFECT_ACTIVE,
        SELECTED_STATUS_EFFECT_DURATION_MS
    }

    public record ActionContract(ActionHead head, boolean variableAction,
                                 boolean movementConfig, boolean coordinateTarget,
                                 boolean locationTarget, boolean orientationConfig,
                                 boolean angleTarget, String targetMode) {}

    public record TargetContract(String id, EntityContracts.TargetOwner owner,
                                 String entityType, String runtimeType, int abilityId,
                                 boolean healthBearing) {}

    public record VariableContract(String id, ValueType valueType, boolean supportsTarget,
                                   VariableScope scope, VariableSource source, Set<String> tags) {
        public VariableContract {
            tags = tags == null ? Set.of() : Set.copyOf(tags);
        }

        public boolean requiresAbility() {
            return source == VariableSource.SELECTED_ABILITY_READY
                    || source == VariableSource.SELECTED_ABILITY_ACTIVE
                    || source == VariableSource.SELECTED_ABILITY_ACTIVE_MS
                    || source == VariableSource.SELECTED_ABILITY_ON_COOLDOWN
                    || source == VariableSource.SELECTED_ABILITY_COOLDOWN_MS
                    || source == VariableSource.SELECTED_ABILITY_CHARGES
                    || source == VariableSource.SELECTED_ABILITY_PREPARING
                    || source == VariableSource.SELECTED_ABILITY_PREPARATION_MS;
        }

        public boolean requiresStatusEffect() {
            return source == VariableSource.SELECTED_STATUS_EFFECT_ACTIVE
                    || source == VariableSource.SELECTED_STATUS_EFFECT_DURATION_MS;
        }

        public boolean allowsNegativeInteger() {
            return tags.contains(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER);
        }

        public boolean requiresHealthTarget() {
            return source == VariableSource.TARGET_HP || source == VariableSource.TARGET_ALIVE;
        }

        public boolean botTargetOnly() {
            return source == VariableSource.TARGET_FACING;
        }

        public boolean objectTargetOnly() {
            return source == VariableSource.TARGET_COUNT
                    || source == VariableSource.TARGET_AGE
                    || source == VariableSource.TARGET_EXISTS;
        }

        public boolean targetOrderable() {
            return source != VariableSource.TARGET_COUNT;
        }

        public boolean angle() {
            return source == VariableSource.TARGET_BEARING_FROM_ME
                    || source == VariableSource.TARGET_MOVEMENT_DIRECTION
                    || source == VariableSource.BEARING_FROM_TARGET
                    || source == VariableSource.TARGET_RELATIVE_BEARING
                    || source == VariableSource.TARGET_RELATIVE_BEARING_CLOCKWISE
                    || source == VariableSource.TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE
                    || source == VariableSource.TARGET_FACING;
        }

        public boolean circularAngle() {
            return angle() && source != VariableSource.TARGET_RELATIVE_BEARING;
        }

        public boolean nonNegativeTime() {
            return source == VariableSource.MATCH_ELAPSED_SECONDS
                    || source == VariableSource.TARGET_AGE;
        }

        public boolean durationSeconds() {
            return source == VariableSource.SELECTED_STATUS_EFFECT_DURATION_MS;
        }

        public boolean tenthSecondStep() {
            return nonNegativeTime() || durationSeconds();
        }
    }

    private static final Map<String, ActionContract> COMMON_ACTIONS = Map.of(
            ACTION_NONE, new ActionContract(ActionHead.NONE, false, false, false, false, false, false, null),
            ACTION_VARIABLE, new ActionContract(ActionHead.VARIABLE, true, false, false, false, false, false, null),
            ACTION_MOVE_WALK, new ActionContract(ActionHead.MOVEMENT, false, true, true, false, false, false, null),
            ACTION_ROTATE_TOWARD_TARGET, new ActionContract(ActionHead.ROTATION, false, false, true, false, false, true, "target"));

    private static final Map<String, TargetContract> TARGETS = targets();
    private static final Map<String, VariableContract> VARIABLES = variables();
    private static final Set<String> STATUS_EFFECTS = buildStatusEffects();
    private static final Set<String> TARGET_ORDERS = Set.of("closest", "farthest", "oldest", "newest");
    private static final Set<String> MOVEMENT_MODES = Set.of("target", "coordinates", "absolute");
    private static final Set<String> ABSOLUTE_DIRECTIONS = Set.of(
            "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "stop");
    private static final Set<String> FACING_MODES = Set.of("face_target", "keep", "face_origin", "mirror");
    private static final Set<String> NUMERIC_COMPARATORS = Set.of("lt", "lte", "eq", "neq", "gte", "gt");
    private static final Set<String> BOOLEAN_COMPARATORS = Set.of("eq", "neq");

    private BotLogicContracts() {}

    /** Truncates user-facing numeric values toward zero to one decimal place. */
    public static double truncateToNumberPrecision(double value) {
        if (!Double.isFinite(value)) return 0.0;
        double scale = Math.pow(10.0, NUMBER_DECIMAL_PLACES);
        return (value >= 0.0 ? Math.floor(value * scale) : Math.ceil(value * scale)) / scale;
    }

    /** Modulo is the one numeric operation whose operands are integer-valued. */
    public static long truncateToInteger(double value) {
        if (!Double.isFinite(value)) return 0L;
        return value >= 0.0 ? (long) Math.floor(value) : (long) Math.ceil(value);
    }

    public static Map<String, TargetContract> targets() {
        Map<String, TargetContract> targets = new LinkedHashMap<>();
        targets.put(TARGET_OPPONENT, new TargetContract(
                TARGET_OPPONENT, EntityContracts.TargetOwner.OWNER, null, null, 0, true));
        for (EntityContract entity : EntityContracts.all().values()) {
            if (entity.targetOwner() == EntityContracts.TargetOwner.NONE) {
                targets.put(entity.entityType(), target(entity, entity.entityType()));
                continue;
            }
            targets.put("opponent_" + entity.entityType(), target(entity, "opponent_" + entity.entityType()));
            targets.put("my_" + entity.entityType(), target(entity, "my_" + entity.entityType()));
        }
        return Collections.unmodifiableMap(targets);
    }

    public static Map<String, TargetContract> targetContracts() { return TARGETS; }
    public static TargetContract targetContract(String id) { return TARGETS.get(id); }
    public static Set<String> targetIds() { return TARGETS.keySet(); }

    public static boolean isAllowedTarget(String target) {
        if (target == null) return false;
        if (TARGETS.containsKey(target)) return true;
        String[] parts = target.split(":", -1);
        if (parts.length != 3 || !TARGETS.containsKey(parts[0]) || TARGET_OPPONENT.equals(parts[0])) return false;
        if (!TARGET_ORDERS.contains(parts[1])) return false;
        try {
            int ordinal = Integer.parseInt(parts[2]);
            return ordinal >= 1 && ordinal <= 100;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    public static boolean targetSupportsCapability(String target, String capability) {
        if (TARGET_CAPABILITY_HEALTH.equals(capability)) {
            String base = target == null ? "" : target.split(":", -1)[0];
            TargetContract contract = TARGETS.get(base);
            return contract != null && contract.healthBearing();
        }
        return true;
    }

    public static ActionContract actionContract(Object action) {
        if (action instanceof String text) {
            ActionContract common = COMMON_ACTIONS.get(text);
            if (common != null) return common;
            return null;
        }
        if (!(action instanceof Integer abilityId) || !AbilityContracts.actions().contains(abilityId)) return null;
        AbilityContracts.Execution execution = AbilityContracts.get(abilityId).execution();
        EntityContract entity = EntityContracts.forAbility(abilityId);
        boolean locationTarget = entity != null && entity.spawn().mode() == EntityContracts.SpawnMode.TARGET;
        boolean movement = execution != null && execution.movement() != null;
        String targetMode = execution != null ? execution.targetMode() : null;
        if (targetMode == null && locationTarget) targetMode = "target";
        return new ActionContract(ActionHead.ABILITY, false, movement,
                movement || locationTarget, locationTarget,
                execution != null && execution.phaseFacingDefault() != null, false, targetMode);
    }

    public static boolean isAllowedAction(Object action) { return actionContract(action) != null; }
    public static boolean actionUsesTarget(Object action) {
        ActionContract contract = actionContract(action);
        return contract != null && (contract.targetMode() != null || contract.movementConfig()
                || contract.locationTarget() || contract.head() == ActionHead.ROTATION);
    }
    public static boolean actionUsesCoordinates(Object action, String mode) {
        ActionContract contract = actionContract(action);
        return contract != null && contract.coordinateTarget()
                && ("coordinates".equals(mode) || "absolute".equals(mode));
    }
    public static boolean actionUsesAbsoluteAngle(Object action, String mode) {
        ActionContract contract = actionContract(action);
        return contract != null && contract.angleTarget() && "angle".equals(mode);
    }
    public static boolean actionUsesFacing(Object action) {
        ActionContract contract = actionContract(action);
        return contract != null && contract.orientationConfig();
    }

    public static Map<String, VariableContract> variableContracts() { return VARIABLES; }
    public static VariableContract variableContract(String variable) {
        return VARIABLES.get(variable);
    }
    public static String variableValueType(String variable) {
        VariableContract contract = variableContract(variable);
        return contract == null ? null : contract.valueType() == ValueType.BOOLEAN ? "boolean" : "number";
    }
    public static boolean isKnownVariable(String variable) { return variableContract(variable) != null; }
    public static boolean variableUsesTarget(String variable) {
        VariableContract contract = variableContract(variable);
        return contract != null && contract.supportsTarget();
    }

    public static String defaultTargetForVariable(VariableContract variable) {
        if (variable != null && variable.objectTargetOnly()) {
            return TARGETS.keySet().stream()
                    .filter(target -> !TARGET_OPPONENT.equals(target))
                    .findFirst()
                    .orElse(TARGET_OPPONENT);
        }
        return TARGET_OPPONENT;
    }

    public static Set<String> statusEffects() { return STATUS_EFFECTS; }
    public static boolean isAllowedCustomVariableOperation(String operation) {
        return Set.of(
                CUSTOM_VARIABLE_OPERATION_SET,
                CUSTOM_VARIABLE_OPERATION_ADD,
                CUSTOM_VARIABLE_OPERATION_SUBTRACT,
                CUSTOM_VARIABLE_OPERATION_MODULO).contains(operation);
    }
    public static Set<String> targetOrders() { return TARGET_ORDERS; }
    public static Set<String> movementModes() { return MOVEMENT_MODES; }
    public static Set<String> absoluteDirections() { return ABSOLUTE_DIRECTIONS; }
    public static boolean isAbsoluteWalkDirection(String direction) {
        if (direction == null || direction.isBlank()) return false;
        try {
            double value = Double.parseDouble(direction);
            return Double.isFinite(value) && value >= ANGLE_MIN && value <= ANGLE_MAX;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    /** Returns the bounded compass angle used by the walk action's absolute mode. */
    public static double absoluteWalkDirection(String direction) {
        if (!isAbsoluteWalkDirection(direction)) return 0.0;
        double value = Double.parseDouble(direction);
        return truncateToNumberPrecision(Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, value)));
    }

    /** Walk uses compass degrees; ability movement keeps its existing named aliases. */
    public static boolean isAbsoluteDirection(Object action, String direction) {
        return ACTION_MOVE_WALK.equals(action)
                ? isAbsoluteWalkDirection(direction)
                : absoluteDirections().contains(direction);
    }

    public static boolean isRelativeDirection(String direction) {
        if (direction == null || direction.isBlank()) return false;
        try {
            double value = Double.parseDouble(direction);
            return Double.isFinite(value) && value >= ANGLE_MIN && value <= ANGLE_MAX;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    public static double relativeMovementAngle(String direction) {
        if (direction == null || direction.isBlank()) return 0.0;
        try {
            double value = Double.parseDouble(direction);
            if (Double.isFinite(value)) return truncateToNumberPrecision(Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, value)));
        } catch (NumberFormatException ignored) {
            // Invalid relative movement values fail closed to no rotation.
        }
        return 0.0;
    }
    public static Set<String> facingModes() { return FACING_MODES; }
    public static Set<String> numericComparators() { return NUMERIC_COMPARATORS; }
    public static Set<String> booleanComparators() { return BOOLEAN_COMPARATORS; }

    private static TargetContract target(EntityContract entity, String id) {
        return new TargetContract(id, entity.targetOwner(), entity.entityType(), entity.runtimeType(), entity.abilityId(), entity.health() != null);
    }

    private static Map<String, VariableContract> variables() {
        Map<String, VariableContract> variables = new LinkedHashMap<>();
        addNumbers(variables, VariableSource.MATCH_ELAPSED_SECONDS, VariableScope.NONE, "match.elapsedSeconds");
        addNumbers(variables, VariableSource.BOT_HP, VariableScope.MY, "my.hp");
        addNumbers(variables, VariableSource.BOT_DAMAGE_TAKEN_LAST_TICK, VariableScope.MY, "my.damageTakenLastTick");
        addNumbers(variables, VariableSource.BOT_HP_NET_CHANGE_LAST_TICK, VariableScope.MY,
                Set.of(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER), "my.hpNetChangeLastTick");
        addNumbers(variables, VariableSource.BOT_X, VariableScope.MY, "my.x");
        addNumbers(variables, VariableSource.BOT_Y, VariableScope.MY, "my.y");
        addNumbers(variables, VariableSource.BOT_HP, VariableScope.OPPONENT, "opponent.hp");
        addNumbers(variables, VariableSource.BOT_DAMAGE_TAKEN_LAST_TICK, VariableScope.OPPONENT, "opponent.damageTakenLastTick");
        addNumbers(variables, VariableSource.BOT_HP_NET_CHANGE_LAST_TICK, VariableScope.OPPONENT,
                Set.of(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER), "opponent.hpNetChangeLastTick");
        addNumbers(variables, VariableSource.BOT_X, VariableScope.OPPONENT, "opponent.x");
        addNumbers(variables, VariableSource.BOT_Y, VariableScope.OPPONENT, "opponent.y");
        addNumbers(variables, VariableSource.TARGET_DISTANCE, VariableScope.TARGET, "target.distance");
        addNumbers(variables, VariableSource.TARGET_HP, VariableScope.TARGET, "target.hp");
        addNumbers(variables, VariableSource.TARGET_BEARING_FROM_ME, VariableScope.TARGET, "target.bearingFromMe");
        addNumbers(variables, VariableSource.TARGET_MOVEMENT_DIRECTION, VariableScope.TARGET, "target.movementDirection");
        addNumbers(variables, VariableSource.TARGET_SPEED, VariableScope.TARGET, "target.speed");
        addNumbers(variables, VariableSource.BEARING_FROM_TARGET, VariableScope.TARGET, "my.bearingFromTarget");
        addNumbers(variables, VariableSource.TARGET_RELATIVE_BEARING, VariableScope.TARGET, "target.relativeBearing");
        addNumbers(variables, VariableSource.TARGET_RELATIVE_BEARING_CLOCKWISE, VariableScope.TARGET, "target.relativeBearingClockwise");
        addNumbers(variables, VariableSource.TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE, VariableScope.TARGET, "target.relativeBearingCounterclockwise");
        addNumbers(variables, VariableSource.TARGET_FACING, VariableScope.TARGET, "target.facing");
        addNumbers(variables, VariableSource.TARGET_COUNT, VariableScope.TARGET, "target.count");
        addNumbers(variables, VariableSource.TARGET_AGE, VariableScope.TARGET, "target.age");
        addNumbers(variables, VariableSource.BOT_EDGE_DISTANCE, VariableScope.MY, "my.edgeDistance");
        addNumbers(variables, VariableSource.BOT_CLOSING_ZONE_EDGE_DISTANCE, VariableScope.MY,
                Set.of(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER), "my.closingZoneEdgeDistance");
        addNumbers(variables, VariableSource.BOT_CLOSING_ZONE_EDGE_DISTANCE, VariableScope.OPPONENT,
                Set.of(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER), "opponent.closingZoneEdgeDistance");
        addNumbers(variables, VariableSource.TARGET_EDGE_DISTANCE, VariableScope.TARGET, "target.edgeDistance");
        addBooleans(variables, VariableSource.TARGET_EXISTS, VariableScope.TARGET, "target.exists");
        addBooleans(variables, VariableSource.TARGET_ALIVE, VariableScope.TARGET, "target.alive");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_READY, VariableScope.MY, "my.selectedAbilityReady");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_READY, VariableScope.OPPONENT, "opponent.selectedAbilityReady");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_ACTIVE, VariableScope.MY, "my.selectedAbilityActive");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_ACTIVE, VariableScope.OPPONENT, "opponent.selectedAbilityActive");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_ON_COOLDOWN, VariableScope.MY, "my.selectedAbilityOnCooldown");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_ON_COOLDOWN, VariableScope.OPPONENT, "opponent.selectedAbilityOnCooldown");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_ACTIVE_MS, VariableScope.MY, "my.selectedAbilityActiveMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_ACTIVE_MS, VariableScope.OPPONENT, "opponent.selectedAbilityActiveMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_COOLDOWN_MS, VariableScope.MY, "my.selectedAbilityCooldownMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_COOLDOWN_MS, VariableScope.OPPONENT, "opponent.selectedAbilityCooldownMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_CHARGES, VariableScope.MY, "my.selectedAbilityCharges");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_CHARGES, VariableScope.OPPONENT, "opponent.selectedAbilityCharges");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_PREPARING, VariableScope.MY, "my.selectedAbilityPreparing");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_PREPARING, VariableScope.OPPONENT, "opponent.selectedAbilityPreparing");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_PREPARATION_MS, VariableScope.MY, "my.selectedAbilityPreparationMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_PREPARATION_MS, VariableScope.OPPONENT, "opponent.selectedAbilityPreparationMs");
        addBooleans(variables, VariableSource.SELECTED_STATUS_EFFECT_ACTIVE, VariableScope.MY, "my.selectedStatusEffectActive");
        addBooleans(variables, VariableSource.SELECTED_STATUS_EFFECT_ACTIVE, VariableScope.OPPONENT, "opponent.selectedStatusEffectActive");
        addNumbers(variables, VariableSource.SELECTED_STATUS_EFFECT_DURATION_MS, VariableScope.MY, "my.selectedStatusEffectDurationMs");
        addNumbers(variables, VariableSource.SELECTED_STATUS_EFFECT_DURATION_MS, VariableScope.OPPONENT, "opponent.selectedStatusEffectDurationMs");
        return Collections.unmodifiableMap(variables);
    }

    private static Set<String> buildStatusEffects() {
        Set<String> effects = new LinkedHashSet<>();
        for (AbilityContracts.AbilityContract ability : AbilityContracts.all().values()) {
            for (AbilityContracts.Effect effect : ability.effects()) {
                if (isStatusEffect(effect)
                        && effect.subtype() != null) {
                    effects.add(effect.subtype());
                }
            }
        }
        return Collections.unmodifiableSet(effects);
    }

    private static boolean isStatusEffect(AbilityContracts.Effect effect) {
        return effect != null && (effect.type() == AbilityContracts.EffectType.DEBUFF
                || effect.type() == AbilityContracts.EffectType.BUFF);
    }

    private static void addNumbers(Map<String, VariableContract> variables, VariableSource source,
                                   VariableScope scope, String... ids) {
        addNumbers(variables, source, scope, Set.of(), ids);
    }

    private static void addNumbers(Map<String, VariableContract> variables, VariableSource source,
                                   VariableScope scope, Set<String> tags, String... ids) {
        for (String id : ids) variables.put(id, new VariableContract(id, ValueType.NUMBER,
                scope == VariableScope.TARGET, scope, source, tags));
    }

    private static void addBooleans(Map<String, VariableContract> variables, VariableSource source,
                                    VariableScope scope, String... ids) {
        for (String id : ids) variables.put(id, new VariableContract(id, ValueType.BOOLEAN,
                scope == VariableScope.TARGET, scope, source, Set.of()));
    }
}
