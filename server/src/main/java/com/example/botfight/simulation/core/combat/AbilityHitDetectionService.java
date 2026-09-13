package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;
import static com.example.botfight.simulation.geometry.DistanceCalculator.rayIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsCircle;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentIntersectsSector;
import static com.example.botfight.simulation.geometry.DistanceCalculator.segmentsWithinDistance;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingRectangleCollision;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import org.springframework.stereotype.Service;

/** Resolves declarative attached-phase geometry for bots and arena entities. */
@Service
final class AbilityHitDetectionService {
    boolean abilityHitsTarget(Bot attacker, Bot defender, AbilityExecutionPayload payload) {
        if (attacker == null || defender == null || payload == null) return false;
        if (!AbilityContracts.isAttachedAbility(payload.abilityId())) return false;
        AbilityContracts.AbilityPhase phase = phase(payload);
        if (AbilityContracts.targetsOwner(payload.abilityId())) return true;
        String shape = shape(phase);
        if ("ray".equals(shape)) {
            return movingRayHits(payload, phase, attacker, defender);
        }
        if (!"arc".equals(shape) && !"rectangle".equals(shape) && !"circle".equals(shape)) return false;
        return movingRangeHits(attacker, defender, payload, phase);
    }

    private boolean movingRangeHits(Bot attacker, Bot defender, AbilityExecutionPayload payload,
                                    AbilityContracts.AbilityPhase phase) {
        String shape = shape(phase);
        double sourceX = sourceX(attacker, payload);
        double sourceY = sourceY(attacker, payload);
        double targetRadius = includesTargetRadius(phase) ? defender.size / 2.0 : 0;
        if ("circle".equals(shape)) {
            return segmentIntersectsCircle(defender.movementStartX, defender.movementStartY,
                    defender.x, defender.y, sourceX, sourceY,
                    numeric(hitbox(phase).radius(), 0) + targetRadius);
        }
        if ("rectangle".equals(shape)) {
            double range = rectangleLength(phase, 0);
            double radians = compassRadians(sourceRotation(attacker, payload));
            double centerX = sourceX + Math.cos(radians) * range / 2.0;
            double centerY = sourceY + Math.sin(radians) * range / 2.0;
            return movingRectangleCollision(
                    centerX, centerY, centerX, centerY,
                    range, numeric(hitbox(phase).width(), 60), radians,
                    defender.movementStartX, defender.movementStartY,
                    defender.x, defender.y, targetRadius).hit();
        }
        return segmentIntersectsSector(sourceX, sourceY,
                defender.movementStartX, defender.movementStartY, defender.x, defender.y,
                sourceRotation(attacker, payload),
                numeric(hitbox(phase).range(), 0),
                numeric(hitbox(phase).arc(), 0) / 2.0,
                targetRadius);
    }

    private boolean movingRayHits(AbilityExecutionPayload payload, AbilityContracts.AbilityPhase phase,
                                  Bot source, Bot target) {
        double radians = compassRadians(sourceRotation(source, payload));
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double targetRadius = target.size / 2.0;
        double rayWidth = numeric(hitbox(phase).width(), 5);
        double effectiveDistance = targetRadius + (Double.isFinite(rayWidth) && rayWidth > 0 ? rayWidth : 5) / 2.0;
        double originX = sourceX(source, payload);
        double originY = sourceY(source, payload);
        return segmentsWithinDistance(
                originX, originY,
                originX + directionX * numeric(hitbox(phase).range(), 0),
                originY + directionY * numeric(hitbox(phase).range(), 0),
                target.movementStartX, target.movementStartY, target.x, target.y, effectiveDistance);
    }

    boolean rayHits(AbilityExecutionPayload payload, Bot source,
                    double targetX, double targetY, double targetRadius) {
        double radians = compassRadians(sourceRotation(source, payload));
        AbilityContracts.AbilityPhase phase = phase(payload);
        double rayWidth = numeric(hitbox(phase).width(), 5);
        double effectiveRadius = targetRadius + (Double.isFinite(rayWidth) && rayWidth > 0 ? rayWidth : 5) / 2.0;
        double range = numeric(hitbox(phase).range(), 0);
        return rayIntersectsCircle(sourceX(source, payload), sourceY(source, payload),
                Math.cos(radians), Math.sin(radians), range,
                targetX, targetY, effectiveRadius);
    }

    boolean abilityRangeHits(Bot attacker, double targetX, double targetY,
                            double targetSize, AbilityExecutionPayload payload, double range) {
        if (payload == null) return false;
        double sourceX = sourceX(attacker, payload);
        double sourceY = sourceY(attacker, payload);
        AbilityContracts.AbilityPhase phase = phase(payload);
        double targetRadius = includesTargetRadius(phase) ? targetSize / 2.0 : 0;
        String shape = shape(phase);
        if ("rectangle".equals(shape)) {
            double radians = compassRadians(sourceRotation(attacker, payload));
            double effectiveLength = rectangleLength(phase, range);
            double effectiveWidth = numeric(hitbox(phase).width(), 60);
            double centerX = sourceX + Math.cos(radians) * effectiveLength / 2.0;
            double centerY = sourceY + Math.sin(radians) * effectiveLength / 2.0;
            return movingRectangleCollision(
                    centerX, centerY, centerX, centerY,
                    effectiveLength, effectiveWidth, radians,
                    targetX, targetY, targetX, targetY, targetRadius).hit();
        }
        double effectiveRange = "circle".equals(shape)
                ? numeric(hitbox(phase).radius(), range)
                : numeric(hitbox(phase).range(), range);
        if ("circle".equals(shape)) {
            return Math.hypot(targetX - sourceX, targetY - sourceY) <= effectiveRange + targetRadius;
        }
        return segmentIntersectsSector(sourceX, sourceY, targetX, targetY, targetX, targetY,
                sourceRotation(attacker, payload), effectiveRange,
                numeric(hitbox(phase).arc(), 0) / 2.0,
                targetRadius);
    }

    double phaseRange(AbilityExecutionPayload payload, double fallback) {
        AbilityContracts.AbilityPhase phase = phase(payload);
        AbilityContracts.Hitbox hitbox = hitbox(phase);
        if ("circle".equals(hitbox.shape())) return numeric(hitbox.radius(), fallback);
        if ("rectangle".equals(hitbox.shape())) return rectangleLength(phase, fallback);
        return numeric(hitbox.range(), fallback);
    }

    boolean isAttachedAbility(AbilityExecutionPayload payload) {
        return payload != null && AbilityContracts.isAttachedAbility(payload.abilityId());
    }

    boolean hasActivationEvent(AbilityExecutionPayload payload) {
        if (payload == null || payload.phases().isEmpty()) return false;
        AbilityContracts.PhaseEvent event = payload.phases().getFirst().events()
                .get(AbilityContracts.PhaseEventType.ACTIVATION);
        return event != null;
    }

    private static AbilityContracts.AbilityPhase phase(AbilityExecutionPayload payload) {
        return payload == null || payload.phases().isEmpty()
                ? null : payload.phases().getFirst();
    }

    private static final AbilityContracts.Hitbox EMPTY_HITBOX =
            new AbilityContracts.Hitbox(null, null, null, null, 1.0, null, null, false);

    private static AbilityContracts.Hitbox hitbox(AbilityContracts.AbilityPhase phase) {
        return phase == null || phase.hitbox() == null ? EMPTY_HITBOX : phase.hitbox();
    }

    private static String shape(AbilityContracts.AbilityPhase phase) {
        return hitbox(phase).shape();
    }

    private static boolean includesTargetRadius(AbilityContracts.AbilityPhase phase) {
        return hitbox(phase).includeTargetRadius();
    }

    private static double rectangleLength(AbilityContracts.AbilityPhase phase, double fallback) {
        AbilityContracts.Hitbox hitbox = hitbox(phase);
        return numeric(hitbox.length() == null ? hitbox.range() : hitbox.length(), fallback);
    }

    private static double numeric(Double value, double fallback) {
        return value == null || !Double.isFinite(value) ? fallback : value;
    }

    private static double sourceX(Bot source, AbilityExecutionPayload payload) {
        return payload.pose(source).x();
    }

    private static double sourceY(Bot source, AbilityExecutionPayload payload) {
        return payload.pose(source).y();
    }

    private static double sourceRotation(Bot source, AbilityExecutionPayload payload) {
        return payload.pose(source).rotation();
    }
}
