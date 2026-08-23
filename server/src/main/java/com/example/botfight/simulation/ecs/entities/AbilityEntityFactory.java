package com.example.botfight.simulation.ecs.entities;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import java.util.Set;

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

        int size = (int) Math.round(EntityContracts.stat(abilityId, contract.collider().sizeStat(), 0));
        EntityContracts.Spawn spawn = contract.spawn();
        EntityContracts.Motion motion = contract.motion();
        double speed = motion.speedStat() == null ? 0
                : EntityContracts.stat(abilityId, motion.speedStat(), 0);
        double rotation = spawn.rotation() == EntityContracts.RotationMode.ZERO ? 0 : ownerRotation;
        double x = ownerX;
        double y = ownerY;
        double directionX = 0;
        double directionY = 0;
        if (spawn.mode() == EntityContracts.SpawnMode.FORWARD) {
            double radians = compassRadians(ownerRotation);
            directionX = Math.cos(radians);
            directionY = Math.sin(radians);
            double distance = ownerSize / 2.0 + size / 2.0 + spawn.padding();
            x += directionX * distance;
            y += directionY * distance;
        } else if (spawn.mode() == EntityContracts.SpawnMode.TARGET) {
            x = finiteOrDefault(targetX, spawn.defaultX());
            y = finiteOrDefault(targetY, spawn.defaultY());
            if (spawn.clampToRadiusStat() != null) {
                double radius = EntityContracts.stat(abilityId, spawn.clampToRadiusStat(), 0);
                x = clamp(x, radius, arenaWidth - radius);
                y = clamp(y, radius, arenaHeight - radius);
            }
        } else if (spawn.mode() == EntityContracts.SpawnMode.SELF
                && speed > 0
                && (contract.factory() == EntityContracts.FactoryType.THROWN_ZONE
                || (contract.behavior() != null
                && contract.behavior().kind() == EntityContracts.BehaviorKind.SUMMON))) {
            double radians = compassRadians(ownerRotation);
            directionX = Math.cos(radians);
            directionY = Math.sin(radians);
        }

        double traveled = motion.initialTraveled();
        EntityContracts.Lifetime lifetime = contract.lifetime();
        int timer = switch (lifetime.timerMode()) {
            case REMAINING, FUSE -> (int) Math.round(EntityContracts.stat(abilityId, lifetime.stat(), 0)) + lifetime.add();
            default -> 0;
        };
        int hp = contract.health() == null
                ? 0
                : (int) Math.round(EntityContracts.stat(abilityId, contract.health().hpStat(), 0));
        boolean armed = contract.initialState().armed();
        double entityDamageMultiplier = contract.initialState().damageMultiplierFromOwner()
                ? Math.max(0, damageMultiplier) : 1.0;

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
                Set.of(),
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
