package com.example.botfight.simulation.gameconfig;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Gameplay-only ability metadata shared by authoritative combat resolvers. */
public final class AbilityContracts {
    private AbilityContracts() {}

    public enum EffectType { DAMAGE, HEALING, KNOCKBACK, PULL, DEBUFF, INTERRUPT, MOVEMENT, TELEPORT,
        RESTORE_STATE, DAMAGE_REDUCTION, DAMAGE_IMMUNITY, DAMAGE_REFLECTION, SPAWN_ENTITY }
    public enum DeliveryType { SELF, MELEE, RAY, PROJECTILE, RADIAL, FIELD, TRAP, SUMMON }
    public enum ShieldMode { BLOCK, IGNORE, DRAIN_WHILE_ACTIVE }
    public enum ChargeCost { ONE, ALL, DISTANCE_SCALED }

    public record Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed) {
        public Effect(EffectType type) { this(type, null, 0, 0, false); }
    }
    public record ShieldInteraction(ShieldMode mode, double halfArcDegrees, ChargeCost chargeCost,
                                    Set<EffectType> prevents) {
        public boolean prevents(EffectType type) { return prevents.contains(type); }
    }
    public record AbilityContract(DeliveryType delivery, List<Effect> effects, ShieldInteraction shieldInteraction) {}

    private static final ShieldInteraction IGNORE = shield(ShieldMode.IGNORE, 0, ChargeCost.ONE);
    private static final Map<Integer, AbilityContract> CATALOG = Map.ofEntries(
            entry(1, DeliveryType.MELEE, block(EffectType.DAMAGE), effect(EffectType.DAMAGE, 20)),
            entry(2, DeliveryType.SELF, IGNORE), entry(3, DeliveryType.RAY, block(EffectType.DAMAGE), computed(EffectType.DAMAGE)),
            entry(4, DeliveryType.PROJECTILE, shield(ShieldMode.BLOCK, 180, ChargeCost.DISTANCE_SCALED, EffectType.DAMAGE), computed(EffectType.DAMAGE), spawn("grenade")),
            entry(5, DeliveryType.PROJECTILE, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 15), debuff("burn", 2, 5000), spawn("fireball")),
            entry(6, DeliveryType.MELEE, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 5), debuff("stun", 0, 1200)),
            entry(7, DeliveryType.MELEE, shield(ShieldMode.BLOCK, 95, ChargeCost.ALL, EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 30), debuff("bleed", 2, 5000)),
            entry(8, DeliveryType.RADIAL, block(EffectType.DAMAGE), effect(EffectType.DAMAGE, 20), effect(EffectType.KNOCKBACK, 250)),
            entry(9, DeliveryType.RAY, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 8), debuff("slow", 0, 2000)),
            entry(10, DeliveryType.SELF, IGNORE, effect(EffectType.HEALING, 15)),
            entry(11, DeliveryType.TRAP, shield(ShieldMode.BLOCK, 45, ChargeCost.ALL, EffectType.DAMAGE), effect(EffectType.DAMAGE, 18), spawn("proximity_mine")),
            entry(12, DeliveryType.RAY, block(EffectType.DAMAGE), computed(EffectType.DAMAGE)),
            entry(13, DeliveryType.RAY, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 40), debuff("shock", 3, 3000)),
            entry(14, DeliveryType.FIELD, shield(ShieldMode.BLOCK, 45, ChargeCost.ALL, EffectType.DAMAGE), effect(EffectType.PULL, 6), computed(EffectType.DAMAGE), spawn("gravity_field")),
            entry(15, DeliveryType.PROJECTILE, block(EffectType.DEBUFF, EffectType.INTERRUPT), debuff("silence", 0, 2000), timed(EffectType.INTERRUPT, 100), spawn("silence_wave")),
            entry(16, DeliveryType.SELF, IGNORE, effect(EffectType.DAMAGE_REDUCTION, .5), effect(EffectType.DAMAGE_REFLECTION, .5)),
            entry(17, DeliveryType.SUMMON, block(EffectType.DAMAGE), effect(EffectType.DAMAGE, 3), spawn("hunter_drone")),
            entry(18, DeliveryType.PROJECTILE, IGNORE, effect(EffectType.DAMAGE, 15), effect(EffectType.KNOCKBACK, 90)),
            entry(19, DeliveryType.SELF, IGNORE, effect(EffectType.MOVEMENT, 150)), entry(20, DeliveryType.SELF, IGNORE),
            entry(21, DeliveryType.SELF, IGNORE, timed(EffectType.RESTORE_STATE, 3000), spawn("temporal_rewind_zone")),
            entry(22, DeliveryType.FIELD, shield(ShieldMode.DRAIN_WHILE_ACTIVE, 0, ChargeCost.ALL), computed(EffectType.DAMAGE), spawn("orbital_zone")),
            entry(23, DeliveryType.SELF, IGNORE, timed(EffectType.DAMAGE_IMMUNITY, 1500)),
            entry(24, DeliveryType.FIELD, IGNORE, debuff("silence", 0, 0), spawn("null_zone")),
            entry(25, DeliveryType.MELEE, block(EffectType.TELEPORT, EffectType.DAMAGE), effect(EffectType.TELEPORT, 50), effect(EffectType.DAMAGE, 14))
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
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery, ShieldInteraction shield, Effect... effects) {
        return Map.entry(id, new AbilityContract(delivery, List.of(effects), shield));
    }
    private static Effect effect(EffectType type) { return new Effect(type); }
    private static Effect effect(EffectType type, double amount) { return new Effect(type, null, amount, 0, false); }
    private static Effect timed(EffectType type, int durationMs) { return new Effect(type, null, 0, durationMs, false); }
    private static Effect computed(EffectType type) { return new Effect(type, null, 0, 0, true); }
    private static Effect debuff(String subtype, double amount, int durationMs) { return new Effect(EffectType.DEBUFF, subtype, amount, durationMs, false); }
    private static Effect spawn(String entityType) { return new Effect(EffectType.SPAWN_ENTITY, entityType, 0, 0, false); }
    private static ShieldInteraction block(EffectType... prevents) { return shield(ShieldMode.BLOCK, 95, ChargeCost.ONE, prevents); }
    private static ShieldInteraction shield(ShieldMode mode, double arc, ChargeCost cost, EffectType... prevents) {
        return new ShieldInteraction(mode, arc, cost, Set.of(prevents));
    }

}
