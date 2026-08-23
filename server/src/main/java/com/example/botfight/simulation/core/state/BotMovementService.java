package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.bots.BotLogicContracts;
import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;
import static com.example.botfight.simulation.geometry.AngleCalculator.normalizeDegrees;
import static com.example.botfight.simulation.geometry.AngleCalculator.normalizeRelativeDegrees;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Vector;
import com.example.botfight.simulation.core.combat.AbilityExecutionPayload;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.HitStagger;
import org.springframework.stereotype.Service;

/** Owns authoritative bot movement, steering, dash, and displacement math. */
@Service
public class BotMovementService {
    private static final int STEP_MS = 100;
    private static final double TURN_SPEED_DEGREES = 12.0;

    public BotMovementService() {}

    public Vector movementVector(DuelSimulationService.StrategyBlock block, Bot player, Entity target) {
        if (player == null || block == null || !BotLogicContracts.ACTION_MOVE_WALK.equals(block.action())) {
            return new Vector(0, 0);
        }
        String direction = block.movementDirection() != null ? block.movementDirection() : "0";
        if ("absolute".equals(block.movementMode())) {
            if (BotLogicContracts.ACTION_MOVE_WALK.equals(block.action())) {
                if (!BotLogicContracts.isAbsoluteWalkDirection(direction)) return new Vector(0, 0);
                double radians = compassRadians(BotLogicContracts.absoluteWalkDirection(direction));
                return new Vector(Math.cos(radians), Math.sin(radians));
            }
            return switch (direction) {
                case "north" -> new Vector(0.0, -1.0);
                case "south" -> new Vector(0.0, 1.0);
                case "east" -> new Vector(1.0, 0.0);
                case "west" -> new Vector(-1.0, 0.0);
                case "northeast" -> new Vector(Math.sqrt(0.5), -Math.sqrt(0.5));
                case "northwest" -> new Vector(-Math.sqrt(0.5), -Math.sqrt(0.5));
                case "southeast" -> new Vector(Math.sqrt(0.5), Math.sqrt(0.5));
                case "southwest" -> new Vector(-Math.sqrt(0.5), Math.sqrt(0.5));
                default -> new Vector(0, 0);
            };
        }
        if (target == null) return new Vector(0, 0);
        Vector inward = new Vector(target.x() - player.x, target.y() - player.y);
        if (Math.hypot(inward.dx(), inward.dy()) <= 0.001) {
            double facingRadians = compassRadians(player.rotation);
            inward = new Vector(Math.cos(facingRadians), Math.sin(facingRadians));
        }
        return relativeMovementVector(inward.dx(), inward.dy(), direction);
    }

    public void applyTickMovement(Bot bot, Action action, Arena arena,
                           boolean rewoundThisTick, boolean slowedWasActive,
                           boolean hitStaggerWasActive) {
        bot.movementStartX = bot.x;
        bot.movementStartY = bot.y;
        double actionMagnitude = Math.hypot(action.dx(), action.dy());
        boolean continuingDash = bot.dashActiveMs > 0 && bot.dashRemaining > 0;
        double rotationMultiplier = slowedWasActive
                ? BotStateService.statusEffectValue(bot, "slow", "movement_modifier", "rotationMultiplier",
                        HitStagger.CONCUSSIVE_ROTATION_MULTIPLIER)
                : hitStaggerWasActive
                ? BotStateService.statusEffectValue(bot, "hit-stagger", "movement_modifier", "rotationMultiplier",
                        HitStagger.ROTATION_MULTIPLIER)
                : 1.0;
        bot.rotation = normalizeDegrees(bot.rotation
                + clamp(action.dRot(), -1, 1) * TURN_SPEED_DEGREES * rotationMultiplier);
        double movementSpeedMultiplier = slowedWasActive
                ? BotStateService.statusEffectValue(bot, "slow", "movement_modifier", "movementMultiplier",
                        HitStagger.CONCUSSIVE_MOVEMENT_MULTIPLIER)
                : hitStaggerWasActive
                ? BotStateService.statusEffectValue(bot, "hit-stagger", "movement_modifier", "movementMultiplier",
                        HitStagger.MOVEMENT_MULTIPLIER)
                : 1.0;
        if (rewoundThisTick) {
            clearMovement(bot);
        } else if (BotStateService.statusActive(bot, "stun")
                || BotStateService.statusActive(bot, "movement-lock")) {
            stopDash(bot);
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
        } else if (continuingDash) {
            double stepDistance = Math.min(bot.dashStepDistance > 0 ? bot.dashStepDistance : 75,
                    bot.dashRemaining);
            double beforeX = bot.x, beforeY = bot.y;
            moveBot(bot, bot.dashDirectionX, bot.dashDirectionY, stepDistance, arena);
            double traveled = Math.hypot(bot.x - beforeX, bot.y - beforeY);
            bot.dashRemaining = Math.max(0, bot.dashRemaining - traveled);
            bot.movementVelocityX = bot.dashDirectionX * bot.moveSpeed * movementSpeedMultiplier;
            bot.movementVelocityY = bot.dashDirectionY * bot.moveSpeed * movementSpeedMultiplier;
            if (traveled <= 0 || bot.dashRemaining <= 0) bot.dashActiveMs = 0;
        }
        if (!rewoundThisTick && !continuingDash
                && !BotStateService.statusActive(bot, "stun")
                && !BotStateService.statusActive(bot, "movement-lock")) {
            Vector movementVelocity = nextMovementVelocity(
                    bot, action, actionMagnitude, bot.moveSpeed * movementSpeedMultiplier);
            bot.movementVelocityX = movementVelocity.dx();
            bot.movementVelocityY = movementVelocity.dy();
            moveBotByVelocity(bot, movementVelocity.dx(), movementVelocity.dy(), arena);
        }
    }

    public void stopMovement(Bot bot) {
        clearMovement(bot);
    }

    public void applyKnockback(Bot bot, double dx, double dy, double distance, Arena arena) {
        double magnitude = Math.hypot(dx, dy);
        if (magnitude > 0) moveBot(bot, dx / magnitude, dy / magnitude, distance, arena);
    }

    public void applyTeleport(Bot attacker, Bot defender, double passThroughDistance,
                       AbilityExecutionPayload payload, Arena arena) {
        double dx = defender.x - attacker.x;
        double dy = defender.y - attacker.y;
        double distance = Math.hypot(dx, dy);
        double bearing = com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing(dx, dy);
        double originalRotation = attacker.rotation;
        attacker.x = clamp(defender.x + dx / Math.max(1, distance) * passThroughDistance,
                attacker.size / 2.0, arena.width() - attacker.size / 2.0);
        attacker.y = clamp(defender.y + dy / Math.max(1, distance) * passThroughDistance,
                attacker.size / 2.0, arena.height() - attacker.size / 2.0);
        attacker.movementStartX = attacker.x;
        attacker.movementStartY = attacker.y;
        attacker.movementVelocityX = 0;
        attacker.movementVelocityY = 0;
        attacker.velocityX = 0;
        attacker.velocityY = 0;
        String facingMode = payload.phaseFacingMode() != null
                ? payload.phaseFacingMode() : payload.contract().execution().phaseFacingDefault();
        if (!"keep".equals(facingMode)) {
            attacker.rotation = "mirror".equals(facingMode)
                    ? normalizeDegrees(2 * bearing - originalRotation)
                    : normalizeDegrees(bearing + 180);
        }
    }

    public void startDash(Bot bot, AbilityExecutionPayload payload, Arena arena) {
        AbilityContracts.Movement movement = payload.contract().execution().movement();
        double targetX = payload.targetX();
        double targetY = payload.targetY();
        double movementDx = Double.isFinite(targetX) && Double.isFinite(targetY) ? targetX - bot.x : 0;
        double movementDy = Double.isFinite(targetX) && Double.isFinite(targetY) ? targetY - bot.y : 0;
        if (Math.hypot(movementDx, movementDy) <= 0.001) {
            double facingRadians = compassRadians(bot.rotation);
            movementDx = Math.cos(facingRadians);
            movementDy = Math.sin(facingRadians);
        }
        Vector direction = dashDirection(payload.movementMode(), payload.movementDirection(),
                movementDx, movementDy);
        double beforeX = bot.x, beforeY = bot.y;
        double stepDistance = payload.definition().stats().getOrDefault(movement.stepDistanceStat(), 75.0);
        double dashDistance = payload.definition().stats().getOrDefault(movement.distanceStat(), 150.0);
        bot.movementStartX = bot.x;
        bot.movementStartY = bot.y;
        moveBot(bot, direction.dx(), direction.dy(), stepDistance, arena);
        bot.dashDirectionX = direction.dx();
        bot.dashDirectionY = direction.dy();
        bot.dashRemaining = Math.max(0, dashDistance - Math.hypot(bot.x - beforeX, bot.y - beforeY));
        bot.dashStepDistance = stepDistance;
        bot.dashActiveMs = (int) Math.round(payload.definition().stats()
                .getOrDefault(movement.durationStat(), 200.0));
    }

    void moveBot(Bot bot, double dx, double dy, double distance, Arena arena) {
        double magnitude = Math.hypot(dx, dy);
        if (magnitude <= 0.0001 || distance <= 0) return;
        double radius = bot.size / 2.0;
        bot.x = clamp(bot.x + dx / magnitude * distance, radius, arena.width() - radius);
        bot.y = clamp(bot.y + dy / magnitude * distance, radius, arena.height() - radius);
        bot.velocityX = dx / magnitude * distance / (STEP_MS / 1000.0);
        bot.velocityY = dy / magnitude * distance / (STEP_MS / 1000.0);
    }

    private static Vector dashDirection(String movementMode, String movementDirection, double movementDx, double movementDy) {
        String direction = movementDirection != null ? movementDirection : "0";
        if ("absolute".equals(movementMode)) {
            return switch (direction) {
                case "north" -> new Vector(0, -1);
                case "south" -> new Vector(0, 1);
                case "east" -> new Vector(1, 0);
                case "west" -> new Vector(-1, 0);
                case "northeast" -> new Vector(Math.sqrt(0.5), -Math.sqrt(0.5));
                case "northwest" -> new Vector(-Math.sqrt(0.5), -Math.sqrt(0.5));
                case "southeast" -> new Vector(Math.sqrt(0.5), Math.sqrt(0.5));
                case "southwest" -> new Vector(-Math.sqrt(0.5), Math.sqrt(0.5));
                default -> BotLogicContracts.isAbsoluteWalkDirection(direction)
                        ? compassVector(BotLogicContracts.absoluteWalkDirection(direction))
                        : new Vector(0, 0);
            };
        }
        return relativeMovementVector(movementDx, movementDy, direction);
    }

    private static Vector compassVector(double degrees) {
        double radians = compassRadians(degrees);
        return new Vector(Math.cos(radians), Math.sin(radians));
    }

    private static Vector relativeMovementVector(double dx, double dy, String direction) {
        double magnitude = Math.hypot(dx, dy);
        if (!Double.isFinite(magnitude) || magnitude <= 0.001) return new Vector(0, 0);
        double radians = Math.toRadians(normalizeRelativeDegrees(BotLogicContracts.relativeMovementAngle(direction)));
        double normalizedX = dx / magnitude;
        double normalizedY = dy / magnitude;
        double cosine = Math.cos(radians);
        double sine = Math.sin(radians);
        return new Vector(
                normalizedX * cosine - normalizedY * sine,
                normalizedX * sine + normalizedY * cosine);
    }

    private static void stopDash(Bot bot) {
        bot.dashActiveMs = 0;
        bot.dashRemaining = 0;
    }

    private static void clearMovement(Bot bot) {
        stopDash(bot);
        bot.movementVelocityX = 0;
        bot.movementVelocityY = 0;
        bot.velocityX = 0;
        bot.velocityY = 0;
    }

    private static Vector nextMovementVelocity(Bot bot, Action action, double magnitude, double maxSpeed) {
        double acceleration = Math.max(0.0, maxSpeed * 0.5);
        Vector desired = magnitude > 0.001
                ? new Vector(action.dx() / magnitude * maxSpeed, action.dy() / magnitude * maxSpeed)
                : new Vector(0, 0);
        return steerVelocity(new Vector(bot.movementVelocityX, bot.movementVelocityY), desired,
                acceleration, maxSpeed);
    }

    private static Vector steerVelocity(Vector current, Vector target, double maxDelta, double maxSpeed) {
        double deltaX = target.dx() - current.dx(), deltaY = target.dy() - current.dy();
        double distance = Math.hypot(deltaX, deltaY);
        if (distance > maxDelta && distance > 0) {
            deltaX = deltaX / distance * maxDelta;
            deltaY = deltaY / distance * maxDelta;
        }
        return clampVelocity(new Vector(current.dx() + deltaX, current.dy() + deltaY), maxSpeed);
    }

    private static Vector clampVelocity(Vector velocity, double maxSpeed) {
        double speed = Math.hypot(velocity.dx(), velocity.dy());
        return speed > maxSpeed && speed > 0
                ? new Vector(velocity.dx() / speed * maxSpeed, velocity.dy() / speed * maxSpeed) : velocity;
    }

    private static void moveBotByVelocity(Bot bot, double velocityX, double velocityY, Arena arena) {
        double radius = bot.size / 2.0;
        bot.x = clamp(bot.x + velocityX, radius, arena.width() - radius);
        bot.y = clamp(bot.y + velocityY, radius, arena.height() - radius);
        bot.velocityX = velocityX / (STEP_MS / 1000.0);
        bot.velocityY = velocityY / (STEP_MS / 1000.0);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
