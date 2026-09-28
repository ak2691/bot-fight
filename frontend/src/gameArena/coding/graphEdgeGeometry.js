export function graphEdgePath(edge, offsets = {}) {
    const from = offsets[edge.fromId] ?? { x: 0, y: 0 };
    const to = offsets[edge.toId] ?? { x: 0, y: 0 };
    const x1 = edge.x1 + from.x;
    const y1 = edge.y1 + from.y;
    const x2 = edge.x2 + to.x;
    const y2 = edge.y2 + to.y;
    return `M ${x1} ${y1} C ${x1} ${y1 + 70}, ${x2} ${y2 - 70}, ${x2} ${y2}`;
}
