export function normalizeCreatedOrder(value, fallback = 0) {
    const numeric = Number(value);
    const fallbackNumeric = Number(fallback);
    const order = Number.isFinite(numeric)
        ? Math.trunc(numeric)
        : Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
    return Math.max(0, order);
}

export function priorityFromCreatedOrder(value, fallback = 0) {
    return normalizeCreatedOrder(value, fallback) + 1;
}

export function rootIdForCreatedOrder(value, fallback = 0) {
    return `root-${priorityFromCreatedOrder(value, fallback)}`;
}

export function conditionalIdFor(rootId, depth, value, fallback = 0) {
    const normalizedDepth = Math.max(1, normalizeCreatedOrder(depth, 1));
    return `${String(rootId || rootIdForCreatedOrder(0))}-${normalizedDepth}-${priorityFromCreatedOrder(value, fallback)}`;
}
