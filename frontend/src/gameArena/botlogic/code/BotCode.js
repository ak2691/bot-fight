import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { abilityIdFromBoundary } from "../../gameconfig/AbilityCompatibility.js";
import { abilityIdFromLegacyName, abilityIdentity } from "../../gameconfig/AbilityRegistry.js";
import { ACTION_TO_ABILITY, ALL_ABILITY_DEFINITIONS, STATUS_EFFECT_DEFINITIONS } from "../../loadout/BotLoadout.js";
import { createDefaultAbilityStrategyConfiguration } from "./configuration/configurationFactories.js";
import { matchingStrategySelectables, resolveAbilityStrategySelectable } from "./runtime/targeting.js";
import { normalizeRoots } from "./configuration/rootOperations.js";
import { hasStrategyActions, selectStrategyActionPlan, selectStrategyBlock } from "./runtime/actionSelector.js";
import { validateConfiguration } from "./configuration/validation.js";
import { compareAngleValues, compareValues, evaluateConditionNode, evaluateConditionNodes } from "./runtime/conditionEvaluator.js";
import { normalizeConfiguration } from "./configuration/normalization.js";
import { stateFromPayload } from "./runtime/runtimeState.js";
import { selectPriorityCandidates as selectCandidates } from "./runtime/treeSelection.js";
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
    BOT_CODE_SELECTABLES,
    CONDITION_JOINS,
    CUSTOM_VARIABLE_CONTRACT,
    CUSTOM_VARIABLE_OPERATIONS,
    COMPARATOR_BY_ID,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    STATE_VARIABLES,
    VISIBLE_STATE_VARIABLES,
    STATE_VARIABLE_BY_ID,
    STATE_VARIABLE_SCOPES,
    SELECTABLE_CAPABILITIES,
    SELECTABLE_BY_ID,
    SELECTABLE_IDENTITIES,
    SELECTABLE_ORDERS,
    SELECTABLE_TYPES,
    TARGET_MODES,
    canonicalBotSelectableId,
    VARIABLE_SELECTABLE_TYPES,
    selectableIdentitiesForVariable,
    selectableMatchesVariable,
    ABSOLUTE_MOVEMENT_DIRECTIONS,
    MOVEMENT_DIRECTION_MAX,
    MOVEMENT_DIRECTION_MIN,
    abilityDefinitionsForVariable,
    defaultAbilityForVariable,
    defaultStatusEffectForVariable,
    defaultSelectablePairForVariable as contractDefaultSelectablePairForVariable,
    variableDefinition,
} from "./contracts/BotLogicContracts.js";

export { createCodeRoot, createDefaultAbilityStrategyConfiguration } from "./configuration/configurationFactories.js";
export { resolveAbilityStrategySelectable } from "./runtime/targeting.js";
export { actionSupportsTarget } from "./runtime/actionRuntime.js";
export { actionEntryCost, countActionSlots, countConditionSlots, countVariableSlots } from "./configuration/configurationMetrics.js";
export { insertParentLogicBranch, moveLogicRootPriority, normalizeRoots, removeLogicBranch, setLogicBranchPriority, setLogicRootPriority } from "./configuration/rootOperations.js";
export * from "./configuration/constants.js";
export {
    ACTION_TYPES,
    ABILITY_TAGS,
    BOT_CODE_ACTIONS,
    BOT_CODE_SELECTABLES,
    CONDITION_COMPARATORS,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    CUSTOM_VARIABLE_OPERATIONS,
    STATE_VARIABLES,
    VISIBLE_STATE_VARIABLES,
    SELECTABLE_CAPABILITIES,
    SELECTABLE_BY_ID,
    VARIABLE_TAGS,
    VARIABLE_SELECTABLE_TYPES,
    selectableIdentitiesForVariable,
    selectableMatchesVariable,
    SELECTABLE_DEPENDENCIES,
    SELECTABLE_IDENTITIES,
    abilityDefinitionsForVariable,
    SELECTABLE_TYPES,
    TARGET_MODES,
    SELECTABLE_ORDERS,
    canonicalBotSelectableId,
} from "./contracts/BotLogicContracts.js";
const CONDITION_BY_ID = new Map(CONDITION_DEFINITIONS.map((condition) => [condition.id, condition]));
const OPPONENT_SELECTABLE_ID = BOT_CODE_SELECTABLES.OPPONENT;
const MAX_ENUMERATED_ANGLE_GROUPS = 8;

export function createLogicBlock(conditionType = BOT_CODE_CONDITIONS.ALWAYS, action = BOT_CODE_ACTIONS.MOVE_WALK) {
    const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
    return {
        conditions: [{
            type: definition.id,
            ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
        ...(definition.supportsSelectable ? { selectable: definition.defaultSelectable ?? OPPONENT_SELECTABLE_ID } : {}),
        }],
        priority: 1,
        action: ACTION_BY_ID.has(action) ? action : ACTION_TYPES[0].id,
        selectable: normalizeSelectable(OPPONENT_SELECTABLE_ID, OPPONENT_SELECTABLE_ID),
    };
}

export function createExpressionCondition(left = "selectable.distance", selectableTypes = SELECTABLE_TYPES) {
    const suppliedDefinition = left && typeof left === "object" ? left : null;
    const variable = suppliedDefinition ?? STATE_VARIABLE_BY_ID.get(left) ?? STATE_VARIABLES[0];
    const defaultStatusEffect = variable.supportsStatusEffect
        ? defaultStatusEffectForVariable(variable)
        : null;
    const selectablePair = variable.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
        ? contractDefaultSelectablePairForVariable(variable, selectableTypes)
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
        ...(selectablePair
            ? { selectable1: selectablePair[0], selectable2: selectablePair[1] }
            : variable.supportsSelectable ? { leftSelectable: defaultSelectableForVariable(variable, selectableTypes) } : {}),
    }, [], selectableTypes);
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
                const selectablePair = definition?.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
                    ? normalizedSelectablePair(condition, definition)
                    : null;
                const selectableId = selectablePair?.[0] ?? condition.leftSelectable ?? condition.selectable;
                const selectable2Id = selectablePair?.[1] ?? null;
                const resolvedSelectable = selectableId ? resolveAbilityStrategySelectable(state, selectableId) : null;
                const resolvedSelectable2 = selectable2Id ? resolveAbilityStrategySelectable(state, selectable2Id) : null;
                const value = definition
                    ? resolveStateVariable(state, condition, definition.id, selectableId)
                    : null;
                const rightValue = condition.right?.type === "variable"
                    ? resolveStateVariable(state, condition, condition.right.value, condition.rightSelectable ?? condition.selectable)
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
                    selectable: selectablePair
                        ? `${formatInspectionSelectableLabel(selectablePair[0], definition)} → ${formatInspectionSelectableLabel(selectablePair[1], definition)}`
                        : selectableId ? formatInspectionSelectableLabel(selectableId, definition) : null,
                    selectableSelector: selectableId ?? null,
                    resolvedSelectable: selectableEntityInspection(resolvedSelectable),
                    ...(selectable2Id ? {
                        selectable2Selector: selectable2Id,
                        resolvedSelectable2: selectableEntityInspection(resolvedSelectable2),
                    } : {}),
                    ...(selectedStatusEffect ? {
                        statusEffect: selectedStatusEffect,
                        statusEffectState: statusEffectInspection(state, definition, selectedStatusEffect, condition),
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

function selectableEntityInspection(selectable) {
    if (!selectable) return null;
    const ageMs = Number(selectable.ageMs);
    return {
        id: selectable.id ?? null,
        type: selectable.type ?? null,
        entityContractType: selectable.entityContractType ?? null,
        ownerId: selectable.ownerId ?? null,
        ownerSlot: selectable.ownerSlot ?? null,
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
    };
}

function statusEffectInspection(state, definition, effectId, condition) {
    const selectedSelectable = definition?.scope === STATE_VARIABLE_SCOPES.SELECTABLE
        ? resolveAbilityStrategySelectable(state, condition?.leftSelectable ?? condition?.selectable ?? BOT_CODE_SELECTABLES.MY)
        : null;
    const bot = selectedSelectable;
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
        resolveTarget: resolveAbilityStrategySelectable,
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
        const left = resolveStateVariable(state, condition, leftDefinition.id, condition.leftSelectable ?? condition.selectable);
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

export function normalizeConditions(conditions, customVariables = [], selectableTypes = SELECTABLE_TYPES) {
    const source = Array.isArray(conditions) ? conditions : [{ type: CONDITION_TYPES[0].id }];
    return source.slice(0, MAX_CONDITIONS_PER_BRANCH).map((condition, index) => {
        if (condition?.type === BOT_CODE_CONDITIONS.EXPRESSION || condition?.left) {
            return withConditionJoin(normalizeExpressionCondition(condition, customVariables, selectableTypes), condition, index);
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
            ...(definition.supportsSelectable ? {
                selectable: normalizeSelectable(
                    condition?.selectable,
                    definition.defaultSelectable ?? BOT_CODE_SELECTABLES.OPPONENT,
                    selectableIdentitiesForVariable(definition),
                    null,
                    definition.selectableOrderable !== false,
                ),
            } : {}),
        }, condition, index);
    });
}

function withConditionJoin(normalized, source, index) {
    return index > 0 && source?.join === CONDITION_JOINS.OR
        ? { ...normalized, join: CONDITION_JOINS.OR }
        : normalized;
}

function normalizeExpressionCondition(condition, customVariables = [], selectableTypes = SELECTABLE_TYPES) {
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
    const normalizedSelectablePair = leftDefinition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
        ? normalizeSelectablePair(condition, leftDefinition, selectableTypes)
        : null;
    const normalizedTarget = normalizedSelectablePair
        ? normalizePairTarget(condition, leftDefinition)
        : null;
    return {
        type: "expression",
        left: leftDefinition.id,
        comparator,
        right,
        ...(abilityVariable ? { ability } : {}),
        ...(statusVariable ? { statusEffect: normalizeStatusEffectId(condition?.statusEffect, statusVariable) } : {}),
        ...(normalizedSelectablePair
            ? { selectable1: normalizedSelectablePair[0], selectable2: normalizedSelectablePair[1] }
            : leftDefinition.supportsSelectable ? {
                leftSelectable: normalizeSelectable(
                    condition?.leftSelectable ?? condition?.selectable,
                    defaultSelectableForVariable(leftDefinition, selectableTypes),
                    selectableIdentitiesForVariable(leftDefinition),
                    null,
                    leftDefinition.selectableOrderable !== false,
                ),
            } : {}),
        ...(normalizedTarget ?? {}),
        ...(right?.type === "variable" && STATE_VARIABLE_BY_ID.get(right.value)?.supportsSelectable ? {
            rightSelectable: normalizeSelectable(
                condition?.rightSelectable ?? condition?.selectable,
                defaultSelectableForVariable(STATE_VARIABLE_BY_ID.get(right.value), selectableTypes),
                selectableIdentitiesForVariable(STATE_VARIABLE_BY_ID.get(right.value)),
                null,
                STATE_VARIABLE_BY_ID.get(right.value).selectableOrderable !== false,
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
    const primaryAction = actions[0] ?? { action: BOT_CODE_ACTIONS.NONE, selectable: BOT_CODE_SELECTABLES.OPPONENT };
    return {
        id: String(block?.id || `logic-${blockIndex + 1}`),
        conditions: normalizeConditions(block?.conditions, customVariables),
        priority: normalizePriority(block?.priority),
        action: primaryAction.action,
        selectable: primaryAction.selectable,
        actions,
    };
}

function normalizedBlockActions(block) {
    const source = Array.isArray(block?.actions) && block.actions.length
        ? block.actions
        : [{ action: block?.action ?? BOT_CODE_ACTIONS.NONE, selectable: block?.selectable, targetOffsetX: block?.targetOffsetX, targetOffsetY: block?.targetOffsetY }];
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
                selectable: normalizeSelectable(normalizedEntry?.selectable, BOT_CODE_SELECTABLES.OPPONENT),
                ...(action.movementConfig ? {
                    movementMode,
                    movementDirection: normalizeMovementDirection(normalizedEntry?.movementDirection, movementMode, action),
                } : {}),
                ...(action.orientationConfig ? { phaseFacingMode: boundedNumber(normalizedEntry?.phaseFacingMode, MOVEMENT_DIRECTION_MIN, MOVEMENT_DIRECTION_MAX, 0) } : {}),
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
    return executable.length ? executable : [{ action: BOT_CODE_ACTIONS.NONE, selectable: BOT_CODE_SELECTABLES.OPPONENT }];
}

export function defaultSelectableForVariable(variable, selectableTypes = SELECTABLE_TYPES) {
    const availableSelectables = Array.isArray(selectableTypes) ? selectableTypes : SELECTABLE_TYPES;
    const isAllowed = (selectable) => selectableMatchesVariable(selectable, variable);
    const requiredIdentities = selectableIdentitiesForVariable(variable);
    if (variable?.defaultSelectable && availableSelectables.some((selectable) => selectable.id === variable.defaultSelectable && isAllowed(selectable))) {
        return variable.defaultSelectable;
    }
    if (requiredIdentities.includes(SELECTABLE_IDENTITIES.ABILITY_ENTITY)) {
        return availableSelectables.find((selectable) => isAllowed(selectable))?.id ?? BOT_CODE_SELECTABLES.OPPONENT;
    }
    if (availableSelectables.some((selectable) => selectable.id === BOT_CODE_SELECTABLES.OPPONENT && isAllowed(selectable))) {
        return BOT_CODE_SELECTABLES.OPPONENT;
    }
    return availableSelectables.find((selectable) => isAllowed(selectable))?.id ?? BOT_CODE_SELECTABLES.OPPONENT;
}

export function defaultSelectablePairForVariable(variable, selectableTypes = SELECTABLE_TYPES) {
    return contractDefaultSelectablePairForVariable(variable, selectableTypes);
}

function formatInspectionSelectableLabel(value, variable) {
    const [baseValue, encodedOrder, encodedOrdinal] = canonicalBotSelectableId(value).split(":");
    const definition = SELECTABLE_BY_ID.get(baseValue);
    const label = definition?.label ?? baseValue;
    if (variable?.selectableOrderable === false || definition?.kind === "bot") return label;
    const order = SELECTABLE_ORDERS.includes(encodedOrder) ? encodedOrder : "closest";
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
        ? { type: "variable", value: variable, ...(candidate.selectable ? { selectable: String(candidate.selectable) } : {}) }
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
        resolveTarget: resolveAbilityStrategySelectable,
    });
}

function normalizeSelectable(selectableId, fallback, requiredSelectableIdentities = [], selectableCapability = null, allowOrdering = true) {
    const canonicalSelectable = canonicalBotSelectableId(selectableId);
    const canonicalFallback = canonicalBotSelectableId(fallback);
    const [base, order, ordinal] = canonicalSelectable.split(":");
    const value = allowOrdering ? canonicalSelectable : base;
    const ordered = allowOrdering && SELECTABLE_BY_ID.has(base)
        && base !== BOT_CODE_SELECTABLES.MY
        && base !== BOT_CODE_SELECTABLES.OPPONENT
        && SELECTABLE_ORDERS.includes(order)
        && Number.isInteger(Number(ordinal)) && Number(ordinal) >= 1 && Number(ordinal) <= 100;
    if (!SELECTABLE_BY_ID.has(value) && !ordered) return canonicalFallback;
    if (selectableCapability && !selectableSupportsCapability(value, selectableCapability)) return canonicalFallback;
    const selectableDefinition = SELECTABLE_BY_ID.get(base);
    if (requiredSelectableIdentities.length > 0
            && !requiredSelectableIdentities.every((identity) => selectableDefinition?.selectableIdentities?.includes(identity))) return canonicalFallback;
    return value;
}

function normalizeSelectablePair(condition, definition, selectableTypes = SELECTABLE_TYPES) {
    const [defaultFirst, defaultSecond] = contractDefaultSelectablePairForVariable(definition, selectableTypes);
    const first = normalizeSelectable(
        condition?.selectable1 ?? defaultFirst,
        defaultFirst,
        selectableIdentitiesForVariable(definition, 0),
        null,
        definition.selectableOrderable !== false,
    );
    const second = normalizeSelectable(
        condition?.selectable2 ?? condition?.selectable ?? defaultSecond,
        defaultSecond,
        selectableIdentitiesForVariable(definition, 1),
        null,
        definition.selectableOrderable !== false,
    );
    return [first, second];
}

function normalizePairTarget(condition, definition) {
    const modes = definition?.targetModes;
    if (!Array.isArray(modes) || modes.length === 0) return null;
    const inferredMode = condition?.targetMode
        ?? (condition?.targetX != null || condition?.targetY != null
            ? TARGET_MODES.COORDINATES
            : condition?.targetAngle != null ? TARGET_MODES.ANGLE : TARGET_MODES.TARGET);
    const targetMode = modes.includes(inferredMode)
        ? inferredMode
        : modes.includes(TARGET_MODES.TARGET) ? TARGET_MODES.TARGET : modes[0];
    return {
        targetMode,
        targetX: boundedNumber(condition?.targetX, 0, ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS / 2),
        targetY: boundedNumber(condition?.targetY, 0, ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS / 2),
        ...(modes.includes(TARGET_MODES.ANGLE)
            ? { targetAngle: boundedNumber(condition?.targetAngle, -360, 360, 0) }
            : {}),
    };
}

function normalizedSelectablePair(condition, definition) {
    const [defaultFirst, defaultSecond] = contractDefaultSelectablePairForVariable(definition);
    return [
        condition?.selectable1 ?? defaultFirst,
        condition?.selectable2 ?? condition?.selectable ?? defaultSecond,
    ];
}

function selectableSupportsCapability(selectableId, capability) {
    const base = canonicalBotSelectableId(selectableId).split(":")[0];
    const definition = SELECTABLE_BY_ID.get(base);
    if (capability === SELECTABLE_CAPABILITIES.HEALTH) return Boolean(definition?.healthBearing);
    return true;
}

function conditionLeftDefinition(condition, state) {
    const customDefinition = state.customVariableDefinitions?.find((candidate) => candidate.id === condition.left);
    return STATE_VARIABLE_BY_ID.get(condition.left)
        ?? (customDefinition ? variableDefinition(customDefinition.id, customDefinition.name, customDefinition.valueType, { min: CUSTOM_NUMBER_MIN, max: CUSTOM_NUMBER_MAX, step: NUMBER_STEP }) : null);
}

function angleConditionGroupKey(condition) {
    const definition = STATE_VARIABLE_BY_ID.get(condition?.left);
    if (definition?.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
        const [first, second] = normalizedSelectablePair(condition, definition);
        const target = normalizePairTarget(condition, definition);
        const targetKey = target?.targetMode === TARGET_MODES.COORDINATES
            ? `${TARGET_MODES.COORDINATES}|${target.targetX}|${target.targetY}`
            : target?.targetMode === TARGET_MODES.ANGLE
                ? `${TARGET_MODES.ANGLE}|${target.targetAngle}`
                : `${TARGET_MODES.TARGET}|${second}`;
        return `${condition.left}|${first}|${targetKey}`;
    }
    return `${condition.left}|${condition.leftSelectable ?? condition.selectable ?? BOT_CODE_SELECTABLES.OPPONENT}`;
}

function angleRepresentations(value) {
    const positive = ((value % 360) + 360) % 360;
    const negative = positive - 360;
    return positive === negative ? [positive] : [positive, negative];
}

function evaluateExpressionCondition(condition, state, angleOverrides = null) {
    const leftDefinition = conditionLeftDefinition(condition, state);
    if (!leftDefinition) return false;
    if (leftDefinition.selectableCapability && !selectableSupportsCapability(condition.leftSelectable ?? condition.selectable, leftDefinition.selectableCapability)) return false;
    const angleKey = leftDefinition.circularAngle ? angleConditionGroupKey(condition) : null;
    const hasAngleOverride = Boolean(angleOverrides?.has(angleKey));
    const left = hasAngleOverride
        ? angleOverrides.get(angleKey)
        : resolveStateVariable(state, condition, leftDefinition.id, condition.leftSelectable ?? condition.selectable);
    const right = condition.right?.type === "variable"
        ? resolveStateVariable(state, condition, condition.right.value, condition.rightSelectable ?? condition.selectable)
        : condition.right?.value;
    const rightDefinition = condition.right?.type === "variable"
        ? STATE_VARIABLE_BY_ID.get(condition.right.value)
        : null;
    if (rightDefinition?.selectableCapability
        && !selectableSupportsCapability(condition.rightSelectable ?? condition.selectable, rightDefinition.selectableCapability)) return false;
    return leftDefinition.circularAngle
        ? hasAngleOverride && condition.comparator !== BOT_CODE_COMPARATORS.EQ && condition.comparator !== BOT_CODE_COMPARATORS.NEQ
            ? compareValues(left, condition.comparator, right, "number")
            : compareAngleValues(left, condition.comparator, right)
        : compareValues(left, condition.comparator, right, leftDefinition.valueType);
}

function resolveStateVariable(state, condition, variableId, selectableId = condition.selectable) {
    return resolveRuntimeVariable(state, condition, variableId, selectableId, {
        resolveCustom: resolveCustomVariableValue,
        resolveSelectable: resolveAbilityStrategySelectable,
        matchingSelectables: matchingStrategySelectables,
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
