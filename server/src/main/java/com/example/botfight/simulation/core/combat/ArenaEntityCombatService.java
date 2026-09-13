package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.EntityHitbox.movingCollision;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Resolves bot and transient-entity interactions with persistent arena entities. */
@Service
class ArenaEntityCombatService {
    private final AbilityHitDetectionService hitDetectionService;

    ArenaEntityCombatService(AbilityHitDetectionService hitDetectionService) {
        this.hitDetectionService = hitDetectionService;
    }

    int damageToEntityThisTick(ArenaEntity entity, List<Bot> bots,
                              List<ArenaEntity> entities) {
        int damage = 0;
        AbilityContracts.AbilityPhase targetPhase = AbilityContracts.phaseFor(entity);
        boolean summonTarget = targetPhase != null
                && targetPhase.type() == AbilityContracts.PhaseType.SUMMON;
        for (Bot bot : bots) {
            if (summonTarget && !ownersAreHostile(bot.slot, entity.ownerSlot(), bots)) continue;
            double distance = Math.hypot(entity.x() - bot.x, entity.y() - bot.y);
            AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(bot);
            if (payload == null || !hitDetectionService.isAttachedAbility(payload)) continue;
            double range = hitDetectionService.phaseRange(payload, 0);
            AbilityContracts.AbilityPhase phase = attachedPhase(payload);
            AbilityContracts.PhaseEvent event = phase == null ? null
                    : phase.events().get(AbilityContracts.PhaseEventType.COLLISION);
            if (!eventCanAffectHpEntity(event, summonTarget)) continue;
            boolean rayHit = phase != null && phase.hitbox() != null
                    && "ray".equals(phase.hitbox().shape())
                    && hitDetectionService.rayHits(payload, bot, entity.x(), entity.y(), hitTargetSize(entity) / 2.0);
            boolean rangeHit = hitDetectionService.abilityRangeHits(
                    bot, entity.x(), entity.y(), hitTargetSize(entity), payload, range);
            if (rayHit || rangeHit) damage += (int) Math.round(amountForEffect(payload, distance));
        }
        for (ArenaEntity effect : entities) {
            if (effect == null || effect.id().equals(entity.id())) continue;
            AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(effect);
            boolean summonSource = phase != null
                    && phase.type() == AbilityContracts.PhaseType.SUMMON;
            if ((summonTarget || summonSource)
                    && !ownersAreHostile(effect.ownerSlot(), entity.ownerSlot(), bots)) continue;
            if (!phaseHasEventEffect(phase, AbilityContracts.PhaseEventType.COLLISION, EffectType.DAMAGE)
                    || !eventCanAffectHpEntity(phase.events().get(
                            AbilityContracts.PhaseEventType.COLLISION), summonTarget)
                    || !overlaps(effect, entity)) continue;
            AbilityContracts.Effect damageEffect = phase.effects().stream()
                    .filter(item -> item.type() == EffectType.DAMAGE)
                    .findFirst().orElse(null);
            if (damageEffect == null) continue;
            damageEffect = withEffectOverride(damageEffect,
                    phase.effectOverrides().get(AbilityContracts.effectOverrideKey(damageEffect)));
            double distance = phase.type() == AbilityContracts.PhaseType.PROJECTILE
                    ? 0
                    : Math.hypot(effect.x() - entity.x(), effect.y() - entity.y());
            double baseDamage = amountForEffect(effect.abilityId(), damageEffect, distance,
                    phaseRange(phase));
            damage += (int) Math.round(baseDamage * effect.damageMultiplier());
        }
        return damage;
    }

    ArenaEntity applyEffectsToEntity(ArenaEntity target, List<Bot> bots,
                                     List<ArenaEntity> entities, ArenaBounds arena) {
        if (target == null || target.hp() <= 0) return target;
        AbilityContracts.AbilityPhase targetPhase = AbilityContracts.phaseFor(target);
        boolean summonTarget = targetPhase != null
                && targetPhase.type() == AbilityContracts.PhaseType.SUMMON;
        ArenaEntity next = target;
        for (Bot bot : bots) {
            AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(bot);
            if (payload == null || !hitDetectionService.isAttachedAbility(payload)) continue;
            AbilityContracts.AbilityPhase phase = attachedPhase(payload);
            AbilityContracts.PhaseEventType eventType = AbilityContracts.targetsOwner(payload.abilityId())
                    ? AbilityContracts.PhaseEventType.ACTIVATION
                    : AbilityContracts.PhaseEventType.COLLISION;
            AbilityContracts.PhaseEvent event = phase == null ? null
                    : phase.events().get(eventType);
            if (!canAffectEntity(event, bot.slot, target.ownerSlot(), summonTarget, bots)
                    || !attachedAbilityHitsEntity(payload, bot, next)) continue;
            double distance = Math.hypot(next.x() - bot.x, next.y() - bot.y);
            next = applyImpact(next, new EffectSource(bot.slot, bot.x, bot.y,
                    bot.velocityX, bot.velocityY, 1.0), payload.abilityId(),
                    phase, event, distance, summonTarget, arena);
        }
        for (ArenaEntity source : entities) {
            if (source == null || source.id().equals(target.id())
                    || !ownersAreHostile(source.ownerSlot(), target.ownerSlot(), bots)) continue;
            AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(source);
            AbilityContracts.PhaseEvent event = phase == null ? null
                    : phase.events().get(AbilityContracts.PhaseEventType.COLLISION);
            if (!canAffectEntity(event, source.ownerSlot(), target.ownerSlot(), summonTarget, bots)
                    || !overlaps(source, next)) continue;
            double distance = phase != null && phase.type() == AbilityContracts.PhaseType.PROJECTILE
                    ? 0 : Math.hypot(source.x() - next.x(), source.y() - next.y());
            next = applyImpact(next, new EffectSource(source.ownerSlot(), source.x(), source.y(),
                    source.velocityX(), source.velocityY(), source.damageMultiplier()),
                    source.abilityId(), phase, event, distance, summonTarget, arena);
        }
        return next;
    }

    private static boolean eventHasApplyEffects(AbilityContracts.PhaseEvent event) {
        return event != null && event.actions().contains(AbilityContracts.PhaseAction.APPLY_EFFECTS);
    }

    private static boolean canAffectEntity(AbilityContracts.PhaseEvent event,
                                            int sourceOwnerSlot, int targetOwnerSlot,
                                            boolean summonTarget, List<Bot> bots) {
        return eventHasApplyEffects(event)
                && (summonTarget
                        ? ownersAreHostile(sourceOwnerSlot, targetOwnerSlot, bots)
                        : sourceOwnerSlot != targetOwnerSlot)
                && eventCanAffectHpEntity(event, summonTarget);
    }

    private static boolean ownersAreHostile(int sourceOwnerSlot, int targetOwnerSlot,
                                            List<Bot> bots) {
        Bot sourceOwner = bots.stream().filter(bot -> bot.slot == sourceOwnerSlot).findFirst().orElse(null);
        Bot targetOwner = bots.stream().filter(bot -> bot.slot == targetOwnerSlot).findFirst().orElse(null);
        if (sourceOwner != null && targetOwner != null) {
            return sourceOwner.entityTeam() != targetOwner.entityTeam();
        }
        return sourceOwnerSlot != targetOwnerSlot;
    }

    private static boolean eventCanAffectHpEntity(AbilityContracts.PhaseEvent event,
                                                   boolean summonTarget) {
        return event != null && (eventTargetsKind(event, AbilityContracts.TargetKind.HP_ENTITY)
                || summonTarget && eventTargetsKind(event, AbilityContracts.TargetKind.BOT));
    }

    private boolean attachedAbilityHitsEntity(AbilityExecutionPayload payload, Bot bot,
                                               ArenaEntity target) {
        AbilityContracts.AbilityPhase phase = attachedPhase(payload);
        if (phase == null || phase.hitbox() == null) return false;
        double range = hitDetectionService.phaseRange(payload, 0);
        boolean rayHit = "ray".equals(phase.hitbox().shape())
                && hitDetectionService.rayHits(payload, bot, target.x(), target.y(), hitTargetSize(target) / 2.0);
        return rayHit || hitDetectionService.abilityRangeHits(
                bot, target.x(), target.y(), hitTargetSize(target), payload, range);
    }

    private static ArenaEntity applyImpact(ArenaEntity target, EffectSource source,
                                           int abilityId, AbilityContracts.AbilityPhase phase,
                                           AbilityContracts.PhaseEvent event, double distance,
                                           boolean summonTarget,
                                           ArenaBounds arena) {
        if (phase == null || event == null) return target;
        Set<EffectType> allowed = event.effectTypes().isEmpty()
                ? phase.effectTypes() : event.effectTypes();
        ArenaEntity next = target;
        for (AbilityContracts.Effect declared : phase.effects()) {
            if (declared == null || !allowed.contains(declared.type())) continue;
            if (declared.type() == EffectType.STATUS && !event.statusTypes().isEmpty()
                    && event.statusTypes().stream().noneMatch(statusType ->
                            statusType.equalsIgnoreCase(declared.subtype()))) continue;
            if (!summonTarget && declared.type() != EffectType.DAMAGE) continue;
            AbilityContracts.Effect resolved = withEffectOverride(declared,
                    effectOverrideFor(declared, phase.effectOverrides()));
            switch (resolved.type()) {
                case DAMAGE -> {
                    double amount = resolveEffectAmount(abilityId, resolved, null, distance,
                            phaseRange(phase)) * Math.max(0, source.damageMultiplier());
                    int hpBefore = Math.max(0, next.hp());
                    int hp = Math.max(0, (int) Math.round(hpBefore - Math.max(0, amount)));
                    next = next.withHp(hp).withDamageTakenThisTick(hpBefore - hp);
                }
                case STATUS -> next = applyStatus(next, resolved, abilityId, distance,
                        phaseRange(phase), phase.type() == AbilityContracts.PhaseType.ZONE);
                case INTERRUPT -> next = applyInterrupt(next, abilityId,
                        resolveEffectDuration(abilityId, resolved, distance, phaseRange(phase)));
                case KNOCKBACK -> next = moveEntity(next, source, resolved, arena, false,
                        resolveEffectAmount(abilityId, resolved, null, distance, phaseRange(phase)));
                case PULL -> next = moveEntity(next, source, resolved, arena, true,
                        resolveEffectAmount(abilityId, resolved, null, distance, phaseRange(phase)));
                default -> { }
            }
        }
        return next;
    }

    private static ArenaEntity applyStatus(ArenaEntity target, AbilityContracts.Effect effect,
                                           int abilityId, double distance, Double rangeOverride,
                                           boolean presenceSource) {
        String type = effect.subtype() == null ? "" : effect.subtype().toLowerCase();
        int duration = resolveEffectDuration(abilityId, effect, distance, rangeOverride);
        boolean presence = presenceSource && duration <= 0;
        if (type.isEmpty() || duration <= 0 && !presence) return target;
        int interval = effect.intervalMs() == null ? 0 : Math.max(0, effect.intervalMs());
        double amount = interval > 0
                ? resolveEffectAmount(abilityId, effect, null, distance, rangeOverride) : 0;
        int movementLock = effect.movementLockMs() == null ? 0 : effect.movementLockMs();
        ArenaEntity.EntityStatus incoming = new ArenaEntity.EntityStatus(
                type, duration, interval, 0, amount, movementLock, presence);
        List<ArenaEntity.EntityStatus> statuses = new java.util.ArrayList<>(target.statusEffects());
        int index = -1;
        for (int i = 0; i < statuses.size(); i++) {
            if (type.equalsIgnoreCase(statuses.get(i).type())) {
                index = i;
                break;
            }
        }
        if (index < 0) statuses.add(incoming);
        else {
            ArenaEntity.EntityStatus current = statuses.get(index);
            statuses.set(index, new ArenaEntity.EntityStatus(type,
                    Math.max(current.remainingMs(), incoming.remainingMs()),
                    Math.max(current.intervalMs(), incoming.intervalMs()),
                    current.tickElapsedMs(), Math.max(current.amount(), incoming.amount()),
                    Math.max(current.movementLockMs(), incoming.movementLockMs()),
                    current.presence() || incoming.presence()));
        }
        ArenaEntity next = target.withStatusEffects(statuses);
        return type.equals("silence") || type.equals("stun")
                ? resetExecutionTimer(next) : next;
    }

    private static ArenaEntity applyInterrupt(ArenaEntity target, int abilityId, int duration) {
        if (duration <= 0) return resetExecutionTimer(target);
        return applyStatus(target, new AbilityContracts.Effect(
                EffectType.STATUS, "stun", 0, duration, false), abilityId, 0, null, false);
    }

    private static ArenaEntity resetExecutionTimer(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        int interval = phase == null || phase.execution() == null
                || phase.execution().intervalMs() == null
                ? 1_000 : phase.execution().intervalMs();
        return new ArenaEntity(entity.id(), entity.type(), entity.ownerSlot(), entity.x(), entity.y(),
                entity.size(), entity.velocityX(), entity.velocityY(), entity.traveled(), entity.timerMs(),
                entity.armed(), entity.hp(), entity.damageMultiplier(),
                entity.abilityId(), Math.max(1, interval), entity.phaseTimerMs(), entity.ageMs(),
                entity.tickStartHp(), entity.damageTakenThisTick(), entity.damageTakenLastTick(),
                entity.hpNetChangeLastTick(), entity.rotation(), entity.hitLedger(), entity.phaseId(),
                entity.phaseLocked(), entity.statusEffects(), entity.eventSequence(), entity.eventType(),
                entity.eventScheduleState());
    }

    private static ArenaEntity moveEntity(ArenaEntity target, EffectSource source,
                                          AbilityContracts.Effect effect, ArenaBounds arena,
                                          boolean pull, double amount) {
        double dx = pull ? source.x() - target.x() : target.x() - source.x();
        double dy = pull ? source.y() - target.y() : target.y() - source.y();
        double magnitude = Math.max(.001, Math.hypot(dx, dy));
        double radius = target.size() / 2.0;
        double nextX = clamp(target.x() + dx / magnitude * amount, radius, arena.width() - radius);
        double nextY = clamp(target.y() + dy / magnitude * amount, radius, arena.height() - radius);
        return target.withPosition(nextX, nextY, target.velocityX(), target.velocityY());
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static AbilityContracts.EffectOverride effectOverrideFor(
            AbilityContracts.Effect effect,
            Map<String, AbilityContracts.EffectOverride> overrides) {
        if (effect == null || overrides == null || overrides.isEmpty()) return null;
        AbilityContracts.EffectOverride override = overrides.get(
                AbilityContracts.effectOverrideKey(effect));
        return override != null ? override : overrides.get(effect.type().name().toLowerCase());
    }

    private static double resolveEffectAmount(int abilityId,
                                              AbilityContracts.Effect effect,
                                              AbilityContracts.EffectOverride override,
                                              double distance, Double rangeOverride) {
        if (override != null && override.amount() != null && override.falloff() == null) {
            return override.amount();
        }
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(abilityId, distance, effect.falloff(), rangeOverride);
        }
        if (effect.runtimeComputed()) {
            return Abilities.amountAtDistance(abilityId, distance, null, rangeOverride);
        }
        return effect.amount();
    }

    private static int resolveEffectDuration(int abilityId,
                                             AbilityContracts.Effect effect,
                                             double distance, Double rangeOverride) {
        return Abilities.durationAtDistance(abilityId, distance,
                effect.durationMs(), effect.falloff(), rangeOverride);
    }

    private record EffectSource(int ownerSlot, double x, double y,
                                double velocityX, double velocityY,
                                double damageMultiplier) {}

    boolean mineHitByCurrentAttack(ArenaEntity mine, List<Bot> bots,
                                   List<ArenaEntity> entities) {
        return mineHitByAttack(mine, bots, entities);
    }

    private boolean mineHitByAttack(ArenaEntity mine, List<Bot> bots,
                                    List<ArenaEntity> entities) {
        if (entities.stream().anyMatch(entity -> entity != mine
                && projectilePhase(entity) && overlaps(entity, mine))) return true;
        for (Bot bot : bots) {
            AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(bot);
            if (payload == null || !hitDetectionService.isAttachedAbility(payload)) continue;
            AbilityContracts.AbilityPhase phase = attachedPhase(payload);
            double range = phase != null && phase.hitbox() != null
                    && "ray".equals(phase.hitbox().shape())
                    ? hitDetectionService.phaseRange(payload, 0) : 0;
            if (range > 0 && hitDetectionService.rayHits(payload, bot,
                    mine.x(), mine.y(), hitTargetSize(mine) / 2.0)) return true;
            double meleeRange = hitDetectionService.phaseRange(payload, 0);
            if (meleeRange > 0 && hitDetectionService.abilityRangeHits(
                    bot, mine.x(), mine.y(), hitTargetSize(mine), payload, meleeRange)) return true;
        }
        return false;
    }

    private static boolean projectilePhase(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        return phase != null && phase.type() == AbilityContracts.PhaseType.PROJECTILE;
    }

    private static double hitTargetSize(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        AbilityContracts.Hitbox hitbox = phase == null ? null : phase.hitbox();
        if (hitbox != null && "circle".equals(hitbox.shape()) && hitbox.radius() != null) {
            return Math.max(0, hitbox.radius() * hitbox.radiusMultiplier() * 2);
        }
        return entity.size();
    }

    private static boolean phaseHasEventEffect(AbilityContracts.AbilityPhase phase,
                                               AbilityContracts.PhaseEventType eventType,
                                               EffectType effectType) {
        AbilityContracts.PhaseEvent event = phase == null ? null : phase.events().get(eventType);
        if (event == null || !event.actions().contains(AbilityContracts.PhaseAction.APPLY_EFFECTS)) {
            return false;
        }
        Set<EffectType> allowed = event.effectTypes().isEmpty()
                ? phase.effectTypes() : event.effectTypes();
        return allowed.contains(effectType);
    }

    private static boolean eventTargetsKind(AbilityContracts.PhaseEvent event,
                                            AbilityContracts.TargetKind targetKind) {
        Set<AbilityContracts.TargetKind> targetKinds = event == null
                ? Set.of() : Set.copyOf(event.targetKinds());
        return targetKinds.isEmpty()
                ? targetKind == AbilityContracts.TargetKind.BOT
                : targetKinds.contains(targetKind);
    }

    private static double amountForEffect(AbilityExecutionPayload payload, double distance) {
        AbilityContracts.Effect effect = payload.phases().stream()
                .flatMap(phase -> phase.effects().stream())
                .filter(item -> item.type() == EffectType.DAMAGE)
                .findFirst().orElse(null);
        if (effect == null) return 0;
        return amountForEffect(payload.abilityId(), effect, distance, null);
    }

    private static double amountForEffect(int abilityId, AbilityContracts.Effect effect,
                                          double distance, Double rangeOverride) {
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(abilityId, distance,
                    effect.falloff(), rangeOverride);
        }
        return effect.runtimeComputed()
                ? Abilities.amountAtDistance(abilityId, distance, null, rangeOverride)
                : effect.amount();
    }

    private static AbilityContracts.Effect withEffectOverride(
            AbilityContracts.Effect effect,
            AbilityContracts.EffectOverride override) {
        if (override == null) return effect;
        AbilityContracts.Falloff falloff = override.falloff() == null
                ? effect.falloff()
                : effect.falloff() == null
                    ? override.falloff()
                    : effect.falloff().mergedWith(override.falloff());
        if (override.amount() != null && override.falloff() == null) falloff = null;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(),
                override.amount() == null ? effect.amount() : override.amount(),
                override.durationMs() == null ? effect.durationMs() : override.durationMs(),
                effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), falloff, effect.intervalMs(), effect.movementLockMs());
    }

    private static Double phaseRange(AbilityContracts.AbilityPhase phase) {
        if (phase == null) return null;
        AbilityContracts.Hitbox hitbox = phase.hitbox();
        if (hitbox != null) {
            if (hitbox.range() != null) return hitbox.range();
            if (hitbox.length() != null) return hitbox.length();
            if (hitbox.radius() != null) return hitbox.radius();
        }
        Map<String, Double> statOverrides = phase.statOverrides();
        if (statOverrides == null) return null;
        Double range = statOverrides.get("range");
        return range != null ? range : statOverrides.get("radius");
    }

    private static AbilityContracts.AbilityPhase attachedPhase(AbilityExecutionPayload payload) {
        return payload.phases().isEmpty() ? null : payload.phases().getFirst();
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return movingCollision(
                first,
                first.x() - first.velocityX(), first.y() - first.velocityY(), first.x(), first.y(),
                second,
                second.x() - second.velocityX(), second.y() - second.velocityY(), second.x(), second.y(),
                0).hit();
    }
}
