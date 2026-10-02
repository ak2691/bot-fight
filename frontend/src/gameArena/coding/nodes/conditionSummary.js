// Plain-language summaries for condition rows, used by the compact node
// strips. Formatting only; evaluation lives in botlogic/code.

import { rightOperandView } from "../../botlogic/code/runtime/conditionEvaluator.js";

const COMPARATOR_SYMBOLS = Object.freeze({ lt: "<", lte: "≤", eq: "=", neq: "≠", gte: "≥", gt: ">" });

export function comparatorSymbol(id) {
    return COMPARATOR_SYMBOLS[id] ?? String(id ?? "");
}

function formatNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

/**
 * Returns { subject, entities, comparator, value, valueEntities } so the node can style the
 * parts separately. lookups: { variable(id), selectable(id), ability(id) }.
 */
export function summarizeCondition(condition, lookups) {
    if (!condition || condition.type === "always") return { subject: "Always", entities: [], comparator: "", value: "", valueEntities: [] };
    if (condition.type !== "expression") return { subject: "Never", entities: [], comparator: "", value: "", valueEntities: [] };
    const left = lookups.variable(condition.left);
    const entities = [];
    if (condition.selectable1 || condition.selectable2) {
        const target = condition.targetMode === "coordinates"
            ? `(${formatNumber(condition.targetX)}, ${formatNumber(condition.targetY)})`
            : condition.targetMode === "angle" ? `${formatNumber(condition.targetAngle)}°` : lookups.selectable(condition.selectable2);
        entities.push(`${lookups.selectable(condition.selectable1)} → ${target}`);
    } else if (condition.leftSelectable) {
        entities.push(lookups.selectable(condition.leftSelectable));
    }
    if (left?.supportsAbility && condition.ability != null) entities.push(lookups.ability(condition.ability));
    if (left?.supportsStatusEffect && condition.statusEffect) entities.push(String(condition.statusEffect).replace(/_/g, " "));
    const right = condition.right;
    let value = "";
    const valueEntities = [];
    if (right?.type === "boolean") value = right.value ? "true" : "false";
    else if (right?.type === "variable") {
        const rightVariable = lookups.variable(right.value);
        value = rightVariable?.label ?? String(right.value ?? "");
        if (rightVariable?.selectableType === "pair") {
            const view = rightOperandView(condition);
            const rightTarget = view.targetMode === "coordinates"
                ? `(${formatNumber(view.targetX)}, ${formatNumber(view.targetY)})`
                : view.targetMode === "angle" ? `${formatNumber(view.targetAngle)}°` : lookups.selectable(view.selectable2);
            if (view.selectable1) valueEntities.push(`${lookups.selectable(view.selectable1)} → ${rightTarget}`);
        } else if (condition.rightSelectable) valueEntities.push(lookups.selectable(condition.rightSelectable));
    } else if (right?.type === "number") value = `${formatNumber(right.value)}${left?.suffix ? ` ${left.suffix}` : ""}`;
    return { subject: left?.label ?? String(condition.left ?? "Unknown"), entities, comparator: comparatorSymbol(condition.comparator), value, valueEntities };
}

export function describeCondition(condition, lookups) {
    const { subject, entities, comparator, value, valueEntities } = summarizeCondition(condition, lookups);
    const withEntities = entities.length ? `${subject} (${entities.join(" · ")})` : subject;
    const withValueEntities = valueEntities.length ? `${value} (${valueEntities.join(" · ")})` : value;
    return [withEntities, comparator, withValueEntities].filter(Boolean).join(" ");
}
