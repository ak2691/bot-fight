import { abilityContract } from "../../../gameconfig/AbilityContracts.js";
import { entityContractForAbility } from "../../../ecs/contracts/EntityContracts.js";
import { ABILITY_TAGS, ALL_ABILITY_DEFINITIONS, entitySelectableDefinitions } from "../../../loadout/BotLoadout.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../../modelPayloads/arenaConstants.js";
import { BOT_SELECTABLE_IDENTITIES, SELECTABLE_DEPENDENCIES, SELECTABLE_IDENTITIES, selectableHasIdentity } from "../../../modelPayloads/selectableIdentities.js";

export { ABILITY_TAGS };

export const BOT_CODE_ACTIONS = Object.freeze({
    NONE: "none",
    VARIABLE: "variable",
    MOVE_WALK: "move_walk",
    ROTATE_TOWARD_TARGET: "rotate_toward_enemy",
});

export const BOT_CODE_CONDITIONS = Object.freeze({
    ALWAYS: "always",
    EXPRESSION: "expression",
});

export const BOT_CODE_SELECTABLES = Object.freeze({
    MY: "my_bot",
    OPPONENT: "opponent",
});

export const BOT_CODE_COMPARATORS = Object.freeze({
    LT: "lt",
    LTE: "lte",
    EQ: "eq",
    NEQ: "neq",
    GTE: "gte",
    GT: "gt",
});

export const CONDITION_JOINS = Object.freeze({
    OR: "or",
});

export const ACTION_HEADS = Object.freeze({
    NONE: "none",
    VARIABLE: "variable",
    MOVEMENT: "movement",
    ROTATION: "rotation",
    ABILITY: "ability",
});

export const CUSTOM_VARIABLE_CONTRACT = Object.freeze({
    PREFIX: "custom.",
    DEFAULT_NAME: "Variable",
});

export const CUSTOM_VARIABLE_OPERATIONS = Object.freeze({
    SET: "set",
    ADD: "add",
    SUBTRACT: "subtract",
    MODULO: "modulo",
});

export const STATE_VARIABLE_SCOPES = Object.freeze({
    MATCH: "match",
    SELECTABLE: "selectable",
});

export const STATE_VARIABLE_SOURCES = Object.freeze({
    MATCH_ELAPSED_SECONDS: "matchElapsedSeconds",
    SELECTABLE_DISTANCE: "selectableDistance",
    SELECTABLE_DAMAGE_TAKEN_LAST_TICK: "selectableDamageTakenLastTick",
    SELECTABLE_HP_NET_CHANGE_LAST_TICK: "selectableHpNetChangeLastTick",
    SELECTABLE_X: "selectableX",
    SELECTABLE_Y: "selectableY",
    SELECTABLE_HP: "selectableHp",
    SELECTABLE_ABSOLUTE_BEARING: "selectableAbsoluteBearing",
    SELECTABLE_MOVEMENT_DIRECTION: "selectableMovementDirection",
    SELECTABLE_SPEED: "selectableSpeed",
    SELECTABLE_RELATIVE_BEARING: "selectableRelativeBearing",
    SELECTABLE_RELATIVE_BEARING_CLOCKWISE: "selectableRelativeBearingClockwise",
    SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE: "selectableRelativeBearingCounterclockwise",
    SELECTABLE_FACING: "selectableFacing",
    SELECTABLE_COUNT: "selectableCount",
    SELECTABLE_AGE: "selectableAge",
    SELECTABLE_EDGE_DISTANCE: "selectableEdgeDistance",
    SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE: "selectableClosingZoneEdgeDistance",
    SELECTABLE_EXISTS: "selectableExists",
    SELECTABLE_ALIVE: "selectableAlive",
    SELECTED_ABILITY_READY: "selectedAbilityReady",
    SELECTED_ABILITY_ACTIVE: "selectedAbilityActive",
    SELECTED_ABILITY_ACTIVE_MS: "selectedAbilityActiveMs",
    SELECTED_ABILITY_ON_COOLDOWN: "selectedAbilityOnCooldown",
    SELECTED_ABILITY_COOLDOWN_MS: "selectedAbilityCooldownMs",
    SELECTED_ABILITY_CHARGES: "selectedAbilityCharges",
    SELECTED_ABILITY_PREPARING: "selectedAbilityPreparing",
    SELECTED_ABILITY_PREPARATION_MS: "selectedAbilityPreparationMs",
    SELECTED_STATUS_EFFECT_ACTIVE: "selectedStatusEffectActive",
    SELECTED_STATUS_EFFECT_DURATION_MS: "selectedStatusEffectDurationMs",
});

export const VARIABLE_TAGS = Object.freeze({
    ALLOW_NEGATIVE_INTEGER: "allow-negative-integer",
});

export const SELECTABLE_CAPABILITIES = Object.freeze({
    HEALTH: "health",
});

export { SELECTABLE_DEPENDENCIES, SELECTABLE_IDENTITIES, selectableHasIdentity };

// Pair variables need two selectable slots. Single-selectable variables are filtered
// directly by the selectable identities they require. Selector labels are optional
// variable metadata; when absent, every selector is simply labeled Entity.
export const VARIABLE_SELECTABLE_TYPES = Object.freeze({
    PAIR: "Variable_Pair",
});

export function selectableIdentitiesForVariable(variable, pairSlot = null) {
    if (variable?.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
        const identities = variable.pairSelectableIdentities ?? [[], []];
        if (pairSlot === 0 || pairSlot === 1) return identities[pairSlot] ?? [];
        return [...new Set(identities.flat())];
    }
    return variable?.selectableIdentities ?? [];
}

export function selectableMatchesVariable(selectable, variable, pairSlot = null) {
    const required = selectableIdentitiesForVariable(variable, pairSlot);
    return required.length === 0 || required.every((identity) => selectableHasIdentity(selectable, identity));
}

export const SELECTABLE_OWNERS = Object.freeze({
    MY: "my",
    OPPONENT: "opponent",
    NONE: "none",
});

export const SELECTABLE_ORDERS = Object.freeze(["closest", "farthest", "oldest", "newest"]);
export const MOVEMENT_MODES = Object.freeze(["target", "coordinates", "absolute"]);
export const MOVEMENT_DIRECTION_MIN = -360;
export const MOVEMENT_DIRECTION_MAX = 360;
export const ABSOLUTE_MOVEMENT_DIRECTIONS = Object.freeze([
    "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "stop",
]);
export const FACING_MODES = Object.freeze(["face_target", "keep", "face_origin", "mirror"]);

export const CONDITION_TYPES = Object.freeze([
    { id: BOT_CODE_CONDITIONS.ALWAYS, label: "ALWAYS", group: "Basic", requiresValue: false },
]);
export const CONDITION_DEFINITIONS = CONDITION_TYPES;

export const CONDITION_COMPARATORS = Object.freeze([
    { id: "lt", label: "<", valueTypes: ["number"] },
    { id: "lte", label: "<=", valueTypes: ["number"] },
    { id: "eq", label: "=", valueTypes: ["number", "boolean"] },
    { id: "neq", label: "!=", valueTypes: ["number", "boolean"] },
    { id: "gte", label: ">=", valueTypes: ["number"] },
    { id: "gt", label: ">", valueTypes: ["number"] },
]);
export const COMPARATOR_BY_ID = new Map(CONDITION_COMPARATORS.map((comparator) => [comparator.id, comparator]));

export const ACTION_TYPES = Object.freeze([
    { id: BOT_CODE_ACTIONS.NONE, label: "N/A (Nested Conditions Only)", head: ACTION_HEADS.NONE },
    { id: BOT_CODE_ACTIONS.VARIABLE, label: "Variable: Modify Custom Variable", head: ACTION_HEADS.VARIABLE, variableAction: true },
    { id: BOT_CODE_ACTIONS.MOVE_WALK, label: "Movement: Walk", head: ACTION_HEADS.MOVEMENT, movementConfig: true, coordinateTarget: true },
    { id: BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET, label: "Rotate: Face Target", head: ACTION_HEADS.ROTATION, coordinateTarget: true, angleTarget: true },
    ...ALL_ABILITY_DEFINITIONS.flatMap((ability) => ability.actions.map((id) => abilityActionDefinition(ability, id))),
]);
export const ACTION_BY_ID = new Map(ACTION_TYPES.map((action) => [action.id, action]));

const ENTITY_SELECTABLE_DEFINITIONS = entitySelectableDefinitions();
export const SELECTABLE_TYPES = Object.freeze([
    { id: BOT_CODE_SELECTABLES.MY, label: "My Bot", owner: SELECTABLE_OWNERS.MY, kind: "bot", healthBearing: true, selectableIdentities: BOT_SELECTABLE_IDENTITIES },
    { id: BOT_CODE_SELECTABLES.OPPONENT, label: "Opponent", owner: SELECTABLE_OWNERS.OPPONENT, kind: "bot", healthBearing: true, selectableIdentities: BOT_SELECTABLE_IDENTITIES },
    ...ENTITY_SELECTABLE_DEFINITIONS.flatMap((ability) => selectableDefinitionsForAbility(ability)),
]);
export const SELECTABLE_BY_ID = new Map(SELECTABLE_TYPES.map((selectable) => [selectable.id, selectable]));

const GENERIC_ABILITY_VARIABLES = [
    ["selectedAbilityReady", "Ability Ready", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_READY, {}],
    ["selectedAbilityActive", "Ability Active", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE, {}],
    ["selectedAbilityOnCooldown", "Ability On Cooldown", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ON_COOLDOWN, {}],
    ["selectedAbilityActiveMs", "Ability Active Time", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE_MS, { min: 0, max: 60, suffix: "s", step: 0.1 }],
    ["selectedAbilityCooldownMs", "Ability Cooldown", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_COOLDOWN_MS, { min: 0, max: 60, suffix: "s", step: 0.1 }],
    ["selectedAbilityCharges", "Ability Charges", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_CHARGES, { min: 0, max: 100, step: 1, requiredTag: ABILITY_TAGS.CHARGES }],
    ["selectedAbilityPreparing", "Ability Preparing", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARING, { requiredTag: "wind-up" }],
    ["selectedAbilityPreparationMs", "Ability Preparation Time Left", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARATION_MS, { min: 0, max: 10, suffix: "s", step: 0.1, requiredTag: "wind-up" }],
].flatMap(([field, label, valueType, runtimeSource, options]) => [
    variableDefinition(`bot.${field}`, `Bot ${label}`, valueType, {
        group: "Abilities & Status",
        supportsAbility: true,
        supportsSelectable: true,
        selectableIdentities: [SELECTABLE_IDENTITIES.BOT],
        selectableDependency: SELECTABLE_DEPENDENCIES.ABILITY_LOADOUT,
        selectableOrderable: false,
        defaultSelectable: BOT_CODE_SELECTABLES.MY,
        scope: STATE_VARIABLE_SCOPES.SELECTABLE,
        runtimeSource,
        ...options,
    }),
]);

const GENERIC_STATUS_VARIABLES = [
    ["selectedStatusEffectActive", "Status Effect Active", "boolean", STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_ACTIVE, {}],
    ["selectedStatusEffectDurationMs", "Status Effect Duration", "number", STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_DURATION_MS, { min: 0, max: 60, suffix: "s", step: 0.1 }],
].flatMap(([field, label, valueType, runtimeSource, options]) => [
    variableDefinition(`bot.${field}`, `Bot ${label}`, valueType, {
        group: "Abilities & Status",
        supportsStatusEffect: true,
        supportsSelectable: true,
        selectableIdentities: [SELECTABLE_IDENTITIES.BOT],
        selectableDependency: SELECTABLE_DEPENDENCIES.STATUS_EFFECT_LOADOUT,
        selectableOrderable: false,
        defaultSelectable: BOT_CODE_SELECTABLES.MY,
        scope: STATE_VARIABLE_SCOPES.SELECTABLE,
        runtimeSource,
        ...options,
    }),
]);

export const STATE_VARIABLES = Object.freeze([
    variableDefinition("match.elapsedSeconds", "Time Since Start", "number", { group: "General", min: 0, max: 99_999, defaultValue: 0, suffix: "s", step: 0.1, scope: STATE_VARIABLE_SCOPES.MATCH, runtimeSource: STATE_VARIABLE_SOURCES.MATCH_ELAPSED_SECONDS }),
    variableDefinition("selectable.distance", "Distance Between Entities", "number", { group: "Entity", min: 0, max: Math.hypot(ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS), supportsSelectable: true, selectableType: VARIABLE_SELECTABLE_TYPES.PAIR, pairSelectableIdentities: [[], []], defaultSelectable1: BOT_CODE_SELECTABLES.MY, defaultSelectable2: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_DISTANCE }),
    variableDefinition("selectable.hp", "Entity HP", "number", { group: "Entity", min: 0, max: 300, supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_HP }),
    variableDefinition("selectable.damageTakenLastTick", "Entity Damage Taken Last Tick", "number", { group: "Entity", min: 0, max: 300, suffix: "damage", supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_DAMAGE_TAKEN_LAST_TICK }),
    variableDefinition("selectable.hpNetChangeLastTick", "Entity Net HP Change Last Tick", "number", { group: "Entity", min: -300, max: 300, suffix: "HP", tags: [VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER], supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_HP_NET_CHANGE_LAST_TICK }),
    variableDefinition("selectable.x", "Entity X Position", "number", { group: "Position & Movement", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units", supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_X }),
    variableDefinition("selectable.y", "Entity Y Position", "number", { group: "Position & Movement", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units", supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_Y }),
    variableDefinition("selectable.alive", "Entity Alive", "boolean", { group: "Entity", supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_ALIVE }),
    variableDefinition("selectable.absoluteBearing", "Absolute Bearing of Target From Entity", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsSelectable: true, selectableType: VARIABLE_SELECTABLE_TYPES.PAIR, selectableSelectorLabels: ["Facing Entity", "Target"], pairSelectableIdentities: [[SELECTABLE_IDENTITIES.FACING], []], defaultSelectable1: BOT_CODE_SELECTABLES.MY, defaultSelectable2: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_ABSOLUTE_BEARING }),
    variableDefinition("selectable.movementDirection", "Entity Movement Direction", "number", { group: "Movement", min: -360, max: 360, suffix: "deg", supportsSelectable: true, defaultSelectable: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_MOVEMENT_DIRECTION }),
    variableDefinition("selectable.speed", "Entity Speed", "number", { group: "Movement", min: 0, max: 100, supportsSelectable: true, defaultSelectable: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_SPEED }),
    variableDefinition("selectable.relativeBearing", "Relative Bearing of Target From Entity (Shortest)", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", circularAngle: false, supportsSelectable: true, selectableType: VARIABLE_SELECTABLE_TYPES.PAIR, selectableSelectorLabels: ["Facing Entity", "Target"], pairSelectableIdentities: [[SELECTABLE_IDENTITIES.FACING], []], defaultSelectable1: BOT_CODE_SELECTABLES.MY, defaultSelectable2: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_RELATIVE_BEARING }),
    variableDefinition("selectable.relativeBearingClockwise", "Relative Bearing of Target From Entity (Clockwise)", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsSelectable: true, selectableType: VARIABLE_SELECTABLE_TYPES.PAIR, selectableSelectorLabels: ["Facing Entity", "Target"], pairSelectableIdentities: [[SELECTABLE_IDENTITIES.FACING], []], defaultSelectable1: BOT_CODE_SELECTABLES.MY, defaultSelectable2: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_RELATIVE_BEARING_CLOCKWISE }),
    variableDefinition("selectable.relativeBearingCounterclockwise", "Relative Bearing of Target From Entity (Counterclockwise)", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsSelectable: true, selectableType: VARIABLE_SELECTABLE_TYPES.PAIR, selectableSelectorLabels: ["Facing Entity", "Target"], pairSelectableIdentities: [[SELECTABLE_IDENTITIES.FACING], []], defaultSelectable1: BOT_CODE_SELECTABLES.MY, defaultSelectable2: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE }),
    variableDefinition("selectable.facing", "Entity Facing Direction", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsSelectable: true, selectableIdentities: [SELECTABLE_IDENTITIES.FACING], defaultSelectable: BOT_CODE_SELECTABLES.OPPONENT, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_FACING }),
    variableDefinition("selectable.count", "Ability Entity Type Count", "number", { group: "Ability Entity", min: 0, max: 100, step: 1, supportsSelectable: true, selectableIdentities: [SELECTABLE_IDENTITIES.ABILITY_ENTITY], selectableOrderable: false, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_COUNT }),
    variableDefinition("selectable.age", "Ability Entity Age (seconds)", "number", { group: "Ability Entity", suffix: "s", step: 0.1, min: 0, max: 120, supportsSelectable: true, selectableIdentities: [SELECTABLE_IDENTITIES.ABILITY_ENTITY], scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_AGE }),
    variableDefinition("selectable.edgeDistance", "Entity Distance From Edge", "number", { group: "Entity", min: 0, max: 500, supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_EDGE_DISTANCE }),
    variableDefinition("selectable.closingZoneEdgeDistance", "Entity Distance To Closing Zone Edge", "number", { group: "Entity", min: -1200, max: 1200, tags: [VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER], supportsSelectable: true, scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE }),
    ...GENERIC_ABILITY_VARIABLES,
    ...GENERIC_STATUS_VARIABLES,
    variableDefinition("selectable.exists", "Ability Entity Exists", "boolean", { group: "Ability Entity", supportsSelectable: true, selectableIdentities: [SELECTABLE_IDENTITIES.ABILITY_ENTITY], scope: STATE_VARIABLE_SCOPES.SELECTABLE, runtimeSource: STATE_VARIABLE_SOURCES.SELECTABLE_EXISTS }),
]);
export const STATE_VARIABLE_BY_ID = new Map(STATE_VARIABLES.map((variable) => [variable.id, variable]));
export const VISIBLE_STATE_VARIABLES = STATE_VARIABLES;
export function abilityDefinitionsForVariable(variable, equippedAbilityIds) {
    const equipped = equippedAbilityIds instanceof Set ? equippedAbilityIds : new Set(equippedAbilityIds ?? []);
    return ALL_ABILITY_DEFINITIONS.filter((ability) => equipped.has(ability.id)
        && (!variable?.requiredTag || ability.tags.includes(variable.requiredTag)));
}

export function variableDefinition(id, label, valueType, options = {}) {
    return {
        id,
        label,
        valueType,
        angle: options.angle ?? options.suffix === "deg",
        circularAngle: options.circularAngle ?? (options.angle ?? options.suffix === "deg"),
        defaultValue: valueType === "boolean" ? true : 50,
        min: valueType === "number" ? 0 : undefined,
        max: valueType === "number" ? 100 : undefined,
        step: valueType === "number" ? 0.1 : undefined,
        tags: [],
        ...options,
    };
}

export function variableHasTag(variable, tag) {
    return Array.isArray(variable?.tags) && variable.tags.includes(tag);
}

export function defaultAbilityForVariable(variable) {
    return variable?.abilityOptions?.[0]?.id
        ?? abilityDefinitionsForVariable(variable, ALL_ABILITY_DEFINITIONS.map((ability) => ability.id))[0]?.id
        ?? ALL_ABILITY_DEFINITIONS[0]?.id ?? 1;
}

export function defaultStatusEffectForVariable(variable) {
    return variable?.statusEffectOptions?.[0]?.id ?? null;
}

export function defaultSelectablePairForVariable(variable, selectableTypes = SELECTABLE_TYPES) {
    const available = Array.isArray(selectableTypes) ? selectableTypes : SELECTABLE_TYPES;
    const fallbackFirst = variable?.defaultSelectable1 ?? BOT_CODE_SELECTABLES.MY;
    const fallbackSecond = variable?.defaultSelectable2 ?? BOT_CODE_SELECTABLES.OPPONENT;
    const isAvailableForSlot = (selectableId, pairSlot) => {
        const base = String(selectableId ?? "").split(":")[0];
        const selectable = available.find((candidate) => candidate.id === base);
        return selectable && selectableMatchesVariable(selectable, variable, pairSlot);
    };
    const first = isAvailableForSlot(fallbackFirst, 0)
        ? fallbackFirst
        : available.find((selectable) => isAvailableForSlot(selectable.id, 0))?.id ?? fallbackFirst;
    const second = isAvailableForSlot(fallbackSecond, 1)
        ? fallbackSecond
        : available.find((selectable) => selectable.id !== first && isAvailableForSlot(selectable.id, 1))?.id ?? fallbackSecond;
    return [
        first,
        second,
    ];
}

function abilityActionDefinition(ability, actionId) {
    const contract = abilityContract(ability.id);
    const entity = entityContractForAbility(ability.id);
    const movementConfig = Boolean(contract?.execution?.movement);
    const locationTarget = entity?.spawn?.mode === "target";
    return {
        id: actionId,
        label: `Ability: ${ability.label}`,
        head: "ability",
        targetMode: contract?.execution?.targetMode ?? (locationTarget ? "target" : null),
        coordinateTarget: movementConfig || locationTarget,
        locationTarget,
        movementConfig,
        orientationConfig: Boolean(contract?.execution?.phaseFacingDefault),
    };
}

function selectableDefinitionsForAbility(ability) {
    const entity = entityContractForAbility(ability.id);
    if (!entity) return [];
    const owners = entity.targeting?.owner === SELECTABLE_OWNERS.NONE
        ? [SELECTABLE_OWNERS.NONE]
        : [SELECTABLE_OWNERS.OPPONENT, SELECTABLE_OWNERS.MY];
    return owners.map((owner) => ({
        id: owner === SELECTABLE_OWNERS.NONE ? entity.entityType : `${owner}_${entity.entityType}`,
        label: owner === SELECTABLE_OWNERS.NONE
            ? ability.label
            : `${ability.label} by ${owner === SELECTABLE_OWNERS.MY ? "My Bot" : "Opponent"}`,
        abilityId: ability.id,
        owner,
        kind: "entity",
        entityType: entity.entityType,
        runtimeType: entity.runtimeType,
        healthBearing: Boolean(entity.health && entity.collider?.hittable),
        selectableIdentities: ability.selectableIdentities,
        tags: ability.tags,
    }));
}
