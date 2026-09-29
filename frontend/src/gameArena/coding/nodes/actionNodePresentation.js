import { canonicalBotSelectableId } from "../../botlogic/code/contracts/BotLogicContracts.js";

export const UNAVAILABLE_TARGET_LABEL = "Unavailable target";

const SELECTABLE_ORDERS = Object.freeze(["closest", "farthest", "oldest", "newest"]);
const TOKEN_CHARACTER_WIDTH = 4.8;
const ACTION_CHARACTER_WIDTH = 6.6;
export const ACTION_NODE_HORIZONTAL_SPACE = 110;

function tokenTextWidth(text) {
    return Math.max(17, String(text ?? "").length * TOKEN_CHARACTER_WIDTH + 10);
}

function orderLabel(order) {
    return order.charAt(0).toUpperCase() + order.slice(1);
}

function ordinalLabel(value) {
    const remainder100 = value % 100;
    const suffix = remainder100 >= 11 && remainder100 <= 13
        ? "th"
        : ({ 1: "st", 2: "nd", 3: "rd" })[value % 10] ?? "th";
    return `${value}${suffix}`;
}

export function resolveSelectableTarget(value, selectableTypes = []) {
    const availableTypes = Array.isArray(selectableTypes) ? selectableTypes : [];
    const [baseId, encodedOrder, encodedOrdinal] = canonicalBotSelectableId(value).split(":");
    const definition = availableTypes.find((selectable) => selectable.id === baseId) ?? null;
    const ordinal = Math.max(1, Math.min(100, Number(encodedOrdinal) || 1));
    const requestedOrder = SELECTABLE_ORDERS.includes(encodedOrder) ? encodedOrder : null;

    if (!definition) {
        return {
            available: false,
            baseId,
            definition: null,
            kind: "unavailable",
            compactLabel: UNAVAILABLE_TARGET_LABEL,
            description: UNAVAILABLE_TARGET_LABEL,
            tooltip: "This target is unavailable in the current loadout or roster.",
            order: requestedOrder,
            ordinal,
        };
    }

    const label = String(definition.label ?? "Selectable target").replace(/^Closest\s+/, "");
    const isEntity = definition.kind === "entity";
    const isBot = definition.kind === "bot";
    const order = isEntity ? requestedOrder ?? "closest" : requestedOrder;
    const ownerLabel = definition.role === "self" ? "ME"
        : definition.role === "teammate" ? `T${definition.botIndex ?? ""}`
            : definition.role === "opponent" ? `O${definition.botIndex ?? 1}` : "";
    const ownerTone = definition.role === "opponent" ? "enemy"
        : definition.role === "self" || definition.role === "teammate" ? "friendly" : "neutral";
    const compactLabel = isEntity ? ownerLabel
        : definition.role === "self" ? "ME"
            : definition.role === "teammate" ? `T${definition.botIndex ?? ""}`
                : definition.role === "opponent" ? `O${definition.botIndex ?? 1}`
                    : label;
    const description = isBot
        ? label
        : `${ordinalLabel(ordinal)} ${orderLabel(order ?? "closest")} ${label}`;

    return {
        available: true,
        baseId,
        definition,
        kind: isEntity ? "entity" : isBot ? "bot" : "selectable",
        compactLabel,
        description,
        tooltip: description,
        ownerLabel,
        ownerTone,
        order,
        ordinal,
        orderBadge: order ? `${order[0].toUpperCase()}${ordinal}` : "",
        abilityLabel: label.replace(/\s+by\s+.+$/, ""),
    };
}

export function actionSelectablePickerModel(value, selectableTypes = []) {
    const availableTypes = Array.isArray(selectableTypes) ? selectableTypes : [];
    const target = resolveSelectableTarget(value, availableTypes);
    return {
        target,
        storedValue: value,
        selectValue: target.available ? target.baseId : "",
        statusLabel: target.available ? "" : UNAVAILABLE_TARGET_LABEL,
        statusMessage: target.available ? "" : target.tooltip,
        replacementPlaceholder: target.available ? "" : availableTypes.length ? "Choose a replacement…" : "No targets available",
        replacementOptions: target.available ? [] : availableTypes.map((selectable) => ({
            value: selectable.id,
            label: String(selectable.label ?? "Selectable target").replace(/^Closest\s+/, ""),
            kind: selectable.kind,
        })),
    };
}

export function encodeSelectableReplacement(selectableId, selectableTypes = []) {
    const definition = (Array.isArray(selectableTypes) ? selectableTypes : [])
        .find((selectable) => selectable.id === selectableId);
    if (!definition) return null;
    return definition.kind === "entity" ? `${definition.id}:closest:1` : definition.id;
}

export function measureSelectableTokenWidth(presentation, { abilityIconWidth = 16 } = {}) {
    if (!presentation?.available) return tokenTextWidth(UNAVAILABLE_TARGET_LABEL);
    if (presentation.kind === "entity") {
        const children = [
            presentation.definition?.abilityId ? abilityIconWidth : 0,
            presentation.ownerLabel ? tokenTextWidth(presentation.ownerLabel) : 0,
            tokenTextWidth(presentation.orderBadge || "C1"),
        ].filter((width) => width > 0);
        return children.reduce((sum, width) => sum + width, 0) + Math.max(0, children.length - 1) * 3;
    }
    const visibleText = presentation.kind === "bot"
        ? `${presentation.orderBadge ? `${presentation.orderBadge} ` : ""}${presentation.compactLabel}`
        : presentation.compactLabel;
    return tokenTextWidth(visibleText);
}

export function measureAngleTokenWidth(value) {
    const angleText = String(Number(value) || 0);
    return tokenTextWidth(`↟${angleText}°`);
}

export function measureCoordinateTokenWidth(x, y) {
    return tokenTextWidth(`⌖${Number(x)}, ${Number(y)}`);
}

export function measureActionTargetSignatureWidth({
    mode,
    movement = false,
    movementDirection = 0,
    targetAngle = 0,
    targetX = 0,
    targetY = 0,
    targetPresentation = null,
}) {
    if (!mode) return 0;
    const captionWidth = (text) => String(text).length * TOKEN_CHARACTER_WIDTH;
    if (mode === "absolute" || mode === "angle") {
        return measureAngleTokenWidth(mode === "absolute" ? movementDirection : targetAngle)
            + 5 + captionWidth("ABSOLUTE");
    }

    const parts = [];
    if (movement) parts.push(measureAngleTokenWidth(movementDirection));
    parts.push(captionWidth(movement ? "FROM" : "TARGET"));
    parts.push(mode === "coordinates"
        ? measureCoordinateTokenWidth(targetX, targetY)
        : measureSelectableTokenWidth(targetPresentation));
    return parts.reduce((sum, width) => sum + width, 0) + Math.max(0, parts.length - 1) * 5;
}

export function measureVariableActionExpressionWidth(segments = []) {
    return segments.reduce((sum, segment) => sum
        + (segment.operator ? Number(segment.operatorWidth ?? 13) : 0)
        + (segment.operator ? 4 : 0)
        + String(segment.label ?? "").length * ACTION_CHARACTER_WIDTH
        + Number(segment.signatureWidth ?? 0)
        + 7, 0);
}

export function measureActionNodeWidth({
    actionLabel = "Action",
    hasAbilityIcon = false,
    targetMode = null,
    movement = false,
    movementDirection = 0,
    targetAngle = 0,
    targetX = 0,
    targetY = 0,
    targetPresentation = null,
    variableExpressionWidth = 0,
}) {
    const headingWidth = String(actionLabel ?? "Action").length * ACTION_CHARACTER_WIDTH
        + (hasAbilityIcon ? 22 + 7 : 0);
    const targetWidth = measureActionTargetSignatureWidth({
        mode: targetMode,
        movement,
        movementDirection,
        targetAngle,
        targetX,
        targetY,
        targetPresentation,
    });
    return Math.max(200, Math.ceil(Math.max(headingWidth, targetWidth, variableExpressionWidth) + ACTION_NODE_HORIZONTAL_SPACE));
}
