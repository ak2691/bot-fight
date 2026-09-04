package com.example.botfight.simulation.geometry;

/** Pure distance and intersection calculations for the arena coordinate system. */
public final class DistanceCalculator {
    private DistanceCalculator() {}

    public static double between(double firstX, double firstY, double secondX, double secondY) {
        return Math.hypot(secondX - firstX, secondY - firstY);
    }

    public static boolean rayIntersectsCircle(
            double originX, double originY, double directionX, double directionY,
            double range, double circleX, double circleY, double radius) {
        double offsetX = circleX - originX;
        double offsetY = circleY - originY;
        double projection = offsetX * directionX + offsetY * directionY;
        double perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
        if (projection < -radius || perpendicularSquared > radius * radius) return false;
        double entryDistance = projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared));
        return Math.max(0, entryDistance) <= range;
    }

    public static boolean segmentIntersectsCircle(
            double startX, double startY, double endX, double endY,
            double circleX, double circleY, double radius) {
        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0
                ? clamp(((circleX - startX) * dx + (circleY - startY) * dy) / lengthSquared, 0, 1)
                : 0;
        return between(circleX, circleY, startX + dx * t, startY + dy * t) <= radius;
    }

    /**
     * Returns whether a moving circular target intersects a filled circular
     * sector. The target radius is applied to the sector's radial edges and
     * outer arc as well as its range, rather than only to the target center's
     * bearing.
     */
    public static boolean segmentIntersectsSector(
            double sourceX, double sourceY,
            double startX, double startY, double endX, double endY,
            double rotationDegrees, double range, double halfArcDegrees,
            double targetRadius) {
        double sectorRange = Math.max(0, finiteOrZero(range));
        double radius = Math.max(0, finiteOrZero(targetRadius));
        double halfArc = Math.min(180, Math.max(0, finiteOrZero(halfArcDegrees)));
        if (segmentIntersectsSectorAtCenter(sourceX, sourceY, startX, startY,
                endX, endY, rotationDegrees, sectorRange, halfArc)) return true;
        if (radius <= 0) return false;

        // The sector contains its origin, so an overlapping target hits no
        // matter which side of the attacker's facing contains its center.
        if (pointToSegmentDistance(sourceX, sourceY, startX, startY, endX, endY) <= radius) return true;

        double firstBoundaryX = sourceX + Math.cos(AngleCalculator.compassRadians(rotationDegrees - halfArc)) * sectorRange;
        double firstBoundaryY = sourceY + Math.sin(AngleCalculator.compassRadians(rotationDegrees - halfArc)) * sectorRange;
        double secondBoundaryX = sourceX + Math.cos(AngleCalculator.compassRadians(rotationDegrees + halfArc)) * sectorRange;
        double secondBoundaryY = sourceY + Math.sin(AngleCalculator.compassRadians(rotationDegrees + halfArc)) * sectorRange;
        if (segmentsWithinDistance(startX, startY, endX, endY,
                sourceX, sourceY, firstBoundaryX, firstBoundaryY, radius)
                || segmentsWithinDistance(startX, startY, endX, endY,
                sourceX, sourceY, secondBoundaryX, secondBoundaryY, radius)) return true;

        return segmentToCircularArcDistance(startX, startY, endX, endY,
                sourceX, sourceY, sectorRange, rotationDegrees, halfArc) <= radius;
    }

    /** Returns whether two circular colliders overlap at any point in one tick. */
    public static boolean movingCirclesIntersect(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double firstRadius, double secondStartX, double secondStartY,
            double secondEndX, double secondEndY, double secondRadius) {
        return segmentIntersectsCircle(
                firstStartX - secondStartX, firstStartY - secondStartY,
                firstEndX - secondEndX, firstEndY - secondEndY,
                0, 0, firstRadius + secondRadius);
    }

    /** Returns the closest center-to-center distance during one tick. */
    public static double movingCirclesDistance(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY) {
        double startX = firstStartX - secondStartX;
        double startY = firstStartY - secondStartY;
        double dx = firstEndX - secondEndX - startX;
        double dy = firstEndY - secondEndY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0
                ? clamp(-(startX * dx + startY * dy) / lengthSquared, 0, 1)
                : 0;
        return Math.hypot(startX + dx * t, startY + dy * t);
    }

    /**
     * Resolves one generic moving-circle hit. A hit at the final pose is an
     * ordinary contact; otherwise the movement paths are treated as swept
     * hitboxes. Callers provide movement paths, so teleports must pass the same
     * point for start and end.
     */
    public static MovingCircleCollision movingCircleCollision(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double firstRadius, double secondStartX, double secondStartY,
            double secondEndX, double secondEndY, double secondRadius) {
        double collisionRadius = firstRadius + secondRadius;
        double endDistance = between(firstEndX, firstEndY, secondEndX, secondEndY);
        if (endDistance <= collisionRadius) return new MovingCircleCollision(true, false, endDistance);
        double distance = movingCirclesDistance(firstStartX, firstStartY, firstEndX, firstEndY,
                secondStartX, secondStartY, secondEndX, secondEndY);
        return new MovingCircleCollision(distance <= collisionRadius, true, distance);
    }

    /**
     * Resolves a moving, direction-aligned rectangle against a moving circle.
     * The target radius expands both local rectangle axes, which keeps the
     * collider deterministic and intentionally simple for arena gameplay.
     */
    public static MovingCircleCollision movingRectangleCollision(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double firstWidth, double firstHeight, double firstRotation,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY,
            double secondRadius) {
        double width = Math.max(0, finiteOrZero(firstWidth));
        double height = Math.max(0, finiteOrZero(firstHeight));
        double radius = Math.max(0, finiteOrZero(secondRadius));
        double rotation = Double.isFinite(firstRotation) ? firstRotation : 0;
        double cos = Math.cos(rotation);
        double sin = Math.sin(rotation);
        double[] relativeStart = toLocalPoint(
                secondStartX - firstStartX, secondStartY - firstStartY, cos, sin);
        double[] relativeEnd = toLocalPoint(
                secondEndX - firstEndX, secondEndY - firstEndY, cos, sin);
        double halfWidth = width / 2.0 + radius;
        double halfHeight = height / 2.0 + radius;
        double distance = movingCirclesDistance(firstStartX, firstStartY, firstEndX, firstEndY,
                secondStartX, secondStartY, secondEndX, secondEndY);
        if (insideRectangle(relativeEnd[0], relativeEnd[1], halfWidth, halfHeight)) {
            return new MovingCircleCollision(true, false, distance);
        }
        return new MovingCircleCollision(
                segmentIntersectsRectangle(relativeStart[0], relativeStart[1], relativeEnd[0], relativeEnd[1],
                        halfWidth, halfHeight),
                true,
                distance);
    }

    public record MovingCircleCollision(boolean hit, boolean swept, double distance) {}

    private static double[] toLocalPoint(double x, double y, double cos, double sin) {
        return new double[]{x * cos + y * sin, -x * sin + y * cos};
    }

    private static boolean insideRectangle(double x, double y, double halfWidth, double halfHeight) {
        return Math.abs(x) <= halfWidth && Math.abs(y) <= halfHeight;
    }

    private static boolean segmentIntersectsRectangle(
            double startX, double startY, double endX, double endY,
            double halfWidth, double halfHeight) {
        if (insideRectangle(startX, startY, halfWidth, halfHeight)) return true;
        double minimum = 0;
        double maximum = 1;
        double[] origins = {startX, startY};
        double[] deltas = {endX - startX, endY - startY};
        double[] extents = {halfWidth, halfHeight};
        for (int index = 0; index < origins.length; index++) {
            double origin = origins[index];
            double delta = deltas[index];
            double extent = extents[index];
            if (Math.abs(delta) <= 1e-12) {
                if (origin < -extent || origin > extent) return false;
                continue;
            }
            double near = (-extent - origin) / delta;
            double far = (extent - origin) / delta;
            if (near > far) {
                double swap = near;
                near = far;
                far = swap;
            }
            minimum = Math.max(minimum, near);
            maximum = Math.min(maximum, far);
            if (minimum > maximum) return false;
        }
        return maximum >= 0 && minimum <= 1;
    }

    private static double finiteOrZero(double value) {
        return Double.isFinite(value) ? value : 0;
    }

    /** Returns whether two line segments come within the supplied distance. */
    public static boolean segmentsWithinDistance(
            double firstStartX, double firstStartY, double firstEndX, double firstEndY,
            double secondStartX, double secondStartY, double secondEndX, double secondEndY,
            double maxDistance) {
        if (segmentsIntersect(firstStartX, firstStartY, firstEndX, firstEndY,
                secondStartX, secondStartY, secondEndX, secondEndY)) return true;
        return Math.min(
                pointToSegmentDistance(firstStartX, firstStartY, secondStartX, secondStartY, secondEndX, secondEndY),
                Math.min(
                        pointToSegmentDistance(firstEndX, firstEndY, secondStartX, secondStartY, secondEndX, secondEndY),
                        Math.min(
                                pointToSegmentDistance(secondStartX, secondStartY, firstStartX, firstStartY, firstEndX, firstEndY),
                                pointToSegmentDistance(secondEndX, secondEndY, firstStartX, firstStartY, firstEndX, firstEndY))))
                <= maxDistance;
    }

    private static double pointToSegmentDistance(double pointX, double pointY,
                                                 double startX, double startY,
                                                 double endX, double endY) {
        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0
                ? clamp(((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared, 0, 1)
                : 0;
        return between(pointX, pointY, startX + dx * t, startY + dy * t);
    }

    private static boolean segmentIntersectsSectorAtCenter(
            double sourceX, double sourceY,
            double startX, double startY, double endX, double endY,
            double rotationDegrees, double range, double halfArc) {
        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        if (pointInSector(sourceX, sourceY, startX, startY, rotationDegrees, range, halfArc)
                || pointInSector(sourceX, sourceY, endX, endY, rotationDegrees, range, halfArc)) return true;
        if (lengthSquared > 0) {
            double t = clamp(((sourceX - startX) * dx + (sourceY - startY) * dy) / lengthSquared, 0, 1);
            if (pointInSector(sourceX, sourceY, startX + dx * t, startY + dy * t,
                    rotationDegrees, range, halfArc)) return true;
        }
        for (double boundary : new double[]{rotationDegrees - halfArc, rotationDegrees + halfArc}) {
            double radians = AngleCalculator.compassRadians(boundary);
            double edgeX = Math.cos(radians);
            double edgeY = Math.sin(radians);
            double denominator = dx * edgeY - dy * edgeX;
            if (Math.abs(denominator) <= 1e-9) continue;
            double sourceToStartX = sourceX - startX;
            double sourceToStartY = sourceY - startY;
            double t = (sourceToStartX * edgeY - sourceToStartY * edgeX) / denominator;
            double rayDistance = (sourceToStartX * dy - sourceToStartY * dx) / denominator;
            if (t >= 0 && t <= 1 && rayDistance >= 0 && rayDistance <= range
                    && pointInSector(sourceX, sourceY, startX + dx * t, startY + dy * t,
                    rotationDegrees, range, halfArc)) return true;
        }
        return false;
    }

    private static boolean pointInSector(double sourceX, double sourceY,
                                         double pointX, double pointY,
                                         double rotationDegrees, double range, double halfArc) {
        double dx = pointX - sourceX;
        double dy = pointY - sourceY;
        double distance = Math.hypot(dx, dy);
        if (distance > range + 1e-9) return false;
        if (distance <= 0.001 || halfArc >= 180 - 1e-9) return true;
        return Math.abs(AngleCalculator.shortestDelta(rotationDegrees,
                AngleCalculator.vectorBearing(dx, dy))) <= halfArc + 1e-9;
    }

    private static double segmentToCircularArcDistance(
            double startX, double startY, double endX, double endY,
            double sourceX, double sourceY, double range,
            double rotationDegrees, double halfArc) {
        if (range <= 0) return pointToSegmentDistance(sourceX, sourceY, startX, startY, endX, endY);
        double firstRadians = AngleCalculator.compassRadians(rotationDegrees - halfArc);
        double secondRadians = AngleCalculator.compassRadians(rotationDegrees + halfArc);
        double firstBoundaryX = sourceX + Math.cos(firstRadians) * range;
        double firstBoundaryY = sourceY + Math.sin(firstRadians) * range;
        double secondBoundaryX = sourceX + Math.cos(secondRadians) * range;
        double secondBoundaryY = sourceY + Math.sin(secondRadians) * range;
        double minimum = Math.min(
                pointToArcDistance(startX, startY, sourceX, sourceY, range,
                        rotationDegrees, halfArc, firstBoundaryX, firstBoundaryY, secondBoundaryX, secondBoundaryY),
                Math.min(
                        pointToArcDistance(endX, endY, sourceX, sourceY, range,
                                rotationDegrees, halfArc, firstBoundaryX, firstBoundaryY, secondBoundaryX, secondBoundaryY),
                        Math.min(
                                pointToSegmentDistance(firstBoundaryX, firstBoundaryY, startX, startY, endX, endY),
                                pointToSegmentDistance(secondBoundaryX, secondBoundaryY, startX, startY, endX, endY))));

        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0) return minimum;
        double t = clamp(((sourceX - startX) * dx + (sourceY - startY) * dy) / lengthSquared, 0, 1);
        double closestX = startX + dx * t;
        double closestY = startY + dy * t;
        if (pointAngleInSector(closestX, closestY, sourceX, sourceY, rotationDegrees, halfArc)) {
            minimum = Math.min(minimum, Math.abs(Math.hypot(closestX - sourceX, closestY - sourceY) - range));
        }

        double offsetX = startX - sourceX;
        double offsetY = startY - sourceY;
        double b = 2 * (offsetX * dx + offsetY * dy);
        double c = offsetX * offsetX + offsetY * offsetY - range * range;
        double discriminant = b * b - 4 * lengthSquared * c;
        if (discriminant >= 0) {
            double root = Math.sqrt(discriminant);
            for (double intersection : new double[]{
                    (-b - root) / (2 * lengthSquared),
                    (-b + root) / (2 * lengthSquared)}) {
                if (intersection < 0 || intersection > 1) continue;
                double pointX = startX + dx * intersection;
                double pointY = startY + dy * intersection;
                if (pointAngleInSector(pointX, pointY, sourceX, sourceY, rotationDegrees, halfArc)) return 0;
            }
        }
        return minimum;
    }

    private static double pointToArcDistance(
            double pointX, double pointY, double sourceX, double sourceY,
            double range, double rotationDegrees, double halfArc,
            double firstBoundaryX, double firstBoundaryY,
            double secondBoundaryX, double secondBoundaryY) {
        if (pointAngleInSector(pointX, pointY, sourceX, sourceY, rotationDegrees, halfArc)) {
            return Math.abs(Math.hypot(pointX - sourceX, pointY - sourceY) - range);
        }
        return Math.min(
                between(pointX, pointY, firstBoundaryX, firstBoundaryY),
                between(pointX, pointY, secondBoundaryX, secondBoundaryY));
    }

    private static boolean pointAngleInSector(double pointX, double pointY,
                                              double sourceX, double sourceY,
                                              double rotationDegrees, double halfArc) {
        double dx = pointX - sourceX;
        double dy = pointY - sourceY;
        if (Math.hypot(dx, dy) <= 0.001 || halfArc >= 180 - 1e-9) return true;
        return Math.abs(AngleCalculator.shortestDelta(rotationDegrees,
                AngleCalculator.vectorBearing(dx, dy))) <= halfArc + 1e-9;
    }

    private static boolean segmentsIntersect(double firstStartX, double firstStartY,
                                             double firstEndX, double firstEndY,
                                             double secondStartX, double secondStartY,
                                             double secondEndX, double secondEndY) {
        double first = orientation(firstStartX, firstStartY, firstEndX, firstEndY, secondStartX, secondStartY);
        double second = orientation(firstStartX, firstStartY, firstEndX, firstEndY, secondEndX, secondEndY);
        double third = orientation(secondStartX, secondStartY, secondEndX, secondEndY, firstStartX, firstStartY);
        double fourth = orientation(secondStartX, secondStartY, secondEndX, secondEndY, firstEndX, firstEndY);
        double epsilon = 1e-9;
        return ((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
                && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))
                || Math.abs(first) <= epsilon && onSegment(firstStartX, firstStartY, firstEndX, firstEndY, secondStartX, secondStartY)
                || Math.abs(second) <= epsilon && onSegment(firstStartX, firstStartY, firstEndX, firstEndY, secondEndX, secondEndY)
                || Math.abs(third) <= epsilon && onSegment(secondStartX, secondStartY, secondEndX, secondEndY, firstStartX, firstStartY)
                || Math.abs(fourth) <= epsilon && onSegment(secondStartX, secondStartY, secondEndX, secondEndY, firstEndX, firstEndY);
    }

    private static double orientation(double startX, double startY, double endX, double endY,
                                      double pointX, double pointY) {
        return (endX - startX) * (pointY - startY) - (endY - startY) * (pointX - startX);
    }

    private static boolean onSegment(double startX, double startY, double endX, double endY,
                                     double pointX, double pointY) {
        return pointX >= Math.min(startX, endX) - 1e-9 && pointX <= Math.max(startX, endX) + 1e-9
                && pointY >= Math.min(startY, endY) - 1e-9 && pointY <= Math.max(startY, endY) + 1e-9;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
