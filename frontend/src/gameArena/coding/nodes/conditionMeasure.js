// Editor-only presentation helpers for the condition panel. Nothing here changes how a
// condition is evaluated: stored variable IDs and their fields stay exactly as they are.

import { createExpressionCondition, defaultSelectableForVariable } from "../../botlogic/code/BotCode.js";
import { STATE_VARIABLE_BY_ID } from "../../botlogic/code/contracts/BotLogicContracts.js";

export const MOVE_DIRECTION_LABEL = "Move Direction";
const HEADING_ID = "selectable.movementDirection";
const TOWARD_ID = "selectable.approachAngle";
const MEASURE_VARIABLE_ID = Object.freeze({ heading: HEADING_ID, toward: TOWARD_ID });

export const MOVE_DIRECTION_MEASURES = Object.freeze([
    { id: "heading", label: "Heading" },
    { id: "toward", label: "Toward a target" },
]);

export const MOVE_DIRECTION_INFO = "Heading is the arena direction an entity moved last tick. "
    + "Toward a target is how far that movement is off the direction to a target, from 0 to 180 degrees: "
    + "0 is straight toward it, 180 straight away, and 90 sideways, not moving, or on top of it.";
export const MOVE_DIRECTION_TOWARD_INFO = "Move Direction toward a target is the angle between From's movement last tick and the direction from it to To, from 0 to 180 degrees. "
    + "0 means it is moving straight toward the target, 180 straight away, and 90 sideways, not moving, or on top of it. Pair it with Is Moving.";

/** "heading", "toward", or null when the variable is not one of the two Move Direction measures. */
export function moveDirectionMeasure(variableId) {
    if (variableId === HEADING_ID) return "heading";
    if (variableId === TOWARD_ID) return "toward";
    return null;
}

/** The label to show for a variable; a stored Approach Angle reads as Move Direction. */
export function conditionVariableLabel(definition) {
    return definition?.id === TOWARD_ID ? MOVE_DIRECTION_LABEL : definition?.label;
}

function clampedRight(right, definition) {
    if (right?.type !== "number") return right;
    const min = Number.isFinite(definition.min) ? definition.min : -Infinity;
    const max = Number.isFinite(definition.max) ? definition.max : Infinity;
    return { ...right, value: Math.min(max, Math.max(min, Number(right.value) || 0)) };
}

/**
 * The condition after switching Move Direction's Measure for one operand (1 = left variable,
 * 2 = the compared-to variable). Only the stored variable ID and its entity fields change.
 * A condition that is not on a Move Direction variable comes back untouched.
 */
export function switchMoveDirectionMeasure(condition, operand, measure, selectableTypes) {
    const targetId = MEASURE_VARIABLE_ID[measure];
    const target = STATE_VARIABLE_BY_ID.get(targetId);
    if (!target || condition?.type !== "expression") return condition;

    if (operand === 2) {
        const current = condition.right;
        if (current?.type !== "variable" || current.value === targetId || !moveDirectionMeasure(current.value)) return condition;
        // The moving entity travels with the switch; the old To side has no meaning for a Heading.
        const { rightSelectable, rightSelectable1, rightSelectable2, ...rest } = condition;
        void rightSelectable2;
        return {
            ...rest,
            right: { type: "variable", value: targetId },
            rightSelectable: rightSelectable1 ?? rightSelectable ?? defaultSelectableForVariable(target, selectableTypes),
        };
    }

    if (condition.left === targetId || !moveDirectionMeasure(condition.left)) return condition;
    const replacement = createExpressionCondition(target, selectableTypes);
    const rightFields = Object.fromEntries(Object.entries(condition).filter(([key]) => key !== "right" && key.startsWith("right")));
    const next = {
        ...replacement,
        ...rightFields,
        comparator: condition.comparator ?? replacement.comparator,
        right: clampedRight(condition.right ?? replacement.right, target),
    };
    if (measure === "toward") {
        const moving = condition.leftSelectable ?? condition.selectable;
        if (moving) next.selectable1 = moving;
    } else {
        const moving = condition.selectable1 ?? condition.selectable;
        if (moving) next.leftSelectable = moving;
    }
    return next;
}

/** An object target's pick is "custom" unless it is the default: the 1st, closest. */
export function objectPickIsCustom(order, ordinal) {
    return (order ?? "closest") !== "closest" || (Number(ordinal) || 1) !== 1;
}
