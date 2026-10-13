export function graphEdgePath(edge, offsets = {}, frames = {}) {
    const from = offsets[edge.fromId] ?? { x: 0, y: 0 };
    const to = offsets[edge.toId] ?? { x: 0, y: 0 };
    const parent = frames[edge.fromId];
    const child = frames[edge.toId];
    const x1 = parent ? parent.x + parent.width / 2 : edge.x1 + from.x;
    const y1 = parent ? parent.y + parent.height : edge.y1 + from.y;
    const x2 = child ? child.x + child.width / 2 : edge.x2 + to.x;
    const y2 = child ? child.y : edge.y2 + to.y;
    return `M ${x1} ${y1} C ${x1} ${y1 + 70}, ${x2} ${y2 - 70}, ${x2} ${y2}`;
}
