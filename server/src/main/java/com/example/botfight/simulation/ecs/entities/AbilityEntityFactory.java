package com.example.botfight.simulation.ecs.entities;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;
import java.util.Map;

/** Creates initial entity state from the declarative entity contract. */
public final class AbilityEntityFactory {
    private AbilityEntityFactory() {}

    /**
     * Generic spawn route used by both configured abilities and short-lived
     * projectiles. Target coordinates are only read for target-spawned
     * contracts; non-finite values use the contract default.
     */
    public static ArenaEntity create(
            String id,
            int abilityId,
            int ownerSlot,
            double ownerX,
            double ownerY,
            double ownerSize,
            double ownerRotation,
            double damageMultiplier,
            double targetX,
            double targetY,
            double arenaWidth,
            double arenaHeight) {
        EntityContracts.EntityContract contract = EntityContracts.forAbility(abilityId);
        if (contract == null) throw new IllegalArgumentException("No entity contract for ability: " + abilityId);

        int size = (int) Math.round(contract.collider().size()
                * contract.collider().sizeMultiplier());
        EntityContracts.Spawn spawn = contract.spawn();
        AttachedAbilityContracts.AbilityPhase firstPhase = contract.phases().isEmpty()
                ? null : contract.phases().getFirst();
        double speed = firstPhase == null || firstPhase.movement() == null
                ? 0 : firstPhase.movement().speed();
        double rotation = spawn.rotation() == EntityContracts.RotationMode.ZERO ? 0 : ownerRotation;
        double x = ownerX;
        double y = ownerY;
        double directionX = 0;
        double directionY = 0;
        if (spawn.targetPosition()) {
            x = finiteOrDefault(targetX, spawn.defaultX());
            y = finiteOrDefault(targetY, spawn.defaultY());
            if (spawn.clampToRadius() > 0) {
                double radius = spawn.clampToRadius();
                x = clamp(x, radius, arenaWidth - radius);
                y = clamp(y, radius, arenaHeight - radius);
            }
        } else {
            double radians = compassRadians(ownerRotation);
            double forwardX = Math.cos(radians);
            double forwardY = Math.sin(radians);
            double rightRadians = compassRadians(ownerRotation + 90);
            double rightX = Math.cos(rightRadians);
            double rightY = Math.sin(rightRadians);
            double localY = spawn.offsetY();
            x += rightX * spawn.offsetX() + forwardX * localY;
            y += rightY * spawn.offsetX() + forwardY * localY;
            if (speed > 0) {
                directionX = forwardX;
                directionY = forwardY;
            }
        }

        double traveled = 0;
        EntityContracts.Lifetime lifetime = contract.lifetime();
        int timer = switch (lifetime.timerMode()) {
            case REMAINING, FUSE -> lifetime.duration() + lifetime.add();
            default -> 0;
        };
        int hp = contract.health() == null
                ? 0
                : (int) Math.round(contract.health().hp());
        boolean armed = contract.initialState().armed();
        double entityDamageMultiplier = contract.initialState().damageMultiplierFromOwner()
                ? Math.max(0, damageMultiplier) : 1.0;
        String phaseId = firstPhase == null ? null : firstPhase.id();
        // Static Snare starts in an event-controlled armed phase. Other
        // entities are allowed to advance from their first phase by elapsed
        // time until a transition action locks them to a later phase.
        boolean phaseLocked = abilityId == 29;

        return new ArenaEntity(
                id,
                contract.runtimeType(),
                ownerSlot,
                x,
                y,
                size,
                directionX * speed,
                directionY * speed,
                traveled,
                timer,
                armed,
                hp,
                0,
                entityDamageMultiplier,
                abilityId,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                rotation,
                Map.of(),
                phaseId,
                phaseLocked,
                0,
                null,
                0,
                0);
    }

    private static double compassRadians(double degrees) {
        return Math.toRadians(degrees - 90.0);
    }

    private static double finiteOrDefault(double value, double fallback) {
        return Double.isFinite(value) ? value : fallback;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
