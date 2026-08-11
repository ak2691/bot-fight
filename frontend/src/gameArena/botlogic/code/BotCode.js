import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { abilityIdFromLegacyName } from "../../gameconfig/AbilityRegistry.js";
import { ACTION_TO_ABILITY, ALL_ABILITY_DEFINITIONS, STATUS_EFFECT_DEFINITIONS, entityTargetDefinitions } from "../../loadout/BotLoadout.js";
import { createDefaultAbilityStrategyConfiguration } from "./configurationFactories.js";
import { matchingStrategyTargets, resolveAbilityStrategyTarget } from "./targeting.js";
import { normalizeRoots } from "./rootOperations.js";
import { hasStrategyActions, selectStrategyActionPlan, selectStrategyBlock } from "./actionSelector.js";
import { validateConfiguration } from "./validation.js";
import { compareValues, directionFallsInRange, evaluateConditionNode, evaluateConditionNodes } from "./conditionEvaluator.js";
import { normalizeConfiguration } from "./normalization.js";
import { stateFromPayload } from "./runtimeState.js";
import { normalizedBlockEntries, selectPriorityCandidates as selectCandidates } from "./treeSelection.js";
import { normalizeRoot as normalizeCodeRoot } from "./rootNormalizer.js";
import { actionExecutableNow as canExecuteAction, actionSupportsTarget } from "./actionRuntime.js";
import { countConditionSlots, countVariableSlots } from "./configurationMetrics.js";
import { resolveStateVariable as resolveRuntimeVariable } from "./stateVariableResolver.js";
import {
    applyVariableAction as applyCustomVariableAction,
    customVariablesWithReferencedActions,
    normalizeCustomVariables as normalizeCustomVariableDefinitions,
    prepareCustomVariables as prepareCustomVariableState,
    resolveCustomVariable as resolveCustomVariableValue,
} from "./customVariables.js";
import {
    BOT_LOGIC_TREE_VERSION,
    MAX_LOGIC_BLOCKS,
    MAX_ROOT_NODES,
    MAX_TOTAL_CONDITIONS,
    MAX_CUSTOM_VARIABLE_SLOTS,
    MAX_VARIABLE_ACTION_TERMS,
    CUSTOM_INTEGER_MIN,
    CUSTOM_INTEGER_MAX,
    MAX_CONDITIONS_PER_BRANCH,
    MIN_PRIORITY,
    MAX_PRIORITY,
    STRATEGY_TIME_LIMIT_MS,
} from "./constants.js";

export { createCodeRoot, createDefaultAbilityStrategyConfiguration } from "./configurationFactories.js";
export { resolveAbilityStrategyTarget } from "./targeting.js";
export { actionSupportsTarget } from "./actionRuntime.js";
export { countConditionSlots, countVariableSlots } from "./configurationMetrics.js";
export { insertParentLogicBranch, moveLogicRootPriority, normalizeRoots, removeLogicBranch, setLogicBranchPriority, setLogicRootPriority } from "./rootOperations.js";
export * from "./constants.js";
export const CONDITION_TYPES = Object.freeze([
    { id: "always", label: "ALWAYS", group: "Basic", requiresValue: false },
]);
export const CONDITION_DEFINITIONS = CONDITION_TYPES;

export const ACTION_TYPES = Object.freeze([
    { id: "none", label: "N/A (Nested Conditions Only)", head: "none" },
    { id: "variable", label: "Variable: Modify Custom Variable", head: "variable", variableAction: true },
    { id: "move_walk", label: "Movement: Walk", head: "movement", movementConfig: true, coordinateTarget: true },
    { id: "rotate_toward_enemy", label: "Rotate: Face Target", head: "rotation" },
    ...ALL_ABILITY_DEFINITIONS.flatMap((ability) => ability.actions.map((id) => ({
        id,
        label: `Ability: ${ability.label}`,
        head: "ability",
        coordinateTarget: id === 22 || id === 24 || id === 19,
        locationTarget: id === 22 || id === 24,
        movementConfig: id === 19,
        orientationConfig: id === 25,
    }))),
]);

const CONDITION_BY_ID = new Map(CONDITION_DEFINITIONS.map((condition) => [condition.id, condition]));
const ACTION_BY_ID = new Map(ACTION_TYPES.map((action) => [action.id, action]));
const ENTITY_TARGET_DEFINITIONS = entityTargetDefinitions();
const BASE_ENTITY_TARGET_TYPES = [
    { id: "opponent", label: "Opponent 1" },
    { id: "orbital_zone", label: "Closest Orbital Strike Zone", abilityId: 22, owner: "my", legacy: true },
    ...ENTITY_TARGET_DEFINITIONS.map((ability) => ({
        id: `opponent_${ability.entityType}`,
        label: `Closest ${ability.entityLabel} by Opponent 1`,
        abilityId: ability.id,
        owner: "opponent",
        tags: ability.tags,
    })),
    ...ENTITY_TARGET_DEFINITIONS.map((ability) => ({
        id: `my_${ability.entityType}`,
        label: `Closest ${ability.entityLabel} by My Bot`,
        abilityId: ability.id,
        owner: "my",
        tags: ability.tags,
    })),
];
export const TARGET_TYPES = Object.freeze(BASE_ENTITY_TARGET_TYPES);
const TARGET_BY_ID = new Map(TARGET_TYPES.map((target) => [target.id, target]));
export const CONDITION_COMPARATORS = Object.freeze([
    { id: "lt", label: "<", valueTypes: ["number"] },
    { id: "lte", label: "<=", valueTypes: ["number"] },
    { id: "eq", label: "=", valueTypes: ["number", "boolean"] },
    { id: "neq", label: "!=", valueTypes: ["number", "boolean"] },
    { id: "gte", label: ">=", valueTypes: ["number"] },
    { id: "gt", label: ">", valueTypes: ["number"] },
    { id: "modulo", label: "MODULO", valueTypes: ["number"] },
]);
const MODULO_COMPARATOR_ID = "modulo";
const COMPARATOR_BY_ID = new Map(CONDITION_COMPARATORS.map((comparator) => [comparator.id, comparator]));
const GENERIC_ABILITY_STATE_VARIABLES = [
    variableDefinition("my.selectedAbilityReady", "My Ability Ready", "boolean", { group: "My Bot", supportsAbility: true, abilityOwner: "my" }),
    variableDefinition("my.selectedAbilityCooldownMs", "My Ability Cooldown", "number", { group: "My Bot", min: 0, max: 60, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "my" }),
    variableDefinition("my.selectedAbilityAmmo", "My Ability Ammo / Charges", "number", { group: "My Bot", min: 0, max: 100, supportsAbility: true, abilityOwner: "my" }),
    variableDefinition("my.selectedAbilityPreparing", "My Ability Preparing", "boolean", { group: "My Bot", supportsAbility: true, abilityOwner: "my", requiredTag: "wind-up" }),
    variableDefinition("my.selectedAbilityPreparationMs", "My Ability Preparation Time", "number", { group: "My Bot", min: 0, max: 10, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "my", requiredTag: "wind-up" }),
    variableDefinition("opponent.selectedAbilityReady", "Opponent 1 Ability Ready", "boolean", { group: "Opponent", supportsAbility: true, abilityOwner: "opponent" }),
    variableDefinition("opponent.selectedAbilityCooldownMs", "Opponent 1 Ability Cooldown", "number", { group: "Opponent", min: 0, max: 60, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "opponent" }),
    variableDefinition("opponent.selectedAbilityAmmo", "Opponent 1 Ability Ammo / Charges", "number", { group: "Opponent", min: 0, max: 100, supportsAbility: true, abilityOwner: "opponent" }),
    variableDefinition("opponent.selectedAbilityPreparing", "Opponent 1 Ability Preparing", "boolean", { group: "Opponent", supportsAbility: true, abilityOwner: "opponent", requiredTag: "wind-up" }),
    variableDefinition("opponent.selectedAbilityPreparationMs", "Opponent 1 Ability Preparation Time", "number", { group: "Opponent", min: 0, max: 10, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "opponent", requiredTag: "wind-up" }),
    variableDefinition("my.selectedStatusEffectActive", "My Status Effect", "boolean", { group: "My Bot", supportsStatusEffect: true, statusEffectOwner: "opponent" }),
    variableDefinition("my.selectedStatusEffectDurationMs", "My Status Effect Duration", "number", { group: "My Bot", min: 0, max: 60, suffix: "s", step: 0.1, supportsStatusEffect: true, statusEffectOwner: "opponent" }),
    variableDefinition("opponent.selectedStatusEffectActive", "Opponent 1 Status Effect", "boolean", { group: "Opponent", supportsStatusEffect: true, statusEffectOwner: "my" }),
    variableDefinition("opponent.selectedStatusEffectDurationMs", "Opponent 1 Status Effect Duration", "number", { group: "Opponent", min: 0, max: 60, suffix: "s", step: 0.1, supportsStatusEffect: true, statusEffectOwner: "my" }),
];

const ALL_STATE_VARIABLES = [
    variableDefinition("match.elapsedSeconds", "Time Since Start", "number", { group: "General", min: 0, max: 99_999, defaultValue: 0, suffix: "s", step: 0.1 }),
    variableDefinition("my.hp", "My HP", "number", { group: "My Bot", min: 0, max: 100 }),
    variableDefinition("my.damageTakenLastTick", "My Damage Taken Last Tick", "number", { group: "My Bot", min: 0, max: 300, suffix: "damage" }),
    variableDefinition("my.hpNetChangeLastTick", "My Net HP Change Last Tick", "number", { group: "My Bot", min: -300, max: 300, suffix: "HP" }),
    variableDefinition("my.x", "My X Position", "number", { group: "My Bot", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units" }),
    variableDefinition("my.y", "My Y Position", "number", { group: "My Bot", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units" }),
    variableDefinition("opponent.hp", "Opponent HP", "number", { group: "Opponent", min: 0, max: 100 }),
    variableDefinition("opponent.damageTakenLastTick", "Opponent Damage Taken Last Tick", "number", { group: "Opponent", min: 0, max: 300, suffix: "damage" }),
    variableDefinition("opponent.hpNetChangeLastTick", "Opponent Net HP Change Last Tick", "number", { group: "Opponent", min: -300, max: 300, suffix: "HP" }),
    variableDefinition("opponent.x", "Opponent X Position", "number", { group: "Opponent", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units" }),
    variableDefinition("opponent.y", "Opponent Y Position", "number", { group: "Opponent", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units" }),
    variableDefinition("target.distance", "Target Distance", "number", { group: "Target", min: 0, max: 700, supportsTarget: true }),
    variableDefinition("target.hp", "Target HP", "number", { group: "Target", min: 0, max: 300, supportsTarget: true }),
    variableDefinition("target.alive", "Target Alive", "boolean", { group: "Target", supportsTarget: true }),
    variableDefinition("target.bearingFromMe", "Target Direction From Me", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, rangeOnly: true, maxRange: 360, defaultMin: -30, defaultMax: 30 }),
    variableDefinition("target.movementDirection", "Target Movement Direction", "number", { group: "Movement", min: -360, max: 360, suffix: "deg", supportsTarget: true, rangeOnly: true, maxRange: 360, defaultMin: -30, defaultMax: 30 }),
    variableDefinition("target.velocity", "Target Velocity", "number", { group: "Movement", min: 0, max: 100, suffix: "units/tick", supportsTarget: true }),
    variableDefinition("my.bearingFromTarget", "My Direction From Target", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.relativeBearing", "Target Bearing Difference (Shortest)", "number", { group: "Rotation", min: 0, max: 180, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.relativeBearingClockwise", "Target Bearing Difference (Clockwise)", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.relativeBearingCounterclockwise", "Target Bearing Difference (Counterclockwise)", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.facing", "Target Facing", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true, botTargetOnly: true }),
    variableDefinition("target.count", "Target Type Count", "number", { group: "Objects", min: 0, max: 100, supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.age", "Target Age (seconds)", "number", { group: "Objects", suffix: "s", step: 0.1, min: 0, max: 120, supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("my.edgeDistance", "My Distance From Edge", "number", { group: "My Bot", min: 0, max: 300 }),
    variableDefinition("target.edgeDistance", "Target Distance From Edge", "number", { group: "Target", min: 0, max: 300, supportsTarget: true }),
    ...GENERIC_ABILITY_STATE_VARIABLES,
    variableDefinition("target.exists", "Target Exists", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
];
export const STATE_VARIABLES = Object.freeze(ALL_STATE_VARIABLES);
const STATE_VARIABLE_BY_ID = new Map(STATE_VARIABLES.map((variable) => [variable.id, variable]));

export function createLogicBlock(conditionType = "always", action = "move_walk") {
    const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
    return {
        id: `logic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conditions: [{
            type: definition.id,
            ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
            ...(definition.supportsTarget ? { target: definition.defaultTarget ?? "opponent" } : {}),
        }],
        priority: 1,
        action: ACTION_BY_ID.has(action) ? action : ACTION_TYPES[0].id,
        actionTarget: normalizeActionTarget("opponent", action),
    };
}

export function createExpressionCondition(left = "target.distance") {
    const suppliedDefinition = left && typeof left === "object" ? left : null;
    const variable = suppliedDefinition ?? STATE_VARIABLE_BY_ID.get(left) ?? STATE_VARIABLES[0];
    return normalizeExpressionCondition({
        type: "expression",
        left: variable.id,
        comparator: variable.rangeOnly ? "range" : variable.valueType === "boolean" ? "eq" : "lt",
        right: variable.rangeOnly
            ? { type: "range", min: variable.defaultMin, max: variable.defaultMax }
            : variable.valueType === "boolean"
            ? { type: "boolean", value: true }
            : { type: "number", value: variable.defaultValue },
        ...(variable.supportsAbility ? { ability: defaultAbilityForVariable(variable) } : {}),
        ...(variable.supportsStatusEffect ? { statusEffect: defaultStatusEffectForVariable() } : {}),
        ...(variable.supportsTarget ? { leftTarget: variable.defaultTarget ?? "opponent" } : {}),
    });
}

export function normalizeAbilityStrategyConfiguration(configuration) {
    return normalizeConfiguration(configuration, {
        normalizeCustomVariables: (source) => normalizeCustomVariableDefinitions(source, { normalizeConditions, normalizeBoolean, clamp }),
        customVariablesWithReferencedActions,
        normalizeRoot: (root, rootIndex, remaining, customVariables) => normalizeCodeRoot(root, rootIndex, remaining, customVariables, {
            normalizeBlock,
            normalizeConditions,
        }),
        normalizeBlock,
        normalizePriority,
        normalizeConditions,
        normalizeRoots,
        defaultConfiguration: createDefaultAbilityStrategyConfiguration,
    });
}

export function validateAbilityStrategyConfiguration(configuration) {
    return validateConfiguration(configuration, {
        normalizeConfiguration: normalizeAbilityStrategyConfiguration,
        countVariableSlots,
        countConditionSlots,
        normalizedBlockEntries,
        isTrainableBlock,
    });
}

export function selectAbilityStrategyBlock(configuration, payload) {
    return selectStrategyBlock(configuration, payload, selectionRuntime());
}

export function selectAbilityStrategyActionPlan(configuration, payload) {
    return selectStrategyActionPlan(configuration, payload, selectionRuntime());
}

export function hasAbilityStrategyActions(configuration) {
    return hasStrategyActions(configuration, normalizeAbilityStrategyConfiguration);
}

function selectionRuntime() {
    return {
        normalizeConfiguration: normalizeAbilityStrategyConfiguration,
        stateFromPayload,
        prepareCustomVariables: (state, definitions) => prepareCustomVariableState(state, definitions, { evaluateConditions: evaluateConditionList }),
        selectPriorityCandidates: (normalized, state) => selectCandidates(normalized, state, {
            evaluateConditions: evaluateConditionList,
            blockHasExecutableAction,
        }),
        normalizedBlockActions,
        isTrainableBlock,
        actionExecutableNow,
        applyVariableAction: (block, state, definitions) => applyCustomVariableAction(block, state, definitions, {
            normalizeTerms: normalizeVariableActionTerms,
            resolveVariable: resolveStateVariable,
            clamp,
        }),
        actionById: ACTION_BY_ID,
        actionTypes: ACTION_TYPES,
        actionSupportsTarget,
        resolveTarget: resolveAbilityStrategyTarget,
    };
}

export function evaluateCondition(condition, state) {
    return evaluateConditionNode(condition, state, evaluateExpressionCondition);
}

function isTrainableBlock(block) {
    return normalizedBlockActions(block).some((entry) => entry.action !== "none");
}

export function customVariableDefinitions(configuration) {
    return normalizeCustomVariableDefinitions(configuration?.customVariables, { normalizeConditions, normalizeBoolean, clamp }).map((variable) => variableDefinition(
        variable.id,
        variable.name,
        variable.valueType,
        { group: "Custom Variables", min: CUSTOM_INTEGER_MIN, max: CUSTOM_INTEGER_MAX, defaultValue: variable.initialValue },
    ));
}

function evaluateConditionList(conditions, state) {
    return evaluateConditionNodes(conditions, state, evaluateExpressionCondition);
}

function normalizeConditions(conditions, customVariables = []) {
    const source = Array.isArray(conditions) ? conditions : [{ type: CONDITION_TYPES[0].id }];
    return source.slice(0, MAX_CONDITIONS_PER_BRANCH).map((condition, index) => {
        if (condition?.type === "expression" || condition?.left) {
            return withConditionJoin(normalizeExpressionCondition(condition, customVariables), condition, index);
        }
        const definition = CONDITION_BY_ID.get(condition?.type);
        if (!definition) {
            return withConditionJoin(falseCondition(), condition, index);
        }
        return withConditionJoin({
            type: definition.id,
            ...(definition.requiresValue ? {
                value: clamp(Number(condition?.value) || definition.defaultValue, definition.min, definition.max),
            } : {}),
            ...(definition.supportsTarget ? {
                target: normalizeTarget(condition?.target, definition.defaultTarget ?? "opponent", definition.targetGroup),
            } : {}),
        }, condition, index);
    });
}

function withConditionJoin(normalized, source, index) {
    return index > 0 && source?.join === "or"
        ? { ...normalized, join: "or" }
        : normalized;
}

function normalizeExpressionCondition(condition, customVariables = []) {
    const customVariable = customVariables.find((variable) => variable?.id === condition?.left);
    const customLeft = String(condition?.left ?? "").startsWith("custom.")
        ? variableDefinition(String(condition.left), String(customVariable?.name ?? condition.left), customVariable?.valueType === "boolean" ? "boolean" : condition?.right?.type === "boolean" ? "boolean" : "number", { min: CUSTOM_INTEGER_MIN, max: CUSTOM_INTEGER_MAX })
        : null;
    const leftDefinition = STATE_VARIABLE_BY_ID.get(condition?.left) ?? customLeft;
    if (!leftDefinition) return falseCondition();
    if (condition?.comparator === MODULO_COMPARATOR_ID
        && (leftDefinition.valueType !== "number" || leftDefinition.rangeOnly)) return falseCondition();
    const comparator = leftDefinition.rangeOnly ? "range" : normalizeComparator(condition?.comparator, leftDefinition.valueType);
    const modulo = comparator === MODULO_COMPARATOR_ID
        ? normalizeModuloCondition(condition, leftDefinition, customVariables)
        : null;
    if (comparator === MODULO_COMPARATOR_ID && !modulo) return falseCondition();
    const right = comparator === MODULO_COMPARATOR_ID
        ? normalizeModuloRightOperand(condition?.right, customVariables)
        : normalizeRightOperand(condition?.right, leftDefinition, condition?.comparator);
    if (comparator === MODULO_COMPARATOR_ID && !right) return falseCondition();
    return {
        type: "expression",
        left: leftDefinition.id,
        comparator,
        right,
        ...(modulo ? { modulo } : {}),
        ...(leftDefinition.supportsAbility ? { ability: normalizeAbilityId(condition?.ability, leftDefinition) } : {}),
        ...(leftDefinition.supportsStatusEffect ? { statusEffect: normalizeStatusEffectId(condition?.statusEffect) } : {}),
        ...(leftDefinition.supportsTarget ? {
            leftTarget: normalizeTarget(
                condition?.leftTarget ?? condition?.target,
                leftDefinition.defaultTarget ?? "opponent",
                leftDefinition.targetGroup ?? null,
            ),
        } : {}),
        ...(right?.type === "variable" && STATE_VARIABLE_BY_ID.get(right.value)?.supportsTarget ? {
            rightTarget: normalizeTarget(
                condition?.rightTarget ?? condition?.target,
                STATE_VARIABLE_BY_ID.get(right.value).defaultTarget ?? "opponent",
                STATE_VARIABLE_BY_ID.get(right.value).targetGroup ?? null,
            ),
        } : {}),
    };
}

function normalizeComparator(comparator, valueType, allowModulo = true) {
    const definition = COMPARATOR_BY_ID.get(comparator);
    if (definition?.valueTypes.includes(valueType) && (allowModulo || definition.id !== MODULO_COMPARATOR_ID)) return definition.id;
    return valueType === "boolean" ? "eq" : "lt";
}

function normalizeModuloCondition(condition, leftDefinition, customVariables) {
    if (leftDefinition.valueType !== "number" || !condition?.modulo || typeof condition.modulo !== "object") return null;
    const divisor = condition.modulo.divisor;
    const nestedComparator = COMPARATOR_BY_ID.get(condition.modulo.comparator);
    const integerDivisor = typeof divisor === "number" && Number.isFinite(divisor) ? Math.floor(divisor) : Number.NaN;
    if (!Number.isFinite(integerDivisor)
        || integerDivisor < CUSTOM_INTEGER_MIN || integerDivisor > CUSTOM_INTEGER_MAX
        || !nestedComparator?.valueTypes.includes("number") || nestedComparator.id === MODULO_COMPARATOR_ID
        || !isValidModuloRightOperand(condition.right, customVariables)) return null;
    return {
        divisor: integerDivisor,
        comparator: nestedComparator.id,
    };
}

function isValidModuloRightOperand(right, customVariables) {
    if (!right || typeof right !== "object") return false;
    if (right.type === "number") {
        const integerValue = typeof right.value === "number" && Number.isFinite(right.value) ? Math.floor(right.value) : Number.NaN;
        return Number.isFinite(integerValue) && integerValue >= CUSTOM_INTEGER_MIN && integerValue <= CUSTOM_INTEGER_MAX;
    }
    if (right.type !== "variable" || typeof right.value !== "string") return false;
    const definition = STATE_VARIABLE_BY_ID.get(right.value)
        ?? customVariables.find((variable) => variable?.id === right.value);
    return definition?.valueType === "number";
}

function normalizeModuloRightOperand(right, customVariables) {
    if (!isValidModuloRightOperand(right, customVariables)) return null;
    if (right.type === "variable") return { type: "variable", value: right.value };
    return {
        type: "number",
        value: clamp(Math.floor(right.value), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX),
    };
}

function normalizeRightOperand(right, leftDefinition, legacyComparator) {
    if (leftDefinition.rangeOnly) {
        const legacyValue = clamp(Number(right?.value ?? 0), leftDefinition.min, leftDefinition.max);
        const legacyLower = ["gt", "gte", "eq"].includes(legacyComparator) ? legacyValue : leftDefinition.min;
        const legacyUpper = ["lt", "lte", "eq"].includes(legacyComparator) ? legacyValue : leftDefinition.max;
        const lower = clamp(Number(right?.type === "range" ? right.min : legacyLower), leftDefinition.min, leftDefinition.max);
        const requestedUpper = clamp(Number(right?.type === "range" ? right.max : legacyUpper), leftDefinition.min, leftDefinition.max);
        const maxRange = Number(leftDefinition.maxRange ?? 360);
        const upper = Math.abs(requestedUpper - lower) <= maxRange
            ? requestedUpper
            : clamp(lower + Math.sign(requestedUpper - lower) * maxRange, leftDefinition.min, leftDefinition.max);
        return { type: "range", min: lower, max: upper };
    }
    if (leftDefinition.valueType === "boolean") {
        return { type: "boolean", value: normalizeBoolean(right?.value, true) };
    }
    if (right?.type === "variable") {
        const rightDefinition = STATE_VARIABLE_BY_ID.get(right.value);
        if (rightDefinition?.valueType === "number" || String(right.value ?? "").startsWith("custom.")) {
            return { type: "variable", value: rightDefinition?.id ?? String(right.value) };
        }
    }
    const value = clamp(Number(right?.value ?? leftDefinition.defaultValue), leftDefinition.min, leftDefinition.max);
    const step = Number(leftDefinition.step ?? 0);
    return {
        type: "number",
        value: step > 0 ? Number((Math.round(value / step) * step).toFixed(10)) : value,
    };
}

function falseCondition() {
    return {
        type: "expression",
        left: "match.elapsedSeconds",
        comparator: "lt",
        right: { type: "number", value: 0 },
    };
}

function normalizeBlock(block, blockIndex, customVariables = []) {
    const actions = normalizedBlockActions(block);
    const primaryAction = actions[0] ?? { action: "none", actionTarget: "opponent" };
    return {
        id: String(block?.id || `logic-${blockIndex + 1}`),
        conditions: normalizeConditions(block?.conditions, customVariables),
        priority: normalizePriority(block?.priority),
        action: primaryAction.action,
        actionTarget: primaryAction.actionTarget,
        actions,
    };
}

function normalizedBlockActions(block) {
    const source = Array.isArray(block?.actions) && block.actions.length
        ? block.actions
        : [{ action: block?.action ?? "none", actionTarget: block?.actionTarget, targetOffsetX: block?.targetOffsetX, targetOffsetY: block?.targetOffsetY }];
    const seenHeads = new Set();
    const normalized = [];
    for (const entry of source) {
        const normalizedActionId = typeof entry?.action === "string"
            ? abilityIdFromLegacyName(entry.action) ?? entry.action
            : entry?.action;
        const action = ACTION_BY_ID.get(normalizedActionId) ?? ACTION_TYPES[0];
        const head = actionExecutionHead(action);
        const headKey = head === "variable" ? `${head}:${String(entry?.variableId ?? normalized.length)}` : head;
        if (seenHeads.has(headKey)) continue;
        seenHeads.add(headKey);
        normalized.push({
            action: action.id,
            actionTarget: normalizeActionTarget(entry?.actionTarget, action.id),
            ...(action.movementConfig ? {
                movementMode: ["target", "coordinates", "absolute"].includes(entry?.movementMode) ? entry.movementMode : "target",
                movementDirection: String(entry?.movementDirection ?? "toward"),
            } : {}),
            ...(action.orientationConfig ? { phaseFacingMode: ["face_target", "keep", "face_origin", "mirror"].includes(entry?.phaseFacingMode) ? entry.phaseFacingMode : "face_target" } : {}),
            ...(actionSupportsTarget(action) ? {
                targetOffsetX: clamp(Number(entry?.targetOffsetX ?? 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                targetOffsetY: clamp(Number(entry?.targetOffsetY ?? 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
            } : {}),
            ...(action.coordinateTarget ? {
                targetMode: action.movementConfig ? (entry?.movementMode === "coordinates" ? "coordinates" : "target") : entry?.targetMode === "coordinates"
                    || (entry?.targetMode == null && (entry?.targetX != null || entry?.targetY != null))
                    ? "coordinates"
                    : "target",
                targetX: clamp(Number(entry?.targetX ?? ARENA_WIDTH_UNITS / 2), 0, ARENA_WIDTH_UNITS),
                targetY: clamp(Number(entry?.targetY ?? ARENA_HEIGHT_UNITS / 2), 0, ARENA_HEIGHT_UNITS),
            } : {}),
            ...(action.variableAction ? {
                variableId: String(entry?.variableId ?? ""),
                operation: ["set", "add", "subtract"].includes(entry?.operation) ? entry.operation : "set",
                value: entry?.value === true || entry?.value === false
                    ? entry.value
                    : clamp(Math.trunc(Number(entry?.value) || 0), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX),
                ...(!(entry?.value === true || entry?.value === false) ? {
                    terms: normalizeVariableActionTerms(entry),
                } : {}),
            } : {}),
        });
    }
    const executable = normalized.filter((entry) => entry.action !== "none");
    return executable.length ? executable : [{ action: "none", actionTarget: "opponent" }];
}

export function actionExecutionHead(action) {
    if (action?.head === "variable") return "variable";
    if (action?.head === "movement") return "movement";
    if (action?.head === "rotation") return "rotation";
    if (action?.head === "none") return "none";
    return "ability";
}

function normalizePriority(value) {
    return clamp(Math.round(Number.isFinite(Number(value)) ? Number(value) : 1), MIN_PRIORITY, MAX_PRIORITY);
}

function normalizeActionTarget(target, actionId) {
    const action = ACTION_BY_ID.get(actionId) ?? ACTION_TYPES[0];
    if (!actionSupportsTarget(action)) return "opponent";
    return normalizeTarget(target, "opponent");
}

function blockHasExecutableAction(block, state) {
    return normalizedBlockActions(block).some((entry) => actionExecutableNow({ ...block, ...entry }, state));
}

function normalizeVariableActionTerms(entry) {
    const legacy = [{
        operator: entry.operation ?? "set",
        operand: { type: "number", value: entry.value ?? 0 },
    }];
    const source = Array.isArray(entry.terms) && entry.terms.length ? entry.terms : legacy;
    return source.slice(0, MAX_VARIABLE_ACTION_TERMS).map((term, index) => {
        const operand = term?.operand ?? term ?? {};
        const variable = operand.type === "variable" && STATE_VARIABLE_BY_ID.get(String(operand.value))?.valueType === "number"
            ? String(operand.value)
            : operand.type === "variable" && String(operand.value).startsWith("custom.")
                ? String(operand.value)
                : null;
        return {
            operator: index === 0 && term?.operator === "set"
                ? "set"
                : term?.operator === "subtract" ? "subtract" : "add",
            operand: variable
                ? { type: "variable", value: variable, ...(operand.target ? { target: String(operand.target) } : {}) }
                : { type: "number", value: clamp(Math.trunc(Number(operand.value) || 0), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX) },
        };
    });
}

function actionExecutableNow(block, state) {
    return canExecuteAction(block, state, {
        actionById: ACTION_BY_ID,
        actionTypes: ACTION_TYPES,
        actionToAbility: ACTION_TO_ABILITY,
        resolveTarget: resolveAbilityStrategyTarget,
    });
}

function normalizeTarget(target, fallback, targetGroup = null) {
    const [base, order, ordinal] = String(target ?? "").split(":");
    const ordered = TARGET_BY_ID.has(base)
        && base !== "opponent"
        && ["closest", "farthest", "oldest", "newest"].includes(order)
        && Number.isInteger(Number(ordinal)) && Number(ordinal) >= 1 && Number(ordinal) <= 100;
    if (!TARGET_BY_ID.has(target) && !ordered) return fallback;
    if (targetGroup === "objects" && !isObjectTarget(target)) return fallback;
    return target;
}

function isObjectTarget(target) {
    const base = String(target).split(":")[0];
    return base !== "opponent" && TARGET_BY_ID.has(base);
}

function evaluateExpressionCondition(condition, state) {
    const customDefinition = state.customVariableDefinitions?.find((candidate) => candidate.id === condition.left);
    const leftDefinition = STATE_VARIABLE_BY_ID.get(condition.left) ?? (customDefinition ? variableDefinition(customDefinition.id, customDefinition.name, customDefinition.valueType, { min: CUSTOM_INTEGER_MIN, max: CUSTOM_INTEGER_MAX }) : null);
    if (!leftDefinition) return false;
    const left = resolveStateVariable(state, condition, leftDefinition.id, condition.leftTarget ?? condition.target);
    if (leftDefinition.rangeOnly) {
        return condition.right?.type === "range"
            && directionFallsInRange(left, Number(condition.right.min), Number(condition.right.max));
    }
    const right = condition.right?.type === "variable"
        ? resolveStateVariable(state, condition, condition.right.value, condition.rightTarget ?? condition.target)
        : condition.right?.value;
    if (condition.comparator === MODULO_COMPARATOR_ID) {
        const divisor = condition.modulo?.divisor;
        const integerDivisor = typeof divisor === "number" && Number.isFinite(divisor) ? Math.floor(divisor) : Number.NaN;
        const integerLeft = typeof left === "number" && Number.isFinite(left) ? Math.floor(left) : Number.NaN;
        const integerRight = typeof right === "number" && Number.isFinite(right) ? Math.floor(right) : Number.NaN;
        if (leftDefinition.valueType !== "number"
            || !Number.isFinite(integerDivisor)
            || integerDivisor === 0
            || !condition.modulo?.comparator
            || !Number.isFinite(integerLeft)
            || !Number.isFinite(integerRight)) return false;
        // JavaScript remainder follows the dividend's sign, matching Java's %.
        return compareValues(integerLeft % integerDivisor, condition.modulo.comparator, integerRight, "number");
    }
    return compareValues(left, condition.comparator, right, leftDefinition.valueType);
}

function resolveStateVariable(state, condition, variableId, targetId = condition.target) {
    return resolveRuntimeVariable(state, condition, variableId, targetId, {
        resolveCustom: (runtimeState, id) => resolveCustomVariableValue(runtimeState, id, { evaluateConditions: evaluateConditionList }),
        resolveTarget: resolveAbilityStrategyTarget,
        matchingTargets: matchingStrategyTargets,
    });
}

function variableDefinition(id, label, valueType, options = {}) {
    return {
        id,
        label: numberedOpponentLabel(label),
        valueType,
        defaultValue: valueType === "boolean" ? true : 50,
        min: valueType === "number" ? 0 : undefined,
        max: valueType === "number" ? 100 : undefined,
        ...options,
    };
}

function defaultAbilityForVariable(variable) {
    return ALL_ABILITY_DEFINITIONS.find((ability) => !variable.requiredTag || ability.tags.includes(variable.requiredTag))?.id ?? ALL_ABILITY_DEFINITIONS[0]?.id ?? 1;
}

function defaultStatusEffectForVariable() {
    return STATUS_EFFECT_DEFINITIONS[0]?.id ?? "burn";
}

function normalizeAbilityId(value, variable) {
    const normalizedId = typeof value === "string" ? abilityIdFromLegacyName(value) : value;
    const candidate = ALL_ABILITY_DEFINITIONS.find((ability) => ability.id === normalizedId && (!variable.requiredTag || ability.tags.includes(variable.requiredTag)));
    return candidate?.id ?? defaultAbilityForVariable(variable);
}

function normalizeStatusEffectId(value) {
    return STATUS_EFFECT_DEFINITIONS.some((statusEffect) => statusEffect.id === value)
        ? value
        : defaultStatusEffectForVariable();
}

function normalizeBoolean(value, fallback) {
    if (value === true || value === false) return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return fallback;
}

function numberedOpponentLabel(label) { return String(label).replace(/^Opponent(?: 1)?\b/, "Opponent 1"); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
