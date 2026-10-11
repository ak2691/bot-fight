// Generates shared/schemas/brain.schema.json (JSON Schema 2020-12) from the browser's brain contracts.
// Run: npm run schema:brain. A test fails when the committed file differs from this output.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    ACTION_TYPES,
    CHAIN_ACTION_TYPES,
    SELECTABLE_TYPES,
    STATE_VARIABLES,
} from "../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import {
    ABILITY_TAGS,
    ALL_ABILITY_DEFINITIONS,
    STANDARD_ABILITY_IDS,
    STATUS_EFFECT_DEFINITIONS,
} from "../../shared/engine/loadout/BotLoadout.js";
import { actionSupportsAim, actionSupportsTarget } from "../../shared/engine/botlogic/code/runtime/actionRuntime.js";
import { LINK_ID_PATTERN } from "../../shared/engine/botlogic/code/configuration/linkedActions.js";
import {
    CHAIN_MS_MAX, CHAIN_MS_STEP, MAX_CHAINS, MAX_CHAIN_NAME_LENGTH, MAX_CHAIN_STEPS, MAX_LEAD_SECONDS,
    MAX_LOGIC_BLOCKS, MAX_REPEAT_COUNT, MAX_ROOT_NAME_LENGTH, MAX_ROOT_NODES, MAX_TOTAL_CONDITIONS,
    MAX_CUSTOM_VARIABLE_SLOTS, MAX_VARIABLE_ACTION_TERMS, CUSTOM_NUMBER_MAX, CUSTOM_NUMBER_MIN,
    BOT_LOGIC_TREE_VERSION, COORDINATE_LIMITS,
} from "../../shared/engine/botlogic/code/configuration/constants.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../shared/engine/modelPayloads/arenaConstants.js";

export const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../shared/schemas/brain.schema.json");
const SCHEMA_ID = "https://botfight.dev/schemas/brain.schema.json";
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const MAX_NODES = MAX_LOGIC_BLOCKS + MAX_TOTAL_CONDITIONS;
const MAX_NODE_COORDINATE = 1_000_000;
const ORDERS = "closest|farthest|oldest|newest";
const ORDER_SUFFIX = `:(?:${ORDERS}):(?:[1-9][0-9]?|100)`;

// ------------------------------------------------------------------ selectables
const BOT_IDS = ["my_bot", "opponent", ...SELECTABLE_TYPES.filter((s) => s.kind === "bot").map((s) => s.id)];
const entitySelectables = SELECTABLE_TYPES.filter((s) => s.kind === "entity");
const unique = (list) => [...new Set(list)];

/** Regex source matching entity selectors (canonical and the legacy side-only forms) for the given entity types. */
function entityAlternation(entities) {
    const owned = unique(entities.filter((s) => s.owner !== "none").map((s) => s.entityType));
    const global = unique(entities.filter((s) => s.owner === "none").map((s) => s.id));
    const parts = [];
    if (owned.length) parts.push(`(?:my_bot|my|opponent|(?:opponent|teammate)_[1-7])_(?:${owned.join("|")})`);
    parts.push(...global);
    return parts.join("|");
}

function selectablePattern({ bots, entities, ordered }) {
    const alternatives = [];
    const entityRegex = entities.length ? entityAlternation(entities) : "";
    const botRegex = bots ? "my_bot|opponent|(?:opponent|teammate)_[1-7]" : "";
    const plain = [botRegex, entityRegex].filter(Boolean).join("|");
    alternatives.push(`^(?:${plain})$`);
    if (ordered && entityRegex) alternatives.push(`^(?:${entityRegex})${ORDER_SUFFIX}$`);
    return alternatives.length === 1 ? alternatives[0] : `(?:${alternatives.join(")|(?:")})`;
}

const hasIdentity = (entity, identity) => entity.selectableIdentities?.includes(identity);
const facingEntities = entitySelectables.filter((s) => hasIdentity(s, "facing"));

function selectableDefs() {
    const string = (pattern) => ({ type: "string", maxLength: 100, pattern });
    return {
        selectable: string(selectablePattern({ bots: true, entities: entitySelectables, ordered: true })),
        selectableUnordered: string(selectablePattern({ bots: true, entities: entitySelectables, ordered: false })),
        selectableBot: string(selectablePattern({ bots: true, entities: [], ordered: false })),
        selectableFacing: string(selectablePattern({ bots: true, entities: facingEntities, ordered: true })),
        selectableEntity: string(selectablePattern({ bots: false, entities: entitySelectables, ordered: true })),
        selectableEntityUnordered: string(selectablePattern({ bots: false, entities: entitySelectables, ordered: false })),
    };
}

function selectableRef(variable, slot = null) {
    const identities = slot == null
        ? variable.selectableIdentities ?? []
        : variable.pairSelectableIdentities?.[slot] ?? [];
    const ordered = variable.selectableOrderable !== false;
    if (identities.includes("bot")) return ref("selectableBot");
    if (identities.includes("ability-entity")) return ref(ordered ? "selectableEntity" : "selectableEntityUnordered");
    if (identities.includes("facing")) return ref("selectableFacing");
    return ref(ordered ? "selectable" : "selectableUnordered");
}

// ------------------------------------------------------------------ small building blocks
const num = (minimum, maximum) => ({ type: "number", minimum, maximum });
const int = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const idString = { type: "string", minLength: 1, maxLength: 160 };
const customId = { type: "string", pattern: "^custom\\.[A-Za-z0-9_.-]{1,52}$" };
const customNumber = num(CUSTOM_NUMBER_MIN, CUSTOM_NUMBER_MAX);
const abilityIds = ALL_ABILITY_DEFINITIONS.map((a) => a.id);
const statusIds = STATUS_EFFECT_DEFINITIONS.map((s) => s.id);
const numericStateIds = STATE_VARIABLES.filter((v) => v.valueType === "number").map((v) => v.id);
const variableOperandId = ref("anyVariableId");
const numberVariableId = ref("numberVariableId");
const pairIds = STATE_VARIABLES.filter((s) => s.selectableType).map((s) => s.id);
const singleSelectableIds = STATE_VARIABLES.filter((s) => s.supportsSelectable && !s.selectableType).map((s) => s.id);
const abilityVariableIds = STATE_VARIABLES.filter((s) => s.supportsAbility).map((s) => s.id);
const statusVariableIds = STATE_VARIABLES.filter((s) => s.supportsStatusEffect).map((s) => s.id);
const abilityEnumFor = (variable) => ref(`abilityFor_${(variable.requiredTag ?? "any").replace(/[^a-z]/gi, "_")}`);

function commonDefs() {
    const tags = unique(STATE_VARIABLES.filter((s) => s.supportsAbility).map((s) => s.requiredTag ?? "any"));
    return {
        stateVariableId: { enum: STATE_VARIABLES.map((s) => s.id) },
        anyVariableId: { anyOf: [{ enum: STATE_VARIABLES.map((s) => s.id) }, customId] },
        numberVariableId: { anyOf: [{ enum: numericStateIds }, customId] },
        pairVariableId: { enum: pairIds },
        singleSelectableVariableId: { enum: singleSelectableIds },
        abilityVariableId: { enum: abilityVariableIds },
        statusVariableId: { enum: statusVariableIds },
        ...Object.fromEntries(tags.map((tag) => [
            `abilityFor_${tag.replace(/[^a-z]/gi, "_")}`,
            { enum: ALL_ABILITY_DEFINITIONS.filter((a) => tag === "any" || a.tags.includes(tag)).map((a) => a.id) },
        ])),
        ...selectableDefs(),
        customNumber,
        customVariableId: customId,
        chainId: { type: "string", pattern: "^chain\\.[a-z0-9_-]{1,40}$" },
        ms: { type: "integer", minimum: CHAIN_MS_STEP, maximum: CHAIN_MS_MAX, multipleOf: CHAIN_MS_STEP },
        angle: num(-360, 360),
        abilityId: { enum: abilityIds },
        statusEffect: { enum: statusIds },
        variableOperand: {
            type: "object",
            required: ["type", "value"],
            allOf: [
                { if: { properties: { type: { const: "number" } } }, then: { properties: { value: customNumber } } },
                { if: { properties: { type: { const: "boolean" } } }, then: { properties: { value: { type: "boolean" } } } },
                {
                    if: { properties: { type: { const: "variable" } } },
                    then: { properties: { value: variableOperandId, selectable: ref("selectable") } },
                },
            ],
            properties: { type: { enum: ["number", "boolean", "variable"] }, value: {} },
            unevaluatedProperties: false,
        },
        variableTerm: {
            type: "object",
            required: ["operator", "operand"],
            properties: {
                operator: { enum: ["set", "add", "subtract", "modulo"] },
                operand: {
                    type: "object",
                    required: ["type", "value"],
                    allOf: [
                        { if: { properties: { type: { const: "number" } } }, then: { properties: { value: customNumber } } },
                        {
                            if: { properties: { type: { const: "variable" } } },
                            then: { properties: { value: numberVariableId, selectable: ref("selectable") } },
                        },
                    ],
                    properties: { type: { enum: ["number", "variable"] }, value: {} },
                    unevaluatedProperties: false,
                },
            },
            allOf: [{
                // Modulo works on whole numbers, so a literal below 1 in magnitude is a division by zero.
                if: { properties: { operator: { const: "modulo" }, operand: { properties: { type: { const: "number" } } } }, required: ["operator"] },
                then: { properties: { operand: { properties: { value: { not: { exclusiveMinimum: -1, exclusiveMaximum: 1 } } } } } },
            }],
            additionalProperties: false,
        },
        customVariable: {
            type: "object",
            required: ["id", "name", "valueType", "initialValue"],
            properties: {
                id: customId,
                name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9 _-]{0,39}$" },
                valueType: { enum: ["number", "boolean"] },
                initialValue: {},
            },
            allOf: [
                { if: { properties: { valueType: { const: "number" } } }, then: { properties: { initialValue: customNumber } } },
                { if: { properties: { valueType: { const: "boolean" } } }, then: { properties: { initialValue: { type: "boolean" } } } },
            ],
            additionalProperties: false,
        },
        loadout: {
            type: "object",
            required: ["abilities"],
            properties: {
                abilities: {
                    type: "array",
                    maxItems: 7,
                    uniqueItems: true,
                    items: { enum: abilityIds.filter((id) => !STANDARD_ABILITY_IDS.includes(id)) },
                },
            },
            additionalProperties: false,
        },
        nodePositions: {
            type: "object",
            maxProperties: 1000,
            propertyNames: { minLength: 1, maxLength: 200 },
            additionalProperties: {
                type: "object",
                required: ["x", "y"],
                properties: { x: num(0, MAX_NODE_COORDINATE), y: num(0, MAX_NODE_COORDINATE) },
                additionalProperties: false,
            },
        },
    };
}

// ------------------------------------------------------------------ brain tree definitions
function treeDefs() {
    const x = num(COORDINATE_LIMITS.minimum, COORDINATE_LIMITS.maximum);
    const y = num(-ARENA_HEIGHT_UNITS / 2, ARENA_HEIGHT_UNITS / 2);
    const xx = num(-ARENA_WIDTH_UNITS / 2, ARENA_WIDTH_UNITS / 2);
    const offset = num(-COORDINATE_LIMITS.offsetMagnitude, COORDINATE_LIMITS.offsetMagnitude);
    const defs = {};

    // ---- conditions
    const rightFields = {
        rightSelectable: ref("selectable"),
        rightSelectable1: ref("selectable"),
        rightSelectable2: ref("selectable"),
        rightTargetMode: { enum: ["target", "coordinates", "angle"] },
        rightTargetX: x,
        rightTargetY: x,
        rightTargetAngle: ref("angle"),
    };
    const rightIs = (idsRef) => ({
        properties: { right: { properties: { type: { const: "variable" }, value: ref(idsRef) }, required: ["type", "value"] } },
        required: ["right"],
    });

    // Common comparisons and RHS fields are shared definitions; each variable keeps its literal bounds.
    defs.numberComparator = { enum: ["lt", "lte", "eq", "neq", "gte", "gt"] };
    defs.booleanComparator = { enum: ["eq", "neq"] };
    defs.numberConditionRight = {
        type: "object",
        required: ["type", "value"],
        allOf: [{ if: { properties: { type: { const: "variable" } } }, then: { properties: { value: numberVariableId } } }],
        properties: { type: { enum: ["number", "variable"] }, value: {} },
        unevaluatedProperties: false,
    };
    defs.booleanConditionRight = {
        type: "object", required: ["type", "value"],
        properties: { type: { const: "boolean" }, value: { type: "boolean" } },
        additionalProperties: false,
    };
    defs.conditionRightPair = { if: rightIs("pairVariableId"), then: { properties: {
        ...Object.fromEntries(Object.entries(rightFields).filter(([key]) => key !== "rightSelectable")),
        selectable1: ref("selectable"),
    } } };
    defs.conditionRightSelectable = { if: rightIs("singleSelectableVariableId"), then: { properties: { rightSelectable: rightFields.rightSelectable } } };
    defs.conditionRightAbility = { if: rightIs("abilityVariableId"), then: { properties: { ability: ref("abilityId") }, required: ["ability"] } };
    defs.conditionRightStatusEffect = { if: rightIs("statusVariableId"), then: { properties: { statusEffect: ref("statusEffect") }, required: ["statusEffect"] } };

    function rangeFor(variable) {
        if (variable.id === "selectable.x") return xx;
        if (variable.id === "selectable.y") return y;
        return num(variable.min, variable.max);
    }

    function variableCondition(variable) {
        const isNumber = variable.valueType === "number";
        const properties = {
            comparator: ref(isNumber ? "numberComparator" : "booleanComparator"),
            right: isNumber
                ? { allOf: [ref("numberConditionRight"), {
                    if: { properties: { type: { const: "number" } } },
                    then: { properties: { value: rangeFor(variable) } },
                }] }
                : ref("booleanConditionRight"),
        };
        const allOf = [];
        if (variable.selectableType) {
            properties.selectable1 = selectableRef(variable, 0);
            properties.selectable2 = selectableRef(variable, 1);
            properties.selectable = ref("selectable");
            properties.leftSelectable = ref("selectable");
        } else if (variable.supportsSelectable) {
            properties.leftSelectable = selectableRef(variable);
            properties.selectable = selectableRef(variable);
        }
        if (variable.targetModes?.length) {
            properties.targetMode = { enum: variable.targetModes };
            properties.targetX = x;
            properties.targetY = x;
            if (variable.targetModes.includes("angle")) properties.targetAngle = ref("angle");
            allOf.push({
                if: { properties: { targetMode: { const: "coordinates" } }, required: ["targetMode"] },
                then: { required: ["targetX", "targetY"] },
            });
            if (variable.targetModes.includes("angle")) {
                allOf.push({
                    if: { properties: { targetMode: { const: "angle" } }, required: ["targetMode"] },
                    then: { required: ["targetAngle"] },
                });
            }
        }
        if (variable.supportsAbility) {
            properties.ability = abilityEnumFor(variable);
        }
        if (variable.supportsStatusEffect) properties.statusEffect = ref("statusEffect");
        if (isNumber) {
            // Fields of a compared-to state variable on the right-hand side.
            allOf.push(ref("conditionRightPair"), ref("conditionRightSelectable"));
            if (!variable.supportsAbility) allOf.push(ref("conditionRightAbility"));
            if (!variable.supportsStatusEffect) allOf.push(ref("conditionRightStatusEffect"));
        }
        const required = [];
        if (variable.supportsAbility) required.push("ability");
        if (variable.supportsStatusEffect) required.push("statusEffect");
        return {
            if: { properties: { left: { const: variable.id } }, required: ["left"] },
            then: { properties, ...(required.length ? { required } : {}), ...(allOf.length ? { allOf } : {}) },
        };
    }

    const customCondition = {
        if: { properties: { left: customId }, required: ["left"] },
        then: {
            properties: {
                comparator: ref("numberComparator"),
                right: {
                    type: "object",
                    required: ["type", "value"],
                    allOf: [
                        { if: { properties: { type: { const: "number" } } }, then: { properties: { value: customNumber } } },
                        { if: { properties: { type: { const: "boolean" } } }, then: { properties: { value: { type: "boolean" } } } },
                        { if: { properties: { type: { const: "variable" } } }, then: { properties: { value: numberVariableId } } },
                    ],
                    properties: { type: { enum: ["number", "boolean", "variable"] }, value: {} },
                    unevaluatedProperties: false,
                },
            },
            allOf: [
                { if: { properties: { right: { properties: { type: { const: "boolean" } } } }, required: ["right"] }, then: { properties: { comparator: ref("booleanComparator") } } },
                { if: { properties: { right: { properties: { type: { const: "variable" } } } }, required: ["right"] }, then: { properties: { rightSelectable: ref("selectable") } } },
            ],
        },
    };

    defs.condition = {
        type: "object",
        required: ["type"],
        properties: { type: { enum: ["always", "expression"] } },
        allOf: [
            { if: { properties: { type: { const: "always" } } }, then: { properties: { selectable: ref("selectable") } } },
            {
                if: { properties: { type: { const: "expression" } } },
                then: {
                    required: ["left", "comparator", "right"],
                    properties: { left: ref("anyVariableId") },
                    allOf: [...STATE_VARIABLES.map(variableCondition), customCondition],
                },
            },
        ],
        unevaluatedProperties: false,
    };
    defs.conditions = { type: "array", maxItems: MAX_TOTAL_CONDITIONS, items: ref("condition") };

    // ---- actions
    const actionDefs = [...ACTION_TYPES, ...CHAIN_ACTION_TYPES];
    const classKey = (a) => JSON.stringify([
        a.id === "move_walk" || a.id === "rotate_toward_enemy" || a.id === "none" || a.id === "variable"
            || a.id === "cancel_windup" || a.id === "run_chain" ? a.id : "ability",
        a.head, Boolean(a.movementConfig), Boolean(a.coordinateTarget), Boolean(a.angleTarget),
        Boolean(a.orientationConfig), Boolean(a.targetMode), Boolean(a.locationTarget),
    ]);
    const classes = new Map();
    for (const action of actionDefs) {
        const key = classKey(action);
        if (!classes.has(key)) classes.set(key, []);
        classes.get(key).push(action);
    }

    function actionClass(members, { chainStep }) {
        const sample = members[0];
        const ids = members.map((a) => a.id);
        const properties = { action: { enum: ids }, selectable: ref("selectable") };
        const allOf = [];
        if (sample.movementConfig) {
            properties.movementMode = { enum: ["target", "coordinates", "absolute"] };
            properties.movementDirection = {
                anyOf: [ref("angle"), { enum: ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "stop"] }],
            };
            allOf.push({
                if: { properties: { movementMode: { const: "coordinates" } }, required: ["movementMode"] },
                then: { required: ["targetX", "targetY"] },
            });
            allOf.push({
                if: { properties: { movementMode: { enum: ["target", "coordinates"] } }, required: ["movementMode"] },
                then: { properties: { movementDirection: ref("angle") } },
            });
        }
        if (sample.id === "move_walk") properties.sprint = { type: "boolean" };
        if (sample.id === "rotate_toward_enemy") properties.fastTurn = { type: "boolean" };
        if (sample.orientationConfig) properties.phaseFacingMode = ref("angle");
        if (actionSupportsTarget(sample) && !sample.movementConfig) {
            properties.targetOffsetX = offset;
            properties.targetOffsetY = offset;
        }
        if (sample.coordinateTarget) {
            properties.targetMode = { enum: sample.angleTarget ? ["target", "angle", "coordinates"] : ["target", "coordinates"] };
            properties.targetX = x;
            properties.targetY = x;
            allOf.push({
                if: { properties: { targetMode: { const: "coordinates" } }, required: ["targetMode"] },
                then: { required: ["targetX", "targetY"] },
            });
        }
        if (sample.angleTarget) {
            properties.targetAngle = ref("angle");
            allOf.push({
                if: { properties: { targetMode: { const: "angle" } }, required: ["targetMode"] },
                then: { required: ["targetAngle"] },
            });
        }
        if (actionSupportsAim(sample)) {
            properties.aim = { enum: ["current", "lead", "auto"] };
            properties.leadSeconds = num(0, MAX_LEAD_SECONDS);
            properties.leadAbilityId = ref("abilityId");
            allOf.push({ if: { properties: { aim: { const: "auto" } }, required: ["aim"] }, then: { required: ["leadAbilityId"] } });
        }
        if (sample.chainAction) {
            properties.chainId = ref("chainId");
            allOf.push({ required: ["chainId"] });
        }
        if (sample.variableAction) {
            properties.variableId = ref("customVariableId");
            properties.value = { anyOf: [{ type: "boolean" }, customNumber] };
            properties.operation = { enum: ["set", "add", "subtract", "modulo"] };
            properties.operand = ref("variableOperand");
            properties.terms = {
                type: "array", minItems: 1, maxItems: MAX_VARIABLE_ACTION_TERMS,
                prefixItems: [ref("variableTerm")],
                items: { allOf: [ref("variableTerm"), { properties: { operator: { enum: ["add", "subtract", "modulo"] } } }] },
            };
            allOf.push({ required: ["variableId"] });
            allOf.push({ anyOf: [{ required: ["value"] }, { required: ["operand"] }, { required: ["terms"] }] });
        }
        if (chainStep) {
            const timed = sample.head === "movement" || sample.head === "rotation";
            if (timed) {
                properties.forMs = ref("ms");
                properties.untilConditions = ref("conditions");
                properties.maxMs = ref("ms");
                allOf.push({
                    oneOf: [
                        { required: ["forMs"], not: { anyOf: [{ required: ["untilConditions"] }, { required: ["maxMs"] }] } },
                        { required: ["untilConditions", "maxMs"], not: { required: ["forMs"] } },
                    ],
                });
            } else if (sample.head === "ability" || sample.head === "dash") {
                properties.continue = { enum: ["end", "now"] };
            }
        }
        return { if: { properties: { action: { enum: ids } }, required: ["action"] }, then: { properties, ...(allOf.length ? { allOf } : {}) } };
    }

    const entryClasses = [...classes.values()];
    defs.actionFields = { allOf: entryClasses.map((members) => actionClass(members, { chainStep: false })) };
    const chainClasses = entryClasses.filter((members) => !["none", "run_chain"].includes(members[0].id));
    defs.chainActionFields = { allOf: chainClasses.map((members) => actionClass(members, { chainStep: true })) };
    const allActionIds = actionDefs.map((a) => a.id);
    const chainActionIds = chainClasses.flat().map((a) => a.id);
    defs.actionEntry = {
        type: "object",
        required: ["action"],
        // linkId: copies of one action wired under several parents (editor links; costs once in the budget).
        properties: { id: idString, action: { enum: allActionIds }, linkId: { type: "string", pattern: LINK_ID_PATTERN.source } },
        allOf: [ref("actionFields")],
        unevaluatedProperties: false,
    };
    defs.actions ={ type: "array", maxItems: MAX_LOGIC_BLOCKS, items: ref("actionEntry") };

    // ---- tree
    const branchCore = {
        type: "object",
        required: ["conditions"],
        properties: {
            id: idString,
            priority: int(1, MAX_LOGIC_BLOCKS),
            branchType: { enum: ["if", "else"] },
            conditions: ref("conditions"),
            children: ref("branches"),
            actions: ref("actions"),
            action: { enum: allActionIds },
        },
        allOf: [ref("actionFields")],
        anyOf: [{ required: ["action"] }, { required: ["actions"] }],
    };
    defs.branchCore = branchCore;
    defs.branch = { allOf: [ref("branchCore")], unevaluatedProperties: false };
    defs.branches = { type: "array", maxItems: MAX_NODES, items: ref("branch") };
    defs.root = {
        type: "object",
        properties: {
            id: idString,
            name: { type: "string", minLength: 1, maxLength: MAX_ROOT_NAME_LENGTH, pattern: "\\S" },
            priority: int(1, MAX_ROOT_NODES),
            branches: ref("branches"),
            actions: ref("actions"),
        },
        anyOf: [{ required: ["branches"] }, { required: ["actions"] }],
        additionalProperties: false,
    };
    defs.roots = { type: "array", maxItems: MAX_ROOT_NODES, items: ref("root") };

    // ---- orphans
    const orphanId = { type: "string", pattern: "^[A-Za-z0-9_:. -]{1,160}$" };
    defs.orphan = {
        type: "object",
        required: ["kind", "id"],
        properties: { kind: { enum: ["conditional", "action"] }, id: orphanId },
        allOf: [
            {
                if: { properties: { kind: { const: "conditional" } } },
                then: { allOf: [ref("branchCore")] },
            },
            {
                if: { properties: { kind: { const: "action" } } },
                then: { required: ["action"], properties: { action: { enum: allActionIds } }, allOf: [ref("actionFields")] },
            },
        ],
        unevaluatedProperties: false,
    };
    defs.orphans = { type: "array", maxItems: MAX_NODES, items: ref("orphan") };

    // ---- chains
    const timedStep = {
        oneOf: [
            { required: ["forMs"], not: { anyOf: [{ required: ["untilConditions"] }, { required: ["maxMs"] }] } },
            { required: ["untilConditions", "maxMs"], not: { required: ["forMs"] } },
        ],
    };
    defs.step = {
        type: "object",
        required: ["type"],
        properties: { type: { enum: ["action", "wait", "if", "elseIf", "repeat", "runChain", "exitLoop", "end"] } },
        allOf: [
            {
                if: { properties: { type: { const: "action" } } },
                then: { required: ["action"], properties: { id: idString, action: { enum: chainActionIds } }, allOf: [ref("chainActionFields")] },
            },
            {
                if: { properties: { type: { const: "wait" } } },
                then: { properties: { forMs: ref("ms"), untilConditions: ref("conditions"), maxMs: ref("ms") }, ...timedStep },
            },
            {
                if: { properties: { type: { enum: ["if", "elseIf"] } } },
                then: { required: ["conditions", "steps"], properties: { conditions: ref("conditions"), steps: ref("steps") } },
            },
            {
                if: { properties: { type: { const: "repeat" } } },
                then: {
                    required: ["steps"],
                    properties: {
                        count: int(1, MAX_REPEAT_COUNT), whileConditions: ref("conditions"), maxMs: ref("ms"), steps: ref("steps"),
                    },
                    oneOf: [
                        { required: ["count"], not: { anyOf: [{ required: ["whileConditions"] }, { required: ["maxMs"] }] } },
                        { required: ["whileConditions", "maxMs"], not: { required: ["count"] } },
                    ],
                },
            },
            {
                if: { properties: { type: { const: "runChain" } } },
                then: { required: ["chainId"], properties: { chainId: ref("chainId") } },
            },
        ],
        unevaluatedProperties: false,
    };
    defs.steps = { type: "array", maxItems: MAX_CHAIN_STEPS, items: ref("step") };
    defs.chain = {
        type: "object",
        required: ["id", "steps"],
        properties: {
            id: ref("chainId"),
            name: { type: "string", minLength: 1, maxLength: MAX_CHAIN_NAME_LENGTH, pattern: "\\S" },
            steps: ref("steps"),
            loose: {
                type: "array", maxItems: MAX_CHAIN_STEPS,
                items: {
                    type: "object", required: ["step", "x", "y"],
                    properties: { step: ref("step"), x: num(0, MAX_NODE_COORDINATE), y: num(0, MAX_NODE_COORDINATE) },
                    additionalProperties: false,
                },
            },
        },
        additionalProperties: false,
    };
    defs.chains = { type: "array", maxItems: MAX_CHAINS, items: ref("chain") };
    return defs;
}

export function buildBrainSchema() {
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: SCHEMA_ID,
        title: "Botfight brain",
        description: "The submitted logic-block configuration. Generated by frontend/scripts/generate-brain-schema.mjs; do not edit by hand.",
        type: "object",
        required: ["version", "roots"],
        properties: {
            version: { const: BOT_LOGIC_TREE_VERSION },
            roots: ref("roots"),
            orphans: ref("orphans"),
            chains: ref("chains"),
            customVariables: { type: "array", maxItems: MAX_CUSTOM_VARIABLE_SLOTS, items: ref("customVariable") },
            loadout: ref("loadout"),
            nodePositions: ref("nodePositions"),
        },
        additionalProperties: false,
        $defs: { ...commonDefs(), ...treeDefs() },
    };
}

/** Deterministic pretty JSON with small scalar arrays kept on one line for readable generated diffs. */
export function serializeBrainSchema(schema) {
    const render = (value, depth) => {
        const indent = "  ".repeat(depth);
        const childIndent = `${indent}  `;
        if (Array.isArray(value)) {
            const compact = JSON.stringify(value);
            if (value.every((entry) => entry === null || typeof entry !== "object") && indent.length + compact.length <= 120) {
                return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
            }
            return `[\n${value.map((entry) => `${childIndent}${render(entry, depth + 1)}`).join(",\n")}\n${indent}]`;
        }
        if (value && typeof value === "object") {
            const entries = Object.entries(value);
            if (!entries.length) return "{}";
            return `{\n${entries.map(([key, entry]) => `${childIndent}${JSON.stringify(key)}: ${render(entry, depth + 1)}`).join(",\n")}\n${indent}}`;
        }
        return JSON.stringify(value);
    };
    return `${render(schema, 0)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, serializeBrainSchema(buildBrainSchema()));
    console.log(`wrote ${OUTPUT_PATH}`);
}
