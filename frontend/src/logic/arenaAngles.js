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

export function compassDirection(degrees) {
    const radians = compassDegreesToRadians(degrees);
    return { x: Math.cos(radians), y: Math.sin(radians) };
}
