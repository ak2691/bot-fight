export function normalizeCompassDegrees(degrees) {
    return ((Number(degrees ?? 0) % 360) + 360) % 360;
}

/** Converts north-zero, clockwise-positive arena degrees to canvas radians. */
export function compassDegreesToRadians(degrees) {
    return (Number(degrees ?? 0) - 90) * Math.PI / 180;
}

/** Converts a screen-space vector (+x right, +y down) to arena compass degrees. */
export function vectorToCompassDegrees(dx, dy) {
    return normalizeCompassDegrees(Math.atan2(Number(dx), -Number(dy)) * 180 / Math.PI);
}

/** Converts the numeric relative movement direction contract to bounded degrees. */
export function relativeMovementAngle(value, fallback = 0) {
    const text = typeof value === "string" ? value.trim() : value;
    const numeric = text == null || text === "" ? Number.NaN : Number(text);
    if (Number.isFinite(numeric)) return Math.max(-360, Math.min(360, numeric));
    return fallback;
}

/** Converts legacy named absolute walk directions to the bounded compass angle contract. */
export function absoluteMovementAngle(value, fallback = 0) {
    const legacyDirection = {
        north: 0,
        northeast: 45,
        east: 90,
        southeast: 135,
        south: 180,
        southwest: 225,
        west: 270,
        northwest: 315,
        stop: 0,
    }[String(value ?? "").trim().toLowerCase()];
    return relativeMovementAngle(legacyDirection ?? value, fallback);
}

export function normalizeRelativeMovementDegrees(degrees) {
    const normalized = normalizeCompassDegrees(relativeMovementAngle(degrees));
    return normalized > 180 ? normalized - 360 : normalized;
}

export function relativeMovementVector(dx, dy, degrees) {
    const magnitude = Math.hypot(Number(dx), Number(dy));
    if (!Number.isFinite(magnitude) || magnitude <= 0.001) return { x: 0, y: 0 };
    const radians = normalizeRelativeMovementDegrees(degrees) * Math.PI / 180;
    const normalizedX = Number(dx) / magnitude;
    const normalizedY = Number(dy) / magnitude;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
        x: normalizedX * cosine - normalizedY * sine,
        y: normalizedX * sine + normalizedY * cosine,
    };
}

export function compassDirection(degrees) {
    const radians = compassDegreesToRadians(degrees);
    return { x: Math.cos(radians), y: Math.sin(radians) };
}
