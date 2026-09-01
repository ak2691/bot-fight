import { compassDirection } from "../botlogic/planner/arenaAngles.js";

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

/** Returns whether two circular colliders overlap at any point in one tick. */
export function movingCirclesIntersect(firstStart, firstEnd, firstRadius, secondStart, secondEnd, secondRadius) {
    const relativeStart = {
        x: Number(firstStart.x) - Number(secondStart.x),
        y: Number(firstStart.y) - Number(secondStart.y),
    };
    const relativeEnd = {
        x: Number(firstEnd.x) - Number(secondEnd.x),
        y: Number(firstEnd.y) - Number(secondEnd.y),
    };
    return segmentIntersectsCircle(relativeStart, relativeEnd, {
        x: 0,
        y: 0,
        size: (Number(firstRadius) + Number(secondRadius)) * 2,
    });
}

/** Returns the closest center-to-center distance during one tick. */
export function movingCirclesDistance(firstStart, firstEnd, secondStart, secondEnd) {
    const relativeStart = {
        x: Number(firstStart.x) - Number(secondStart.x),
        y: Number(firstStart.y) - Number(secondStart.y),
    };
    const relativeEnd = {
        x: Number(firstEnd.x) - Number(secondEnd.x),
        y: Number(firstEnd.y) - Number(secondEnd.y),
    };
    const dx = relativeEnd.x - relativeStart.x;
    const dy = relativeEnd.y - relativeStart.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
        ? clamp(-(relativeStart.x * dx + relativeStart.y * dy) / lengthSquared, 0, 1)
        : 0;
    return Math.hypot(relativeStart.x + dx * t, relativeStart.y + dy * t);
}

/**
 * Resolves one generic moving-circle hit. A hit at the final pose is an
 * ordinary contact; otherwise the movement paths are treated as swept
 * hitboxes. Callers provide movement paths, so teleports must pass the same
 * point for start and end.
 */
export function movingCircleCollision(firstStart, firstEnd, firstRadius, secondStart, secondEnd, secondRadius) {
    const collisionRadius = Number(firstRadius) + Number(secondRadius);
    const endDistance = Math.hypot(
        Number(firstEnd.x) - Number(secondEnd.x),
        Number(firstEnd.y) - Number(secondEnd.y),
    );
    if (endDistance <= collisionRadius) return { hit: true, swept: false, distance: endDistance };
    const distance = movingCirclesDistance(firstStart, firstEnd, secondStart, secondEnd);
    return { hit: distance <= collisionRadius, swept: true, distance };
}

/**
 * Resolves a moving, direction-aligned rectangle against a moving circle.
 *
 * The rectangle is intentionally expanded by the target radius on both local
 * axes. That keeps the collider deterministic and inexpensive while matching
 * the simple square hitboxes used by the arena presentation.
 */
export function movingRectangleCollision(
    firstStart,
    firstEnd,
    firstWidth,
    firstHeight,
    firstRotation,
    secondStart,
    secondEnd,
    secondRadius,
) {
    const width = Math.max(0, Number(firstWidth) || 0);
    const height = Math.max(0, Number(firstHeight) || 0);
    const radius = Math.max(0, Number(secondRadius) || 0);
    const rotation = Number.isFinite(Number(firstRotation)) ? Number(firstRotation) : 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const relativeStart = toLocalPoint(
        Number(secondStart.x) - Number(firstStart.x),
        Number(secondStart.y) - Number(firstStart.y),
        cos,
        sin,
    );
    const relativeEnd = toLocalPoint(
        Number(secondEnd.x) - Number(firstEnd.x),
        Number(secondEnd.y) - Number(firstEnd.y),
        cos,
        sin,
    );
    const halfWidth = width / 2 + radius;
    const halfHeight = height / 2 + radius;
    const endInside = pointInsideRectangle(relativeEnd, halfWidth, halfHeight);
    const distance = movingCirclesDistance(firstStart, firstEnd, secondStart, secondEnd);
    if (endInside) return { hit: true, swept: false, distance };
    return {
        hit: segmentIntersectsRectangle(relativeStart, relativeEnd, halfWidth, halfHeight),
        swept: true,
        distance,
    };
}

/** Returns whether two line segments come within the supplied distance. */
export function segmentsWithinDistance(firstStart, firstEnd, secondStart, secondEnd, maxDistance = 0) {
    if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return true;
    return Math.min(
        pointToSegmentDistance(firstStart, secondStart, secondEnd),
        pointToSegmentDistance(firstEnd, secondStart, secondEnd),
        pointToSegmentDistance(secondStart, firstStart, firstEnd),
        pointToSegmentDistance(secondEnd, firstStart, firstEnd),
    ) <= Number(maxDistance);
}

function pointToSegmentDistance(point, start, end) {
    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
        ? clamp(((Number(point.x) - Number(start.x)) * dx + (Number(point.y) - Number(start.y)) * dy) / lengthSquared, 0, 1)
        : 0;
    return Math.hypot(Number(point.x) - Number(start.x) - dx * t, Number(point.y) - Number(start.y) - dy * t);
}

function toLocalPoint(x, y, cos, sin) {
    return { x: x * cos + y * sin, y: -x * sin + y * cos };
}

function pointInsideRectangle(point, halfWidth, halfHeight) {
    return Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight;
}

function segmentIntersectsRectangle(start, end, halfWidth, halfHeight) {
    if (pointInsideRectangle(start, halfWidth, halfHeight)) return true;
    let minimum = 0;
    let maximum = 1;
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    for (const [origin, delta, extent] of [[start.x, deltaX, halfWidth], [start.y, deltaY, halfHeight]]) {
        if (Math.abs(delta) <= 1e-12) {
            if (origin < -extent || origin > extent) return false;
            continue;
        }
        let near = (-extent - origin) / delta;
        let far = (extent - origin) / delta;
        if (near > far) [near, far] = [far, near];
        minimum = Math.max(minimum, near);
        maximum = Math.min(maximum, far);
        if (minimum > maximum) return false;
    }
    return maximum >= 0 && minimum <= 1;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
    const orientation = (a, b, c) => (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y))
        - (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
    const first = orientation(firstStart, firstEnd, secondStart);
    const second = orientation(firstStart, firstEnd, secondEnd);
    const third = orientation(secondStart, secondEnd, firstStart);
    const fourth = orientation(secondStart, secondEnd, firstEnd);
    const epsilon = 1e-9;
    return ((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
        && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))
        || Math.abs(first) <= epsilon && onSegment(firstStart, firstEnd, secondStart)
        || Math.abs(second) <= epsilon && onSegment(firstStart, firstEnd, secondEnd)
        || Math.abs(third) <= epsilon && onSegment(secondStart, secondEnd, firstStart)
        || Math.abs(fourth) <= epsilon && onSegment(secondStart, secondEnd, firstEnd);
}

function onSegment(start, end, point) {
    return Number(point.x) >= Math.min(Number(start.x), Number(end.x)) - 1e-9
        && Number(point.x) <= Math.max(Number(start.x), Number(end.x)) + 1e-9
        && Number(point.y) >= Math.min(Number(start.y), Number(end.y)) - 1e-9
        && Number(point.y) <= Math.max(Number(start.y), Number(end.y)) + 1e-9;
}
