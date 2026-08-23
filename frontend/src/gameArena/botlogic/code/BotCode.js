import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { abilityIdFromBoundary } from "../../gameconfig/AbilityCompatibility.js";
import { abilityIdFromLegacyName, abilityIdentity } from "../../gameconfig/AbilityRegistry.js";
import { ACTION_TO_ABILITY, ALL_ABILITY_DEFINITIONS, STATUS_EFFECT_DEFINITIONS } from "../../loadout/BotLoadout.js";
import { createDefaultAbilityStrategyConfiguration } from "./configuration/configurationFactories.js";
import { matchingStrategyTargets, resolveAbilityStrategyTarget } from "./runtime/targeting.js";
import { normalizeRoots } from "./configuration/rootOperations.js";
import { hasStrategyActions, selectStrategyActionPlan, selectStrategyBlock } from "./runtime/actionSelector.js";
import { validateConfiguration } from "./configuration/validation.js";
import { compareAngleValues, compareValues, evaluateConditionNode, evaluateConditionNodes } from "./runtime/conditionEvaluator.js";
import { normalizeConfiguration } from "./configuration/normalization.js";
import { stateFromPayload } from "./runtime/runtimeState.js";
import { normalizedBlockEntries, selectPriorityCandidates as selectCandidates } from "./runtime/treeSelection.js";
import { normalizeRoot as normalizeCodeRoot } from "./configuration/rootNormalizer.js";
import { actionExecutableNow as canExecuteAction, actionSupportsTarget } from "./runtime/actionRuntime.js";
import { countConditionSlots, countVariableSlots } from "./configuration/configurationMetrics.js";
import { resolveStateVariable as resolveRuntimeVariable } from "./runtime/stateVariableResolver.js";
import {
    applyVariableAction as applyCustomVariableAction,
    customVariablesWithReferencedActions,
    normalizeCustomVariables as normalizeCustomVariableDefinitions,
    prepareCustomVariables as prepareCustomVariableState,
    resolveCustomVariable as resolveCustomVariableValue,
} from "./runtime/customVariables.js";
import {
    BOT_LOGIC_TREE_VERSION,
    MAX_LOGIC_BLOCKS,
    MAX_ROOT_NODES,
    MAX_TOTAL_CONDITIONS,
    MAX_CUSTOM_VARIABLE_SLOTS,
    MAX_VARIABLE_ACTION_TERMS,
    CUSTOM_NUMBER_MIN,
    CUSTOM_NUMBER_MAX,
    NUMBER_STEP,
    truncateToNumberPrecision,
    MAX_CONDITIONS_PER_BRANCH,
    MIN_PRIORITY,
    MAX_PRIORITY,
    STRATEGY_TIME_LIMIT_MS,
} from "./configuration/constants.js";
import {
    ACTION_BY_ID,
    BOT_CODE_ACTIONS,
    ACTION_TYPES,
    ACTION_HEADS,
    ABILITY_TAGS,
    BOT_CODE_COMPARATORS,
    BOT_CODE_CONDITIONS,
    BOT_CODE_TARGETS,
    CONDITION_JOINS,
    CUSTOM_VARIABLE_CONTRACT,
    CUSTOM_VARIABLE_OPERATIONS,
    COMPARATOR_BY_ID,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    STATE_VARIABLES,
    STATE_VARIABLE_BY_ID,
    STATE_VARIABLE_SCOPES,
    TARGET_CAPABILITIES,
    TARGET_BY_ID,
    TARGET_ORDERS,
    TARGET_TYPES,
    ABSOLUTE_MOVEMENT_DIRECTIONS,
    MOVEMENT_DIRECTION_MAX,
    MOVEMENT_DIRECTION_MIN,
    abilityDefinitionsForVariable,
    defaultAbilityForVariable,
    defaultStatusEffectForVariable,
    variableDefinition,
} from "./contracts/BotLogicContracts.js";

export { createCodeRoot, createDefaultAbilityStrategyConfiguration } from "./configuration/configurationFactories.js";
export { resolveAbilityStrategyTarget } from "./runtime/targeting.js";
export { actionSupportsTarget } from "./runtime/actionRuntime.js";
export { actionEntryCost, countActionSlots, countConditionSlots, countVariableSlots } from "./configuration/configurationMetrics.js";
export { insertParentLogicBranch, moveLogicRootPriority, normalizeRoots, removeLogicBranch, setLogicBranchPriority, setLogicRootPriority } from "./configuration/rootOperations.js";
export * from "./configuration/constants.js";
export {
    ACTION_TYPES,
    ABILITY_TAGS,
    BOT_CODE_ACTIONS,
    CONDITION_COMPARATORS,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    CUSTOM_VARIABLE_OPERATIONS,
    STATE_VARIABLES,
    TARGET_CAPABILITIES,
    VARIABLE_TAGS,
    abilityDefinitionsForVariable,
    TARGET_TYPES,
    TARGET_ORDERS,
} from "./contracts/BotLogicContracts.js";
const CONDITION_BY_ID = new Map(CONDITION_DEFINITIONS.map((condition) => [condition.id, condition]));
const OPPONENT_TARGET_ID = BOT_CODE_TARGETS.OPPONENT;
const MAX_ENUMERATED_ANGLE_GROUPS = 8;

export function createLogicBlock(conditionType = BOT_CODE_CONDITIONS.ALWAYS, action = BOT_CODE_ACTIONS.MOVE_WALK) {
    const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
    return {
        conditions: [{
            type: definition.id,
            ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
            ...(definition.supportsTarget ? { target: definition.defaultTarget ?? OPPONENT_TARGET_ID } : {}),
        }],
        priority: 1,
        action: ACTION_BY_ID.has(action) ? action : ACTION_TYPES[0].id,
        actionTarget: normalizeActionTarget(OPPONENT_TARGET_ID, action),
    };
}

export function createExpressionCondition(left = "target.distance", targetTypes = TARGET_TYPES) {
    const suppliedDefinition = left && typeof left === "object" ? left : null;
    const variable = suppliedDefinition ?? STATE_VARIABLE_BY_ID.get(left) ?? STATE_VARIABLES[0];
    const defaultStatusEffect = variable.supportsStatusEffect
        ? defaultStatusEffectForVariable(variable)
        : null;
    return normalizeExpressionCondition({
        type: BOT_CODE_CONDITIONS.EXPRESSION,
        left: variable.id,
        comparator: variable.valueType === "boolean" ? "eq" : "lt",
        right: variable.valueType === "boolean"
            ? { type: "boolean", value: true }
            : { type: "number", value: variable.defaultValue },
        ...(variable.supportsAbility ? { ability: defaultAbilityForVariable(variable) } : {}),
        ...(defaultStatusEffect ? { statusEffect: defaultStatusEffect } : {}),
        ...(variable.supportsTarget ? { leftTarget: defaultTargetForVariable(variable, targetTypes) } : {}),
    }, [], targetTypes);
}

/** Keeps editor-provided ability/status choices canonical and visible. */
export function normalizeConditionSelections(condition, variable, rightVariable = null) {
    if (!condition || condition.type !== BOT_CODE_CONDITIONS.EXPRESSION) return condition;
    let normalized = condition;
    const abilityVariable = variable?.supportsAbility ? variable : rightVariable?.supportsAbility ? rightVariable : null;
    const statusVariable = variable?.supportsStatusEffect ? variable : rightVariable?.supportsStatusEffect ? rightVariable : null;
    if (abilityVariable?.abilityOptions?.length) {
        const selected = abilityIdFromBoundary(condition.ability);
        const option = abilityVariable.abilityOptions.find((candidate) => candidate.id === selected);
        const ability = option?.id ?? abilityVariable.abilityOptions[0].id;
        if (condition.ability !== ability) normalized = { ...normalized, ability };
    }
    if (statusVariable?.statusEffectOptions?.length) {
        const selected = String(condition.statusEffect ?? "").trim().toLowerCase();
        const option = statusVariable.statusEffectOptions.find((candidate) => candidate.id === selected
            || candidate.label.toLowerCase() === selected);
        const statusEffect = option?.id ?? statusVariable.statusEffectOptions[0].id;
        if (normalized.statusEffect !== statusEffect) normalized = { ...normalized, statusEffect };
    }
    return normalized;
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

export function inspectAbilityStrategyConditions(configuration, payload) {
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    const state = stateFromPayload(payload);
    prepareCustomVariableState(state, normalized.customVariables, { evaluateConditions: evaluateConditionList });
    const inspections = [];
    const visitBranches = (branches, rootName, path = []) => {
        (branches ?? []).forEach((branch, branchIndex) => {
            const branchPath = [...path, branchIndex + 1];
            (branch.conditions ?? []).forEach((condition, conditionIndex) => {
                const definition = conditionLeftDefinition(condition, state);
                const targetId = condition.leftTarget ?? condition.target;
                const resolvedTarget = targetId ? resolveAbilityStrategyTarget(state, targetId) : null;
                const value = definition
                    ? resolveStateVariable(state, condition, definition.id, targetId)
                    : null;
                const rightValue = condition.right?.type === "variable"
                    ? resolveStateVariable(state, condition, condition.right.value, condition.rightTarget ?? condition.target)
                    : condition.right?.value;
                const selectedStatusEffect = definition?.supportsStatusEffect
                    ? condition.statusEffect ?? null
                    : null;
                inspections.push({
                    condition: condition.type === BOT_CODE_CONDITIONS.ALWAYS
                        ? `${rootName} / Branch ${branchPath.join(".")} / Always`
                        : `${rootName} / Branch ${branchPath.join(".")} / ${definition?.label ?? condition.left}`,
                    variable: definition?.label ?? condition.left ?? "Always",
                    ...(definition?.supportsAbility ? {
                        ability: abilityInspection(condition.ability),
                    } : {}),
                    target: targetId ? formatInspectionTargetLabel(targetId, definition) : null,
                    targetSelector: targetId ?? null,
                    resolvedTarget: targetEntityInspection(resolvedTarget),
                    ...(selectedStatusEffect ? {
                        statusEffect: selectedStatusEffect,
                        statusEffectState: statusEffectInspection(state, definition, selectedStatusEffect),
                    } : {}),
                    value: condition.type === BOT_CODE_CONDITIONS.ALWAYS ? true : value,
                    comparator: condition.comparator ?? null,
                    comparedTo: condition.type === BOT_CODE_CONDITIONS.ALWAYS ? null : rightValue,
                    result: evaluateCondition(condition, state),
                    join: conditionIndex > 0 ? condition.join ?? "and" : null,
                });
            });
            visitBranches(branch.children, rootName, branchPath);
        });
    };
    normalized.roots.forEach((root) => visitBranches(root.branches, root.name));
    return inspections;
}

function targetEntityInspection(target) {
    if (!target) return null;
    const ageMs = Number(target.ageMs);
    return {
        id: target.id ?? null,
        type: target.type ?? null,
        entityContractType: target.entityContractType ?? null,
        ownerId: target.ownerId ?? null,
        ownerSlot: target.ownerSlot ?? null,
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
    };
}

function statusEffectInspection(state, definition, effectId) {
    const bot = definition?.scope === STATE_VARIABLE_SCOPES.OPPONENT ? state.opponent : state.player;
    const status = (bot?.statusEffects ?? []).find((candidate) => String(candidate?.type ?? "").toLowerCase() === effectId);
    if (!status) return null;
    return {
        type: String(status.type).toLowerCase(),
        mode: status.mode ?? "duration",
        active: status.mode === "presence" || Number(status.remainingMs ?? 0) > 0,
        remainingMs: Math.max(0, Number(status.remainingMs ?? 0)),
        ...(Number(status.tickMs) > 0 ? { tickMs: Number(status.tickMs) } : {}),
        effects: Array.isArray(status.effects) ? status.effects : [],
    };
}

function abilityInspection(value) {
    const identity = abilityIdentity(abilityIdFromBoundary(value));
    return identity ? {
        id: identity.id,
        name: identity.name,
        label: identity.label,
    } : null;
}

export function hasAbilityStrategyActions(configuration) {
    return hasStrategyActions(configuration, normalizeAbilityStrategyConfiguration);
}

function selectionRuntime() {
    return {
        normalizeConfiguration: normalizeAbilityStrategyConfiguration,
        stateFromPayload,
        prepareCustomVariables: (state, definitions) => prepareCustomVariableState(state, definitions),
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
    return normalizedBlockActions(block).some((entry) => entry.action !== BOT_CODE_ACTIONS.NONE);
}

export function customVariableDefinitions(configuration) {
    return normalizeCustomVariableDefinitions(configuration?.customVariables, { normalizeConditions, normalizeBoolean, clamp }).map((variable) => variableDefinition(
        variable.id,
        variable.name,
        variable.valueType,
        { group: "Custom Variables", min: CUSTOM_NUMBER_MIN, max: CUSTOM_NUMBER_MAX, step: NUMBER_STEP, defaultValue: variable.initialValue },
    ));
}

function evaluateConditionList(conditions, state) {
    const angleGroups = collectRepeatedAngleGroups(conditions, state);
    if (!angleGroups.length) return evaluateConditionNodes(conditions, state, evaluateExpressionCondition);
    if (conditions.every((condition, index) => index === 0 || condition.join !== CONDITION_JOINS.OR)) {
        return evaluateAllAndAngleGroups(conditions, state, angleGroups);
    }
    if (angleGroups.length > MAX_ENUMERATED_ANGLE_GROUPS) {
        return evaluateConditionNodes(conditions, state, evaluateExpressionCondition);
    }
    return evaluateAngleVariants(conditions, state, angleGroups, 0, new Map());
}

function collectRepeatedAngleGroups(conditions, state) {
    const groups = new Map();
    for (const condition of conditions) {
        if (condition?.type !== BOT_CODE_CONDITIONS.EXPRESSION) continue;
        const leftDefinition = conditionLeftDefinition(condition, state);
        if (!leftDefinition?.circularAngle) continue;
        const left = resolveStateVariable(state, condition, leftDefinition.id, condition.leftTarget ?? condition.target);
        const numericLeft = Number(left);
        if (!Number.isFinite(numericLeft)) continue;
        const key = angleConditionGroupKey(condition);
        const group = groups.get(key) ?? { key, values: angleRepresentations(numericLeft), count: 0 };
        group.count += 1;
        groups.set(key, group);
    }
    return [...groups.values()].filter((group) => group.count > 1);
}

function evaluateAllAndAngleGroups(conditions, state, groups) {
    const groupedConditions = new Map(groups.map((group) => [group.key, []]));
    for (const condition of conditions) {
        if (condition?.type !== BOT_CODE_CONDITIONS.EXPRESSION) continue;
        const group = groupedConditions.get(angleConditionGroupKey(condition));
        if (group) group.push(condition);
    }
    for (const group of groups) {
        const matches = group.values.some((value) => {
            const overrides = new Map([[group.key, value]]);
            return groupedConditions.get(group.key).every((condition) => evaluateExpressionCondition(condition, state, overrides));
        });
        if (!matches) return false;
    }
    return conditions.every((condition) => {
        if (condition?.type === BOT_CODE_CONDITIONS.EXPRESSION
            && groupedConditions.has(angleConditionGroupKey(condition))) return true;
        return evaluateConditionNode(condition, state, evaluateExpressionCondition);
    });
}

function evaluateAngleVariants(conditions, state, groups, groupIndex, angleOverrides) {
    if (groupIndex >= groups.length) {
        return evaluateConditionNodes(
            conditions,
            state,
            (condition, currentState) => evaluateExpressionCondition(condition, currentState, angleOverrides),
        );
    }
    const group = groups[groupIndex];
    for (const value of group.values) {
        angleOverrides.set(group.key, value);
        const matches = evaluateAngleVariants(conditions, state, groups, groupIndex + 1, angleOverrides);
        angleOverrides.delete(group.key);
        if (matches) return true;
    }
    return false;
}

function normalizeConditions(conditions, customVariables = []) {
    const source = Array.isArray(conditions) ? conditions : [{ type: CONDITION_TYPES[0].id }];
    return source.slice(0, MAX_CONDITIONS_PER_BRANCH).map((condition, index) => {
        if (condition?.type === BOT_CODE_CONDITIONS.EXPRESSION || condition?.left) {
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
                target: normalizeTarget(condition?.target, definition.defaultTarget ?? BOT_CODE_TARGETS.OPPONENT, definition.targetGroup, null, definition.targetOrderable !== false),
            } : {}),
        }, condition, index);
    });
}

function withConditionJoin(normalized, source, index) {
    return index > 0 && source?.join === CONDITION_JOINS.OR
        ? { ...normalized, join: CONDITION_JOINS.OR }
        : normalized;
}

function normalizeExpressionCondition(condition, customVariables = [], targetTypes = TARGET_TYPES) {
    const leftId = condition?.left;
    const customVariable = customVariables.find((variable) => variable?.id === leftId);
    const customLeft = String(leftId ?? "").startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX)
        ? variableDefinition(String(leftId), String(customVariable?.name ?? leftId), customVariable?.valueType === "boolean" ? "boolean" : condition?.right?.type === "boolean" ? "boolean" : "number", { min: CUSTOM_NUMBER_MIN, max: CUSTOM_NUMBER_MAX, step: NUMBER_STEP })
        : null;
    const leftDefinition = STATE_VARIABLE_BY_ID.get(leftId) ?? customLeft;
    if (!leftDefinition) return falseCondition();
    const comparator = normalizeComparator(condition?.comparator, leftDefinition.valueType);
    const right = normalizeRightOperand(condition?.right, leftDefinition);
    const rightDefinition = right?.type === "variable" ? STATE_VARIABLE_BY_ID.get(right.value) : null;
    const abilityVariable = leftDefinition.supportsAbility ? leftDefinition : rightDefinition?.supportsAbility ? rightDefinition : null;
    const statusVariable = leftDefinition.supportsStatusEffect ? leftDefinition : rightDefinition?.supportsStatusEffect ? rightDefinition : null;
    const ability = abilityVariable ? normalizeAbilityId(condition?.ability, abilityVariable) : null;
    if (abilityVariable?.requiredTag === ABILITY_TAGS.CHARGES && ability == null) return falseCondition();
    return {
        type: "expression",
        left: leftDefinition.id,
        comparator,
        right,
        ...(abilityVariable ? { ability } : {}),
        ...(statusVariable ? { statusEffect: normalizeStatusEffectId(condition?.statusEffect, statusVariable) } : {}),
        ...(leftDefinition.supportsTarget ? {
            leftTarget: normalizeTarget(
                condition?.leftTarget ?? condition?.target,
                defaultTargetForVariable(leftDefinition, targetTypes),
                leftDefinition.targetGroup ?? null,
                leftDefinition.targetCapability ?? null,
                leftDefinition.targetOrderable !== false,
                leftDefinition.botTargetOnly === true,
            ),
        } : {}),
        ...(right?.type === "variable" && STATE_VARIABLE_BY_ID.get(right.value)?.supportsTarget ? {
            rightTarget: normalizeTarget(
                condition?.rightTarget ?? condition?.target,
                defaultTargetForVariable(STATE_VARIABLE_BY_ID.get(right.value), targetTypes),
                STATE_VARIABLE_BY_ID.get(right.value).targetGroup ?? null,
                STATE_VARIABLE_BY_ID.get(right.value).targetCapability ?? null,
                STATE_VARIABLE_BY_ID.get(right.value).targetOrderable !== false,
                STATE_VARIABLE_BY_ID.get(right.value).botTargetOnly === true,
            ),
        } : {}),
    };
}

function normalizeComparator(comparator, valueType) {
    const definition = COMPARATOR_BY_ID.get(comparator);
    if (definition?.valueTypes.includes(valueType)) return definition.id;
    return valueType === "boolean" ? "eq" : "lt";
}

function normalizeRightOperand(right, leftDefinition) {
    if (leftDefinition.valueType === "boolean") {
        return { type: "boolean", value: normalizeBoolean(right?.value, true) };
    }
    if (right?.type === "variable") {
        const rightDefinition = STATE_VARIABLE_BY_ID.get(right.value);
        if (rightDefinition?.valueType === "number" || String(right.value ?? "").startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX)) {
            return { type: "variable", value: rightDefinition?.id ?? String(right.value) };
        }
    }
    const value = boundedNumber(right?.value, leftDefinition.min, leftDefinition.max, leftDefinition.defaultValue);
    const step = Number(leftDefinition.step ?? NUMBER_STEP);
    return {
        type: "number",
        value: step >= 1 ? Math.trunc(value) : truncateToNumberPrecision(value),
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
    const primaryAction = actions[0] ?? { action: BOT_CODE_ACTIONS.NONE, actionTarget: BOT_CODE_TARGETS.OPPONENT };
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
        : [{ action: block?.action ?? BOT_CODE_ACTIONS.NONE, actionTarget: block?.actionTarget, targetOffsetX: block?.targetOffsetX, targetOffsetY: block?.targetOffsetY }];
    const seenHeads = new Set();
    const normalized = [];
    for (const entry of source) {
        const normalizedActionId = typeof entry?.action === "string"
            ? abilityIdFromLegacyName(entry.action) ?? entry.action
            : entry?.action;
        const action = ACTION_BY_ID.get(normalizedActionId) ?? ACTION_TYPES[0];
        const entries = action.variableAction ? [normalizeVariableActionEntry(entry)] : [entry];
        for (const normalizedEntry of entries) {
            const head = actionExecutionHead(action);
            const headKey = head === ACTION_HEADS.VARIABLE ? `${head}:${normalized.length}` : head;
            if (seenHeads.has(headKey)) continue;
            seenHeads.add(headKey);
            const movementMode = action.movementConfig
                ? ["target", "coordinates", "absolute"].includes(normalizedEntry?.movementMode) ? normalizedEntry.movementMode : "target"
                : null;
            const targetMode = action.movementConfig
                ? movementMode === "coordinates" ? "coordinates" : "target"
                : action.angleTarget
                    ? ["target", "angle", "coordinates"].includes(normalizedEntry?.targetMode)
                        ? normalizedEntry.targetMode
                        : normalizedEntry?.targetMode == null && (normalizedEntry?.targetX != null || normalizedEntry?.targetY != null) ? "coordinates" : "target"
                    : action.coordinateTarget
                        ? normalizedEntry?.targetMode === "coordinates"
                            || (normalizedEntry?.targetMode == null && (normalizedEntry?.targetX != null || normalizedEntry?.targetY != null)) ? "coordinates" : "target"
                        : null;
            normalized.push({
                action: action.id,
                actionTarget: normalizeActionTarget(normalizedEntry?.actionTarget, action.id),
                ...(action.movementConfig ? {
                    movementMode,
                    movementDirection: normalizeMovementDirection(normalizedEntry?.movementDirection, movementMode, action),
                } : {}),
                ...(action.orientationConfig ? { phaseFacingMode: ["face_target", "keep", "face_origin", "mirror"].includes(normalizedEntry?.phaseFacingMode) ? normalizedEntry.phaseFacingMode : "face_target" } : {}),
                ...(actionSupportsTarget(action) && !action.movementConfig ? {
                    targetOffsetX: boundedNumber(normalizedEntry?.targetOffsetX, -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS, 0),
                    targetOffsetY: boundedNumber(normalizedEntry?.targetOffsetY, -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS, 0),
                } : {}),
                ...(action.coordinateTarget ? {
                    targetMode,
                    targetX: boundedNumber(normalizedEntry?.targetX, 0, ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS / 2),
                    targetY: boundedNumber(normalizedEntry?.targetY, 0, ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS / 2),
                } : {}),
                ...(action.angleTarget ? {
                    targetAngle: boundedNumber(normalizedEntry?.targetAngle, -360, 360, 0),
                } : {}),
                ...(action.variableAction ? {
                    variableId: String(normalizedEntry?.variableId ?? ""),
                    ...(normalizedEntry?.value === true || normalizedEntry?.value === false
                        ? { value: normalizedEntry.value }
                        : { terms: normalizedEntry.terms }),
                } : {}),
            });
        }
    }
    const executable = normalized.filter((entry) => entry.action !== BOT_CODE_ACTIONS.NONE);
    return executable.length ? executable : [{ action: BOT_CODE_ACTIONS.NONE, actionTarget: BOT_CODE_TARGETS.OPPONENT }];
}

export function defaultTargetForVariable(variable, targetTypes = TARGET_TYPES) {
    const availableTargets = Array.isArray(targetTypes) ? targetTypes : TARGET_TYPES;
    if (variable?.defaultTarget && availableTargets.some((target) => target.id === variable.defaultTarget)) {
        return variable.defaultTarget;
    }
    if (variable?.targetGroup === "objects") {
        return availableTargets.find((target) => target.kind === "entity")?.id
            ?? TARGET_TYPES.find((target) => target.kind === "entity")?.id
            ?? BOT_CODE_TARGETS.OPPONENT;
    }
    return variable?.defaultTarget ?? BOT_CODE_TARGETS.OPPONENT;
}

function formatInspectionTargetLabel(value, variable) {
    const [baseValue, encodedOrder, encodedOrdinal] = String(value).split(":");
    const definition = TARGET_BY_ID.get(baseValue);
    const label = definition?.label ?? baseValue;
    if (variable?.targetOrderable === false || baseValue === BOT_CODE_TARGETS.OPPONENT) return label;
    const order = TARGET_ORDERS.includes(encodedOrder) ? encodedOrder : "closest";
    const ordinal = Math.max(1, Math.min(100, Number(encodedOrdinal) || 1));
    return `${formatOrdinal(ordinal)} ${order[0].toUpperCase()}${order.slice(1)} ${label}`;
}

function formatOrdinal(value) {
    const remainder100 = value % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
    return `${value}${({ 1: "st", 2: "nd", 3: "rd" })[value % 10] ?? "th"}`;
}

function normalizeMovementDirection(value, mode, action) {
    if (action?.id === BOT_CODE_ACTIONS.MOVE_WALK && mode === "absolute") {
        const legacyDirection = {
            north: 0,
            northeast: 45,
            east: 90,
            southeast: 135,
            south: 180,
            southwest: 225,
            west: 270,
            northwest: 315,
        }[String(value ?? "").trim().toLowerCase()];
        if (legacyDirection != null) return legacyDirection;

        const text = typeof value === "string" ? value.trim() : value;
        const numeric = text == null || text === "" ? Number.NaN : Number(text);
        if (Number.isFinite(numeric)) return truncateToNumberPrecision(clamp(numeric, MOVEMENT_DIRECTION_MIN, MOVEMENT_DIRECTION_MAX));
        return 0;
    }
    if (action?.id === BOT_CODE_ACTIONS.MOVE_WALK) {
        const text = typeof value === "string" ? value.trim() : value;
        const numeric = text == null || text === "" ? Number.NaN : Number(text);
        if (Number.isFinite(numeric)) return truncateToNumberPrecision(clamp(numeric, MOVEMENT_DIRECTION_MIN, MOVEMENT_DIRECTION_MAX));
        return 0;
    }
    if (mode === "absolute") {
        return ABSOLUTE_MOVEMENT_DIRECTIONS.includes(value) ? value : "north";
    }
    const text = typeof value === "string" ? value.trim() : value;
    const numeric = text == null || text === "" ? Number.NaN : Number(text);
    if (Number.isFinite(numeric)) return truncateToNumberPrecision(clamp(numeric, MOVEMENT_DIRECTION_MIN, MOVEMENT_DIRECTION_MAX));
    return 0;
}

export function actionExecutionHead(action) {
    if (action?.head === ACTION_HEADS.VARIABLE) return ACTION_HEADS.VARIABLE;
    if (action?.head === ACTION_HEADS.MOVEMENT) return ACTION_HEADS.MOVEMENT;
    if (action?.head === ACTION_HEADS.ROTATION) return ACTION_HEADS.ROTATION;
    if (action?.head === ACTION_HEADS.NONE) return ACTION_HEADS.NONE;
    return ACTION_HEADS.ABILITY;
}

function normalizePriority(value) {
    return clamp(Math.round(Number.isFinite(Number(value)) ? Number(value) : 1), MIN_PRIORITY, MAX_PRIORITY);
}

function normalizeActionTarget(target, actionId) {
    const action = ACTION_BY_ID.get(actionId) ?? ACTION_TYPES[0];
    if (!actionSupportsTarget(action)) return BOT_CODE_TARGETS.OPPONENT;
    return normalizeTarget(target, BOT_CODE_TARGETS.OPPONENT);
}

function blockHasExecutableAction(block, state) {
    return normalizedBlockActions(block).some((entry) => actionExecutableNow({ ...block, ...entry }, state));
}

function normalizeVariableActionOperand(operand) {
    const candidate = operand ?? {};
    const variable = candidate.type === "variable" && (
        STATE_VARIABLE_BY_ID.get(String(candidate.value))?.valueType === "number"
        || String(candidate.value).startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX)
    ) ? String(candidate.value) : null;
    return variable
        ? { type: "variable", value: variable, ...(candidate.target ? { target: String(candidate.target) } : {}) }
        : { type: "number", value: clamp(truncateToNumberPrecision(Number(candidate.value) || 0), CUSTOM_NUMBER_MIN, CUSTOM_NUMBER_MAX) };
}

function normalizeVariableActionEntry(entry) {
    if (entry?.value === true || entry?.value === false) return { ...entry, operation: CUSTOM_VARIABLE_OPERATIONS.SET };
    const legacy = [{
        operator: entry?.operation ?? CUSTOM_VARIABLE_OPERATIONS.SET,
        operand: entry?.operand ?? { type: "number", value: entry?.value ?? 0 },
    }];
    const source = Array.isArray(entry?.terms) && entry.terms.length ? entry.terms : legacy;
    const normalized = {
        ...entry,
        terms: normalizeVariableActionTerms({ ...entry, terms: source.slice(0, MAX_VARIABLE_ACTION_TERMS) }),
    };
    delete normalized.operation;
    delete normalized.operand;
    delete normalized.value;
    return normalized;
}

function normalizeVariableActionTerms(entry) {
    const legacy = [{
        operator: entry.operation ?? "set",
        operand: { type: "number", value: entry.value ?? 0 },
    }];
    const source = Array.isArray(entry.terms) && entry.terms.length ? entry.terms : legacy;
    return source.slice(0, MAX_VARIABLE_ACTION_TERMS).map((term, index) => {
        const operand = term?.operand ?? term ?? {};
        const normalizedOperand = normalizeVariableActionOperand(operand);
        return {
            operator: index === 0 && term?.operator === CUSTOM_VARIABLE_OPERATIONS.SET
                ? CUSTOM_VARIABLE_OPERATIONS.SET
                : term?.operator === CUSTOM_VARIABLE_OPERATIONS.SUBTRACT
                    ? CUSTOM_VARIABLE_OPERATIONS.SUBTRACT
                    : term?.operator === CUSTOM_VARIABLE_OPERATIONS.MODULO ? CUSTOM_VARIABLE_OPERATIONS.MODULO : CUSTOM_VARIABLE_OPERATIONS.ADD,
            operand: normalizedOperand,
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

function normalizeTarget(target, fallback, targetGroup = null, targetCapability = null, allowOrdering = true, botTargetOnly = false) {
    const [base, order, ordinal] = String(target ?? "").split(":");
    const value = allowOrdering ? target : base;
    const ordered = allowOrdering && TARGET_BY_ID.has(base)
        && base !== BOT_CODE_TARGETS.OPPONENT
        && TARGET_ORDERS.includes(order)
        && Number.isInteger(Number(ordinal)) && Number(ordinal) >= 1 && Number(ordinal) <= 100;
    if (!TARGET_BY_ID.has(value) && !ordered) return fallback;
    if (targetGroup === "objects" && !isObjectTarget(value)) return fallback;
    if (targetCapability && !targetSupportsCapability(value, targetCapability)) return fallback;
    if (botTargetOnly && base !== BOT_CODE_TARGETS.OPPONENT) return fallback;
    return value;
}

function targetSupportsCapability(target, capability) {
    const base = String(target ?? "").split(":")[0];
    const definition = TARGET_BY_ID.get(base);
    if (capability === TARGET_CAPABILITIES.HEALTH) return Boolean(definition?.healthBearing);
    return true;
}

function isObjectTarget(target) {
    const base = String(target).split(":")[0];
    return base !== BOT_CODE_TARGETS.OPPONENT && TARGET_BY_ID.has(base);
}

function conditionLeftDefinition(condition, state) {
    const customDefinition = state.customVariableDefinitions?.find((candidate) => candidate.id === condition.left);
    return STATE_VARIABLE_BY_ID.get(condition.left)
        ?? (customDefinition ? variableDefinition(customDefinition.id, customDefinition.name, customDefinition.valueType, { min: CUSTOM_NUMBER_MIN, max: CUSTOM_NUMBER_MAX, step: NUMBER_STEP }) : null);
}

function angleConditionGroupKey(condition) {
    return `${condition.left}|${condition.leftTarget ?? condition.target ?? BOT_CODE_TARGETS.OPPONENT}`;
}

function angleRepresentations(value) {
    const positive = ((value % 360) + 360) % 360;
    const negative = positive - 360;
    return positive === negative ? [positive] : [positive, negative];
}

function evaluateExpressionCondition(condition, state, angleOverrides = null) {
    const leftDefinition = conditionLeftDefinition(condition, state);
    if (!leftDefinition) return false;
    if (leftDefinition.targetCapability && !targetSupportsCapability(condition.leftTarget ?? condition.target, leftDefinition.targetCapability)) return false;
    const angleKey = leftDefinition.circularAngle ? angleConditionGroupKey(condition) : null;
    const hasAngleOverride = Boolean(angleOverrides?.has(angleKey));
    const left = hasAngleOverride
        ? angleOverrides.get(angleKey)
        : resolveStateVariable(state, condition, leftDefinition.id, condition.leftTarget ?? condition.target);
    const right = condition.right?.type === "variable"
        ? resolveStateVariable(state, condition, condition.right.value, condition.rightTarget ?? condition.target)
        : condition.right?.value;
    const rightDefinition = condition.right?.type === "variable"
        ? STATE_VARIABLE_BY_ID.get(condition.right.value)
        : null;
    if (rightDefinition?.targetCapability
        && !targetSupportsCapability(condition.rightTarget ?? condition.target, rightDefinition.targetCapability)) return false;
    return leftDefinition.circularAngle
        ? hasAngleOverride && condition.comparator !== BOT_CODE_COMPARATORS.EQ && condition.comparator !== BOT_CODE_COMPARATORS.NEQ
            ? compareValues(left, condition.comparator, right, "number")
            : compareAngleValues(left, condition.comparator, right)
        : compareValues(left, condition.comparator, right, leftDefinition.valueType);
}

function resolveStateVariable(state, condition, variableId, targetId = condition.target) {
    return resolveRuntimeVariable(state, condition, variableId, targetId, {
        resolveCustom: resolveCustomVariableValue,
        resolveTarget: resolveAbilityStrategyTarget,
        matchingTargets: matchingStrategyTargets,
    });
}

function normalizeAbilityId(value, variable) {
    const normalizedId = abilityIdFromBoundary(value);
    const candidate = abilityDefinitionsForVariable(variable, [normalizedId])[0];
    const available = Array.isArray(variable?.abilityOptions) && variable.abilityOptions.length
        ? new Set(variable.abilityOptions.map((ability) => ability.id))
        : null;
    if (candidate && (!available || available.has(candidate.id))) return candidate.id;
    return variable?.requiredTag === ABILITY_TAGS.CHARGES && normalizedId != null
        ? null
        : defaultAbilityForVariable(variable);
}

function boundedNumber(value, min, max, fallback) {
    const numeric = Number(value);
    return truncateToNumberPrecision(clamp(Number.isFinite(numeric) ? numeric : fallback, min, max));
}

function normalizeStatusEffectId(value, variable = null) {
    const normalized = String(value ?? "").trim().toLowerCase();
    const options = variable?.statusEffectOptions?.length ? variable.statusEffectOptions : STATUS_EFFECT_DEFINITIONS;
    return options.find((statusEffect) => statusEffect.id === normalized
        || statusEffect.label.toLowerCase() === normalized)?.id
        ?? defaultStatusEffectForVariable(variable);
}

function normalizeBoolean(value, fallback) {
    if (value === true || value === false) return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return fallback;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
