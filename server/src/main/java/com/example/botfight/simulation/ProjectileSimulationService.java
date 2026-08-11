package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;

import com.example.botfight.simulation.DuelSimulationService.Arena;
import com.example.botfight.simulation.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/** Advances short-lived ability projectiles and applies their declared effects. */
@Service
public class ProjectileSimulationService {
    private static final int STEP_MS = 100;

    private final BotStateService botStateService;

    public ProjectileSimulationService(BotStateService botStateService) {
        this.botStateService = botStateService;
    }

    boolean manages(ArenaEntity entity) {
        if (entity == null || entity.abilityId() == null) return false;
        var definition = Abilities.definition(entity.abilityId());
        return AbilityContracts.get(entity.abilityId()).delivery() == AbilityContracts.DeliveryType.PROJECTILE
                && (Abilities.projectileFuseMs(entity.abilityId()) > 0 || definition.damageOverTime() != null);
    }

    ArenaEntity createProjectile(int abilityId, Bot bot, int serial) {
        var contract = AbilityContracts.get(abilityId);
        if (contract.delivery() != AbilityContracts.DeliveryType.PROJECTILE) {
            throw new IllegalArgumentException("ability is not a projectile: " + abilityId);
        }
        String entityType = contract.effects().stream()
                .filter(effect -> effect.type() == EffectType.SPAWN_ENTITY)
                .map(AbilityContracts.Effect::subtype)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("projectile has no spawned entity: " + abilityId));
        double radians = compassRadians(bot.rotation);
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        int size = Abilities.projectileSize(abilityId);
        double speed = Abilities.projectileSpeed(abilityId);
        double spawnDistance = bot.size / 2.0 + size / 2.0 + 2.0;
        return new ArenaEntity(
                entityType + "-" + bot.userId + "-" + serial,
                entityType,
                bot.slot,
                bot.x + directionX * spawnDistance,
                bot.y + directionY * spawnDistance,
                size,
                directionX * speed,
                directionY * speed,
                0,
                0,
                false,
                0,
                0,
                botStateService.damageMultiplier(bot),
                abilityId);
    }

    ProjectileUpdate updateProjectiles(List<ArenaEntity> projectiles, List<Bot> bots, Arena arena) {
        List<ArenaEntity> remaining = new ArrayList<>();
        List<ArenaEntity> effects = new ArrayList<>();
        List<ProjectileImpact> impacts = new ArrayList<>();
        for (ArenaEntity projectile : projectiles) {
            int abilityId = projectile.abilityId();
            double deceleration = Abilities.projectileDecelerationPerTick(abilityId);
            ArenaEntity next = deceleration > 0
                    ? advanceDeceleratingProjectile(projectile, arena, deceleration)
                    : advanceLinearProjectile(projectile);
            Bot hit = bots.stream()
                    .filter(bot -> bot.projectileHittable() && bot.slot != next.ownerSlot()
                            && overlaps(bot.x, bot.y, bot.size, next.x(), next.y(), next.size()))
                    .findFirst()
                    .orElse(null);
            int fuseMs = Abilities.projectileFuseMs(abilityId);
            boolean stoppedLongEnough = fuseMs > 0 && Math.hypot(next.velocityX(), next.velocityY()) <= 0.001
                    && next.timerMs() >= fuseMs;
            if (hit != null || stoppedLongEnough) {
                if (Abilities.projectileVisualMs(abilityId) > 0) {
                    effects.add(new ArenaEntity(next.id() + "-explosion", next.type() + "Explosion", next.ownerSlot(),
                            next.x(), next.y(), (int) Math.round(Abilities.range(abilityId) * 2),
                            0, 0, 0, Abilities.projectileVisualMs(abilityId), true, 0, 0,
                            next.damageMultiplier(), abilityId));
                    impacts.add(new ProjectileImpact(abilityId, next.ownerSlot(), null,
                            next.x(), next.y(), next.damageMultiplier(), true));
                } else if (hit != null) {
                    impacts.add(new ProjectileImpact(abilityId, next.ownerSlot(), hit.slot,
                            next.x(), next.y(), next.damageMultiplier(), false));
                }
            } else if (next.traveled() < Abilities.range(abilityId) && insideArena(next, arena)) {
                remaining.add(next);
            }
        }
        return new ProjectileUpdate(remaining, effects, impacts);
    }

    void applyImpacts(List<Bot> bots, List<ProjectileImpact> impacts) {
        for (ProjectileImpact impact : impacts) {
            Bot owner = bots.stream().filter(bot -> bot.slot == impact.ownerSlot()).findFirst().orElse(null);
            for (Bot target : bots) {
                if (impact.targetSlot() != null && target.slot != impact.targetSlot()) continue;
                if (target.ignoresHostileEffects()) continue;
                double distance = Math.hypot(target.x - impact.sourceX(), target.y - impact.sourceY());
                if (impact.radial() && distance > Abilities.range(impact.abilityId())) continue;
                Integer chargeCost = impact.radial() ? radialShieldChargeCost(impact.abilityId(), distance) : null;
                AbilityEntitySystem.ShieldResult shield = botStateService.resolveShield(
                        target, impact.sourceX(), impact.sourceY(), impact.abilityId(), chargeCost);
                applyEffects(owner, target, impact, distance, shield);
            }
        }
    }

    void applyDamageOverTimeEffects(List<Bot> bots) {
        for (Bot bot : bots) {
            if (bot.burnRemainingMs <= 0) {
                clearBurn(bot);
                continue;
            }
            boolean tickDueBeforeOrAtExpiry = bot.burnTickMs <= bot.burnRemainingMs;
            bot.burnRemainingMs = Math.max(0, bot.burnRemainingMs - STEP_MS);
            bot.burnTickMs = Math.max(0, bot.burnTickMs - STEP_MS);
            if (tickDueBeforeOrAtExpiry && bot.burnTickMs <= 0) {
                var dot = Abilities.definition(bot.burnAbilityId).damageOverTime();
                botStateService.applyDamage(bot,
                        (int) Math.round(dot.damage() * bot.burnDamageMultiplier), bot.burnSourceSlot);
                bot.burnTickMs = dot.tickMs();
            }
            if (bot.burnRemainingMs <= 0) clearBurn(bot);
        }
    }

    int radialDamageToEntity(ArenaEntity effect, ArenaEntity target) {
        if (effect == null || effect.abilityId() == null) return 0;
        double distance = Math.hypot(target.x() - effect.x(), target.y() - effect.y());
        return (int) Math.round(Abilities.damageAtDistance(effect.abilityId(), distance)
                * effect.damageMultiplier());
    }

    private void applyEffects(Bot owner, Bot target, ProjectileImpact impact, double distance,
                              AbilityEntitySystem.ShieldResult shield) {
        var definition = Abilities.definition(impact.abilityId());
        for (var effect : AbilityContracts.get(impact.abilityId()).effects()) {
            if (shield.prevents(effect.type())) continue;
            if (effect.type() == EffectType.DAMAGE) {
                int baseDamage = impact.radial()
                        ? Abilities.damageAtDistance(impact.abilityId(), distance)
                        : (int) Math.round(effect.runtimeComputed() ? definition.damage() : effect.amount());
                botStateService.applyDamage(target,
                        (int) Math.round(baseDamage * impact.damageMultiplier()), owner);
            } else if (effect.type() == EffectType.DEBUFF && "burn".equals(effect.subtype()) && target.hp > 0) {
                boolean alreadyBurning = target.burnRemainingMs > 0;
                target.burnAbilityId = impact.abilityId();
                target.burnRemainingMs = effect.durationMs();
                if (!alreadyBurning) target.burnTickMs = definition.damageOverTime().tickMs();
                target.burnDamageMultiplier = Math.max(target.burnDamageMultiplier, impact.damageMultiplier());
                target.burnSourceSlot = owner != null ? owner.slot : 0;
            }
        }
    }

    private static ArenaEntity advanceDeceleratingProjectile(
            ArenaEntity projectile, Arena arena, double deceleration) {
        double radius = projectile.size() / 2.0;
        double nextX = clamp(projectile.x() + projectile.velocityX(), radius, arena.width() - radius);
        double nextY = clamp(projectile.y() + projectile.velocityY(), radius, arena.height() - radius);
        boolean hitArenaBoundary = nextX != projectile.x() + projectile.velocityX()
                || nextY != projectile.y() + projectile.velocityY();
        double velocityX = projectile.velocityX();
        double velocityY = projectile.velocityY();
        if (hitArenaBoundary) {
            velocityX = 0;
            velocityY = 0;
        } else {
            double speed = Math.hypot(velocityX, velocityY);
            if (speed <= deceleration) {
                velocityX = 0;
                velocityY = 0;
            } else {
                double nextSpeed = speed - deceleration;
                velocityX = velocityX / speed * nextSpeed;
                velocityY = velocityY / speed * nextSpeed;
            }
        }
        int stoppedMs = Math.hypot(velocityX, velocityY) <= 0.001 ? projectile.timerMs() + STEP_MS : 0;
        return copyProjectile(projectile, nextX, nextY, velocityX, velocityY, projectile.traveled(), stoppedMs);
    }

    private static ArenaEntity advanceLinearProjectile(ArenaEntity projectile) {
        double velocityX = projectile.velocityX();
        double velocityY = projectile.velocityY();
        return copyProjectile(projectile, projectile.x() + velocityX, projectile.y() + velocityY,
                velocityX, velocityY, projectile.traveled() + Math.hypot(velocityX, velocityY), projectile.timerMs());
    }

    private static ArenaEntity copyProjectile(ArenaEntity source, double x, double y,
                                               double velocityX, double velocityY, double traveled, int timerMs) {
        return new ArenaEntity(source.id(), source.type(), source.ownerSlot(), x, y, source.size(),
                velocityX, velocityY, traveled, timerMs, source.armed(), source.hp(), source.shotVisualMs(),
                source.damageMultiplier(), source.abilityId());
    }

    private static int radialShieldChargeCost(int abilityId, double distance) {
        double radius = Abilities.range(abilityId);
        if (radius <= 0 || distance > radius) return 0;
        double t = Math.max(0, Math.min(1, distance / radius));
        return (int) Math.max(1, Math.min(5, Math.round(5 + (1 - 5) * t)));
    }

    private static void clearBurn(Bot bot) {
        bot.burnAbilityId = null;
        bot.burnRemainingMs = 0;
        bot.burnTickMs = 0;
        bot.burnDamageMultiplier = 1.0;
        bot.burnSourceSlot = 0;
    }

    private static boolean insideArena(ArenaEntity entity, Arena arena) {
        return entity.x() >= -entity.size() && entity.x() <= arena.width() + entity.size()
                && entity.y() >= -entity.size() && entity.y() <= arena.height() + entity.size();
    }

    private static boolean overlaps(double firstX, double firstY, double firstSize,
                                    double secondX, double secondY, double secondSize) {
        return Math.hypot(firstX - secondX, firstY - secondY) <= (firstSize + secondSize) / 2.0;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    record ProjectileImpact(int abilityId, int ownerSlot, Integer targetSlot,
                            double sourceX, double sourceY, double damageMultiplier, boolean radial) {}

    record ProjectileUpdate(List<ArenaEntity> projectiles, List<ArenaEntity> effects,
                            List<ProjectileImpact> impacts) {}
}
