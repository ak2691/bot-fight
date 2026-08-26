package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import static com.example.botfight.simulation.geometry.DistanceCalculator.movingCircleCollision;
import org.springframework.stereotype.Service;

/** Advances all entities assigned to the contract-driven projectile system. */
@Service
public class ProjectileSimulationService {
    private static final int STEP_MS = 100;

    private final BotStateService botStateService;

    public ProjectileSimulationService(BotStateService botStateService) {
        this.botStateService = botStateService;
    }

    public boolean manages(ArenaEntity entity) {
        return EntityContracts.manages(entity, EntityContracts.SystemType.PROJECTILE);
    }

    public ArenaEntity createProjectile(int abilityId, Bot bot, int serial) {
        EntityContracts.EntityContract contract = EntityContracts.forAbility(abilityId);
        if (contract == null || contract.system() != EntityContracts.SystemType.PROJECTILE) {
            throw new IllegalArgumentException("ability is not a projectile entity: " + abilityId);
        }
        return AbilityEntityFactory.create(
                contract.runtimeType() + "-" + bot.userId + "-" + serial,
                abilityId,
                bot.slot,
                bot.x,
                bot.y,
                bot.size,
                bot.rotation,
                botStateService.damageMultiplier(bot),
                Double.NaN,
                Double.NaN,
                1000,
                800);
    }

    public ProjectileUpdate updateProjectiles(List<ArenaEntity> projectiles, List<Bot> bots, Arena arena) {
        List<ArenaEntity> remaining = new ArrayList<>();
        List<ArenaEntity> effects = new ArrayList<>();
        List<ProjectileImpact> impacts = new ArrayList<>();
        for (ArenaEntity projectile : projectiles) {
            EntityContracts.EntityContract contract = EntityContracts.forEntity(projectile);
            if (contract == null || contract.system() != EntityContracts.SystemType.PROJECTILE) {
                remaining.add(projectile);
                continue;
            }
            ArenaEntity next = advanceProjectile(projectile, contract, arena);
            ProjectileHit hit = findMovingColliderHit(projectile, next, bots);
            boolean stoppedLongEnough = contract.projectile() != null
                    && contract.projectile().explosion() != null
                    && Math.hypot(next.velocityX(), next.velocityY()) <= 0.001
                    && next.timerMs() >= Abilities.projectileFuseMs(contract.abilityId());
            if (hit != null || stoppedLongEnough) {
                if (contract.projectile() != null && contract.projectile().explosion() != null) {
                    if (hit != null) {
                        impacts.add(new ProjectileImpact(contract.abilityId(), next.ownerSlot(), hit.bot().slot,
                                next.x(), next.y(), next.damageMultiplier(), false, 0.0));
                    }
                    // Direct contact damage is applied as a separate impact;
                    // fuse-only explosions retain their radial center falloff.
                    effects.add(createDerivedEntity(next, contract.projectile().explosion(), hit != null));
                } else if (hit != null) {
                    impacts.add(new ProjectileImpact(contract.abilityId(), next.ownerSlot(), hit.bot().slot,
                            next.x(), next.y(), next.damageMultiplier(), false, hit.distance()));
                }
            } else if (shouldKeepProjectile(next, contract, arena)) {
                remaining.add(next);
            }
        }
        return new ProjectileUpdate(remaining, effects, impacts);
    }

    public void applyImpacts(List<Bot> bots, List<ProjectileImpact> impacts) {
        for (ProjectileImpact impact : impacts) {
            Bot owner = bots.stream().filter(bot -> bot.slot == impact.ownerSlot()).findFirst().orElse(null);
            for (Bot target : bots) {
                if (impact.targetSlot() != null && target.slot != impact.targetSlot()) continue;
                if (target.ignoresHostileEffects()) continue;
                double distance = Double.isFinite(impact.damageDistance())
                        ? impact.damageDistance()
                        : Math.hypot(target.x - impact.sourceX(), target.y - impact.sourceY());
                if (impact.radial() && distance > Abilities.range(impact.abilityId())) continue;
                Integer chargeCost = impact.radial()
                        ? radialShieldChargeCost(impact.abilityId(), distance) : null;
                AbilityEntitySystem.ShieldResult shield = botStateService.resolveShield(
                        target, impact.sourceX(), impact.sourceY(), impact.abilityId(), chargeCost);
                applyEffects(owner, target, impact, distance, shield);
            }
        }
    }

    public int radialDamageToEntity(ArenaEntity effect, ArenaEntity target) {
        if (effect == null || effect.abilityId() == null || target == null) return 0;
        EntityContracts.EntityContract contract = EntityContracts.forEntity(effect);
        if (contract == null) return 0;
        boolean dealsDamage = AbilityContracts.get(effect.abilityId()).effects().stream()
                .anyMatch(item -> item.type() == EffectType.DAMAGE);
        if (!dealsDamage) return 0;
        double distance = Math.hypot(target.x() - effect.x(), target.y() - effect.y());
        return (int) Math.round(Abilities.damageAtDistance(effect.abilityId(), distance)
                * effect.damageMultiplier());
    }

    private void applyEffects(Bot owner, Bot target, ProjectileImpact impact, double distance,
                              AbilityEntitySystem.ShieldResult shield) {
        AbilityContracts.AbilityContract contract = AbilityContracts.get(impact.abilityId());
        for (AbilityContracts.Effect effect : contract.effects()) {
            if (shield.prevents(effect.type())) continue;
            switch (effect.type()) {
                case DAMAGE -> {
                    double baseDamage = impact.radial()
                            ? Abilities.damageAtDistance(impact.abilityId(), distance)
                            : (effect.runtimeComputed()
                            ? Abilities.damageAtDistance(impact.abilityId(), distance)
                            : effect.amount());
                    botStateService.applyDamage(target,
                            baseDamage * impact.damageMultiplier(),
                            owner == null ? impact.ownerSlot() : owner.slot,
                            impact.sourceX(), impact.sourceY());
                }
                case DEBUFF -> applyDebuff(target, effect, impact, owner);
                case INTERRUPT -> {
                    target.preparingAbility = null;
                    target.preparingMs = 0;
                    BotStateService.upsertStatusEffect(target, new StatusEffectState("stun", effect.durationMs(), 0)
                            .addEffect(new StatusEffectState.Effect("stun", "constant")));
                }
                default -> { }
            }
        }
    }

    private static void applyDebuff(Bot target, AbilityContracts.Effect effect,
                                    ProjectileImpact impact, Bot owner) {
        if (target.hp <= 0) return;
        int sourceSlot = owner == null ? impact.ownerSlot() : owner.slot;
        switch (effect.subtype()) {
            case "burn" -> {
                var dot = Abilities.definition(impact.abilityId()).damageOverTime();
                StatusEffectState status = new StatusEffectState("burn", effect.durationMs(),
                        Abilities.statusIntervalMs(impact.abilityId(), "burn", 1_000));
                status.sourceSlot = sourceSlot;
                status.abilityId = impact.abilityId();
                status.addEffect(new StatusEffectState.Effect("damage", "tick")
                        .amount(dot == null ? 0 : dot.damage())
                        .multiplier(impact.damageMultiplier()));
                BotStateService.upsertStatusEffect(target, status);
            }
            case "slow" -> BotStateService.upsertStatusEffect(target,
                    statusWithAbility(impact.abilityId(), new StatusEffectState("slow", effect.durationMs(), 0)
                            .addEffect(new StatusEffectState.Effect("movement_modifier", "constant")
                                    .movement(HitStagger.CONCUSSIVE_MOVEMENT_MULTIPLIER,
                                            HitStagger.CONCUSSIVE_ROTATION_MULTIPLIER))));
            case "stun" -> BotStateService.upsertStatusEffect(target,
                    statusWithAbility(impact.abilityId(), new StatusEffectState("stun", effect.durationMs(), 0)
                            .addEffect(new StatusEffectState.Effect("stun", "constant"))));
            case "silence" -> BotStateService.upsertStatusEffect(target,
                    statusWithAbility(impact.abilityId(), new StatusEffectState("silence", effect.durationMs(), 0)
                            .addEffect(new StatusEffectState.Effect("silence", "constant"))));
            case "shock" -> {
                StatusEffectState shock = new StatusEffectState("shock", effect.durationMs(),
                        Abilities.statusIntervalMs(impact.abilityId(), "shock", 1000));
                shock.sourceSlot = sourceSlot;
                shock.addEffect(new StatusEffectState.Effect("damage", "tick")
                                .amount(Abilities.stat(impact.abilityId(), "shockDamage", 0)))
                        .addEffect(new StatusEffectState.Effect("movement_lock", "tick")
                                .durationMs((int) Abilities.stat(impact.abilityId(), "movementLockMs", 0)));
                BotStateService.upsertStatusEffect(target, shock);
            }
            case "bleed" -> {
                StatusEffectState bleed = new StatusEffectState("bleed", effect.durationMs(),
                        Abilities.statusIntervalMs(impact.abilityId(), "bleed", 1000));
                bleed.sourceSlot = sourceSlot;
                bleed.abilityId = impact.abilityId();
                bleed.addEffect(new StatusEffectState.Effect("damage", "tick")
                        .amount(AbilityContracts.effectAmount(impact.abilityId(), EffectType.DEBUFF)));
                BotStateService.upsertStatusEffect(target, bleed);
            }
            default -> { }
        }
    }

    private static StatusEffectState statusWithAbility(int abilityId, StatusEffectState status) {
        status.abilityId = abilityId;
        return status;
    }

    private static ArenaEntity advanceProjectile(ArenaEntity projectile,
                                                 EntityContracts.EntityContract contract,
                                                 Arena arena) {
        double velocityX = projectile.velocityX();
        double velocityY = projectile.velocityY();
        double nextX = projectile.x() + velocityX;
        double nextY = projectile.y() + velocityY;
        double traveled = projectile.traveled() + Math.hypot(velocityX, velocityY);
        if (contract.projectile() == null || contract.projectile().explosion() == null) {
            int timer = contract.lifetime().timerMode() == EntityContracts.TimerMode.AGE
                    ? projectile.timerMs() + STEP_MS
                    : projectile.timerMs();
            return copy(projectile, nextX, nextY, velocityX, velocityY, traveled,
                    timer, projectile.armed());
        }

        double radius = projectile.size() / 2.0;
        nextX = clamp(nextX, radius, arena.width() - radius);
        nextY = clamp(nextY, radius, arena.height() - radius);
        boolean atBoundary = nextX != projectile.x() + velocityX || nextY != projectile.y() + velocityY;
        if (atBoundary) {
            velocityX = 0;
            velocityY = 0;
        } else {
            double speed = Math.hypot(velocityX, velocityY);
            double nextSpeed = Math.max(0, speed - Abilities.projectileDecelerationPerTick(contract.abilityId()));
            velocityX = speed > 0 ? velocityX / speed * nextSpeed : 0;
            velocityY = speed > 0 ? velocityY / speed * nextSpeed : 0;
        }
        int stoppedMs = Math.hypot(velocityX, velocityY) <= 0.001
                ? projectile.timerMs() + STEP_MS : 0;
        return copy(projectile, nextX, nextY, velocityX, velocityY, traveled, stoppedMs, projectile.armed());
    }

    private static ArenaEntity createDerivedEntity(ArenaEntity projectile, EntityContracts.Derived definition) {
        return createDerivedEntity(projectile, definition, false);
    }

    private static ArenaEntity createDerivedEntity(ArenaEntity projectile,
                                                   EntityContracts.Derived definition,
                                                   boolean damageApplied) {
        int size = (int) Math.round(EntityContracts.stat(projectile.abilityId(), definition.sizeStat(), projectile.size())
                * definition.sizeMultiplier());
        int timer = definition.visibleStat() == null
                ? definition.durationMs()
                : (int) Math.round(EntityContracts.stat(projectile.abilityId(), definition.visibleStat(), definition.durationMs()));
        ArenaEntity derived = new ArenaEntity(projectile.id() + "-" + definition.type(), definition.type(), projectile.ownerSlot(),
                projectile.x(), projectile.y(), size, 0, 0, 0, timer, true, 0, 0,
                projectile.damageMultiplier(), projectile.abilityId(), Set.of(), 0, projectile.rotation());
        return damageApplied ? derived.withHitSlots(Set.of(-1)) : derived;
    }

    private static ArenaEntity copy(ArenaEntity source, double x, double y, double velocityX,
                                    double velocityY, double traveled, int timer, boolean armed) {
        return new ArenaEntity(source.id(), source.type(), source.ownerSlot(), x, y, source.size(),
                velocityX, velocityY, traveled, timer, armed, source.hp(), source.shotVisualMs(),
                source.damageMultiplier(), source.abilityId(), source.hitSlots(), source.intervalTimerMs(),
                source.phaseTimerMs(), source.ageMs(), source.tickStartHp(), source.damageTakenThisTick(),
                source.damageTakenLastTick(), source.hpNetChangeLastTick(), source.rotation());
    }

    private static int radialShieldChargeCost(int abilityId, double distance) {
        double radius = Abilities.range(abilityId);
        if (radius <= 0 || distance > radius) return 0;
        double t = Math.max(0, Math.min(1, distance / radius));
        return (int) Math.max(1, Math.min(5, Math.round(5 + (1 - 5) * t)));
    }

    private static boolean shouldKeepProjectile(ArenaEntity entity,
                                                EntityContracts.EntityContract contract,
                                                Arena arena) {
        if (contract.projectile() != null && contract.projectile().explosion() != null) {
            return entity.timerMs() < Abilities.projectileFuseMs(contract.abilityId());
        }
        if (contract.lifetime().timerMode() == EntityContracts.TimerMode.AGE) {
            double lifetime = EntityContracts.stat(contract.abilityId(), contract.lifetime().stat(), Double.POSITIVE_INFINITY);
            return entity.timerMs() < lifetime && insideArena(entity, arena);
        }
        return insideArena(entity, arena);
    }

    private static boolean insideArena(ArenaEntity entity, Arena arena) {
        return entity.x() >= -entity.size() && entity.x() <= arena.width() + entity.size()
                && entity.y() >= -entity.size() && entity.y() <= arena.height() + entity.size();
    }

    private static ProjectileHit findMovingColliderHit(ArenaEntity previous, ArenaEntity projectile, List<Bot> bots) {
        double projectileRadius = projectile.size() / 2.0;
        for (Bot bot : bots) {
            if (!bot.projectileHittable() || bot.slot == projectile.ownerSlot()) continue;
            double botRadius = bot.size / 2.0;
            var collision = movingCircleCollision(previous.x(), previous.y(), projectile.x(), projectile.y(), projectileRadius,
                    bot.movementStartX, bot.movementStartY, bot.x, bot.y, botRadius);
            if (collision.hit()) return new ProjectileHit(bot, collision.swept(), collision.distance());
        }
        return null;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private record ProjectileHit(Bot bot, boolean swept, double distance) {}

    public record ProjectileImpact(int abilityId, int ownerSlot, Integer targetSlot,
                            double sourceX, double sourceY, double damageMultiplier,
                            boolean radial, double damageDistance) {}

    public record ProjectileUpdate(List<ArenaEntity> projectiles, List<ArenaEntity> effects,
                            List<ProjectileImpact> impacts) {}
}
