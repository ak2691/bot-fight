// The inline action editor's model (mockup section 6). Pure: which targets an action supports, which settings it has
// (the same contract metadata the old side panel read: movementConfig, coordinateTarget, angleTarget, orientationConfig,
// the aim rules and the fast-turn and sprint switches), how a change lands in the card's entry, and the tile label
// ("Walk to enemy", "Face enemy", "Dash away"; an ability shows its name).
import { ACTION_BY_ID, ACTION_HEADS, BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { COORDINATE_LIMITS } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { actionSupportsAim } from "../../../../../shared/engine/botlogic/code/runtime/actionRuntime.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { actionTargetMode } from "../nodes/actionNodePresentation.js";

export const DIRECTION_PRESETS = Object.freeze([
    { id: 0, label: "Toward" },
    { id: 90, label: "Strafe" },
    { id: 180, label: "Away" },
]);
const ANGLE_LIMIT = 360;
const DEFAULT_LEAD_SECONDS = 0.5;
const MAX_LEAD_SECONDS = 2;

const TARGET_LABELS = Object.freeze({ enemy: "Enemy", point: "Point", angle: "Angle" });
const AIM_OPTIONS = Object.freeze([{ id: "current", label: "Current" }, { id: "lead", label: "Lead" }, { id: "auto", label: "Auto" }]);

/** The targets an action supports, in the order the segmented control shows them. Empty when it takes none. */
export function targetOptionsFor(definition) {
    if (!definition) return [];
    const options = [];
    if (definition.movementConfig) {
        options.push("enemy", "point", "angle");
    } else if (definition.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET) {
        options.push("enemy");
        if (definition.coordinateTarget) options.push("point");
        if (definition.angleTarget) options.push("angle");
    } else if (definition.head === ACTION_HEADS.ABILITY || definition.head === ACTION_HEADS.DASH) {
        if (definition.targetMode || definition.locationTarget) options.push("enemy");
        if (definition.coordinateTarget) options.push("point");
    }
    return options.map((id) => ({ id, label: TARGET_LABELS[id] }));
}

/** The target an entry aims at now: "enemy", "point", "angle", or null when the action takes none. */
export function targetOf(entry, definition) {
    const mode = actionTargetMode(entry, definition);
    if (mode === null) return null;
    if (mode === "coordinates") return "point";
    if (mode === "absolute" || mode === "angle") return "angle";
    return "enemy";
}

const numberField = (key, label, value, extra = {}) => ({ key, kind: "number", label, value, ...extra });

/**
 * The fields the editor shows, in order, for one card's action. `target` is a segmented control (only when there is a
 * choice); Point and Angle add their number boxes after it. Every other field is a switch, a segmented choice or a
 * number. Keys are the names `applyEditorField` understands.
 */
export function editorFields(entry, definition, { customVariables = [], leadAbilityChoices = [] } = {}) {
    if (!definition) return [];
    const fields = [];
    const options = targetOptionsFor(definition);
    const target = targetOf(entry, definition);
    if (options.length > 1) fields.push({ key: "target", kind: "segmented", label: "Target", value: target, options });
    const limits = { min: COORDINATE_LIMITS.minimum, max: COORDINATE_LIMITS.maximum, step: 1 };
    if (target === "point") {
        fields.push(numberField("targetX", "X", entry.targetX ?? 0, limits));
        fields.push(numberField("targetY", "Y", entry.targetY ?? 0, limits));
    }
    if (target === "angle") {
        const key = definition.movementConfig ? "movementDirection" : "targetAngle";
        const value = definition.movementConfig ? Number(entry.movementDirection ?? 0) : Number(entry.targetAngle ?? 0);
        fields.push(numberField(key, "Angle", value, { min: -ANGLE_LIMIT, max: ANGLE_LIMIT, step: 1, unit: "deg" }));
    }
    if (definition.movementConfig && target !== "angle") {
        const direction = Number(entry.movementDirection ?? 0);
        fields.push({ key: "movementDirection", kind: "segmented", label: "Direction", value: direction, options: DIRECTION_PRESETS });
        if (!DIRECTION_PRESETS.some((preset) => preset.id === direction)) {
            fields.push(numberField("movementDirection", "Degrees", direction, { min: -ANGLE_LIMIT, max: ANGLE_LIMIT, step: 1, unit: "deg" }));
        }
    }
    if (definition.movementConfig) fields.push({ key: "sprint", kind: "switch", label: "Sprint", value: entry.sprint === true });
    if (definition.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET) fields.push({ key: "fastTurn", kind: "switch", label: "Fast turn", value: entry.fastTurn === true });
    // Aim: abilities aimed at an entity (Current, Lead with a seconds box, or Auto, which leads by the ability's own
    // projectile travel), and Face actions (projectiles fire along facing, so a Face leads the shot). A Face's Auto names
    // one of the loadout's projectile abilities; without any, Auto is not offered.
    const isFace = definition.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET;
    if (target === "enemy" && (isFace || (definition.head === ACTION_HEADS.ABILITY && actionSupportsAim(definition)))) {
        const aim = entry.aim === "lead" || entry.aim === "auto" ? entry.aim : "current";
        const options = isFace && leadAbilityChoices.length === 0 ? AIM_OPTIONS.filter((option) => option.id !== "auto") : AIM_OPTIONS;
        fields.push({ key: "aim", kind: "segmented", label: "Aim", value: aim, options });
        if (aim === "lead") fields.push(numberField("leadSeconds", "Lead", entry.leadSeconds ?? DEFAULT_LEAD_SECONDS, { min: 0, max: MAX_LEAD_SECONDS, step: 0.1, unit: "s" }));
        if (aim === "auto" && isFace) {
            fields.push({ key: "leadAbilityId", kind: "select", label: "Ability", value: entry.leadAbilityId ?? null, options: leadAbilityChoices });
        }
    }
    if (definition.orientationConfig) {
        fields.push(numberField("phaseFacingMode", "Landing", Number(entry.phaseFacingMode) || 0, { min: -ANGLE_LIMIT, max: ANGLE_LIMIT, step: 1, unit: "deg" }));
    }
    if (definition.variableAction) {
        const variable = customVariables.find((candidate) => candidate.id === entry.variableId);
        if (variable?.valueType === "boolean") {
            fields.push({ key: "variableValue", kind: "switch", label: variable.name, value: entry.value === true });
        } else if (variable && entry.terms?.length === 1 && entry.terms[0].operand?.type === "number") {
            fields.push(numberField("variableValue", variable.name, Number(entry.terms[0].operand.value) || 0, { step: 1 }));
        }
    }
    return fields;
}

/** The entry after one field changed. Unknown keys leave the entry as it is. */
export function applyEditorField(entry, definition, key, value, { customVariables = [], defaultLeadAbilityId = null } = {}) {
    switch (key) {
        case "target": return applyTarget(entry, definition, value);
        case "targetX":
        case "targetY":
        case "targetAngle":
        case "phaseFacingMode":
            return { ...entry, [key]: Number(value) || 0 };
        case "movementDirection":
            return { ...entry, movementDirection: Number(value) || 0 };
        case "sprint":
            return withSwitch(entry, "sprint", value);
        case "fastTurn":
            return withSwitch(entry, "fastTurn", value);
        case "aim": {
            const { aim: _aim, leadSeconds: _lead, leadAbilityId: _leadAbility, ...rest } = entry;
            if (value === "lead") return { ...rest, aim: "lead", leadSeconds: entry.leadSeconds ?? DEFAULT_LEAD_SECONDS };
            // Auto on an ability names the ability itself; on a Face it names the chosen projectile (defaultLeadAbilityId).
            const abilityId = definition?.abilityId ?? defaultLeadAbilityId;
            if (value === "auto" && abilityId != null) return { ...rest, aim: "auto", leadAbilityId: abilityId };
            return rest;
        }
        case "leadAbilityId": {
            const abilityId = Number(value);
            return Number.isInteger(abilityId) && abilityId > 0 ? { ...entry, leadAbilityId: abilityId } : entry;
        }
        case "leadSeconds":
            return { ...entry, leadSeconds: Math.max(0, Math.min(MAX_LEAD_SECONDS, Number(value) || 0)) };
        case "variableValue": {
            const variable = customVariables.find((candidate) => candidate.id === entry.variableId);
            if (variable?.valueType === "boolean") return { ...entry, value: value === true };
            return { ...entry, terms: [{ operator: "set", operand: { type: "number", value: Number(value) || 0 } }] };
        }
        default:
            return entry;
    }
}

/** A switch is stored only when on, so an entry without it stays as it was. */
function withSwitch(entry, key, on) {
    const { [key]: _previous, ...rest } = entry;
    return on ? { ...rest, [key]: true } : rest;
}

function applyTarget(entry, definition, target) {
    const selectable = entry.selectable ?? BOT_CODE_SELECTABLES.OPPONENT;
    const withPoint = target === "point" ? { targetX: entry.targetX ?? 0, targetY: entry.targetY ?? 0 } : {};
    if (definition?.movementConfig) {
        const movementMode = target === "point" ? "coordinates" : target === "angle" ? "absolute" : "target";
        return { ...entry, movementMode, selectable, ...withPoint };
    }
    if (definition?.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET) {
        const targetMode = target === "point" ? "coordinates" : target === "angle" ? "angle" : "target";
        return {
            ...entry,
            targetMode,
            selectable,
            ...withPoint,
            ...(target === "angle" ? { targetAngle: entry.targetAngle ?? 0 } : {}),
        };
    }
    return { ...entry, targetMode: target === "point" ? "coordinates" : "target", selectable, ...withPoint };
}

/** The tile label: an ability's name; a plain action's verb with its short target ("Walk to enemy", "Face point"). */
export function actionTileLabel(entry, definition, { customVariables = [] } = {}) {
    if (!definition) return "Pick an action";
    if (definition.abilityId != null) return abilityDefinition(definition.abilityId)?.label ?? definition.label;
    if (definition.variableAction) {
        const name = customVariables.find((variable) => variable.id === entry?.variableId)?.name;
        return name ? `Set ${name}` : "Set variable";
    }
    if (definition.id === BOT_CODE_ACTIONS.CANCEL_WINDUP) return "Cancel wind-up";
    const target = targetOf(entry, definition);
    if (definition.id === BOT_CODE_ACTIONS.MOVE_WALK) {
        if (target === "point") return "Walk to point";
        if (target === "angle") return "Walk at angle";
        const direction = Number(entry?.movementDirection ?? 0);
        if (direction === 180) return "Walk away from enemy";
        return direction === 0 ? "Walk to enemy" : "Walk around enemy";
    }
    if (definition.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET) {
        if (target === "point") return "Face point";
        if (target === "angle") return "Face angle";
        return "Face enemy";
    }
    return definition.label;
}

/** The action's definition from the contract, or undefined. */
export function definitionOf(actionId) {
    return ACTION_BY_ID.get(actionId);
}
