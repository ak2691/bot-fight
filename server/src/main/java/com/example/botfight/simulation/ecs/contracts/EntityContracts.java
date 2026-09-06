package com.example.botfight.simulation.ecs.contracts;

import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectOverride;

import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Declarative metadata for ability-created entities.
 *
 * The entity contract describes how an ability enters the ECS. Its phases are
 * the complete runtime definition after that point: every phase declares its
 * type, hitbox, effects, visuals, transitions, schedules, and event-local
 * target policies.
 */
public final class EntityContracts {
    public enum Category { PROJECTILE, TRAP, SUMMON, ZONE }
    public enum SpawnMode { SELF, FORWARD, TARGET }
    public enum RotationMode { OWNER, ZERO }
    public enum TimerMode { NONE, AGE, REMAINING, STOPPED, FUSE }
    public enum HitMode { ALL, NEAREST }
    public enum SelectableOwner { OWNER, NONE }
    public enum ColliderShape { CIRCLE, RECTANGLE }
    public enum PhaseType { SELF, MELEE, RAY, ARC, PROJECTILE, ZONE, SUMMON }
    public enum PhaseEventType { ACTIVATION, COLLISION, INTERVAL, LIFETIME_END, DESTROYED, ENTER, EXIT }
    public enum PhaseAction { APPLY_EFFECTS, TRANSITION, REMOVE, EMIT_VISUAL }
    public enum TargetPolicyMode { ONCE, EVERY_TICK, INTERVAL }

    public record Spawn(SpawnMode mode, RotationMode rotation, double padding,
                        String clampToRadius, double defaultX, double defaultY) {}

    public record Motion(String speed, double initialTraveled, double stepRatio) {}

    public record Lifetime(TimerMode timerMode, String duration, int add) {}

    public record Collider(String size, boolean hittable, ColliderShape shape,
                           double sizeMultiplier) {
        public Collider(String size, boolean hittable) {
            this(size, hittable, ColliderShape.CIRCLE, 1.0);
        }

        public Collider(String size, boolean hittable, ColliderShape shape) {
            this(size, hittable, shape, 1.0);
        }
    }

    /** Phase hitbox dimensions reference the ability stats by name. */
    public record Hitbox(ColliderShape shape, String radius, String range, String arc,
                          double radiusMultiplier, String width, String length) {
        public Hitbox(ColliderShape shape, String radius, String range, String arc) {
            this(shape, radius, range, arc, 1.0, null, null);
        }

        public Hitbox(ColliderShape shape, String radius, String range, String arc,
                      double radiusMultiplier) {
            this(shape, radius, range, arc, radiusMultiplier, null, null);
        }

        public Hitbox(ColliderShape shape, String radius, String range, String arc,
                      String width, String length) {
            this(shape, radius, range, arc, 1.0, width, length);
        }
    }

    public record Health(String hp, String maxHp) {}

    public record InitialState(boolean armed, boolean damageMultiplierFromOwner) {}

    public record Hit(HitMode mode, boolean removeOnHit, boolean oncePerTarget,
                      String knockbackDirection) {}

    public record Trigger(String radius, String lifetime, boolean attackHits,
                          boolean projectileOverlap, boolean botContact, boolean chain,
                          boolean requiresDestruction) {
        public Trigger(String radius, String lifetime, boolean attackHits,
                       boolean projectileOverlap, boolean botContact, boolean chain) {
            this(radius, lifetime, attackHits, projectileOverlap, botContact, chain, false);
        }
    }

    public record Visual(String type, String state, double visualSize, Integer visibleMs) {
        public Visual(String type, String state, double visualSize) {
            this(type, state, visualSize, null);
        }

        public Visual(String type, double visualSize) {
            this(type, null, visualSize, null);
        }

        public Visual(String type, double visualSize, Integer visibleMs) {
            this(type, null, visualSize, visibleMs);
        }
    }

    public record Transition(String to) {}

    public record TargetPolicy(TargetPolicyMode mode, String interval, Integer intervalMs) {
        public TargetPolicy(TargetPolicyMode mode) {
            this(mode, null, null);
        }
    }

    public record PhaseEvent(List<PhaseAction> actions, Transition transition,
                             Set<AbilityContracts.EffectType> effectTypes,
                             String visualType, String visibleStat,
                             Double visualSize, Integer visibleMs,
                             String intervalStat, TargetPolicy targetPolicy) {
        public PhaseEvent {
            actions = actions == null ? List.of() : List.copyOf(actions);
            effectTypes = immutableEffects(effectTypes);
        }

        public PhaseEvent(List<PhaseAction> actions) {
            this(actions, null, Set.of(), null, null, null, null, null, null);
        }

        public PhaseEvent(List<PhaseAction> actions, Transition transition) {
            this(actions, transition, Set.of(), null, null, null, null, null, null);
        }
    }

    public record Repeat(PhaseEventType event, String interval, Integer intervalMs,
                         boolean startImmediately) {
        public Repeat(PhaseEventType event, String interval) {
            this(event, interval, null, true);
        }
    }

    public record Movement(String mode, String duration, double stepRatio,
                           boolean continueDuringFuse, String speed) {
        public Movement(String mode, String duration, double stepRatio) {
            this(mode, duration, stepRatio, false, null);
        }

        public Movement(String mode, String duration, double stepRatio,
                        boolean continueDuringFuse) {
            this(mode, duration, stepRatio, continueDuringFuse, null);
        }
    }

    public record Attack(String range, String cooldown, String visual,
                         Set<AbilityContracts.EffectType> effectTypes) {
        public Attack {
            effectTypes = immutableEffects(effectTypes);
        }
    }

    public record Phase(String id, int startMs, Movement movement, Trigger trigger,
                        Set<AbilityContracts.EffectType> effectTypes,
                        Map<String, Double> statOverrides,
                        Map<String, EffectOverride> effectOverrides,
                        Hitbox hitbox, Visual visual, PhaseType type,
                        Map<PhaseEventType, PhaseEvent> events,
                        Integer durationMs,
                        Repeat repeat, boolean transitionOnly,
                        boolean skipOwner, Hit hit, Integer visibleMs,
                        Attack attack, List<AbilityContracts.Effect> effects) {
        public Phase {
            effectTypes = immutableEffects(effectTypes);
            effects = effects == null ? List.of() : List.copyOf(effects);
            statOverrides = statOverrides == null ? Map.of() : Map.copyOf(statOverrides);
            effectOverrides = effectOverrides == null ? Map.of() : Map.copyOf(effectOverrides);
            events = events == null ? Map.of() : Map.copyOf(events);
        }
    }

    public record EntityContract(
            int abilityId,
            String entityType,
            String runtimeType,
            Category category,
            Spawn spawn,
            SelectableOwner selectableOwner,
            Motion motion,
            Lifetime lifetime,
            Collider collider,
            Health health,
            InitialState initialState,
            List<Phase> phases) {
        public EntityContract {
            phases = phases == null ? List.of() : List.copyOf(phases);
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

    public static Map<Integer, EntityContract> all() {
        return BY_ABILITY;
    }

    public static EntityContract forAbility(int abilityId) {
        return BY_ABILITY.get(abilityId);
    }

    public static EntityContract entityContractForAbility(int abilityId) {
        return forAbility(abilityId);
    }

    public static EntityContract forEntity(ArenaEntity entity) {
        if (entity == null) return null;
        EntityContract byAbility = entity.abilityId() == null ? null : forAbility(entity.abilityId());
        return byAbility == null ? BY_TYPE.get(entity.type()) : byAbility;
    }

    public static EntityContract entityContract(ArenaEntity entity) {
        return forEntity(entity);
    }

    public static EntityContract forType(String type) {
        return BY_TYPE.get(type);
    }

    public static List<Phase> phasesFor(ArenaEntity entity) {
        EntityContract contract = forEntity(entity);
        return contract == null ? List.of() : contract.phases();
    }

    public static Phase phaseFor(ArenaEntity entity) {
        List<Phase> phases = phasesFor(entity);
        if (phases.isEmpty()) return null;
        if (entity != null && entity.phaseId() != null) {
            Phase locked = phaseById(entity, entity.phaseId());
            if (locked != null) return locked;
        }
        if (entity != null && entity.armed()) {
            Phase armed = phases.stream()
                    .filter(phase -> "armed".equals(phase.id()))
                    .findFirst().orElse(null);
            if (armed != null) return armed;
        }
        return phases.getFirst();
    }

    public static Phase phaseById(ArenaEntity entity, String phaseId) {
        if (phaseId == null) return null;
        return phasesFor(entity).stream()
                .filter(phase -> phaseId.equals(phase.id()))
                .findFirst().orElse(null);
    }

    public static PhaseType phaseTypeFor(ArenaEntity entity) {
        Phase phase = phaseFor(entity);
        return phase == null ? null : phase.type();
    }

    public static double stat(int abilityId, String name, double fallback) {
        if (name == null) return fallback;
        if ("range".equals(name)) return Abilities.range(abilityId);
        if ("unit".equals(name)) return 1;
        if ("durationMs".equals(name)) return Abilities.durationMs(abilityId);
        double value = Abilities.stat(abilityId, name, Double.NaN);
        return Double.isFinite(value) ? value : fallback;
    }

    private static Phase phase(String id, int startMs, PhaseType type,
                               Movement movement, Trigger trigger,
                               Set<AbilityContracts.EffectType> effects,
                               Hitbox hitbox, Visual visual,
                               Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs,
                               Repeat repeat, boolean transitionOnly,
                               boolean skipOwner, Hit hit,
                               Map<String, Double> statOverrides,
                               Map<String, EffectOverride> effectOverrides,
                               Attack attack) {
        return new Phase(id, startMs, movement, trigger, effects, statOverrides,
                effectOverrides, hitbox, visual, type, events,
                durationMs, repeat, transitionOnly, skipOwner, hit,
                visual == null ? null : visual.visibleMs(), attack, List.of());
    }

    private static Phase phase(String id, PhaseType type, Movement movement,
                               Hitbox hitbox, Set<AbilityContracts.EffectType> effects,
                               Visual visual, Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs) {
        return phase(id, 0, type, movement, null, effects, hitbox, visual, events,
                durationMs, null, false, false, null, Map.of(), Map.of(), null);
    }

    private static Phase phase(String id, PhaseType type, Movement movement,
                               Trigger trigger, Set<AbilityContracts.EffectType> effects,
                               Hitbox hitbox, Visual visual, Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs,
                               Repeat repeat, boolean transitionOnly, boolean skipOwner,
                               Hit hit, Map<String, Double> statOverrides,
                               Map<String, EffectOverride> effectOverrides,
                               Attack attack) {
        return phase(id, 0, type, movement, trigger, effects, hitbox, visual, events,
                durationMs, repeat, transitionOnly, skipOwner, hit,
                statOverrides, effectOverrides, attack);
    }

    private static Phase phase(String id, int startMs, PhaseType type, Movement movement,
                               Hitbox hitbox, Set<AbilityContracts.EffectType> effects,
                               Visual visual, Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs) {
        return phase(id, startMs, type, movement, null, effects, hitbox, visual, events,
                durationMs, null, false, false, null, Map.of(), Map.of(), null);
    }

    private static Phase phase(String id, int startMs, PhaseType type, Movement movement,
                               Hitbox hitbox, Set<AbilityContracts.EffectType> effects,
                               Visual visual, Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs,
                               Repeat repeat, boolean skipOwner, Trigger trigger,
                               Map<String, Double> statOverrides,
                               Map<String, EffectOverride> effectOverrides,
                               Hit hit, Attack attack) {
        return phase(id, startMs, type, movement, trigger, effects, hitbox, visual, events,
                durationMs, repeat, false, skipOwner, hit, statOverrides,
                effectOverrides, attack);
    }

    private static PhaseEvent event(PhaseAction... actions) {
        return new PhaseEvent(List.of(actions));
    }

    private static PhaseEvent event(List<PhaseAction> actions, String transition) {
        return new PhaseEvent(actions, new Transition(transition));
    }

    private static PhaseEvent event(List<PhaseAction> actions, String transition,
                                    TargetPolicy targetPolicy) {
        return new PhaseEvent(actions, new Transition(transition), Set.of(), null,
                null, null, null, null, targetPolicy);
    }

    private static PhaseEvent event(List<PhaseAction> actions,
                                    Set<AbilityContracts.EffectType> effects,
                                    String visualType, String visibleStat,
                                    Double visualSize, Integer visibleMs,
                                    String intervalStat) {
        return new PhaseEvent(actions, null, effects, visualType, visibleStat,
                visualSize, visibleMs, intervalStat, null);
    }

    private static PhaseEvent event(TargetPolicy targetPolicy, PhaseAction... actions) {
        return new PhaseEvent(List.of(actions), null, Set.of(), null, null,
                null, null, null, targetPolicy);
    }

    private static Hitbox rectangle(String width, String length) {
        return new Hitbox(ColliderShape.RECTANGLE, null, null, null, width, length);
    }

    private static Hitbox circle(String radius) {
        return new Hitbox(ColliderShape.CIRCLE, radius, null, null);
    }

    private static Hitbox circle(String radius, double multiplier) {
        return new Hitbox(ColliderShape.CIRCLE, radius, null, null, multiplier);
    }

    private static Hitbox ray(String range, String width) {
        return new Hitbox(ColliderShape.RECTANGLE, null, range, null, width, range);
    }

    private static Map<Integer, EntityContract> catalog() {
        Map<Integer, EntityContract> contracts = new LinkedHashMap<>();
        Set<AbilityContracts.EffectType> damage = Set.of(AbilityContracts.EffectType.DAMAGE);
        Set<AbilityContracts.EffectType> damageStatus = Set.of(
                AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.STATUS);
        Set<AbilityContracts.EffectType> damageKnockback = Set.of(
                AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.KNOCKBACK);
        Set<AbilityContracts.EffectType> damagePullStatus = Set.of(
                AbilityContracts.EffectType.DAMAGE, AbilityContracts.EffectType.PULL,
                AbilityContracts.EffectType.STATUS);

        contracts.put(4, contract(4, "grenade", "grenade", Category.PROJECTILE, FORWARD_ZERO,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.STOPPED, null, 0),
                new Collider("hitboxWidth", false, ColliderShape.RECTANGLE),
                null, new InitialState(false, true), List.of(
                phase("travel", 0, PhaseType.PROJECTILE,
                                new Movement("travel", null, 1, false, "speed"),
                                rectangle("hitboxWidth", "hitboxLength"), Set.of(),
                                new Visual("grenade", "moving", 12),
                                Map.of(PhaseEventType.COLLISION, event(List.of(PhaseAction.TRANSITION), "active"),
                                        PhaseEventType.LIFETIME_END, event(List.of(PhaseAction.TRANSITION), "armed")),
                                1_000),
                        // Armed is reached when the fixed one-second travel
                        // phase ends; it is not selected by spawn physics.
                        phase("armed", -1, PhaseType.PROJECTILE,
                                new Movement("stopped", null, 1), null,
                                Set.of(), rectangle("hitboxWidth", "hitboxLength"),
                                new Visual("grenade", "static", 12),
                                Map.of(PhaseEventType.COLLISION, event(List.of(PhaseAction.TRANSITION), "active"),
                                        PhaseEventType.LIFETIME_END, event(List.of(PhaseAction.TRANSITION), "active")),
                                1_000, null, true, false,
                                null, Map.of(), Map.of(), null),
                        // The explosion is reached by collision or armed-phase
                        // expiry; it is not an elapsed-time phase from spawn.
                        phase("active", -1, PhaseType.ZONE,
                                new Movement("stopped", null, 1), null, damage,
                                circle("radius"), new Visual("grenadeExplosion", 140, 200),
                                Map.of(PhaseEventType.COLLISION, event(new TargetPolicy(TargetPolicyMode.ONCE), PhaseAction.APPLY_EFFECTS)),
                                200, null, true, false,
                                null, Map.of(), Map.of(), null))));

        contracts.put(5, contract(5, "fireball", "fireball", Category.PROJECTILE, FORWARD,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("hitboxWidth", false, ColliderShape.RECTANGLE),
                null, new InitialState(false, true), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new Movement("travel", null, 1),
                                rectangle("hitboxWidth", "hitboxLength"), damageStatus,
                                new Visual("fireball", 30),
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS, PhaseAction.REMOVE)),
                                 null))));

        contracts.put(11, contract(11, "proximity_mine", "proximityMine", Category.TRAP, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), null, new InitialState(false, false), List.of(
                        phase("travel", PhaseType.PROJECTILE,
                                new Movement("travel", null, 1),
                                circle("size", .5), Set.of(), new Visual("proximityMine", "moving", 24),
                                Map.of(PhaseEventType.LIFETIME_END,
                                        event(List.of(PhaseAction.TRANSITION), "armed")), 800),
                        phase("armed", -1, PhaseType.ZONE,
                                new Movement("stopped", null, 1),
                                new Trigger("radius", null, true, true, true, true),
                                damage, circle("radius"), new Visual("proximityMine", "static", 24),
                                Map.of(PhaseEventType.COLLISION,
                                                event(List.of(PhaseAction.TRANSITION), "active"),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                20_000, null, true, false,
                                null, Map.of(), Map.of(), null),
                        phase("active", PhaseType.ZONE,
                                new Movement("stopped", null, 1), null,
                                damage, circle("radius"), new Visual("mineExplosion", 175, 300),
                                Map.of(PhaseEventType.COLLISION, event(new TargetPolicy(TargetPolicyMode.ONCE), PhaseAction.APPLY_EFFECTS)),
                                300, null, true, false, null, Map.of(), Map.of(), null))));

        contracts.put(14, contract(14, "gravity_zone", "gravityZone", Category.ZONE, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("radius", false, ColliderShape.CIRCLE, 2), null,
                new InitialState(false, false), List.of(
                        phase("travel", PhaseType.PROJECTILE,
                                new Movement("travel", null, 1), circle("radius"),
                                Set.of(AbilityContracts.EffectType.PULL),
                                new Visual("gravityZone", 240),
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "fuse")), 1_000),
                        phase("fuse", PhaseType.ZONE,
                                new Movement("stopped", null, 1), null,
                                Set.of(AbilityContracts.EffectType.PULL), circle("radius"), new Visual("gravityZone", 240),
                                Map.of(PhaseEventType.COLLISION, event(PhaseAction.APPLY_EFFECTS),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                3_000, null, true, false, null, Map.of(), Map.of(), null),
                        phase("active", PhaseType.ZONE,
                                new Movement("stopped", null, 1), null, damage, circle("radius"),
                                new Visual("gravityExplosion", 240, 300),
                                Map.of(PhaseEventType.COLLISION, event(new TargetPolicy(TargetPolicyMode.ONCE), PhaseAction.APPLY_EFFECTS)),
                                300, null, true, false, null, Map.of(), Map.of(), null))));

        contracts.put(15, contract(15, "silence_wave", "silenceWave", Category.PROJECTILE, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("size", false, ColliderShape.RECTANGLE), null,
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new Movement("segment", null, 1),
                                rectangle("hitboxWidth", "hitboxLength"),
                                Set.of(AbilityContracts.EffectType.STATUS,
                                        AbilityContracts.EffectType.INTERRUPT),
                                new Visual("silenceWave", 225),
                                Map.of(PhaseEventType.COLLISION, event(new TargetPolicy(TargetPolicyMode.ONCE), PhaseAction.APPLY_EFFECTS)),
                                null))));

        contracts.put(17, droneContract(17, "hunter_drone", "hunterDrone",
                Set.of(AbilityContracts.EffectType.DAMAGE)));
        contracts.put(31, droneContract(31, "repeller_drone", "hunterDrone",
                damageKnockback));

        contracts.put(18, contract(18, "windburst_projectile", "windburstProjectile",
                Category.PROJECTILE, FORWARD,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("size", true, ColliderShape.RECTANGLE), null,
                new InitialState(true, true), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new Movement("segment", null, 1),
                                rectangle("hitboxWidth", "hitboxLength"), damageKnockback,
                                new Visual("windburstProjectile", 24),
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS, PhaseAction.REMOVE)),
                                null))));

        contracts.put(21, contract(21, "temporal_rewind_zone", "temporalRewindZone",
                Category.ZONE, SELF,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("radius", false, ColliderShape.CIRCLE, 2), null,
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.ZONE, new Movement("stopped", null, 1),
                                circle("radius"), Set.of(), new Visual("temporalRewindZone", 90),
                                Map.of(), null))));

        contracts.put(22, contract(22, "orbital_zone", "orbitalMarker",
                Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("radius", false, ColliderShape.CIRCLE, 2), null,
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.ZONE, new Movement("stopped", null, 1),
                                null,
                                damage, circle("radius"), new Visual("orbitalMarker", 260),
                                Map.of(PhaseEventType.INTERVAL,
                                                event(List.of(PhaseAction.APPLY_EFFECTS, PhaseAction.EMIT_VISUAL),
                                                        damage, "orbitalExplosion", "visibleMs", 260.0, 400, "intervalMs")),
                                 null, new Repeat(PhaseEventType.INTERVAL, "intervalMs"),
                                 false, true, null, Map.of(), Map.of(), null))));

        contracts.put(24, contract(24, "null_zone", "nullZone", Category.ZONE, NULL_ZONE_TARGET,
                new Motion(null, 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("radius", false, ColliderShape.CIRCLE, 2), null,
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.ZONE, new Movement("stopped", null, 1),
                                null,
                                Set.of(AbilityContracts.EffectType.STATUS),
                                circle("radius"),
                                new Visual("nullZone", 300),
                                Map.of(PhaseEventType.COLLISION, event(PhaseAction.APPLY_EFFECTS)),
                                 null, null, false, true,
                                 null, Map.of(), Map.of(), null))));

        contracts.put(27, contract(27, "singularity_zone", "singularityZone",
                Category.ZONE, TARGET,
                SelectableOwner.OWNER, new Motion(null, 0, 1),
                new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("radius", false, ColliderShape.CIRCLE, 2), null,
                new InitialState(true, false), List.of(
                        phase("fuse", PhaseType.ZONE, new Movement("stopped", null, 1),
                                null,
                                Set.of(AbilityContracts.EffectType.PULL), circle("radius"),
                                new Visual("singularityZone", 280),
                                Map.of(PhaseEventType.COLLISION, event(PhaseAction.APPLY_EFFECTS),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                 1_200, null, false, true,
                                 null, Map.of(), Map.of(), null),
                        phase("active", -1, PhaseType.ZONE,
                                new Movement("stopped", null, 1), null, damage, circle("radius"),
                                new Visual("singularityExplosion", 280, 400),
                                Map.of(PhaseEventType.COLLISION, event(new TargetPolicy(TargetPolicyMode.ONCE), PhaseAction.APPLY_EFFECTS)),
                                 400, null, true, true,
                                 null, Map.of(), Map.of(), null))));

        contracts.put(28, contract(28, "tether_bolt", "tetherBolt", Category.PROJECTILE, FORWARD,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.REMAINING, "durationMs", 0),
                new Collider("hitboxWidth", false, ColliderShape.RECTANGLE), null,
                new InitialState(true, true), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new Movement("segment", null, 1),
                                rectangle("hitboxWidth", "hitboxLength"), damagePullStatus,
                                null,
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS, PhaseAction.REMOVE)),
                                null))));

        contracts.put(29, contract(29, "static_snare", "staticSnare", Category.TRAP, SELF,
                new Motion(null, 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), new Health("hp", "hp"),
                new InitialState(true, false), List.of(
                        phase("armed", PhaseType.ZONE,
                                new Movement("stopped", null, 1),
                                new Trigger("radius", "durationMs", true, true, true, false, true),
                                damageStatusInterrupt(), circle("radius"),
                                new Visual("staticSnare", 24),
                                Map.of(PhaseEventType.COLLISION,
                                        event(List.of(PhaseAction.APPLY_EFFECTS, PhaseAction.EMIT_VISUAL,
                                                        PhaseAction.TRANSITION),
                                                "triggered", new TargetPolicy(TargetPolicyMode.ONCE))),
                                null, null, false, true, null,
                                Map.of(), Map.of(), null),
                        phase("triggered", -1, PhaseType.ZONE,
                                new Movement("stopped", null, 1), null, Set.of(), circle("radius"),
                                new Visual("staticSnareBurst", 150, 300),
                                Map.of(),
                                300, null, false, true,
                                null, Map.of(), Map.of(), null),
                        phase("destroyed", -1, PhaseType.ZONE,
                                new Movement("stopped", null, 1),
                                new Trigger("radius", "durationMs", true, true, false, false, true),
                                damageStatusInterrupt(), circle("radius"),
                                new Visual("staticSnareBurst", 240, 300),
                                Map.of(PhaseEventType.COLLISION, event(new TargetPolicy(TargetPolicyMode.ONCE), PhaseAction.APPLY_EFFECTS)),
                                300, null, false, true,
                                null, Map.of("radius", 120.0),
                                Map.of("damage", new EffectOverride(20.0, null),
                                        "status:slow", new EffectOverride(null, 3_000)),
                                null))));

        return Collections.unmodifiableMap(contracts);
    }

    private static Set<AbilityContracts.EffectType> damageStatusInterrupt() {
        return Set.of(AbilityContracts.EffectType.DAMAGE,
                AbilityContracts.EffectType.STATUS,
                AbilityContracts.EffectType.INTERRUPT);
    }

    private static EntityContract droneContract(int abilityId, String entityType,
                                                String runtimeType,
                                                Set<AbilityContracts.EffectType> effects) {
        return contract(abilityId, entityType, runtimeType,
                Category.SUMMON, SELF,
                new Motion("speed", 0, 1), new Lifetime(TimerMode.AGE, "durationMs", 0),
                new Collider("size", true), new Health("hp", "hp"),
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.SUMMON,
                                new Movement("seek", null, 1, false, "speed"),
                                null,
                                effects, ray("range", "hitboxWidth"),
                                new Visual("hunterDrone", 28),
                                Map.of(PhaseEventType.COLLISION, event(PhaseAction.APPLY_EFFECTS)),
                                null, new Repeat(PhaseEventType.COLLISION, "shotCooldownMs"),
                                false, true, null, Map.of(), Map.of(),
                                new Attack("range", "shotCooldownMs", "shotVisualMs", effects))));
    }

    private static EntityContract contract(int abilityId, String entityType,
                                           String runtimeType,
                                           Category category,
                                           Spawn spawn, Motion motion, Lifetime lifetime,
                                           Collider collider, Health health,
                                           InitialState initialState, List<Phase> phases) {
        return new EntityContract(abilityId, entityType, runtimeType,
                category, spawn, SelectableOwner.OWNER, motion, lifetime, collider,
                health, initialState, hydratePhaseEffects(abilityId, phases));
    }

    private static EntityContract contract(int abilityId, String entityType,
                                           String runtimeType,
                                           Category category,
                                           Spawn spawn, SelectableOwner selectableOwner,
                                           Motion motion, Lifetime lifetime,
                                           Collider collider, Health health,
                                           InitialState initialState, List<Phase> phases) {
        return new EntityContract(abilityId, entityType, runtimeType,
                category, spawn, selectableOwner, motion, lifetime, collider, health,
                initialState, hydratePhaseEffects(abilityId, phases));
    }

    private static List<Phase> hydratePhaseEffects(int abilityId, List<Phase> phases) {
        List<AbilityContracts.Effect> abilityEffects = AbilityContracts.get(abilityId).effects();
        return phases.stream().map(phase -> new Phase(
                phase.id(), phase.startMs(), phase.movement(), phase.trigger(), phase.effectTypes(),
                phase.statOverrides(), phase.effectOverrides(), phase.hitbox(), phase.visual(), phase.type(),
                phase.events(), phase.durationMs(), phase.repeat(), phase.transitionOnly(), phase.skipOwner(),
                phase.hit(), phase.visibleMs(), phase.attack(), abilityEffects.stream()
                        .filter(effect -> effect.type() != AbilityContracts.EffectType.SPAWN_ENTITY)
                        .filter(effect -> phase.effectTypes().contains(effect.type()))
                        .toList())).toList();
    }

    private static Map<String, EntityContract> byType() {
        Map<String, EntityContract> byType = new LinkedHashMap<>();
        for (EntityContract contract : BY_ABILITY.values()) {
            byType.put(contract.entityType(), contract);
            byType.put(contract.runtimeType(), contract);
        }
        return Collections.unmodifiableMap(byType);
    }

    private static Set<AbilityContracts.EffectType> immutableEffects(
            Set<AbilityContracts.EffectType> effects) {
        if (effects == null || effects.isEmpty()) return Set.of();
        return Collections.unmodifiableSet(EnumSet.copyOf(effects));
    }
}
