package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;
import static com.example.botfight.simulation.geometry.DistanceCalculator.rayIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsSector;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentsWithinDistance;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingRectangleCollision;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType;
import com.example.botfight.simulation.gameconfig.AbilityContracts.HitboxGeometry;
import org.springframework.stereotype.Service;

/** Resolves declarative ability delivery geometry for bots and arena entities. */
@Service
final class AbilityHitDetectionService {
    boolean abilityHitsTarget(Bot attacker, Bot defender, AbilityExecutionPayload payload) {
        if (attacker == null || defender == null || payload == null) return false;
        DeliveryType delivery = payload.contract().delivery();
        AbilityContracts.AbilityPhase phase = phase(payload);
        if (delivery == DeliveryType.SELF) return true;
        if (delivery == DeliveryType.RAY) {
            return movingRayHits(payload, phase, attacker, defender);
        }
        if (delivery != DeliveryType.MELEE && delivery != DeliveryType.RADIAL) return false;
        return movingRangeHits(attacker, defender, payload, phase);
    }

    private boolean movingRangeHits(Bot attacker, Bot defender, AbilityExecutionPayload payload,
                                    AbilityContracts.AbilityPhase phase) {
        DeliveryType delivery = payload.contract().delivery();
        double sourceX = sourceX(attacker, payload);
        double sourceY = sourceY(attacker, payload);
        double targetRadius = payload.contract().includeTargetRadius() ? defender.size / 2.0 : 0;
        if (delivery == DeliveryType.RADIAL) {
            return segmentIntersectsCircle(defender.movementStartX, defender.movementStartY,
                    defender.x, defender.y, sourceX, sourceY,
                    phaseNumber(phase == null ? null : phase.hitbox().get("radius"),
                            payload.abilityId(), Abilities.radius(payload.abilityId())) + targetRadius);
        }
        if (payload.contract().hitboxGeometry() == HitboxGeometry.RECTANGLE) {
            double range = phaseNumber(phase == null ? null
                            : phase.hitbox().getOrDefault("length", phase.hitbox().get("range")),
                    payload.abilityId(), Abilities.range(payload.abilityId()));
            double radians = compassRadians(sourceRotation(attacker, payload));
            double centerX = sourceX + Math.cos(radians) * range / 2.0;
            double centerY = sourceY + Math.sin(radians) * range / 2.0;
            return movingRectangleCollision(
                    centerX, centerY, centerX, centerY,
                    range, phaseNumber(phase == null ? null : phase.hitbox().get("width"),
                            payload.abilityId(), Abilities.stat(payload.abilityId(), "hitboxWidth", 60)), radians,
                    defender.movementStartX, defender.movementStartY,
                    defender.x, defender.y, targetRadius).hit();
        }
        return segmentIntersectsSector(sourceX, sourceY,
                defender.movementStartX, defender.movementStartY, defender.x, defender.y,
                sourceRotation(attacker, payload),
                phaseNumber(phase == null ? null : phase.hitbox().get("range"),
                        payload.abilityId(), Abilities.range(payload.abilityId())),
                phaseNumber(phase == null ? null : phase.hitbox().get("arc"),
                        payload.abilityId(), Abilities.arc(payload.abilityId())) / 2.0,
                targetRadius);
    }

    private boolean movingRayHits(AbilityExecutionPayload payload, AbilityContracts.AbilityPhase phase,
                                  Bot source, Bot target) {
        double radians = compassRadians(sourceRotation(source, payload));
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double targetRadius = target.size / 2.0;
        double rayWidth = phaseNumber(phase == null ? null : phase.hitbox().get("width"),
                payload.abilityId(), Abilities.stat(payload.abilityId(), "hitboxWidth", 5));
        double effectiveDistance = targetRadius + (Double.isFinite(rayWidth) && rayWidth > 0 ? rayWidth : 5) / 2.0;
        double originX = sourceX(source, payload);
        double originY = sourceY(source, payload);
        return segmentsWithinDistance(
                originX, originY,
                originX + directionX * phaseNumber(phase == null ? null : phase.hitbox().get("range"),
                        payload.abilityId(), Abilities.range(payload.abilityId())),
                originY + directionY * phaseNumber(phase == null ? null : phase.hitbox().get("range"),
                        payload.abilityId(), Abilities.range(payload.abilityId())),
                target.movementStartX, target.movementStartY, target.x, target.y, effectiveDistance);
    }

    boolean rayHits(AbilityExecutionPayload payload, Bot source,
                    double targetX, double targetY, double targetRadius) {
        double radians = compassRadians(sourceRotation(source, payload));
        AbilityContracts.AbilityPhase phase = phase(payload);
        double rayWidth = phaseNumber(phase == null ? null : phase.hitbox().get("width"),
                payload.abilityId(), Abilities.stat(payload.abilityId(), "hitboxWidth", 5));
        double effectiveRadius = targetRadius + (Double.isFinite(rayWidth) && rayWidth > 0 ? rayWidth : 5) / 2.0;
        double range = phaseNumber(phase == null ? null : phase.hitbox().get("range"),
                payload.abilityId(), Abilities.range(payload.abilityId()));
        return rayIntersectsCircle(sourceX(source, payload), sourceY(source, payload),
                Math.cos(radians), Math.sin(radians), range,
                targetX, targetY, effectiveRadius);
    }

    boolean abilityRangeHits(Bot attacker, double targetX, double targetY,
                            double targetSize, AbilityExecutionPayload payload, double range) {
        if (payload == null || (payload.contract().delivery() != DeliveryType.RADIAL
                && payload.contract().delivery() != DeliveryType.MELEE)) return false;
        double sourceX = sourceX(attacker, payload);
        double sourceY = sourceY(attacker, payload);
        AbilityContracts.AbilityPhase phase = phase(payload);
        double targetRadius = payload.contract().includeTargetRadius() ? targetSize / 2.0 : 0;
        if (payload.contract().hitboxGeometry() == HitboxGeometry.RECTANGLE) {
            double radians = compassRadians(sourceRotation(attacker, payload));
            double effectiveLength = phaseNumber(phase == null ? null
                            : phase.hitbox().getOrDefault("length", phase.hitbox().get("range")),
                    payload.abilityId(), range);
            double effectiveWidth = phaseNumber(phase == null ? null : phase.hitbox().get("width"),
                    payload.abilityId(), Abilities.stat(payload.abilityId(), "hitboxWidth", 60));
            double centerX = sourceX + Math.cos(radians) * effectiveLength / 2.0;
            double centerY = sourceY + Math.sin(radians) * effectiveLength / 2.0;
            return movingRectangleCollision(
                    centerX, centerY, centerX, centerY,
                    effectiveLength, effectiveWidth, radians,
                    targetX, targetY, targetX, targetY, targetRadius).hit();
        }
        double effectiveRange = payload.contract().delivery() == DeliveryType.RADIAL
                ? phaseNumber(phase == null ? null : phase.hitbox().get("radius"), payload.abilityId(), range)
                : phaseNumber(phase == null ? null : phase.hitbox().get("range"), payload.abilityId(), range);
        if (payload.contract().delivery() == DeliveryType.RADIAL) {
            return Math.hypot(targetX - sourceX, targetY - sourceY) <= effectiveRange + targetRadius;
        }
        return segmentIntersectsSector(sourceX, sourceY, targetX, targetY, targetX, targetY,
                sourceRotation(attacker, payload), effectiveRange,
                phaseNumber(phase == null ? null : phase.hitbox().get("arc"),
                        payload.abilityId(), Abilities.arc(payload.abilityId())) / 2.0,
                targetRadius);
    }

    boolean isDirectDelivery(DeliveryType delivery) {
        return delivery == DeliveryType.SELF || delivery == DeliveryType.MELEE
                || delivery == DeliveryType.RAY || delivery == DeliveryType.RADIAL;
    }

    private static AbilityContracts.AbilityPhase phase(AbilityExecutionPayload payload) {
        return payload == null || payload.contract().phases().isEmpty()
                ? null : payload.contract().phases().getFirst();
    }

    private static double phaseNumber(String value, int abilityId, double fallback) {
        if (value == null) return fallback;
        try {
            return Double.parseDouble(value);
        } catch (NumberFormatException ignored) {
            return Abilities.stat(abilityId, value, fallback);
        }
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
