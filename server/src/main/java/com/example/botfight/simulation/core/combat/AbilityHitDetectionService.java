package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;
import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;
import static com.example.botfight.simulation.geometry.DistanceCalculator.rayIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentsWithinDistance;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/** Resolves declarative ability delivery geometry for bots and arena entities. */
@Service
final class AbilityHitDetectionService {
    boolean abilityHitsTarget(Bot attacker, Bot defender, AbilityExecutionPayload payload) {
        if (attacker == null || defender == null || payload == null) return false;
        DeliveryType delivery = payload.contract().delivery();
        if (delivery == DeliveryType.SELF) return true;
        if (delivery == DeliveryType.RAY) {
            return movingRayHits(payload, attacker, defender);
        }
        if (delivery != DeliveryType.MELEE && delivery != DeliveryType.RADIAL) return false;
        return movingRangeHits(attacker, defender, payload);
    }

    private boolean movingRangeHits(Bot attacker, Bot defender, AbilityExecutionPayload payload) {
        DeliveryType delivery = payload.contract().delivery();
        double sourceX = sourceX(attacker, payload);
        double sourceY = sourceY(attacker, payload);
        double targetRadius = payload.contract().includeTargetRadius() ? defender.size / 2.0 : 0;
        if (delivery == DeliveryType.RADIAL) {
            return segmentIntersectsCircle(defender.movementStartX, defender.movementStartY,
                    defender.x, defender.y, sourceX, sourceY,
                    Abilities.range(payload.abilityId()) + targetRadius);
        }
        return segmentIntersectsArc(sourceX, sourceY,
                defender.movementStartX, defender.movementStartY, defender.x, defender.y,
                sourceRotation(attacker, payload), Abilities.range(payload.abilityId()) + targetRadius,
                Abilities.arcDegrees(payload.abilityId()) / 2.0);
    }

    private boolean movingRayHits(AbilityExecutionPayload payload, Bot source, Bot target) {
        double radians = compassRadians(sourceRotation(source, payload));
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double targetRadius = target.size / 2.0;
        double originX = sourceX(source, payload);
        double originY = sourceY(source, payload);
        return segmentsWithinDistance(
                originX, originY,
                originX + directionX * Abilities.range(payload.abilityId()),
                originY + directionY * Abilities.range(payload.abilityId()),
                target.movementStartX, target.movementStartY, target.x, target.y, targetRadius);
    }

    private static boolean segmentIntersectsArc(double sourceX, double sourceY,
                                                double startX, double startY,
                                                double endX, double endY,
                                                double rotation, double range, double halfArc) {
        List<Double> candidates = new ArrayList<>(List.of(0.0, 1.0));
        double dx = endX - startX;
        double dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        if (lengthSquared > 0) {
            candidates.add(clamp(((sourceX - startX) * dx + (sourceY - startY) * dy) / lengthSquared, 0, 1));
        }
        for (double boundary : new double[]{rotation - halfArc, rotation + halfArc}) {
            double radians = compassRadians(boundary);
            double edgeX = Math.cos(radians);
            double edgeY = Math.sin(radians);
            double denominator = dx * edgeY - dy * edgeX;
            if (Math.abs(denominator) <= 1e-9) continue;
            double sourceToStartX = sourceX - startX;
            double sourceToStartY = sourceY - startY;
            double t = (sourceToStartX * edgeY - sourceToStartY * edgeX) / denominator;
            double rayDistance = (sourceToStartX * dy - sourceToStartY * dx) / denominator;
            if (t >= 0 && t <= 1 && rayDistance >= 0 && rayDistance <= range) candidates.add(t);
        }
        return candidates.stream().anyMatch(t -> pointInArc(
                sourceX, sourceY, startX + dx * t, startY + dy * t, rotation, range, halfArc));
    }

    private static boolean pointInArc(double sourceX, double sourceY, double pointX, double pointY,
                                      double rotation, double range, double halfArc) {
        double dx = pointX - sourceX;
        double dy = pointY - sourceY;
        double distance = Math.hypot(dx, dy);
        return distance <= range && (distance <= 0.001
                || Math.abs(shortestDelta(rotation, vectorBearing(dx, dy))) <= halfArc);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    boolean rayHits(AbilityExecutionPayload payload, Bot source,
                    double targetX, double targetY, double targetRadius) {
        double radians = compassRadians(sourceRotation(source, payload));
        return rayIntersectsCircle(sourceX(source, payload), sourceY(source, payload),
                Math.cos(radians), Math.sin(radians), Abilities.range(payload.abilityId()),
                targetX, targetY, targetRadius);
    }

    boolean abilityRangeHits(Bot attacker, double targetX, double targetY,
                            double targetSize, AbilityExecutionPayload payload, double range) {
        if (payload == null || (payload.contract().delivery() != DeliveryType.RADIAL
                && payload.contract().delivery() != DeliveryType.MELEE)) return false;
        double sourceX = sourceX(attacker, payload);
        double sourceY = sourceY(attacker, payload);
        double dx = targetX - sourceX, dy = targetY - sourceY;
        double targetRadius = payload.contract().includeTargetRadius() ? targetSize / 2.0 : 0;
        if (Math.hypot(dx, dy) > range + targetRadius) return false;
        return payload.contract().delivery() == DeliveryType.RADIAL
                || Math.abs(shortestDelta(sourceRotation(attacker, payload), vectorBearing(dx, dy)))
                        <= Abilities.arcDegrees(payload.abilityId()) / 2.0;
    }

    boolean isDirectDelivery(DeliveryType delivery) {
        return delivery == DeliveryType.SELF || delivery == DeliveryType.MELEE
                || delivery == DeliveryType.RAY || delivery == DeliveryType.RADIAL;
    }

    private static double sourceX(Bot source, AbilityExecutionPayload payload) {
        return payload.hasCapturedPose() ? payload.capturedOriginX() : source.x;
    }

    private static double sourceY(Bot source, AbilityExecutionPayload payload) {
        return payload.hasCapturedPose() ? payload.capturedOriginY() : source.y;
    }

    private static double sourceRotation(Bot source, AbilityExecutionPayload payload) {
        return payload.hasCapturedPose() ? payload.capturedRotation() : source.rotation;
    }
}
