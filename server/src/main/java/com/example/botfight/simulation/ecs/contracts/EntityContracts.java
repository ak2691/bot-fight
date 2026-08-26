package com.example.botfight.simulation.ecs.contracts;

import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;

import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Declarative metadata for ability-created entities.
 *
 * AbilityContracts owns delivery and ordered effect semantics. This registry
 * owns the ECS payload shape and the behavior family that advances it. Runtime
 * entity type strings are replay metadata; stable ability IDs are the lookup
 * key used by authoritative simulation code.
 */
public final class EntityContracts {
    public enum FactoryType { ENTITY, THROWN_ZONE }
    public enum SystemType { PROJECTILE, ABILITY }
    public enum Category { PROJECTILE, TRAP, SUMMON, ZONE }
    public enum SpawnMode { SELF, FORWARD, TARGET }
    public enum RotationMode { OWNER, ZERO }
    public enum TimerMode { NONE, AGE, REMAINING, STOPPED, FUSE }
    public enum BehaviorKind { TRAP, PHASE, SEGMENT, ZONE, SUMMON, DELAYED_ZONE, INTERVAL, LIFETIME, RADIAL, VISUAL_ZONE }
    public enum HitMode { ALL, NEAREST }
    public enum SelectableOwner { OWNER, NONE }

    public record Spawn(SpawnMode mode, RotationMode rotation, double padding,
                        String clampToRadiusStat, double defaultX, double defaultY) {}

    public record Motion(String speedStat, double initialTraveled, double stepRatio) {}

    public record Lifetime(TimerMode timerMode, String stat, int add) {}

    public record Collider(String sizeStat, boolean hittable) {}

    public record Health(String hpStat, String maxHpStat) {}

    public record InitialState(boolean armed, boolean damageMultiplierFromOwner) {}

    public record Hit(HitMode mode, boolean removeOnHit, boolean stopOnBlocked,
                      boolean oncePerSlot, String knockbackDirection,
                      Set<AbilityContracts.EffectType> effectTypes) {
        public Hit {
            effectTypes = immutableEffects(effectTypes);
        }
    }

    /**
     * A trigger can be selected by elapsed time or by an event. For hittable
     * traps, requiresDestruction gates attack triggers until the current hit
     * actually reduces the entity's HP to zero.
     */
    public record Trigger(String radiusStat, String lifetimeStat, boolean attackHits,
                          boolean projectileOverlap, boolean botContact, boolean chain,
                          boolean requiresDestruction) {
        public Trigger(String radiusStat, String lifetimeStat, boolean attackHits,
                       boolean projectileOverlap, boolean botContact, boolean chain) {
            this(radiusStat, lifetimeStat, attackHits, projectileOverlap, botContact, chain, false);
        }
    }

    public record EffectOverride(Double amount, Integer durationMs) {}

    public record Phase(String id, int startMs, Movement movement, Trigger trigger,
                        Set<AbilityContracts.EffectType> effectTypes, boolean skipShield,
                        Derived explosion, Map<String, Double> statOverrides,
                        Map<AbilityContracts.EffectType, EffectOverride> effectOverrides) {
        public Phase {
            effectTypes = immutableEffects(effectTypes);
            statOverrides = statOverrides == null ? Map.of() : Map.copyOf(statOverrides);
            effectOverrides = effectOverrides == null ? Map.of() : Map.copyOf(effectOverrides);
        }

        public Phase(String id, int startMs, Movement movement, Trigger trigger,
                     Set<AbilityContracts.EffectType> effectTypes, boolean skipShield,
                     Derived explosion) {
            this(id, startMs, movement, trigger, effectTypes, skipShield, explosion, Map.of(), Map.of());
        }

        public Phase(String id, int startMs, Movement movement, Trigger trigger,
                     Set<AbilityContracts.EffectType> effectTypes, boolean skipShield,
                     Derived explosion, Map<String, Double> statOverrides) {
            this(id, startMs, movement, trigger, effectTypes, skipShield, explosion, statOverrides, Map.of());
        }
    }

    public record Movement(String mode, String durationStat, double stepRatio,
                           boolean continueDuringFuse) {
        public Movement(String mode, String durationStat, double stepRatio) {
            this(mode, durationStat, stepRatio, false);
        }
    }

    public record Attack(String rangeStat, String cooldownStat, String visualStat,
                         Set<AbilityContracts.EffectType> effectTypes) {
        public Attack {
            effectTypes = immutableEffects(effectTypes);
        }
    }

    public record Derived(String type, String behaviorKey, Category category, SystemType system,
                          BehaviorKind kind, String sizeStat, double sizeMultiplier,
                          String visibleStat, int durationMs, int damageAbilityId,
                          boolean once, Set<AbilityContracts.EffectType> effectTypes) {
        public Derived {
            effectTypes = immutableEffects(effectTypes);
        }

        public Behavior behavior() {
            return new Behavior(kind, null, null, null, effectTypes, Set.of(), Set.of(),
                    null, null, null, null, null, null, null, false, false);
        }
    }

    public record Behavior(BehaviorKind kind, Movement movement, Trigger trigger, Hit hit,
                           Set<AbilityContracts.EffectType> effectTypes,
                           Set<AbilityContracts.EffectType> preActiveEffectTypes,
                           Set<AbilityContracts.EffectType> activeEffectTypes,
                           String rangeStat, String lifetimeStat, String fuseStat,
                           String radiusStat, String intervalStat, String presenceField, Attack attack,
                           Derived explosion, boolean applyEveryTick, boolean skipOwner,
                           List<Phase> phases) {
        public Behavior {
            effectTypes = immutableEffects(effectTypes);
            preActiveEffectTypes = immutableEffects(preActiveEffectTypes);
            activeEffectTypes = immutableEffects(activeEffectTypes);
            phases = phases == null ? List.of() : List.copyOf(phases);
        }

        public Behavior(BehaviorKind kind, Movement movement, Trigger trigger, Hit hit,
                        Set<AbilityContracts.EffectType> effectTypes,
                        Set<AbilityContracts.EffectType> preActiveEffectTypes,
                        Set<AbilityContracts.EffectType> activeEffectTypes,
                        String rangeStat, String lifetimeStat, String fuseStat,
                        String radiusStat, String presenceField, Attack attack,
                        Derived explosion, boolean applyEveryTick, boolean skipOwner) {
            this(kind, movement, trigger, hit, effectTypes, preActiveEffectTypes, activeEffectTypes,
                    rangeStat, lifetimeStat, fuseStat, radiusStat, null, presenceField,
                    attack, explosion, applyEveryTick, skipOwner, List.of());
        }
    }

    public record Projectile(HitMode hit, Derived explosion) {}

    public record EntityContract(
            int abilityId,
            String entityType,
            String runtimeType,
            FactoryType factory,
            SystemType system,
            Category category,
            Spawn spawn,
            SelectableOwner selectableOwner,
            Motion motion,
            Lifetime lifetime,
            Collider collider,
            Health health,
            InitialState initialState,
            Behavior behavior,
            Projectile projectile,
            Map<String, Derived> derived) {

        public EntityContract {
            derived = Collections.unmodifiableMap(new LinkedHashMap<>(derived == null ? Map.of() : derived));
        }

        public Behavior behaviorFor(String type) {
            if (type != null) {
                for (Derived value : derived.values()) {
                    if (type.equals(value.type())) return value.behavior();
                }
            }
            return behavior;
        }
    }

    private static final Spawn SELF = new Spawn(SpawnMode.SELF, RotationMode.OWNER, 0, null, 500, 400);
    private static final Spawn FORWARD = new Spawn(SpawnMode.FORWARD, RotationMode.OWNER, 2, null, 500, 400);
    private static final Spawn FORWARD_ZERO = new Spawn(SpawnMode.FORWARD, RotationMode.ZERO, 2, null, 500, 400);
    private static final Spawn TARGET = new Spawn(SpawnMode.TARGET, RotationMode.ZERO, 0, null, 500, 400);
    private static final Spawn NULL_ZONE_TARGET = new Spawn(SpawnMode.TARGET, RotationMode.ZERO, 0, "radius", 500, 400);

    private static final Map<Integer, EntityContract> BY_ABILITY = catalog();
    private static final Map<String, EntityContract> BY_TYPE = byType();

    private EntityContracts() {}

    public static Map<Integer, EntityContract> all() { return BY_ABILITY; }

    public static EntityContract forAbility(int abilityId) {
        return BY_ABILITY.get(abilityId);
    }

    public static EntityContract entityContractForAbility(int abilityId) {
        return forAbility(abilityId);
    }

    public static EntityContract forEntity(ArenaEntity entity) {
        if (entity == null) return null;
        EntityContract byAbility = entity.abilityId() == null ? null : forAbility(entity.abilityId());
        if (byAbility != null) return byAbility;
        return BY_TYPE.get(entity.type());
    }

    public static EntityContract entityContract(ArenaEntity entity) {
        return forEntity(entity);
    }

    public static EntityContract forType(String type) {
        return BY_TYPE.get(type);
    }

    public static boolean manages(ArenaEntity entity, SystemType system) {
        return systemFor(entity) == system;
    }

    public static SystemType systemFor(ArenaEntity entity) {
        EntityContract contract = forEntity(entity);
        if (contract == null) return null;
        if (entity.type() != null) {
            for (Derived derived : contract.derived().values()) {
                if (entity.type().equals(derived.type())) return derived.system();
            }
        }
        return contract.system();
    }

    public static SystemType entitySystemType(ArenaEntity entity) {
        return systemFor(entity);
    }

    public static boolean isProjectileEntity(ArenaEntity entity) {
        return systemFor(entity) == SystemType.PROJECTILE;
    }

    public static double stat(int abilityId, String name, double fallback) {
        if (name == null) return fallback;
        if ("range".equals(name)) return Abilities.range(abilityId);
        if ("unit".equals(name)) return 1;
        if ("durationMs".equals(name)) return Abilities.durationMs(abilityId);
        double value = Abilities.stat(abilityId, name, Double.NaN);
        return Double.isFinite(value) ? value : fallback;
    }

    private static Map<Integer, EntityContract> catalog() {
        Map<Integer, EntityContract> contracts = new LinkedHashMap<>();

        contracts.put(4, contract(4, "grenade", "grenade", FactoryType.ENTITY,
                SystemType.PROJECTILE, Category.PROJECTILE, FORWARD_ZERO,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.STOPPED, null, 0),
                new Collider("size", false), null, new InitialState(false, true), null,
                new Projectile(HitMode.NEAREST, derived("grenadeExplosion", "grenadeExplosion",
                        Category.ZONE, SystemType.ABILITY, BehaviorKind.RADIAL, "range", 2,
                        "explosionVisibleMs", 200, 4, true, Set.of(AbilityContracts.EffectType.DAMAGE))),
                Map.of("grenadeExplosion", derived("grenadeExplosion", "grenadeExplosion",
                        Category.ZONE, SystemType.ABILITY, BehaviorKind.RADIAL, "range", 2,
                        "explosionVisibleMs", 200, 4, true, Set.of(AbilityContracts.EffectType.DAMAGE)))));

        contracts.put(5, contract(5, "fireball", "fireball", FactoryType.ENTITY,
                SystemType.PROJECTILE, Category.PROJECTILE, FORWARD,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", false), null, new InitialState(false, true), null,
                new Projectile(HitMode.NEAREST, null), Map.of()));

        contracts.put(11, contract(11, "proximity_mine", "proximityMine", FactoryType.THROWN_ZONE,
                SystemType.ABILITY, Category.TRAP, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), null, new InitialState(false, false),
                new Behavior(BehaviorKind.PHASE, null, null, null,
                        Set.of(), Set.of(), Set.of(), null, null, null, "triggerRadius", null, null, null,
                        null, false, true, List.of(
                                new Phase("travel", 0, new Movement("travel", null, 1), null,
                                        Set.of(), false, null),
                                new Phase("armed", 800, new Movement("stopped", null, 1),
                                        new Trigger("triggerRadius", null, true, true, true, true),
                                        Set.of(AbilityContracts.EffectType.DAMAGE), false,
                                        derived("mineExplosion", "mineExplosion", Category.ZONE, SystemType.ABILITY,
                                                BehaviorKind.VISUAL_ZONE, "triggerRadius", 2, "explosionVisibleMs", 0,
                                                11, false, Set.of()),
                                        Map.of("speed", 0.0)))),
                null, Map.of("mineExplosion", derived("mineExplosion", "mineExplosion", Category.ZONE,
                        SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "triggerRadius", 2,
                        "explosionVisibleMs", 0, 11, false, Set.of()))));

        contracts.put(14, contract(14, "gravity_zone", "gravityZone", FactoryType.THROWN_ZONE,
                SystemType.ABILITY, Category.ZONE, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("zoneSize", false), null, new InitialState(false, false),
                new Behavior(BehaviorKind.ZONE, null, null, null, Set.of(), Set.of(), Set.of(),
                        null, null, null, null, null, null, null, null, false, true, List.of(
                                new Phase("travel", 0, new Movement("travel", null, 1), null,
                                        Set.of(), false, null),
                                new Phase("fuse", 2_000, new Movement("stopped", null, 1), null,
                                        Set.of(AbilityContracts.EffectType.PULL), true, null),
                                new Phase("active", 5_000, new Movement("stopped", null, 1), null,
                                        Set.of(AbilityContracts.EffectType.DAMAGE), false,
                                        derived("gravityExplosion", "gravityExplosion", Category.ZONE, SystemType.ABILITY,
                                                BehaviorKind.VISUAL_ZONE, "zoneSize", 1, "explosionVisibleMs", 0,
                                                14, false, Set.of())))),
                null, Map.of("gravityExplosion", derived("gravityExplosion", "gravityExplosion", Category.ZONE,
                        SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "zoneSize", 1,
                        "explosionVisibleMs", 0, 14, false, Set.of()))));

        contracts.put(15, contract(15, "silence_wave", "silenceWave", FactoryType.ENTITY,
                SystemType.ABILITY, Category.PROJECTILE, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("projectileSize", false), null, new InitialState(true, false),
                new Behavior(BehaviorKind.SEGMENT,
                        new Movement("segment", null, 1), null,
                        new Hit(HitMode.ALL, false, true, true, "source",
                                Set.of(AbilityContracts.EffectType.DEBUFF, AbilityContracts.EffectType.INTERRUPT)),
                         Set.of(), Set.of(), Set.of(), null, "durationMs", null, null, null, null, null, false, true),
                null, Map.of()));

        contracts.put(17, contract(17, "hunter_drone", "hunterDrone", FactoryType.ENTITY,
                SystemType.ABILITY, Category.SUMMON, SELF,
                new Motion("unit", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), new Health("hp", "hp"), new InitialState(true, false),
                new Behavior(BehaviorKind.SUMMON,
                        new Movement("seek", null, 1), null, null, Set.of(), Set.of(), Set.of(),
                        null, null, null, null, null,
                        new Attack("range", "shotCooldownMs", "shotVisualMs",
                                Set.of(AbilityContracts.EffectType.DAMAGE)), null, false, true),
                null, Map.of()));

        contracts.put(18, contract(18, "windburst_projectile", "windburstProjectile", FactoryType.ENTITY,
                SystemType.ABILITY, Category.PROJECTILE, FORWARD,
                new Motion("speed", 0, .01), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("size", true), null, new InitialState(true, true),
                new Behavior(BehaviorKind.SEGMENT,
                        new Movement("segment", null, .01), null,
                        new Hit(HitMode.NEAREST, true, false, false, "velocity",
                                Set.of(AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.KNOCKBACK)),
                         Set.of(), Set.of(), Set.of(), "range", "durationMs", null, null, null, null, null, false, true),
                null, Map.of()));

        contracts.put(21, contract(21, "temporal_rewind_zone", "temporalRewindZone", FactoryType.ENTITY,
                SystemType.ABILITY, Category.ZONE, SELF,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("zoneSize", false), null, new InitialState(true, false),
                new Behavior(BehaviorKind.LIFETIME, null, null, null, Set.of(), Set.of(), Set.of(),
                        null, null, null, null, null, null, null, false, true),
                null, Map.of()));

        contracts.put(22, contract(22, "orbital_zone", "orbitalMarker", FactoryType.ENTITY,
                SystemType.ABILITY, Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("markerSize", false), null, new InitialState(true, false),
                new Behavior(BehaviorKind.INTERVAL, null, null, null,
                        Set.of(AbilityContracts.EffectType.DAMAGE), Set.of(), Set.of(),
                        null, null, null, "radius", "intervalMs", null, null,
                        derived("orbitalExplosion", "orbitalExplosion", Category.ZONE, SystemType.ABILITY,
                                BehaviorKind.VISUAL_ZONE, "markerSize", 1, "explosionVisibleMs", 0,
                                22, false, Set.of()), false, true, List.of()),
                null, Map.of("orbitalExplosion", derived("orbitalExplosion", "orbitalExplosion", Category.ZONE,
                        SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "markerSize", 1,
                        "explosionVisibleMs", 0, 22, false, Set.of()))));

        contracts.put(24, contract(24, "null_zone", "nullZone", FactoryType.ENTITY,
                SystemType.ABILITY, Category.ZONE, NULL_ZONE_TARGET,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("zoneSize", false), null, new InitialState(true, false),
                new Behavior(BehaviorKind.ZONE,
                        null, null, null, Set.of(), Set.of(),
                        Set.of(AbilityContracts.EffectType.DEBUFF), null, null, null, null,
                        "silence", null, null, false, true),
                null, Map.of()));

        contracts.put(27, contract(27, "singularity_zone", "singularityZone", FactoryType.ENTITY,
                SystemType.ABILITY, Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("zoneSize", false), null, new InitialState(true, false),
                new Behavior(BehaviorKind.ZONE,
                        null, null, null, Set.of(),
                        Set.of(AbilityContracts.EffectType.PULL), Set.of(AbilityContracts.EffectType.DAMAGE),
                        null, null, null, null, null, null,
                        null, derived("singularityExplosion", "singularityExplosion", Category.ZONE,
                                SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "zoneSize", 1,
                                "explosionVisibleMs", 0, 27, false, Set.of()), false, true, List.of(
                                        new Phase("fuse", 0, new Movement("stopped", null, 1), null,
                                                Set.of(AbilityContracts.EffectType.PULL), true, null),
                                        new Phase("active", 1_200, new Movement("stopped", null, 1), null,
                                                Set.of(AbilityContracts.EffectType.DAMAGE), false,
                                                derived("singularityExplosion", "singularityExplosion", Category.ZONE, SystemType.ABILITY,
                                                        BehaviorKind.VISUAL_ZONE, "zoneSize", 1,
                                                        "explosionVisibleMs", 0, 27, false, Set.of())))),
                null, Map.of("singularityExplosion", derived("singularityExplosion", "singularityExplosion",
                        Category.ZONE, SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "zoneSize", 1,
                        "explosionVisibleMs", 0, 27, false, Set.of()))));

        contracts.put(28, contract(28, "tether_bolt", "tetherBolt", FactoryType.ENTITY,
                SystemType.ABILITY, Category.PROJECTILE, FORWARD,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("size", false), null, new InitialState(true, true),
                new Behavior(BehaviorKind.SEGMENT,
                        new Movement("segment", null, 1), null,
                        new Hit(HitMode.NEAREST, true, true, true, "source",
                                Set.of(AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.PULL,
                                        AbilityContracts.EffectType.DEBUFF)),
                        Set.of(), Set.of(), Set.of(), "range", "durationMs", null, null, null, null,
                        null, false, true),
                null, Map.of()));

        contracts.put(29, contract(29, "static_snare", "staticSnare", FactoryType.THROWN_ZONE,
                SystemType.ABILITY, Category.TRAP, SELF,
                new Motion(null, 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), new Health("hp", "hp"), new InitialState(true, false),
                new Behavior(BehaviorKind.TRAP, null,
                        new Trigger("triggerRadius", "durationMs", true, true, true, false, true), null,
                        Set.of(AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.DEBUFF,
                                AbilityContracts.EffectType.INTERRUPT),
                        Set.of(), Set.of(), null, null, null, "triggerRadius", null, null, null,
                        derived("staticSnareBurst", "staticSnareBurst", Category.ZONE,
                                SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "triggerRadius", 2,
                                "explosionVisibleMs", 0, 0, false, Set.of()), false, true, List.of(
                                        new Phase("armed", 0, new Movement("stopped", null, 1),
                                                new Trigger("triggerRadius", "durationMs", true, true, true, false, true),
                                                Set.of(AbilityContracts.EffectType.DAMAGE,
                                                        AbilityContracts.EffectType.DEBUFF,
                                                        AbilityContracts.EffectType.INTERRUPT), false,
                                                derived("staticSnareBurst", "staticSnareBurst", Category.ZONE,
                                                        SystemType.ABILITY, BehaviorKind.VISUAL_ZONE,
                                                        "triggerRadius", 2, "explosionVisibleMs", 0,
                                                        0, false, Set.of())),
                                        new Phase("destroyed", 0, new Movement("stopped", null, 1),
                                                new Trigger("triggerRadius", "durationMs", true, true, false, false, true),
                                                Set.of(AbilityContracts.EffectType.DAMAGE,
                                                        AbilityContracts.EffectType.DEBUFF,
                                                        AbilityContracts.EffectType.INTERRUPT), false,
                                                derived("staticSnareBurst", "staticSnareBurst", Category.ZONE,
                                                        SystemType.ABILITY, BehaviorKind.VISUAL_ZONE,
                                                        "triggerRadius", 2, "explosionVisibleMs", 0,
                                                        0, false, Set.of()),
                                                Map.of("triggerRadius", 120.0),
                                                Map.of(
                                                        AbilityContracts.EffectType.DAMAGE,
                                                        new EffectOverride(20.0, null),
                                                        AbilityContracts.EffectType.DEBUFF,
                                                        new EffectOverride(null, 3_000))))),
                null, Map.of("staticSnareBurst", derived("staticSnareBurst", "staticSnareBurst",
                        Category.ZONE, SystemType.ABILITY, BehaviorKind.VISUAL_ZONE, "triggerRadius", 2,
                        "explosionVisibleMs", 0, 0, false, Set.of()))));

        // Repeller Drone shares Hunter Drone's physical/replay entity shape;
        // ability 31 keeps its own attack contract for knockback shots.
        contracts.put(31, contract(31, "repeller_drone", "hunterDrone", FactoryType.ENTITY,
                SystemType.ABILITY, Category.SUMMON, SELF,
                new Motion("unit", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), new Health("hp", "hp"), new InitialState(true, false),
                new Behavior(BehaviorKind.SUMMON,
                        new Movement("seek", null, 1), null, null, Set.of(), Set.of(), Set.of(),
                        null, null, null, null, null,
                        new Attack("range", "shotCooldownMs", "shotVisualMs",
                                Set.of(AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.KNOCKBACK)),
                        null, false, true),
                null, Map.of()));

        return Collections.unmodifiableMap(contracts);
    }

    private static Map<String, EntityContract> byType() {
        Map<String, EntityContract> byType = new LinkedHashMap<>();
        for (EntityContract contract : BY_ABILITY.values()) {
            byType.put(contract.entityType(), contract);
            byType.put(contract.runtimeType(), contract);
            for (Derived derived : contract.derived().values()) byType.put(derived.type(), contract);
        }
        return Collections.unmodifiableMap(byType);
    }

    private static EntityContract contract(int abilityId, String entityType, String runtimeType,
                                           FactoryType factory, SystemType system, Category category,
                                           Spawn spawn, Motion motion, Lifetime lifetime, Collider collider,
                                           Health health, InitialState initialState, Behavior behavior,
                                           Projectile projectile, Map<String, Derived> derived) {
        return new EntityContract(abilityId, entityType, runtimeType, factory, system, category,
                spawn, SelectableOwner.OWNER, motion, lifetime, collider, health, initialState, behavior, projectile, derived);
    }

    private static EntityContract contract(int abilityId, String entityType, String runtimeType,
                                           FactoryType factory, SystemType system, Category category,
                                           Spawn spawn, SelectableOwner selectableOwner, Motion motion, Lifetime lifetime,
                                           Collider collider, Health health, InitialState initialState, Behavior behavior,
                                           Projectile projectile, Map<String, Derived> derived) {
        return new EntityContract(abilityId, entityType, runtimeType, factory, system, category,
                spawn, selectableOwner, motion, lifetime, collider, health, initialState, behavior, projectile, derived);
    }

    private static Derived derived(String type, String behaviorKey, Category category, SystemType system,
                                   BehaviorKind kind, String sizeStat, double sizeMultiplier,
                                   String visibleStat, int durationMs, int damageAbilityId,
                                   boolean once, Set<AbilityContracts.EffectType> effectTypes) {
        return new Derived(type, behaviorKey, category, system, kind, sizeStat, sizeMultiplier,
                visibleStat, durationMs, damageAbilityId, once, effectTypes);
    }

    private static Set<AbilityContracts.EffectType> immutableEffects(Set<AbilityContracts.EffectType> effects) {
        if (effects == null || effects.isEmpty()) return Set.of();
        return Collections.unmodifiableSet(EnumSet.copyOf(effects));
    }
}
