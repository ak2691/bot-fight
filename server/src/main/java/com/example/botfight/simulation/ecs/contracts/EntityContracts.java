package com.example.botfight.simulation.ecs.contracts;

import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.AttachedAbilityContracts;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Declarative metadata for ability-created entities.
 *
 * Entity phases use the same {@link AttachedAbilityContracts.AbilityPhase} record as
 * direct abilities. Every phase owns its concrete effect payloads; the ECS
 * never has to hydrate an effect-type allowlist from the parent ability.
 */
public final class EntityContracts {
    public enum Category { PROJECTILE, TRAP, SUMMON, ZONE }
    public enum RotationMode { OWNER, ZERO }
    public enum TimerMode { NONE, AGE, REMAINING, STOPPED, FUSE }
    public enum SelectableOwner { OWNER, NONE }
    public enum ColliderShape { CIRCLE, RECTANGLE }

    /** Owner-relative spawn offset. Positive x is right of facing; positive y is forward. */
    public record Spawn(double offsetX, double offsetY, boolean targetPosition,
                        RotationMode rotation, double clampToRadius,
                        double defaultX, double defaultY) {}

    public record Lifetime(TimerMode timerMode, int duration, int add) {}

    public record Collider(double size, boolean hittable, ColliderShape shape,
                           double sizeMultiplier) {
        public Collider(double size, boolean hittable) {
            this(size, hittable, ColliderShape.CIRCLE, 1.0);
        }

        public Collider(double size, boolean hittable, ColliderShape shape) {
            this(size, hittable, shape, 1.0);
        }
    }

    public record Health(double hp, double maxHp) {}

    public record InitialState(boolean armed, boolean damageMultiplierFromOwner) {}

    public record EntityContract(
            int abilityId,
            String entityType,
            String runtimeType,
            Category category,
            Spawn spawn,
            SelectableOwner selectableOwner,
            Lifetime lifetime,
            Collider collider,
            Health health,
            InitialState initialState,
            List<AttachedAbilityContracts.AbilityPhase> phases) {
        public EntityContract {
            phases = phases == null ? List.of() : List.copyOf(phases);
        }
    }

    private static final Spawn SELF = new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn FORWARD = new Spawn(0, 47, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn FORWARD_ZERO = new Spawn(0, 38, false, RotationMode.ZERO, 0, 500, 400);
    private static final Spawn FORWARD_WIND = new Spawn(0, 44, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn FORWARD_TETHER = new Spawn(0, 41, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn TARGET = new Spawn(0, 0, true, RotationMode.ZERO, 0, 500, 400);
    private static final Spawn NULL_ZONE_TARGET = new Spawn(0, 0, true, RotationMode.ZERO, 150, 500, 400);

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

    public static List<AttachedAbilityContracts.AbilityPhase> phasesFor(ArenaEntity entity) {
        EntityContract contract = forEntity(entity);
        return contract == null ? List.of() : contract.phases();
    }

    public static AttachedAbilityContracts.AbilityPhase phaseFor(ArenaEntity entity) {
        List<AttachedAbilityContracts.AbilityPhase> phases = phasesFor(entity);
        if (phases.isEmpty()) return null;
        if (entity != null && entity.phaseId() != null) {
            AttachedAbilityContracts.AbilityPhase locked = phaseById(entity, entity.phaseId());
            if (locked != null) return locked;
        }
        if (entity != null && entity.armed()) {
            AttachedAbilityContracts.AbilityPhase armed = phases.stream()
                    .filter(phase -> "armed".equals(phase.id()))
                    .findFirst().orElse(null);
            if (armed != null) return armed;
        }
        return phases.getFirst();
    }

    public static AttachedAbilityContracts.AbilityPhase phaseById(ArenaEntity entity, String phaseId) {
        if (phaseId == null) return null;
        return phasesFor(entity).stream()
                .filter(phase -> phaseId.equals(phase.id()))
                .findFirst().orElse(null);
    }

    public static AttachedAbilityContracts.PhaseType phaseTypeFor(ArenaEntity entity) {
        AttachedAbilityContracts.AbilityPhase phase = phaseFor(entity);
        return phase == null ? null : phase.type();
    }

    private static List<AttachedAbilityContracts.Effect> effects(AttachedAbilityContracts.Effect... effects) {
        return List.of(effects);
    }

    private static AttachedAbilityContracts.AbilityPhase phase(
            String id, int startMs, AttachedAbilityContracts.PhaseType type,
            AttachedAbilityContracts.PhaseMovement movement, AttachedAbilityContracts.Hitbox hitbox,
            List<AttachedAbilityContracts.Effect> effects, AttachedAbilityContracts.Visual visual,
            Map<AttachedAbilityContracts.PhaseEventType, AttachedAbilityContracts.PhaseEvent> events,
            Integer durationMs) {
        return phase(id, startMs, type, movement, null, hitbox, effects, visual, events,
                durationMs, null, false, false, null, Map.of(), Map.of(), null);
    }

    private static AttachedAbilityContracts.AbilityPhase phase(
            String id, AttachedAbilityContracts.PhaseType type,
            AttachedAbilityContracts.PhaseMovement movement, AttachedAbilityContracts.Hitbox hitbox,
            List<AttachedAbilityContracts.Effect> effects, AttachedAbilityContracts.Visual visual,
            Map<AttachedAbilityContracts.PhaseEventType, AttachedAbilityContracts.PhaseEvent> events,
            Integer durationMs) {
        return phase(id, 0, type, movement, hitbox, effects, visual, events, durationMs);
    }

    private static AttachedAbilityContracts.AbilityPhase phase(
            String id, int startMs, AttachedAbilityContracts.PhaseType type,
            AttachedAbilityContracts.PhaseMovement movement, AttachedAbilityContracts.Trigger trigger,
            AttachedAbilityContracts.Hitbox hitbox, List<AttachedAbilityContracts.Effect> effects,
            AttachedAbilityContracts.Visual visual,
            Map<AttachedAbilityContracts.PhaseEventType, AttachedAbilityContracts.PhaseEvent> events,
            Integer durationMs, AttachedAbilityContracts.Repeat repeat, boolean transitionOnly,
            boolean skipOwner, AttachedAbilityContracts.Hit hit,
            Map<String, Double> statOverrides,
            Map<String, AttachedAbilityContracts.EffectOverride> effectOverrides,
            AttachedAbilityContracts.Attack attack) {
        return new AttachedAbilityContracts.AbilityPhase(id, type, movement, trigger,
                hitbox, effects, visual, events, durationMs, repeat, transitionOnly,
                skipOwner, hit, visual == null ? null : visual.visibleMs(), attack,
                statOverrides, effectOverrides, startMs);
    }

    private static AttachedAbilityContracts.AbilityPhase phase(
            String id, AttachedAbilityContracts.PhaseType type,
            AttachedAbilityContracts.PhaseMovement movement, AttachedAbilityContracts.Trigger trigger,
            AttachedAbilityContracts.Hitbox hitbox, List<AttachedAbilityContracts.Effect> effects,
            AttachedAbilityContracts.Visual visual,
            Map<AttachedAbilityContracts.PhaseEventType, AttachedAbilityContracts.PhaseEvent> events,
            Integer durationMs, AttachedAbilityContracts.Repeat repeat, boolean transitionOnly,
            boolean skipOwner, AttachedAbilityContracts.Hit hit,
            Map<String, Double> statOverrides,
            Map<String, AttachedAbilityContracts.EffectOverride> effectOverrides,
            AttachedAbilityContracts.Attack attack) {
        return phase(id, 0, type, movement, trigger, hitbox, effects, visual, events,
                durationMs, repeat, transitionOnly, skipOwner, hit, statOverrides,
                effectOverrides, attack);
    }

    private static AttachedAbilityContracts.AbilityPhase phase(
            String id, AttachedAbilityContracts.PhaseType type,
            AttachedAbilityContracts.PhaseMovement movement, AttachedAbilityContracts.Hitbox hitbox,
            List<AttachedAbilityContracts.Effect> effects, AttachedAbilityContracts.Visual visual,
            Map<AttachedAbilityContracts.PhaseEventType, AttachedAbilityContracts.PhaseEvent> events,
            Integer durationMs, AttachedAbilityContracts.Repeat repeat, boolean transitionOnly,
            boolean skipOwner, AttachedAbilityContracts.Hit hit,
            Map<String, Double> statOverrides,
            Map<String, AttachedAbilityContracts.EffectOverride> effectOverrides,
            AttachedAbilityContracts.Attack attack) {
        return phase(id, 0, type, movement, null, hitbox, effects, visual, events,
                durationMs, repeat, transitionOnly, skipOwner, hit, statOverrides,
                effectOverrides, attack);
    }

    private static AttachedAbilityContracts.PhaseEvent event(AttachedAbilityContracts.PhaseAction... actions) {
        return new AttachedAbilityContracts.PhaseEvent(List.of(actions));
    }

    private static AttachedAbilityContracts.PhaseEvent event(List<AttachedAbilityContracts.PhaseAction> actions,
                                                     String transition) {
        return new AttachedAbilityContracts.PhaseEvent(actions, Set.of(),
                new AttachedAbilityContracts.Transition(transition), null, null, null,
                null, null);
    }

    private static AttachedAbilityContracts.PhaseEvent event(List<AttachedAbilityContracts.PhaseAction> actions,
                                                     String transition,
                                                     AttachedAbilityContracts.TargetPolicy targetPolicy) {
        return new AttachedAbilityContracts.PhaseEvent(actions, Set.of(),
                new AttachedAbilityContracts.Transition(transition), null, null, null,
                null, targetPolicy);
    }

    private static AttachedAbilityContracts.PhaseEvent event(List<AttachedAbilityContracts.PhaseAction> actions,
                                                     Set<AttachedAbilityContracts.EffectType> effects,
                                                     String visualType, Integer visibleMs,
                                                     Double visualSize, Integer intervalMs) {
        return new AttachedAbilityContracts.PhaseEvent(actions, effects, null, intervalMs,
                visualType, visibleMs, visualSize, null);
    }

    private static AttachedAbilityContracts.PhaseEvent event(AttachedAbilityContracts.TargetPolicy targetPolicy,
                                                     AttachedAbilityContracts.PhaseAction... actions) {
        return new AttachedAbilityContracts.PhaseEvent(List.of(actions), Set.of(), null,
                null, null, null, null, targetPolicy);
    }

    private static AttachedAbilityContracts.Hitbox rectangle(double width, double length) {
        return new AttachedAbilityContracts.Hitbox("rectangle", null, null, null,
                1.0, width, length, false);
    }

    private static AttachedAbilityContracts.Hitbox circle(double radius) {
        return new AttachedAbilityContracts.Hitbox("circle", radius, null, null,
                1.0, null, null, false);
    }

    private static AttachedAbilityContracts.Hitbox circle(double radius, double multiplier) {
        return new AttachedAbilityContracts.Hitbox("circle", radius, null, null,
                multiplier, null, null, false);
    }

    private static AttachedAbilityContracts.Hitbox ray(double range, double width) {
        return new AttachedAbilityContracts.Hitbox("ray", null, range, null,
                1.0, width, range, false);
    }

    private static Map<Integer, EntityContract> catalog() {
        Map<Integer, EntityContract> contracts = new LinkedHashMap<>();

        contracts.put(4, contract(4, "grenade", "grenade", Category.PROJECTILE, FORWARD_ZERO,
                new Lifetime(TimerMode.STOPPED, 0, 0),
                new Collider(12, false, ColliderShape.RECTANGLE),
                null, new InitialState(false, true), List.of(
                        phase("travel", 0, AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(32),
                                rectangle(12, 12), effects(),
                                new AttachedAbilityContracts.Visual("grenade", "moving", 12),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active"),
                                        AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "armed")),
                                1_000),
                        // Armed is reached when the fixed one-second travel phase ends.
                        phase("armed", -1, AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                rectangle(12, 12), effects(),
                                new AttachedAbilityContracts.Visual("grenade", "static", 12),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active"),
                                        AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active")),
                                1_000, null, true, false, null, Map.of(), Map.of(), null),
                        // The explosion is reached by collision or armed-phase expiry.
                        phase("active", -1, AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                circle(70), effects(AttachedAbilityContracts.computedDamage(
                                        new AttachedAbilityContracts.Falloff(25.0, 40.0, null, null, 0.0, 64.0))),
                                new AttachedAbilityContracts.Visual("grenadeExplosion", 140, 200),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(new AttachedAbilityContracts.TargetPolicy(
                                                AttachedAbilityContracts.TargetPolicyMode.ONCE),
                                                AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                200, null, true, false, null, Map.of(), Map.of(), null))));

        contracts.put(5, contract(5, "fireball", "fireball", Category.PROJECTILE, FORWARD,
                new Lifetime(TimerMode.AGE, 1_200, 0),
                new Collider(30, false, ColliderShape.RECTANGLE),
                null, new InitialState(false, true), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(36),
                                rectangle(30, 30),
                                effects(
                                        AttachedAbilityContracts.damage(15),
                                         AttachedAbilityContracts.status("burn", 2, 5_000, 1_000, null)),
                                new AttachedAbilityContracts.Visual("fireball", 30),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS,
                                                AttachedAbilityContracts.PhaseAction.REMOVE)),
                                null))));

        contracts.put(11, contract(11, "proximity_mine", "proximityMine", Category.TRAP, SELF,
                new Lifetime(TimerMode.AGE, 20_800, 0),
                new Collider(24, true), null, new InitialState(false, false), List.of(
                        phase("travel", AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(22),
                                circle(12), effects(),
                                new AttachedAbilityContracts.Visual("proximityMine", "moving", 24),
                                Map.of(AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                        event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "armed")),
                                800),
                        phase("armed", -1, AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                new AttachedAbilityContracts.Trigger(87.5, null, true, true, true, true),
                                circle(87.5), effects(),
                                new AttachedAbilityContracts.Visual("proximityMine", "static", 24),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active"),
                                        AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active")),
                                20_000, null, true, false, null, Map.of(), Map.of(), null),
                        phase("active", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                circle(87.5), effects(AttachedAbilityContracts.damage(25)),
                                new AttachedAbilityContracts.Visual("mineExplosion", 175, 300),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(new AttachedAbilityContracts.TargetPolicy(
                                                AttachedAbilityContracts.TargetPolicyMode.ONCE),
                                                AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                300, null, true, false, null, Map.of(), Map.of(), null))));

        contracts.put(14, contract(14, "gravity_zone", "gravityZone", Category.ZONE, SELF,
                new Lifetime(TimerMode.REMAINING, 7_000, 0),
                new Collider(240, false, ColliderShape.CIRCLE), null,
                new InitialState(false, false), List.of(
                        phase("travel", AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(22),
                                circle(120), effects(AttachedAbilityContracts.pull(6)),
                                new AttachedAbilityContracts.Visual("gravityZone", 240),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                                event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS),
                                        AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "fuse")),
                                1_000),
                        phase("fuse", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                circle(120), effects(AttachedAbilityContracts.pull(6)),
                                new AttachedAbilityContracts.Visual("gravityZone", 240),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                                event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS),
                                        AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active")),
                                3_000, null, true, false, null, Map.of(), Map.of(), null),
                        phase("active", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                circle(120), effects(AttachedAbilityContracts.computedDamage(
                                        new AttachedAbilityContracts.Falloff(20.0, 35.0, null, null, 0.0, 90.0))),
                                new AttachedAbilityContracts.Visual("gravityExplosion", 240, 300),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(new AttachedAbilityContracts.TargetPolicy(
                                                AttachedAbilityContracts.TargetPolicyMode.ONCE),
                                                AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                300, null, true, false, null, Map.of(), Map.of(), null))));

        contracts.put(15, contract(15, "silence_wave", "silenceWave", Category.PROJECTILE, SELF,
                new Lifetime(TimerMode.REMAINING, 1_200, 0),
                new Collider(225, false, ColliderShape.RECTANGLE), null,
                new InitialState(true, false), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(150),
                                rectangle(150, 190),
                                effects(
                                        AttachedAbilityContracts.status("silence", 0, 2_000),
                                        AttachedAbilityContracts.interrupt(100)),
                                new AttachedAbilityContracts.Visual("silenceWave", 225),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(new AttachedAbilityContracts.TargetPolicy(
                                                AttachedAbilityContracts.TargetPolicyMode.ONCE),
                                                AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                null))));

        contracts.put(17, droneContract(17, "hunter_drone", "hunterDrone",
                effects(AttachedAbilityContracts.damage(5))));
        contracts.put(31, droneContract(31, "repeller_drone", "hunterDrone",
                effects(AttachedAbilityContracts.damage(3), AttachedAbilityContracts.knockback(40))));

        contracts.put(18, contract(18, "windburst_projectile", "windburstProjectile",
                Category.PROJECTILE, FORWARD_WIND,
                new Lifetime(TimerMode.REMAINING, 500, 0),
                new Collider(24, true, ColliderShape.RECTANGLE), null,
                new InitialState(true, true), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(44),
                                rectangle(80, 115),
                                effects(AttachedAbilityContracts.damage(20),
                                        AttachedAbilityContracts.knockback(200)),
                                new AttachedAbilityContracts.Visual("windburstProjectile", 24),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS,
                                                AttachedAbilityContracts.PhaseAction.REMOVE)),
                                null))));

        contracts.put(21, contract(21, "temporal_rewind_zone", "temporalRewindZone",
                Category.ZONE, SELF,
                new Lifetime(TimerMode.REMAINING, 3_100, 0),
                new Collider(90, false, ColliderShape.CIRCLE), null,
                new InitialState(true, false), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                circle(45), effects(AttachedAbilityContracts.timed(
                                        AttachedAbilityContracts.EffectType.RESTORE_STATE, 3000)),
                                new AttachedAbilityContracts.Visual("temporalRewindZone", 90),
                                Map.of(AttachedAbilityContracts.PhaseEventType.ACTIVATION,
                                        event(List.of(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS),
                                                Set.of(AttachedAbilityContracts.EffectType.RESTORE_STATE),
                                                null, null, null, null)),
                                null))));

        contracts.put(22, contract(22, "orbital_zone", "orbitalMarker",
                Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Lifetime(TimerMode.REMAINING, 1_500, 0),
                new Collider(260, false, ColliderShape.CIRCLE), null,
                new InitialState(true, false), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                circle(130), effects(AttachedAbilityContracts.damage(15)),
                                new AttachedAbilityContracts.Visual("orbitalMarker", 260),
                                Map.of(AttachedAbilityContracts.PhaseEventType.INTERVAL,
                                        event(List.of(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS,
                                                        AttachedAbilityContracts.PhaseAction.EMIT_VISUAL),
                                                Set.of(AttachedAbilityContracts.EffectType.DAMAGE),
                                                "orbitalExplosion", 400, 260.0,
                                                500)),
                                null, new AttachedAbilityContracts.Repeat(
                                        AttachedAbilityContracts.PhaseEventType.INTERVAL, null, 500, true),
                                false, true, null, Map.of(), Map.of(), null))));

        contracts.put(24, contract(24, "null_zone", "nullZone", Category.ZONE, NULL_ZONE_TARGET,
                new Lifetime(TimerMode.REMAINING, 5_000, 0),
                new Collider(300, false, ColliderShape.CIRCLE), null,
                new InitialState(true, false), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                circle(150), effects(AttachedAbilityContracts.status("silence", 0, 0)),
                                new AttachedAbilityContracts.Visual("nullZone", 300),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                null, null, false, true, null, Map.of(), Map.of(), null))));

        contracts.put(27, contract(27, "singularity_zone", "singularityZone",
                Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Lifetime(TimerMode.REMAINING, 1_300, 0),
                new Collider(280, false, ColliderShape.CIRCLE), null,
                new InitialState(true, false), List.of(
                        phase("fuse", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                circle(140), effects(AttachedAbilityContracts.pull(10)),
                                new AttachedAbilityContracts.Visual("singularityZone", 280),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                                event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS),
                                        AttachedAbilityContracts.PhaseEventType.LIFETIME_END,
                                                event(List.of(AttachedAbilityContracts.PhaseAction.TRANSITION), "active")),
                                1_200, null, false, true, null, Map.of(), Map.of(), null),
                        phase("active", -1, AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                circle(140), effects(AttachedAbilityContracts.computedDamage(
                                        new AttachedAbilityContracts.Falloff(15.0, 35.0, null, null, 0.0, 140.0))),
                                new AttachedAbilityContracts.Visual("singularityExplosion", 280, 400),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(new AttachedAbilityContracts.TargetPolicy(
                                                AttachedAbilityContracts.TargetPolicyMode.ONCE),
                                                AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                400, null, true, true, null, Map.of(), Map.of(), null))));

        contracts.put(28, contract(28, "tether_bolt", "tetherBolt", Category.PROJECTILE, FORWARD_TETHER,
                new Lifetime(TimerMode.REMAINING, 1_100, 0),
                new Collider(18, false, ColliderShape.RECTANGLE), null,
                new InitialState(true, true), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.PROJECTILE,
                                new AttachedAbilityContracts.PhaseMovement(42),
                                rectangle(18, 18),
                                effects(AttachedAbilityContracts.damage(10),
                                        AttachedAbilityContracts.pull(100),
                                        AttachedAbilityContracts.status("slow", 0, 1_200)),
                                null,
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS,
                                                AttachedAbilityContracts.PhaseAction.REMOVE)),
                                null))));

        contracts.put(29, contract(29, "static_snare", "staticSnare", Category.TRAP, SELF,
                new Lifetime(TimerMode.AGE, 16_000, 0),
                new Collider(24, true), new Health(20, 20),
                new InitialState(true, false), List.of(
                        phase("armed", AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                new AttachedAbilityContracts.Trigger(75.0, 16_000, true, true, true, false, true),
                                circle(75), effects(
                                        AttachedAbilityContracts.damage(15),
                                        AttachedAbilityContracts.status("slow", 0, 2_200),
                                        AttachedAbilityContracts.interrupt(150)),
                                new AttachedAbilityContracts.Visual("staticSnare", 24),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(List.of(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS,
                                                        AttachedAbilityContracts.PhaseAction.EMIT_VISUAL,
                                                        AttachedAbilityContracts.PhaseAction.TRANSITION),
                                                "triggered", new AttachedAbilityContracts.TargetPolicy(
                                                        AttachedAbilityContracts.TargetPolicyMode.ONCE))),
                                null, null, false, true, null, Map.of(), Map.of(), null),
                        phase("triggered", -1, AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0), null,
                                circle(75), effects(),
                                new AttachedAbilityContracts.Visual("staticSnareBurst", 150, 300),
                                Map.of(), 300, null, false, true, null, Map.of(), Map.of(), null),
                        phase("destroyed", -1, AttachedAbilityContracts.PhaseType.ZONE,
                                new AttachedAbilityContracts.PhaseMovement(0),
                                new AttachedAbilityContracts.Trigger(120.0, 16_000, true, true, false, false, true),
                                circle(120), effects(
                                        AttachedAbilityContracts.damage(20),
                                        AttachedAbilityContracts.status("slow", 0, 3_000),
                                        AttachedAbilityContracts.interrupt(150)),
                                new AttachedAbilityContracts.Visual("staticSnareBurst", 240, 300),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(new AttachedAbilityContracts.TargetPolicy(
                                                AttachedAbilityContracts.TargetPolicyMode.ONCE),
                                                AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                300, null, false, true, null,
                                 Map.of(), Map.of(),
                                null))));

        return Collections.unmodifiableMap(contracts);
    }

    private static EntityContract droneContract(int abilityId, String entityType,
                                                String runtimeType,
                                                List<AttachedAbilityContracts.Effect> effects) {
        return contract(abilityId, entityType, runtimeType,
                Category.SUMMON, SELF,
                new Lifetime(TimerMode.AGE, 6_000, 0),
                new Collider(28, true), new Health(50, 50),
                new InitialState(true, false), List.of(
                        phase("active", AttachedAbilityContracts.PhaseType.SUMMON,
                                new AttachedAbilityContracts.PhaseMovement(4.5, 8, 28),
                                ray(200, 5), effects,
                                new AttachedAbilityContracts.Visual("hunterDrone", 28),
                                Map.of(AttachedAbilityContracts.PhaseEventType.COLLISION,
                                        event(AttachedAbilityContracts.PhaseAction.APPLY_EFFECTS)),
                                null, new AttachedAbilityContracts.Repeat(
                                        AttachedAbilityContracts.PhaseEventType.COLLISION, null, 1_000, true),
                                false, true, null, Map.of(), Map.of(),
                                new AttachedAbilityContracts.Attack(200.0, "shotCooldownMs", 1_000,
                                        "shotVisualMs", 300, effectTypes(effects)))));
    }

    private static Set<AttachedAbilityContracts.EffectType> effectTypes(
            List<AttachedAbilityContracts.Effect> effects) {
        return effects.stream().map(AttachedAbilityContracts.Effect::type)
                .filter(type -> type != null)
                .collect(Collectors.toUnmodifiableSet());
    }

    private static EntityContract contract(int abilityId, String entityType,
                                           String runtimeType, Category category,
                                            Spawn spawn, Lifetime lifetime,
                                           Collider collider, Health health,
                                           InitialState initialState,
                                           List<AttachedAbilityContracts.AbilityPhase> phases) {
        return new EntityContract(abilityId, entityType, runtimeType, category, spawn,
                SelectableOwner.OWNER, lifetime, collider, health, initialState,
                phases);
    }

    private static EntityContract contract(int abilityId, String entityType,
                                           String runtimeType, Category category,
                                           Spawn spawn, SelectableOwner selectableOwner,
                                            Lifetime lifetime,
                                           Collider collider, Health health,
                                           InitialState initialState,
                                           List<AttachedAbilityContracts.AbilityPhase> phases) {
        return new EntityContract(abilityId, entityType, runtimeType, category, spawn,
                selectableOwner, lifetime, collider, health, initialState, phases);
    }

    private static Map<String, EntityContract> byType() {
        Map<String, EntityContract> byType = new LinkedHashMap<>();
        for (EntityContract contract : BY_ABILITY.values()) {
            byType.put(contract.entityType(), contract);
            byType.put(contract.runtimeType(), contract);
        }
        return Collections.unmodifiableMap(byType);
    }
}
