package com.example.botfight.simulation.gameconfig;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Gameplay-only ability metadata shared by authoritative combat resolvers. */
public final class AbilityContracts {
    private AbilityContracts() {}

    public enum EffectType { DAMAGE, HEALING, KNOCKBACK, PULL, DEBUFF, BUFF, INTERRUPT, MOVEMENT, TELEPORT,
        RESTORE_STATE, DAMAGE_REDUCTION, DAMAGE_IMMUNITY, DAMAGE_REFLECTION, SPAWN_ENTITY }
    public enum DeliveryType { SELF, MELEE, RAY, PROJECTILE, RADIAL, ZONE, TRAP, SUMMON }
    public enum ShieldMode { BLOCK, IGNORE, DRAIN_WHILE_ACTIVE }
    public enum ChargeCost { ONE, ALL, DISTANCE_SCALED }

    public record Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                         String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage) {
        public Effect(EffectType type) { this(type, null, 0, 0, false, null, false, false); }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed) {
            this(type, subtype, amount, durationMs, runtimeComputed, null, false, false);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient, requiresConfirmedDamage, false);
        }
    }
    public record ShieldInteraction(ShieldMode mode, double halfArcDegrees, ChargeCost chargeCost,
                                    Set<EffectType> prevents) {
        public boolean prevents(EffectType type) { return prevents.contains(type); }
    }
    public record Movement(String distanceStat, String stepDistanceStat,
                           String durationStat, String trailDurationStat) {}
    public record Execution(String targetMode, boolean captureAtActivation,
                             boolean faceTargetFromPayload, String phaseFacingDefault,
                             Movement movement, String blockedByStatus,
                             boolean ignoresGlobalAbilityLock) {
        public Execution(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault,
                         Movement movement) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, movement, null, false);
        }
        public Execution(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault,
                         Movement movement, String blockedByStatus) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, movement, blockedByStatus, false);
        }
    }
    public record AbilityContract(DeliveryType delivery, boolean includeTargetRadius,
                                  List<Effect> effects, ShieldInteraction shieldInteraction,
                                  Execution execution) {}

    private static final Execution NONE = new Execution(null, false, false, null, null);

    private static final ShieldInteraction IGNORE = new ShieldInteraction(ShieldMode.IGNORE, 0, ChargeCost.ONE, Set.of());
    private static final Map<Integer, AbilityContract> CATALOG = Map.ofEntries(
            entry(1, DeliveryType.MELEE, true, IGNORE, effect(EffectType.DAMAGE, 20)),
            entry(3, DeliveryType.RAY, IGNORE,
                    execution(null, true, false, null, null), computed(EffectType.DAMAGE)),
            entry(4, DeliveryType.PROJECTILE, IGNORE, computed(EffectType.DAMAGE), spawn("grenade")),
            entry(5, DeliveryType.PROJECTILE, IGNORE, effect(EffectType.DAMAGE, 15), debuff("burn", 2, Abilities.statusDurationMs(5, "burn", 5000)), spawn("fireball")),
            entry(6, DeliveryType.MELEE, true, IGNORE, effect(EffectType.DAMAGE, 5), debuff("stun", 0, Abilities.statusDurationMs(6, "stun", 1200))),
            entry(7, DeliveryType.MELEE, true, IGNORE, effect(EffectType.DAMAGE, 30), debuff("bleed", 2, Abilities.statusDurationMs(7, "bleed", 5000))),
            entry(8, DeliveryType.RADIAL, IGNORE, effect(EffectType.DAMAGE, 20), effect(EffectType.KNOCKBACK, 250)),
            entry(9, DeliveryType.RAY, IGNORE, effect(EffectType.DAMAGE, 20), debuff("slow", 0, Abilities.statusDurationMs(9, "slow", 1000))),
            entry(10, DeliveryType.SELF, IGNORE, effect(EffectType.HEALING, 25)),
            entry(11, DeliveryType.TRAP, IGNORE, effect(EffectType.DAMAGE, 25), spawn("proximity_mine")),
            entry(12, DeliveryType.RAY, IGNORE, computed(EffectType.DAMAGE)),
            entry(13, DeliveryType.RAY, IGNORE, effect(EffectType.DAMAGE, 40), debuff("shock", 3, Abilities.statusDurationMs(13, "shock", 3000))),
            entry(14, DeliveryType.PROJECTILE, IGNORE,
                    effect(EffectType.PULL, Abilities.stat(14, "pullPerTick", 6)),
                    computed(EffectType.DAMAGE), spawn("gravity_zone")),
            entry(15, DeliveryType.PROJECTILE, IGNORE, debuff("silence", 0, Abilities.statusDurationMs(15, "silence", 2000)), timed(EffectType.INTERRUPT, 100), spawn("silence_wave")),
            entry(16, DeliveryType.SELF, IGNORE,
                    timed(EffectType.DAMAGE_REDUCTION, .5, Abilities.statusDurationMs(16, "damage_reduction", 4000)),
                    timed(EffectType.DAMAGE_REFLECTION, .5, Abilities.statusDurationMs(16, "damage_reflection", 4000))),
            entry(17, DeliveryType.SUMMON, IGNORE, effect(EffectType.DAMAGE, 3), spawn("hunter_drone")),
            entry(18, DeliveryType.PROJECTILE, IGNORE, effect(EffectType.DAMAGE, 15), effect(EffectType.KNOCKBACK, 150), spawn("windburst_projectile")),
            entry(19, DeliveryType.SELF, IGNORE, execution("slow", new Movement("distance", "stepDistance", "activeMs", "trailMs")), effect(EffectType.MOVEMENT, 150)),
            entry(20, DeliveryType.SELF, IGNORE, execution("target", false, true, null, null)),
            entry(21, DeliveryType.SELF, IGNORE, timed(EffectType.RESTORE_STATE, 3000), spawn("temporal_rewind_zone")),
            entry(22, DeliveryType.ZONE, IGNORE, effect(EffectType.DAMAGE, 15), spawn("orbital_zone")),
            entry(23, DeliveryType.SELF, IGNORE, timed(EffectType.DAMAGE_IMMUNITY, 1, Abilities.statusDurationMs(23, "damage_immunity", 1500))),
            entry(24, DeliveryType.ZONE, IGNORE, debuff("silence", 0, 0), spawn("null_zone")),
            entry(25, DeliveryType.MELEE, IGNORE, execution(null, false, false, "face_target", null), effect(EffectType.TELEPORT, 50), effect(EffectType.DAMAGE, 14)),
            entry(26, DeliveryType.RADIAL, IGNORE,
                    effect(EffectType.DAMAGE, 10), debuff("slow", 0, Abilities.statusDurationMs(26, "slow", 1_500)), effect(EffectType.KNOCKBACK, 60)),
            entry(27, DeliveryType.ZONE, IGNORE,
                    effect(EffectType.PULL, Abilities.stat(27, "pullPerTick", 10)), computed(EffectType.DAMAGE), spawn("singularity_zone")),
            entry(28, DeliveryType.PROJECTILE, IGNORE,
                    effect(EffectType.DAMAGE, 10), effect(EffectType.PULL, Abilities.stat(28, "pullPerTick", 100)), debuff("slow", 0, Abilities.statusDurationMs(28, "slow", 1_200)),
                    spawn("tether_bolt")),
            entry(29, DeliveryType.TRAP, IGNORE,
                    effect(EffectType.DAMAGE, Abilities.definition(29).damage()),
                    debuff("slow", 0, Abilities.statusDurationMs(29, "slow", 2_200)), timed(EffectType.INTERRUPT, 150), spawn("static_snare")),
            entry(30, DeliveryType.RAY, IGNORE,
                    effect(EffectType.DAMAGE, 15), timed(EffectType.INTERRUPT, 250), debuff("slow", 0, Abilities.statusDurationMs(30, "slow", 2_000))),
            entry(31, DeliveryType.SUMMON, IGNORE,
                    effect(EffectType.DAMAGE, 2), effect(EffectType.KNOCKBACK, 35), spawn("repeller_drone")),
            entry(32, DeliveryType.RAY, IGNORE,
                    computed(EffectType.DAMAGE), lifesteal("source")),
            entry(33, DeliveryType.SELF, IGNORE,
                    buff("overclock", .5, Abilities.statusDurationMs(33, "overclock", 4_000))),
            entry(34, DeliveryType.MELEE, true, IGNORE,
                    effect(EffectType.DAMAGE, 5))
    );
    private static final Set<Integer> ACTIONS = CATALOG.keySet();

    public static AbilityContract get(int abilityId) {
        AbilityContract contract = CATALOG.get(abilityId);
        if (contract == null) throw new IllegalArgumentException("Unknown ability contract: " + abilityId);
        return contract;
    }
    public static Map<Integer, AbilityContract> all() { return CATALOG; }
    public static Set<Integer> actions() { return ACTIONS; }

    /** Resolves canonical submitted ability action IDs. */
    public static Integer abilityForAction(Object action) {
        if (action instanceof Integer id && ACTIONS.contains(id)) return id;
        return null;
    }

    public static boolean containsAction(Object action) {
        return abilityForAction(action) != null;
    }

    public static double effectAmount(int abilityId, EffectType type) {
        return get(abilityId).effects().stream()
                .filter(effect -> effect.type() == type)
                .findFirst()
                .map(Effect::amount)
                .orElse(0.0);
    }

    public static int effectDurationMs(int abilityId, String subtype) {
        return get(abilityId).effects().stream()
                .filter(effect -> effect.type() == EffectType.DEBUFF
                        && (subtype == null || subtype.equals(effect.subtype())))
                .findFirst()
                .map(Effect::durationMs)
                .orElse(0);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              ShieldInteraction shield, Effect... effects) {
        return entry(id, delivery, false, shield, NONE, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              boolean includeTargetRadius,
                                                              ShieldInteraction shield, Effect... effects) {
        return entry(id, delivery, includeTargetRadius, shield, NONE, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              ShieldInteraction shield, Execution execution,
                                                              Effect... effects) {
        return entry(id, delivery, false, shield, execution, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              boolean includeTargetRadius,
                                                              ShieldInteraction shield, Execution execution,
                                                              Effect... effects) {
        return Map.entry(id, new AbilityContract(delivery, includeTargetRadius,
                List.of(effects), shield, execution));
    }
    private static Execution execution(Movement movement) { return new Execution(null, false, false, null, movement); }
    private static Execution execution(String blockedByStatus, Movement movement) {
        return new Execution(null, false, false, null, movement, blockedByStatus);
    }
    private static Execution execution(String blockedByStatus, Movement movement, boolean ignoresGlobalAbilityLock) {
        return new Execution(null, false, false, null, movement, blockedByStatus, ignoresGlobalAbilityLock);
    }
    private static Execution execution(String targetMode, boolean captureAtActivation,
                                       boolean faceTargetFromPayload, String phaseFacingDefault,
                                       Movement movement) {
        return new Execution(targetMode, captureAtActivation, faceTargetFromPayload,
                phaseFacingDefault, movement);
    }
    private static Effect effect(EffectType type) { return new Effect(type); }
    private static Effect effect(EffectType type, double amount) { return new Effect(type, null, amount, 0, false); }
    private static Effect timed(EffectType type, int durationMs) { return new Effect(type, null, 0, durationMs, false); }
    private static Effect timed(EffectType type, double amount, int durationMs) { return new Effect(type, null, amount, durationMs, false); }
    private static Effect computed(EffectType type) { return new Effect(type, null, 0, 0, true); }
    private static Effect debuff(String subtype, double amount, int durationMs) { return new Effect(EffectType.DEBUFF, subtype, amount, durationMs, false); }
    private static Effect healing(double amount, String recipient, boolean requiresConfirmedDamage) {
        return new Effect(EffectType.HEALING, null, amount, 0, false, recipient, requiresConfirmedDamage);
    }
    private static Effect lifesteal(String recipient) {
        return new Effect(EffectType.HEALING, null, 0, 0, true, recipient, true, true);
    }
    private static Effect buff(String subtype, double amount, int durationMs) {
        return new Effect(EffectType.BUFF, subtype, amount, durationMs, false);
    }
    private static Effect spawn(String entityType) { return new Effect(EffectType.SPAWN_ENTITY, entityType, 0, 0, false); }
}
