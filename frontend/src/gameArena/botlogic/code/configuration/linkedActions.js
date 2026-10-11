// Linked actions: one action wired under several parents is saved as one copy per parent, all with the same
// `linkId`. Both runtimes simply run the copies. The link only changes how the editor shows them and how the
// action budget counts them (identical linked copies cost once).

export const MAX_LINK_ID_LENGTH = 40;
export const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isLinkId(value) {
    return typeof value === "string" && LINK_ID_PATTERN.test(value);
}

export function createLinkId() {
    const cryptoApi = globalThis.crypto;
    const random = typeof cryptoApi?.randomUUID === "function"
        ? cryptoApi.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14).padEnd(12, "0");
    return `link-${random}`;
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/** What two copies must share to be one linked action: every field except the copy's own `id`. */
export function linkContentKey(entry) {
    const { id: _id, ...content } = entry ?? {};
    return canonical(content);
}

/** The budget key of a linked copy, or null for an unlinked action. Equal keys cost once. */
export function linkBudgetKey(entry) {
    return isLinkId(entry?.linkId) ? linkContentKey(entry) : null;
}

/** Every action entry a saved brain's tree holds (roots, conditionals, orphans), in tree order. */
export function treeActionEntries(configuration) {
    const entries = [];
    const entriesOf = (node) => (Array.isArray(node?.actions) && node.actions.length ? node.actions : node?.action ? [node] : []);
    const visit = (branch) => {
        entries.push(...entriesOf(branch));
        (Array.isArray(branch?.children) ? branch.children : []).forEach(visit);
    };
    for (const root of configuration?.roots ?? []) {
        entries.push(...(Array.isArray(root?.actions) ? root.actions : []));
        (Array.isArray(root?.branches) ? root.branches : []).forEach(visit);
    }
    for (const node of Array.isArray(configuration?.orphans) ? configuration.orphans : []) {
        if (node?.kind === "action") entries.push(node);
        else visit(node);
    }
    return entries;
}

/** The cost saved by linked copies: every identical copy after the first is free. */
export function linkedActionDiscount(configuration, costOf) {
    const seen = new Set();
    let discount = 0;
    for (const entry of treeActionEntries(configuration)) {
        const key = linkBudgetKey(entry);
        if (key == null) continue;
        if (seen.has(key)) discount += costOf(entry);
        else seen.add(key);
    }
    return discount;
}

/**
 * Splits the copies of a roots tree by link. Returns Map<linkId, entry[]> over `entries`, which must all be
 * connected tree actions (not bare orphans).
 */
export function groupByLinkId(entries) {
    const groups = new Map();
    for (const entry of entries) {
        if (!isLinkId(entry?.linkId)) continue;
        if (!groups.has(entry.linkId)) groups.set(entry.linkId, []);
        groups.get(entry.linkId).push(entry);
    }
    return groups;
}

/**
 * Load-time merge rule. Copies sharing a linkId and identical content (apart from their `id`) are one linked
 * action; the editor shows them as one node. A link whose copies differ (hand-edited), that has a single copy,
 * or that is a bare orphan loses its linkId, so each copy loads as its own node. Returns a new configuration
 * only when something changed.
 */
export function mergeLinkedActions(configuration) {
    const connected = [];
    const orphanActions = [];
    const everything = treeActionEntries(configuration);
    for (const node of Array.isArray(configuration?.orphans) ? configuration.orphans : []) {
        if (node?.kind === "action") orphanActions.push(node);
    }
    const orphanSet = new Set(orphanActions);
    everything.forEach((entry) => { if (!orphanSet.has(entry)) connected.push(entry); });
    const doomed = new Set(orphanActions.filter((entry) => entry?.linkId !== undefined));
    for (const [, copies] of groupByLinkId(connected)) {
        const identical = copies.length > 1 && new Set(copies.map(linkContentKey)).size === 1;
        if (!identical) copies.forEach((entry) => doomed.add(entry));
    }
    connected.forEach((entry) => { if (entry?.linkId !== undefined && !isLinkId(entry.linkId)) doomed.add(entry); });
    if (!doomed.size) return configuration;
    const strip = (entry) => {
        if (!doomed.has(entry)) return entry;
        const { linkId: _linkId, ...rest } = entry;
        return rest;
    };
    const stripBranch = (branch) => {
        const hasActions = Array.isArray(branch?.actions) && branch.actions.length;
        const own = !hasActions && doomed.has(branch) ? strip(branch) : { ...branch };
        if (hasActions) own.actions = branch.actions.map(strip);
        if (Array.isArray(branch?.children)) own.children = branch.children.map(stripBranch);
        return own;
    };
    return {
        ...configuration,
        roots: (configuration.roots ?? []).map((root) => ({
            ...root,
            ...(Array.isArray(root.actions) ? { actions: root.actions.map(strip) } : {}),
            ...(Array.isArray(root.branches) ? { branches: root.branches.map(stripBranch) } : {}),
        })),
        ...(Array.isArray(configuration.orphans) ? { orphans: configuration.orphans.map((node) => (node?.kind === "action" ? strip(node) : stripBranch(node))) } : {}),
    };
}
