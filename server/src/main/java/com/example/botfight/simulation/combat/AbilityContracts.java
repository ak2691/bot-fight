package com.example.botfight.simulation.combat;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Gameplay-only ability metadata shared by authoritative combat resolvers. */
public final class AbilityContracts {
    private AbilityContracts() {}

    public enum EffectType { DAMAGE, HEALING, KNOCKBACK, PULL, DEBUFF, INTERRUPT, MOVEMENT, TELEPORT,
        RESTORE_STATE, DAMAGE_REDUCTION, DAMAGE_IMMUNITY, DAMAGE_REFLECTION, SPAWN_ENTITY }
    public enum DeliveryType { SELF, MELEE, RAY, PROJECTILE, RADIAL, FIELD, TRAP, SUMMON, TELEPORT }
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
    private static final Map<String, AbilityContract> CATALOG = Map.ofEntries(
            entry("swing", DeliveryType.MELEE, block(EffectType.DAMAGE), effect(EffectType.DAMAGE, 20)),
            entry("block", DeliveryType.SELF, IGNORE),
            entry("dash", DeliveryType.SELF, IGNORE, effect(EffectType.MOVEMENT, 400)),
            entry("fire_gun", DeliveryType.RAY, block(EffectType.DAMAGE), computed(EffectType.DAMAGE)),
            entry("throw_grenade", DeliveryType.PROJECTILE, shield(ShieldMode.BLOCK, 180, ChargeCost.DISTANCE_SCALED, EffectType.DAMAGE), computed(EffectType.DAMAGE), spawn("grenade")),
            entry("shoot_fireball", DeliveryType.PROJECTILE, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 15), debuff("burn", 2, 5000), spawn("fireball")),
            entry("stun", DeliveryType.MELEE, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 5), debuff("stun", 0, 1200)),
            entry("heavy_slash", DeliveryType.MELEE, shield(ShieldMode.BLOCK, 95, ChargeCost.ALL, EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 30), debuff("bleed", 2, 5000)),
            entry("repulsor_burst", DeliveryType.RADIAL, block(EffectType.DAMAGE), effect(EffectType.DAMAGE, 20), effect(EffectType.KNOCKBACK, 250)),
            entry("concussive_shot", DeliveryType.RAY, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 8), debuff("slow", 0, 2000)),
            entry("repair_pulse", DeliveryType.SELF, IGNORE, effect(EffectType.HEALING, 15)),
            entry("proximity_mine", DeliveryType.TRAP, shield(ShieldMode.BLOCK, 45, ChargeCost.ALL, EffectType.DAMAGE), effect(EffectType.DAMAGE, 18), spawn("proximity_mine")),
            entry("quick_jab", DeliveryType.MELEE, block(EffectType.DAMAGE), computed(EffectType.DAMAGE)),
            entry("pistol_shot", DeliveryType.RAY, block(EffectType.DAMAGE), computed(EffectType.DAMAGE)),
            entry("rail_shot", DeliveryType.RAY, block(EffectType.DAMAGE, EffectType.DEBUFF), effect(EffectType.DAMAGE, 40), debuff("shock", 3, 3000)),
            entry("gravity_grenade", DeliveryType.FIELD, shield(ShieldMode.BLOCK, 45, ChargeCost.ALL, EffectType.DAMAGE), effect(EffectType.PULL, 6), computed(EffectType.DAMAGE), spawn("gravity_field")),
            entry("silence_pulse", DeliveryType.PROJECTILE, block(EffectType.DEBUFF, EffectType.INTERRUPT), debuff("silence", 0, 2000), timed(EffectType.INTERRUPT, 100), spawn("silence_wave")),
            entry("reactive_armor", DeliveryType.SELF, IGNORE, effect(EffectType.DAMAGE_REDUCTION, .5), effect(EffectType.DAMAGE_REFLECTION, .5)),
            entry("hunter_drone", DeliveryType.SUMMON, block(EffectType.DAMAGE), effect(EffectType.DAMAGE, 3), spawn("hunter_drone")),
            entry("thrust", DeliveryType.MELEE, IGNORE, effect(EffectType.DAMAGE, 15), effect(EffectType.KNOCKBACK, 30)),
            entry("micro_dash", DeliveryType.SELF, IGNORE, effect(EffectType.MOVEMENT, 150)),
            entry("temporal_rewind", DeliveryType.SELF, IGNORE, timed(EffectType.RESTORE_STATE, 3000), spawn("temporal_rewind_zone")),
            entry("orbital_strike", DeliveryType.FIELD, shield(ShieldMode.DRAIN_WHILE_ACTIVE, 0, ChargeCost.ALL), computed(EffectType.DAMAGE), spawn("orbital_zone")),
            entry("absolute_guard", DeliveryType.SELF, IGNORE, timed(EffectType.DAMAGE_IMMUNITY, 1500)),
            entry("null_zone", DeliveryType.FIELD, IGNORE, debuff("silence", 0, 0), spawn("null_zone")),
            entry("phase_strike", DeliveryType.TELEPORT, IGNORE, effect(EffectType.TELEPORT, 50), effect(EffectType.DAMAGE, 14))
    );

    public static AbilityContract get(String abilityId) {
        AbilityContract contract = CATALOG.get(abilityId);
        if (contract == null) throw new IllegalArgumentException("Unknown ability contract: " + abilityId);
        return contract;
    }

    public static Map<String, AbilityContract> all() { return CATALOG; }

    private static Map.Entry<String, AbilityContract> entry(String id, DeliveryType delivery, ShieldInteraction shield, Effect... effects) {
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
