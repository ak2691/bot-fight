import { abilityContract } from "../../../gameconfig/AbilityContracts.js";
import { entityContractForAbility } from "../../../ecs/contracts/EntityContracts.js";
import { ABILITY_TAGS, ALL_ABILITY_DEFINITIONS, entityTargetDefinitions } from "../../../loadout/BotLoadout.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../../modelPayloads/arenaConstants.js";

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

export const BOT_CODE_TARGETS = Object.freeze({
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
    MY: "my",
    OPPONENT: "opponent",
    TARGET: "target",
});

export const STATE_VARIABLE_SOURCES = Object.freeze({
    MATCH_ELAPSED_SECONDS: "matchElapsedSeconds",
    BOT_HP: "botHp",
    BOT_DAMAGE_TAKEN_LAST_TICK: "botDamageTakenLastTick",
    BOT_HP_NET_CHANGE_LAST_TICK: "botHpNetChangeLastTick",
    BOT_X: "botX",
    BOT_Y: "botY",
    TARGET_DISTANCE: "targetDistance",
    TARGET_HP: "targetHp",
    TARGET_BEARING_FROM_ME: "targetBearingFromMe",
    TARGET_MOVEMENT_DIRECTION: "targetMovementDirection",
    TARGET_SPEED: "targetSpeed",
    BEARING_FROM_TARGET: "bearingFromTarget",
    TARGET_RELATIVE_BEARING: "targetRelativeBearing",
    TARGET_RELATIVE_BEARING_CLOCKWISE: "targetRelativeBearingClockwise",
    TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE: "targetRelativeBearingCounterclockwise",
    TARGET_FACING: "targetFacing",
    TARGET_COUNT: "targetCount",
    TARGET_AGE: "targetAge",
    BOT_EDGE_DISTANCE: "botEdgeDistance",
    TARGET_EDGE_DISTANCE: "targetEdgeDistance",
    BOT_CLOSING_ZONE_EDGE_DISTANCE: "botClosingZoneEdgeDistance",
    TARGET_EXISTS: "targetExists",
    TARGET_ALIVE: "targetAlive",
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

export const TARGET_CAPABILITIES = Object.freeze({
    HEALTH: "health",
});

export const TARGET_OWNERS = Object.freeze({
    MY: "my",
    OPPONENT: "opponent",
    NONE: "none",
});

export const TARGET_ORDERS = Object.freeze(["closest", "farthest", "oldest", "newest"]);
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

const ENTITY_TARGET_DEFINITIONS = entityTargetDefinitions();
export const TARGET_TYPES = Object.freeze([
    { id: BOT_CODE_TARGETS.OPPONENT, label: "Opponent 1", owner: TARGET_OWNERS.OPPONENT, kind: "bot", healthBearing: true },
    ...ENTITY_TARGET_DEFINITIONS.flatMap((ability) => targetDefinitionsForAbility(ability)),
]);
export const TARGET_BY_ID = new Map(TARGET_TYPES.map((target) => [target.id, target]));

const GENERIC_ABILITY_STATE_VARIABLES = [
    ["selectedAbilityReady", "Ability Ready", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_READY, {}],
    ["selectedAbilityActive", "Ability Active", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE, {}],
    ["selectedAbilityOnCooldown", "Ability On Cooldown", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ON_COOLDOWN, {}],
    ["selectedAbilityActiveMs", "Ability Active Time", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE_MS, { min: 0, max: 60, suffix: "s", step: 0.1 }],
    ["selectedAbilityCooldownMs", "Ability Cooldown", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_COOLDOWN_MS, { min: 0, max: 60, suffix: "s", step: 0.1 }],
    ["selectedAbilityCharges", "Ability Charges", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_CHARGES, { min: 0, max: 100, step: 1, requiredTag: ABILITY_TAGS.CHARGES }],
    ["selectedAbilityPreparing", "Ability Preparing", "boolean", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARING, { requiredTag: "wind-up" }],
    ["selectedAbilityPreparationMs", "Ability Preparation Time Left", "number", STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARATION_MS, { min: 0, max: 10, suffix: "s", step: 0.1, requiredTag: "wind-up" }],
].flatMap(([field, label, valueType, runtimeSource, options]) => [
    variableDefinition(`my.${field}`, `My ${label}`, valueType, { group: "My Bot", supportsAbility: true, abilityOwner: "my", scope: STATE_VARIABLE_SCOPES.MY, runtimeSource, ...options }),
    variableDefinition(`opponent.${field}`, `Opponent 1 ${label}`, valueType, { group: "Opponent", supportsAbility: true, abilityOwner: "opponent", scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource, ...options }),
]);

const GENERIC_STATUS_VARIABLES = [
    ["selectedStatusEffectActive", "Status Effect", "boolean", STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_ACTIVE, {}],
    ["selectedStatusEffectDurationMs", "Status Effect Duration", "number", STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_DURATION_MS, { min: 0, max: 60, suffix: "s", step: 0.1 }],
].flatMap(([field, label, valueType, runtimeSource, options]) => [
    variableDefinition(`my.${field}`, `My ${label}`, valueType, { group: "My Bot", supportsStatusEffect: true, statusEffectOwner: "opponent", scope: STATE_VARIABLE_SCOPES.MY, runtimeSource, ...options }),
    variableDefinition(`opponent.${field}`, `Opponent 1 ${label}`, valueType, { group: "Opponent", supportsStatusEffect: true, statusEffectOwner: "my", scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource, ...options }),
]);

export const STATE_VARIABLES = Object.freeze([
    variableDefinition("match.elapsedSeconds", "Time Since Start", "number", { group: "General", min: 0, max: 99_999, defaultValue: 0, suffix: "s", step: 0.1, scope: STATE_VARIABLE_SCOPES.MATCH, runtimeSource: STATE_VARIABLE_SOURCES.MATCH_ELAPSED_SECONDS }),
    variableDefinition("my.hp", "My HP", "number", { group: "My Bot", min: 0, max: 100, scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_HP }),
    variableDefinition("my.damageTakenLastTick", "My Damage Taken Last Tick", "number", { group: "My Bot", min: 0, max: 300, suffix: "damage", scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_DAMAGE_TAKEN_LAST_TICK }),
    variableDefinition("my.hpNetChangeLastTick", "My Net HP Change Last Tick", "number", { group: "My Bot", min: -300, max: 300, suffix: "HP", tags: [VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER], scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_HP_NET_CHANGE_LAST_TICK }),
    variableDefinition("my.x", "My X Position", "number", { group: "My Bot", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units", scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_X }),
    variableDefinition("my.y", "My Y Position", "number", { group: "My Bot", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units", scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_Y }),
    variableDefinition("opponent.hp", "Opponent HP", "number", { group: "Opponent", min: 0, max: 100, scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource: STATE_VARIABLE_SOURCES.BOT_HP }),
    variableDefinition("opponent.damageTakenLastTick", "Opponent Damage Taken Last Tick", "number", { group: "Opponent", min: 0, max: 300, suffix: "damage", scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource: STATE_VARIABLE_SOURCES.BOT_DAMAGE_TAKEN_LAST_TICK }),
    variableDefinition("opponent.hpNetChangeLastTick", "Opponent Net HP Change Last Tick", "number", { group: "Opponent", min: -300, max: 300, suffix: "HP", tags: [VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER], scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource: STATE_VARIABLE_SOURCES.BOT_HP_NET_CHANGE_LAST_TICK }),
    variableDefinition("opponent.x", "Opponent X Position", "number", { group: "Opponent", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units", scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource: STATE_VARIABLE_SOURCES.BOT_X }),
    variableDefinition("opponent.y", "Opponent Y Position", "number", { group: "Opponent", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units", scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource: STATE_VARIABLE_SOURCES.BOT_Y }),
    variableDefinition("target.distance", "Target Distance", "number", { group: "Target", min: 0, max: 700, supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_DISTANCE }),
    variableDefinition("target.hp", "Target HP", "number", { group: "Target", min: 0, max: 300, supportsTarget: true, targetCapability: TARGET_CAPABILITIES.HEALTH, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_HP }),
    variableDefinition("target.alive", "Target Alive", "boolean", { group: "Target", supportsTarget: true, targetCapability: TARGET_CAPABILITIES.HEALTH, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_ALIVE }),
    variableDefinition("target.bearingFromMe", "Target Direction From Me", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_BEARING_FROM_ME }),
    variableDefinition("target.movementDirection", "Target Movement Direction", "number", { group: "Movement", min: -360, max: 360, suffix: "deg", supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_MOVEMENT_DIRECTION }),
    variableDefinition("target.speed", "Target Speed", "number", { group: "Movement", min: 0, max: 100, supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_SPEED }),
    variableDefinition("my.bearingFromTarget", "My Direction From Target", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.BEARING_FROM_TARGET }),
    variableDefinition("target.relativeBearing", "Target Bearing Difference (Shortest)", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", circularAngle: false, supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_RELATIVE_BEARING }),
    variableDefinition("target.relativeBearingClockwise", "Target Bearing Difference (Clockwise)", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_RELATIVE_BEARING_CLOCKWISE }),
    variableDefinition("target.relativeBearingCounterclockwise", "Target Bearing Difference (Counterclockwise)", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE }),
    variableDefinition("target.facing", "Target Facing", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, botTargetOnly: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_FACING }),
    variableDefinition("target.count", "Target Type Count", "number", { group: "Objects", min: 0, max: 100, step: 1, supportsTarget: true, targetGroup: "objects", targetOrderable: false, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_COUNT }),
    variableDefinition("target.age", "Target Age (seconds)", "number", { group: "Objects", suffix: "s", step: 0.1, min: 0, max: 120, supportsTarget: true, targetGroup: "objects", scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_AGE }),
    variableDefinition("my.edgeDistance", "My Distance From Edge", "number", { group: "My Bot", min: 0, max: 300, scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_EDGE_DISTANCE }),
    variableDefinition("my.closingZoneEdgeDistance", "My Distance To Closing Zone Edge", "number", { group: "My Bot", min: -1200, max: 1200, tags: [VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER], scope: STATE_VARIABLE_SCOPES.MY, runtimeSource: STATE_VARIABLE_SOURCES.BOT_CLOSING_ZONE_EDGE_DISTANCE }),
    variableDefinition("opponent.closingZoneEdgeDistance", "Opponent Distance To Closing Zone Edge", "number", { group: "Opponent", min: -1200, max: 1200, tags: [VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER], scope: STATE_VARIABLE_SCOPES.OPPONENT, runtimeSource: STATE_VARIABLE_SOURCES.BOT_CLOSING_ZONE_EDGE_DISTANCE }),
    variableDefinition("target.edgeDistance", "Target Distance From Edge", "number", { group: "Target", min: 0, max: 300, supportsTarget: true, scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_EDGE_DISTANCE }),
    ...GENERIC_ABILITY_STATE_VARIABLES,
    ...GENERIC_STATUS_VARIABLES,
    variableDefinition("target.exists", "Target Exists", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects", scope: STATE_VARIABLE_SCOPES.TARGET, runtimeSource: STATE_VARIABLE_SOURCES.TARGET_EXISTS }),
]);
export const STATE_VARIABLE_BY_ID = new Map(STATE_VARIABLES.map((variable) => [variable.id, variable]));
export function abilityDefinitionsForVariable(variable, equippedAbilityIds) {
    const equipped = equippedAbilityIds instanceof Set ? equippedAbilityIds : new Set(equippedAbilityIds ?? []);
    return ALL_ABILITY_DEFINITIONS.filter((ability) => equipped.has(ability.id)
        && (!variable?.requiredTag || ability.tags.includes(variable.requiredTag)));
}

export function variableDefinition(id, label, valueType, options = {}) {
    return {
        id,
        label: numberedOpponentLabel(label),
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

function targetDefinitionsForAbility(ability) {
    const entity = entityContractForAbility(ability.id);
    if (!entity) return [];
    const owners = entity.targeting?.owner === TARGET_OWNERS.NONE
        ? [TARGET_OWNERS.NONE]
        : [TARGET_OWNERS.OPPONENT, TARGET_OWNERS.MY];
    return owners.map((owner) => ({
        id: owner === TARGET_OWNERS.NONE ? entity.entityType : `${owner}_${entity.entityType}`,
        label: owner === TARGET_OWNERS.NONE
            ? ability.label
            : `${ability.label} by ${owner === TARGET_OWNERS.MY ? "My Bot" : "Opponent 1"}`,
        abilityId: ability.id,
        owner,
        kind: "entity",
        entityType: entity.entityType,
        runtimeType: entity.runtimeType,
        healthBearing: Boolean(entity.health),
        tags: ability.tags,
    }));
}

function numberedOpponentLabel(label) {
    return String(label).replace(/^Opponent(?: 1)?\b/, "Opponent 1");
}
