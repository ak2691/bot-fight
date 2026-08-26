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
    public static final String SELECTABLE_MY = "my_bot";
    public static final String SELECTABLE_OPPONENT = "opponent";
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
    public static final String SELECTABLE_CAPABILITY_HEALTH = "health";

    public enum ActionHead { NONE, VARIABLE, MOVEMENT, ROTATION, ABILITY }
    public enum ValueType { NUMBER, BOOLEAN }
    public enum VariableScope { NONE, SELECTABLE }
    public enum VariableSelectableType {
        PAIR("Variable_Pair");

        private final String id;

        VariableSelectableType(String id) { this.id = id; }
        public String id() { return id; }
    }
    public enum SelectableIdentity {
        BOT("bot"),
        ABILITY_ENTITY("ability-entity"),
        POSITION("position"),
        HEALTH("health"),
        FACING("facing"),
        MOVEMENT("movement");

        private final String id;
        SelectableIdentity(String id) { this.id = id; }
        public String id() { return id; }
    }
    public enum SelectableDependency { ABILITY_LOADOUT, STATUS_EFFECT_LOADOUT }
    public enum VariableSource {
        MATCH_ELAPSED_SECONDS,
        SELECTABLE_DISTANCE,
        SELECTABLE_DAMAGE_TAKEN_LAST_TICK,
        SELECTABLE_HP_NET_CHANGE_LAST_TICK,
        SELECTABLE_X,
        SELECTABLE_Y,
        SELECTABLE_HP,
        SELECTABLE_ABSOLUTE_BEARING,
        SELECTABLE_MOVEMENT_DIRECTION,
        SELECTABLE_SPEED,
        SELECTABLE_RELATIVE_BEARING,
        SELECTABLE_RELATIVE_BEARING_CLOCKWISE,
        SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE,
        SELECTABLE_FACING,
        SELECTABLE_COUNT,
        SELECTABLE_AGE,
        SELECTABLE_EDGE_DISTANCE,
        SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE,
        SELECTABLE_EXISTS,
        SELECTABLE_ALIVE,
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

    public record SelectableContract(String id, EntityContracts.SelectableOwner owner,
                                 String entityType, String runtimeType, int abilityId,
                                 Set<SelectableIdentity> selectableIdentities) {
        public SelectableContract {
            selectableIdentities = selectableIdentities == null ? Set.of() : Set.copyOf(selectableIdentities);
        }
        public boolean hasIdentity(SelectableIdentity identity) { return selectableIdentities.contains(identity); }
        public boolean healthBearing() { return hasIdentity(SelectableIdentity.HEALTH); }
    }

    public record VariableContract(String id, ValueType valueType, boolean supportsSelectable,
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

        public SelectableDependency selectableDependency() {
            if (requiresAbility()) return SelectableDependency.ABILITY_LOADOUT;
            if (requiresStatusEffect()) return SelectableDependency.STATUS_EFFECT_LOADOUT;
            return null;
        }

        public Set<SelectableIdentity> selectableIdentities() {
            if (isPairVariable()) return Set.of();
            if (requiresAbility() || requiresStatusEffect()) return Set.of(SelectableIdentity.BOT);
            if (source == VariableSource.SELECTABLE_FACING) return Set.of(SelectableIdentity.FACING);
            if (source == VariableSource.SELECTABLE_COUNT || source == VariableSource.SELECTABLE_AGE
                    || source == VariableSource.SELECTABLE_EXISTS) return Set.of(SelectableIdentity.ABILITY_ENTITY);
            return Set.of();
        }

        public Set<SelectableIdentity> pairSelectableIdentities(int slot) {
            if (!isPairVariable()) return selectableIdentities();
            return slot == 0 && isBearingVariable()
                    ? Set.of(SelectableIdentity.FACING)
                    : Set.of();
        }

        public boolean allowsNegativeInteger() {
            return tags.contains(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER);
        }

        public boolean requiresHealthSelectable() {
            // Selectable HP/alive intentionally accept every selectable. Selectables
            // without a hittable health component resolve to zero/false.
            return false;
        }

        public boolean isPairVariable() {
            return source == VariableSource.SELECTABLE_DISTANCE
                    || source == VariableSource.SELECTABLE_ABSOLUTE_BEARING
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING_CLOCKWISE
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE;
        }

        /** The contract type for a single selectable, or PAIR for two selectable slots. */
        public VariableSelectableType selectableType() {
            return isPairVariable() ? VariableSelectableType.PAIR : null;
        }

        private boolean isBearingVariable() {
            return source == VariableSource.SELECTABLE_ABSOLUTE_BEARING
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING_CLOCKWISE
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE;
        }

        public boolean selectableOrderable() {
            return source != VariableSource.SELECTABLE_COUNT;
        }

        public boolean angle() {
            return source == VariableSource.SELECTABLE_ABSOLUTE_BEARING
                    || source == VariableSource.SELECTABLE_MOVEMENT_DIRECTION
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING_CLOCKWISE
                    || source == VariableSource.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE
                    || source == VariableSource.SELECTABLE_FACING;
        }

        public boolean circularAngle() {
            return angle() && source != VariableSource.SELECTABLE_RELATIVE_BEARING;
        }

        public boolean nonNegativeTime() {
            return source == VariableSource.MATCH_ELAPSED_SECONDS
                    || source == VariableSource.SELECTABLE_AGE;
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

    private static final Map<String, SelectableContract> SELECTABLES = selectables();
    private static final Map<String, VariableContract> VARIABLES = variables();
    private static final Set<String> STATUS_EFFECTS = buildStatusEffects();
    private static final Set<String> SELECTABLE_ORDERS = Set.of("closest", "farthest", "oldest", "newest");
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

    public static Map<String, SelectableContract> selectables() {
        Map<String, SelectableContract> selectables = new LinkedHashMap<>();
        selectables.put(SELECTABLE_MY, new SelectableContract(
                SELECTABLE_MY, EntityContracts.SelectableOwner.OWNER, null, null, 0,
                Set.of(SelectableIdentity.BOT, SelectableIdentity.POSITION, SelectableIdentity.HEALTH,
                        SelectableIdentity.FACING, SelectableIdentity.MOVEMENT)));
        selectables.put(SELECTABLE_OPPONENT, new SelectableContract(
                SELECTABLE_OPPONENT, EntityContracts.SelectableOwner.OWNER, null, null, 0,
                Set.of(SelectableIdentity.BOT, SelectableIdentity.POSITION, SelectableIdentity.HEALTH,
                        SelectableIdentity.FACING, SelectableIdentity.MOVEMENT)));
        for (EntityContract entity : EntityContracts.all().values()) {
            if (entity.selectableOwner() == EntityContracts.SelectableOwner.NONE) {
                selectables.put(entity.entityType(), selectable(entity, entity.entityType()));
                continue;
            }
            selectables.put("opponent_" + entity.entityType(), selectable(entity, "opponent_" + entity.entityType()));
            selectables.put("my_" + entity.entityType(), selectable(entity, "my_" + entity.entityType()));
        }
        return Collections.unmodifiableMap(selectables);
    }

    public static Map<String, SelectableContract> selectableContracts() { return SELECTABLES; }
    public static SelectableContract selectableContract(String id) { return SELECTABLES.get(id); }
    public static Set<String> selectableIds() { return SELECTABLES.keySet(); }

    public static boolean isAllowedSelectable(String selectableId) {
        if (selectableId == null) return false;
        if (SELECTABLES.containsKey(selectableId)) return true;
        String[] parts = selectableId.split(":", -1);
        if (parts.length != 3 || !SELECTABLES.containsKey(parts[0]) || isBotSelectable(parts[0])) return false;
        if (!SELECTABLE_ORDERS.contains(parts[1])) return false;
        try {
            int ordinal = Integer.parseInt(parts[2]);
            return ordinal >= 1 && ordinal <= 100;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    public static boolean selectableSupportsCapability(String selectableId, String capability) {
        if (SELECTABLE_CAPABILITY_HEALTH.equals(capability)) {
            String base = selectableId == null ? "" : selectableId.split(":", -1)[0];
            SelectableContract contract = SELECTABLES.get(base);
            return contract != null && contract.healthBearing();
        }
        return true;
    }

    public static boolean selectableMatchesIdentities(String selectableId, Set<SelectableIdentity> identities) {
        if (identities == null || identities.isEmpty()) return true;
        String base = selectableId == null ? "" : selectableId.split(":", -1)[0];
        SelectableContract contract = SELECTABLES.get(base);
        return contract != null && contract.selectableIdentities().containsAll(identities);
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
    public static boolean variableUsesSelectable(String variable) {
        VariableContract contract = variableContract(variable);
        return contract != null && contract.supportsSelectable();
    }

    public static String defaultSelectableForVariable(VariableContract variable) {
        if (variable != null && (variable.requiresAbility() || variable.requiresStatusEffect())) {
            return SELECTABLE_MY;
        }
        if (variable != null && variable.selectableIdentities().contains(SelectableIdentity.ABILITY_ENTITY)) {
            return SELECTABLES.keySet().stream()
                    .filter(selectableId -> selectableContract(selectableId) != null && selectableContract(selectableId).entityType() != null)
                    .findFirst()
                    .orElse(SELECTABLE_OPPONENT);
        }
        return SELECTABLE_OPPONENT;
    }

    public static String defaultSelectable1ForVariable(VariableContract variable) {
        return variable != null && variable.isPairVariable() ? SELECTABLE_MY : defaultSelectableForVariable(variable);
    }

    public static String defaultSelectable2ForVariable(VariableContract variable) {
        return variable != null && variable.isPairVariable() ? SELECTABLE_OPPONENT : defaultSelectableForVariable(variable);
    }

    public static boolean isBotSelectable(String selectableId) {
        return SELECTABLE_MY.equals(selectableId) || SELECTABLE_OPPONENT.equals(selectableId);
    }

    public static Set<String> statusEffects() { return STATUS_EFFECTS; }
    public static boolean isAllowedCustomVariableOperation(String operation) {
        return Set.of(
                CUSTOM_VARIABLE_OPERATION_SET,
                CUSTOM_VARIABLE_OPERATION_ADD,
                CUSTOM_VARIABLE_OPERATION_SUBTRACT,
                CUSTOM_VARIABLE_OPERATION_MODULO).contains(operation);
    }
    public static Set<String> selectableOrders() { return SELECTABLE_ORDERS; }
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

    private static SelectableContract selectable(EntityContract entity, String id) {
        Set<SelectableIdentity> identities = new LinkedHashSet<>();
        identities.add(SelectableIdentity.ABILITY_ENTITY);
        identities.add(SelectableIdentity.POSITION);
        if (entity.health() != null && entity.collider() != null && entity.collider().hittable()) {
            identities.add(SelectableIdentity.HEALTH);
        }
        if (entity.abilityId() == 17 || entity.abilityId() == 31) {
            identities.add(SelectableIdentity.FACING);
            identities.add(SelectableIdentity.MOVEMENT);
        }
        return new SelectableContract(id, entity.selectableOwner(), entity.entityType(), entity.runtimeType(), entity.abilityId(),
                identities);
    }

    private static Map<String, VariableContract> variables() {
        Map<String, VariableContract> variables = new LinkedHashMap<>();
        addNumbers(variables, VariableSource.MATCH_ELAPSED_SECONDS, VariableScope.NONE, "match.elapsedSeconds");
        addNumbers(variables, VariableSource.SELECTABLE_DISTANCE, VariableScope.SELECTABLE, "selectable.distance");
        addNumbers(variables, VariableSource.SELECTABLE_DAMAGE_TAKEN_LAST_TICK, VariableScope.SELECTABLE, "selectable.damageTakenLastTick");
        addNumbers(variables, VariableSource.SELECTABLE_HP_NET_CHANGE_LAST_TICK, VariableScope.SELECTABLE,
                Set.of(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER), "selectable.hpNetChangeLastTick");
        addNumbers(variables, VariableSource.SELECTABLE_X, VariableScope.SELECTABLE, "selectable.x");
        addNumbers(variables, VariableSource.SELECTABLE_Y, VariableScope.SELECTABLE, "selectable.y");
        addNumbers(variables, VariableSource.SELECTABLE_HP, VariableScope.SELECTABLE, "selectable.hp");
        addNumbers(variables, VariableSource.SELECTABLE_ABSOLUTE_BEARING, VariableScope.SELECTABLE, "selectable.absoluteBearing");
        addNumbers(variables, VariableSource.SELECTABLE_MOVEMENT_DIRECTION, VariableScope.SELECTABLE, "selectable.movementDirection");
        addNumbers(variables, VariableSource.SELECTABLE_SPEED, VariableScope.SELECTABLE, "selectable.speed");
        addNumbers(variables, VariableSource.SELECTABLE_RELATIVE_BEARING, VariableScope.SELECTABLE, "selectable.relativeBearing");
        addNumbers(variables, VariableSource.SELECTABLE_RELATIVE_BEARING_CLOCKWISE, VariableScope.SELECTABLE, "selectable.relativeBearingClockwise");
        addNumbers(variables, VariableSource.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE, VariableScope.SELECTABLE, "selectable.relativeBearingCounterclockwise");
        addNumbers(variables, VariableSource.SELECTABLE_FACING, VariableScope.SELECTABLE, "selectable.facing");
        addNumbers(variables, VariableSource.SELECTABLE_COUNT, VariableScope.SELECTABLE, "selectable.count");
        addNumbers(variables, VariableSource.SELECTABLE_AGE, VariableScope.SELECTABLE, "selectable.age");
        addNumbers(variables, VariableSource.SELECTABLE_EDGE_DISTANCE, VariableScope.SELECTABLE, "selectable.edgeDistance");
        addNumbers(variables, VariableSource.SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE, VariableScope.SELECTABLE,
                Set.of(VARIABLE_TAG_ALLOW_NEGATIVE_INTEGER), "selectable.closingZoneEdgeDistance");
        addBooleans(variables, VariableSource.SELECTABLE_EXISTS, VariableScope.SELECTABLE, "selectable.exists");
        addBooleans(variables, VariableSource.SELECTABLE_ALIVE, VariableScope.SELECTABLE, "selectable.alive");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_READY, VariableScope.SELECTABLE, "bot.selectedAbilityReady");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_ACTIVE, VariableScope.SELECTABLE, "bot.selectedAbilityActive");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_ON_COOLDOWN, VariableScope.SELECTABLE, "bot.selectedAbilityOnCooldown");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_ACTIVE_MS, VariableScope.SELECTABLE, "bot.selectedAbilityActiveMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_COOLDOWN_MS, VariableScope.SELECTABLE, "bot.selectedAbilityCooldownMs");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_CHARGES, VariableScope.SELECTABLE, "bot.selectedAbilityCharges");
        addBooleans(variables, VariableSource.SELECTED_ABILITY_PREPARING, VariableScope.SELECTABLE, "bot.selectedAbilityPreparing");
        addNumbers(variables, VariableSource.SELECTED_ABILITY_PREPARATION_MS, VariableScope.SELECTABLE, "bot.selectedAbilityPreparationMs");
        addBooleans(variables, VariableSource.SELECTED_STATUS_EFFECT_ACTIVE, VariableScope.SELECTABLE, "bot.selectedStatusEffectActive");
        addNumbers(variables, VariableSource.SELECTED_STATUS_EFFECT_DURATION_MS, VariableScope.SELECTABLE, "bot.selectedStatusEffectDurationMs");
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
                scope == VariableScope.SELECTABLE, scope, source, tags));
    }

    private static void addBooleans(Map<String, VariableContract> variables, VariableSource source,
                                    VariableScope scope, String... ids) {
        for (String id : ids) variables.put(id, new VariableContract(id, ValueType.BOOLEAN,
                scope == VariableScope.SELECTABLE, scope, source, Set.of()));
    }
}
