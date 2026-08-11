export function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

export function interpolatePosition(previous, next, alpha) {
    const t = clamp01(alpha);
    return {
        x: previous.x + (next.x - previous.x) * t,
        y: previous.y + (next.y - previous.y) * t,
    };
}

export function sampleSnapshot(snapshot, now) {
    const durationMs = Math.max(1, snapshot.durationMs);
    const alpha = clamp01((now - snapshot.startedAt) / durationMs);
    return {
        alpha,
        bots: Object.fromEntries(Object.keys(snapshot.next).map((id) => [
            id,
            interpolatePosition(snapshot.previous[id] ?? snapshot.next[id], snapshot.next[id], alpha),
        ])),
    };
}

export function createSnapshot(previous, next, startedAt, durationMs = 500) {
    return {
        previous: structuredClone(previous),
        next: structuredClone(next),
        startedAt,
        durationMs,
    };
}
