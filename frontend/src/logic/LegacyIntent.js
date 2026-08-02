// Migration-only translation for brains created before the tree schema.
export const INTENT_TYPES = Object.freeze([
    "none",
    "engage_target",
    "disengage_target",
    "orbit_target",
    "seek_object",
    "avoid_object",
    "reposition",
    "hold_position",
    "attack_target",
    "defend_against_target",
]);

export const INTENT_TARGET_TYPES = Object.freeze([
    "none",
    "opponent",
    "opponent_grenade",
    "opponent_fireball",
]);

export const MOVEMENT_STYLE_TYPES = Object.freeze([
    "none",
    "direct_in",
    "direct_out",
    "tangent_left",
    "tangent_right",
    "diagonal_in_left",
    "diagonal_in_right",
    "diagonal_out_left",
    "diagonal_out_right",
    "center",
    "north",
    "south",
    "east",
    "west",
    "northeast",
    "northwest",
    "southeast",
    "southwest",
    "stop",
]);

export const DEFAULT_INTENT = Object.freeze({
    intent: "hold_position",
    target: "none",
    movementStyle: "stop",
    dash: 0,
});

export const INTENT_FEATURE_SIZE = INTENT_TYPES.length
    + INTENT_TARGET_TYPES.length
    + MOVEMENT_STYLE_TYPES.length
    + 1;

const TARGET_SET = new Set(INTENT_TARGET_TYPES);
const MOVEMENT_STYLE_BY_ACTION = Object.freeze({
    move_inward: "direct_in",
    move_outward: "direct_out",
    move_tangent_left: "tangent_left",
    move_tangent_right: "tangent_right",
    move_diagonal_in_left: "diagonal_in_left",
    move_diagonal_in_right: "diagonal_in_right",
    move_diagonal_out_left: "diagonal_out_left",
    move_diagonal_out_right: "diagonal_out_right",
    move_center: "center",
    move_north: "north",
    move_south: "south",
    move_east: "east",
    move_west: "west",
    move_northeast: "northeast",
    move_northwest: "northwest",
    move_southeast: "southeast",
    move_southwest: "southwest",
    move_stop: "stop",
    dash: "direct_in",
    dash_outward: "direct_out",
    dash_tangent_left: "tangent_left",
    dash_tangent_right: "tangent_right",
    dash_diagonal_in_left: "diagonal_in_left",
    dash_diagonal_in_right: "diagonal_in_right",
    dash_diagonal_out_left: "diagonal_out_left",
    dash_diagonal_out_right: "diagonal_out_right",
    dash_north: "north",
    dash_south: "south",
    dash_east: "east",
    dash_west: "west",
    dash_northeast: "northeast",
    dash_northwest: "northwest",
    dash_southeast: "southeast",
    dash_southwest: "southwest",
});

export function intentFromAction(actionId, actionTarget = "opponent") {
    const target = normalizeIntentTarget(actionTarget);
    const objectTarget = target === "opponent_grenade"
        || target === "opponent_fireball";
    const movementStyle = MOVEMENT_STYLE_BY_ACTION[actionId] ?? "stop";
    const dash = actionId?.startsWith("dash") ? 1 : 0;

    if (actionId === "move_center") {
        return { intent: "reposition", target: "none", movementStyle, dash };
    }
    if (movementStyle === "north" || movementStyle === "south"
        || movementStyle === "east" || movementStyle === "west"
        || movementStyle === "northeast" || movementStyle === "northwest"
        || movementStyle === "southeast" || movementStyle === "southwest") {
        return { intent: "reposition", target: "none", movementStyle, dash };
    }
    if (actionId === "move_stop") {
        return { ...DEFAULT_INTENT };
    }
    if (actionId === "rotate_toward_enemy" || actionId === "swing" || actionId === "fire_gun" || actionId === "throw_grenade" || actionId === "shoot_fireball" || actionId === "stun") {
        return { intent: "attack_target", target, movementStyle: "stop", dash: 0 };
    }
    if (actionId === "block") {
        return { intent: "defend_against_target", target: "opponent", movementStyle: "stop", dash: 0 };
    }
    if (movementStyle === "direct_in" || movementStyle.startsWith("diagonal_in")) {
        return {
            intent: objectTarget ? "seek_object" : "engage_target",
            target,
            movementStyle,
            dash,
        };
    }
    if (movementStyle === "direct_out" || movementStyle.startsWith("diagonal_out")) {
        return {
            intent: objectTarget ? "avoid_object" : "disengage_target",
            target,
            movementStyle,
            dash,
        };
    }
    if (movementStyle.startsWith("tangent")) {
        return { intent: "orbit_target", target, movementStyle, dash };
    }

    return { ...DEFAULT_INTENT };
}

export function encodeIntentFeatures(intent = DEFAULT_INTENT) {
    const normalized = normalizeIntent(intent);
    const vector = new Float32Array(INTENT_FEATURE_SIZE);
    let offset = setOneHot(vector, 0, INTENT_TYPES, normalized.intent);
    offset = setOneHot(vector, offset, INTENT_TARGET_TYPES, normalized.target);
    offset = setOneHot(vector, offset, MOVEMENT_STYLE_TYPES, normalized.movementStyle);
    vector[offset] = normalized.dash ? 1 : 0;
    return vector;
}

function normalizeIntent(intent) {
    return {
        intent: INTENT_TYPES.includes(intent?.intent) ? intent.intent : DEFAULT_INTENT.intent,
        target: normalizeIntentTarget(intent?.target),
        movementStyle: MOVEMENT_STYLE_TYPES.includes(intent?.movementStyle)
            ? intent.movementStyle
            : DEFAULT_INTENT.movementStyle,
        dash: intent?.dash ? 1 : 0,
    };
}

function normalizeIntentTarget(target) {
    return TARGET_SET.has(target) ? target : "none";
}

function setOneHot(vector, offset, values, selected) {
    const index = Math.max(0, values.indexOf(selected));
    vector[offset + index] = 1;
    return offset + values.length;
}
