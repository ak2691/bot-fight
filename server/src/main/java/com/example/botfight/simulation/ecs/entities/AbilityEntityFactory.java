package com.example.botfight.simulation.ecs.entities;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import java.util.List;
import java.util.Map;

/** Creates initial entity state from the declarative entity contract. */
public final class AbilityEntityFactory {
    private AbilityEntityFactory() {}

    /** Where one entity of a spawn pattern goes: a heading offset in degrees and a sideways offset in units. */
    public record Placement(double angle, double lateral) {
        public static final Placement AHEAD = new Placement(0, 0);
    }

    /**
     * The placements a spawn pattern describes, in index order. No pattern is one entity straight ahead; a fan
     * spreads {@code spreadDeg} across the heading, a ring is evenly spaced, a line is spaced sideways.
     */
    public static List<Placement> placements(AbilityContracts.SpawnPattern pattern) {
        if (pattern == null) return List.of(Placement.AHEAD);
        int count = Math.max(1, pattern.count());
        List<Placement> placements = new java.util.ArrayList<>();
        for (int index = 0; index < count; index += 1) {
            placements.add(switch (pattern.type()) {
                case FAN -> new Placement(count == 1 ? 0
                        : -pattern.spreadDeg() / 2 + index * pattern.spreadDeg() / (count - 1), 0);
                case RING -> new Placement(360.0 * index / count, 0);
                case LINE -> new Placement(0, (index - (count - 1) / 2.0) * pattern.spacing());
            });
        }
        return placements;
    }

    /** The single entity of the ability's spawn verb, placed straight ahead. */
    public static ArenaEntity create(
            String id, int abilityId, int ownerSlot, double ownerX, double ownerY, double ownerSize,
            double ownerRotation, double damageMultiplier, double targetX, double targetY,
            double arenaWidth, double arenaHeight) {
        AbilityContracts.EntityContract contract = AbilityContracts.entityContractForAbility(abilityId);
        if (contract == null) throw new IllegalArgumentException("No entity contract for ability: " + abilityId);
        return create(id, contract, ownerSlot, ownerX, ownerY, ownerSize, ownerRotation, damageMultiplier,
                targetX, targetY, arenaWidth, arenaHeight, Placement.AHEAD);
    }

    /**
     * Generic spawn route used by both configured abilities and entities that spawn entities. Target coordinates
     * are only read for target-spawned contracts; non-finite values use the contract default.
     */
    public static ArenaEntity create(
            String id,
            AbilityContracts.EntityContract contract,
            int ownerSlot,
            double ownerX,
            double ownerY,
            double ownerSize,
            double ownerRotation,
            double damageMultiplier,
            double targetX,
            double targetY,
            double arenaWidth,
            double arenaHeight,
            Placement placement) {
        int abilityId = contract.abilityId();
        AbilityContracts.Spawn spawn = contract.spawn();
        AbilityContracts.AbilityPhase firstPhase = contract.phases().isEmpty()
                ? null : contract.phases().getFirst();
        int size = phaseSize(firstPhase);
        double speed = firstPhase == null || firstPhase.movement() == null
                ? 0 : firstPhase.movement().speed();
        double rotation = (spawn.rotationSpace() == AbilityContracts.RotationSpace.WORLD
                ? spawn.rotation() : ownerRotation + spawn.rotation()) + placement.angle();
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
            double localX = spawn.offsetX() + placement.lateral();
            double localY = spawn.offsetY();
            x += rightX * localX + forwardX * localY;
            y += rightY * localX + forwardY * localY;
            if (speed > 0) {
                double headingRadians = compassRadians(ownerRotation + placement.angle());
                directionX = Math.cos(headingRadians);
                directionY = Math.sin(headingRadians);
            }
        }

        double traveled = 0;
        AbilityContracts.Lifetime lifetime = contract.lifetime();
        int timer = switch (lifetime.timerMode()) {
            case REMAINING, FUSE -> lifetime.duration() + lifetime.add();
            default -> 0;
        };
        int hp = firstPhase == null || firstPhase.health() == null
                ? 0
                : (int) Math.round(firstPhase.health().hp());
        boolean armed = contract.initialState().armed();
        double entityDamageMultiplier = contract.initialState().damageMultiplierFromOwner()
                ? Math.max(0, damageMultiplier) : 1.0;
        String phaseId = firstPhase == null ? null : firstPhase.id();
        // Snare Bomb starts in an event-controlled armed phase. Other
        // entities are allowed to advance from their first phase by elapsed
        // time until a transition verb locks them to a later phase.
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
                List.of(),
                0,
                null,
                Map.of(),
                null,
                contract.entityType(),
                placement.angle(),
                placement.lateral());
    }

    private static int phaseSize(AbilityContracts.AbilityPhase phase) {
        if (phase == null) return 0;
        if (phase.visual() != null && phase.visual().visualSize() > 0) {
            return (int) Math.round(phase.visual().visualSize());
        }
        AbilityContracts.Hitbox hitbox = phase.hitbox();
        if (hitbox == null) return 0;
        if ("circle".equals(hitbox.shape()) && hitbox.radius() != null) {
            return (int) Math.round(hitbox.radius() * 2);
        }
        if ("rectangle".equals(hitbox.shape())) {
            double width = hitbox.width() == null ? 0 : hitbox.width();
            double length = hitbox.length() == null ? 0 : hitbox.length();
            return (int) Math.round(Math.max(width, length));
        }
        if ("ray".equals(hitbox.shape()) && hitbox.width() != null) {
            return (int) Math.round(hitbox.width());
        }
        if ("arc".equals(hitbox.shape()) && hitbox.range() != null) {
            return (int) Math.round(hitbox.range() * 2);
        }
        return 0;
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
