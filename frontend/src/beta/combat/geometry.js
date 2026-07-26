import { compassDirection } from "../../logic/arenaAngles.js";

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
export function normalizeAngle(degrees) { return ((degrees % 360) + 360) % 360; }
export function angleDelta(fromDeg, toDeg) { return ((toDeg - fromDeg + 540) % 360) - 180; }
export function rayIntersectsCircle(origin, rotationDegrees, range, circle) {
    if (!origin || !circle || !Number.isFinite(range) || range <= 0) return false;
    const { x: directionX, y: directionY } = compassDirection(rotationDegrees);
    const offsetX = circle.x - origin.x, offsetY = circle.y - origin.y;
    const projection = offsetX * directionX + offsetY * directionY;
    const radius = Number(circle.size ?? 0) / 2;
    const perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
    if (projection < -radius || perpendicularSquared > radius * radius) return false;
    const entryDistance = projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared));
    return Math.max(0, entryDistance) <= range;
}

export function segmentIntersectsCircle(start, end, circle) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? clamp(((circle.x - start.x) * dx + (circle.y - start.y) * dy) / lengthSquared, 0, 1) : 0;
    const nearestX = start.x + dx * t, nearestY = start.y + dy * t;
    return Math.hypot(circle.x - nearestX, circle.y - nearestY) <= Number(circle.size ?? 0) / 2;
}
