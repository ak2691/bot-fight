import { compassDirection, vectorToCompassDegrees } from "../botlogic/planner/arenaAngles.js";

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

/**
 * Returns whether a moving circular target intersects a filled circular
 * sector. The target radius is applied to the sector's radial edges and outer
 * arc as well as its range, so collision follows the actual hitbox rather
 * than only the target center's bearing.
 */
export function segmentIntersectsSector(
    source,
    start,
    end,
    rotationDegrees,
    range,
    halfArcDegrees,
    targetRadius = 0,
) {
    const sectorRange = Math.max(0, Number(range) || 0);
    const radius = Math.max(0, Number(targetRadius) || 0);
    const boundedHalfArcDegrees = clamp(Number(halfArcDegrees) || 0, 0, 180);
    const halfArc = boundedHalfArcDegrees * Math.PI / 180;
    if (segmentIntersectsSectorAtCenter(source, start, end, rotationDegrees, sectorRange, halfArc)) return true;
    if (radius <= 0) return false;

    // The sector contains its origin, so an overlapping target hits no matter
    // which side of the attacker's facing direction contains its center.
    if (pointToSegmentDistance(source, start, end) <= radius) return true;

    const firstBoundary = sectorBoundaryPoint(source, rotationDegrees - boundedHalfArcDegrees, sectorRange);
    const secondBoundary = sectorBoundaryPoint(source, rotationDegrees + boundedHalfArcDegrees, sectorRange);
    if (segmentsWithinDistance(start, end, source, firstBoundary, radius)
        || segmentsWithinDistance(start, end, source, secondBoundary, radius)) return true;

    return segmentToCircularArcDistance(
        start,
        end,
        source,
        sectorRange,
        rotationDegrees,
        halfArc,
    ) <= radius;
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
 * the rectangular hitboxes used by the arena presentation. Width is the
 * longitudinal dimension and height is the cross-axis dimension.
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

function segmentIntersectsSectorAtCenter(source, start, end, rotationDegrees, range, halfArc) {
    const candidates = [0, 1];
    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 0) candidates.push(clamp(
        ((Number(source.x) - Number(start.x)) * dx + (Number(source.y) - Number(start.y)) * dy) / lengthSquared,
        0,
        1,
    ));
    for (const boundary of [
        rotationDegrees - halfArc * 180 / Math.PI,
        rotationDegrees + halfArc * 180 / Math.PI,
    ]) {
        const edge = compassDirection(boundary);
        const denominator = dx * edge.y - dy * edge.x;
        if (Math.abs(denominator) <= 1e-9) continue;
        const sourceToStartX = Number(source.x) - Number(start.x);
        const sourceToStartY = Number(source.y) - Number(start.y);
        const t = (sourceToStartX * edge.y - sourceToStartY * edge.x) / denominator;
        const rayDistance = (sourceToStartX * dy - sourceToStartY * dx) / denominator;
        if (t >= 0 && t <= 1 && rayDistance >= 0 && rayDistance <= range) candidates.push(t);
    }
    return candidates.some((t) => pointInSector(
        source,
        { x: Number(start.x) + dx * t, y: Number(start.y) + dy * t },
        rotationDegrees,
        range,
        halfArc,
    ));
}

function pointInSector(source, point, rotationDegrees, range, halfArc) {
    const dx = Number(point.x) - Number(source.x);
    const dy = Number(point.y) - Number(source.y);
    const distance = Math.hypot(dx, dy);
    if (distance > range + 1e-9) return false;
    if (distance <= 0.001 || halfArc >= Math.PI - 1e-9) return true;
    const bearing = vectorToCompassDegrees(dx, dy);
    const delta = ((bearing - Number(rotationDegrees) + 540) % 360) - 180;
    return Math.abs(delta) * Math.PI / 180 <= halfArc + 1e-9;
}

function sectorBoundaryPoint(source, bearing, range) {
    const direction = compassDirection(bearing);
    return {
        x: Number(source.x) + direction.x * range,
        y: Number(source.y) + direction.y * range,
    };
}

function segmentToCircularArcDistance(start, end, source, range, rotationDegrees, halfArc) {
    if (range <= 0) return pointToSegmentDistance(source, start, end);
    const firstBoundary = sectorBoundaryPoint(source, rotationDegrees - halfArc * 180 / Math.PI, range);
    const secondBoundary = sectorBoundaryPoint(source, rotationDegrees + halfArc * 180 / Math.PI, range);
    let minimum = Math.min(
        pointToArcDistance(start, source, range, rotationDegrees, halfArc, firstBoundary, secondBoundary),
        pointToArcDistance(end, source, range, rotationDegrees, halfArc, firstBoundary, secondBoundary),
        pointToSegmentDistance(firstBoundary, start, end),
        pointToSegmentDistance(secondBoundary, start, end),
    );

    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 0) {
        const t = clamp(((Number(source.x) - Number(start.x)) * dx
            + (Number(source.y) - Number(start.y)) * dy) / lengthSquared, 0, 1);
        const closest = { x: Number(start.x) + dx * t, y: Number(start.y) + dy * t };
        if (pointAngleInSector(closest, source, rotationDegrees, halfArc)) {
            minimum = Math.min(minimum, Math.abs(Math.hypot(
                closest.x - Number(source.x), closest.y - Number(source.y),
            ) - range));
        }

        const offsetX = Number(start.x) - Number(source.x);
        const offsetY = Number(start.y) - Number(source.y);
        const a = lengthSquared;
        const b = 2 * (offsetX * dx + offsetY * dy);
        const c = offsetX * offsetX + offsetY * offsetY - range * range;
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            for (const intersection of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
                if (intersection < 0 || intersection > 1) continue;
                const point = {
                    x: Number(start.x) + dx * intersection,
                    y: Number(start.y) + dy * intersection,
                };
                if (pointAngleInSector(point, source, rotationDegrees, halfArc)) return 0;
            }
        }
    }
    return minimum;
}

function pointToArcDistance(point, source, range, rotationDegrees, halfArc, firstBoundary, secondBoundary) {
    if (pointAngleInSector(point, source, rotationDegrees, halfArc)) {
        return Math.abs(Math.hypot(
            Number(point.x) - Number(source.x), Number(point.y) - Number(source.y),
        ) - range);
    }
    return Math.min(
        Math.hypot(Number(point.x) - firstBoundary.x, Number(point.y) - firstBoundary.y),
        Math.hypot(Number(point.x) - secondBoundary.x, Number(point.y) - secondBoundary.y),
    );
}

function pointAngleInSector(point, source, rotationDegrees, halfArc) {
    const dx = Number(point.x) - Number(source.x);
    const dy = Number(point.y) - Number(source.y);
    if (Math.hypot(dx, dy) <= 0.001 || halfArc >= Math.PI - 1e-9) return true;
    const bearing = vectorToCompassDegrees(dx, dy);
    const delta = ((bearing - Number(rotationDegrees) + 540) % 360) - 180;
    return Math.abs(delta) * Math.PI / 180 <= halfArc + 1e-9;
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
