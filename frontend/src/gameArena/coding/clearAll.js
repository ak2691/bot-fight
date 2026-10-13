const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// What "Clear all" would remove from a brain, for the confirmation text.
export function clearAllCounts(configuration) {
    return {
        roots: configuration?.roots?.length ?? 0,
        unconnected: configuration?.orphans?.length ?? 0,
        variables: configuration?.customVariables?.length ?? 0,
    };
}

export function clearAllMessage(counts) {
    const parts = [
        counts.roots && plural(counts.roots, "root"),
        counts.unconnected && plural(counts.unconnected, "unconnected node"),
        counts.variables && plural(counts.variables, "variable"),
    ].filter(Boolean);
    if (!parts.length) return "";
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return `Delete ${list}?`;
}

// Roots (with their root actions), orphans, variables and node positions all go in one edit,
// so a single undo restores everything.
export function clearedConfiguration(configuration) {
    return { ...configuration, roots: [], orphans: [], customVariables: [], nodePositions: {} };
}
