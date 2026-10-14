export const NODE_POSITIONS_FIELD = "nodePositions";
export const MAX_NODE_POSITIONS = 1000;
export const MAX_NODE_POSITION_ID_LENGTH = 200;
export const MAX_NODE_COORDINATE = 1_000_000;

// This metadata affects only the editor presentation. The authoritative
// runtime ignores it and evaluates the normalized roots/actions instead.

function roundedCoordinate(value) {
    return Math.round(value * 100) / 100;
}

function validCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
        && numeric >= 0
        && numeric <= MAX_NODE_COORDINATE
        ? roundedCoordinate(numeric)
        : null;
}

export function normalizeNodePositions(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};

    const positions = {};
    for (const [rawId, value] of Object.entries(source).slice(0, MAX_NODE_POSITIONS)) {
        const id = String(rawId);
        if (!id || id.length > MAX_NODE_POSITION_ID_LENGTH
            || !value || typeof value !== "object" || Array.isArray(value)) continue;
        const x = validCoordinate(value.x);
        const y = validCoordinate(value.y);
        if (x == null || y == null) continue;
        positions[id] = { x, y };
    }
    return positions;
}

export function nodePositionsForGraph(graphNodes, offsets = {}) {
    return Object.fromEntries((graphNodes ?? []).map((node) => {
        const offset = offsets[node.id] ?? { x: 0, y: 0 };
        return [node.id, {
            x: roundedCoordinate(Number(node.x ?? 0) + Number(offset.x ?? 0)),
            y: roundedCoordinate(Number(node.y ?? 0) + Number(offset.y ?? 0)),
        }];
    }));
}

export function offsetsForGraphPositions(graphNodes, source) {
    const positions = normalizeNodePositions(source);
    return Object.fromEntries((graphNodes ?? [])
        .filter((node) => positions[node.id])
        .map((node) => [node.id, {
            x: positions[node.id].x - Number(node.x ?? 0),
            y: positions[node.id].y - Number(node.y ?? 0),
        }]));
}
