package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.CombatLog;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.AbilityPhase;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.GameplayData;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The effect registry: one apply function per effect type, used for bots and HP entities alike, whether the
 * effect comes from a bot's trigger verb or from an arena entity. Mirrors the browser's
 * {@code ecs/abilities/effects.js}.
 *
 * <p>An effect is applied to a {@link Context}: the source (where it comes from), the target (a bot or an
 * entity) and the host hooks that change simulation state. Effects that change the casting bot itself
 * (healing, buffs, defensive statuses, teleport, restore state) are {@code self} effects and only apply to a
 * direct ability's owner.
 */
public final class Effects {
    private Effects() {}

    private static final Map<String, GameplayData.StatusPreset> STATUS_PRESETS =
            GameplayData.get().statuses().statuses();
    /** Source name recorded on a status that lasts only while its bearer stands inside a zone. */
    private static final String PRESENCE_SOURCE = "null_zone";
    private static final double STEP_SECONDS = 0.1;

    /** Effect types that land on the enemy bot and so count as a hit for Time Since Hit. */
    public static final Set<EffectType> ENEMY_HIT_EFFECT_TYPES = Set.of(
            EffectType.DAMAGE, EffectType.STATUS, EffectType.INTERRUPT,
            EffectType.KNOCKBACK, EffectType.PULL);

    /** What the simulation does for the registry. */
    public interface Host {
        /** Hurts a bot on behalf of the owner (through shields, reflection and incoming modifiers). */
        void damage(AbilityEntityBot target, double amount, int ownerSlot, double fromX, double fromY);

        /** The owner's damage multiplier, or null when the owner is gone (a status then lands nothing). */
        Double ownerDamageMultiplier(int ownerSlot);

        /** Teleports the owner relative to the defender; only direct abilities teleport. */
        default void teleport(Bot owner, Bot defender, double distance) {}
    }

    /** Everything one effect needs. The target is {@code bot} or {@code entity}; an entity is replaced by apply. */
    public static final class Context {
        public int abilityId;
        /** The range falloff is measured against, or null. */
        public Double range;
        public int ownerSlot;
        public double sourceX;
        public double sourceY;
        public double sourceVelocityX;
        public double sourceVelocityY;
        /** Where knockback pushes away from; defaults to the source. */
        public double pushOriginX = Double.NaN;
        public double pushOriginY = Double.NaN;
        /** Where a pull draws toward; defaults to the source. */
        public double pullX = Double.NaN;
        public double pullY = Double.NaN;
        public double damageMultiplier = 1.0;
        /** True when the source is an arena entity; its pushes do not carry velocity and it has no self effects. */
        public boolean fromEntity;
        /** True when the source is a zone, so a timed-less silence lasts while the target stands inside. */
        public boolean zoneSource;
        public boolean useSourceVelocityForKnockback;
        public Host host;
        public ArenaBounds arena;
        /** Source-to-target distance for falloff when the caller measured it; null to measure it per effect. */
        public Double fixedDistance;
        /** The distance the effect being applied uses. */
        double distance;

        public AbilityEntityBot bot;
        public ArenaEntity entity;

        /** Direct abilities: the casting bot and the bot the ability landed on. */
        public Bot owner;
        public Bot defender;
        public boolean skipTeleport;
        public double confirmedDamage;

        double botX() { return bot != null ? bot.entityX() : entity.x(); }
        double botY() { return bot != null ? bot.entityY() : entity.y(); }
    }

    @FunctionalInterface
    private interface Applier {
        void apply(Context ctx, AbilityContracts.Effect effect);
    }

    private record Entry(boolean self, Applier applier) {}

    private static final Map<EffectType, Entry> REGISTRY = new EnumMap<>(EffectType.class);

    static {
        REGISTRY.put(EffectType.DAMAGE, new Entry(false, Effects::applyDamage));
        REGISTRY.put(EffectType.HEALING, new Entry(true, Effects::applyHealing));
        REGISTRY.put(EffectType.BUFF, new Entry(true, Effects::applyBuff));
        REGISTRY.put(EffectType.DAMAGE_REDUCTION, new Entry(true, Effects::applyDamageReduction));
        REGISTRY.put(EffectType.DAMAGE_REFLECTION, new Entry(true, Effects::applyDamageReflection));
        REGISTRY.put(EffectType.DAMAGE_IMMUNITY, new Entry(true, Effects::applyDamageImmunity));
        REGISTRY.put(EffectType.STATUS, new Entry(false, Effects::applyStatus));
        REGISTRY.put(EffectType.INTERRUPT, new Entry(false, Effects::applyInterrupt));
        REGISTRY.put(EffectType.KNOCKBACK, new Entry(false, Effects::applyKnockback));
        REGISTRY.put(EffectType.PULL, new Entry(false, Effects::applyPull));
        REGISTRY.put(EffectType.TELEPORT, new Entry(true, Effects::applyTeleport));
        REGISTRY.put(EffectType.RESTORE_STATE, new Entry(true, Effects::applyRestoreState));
    }

    /**
     * Applies one effect through the registry. Without a fixed distance the effect measures from the source to
     * where the target stands now, so an earlier knockback in the same ability changes a later falloff.
     */
    public static void apply(AbilityContracts.Effect effect, Context ctx) {
        Entry entry = REGISTRY.get(effect.type());
        if (entry == null || entry.self() && ctx.fromEntity) return;
        ctx.distance = ctx.fixedDistance != null ? ctx.fixedDistance
                : ctx.bot == null && ctx.entity == null ? 0
                : Math.hypot(ctx.botX() - ctx.sourceX, ctx.botY() - ctx.sourceY);
        entry.applier().apply(ctx, withResolvedDuration(effect, ctx));
    }

    private static boolean isEntityTarget(Context ctx) {
        return ctx.entity != null;
    }

    // ---- damage

    private static void applyDamage(Context ctx, AbilityContracts.Effect effect) {
        double amount = amountForEffect(ctx.abilityId, effect, ctx.distance, ctx.range)
                * Math.max(0, ctx.damageMultiplier);
        if (isEntityTarget(ctx)) {
            int hpBefore = Math.max(0, ctx.entity.hp());
            int hp = Math.max(0, (int) Math.round(hpBefore - Math.max(0, amount)));
            CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.entityRef(ctx.entity),
                    null, "damage", hpBefore - hp);
            ctx.entity = ctx.entity.withHp(hp).withDamageTakenThisTick(hpBefore - hp);
            return;
        }
        if (ctx.bot == null || ctx.bot.entityHp() <= 0) return;
        double hpBefore = ctx.bot.entityHp();
        ctx.host.damage(ctx.bot, amount, ctx.ownerSlot, ctx.sourceX, ctx.sourceY);
        ctx.confirmedDamage += Math.max(0, hpBefore - ctx.bot.entityHp());
    }

    // ---- status

    private static void applyStatus(Context ctx, AbilityContracts.Effect effect) {
        GameplayData.StatusPreset preset = STATUS_PRESETS.get(effect.subtype());
        if (preset == null) {
            throw new IllegalArgumentException(
                    "Unsupported status effect subtype for ability " + ctx.abilityId + ": " + effect.subtype());
        }
        boolean presence = Boolean.TRUE.equals(preset.presenceWhenInside()) && ctx.zoneSource
                && effect.durationMs() <= 0;
        if (isEntityTarget(ctx)) {
            if (effect.durationMs() <= 0 && !presence) return;
            StatusEffectState status = buildStatus(preset, effect, ctx.abilityId, null,
                    Math.max(1.0, ctx.damageMultiplier), presence, ctx.distance, ctx.range);
            ctx.entity = upsertEntityStatus(ctx.entity, status);
            return;
        }
        if (ctx.bot == null || ctx.bot.entityHp() <= 0) return;
        Double multiplier = ctx.host.ownerDamageMultiplier(ctx.ownerSlot);
        if (multiplier == null) return;
        StatusEffectState status = buildStatus(preset, effect, ctx.abilityId, ctx.ownerSlot,
                multiplier, presence, ctx.distance, ctx.range);
        ctx.bot.applyStatus(status, Boolean.TRUE.equals(preset.clearsVelocity()));
    }

    /**
     * Builds the status a status effect applies from its preset in shared/gameplay/statuses.json, for bots and
     * summons alike. The preset names the status's effects; "$amount", "$damageMultiplier" and
     * "$movementLockMs" take their value from the effect that applies it and from its source.
     */
    static StatusEffectState buildStatus(GameplayData.StatusPreset preset, AbilityContracts.Effect effect,
                                         int abilityId, Integer sourceSlot, double damageMultiplier,
                                         boolean presence, double distance, Double range) {
        int tickMs = preset.tickIntervalDefaultMs() == null ? 0
                : effect.intervalMs() == null ? preset.tickIntervalDefaultMs() : Math.max(0, effect.intervalMs());
        StatusEffectState status = new StatusEffectState(effect.subtype(), effect.durationMs(), tickMs);
        if (presence) status.presence(PRESENCE_SOURCE);
        if (Boolean.TRUE.equals(preset.carriesSourceSlot())) status.sourceSlot = sourceSlot;
        status.abilityId = abilityId;
        double amount = effect.falloff() != null && effect.falloff().hasAmountProfile()
                ? amountForEffect(abilityId, effect, distance, range) : effect.amount();
        for (GameplayData.StatusEffectData entry : preset.effects()) {
            StatusEffectState.Effect component = new StatusEffectState.Effect(entry.type(), entry.mode());
            if (entry.amount() != null) component.amount(tokenValue(entry.amount(), effect, amount, damageMultiplier));
            if (entry.multiplier() != null) {
                component.multiplier(tokenValue(entry.multiplier(), effect, amount, damageMultiplier));
            }
            if (entry.durationMs() != null) {
                component.durationMs((int) tokenValue(entry.durationMs(), effect, amount, damageMultiplier));
            }
            if (entry.movementMultiplier() != null) {
                component.movement(entry.movementMultiplier(), entry.rotationMultiplier());
            }
            if (entry.damageModifier() != null) component.damageModifier(entry.damageModifier());
            if (entry.rounding() != null) component.rounding(entry.rounding());
            if (entry.excludedDamageSourceTypes() != null) {
                entry.excludedDamageSourceTypes().forEach(component::excludeDamageSourceType);
            }
            status.addEffect(component);
        }
        return status;
    }

    private static double tokenValue(Object value, AbilityContracts.Effect effect, double amount,
                                     double damageMultiplier) {
        if (value instanceof Number number) return number.doubleValue();
        return switch ((String) value) {
            case "$amount" -> amount;
            case "$damageMultiplier" -> damageMultiplier;
            case "$movementLockMs" -> effect.movementLockMs() == null ? 0 : effect.movementLockMs();
            default -> throw new IllegalStateException("Unknown status token " + value);
        };
    }

    /** The preset-built status an entity carries: the same status, flattened to what an entity ticks. */
    private static ArenaEntity upsertEntityStatus(ArenaEntity target, StatusEffectState status) {
        CombatLog.record("status", null, CombatLog.entityRef(target), null, status.type, status.remainingMs);
        double tickDamage = status.effects.stream().filter(effect -> "damage".equals(effect.type))
                .mapToDouble(effect -> effect.amount).findFirst().orElse(0);
        int movementLockMs = status.effects.stream().filter(effect -> "movement_lock".equals(effect.type))
                .mapToInt(effect -> effect.durationMs).findFirst().orElse(0);
        ArenaEntity.EntityStatus incoming = new ArenaEntity.EntityStatus(status.type, status.remainingMs,
                status.tickMs, 0, tickDamage, movementLockMs, "presence".equals(status.mode));
        List<ArenaEntity.EntityStatus> statuses = new ArrayList<>(target.statusEffects());
        int index = -1;
        for (int i = 0; i < statuses.size(); i++) {
            if (status.type.equalsIgnoreCase(statuses.get(i).type())) {
                index = i;
                break;
            }
        }
        if (index < 0) {
            statuses.add(incoming);
        } else {
            ArenaEntity.EntityStatus current = statuses.get(index);
            statuses.set(index, new ArenaEntity.EntityStatus(status.type,
                    Math.max(current.remainingMs(), incoming.remainingMs()),
                    Math.max(current.intervalMs(), incoming.intervalMs()),
                    current.tickElapsedMs(), Math.max(current.amount(), incoming.amount()),
                    Math.max(current.movementLockMs(), incoming.movementLockMs()),
                    current.presence() || incoming.presence()));
        }
        ArenaEntity next = target.withStatusEffects(statuses);
        boolean blocksExecution = status.effects.stream().anyMatch(effect ->
                "silence".equals(effect.type) || "stun".equals(effect.type));
        return blocksExecution ? resetExecutionTimer(next) : next;
    }

    /** A silenced or stunned summon starts its attack timer over. */
    private static ArenaEntity resetExecutionTimer(ArenaEntity entity) {
        AbilityPhase phase = AbilityContracts.phaseFor(entity);
        AbilityContracts.PhaseEvent schedule = phase == null ? null
                : phase.on().get(AbilityContracts.PhaseEventType.SCHEDULE);
        int interval = schedule == null || schedule.schedule() == null
                || schedule.schedule().intervalMs() == null
                ? 1_000 : schedule.schedule().intervalMs();
        return entity.withIntervalTimerMs(Math.max(1, interval));
    }

    // ---- interrupt

    private static void applyInterrupt(Context ctx, AbilityContracts.Effect effect) {
        int durationMs = effect.durationMs();
        if (isEntityTarget(ctx)) {
            CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.entityRef(ctx.entity),
                    null, "interrupt", durationMs);
            if (durationMs <= 0) {
                ctx.entity = resetExecutionTimer(ctx.entity);
                return;
            }
            AbilityContracts.Effect stun = new AbilityContracts.Effect(
                    EffectType.STATUS, "stun", 0, durationMs, false);
            GameplayData.StatusPreset preset = STATUS_PRESETS.get("stun");
            ctx.entity = upsertEntityStatus(ctx.entity, buildStatus(preset, stun, ctx.abilityId, null,
                    1.0, false, 0, null));
            return;
        }
        if (ctx.bot == null || ctx.bot.entityHp() <= 0) return;
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.bot(ctx.bot.entitySlot()),
                null, "interrupt", durationMs);
        ctx.bot.applyInterrupt(durationMs, ctx.abilityId);
    }

    // ---- knockback and pull

    private static void applyKnockback(Context ctx, AbilityContracts.Effect effect) {
        double amount = amountForEffect(ctx.abilityId, effect, ctx.distance, ctx.range);
        logPush("knockback", ctx, amount);
        double dx;
        double dy;
        if (ctx.useSourceVelocityForKnockback) {
            dx = ctx.sourceVelocityX;
            dy = ctx.sourceVelocityY;
        } else {
            double originX = Double.isNaN(ctx.pushOriginX) ? ctx.sourceX : ctx.pushOriginX;
            double originY = Double.isNaN(ctx.pushOriginY) ? ctx.sourceY : ctx.pushOriginY;
            dx = ctx.botX() - originX;
            dy = ctx.botY() - originY;
        }
        displace(ctx, dx, dy, amount);
    }

    private static void applyPull(Context ctx, AbilityContracts.Effect effect) {
        double amount = amountForEffect(ctx.abilityId, effect, ctx.distance, ctx.range);
        logPush("pull", ctx, amount);
        double pullX = Double.isNaN(ctx.pullX) ? ctx.sourceX : ctx.pullX;
        double pullY = Double.isNaN(ctx.pullY) ? ctx.sourceY : ctx.pullY;
        displace(ctx, pullX - ctx.botX(), pullY - ctx.botY(), amount);
    }

    private static void logPush(String name, Context ctx, double amount) {
        String target = isEntityTarget(ctx)
                ? CombatLog.entityRef(ctx.entity) : CombatLog.bot(ctx.bot.entitySlot());
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), target, null, name, amount);
    }

    /**
     * Moves the target along (dx, dy) by {@code distance}, inside the arena. A bot pushed by its attacker's
     * ability also takes on the speed of the push, so it shows as moving that tick.
     */
    private static void displace(Context ctx, double dx, double dy, double distance) {
        if (ctx.arena == null) return;
        boolean carriesVelocity = ctx.bot != null && !ctx.fromEntity;
        double magnitude = Math.hypot(dx, dy);
        if (carriesVelocity && (magnitude <= 0.0001 || distance <= 0)) return;
        magnitude = Math.max(carriesVelocity ? 0.0001 : 0.001, magnitude);
        double radius = (ctx.bot != null ? ctx.bot.entitySize() : ctx.entity.size()) / 2.0;
        double nextX = clamp(ctx.botX() + dx / magnitude * distance, radius, ctx.arena.width() - radius);
        double nextY = clamp(ctx.botY() + dy / magnitude * distance, radius, ctx.arena.height() - radius);
        if (ctx.bot != null) {
            ctx.bot.setEntityPosition(nextX, nextY);
            if (carriesVelocity) {
                ctx.bot.setEntityVelocity(dx / magnitude * distance / STEP_SECONDS,
                        dy / magnitude * distance / STEP_SECONDS);
            }
        } else {
            ctx.entity = ctx.entity.withPosition(nextX, nextY, ctx.entity.velocityX(), ctx.entity.velocityY());
        }
    }

    // ---- self effects (a direct ability's owner)

    private static void applyHealing(Context ctx, AbilityContracts.Effect effect) {
        if (effect.requiresConfirmedDamage() && ctx.confirmedDamage <= 0) return;
        Bot recipient = "target".equals(effect.recipient()) || "defender".equals(effect.recipient())
                ? ctx.defender : ctx.owner;
        if (recipient == null) return;
        double healing = effect.mirrorsDamage()
                ? ctx.confirmedDamage : amountForEffect(ctx.abilityId, effect, ctx.distance, ctx.range);
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.bot(recipient.slot), null,
                "healing", healing);
        recipient.pendingHealing += healing;
    }

    private static void applyBuff(Context ctx, AbilityContracts.Effect effect) {
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.bot(ctx.owner.slot), null,
                "buff", effect.amount());
        if (!"overclock".equals(effect.subtype())) return;
        StatusEffectState status = new StatusEffectState("overclock", effect.durationMs(), 0)
                .addEffect(new StatusEffectState.Effect("cooldown_modifier", "constant")
                        .multiplier(Math.max(0, 1.0 - effect.amount())));
        status.abilityId = ctx.abilityId;
        BotStateService.upsertStatusEffect(ctx.owner, status);
    }

    private static void applyDamageReduction(Context ctx, AbilityContracts.Effect effect) {
        logSelf(ctx, "damage_reduction", effect.amount());
        applyDefensiveStatus(ctx, "reactive-armor", effect.durationMs(),
                new StatusEffectState.Effect("incoming_damage_modifier", "constant")
                        .damageModifier(-Math.max(0, effect.amount())));
    }

    private static void applyDamageReflection(Context ctx, AbilityContracts.Effect effect) {
        logSelf(ctx, "damage_reflection", effect.amount());
        applyDefensiveStatus(ctx, "reactive-armor", effect.durationMs(),
                new StatusEffectState.Effect("damage_reflection", "constant")
                        .multiplier(Math.max(0, effect.amount())));
    }

    private static void applyDamageImmunity(Context ctx, AbilityContracts.Effect effect) {
        logSelf(ctx, "damage_immunity", effect.amount());
        applyDefensiveStatus(ctx, "absolute-guard", effect.durationMs(),
                new StatusEffectState.Effect("damage_immunity", "constant")
                        .amount(Math.max(0, effect.amount())));
    }

    private static void logSelf(Context ctx, String name, double amount) {
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.bot(ctx.owner.slot), null, name, amount);
    }

    private static void applyDefensiveStatus(Context ctx, String type, int durationMs,
                                             StatusEffectState.Effect application) {
        StatusEffectState status = new StatusEffectState(type, durationMs, 0);
        status.abilityId = ctx.abilityId;
        status.addEffect(application);
        BotStateService.upsertStatusEffect(ctx.owner, status);
    }

    private static void applyTeleport(Context ctx, AbilityContracts.Effect effect) {
        if (ctx.skipTeleport || ctx.defender == null || ctx.arena == null) return;
        double teleportDistance = "center_distance".equals(effect.distanceMode())
                ? Math.hypot(ctx.defender.x - ctx.sourceX, ctx.defender.y - ctx.sourceY)
                : amountForEffect(ctx.abilityId, effect, ctx.distance, ctx.range);
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.bot(ctx.owner.slot), null,
                "teleport", teleportDistance);
        ctx.host.teleport(ctx.owner, ctx.defender, teleportDistance);
    }

    private static void applyRestoreState(Context ctx, AbilityContracts.Effect effect) {
        CombatLog.record("effect", CombatLog.bot(ctx.ownerSlot), CombatLog.bot(ctx.owner.slot), null,
                "restore_state", effect.durationMs());
        ctx.owner.temporalRewindX = ctx.owner.x;
        ctx.owner.temporalRewindY = ctx.owner.y;
        ctx.owner.temporalRewindHp = ctx.owner.hp;
        ctx.owner.temporalRewindMs = effect.durationMs();
        ctx.owner.temporalRewindPulseMs = 0;
    }

    // ---- amounts, durations and ranges

    private static AbilityContracts.Effect withResolvedDuration(AbilityContracts.Effect effect, Context ctx) {
        int durationMs = Abilities.durationAtDistance(ctx.abilityId, ctx.distance, effect.durationMs(),
                effect.falloff(), ctx.range);
        if (durationMs == effect.durationMs()) return effect;
        return new AbilityContracts.Effect(effect.type(), effect.subtype(), effect.amount(),
                durationMs, effect.runtimeComputed(), effect.recipient(),
                effect.requiresConfirmedDamage(), effect.mirrorsDamage(),
                effect.distanceMode(), effect.falloff(), effect.intervalMs(), effect.movementLockMs(),
                effect.targetKinds());
    }

    /** An effect's amount at a distance, applying its falloff profile when it has one. */
    public static double amountForEffect(int abilityId, AbilityContracts.Effect effect,
                                         double distance, Double range) {
        if (effect.falloff() != null && effect.falloff().hasAmountProfile()) {
            return Abilities.amountAtDistance(abilityId, distance, effect.falloff(), range);
        }
        return effect.runtimeComputed()
                ? Abilities.amountAtDistance(abilityId, distance, null, range)
                : effect.amount();
    }

    /** The reach a phase's falloff is measured against: its radius, else its range or length. */
    public static Double phaseRange(AbilityPhase phase) {
        return phase == null ? null : hitboxRange(phase.hitbox());
    }

    /** The reach a hitbox's falloff is measured against: its radius, else its range or length. */
    public static Double hitboxRange(AbilityContracts.Hitbox hitbox) {
        if (hitbox == null) return null;
        if ("circle".equals(hitbox.shape()) && hitbox.radius() != null) return hitbox.radius();
        if (hitbox.range() != null) return hitbox.range();
        if (hitbox.length() != null) return hitbox.length();
        return hitbox.radius();
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
