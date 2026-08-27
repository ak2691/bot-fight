export function normalizePriority(value, fallback = 1) {
    const numeric = Number(value);
    const fallbackNumeric = Number(fallback);
    const priority = Number.isFinite(numeric)
        ? Math.trunc(numeric)
        : Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 1;
    return Math.max(1, priority);
}

/**
 * Read the canonical one-based priority while accepting the old zero-based
 * createdOrder field during the database/client migration window. Legacy
 * createdOrder wins when both fields exist because old conditional nodes also
 * used priority for a different, flat-action purpose.
 */
export function priorityForNode(node, fallback = 1) {
    const legacyValue = node?.createdOrder;
    const legacyOrder = Number(legacyValue);
    if (legacyValue !== null && legacyValue !== undefined && legacyValue !== "" && Number.isFinite(legacyOrder)) {
        return normalizePriority(legacyOrder + 1, fallback);
    }
    return normalizePriority(node?.priority, fallback);
}

let fallbackNodeSequence = 0;

/**
 * Create an identity for a newly-created editor node. This identity is
 * intentionally independent from priority, which is the execution
 * priority and may be exchanged with another root.
 */
export function createEditorNodeId(prefix = "node") {
    const normalizedPrefix = String(prefix ?? "node").trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "node";
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
        return `${normalizedPrefix}-${cryptoApi.randomUUID()}`;
    }
    if (typeof cryptoApi?.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${normalizedPrefix}-${suffix}`;
    }
    fallbackNodeSequence += 1;
    return `${normalizedPrefix}-${Date.now().toString(36)}-${fallbackNodeSequence.toString(36)}`;
}

// Compatibility fallback for legacy configurations that never persisted a
// root id. It is based on the stored array position, never on execution
// priority, so changing priority cannot change the fallback identity.
export function rootIdForIndex(value = 0) {
    const index = Number(value);
    return `root-${(Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0) + 1}`;
}

export function conditionalIdFor(rootId, depth, priority, fallback = 1) {
    const normalizedDepth = normalizePriority(depth, 1);
    return `${String(rootId || rootIdForIndex(0))}-${normalizedDepth}-${normalizePriority(priority, fallback)}`;
}
