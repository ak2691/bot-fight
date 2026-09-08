package com.example.botfight.simulation.ecs.contracts;

import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.AbilityRegistry;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.stream.Collectors;

/** Gameplay-only ability metadata shared by authoritative combat resolvers. */
public final class AbilityContracts {
    private AbilityContracts() {}

    public enum EffectType { DAMAGE, HEALING, KNOCKBACK, PULL, STATUS, BUFF, INTERRUPT, TELEPORT,
        RESTORE_STATE, DAMAGE_REDUCTION, DAMAGE_IMMUNITY, DAMAGE_REFLECTION }
    /** Public phase vocabulary used by ability authoring and direct effects. */
    public enum PhaseType { SELF, MELEE, RAY, ARC, PROJECTILE, ZONE, SUMMON, BOT_ATTACHED }
    public enum PhaseEventType { ACTIVATION, COLLISION, TRIGGER, HIT, KILLED, INTERVAL, LIFETIME_END, ENTER, EXIT }
    public enum PhaseAction { APPLY_EFFECTS, TRANSITION, REMOVE, EMIT_VISUAL }
    public enum TargetPolicyMode { ONCE, EVERY_TICK, INTERVAL }
    /** Semantic target categories used by entity collision events. */
    public enum TargetKind { BOT, HP_ENTITY, ENTITY }

    public enum Category { BOT_ATTACHED, PROJECTILE, TRAP, SUMMON, ZONE }
    public enum RotationMode { OWNER, ZERO }
    public enum TimerMode { NONE, AGE, REMAINING, STOPPED, FUSE }
    public enum SelectableOwner { OWNER, NONE }

    /** Owner-relative spawn metadata. Movement belongs to phases, never spawn. */
    public record Spawn(double offsetX, double offsetY, boolean targetPosition,
                        RotationMode rotation, double clampToRadius,
                        double defaultX, double defaultY) {}

    public record Lifetime(TimerMode timerMode, int duration, int add) {}
    public record InitialState(boolean armed, boolean damageMultiplierFromOwner) {}

    public static final List<TargetKind> BOT_TARGET_KINDS = List.of(TargetKind.BOT);
    public static final List<TargetKind> DAMAGE_TARGET_KINDS = List.of(
            TargetKind.BOT, TargetKind.HP_ENTITY);

    /** Generic distance-based resolution for an effect amount or duration. */
    public record Falloff(Double minAmount, Double maxAmount,
                          Integer minDurationMs, Integer maxDurationMs,
                          Double falloffStart, Double falloffEnd) {
        public boolean hasAmountProfile() {
            return (minAmount != null || maxAmount != null)
                    && falloffStart != null && falloffEnd != null;
        }

        public boolean hasDurationProfile() {
            return (minDurationMs != null || maxDurationMs != null)
                    && falloffStart != null && falloffEnd != null;
        }

        public Falloff mergedWith(Falloff override) {
            if (override == null) return this;
            return new Falloff(
                    override.minAmount() == null ? minAmount : override.minAmount(),
                    override.maxAmount() == null ? maxAmount : override.maxAmount(),
                    override.minDurationMs() == null ? minDurationMs : override.minDurationMs(),
                    override.maxDurationMs() == null ? maxDurationMs : override.maxDurationMs(),
                    override.falloffStart() == null ? falloffStart : override.falloffStart(),
                    override.falloffEnd() == null ? falloffEnd : override.falloffEnd());
        }
    }

    /** Generic per-effect override used by phase-local resolution. */
    public record EffectOverride(Double amount, Integer durationMs, Falloff falloff) {
        public EffectOverride(Double amount, Integer durationMs) {
            this(amount, durationMs, null);
        }
    }

    public record Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                         String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage,
                         String distanceMode, Falloff falloff, Integer intervalMs,
                         Integer movementLockMs) {
        public Effect(EffectType type) { this(type, null, 0, 0, false, null, false, false, null, null, null, null); }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed) {
            this(type, subtype, amount, durationMs, runtimeComputed, null, false, false, null, null, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient, requiresConfirmedDamage, false, null, null, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient, requiresConfirmedDamage, mirrorsDamage, null, null, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage,
                      String distanceMode) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient,
                    requiresConfirmedDamage, mirrorsDamage, distanceMode, null, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage,
                      String distanceMode, Falloff falloff) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient,
                    requiresConfirmedDamage, mirrorsDamage, distanceMode, falloff, null, null);
        }
    }
    public record Activation(String targetMode, boolean captureAtActivation,
                             boolean faceTargetFromPayload, String phaseFacingDefault,
                             boolean ignoresGlobalAbilityLock,
                             boolean teleportOncePerActivation) {
        public Activation(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault,
                         boolean ignoresGlobalAbilityLock) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, ignoresGlobalAbilityLock, false);
        }
        public Activation(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, false, false);
        }
    }

    /** A phase event is an allowlisted instruction, never executable user code. */
    public record Transition(String to) {}
    public record TargetPolicy(TargetPolicyMode mode, String intervalStat, Integer intervalMs) {
        public TargetPolicy(TargetPolicyMode mode) {
            this(mode, null, null);
        }

        public String interval() { return intervalStat; }
    }

    /** Initial and maximum health for a phase that can receive incoming damage. */
    public record Health(double hp, double maxHp) {
        public Health(double maxHp) {
            this(maxHp, maxHp);
        }
    }

    /** Numeric phase geometry. The string accessors remain for replay/debug compatibility. */
    public record Hitbox(String shape, Double radius, Double range, Double arc,
                         double radiusMultiplier, Double width, Double length,
                         boolean includeTargetRadius) {
        public Hitbox(String shape, String radius, String range, String arc) {
            this(shape, number(radius), number(range), number(arc), 1.0, null, null, false);
        }

        public Hitbox(String shape, String radius, String range, String arc,
                      boolean includeTargetRadius) {
            this(shape, number(radius), number(range), number(arc), 1.0, null, null, includeTargetRadius);
        }

        public Hitbox(String shape, String radius, String range, String arc,
                      double radiusMultiplier) {
            this(shape, number(radius), number(range), number(arc), radiusMultiplier, null, null, false);
        }

        public Hitbox(String shape, String radius, String range, String arc,
                      String width, String length) {
            this(shape, number(radius), number(range), number(arc), 1.0,
                    number(width), number(length), false);
        }

        public String get(String key) {
            if (key == null) return null;
            return switch (key) {
                case "shape" -> shape;
                case "radius" -> text(radius);
                case "range" -> text(range);
                case "arc" -> text(arc);
                case "width" -> text(width);
                case "length" -> text(length);
                default -> null;
            };
        }

        public String getOrDefault(String key, String fallback) {
            String value = get(key);
            return value == null ? fallback : value;
        }

        private static Double number(String value) {
            if (value == null) return null;
            try {
                return Double.valueOf(value);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }

        private static String text(Double value) {
            return value == null ? null : Double.toString(value);
        }
    }

    /** Numeric movement owned by the currently active phase. */
    public record PhaseMovement(double speed, double turnDegrees, double size,
                                Double distance, Integer trailMs, String blockedByStatus) {
        public PhaseMovement(double speed) {
            this(speed, 0, 0, null, null, null);
        }
        public PhaseMovement(double speed, double turnDegrees, double size) {
            this(speed, turnDegrees, size, null, null, null);
        }
        public PhaseMovement(double speed, double distance, int trailMs,
                             String blockedByStatus) {
            this(speed, 0, 0, distance, trailMs, blockedByStatus);
        }
    }

    public record Trigger(Double radius, Integer lifetimeMs, boolean attackHits,
                          boolean projectileOverlap, boolean botContact,
                          boolean chain) {
        public Trigger(Double radius, Integer lifetimeMs, boolean botContact) {
            this(radius, lifetimeMs, false, false, botContact, false);
        }
    }

    public record Execution(PhaseEventType event, String interval, Integer intervalMs,
                         boolean startImmediately, String abilityId) {
        public Execution(PhaseEventType event, String interval, Integer intervalMs,
                      boolean startImmediately) {
            this(event, interval, intervalMs, startImmediately, null);
        }

        public Execution(PhaseEventType event, String interval) {
            this(event, interval, null, true, null);
        }
    }

    public record Hit(HitMode mode, boolean removeOnHit, boolean oncePerTarget,
                      String knockbackDirection) {}

    public enum HitMode { ALL, NEAREST }

    /** A small contract-defined ability owned by an entity such as a drone. */
    public record EntityAbility(String id, Spawn spawn, List<AbilityPhase> phases) {
        public EntityAbility {
            spawn = spawn == null
                    ? new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400)
                    : spawn;
            phases = phases == null ? List.of() : List.copyOf(phases);
        }

        public EntityAbility(String id, List<AbilityPhase> phases) {
            this(id, null, phases);
        }
    }

    public record PhaseEvent(List<PhaseAction> actions, Set<EffectType> effectTypes,
                             Transition transition, Integer intervalMs,
                             String visualType,
                             Integer visibleMs, Double visualSize,
                             TargetPolicy targetPolicy, List<TargetKind> targetKinds,
                             Set<String> statusTypes) {
        public PhaseEvent {
            actions = actions == null ? List.of() : List.copyOf(actions);
            effectTypes = effectTypes == null || effectTypes.isEmpty()
                    ? Set.of() : Collections.unmodifiableSet(EnumSet.copyOf(effectTypes));
            targetKinds = targetKinds == null ? List.of() : List.copyOf(targetKinds);
            statusTypes = statusTypes == null || statusTypes.isEmpty()
                    ? Set.of() : statusTypes.stream()
                            .filter(Objects::nonNull)
                            .map(type -> type.toLowerCase(java.util.Locale.ROOT))
                            .collect(Collectors.toUnmodifiableSet());
        }

        public PhaseEvent(List<PhaseAction> actions, Set<EffectType> effectTypes,
                          Transition transition, Integer intervalMs,
                          String visualType, Integer visibleMs, Double visualSize,
                          TargetPolicy targetPolicy, List<TargetKind> targetKinds) {
            this(actions, effectTypes, transition, intervalMs, visualType, visibleMs,
                    visualSize, targetPolicy, targetKinds, Set.of());
        }

        /** Compatibility constructor for events that retain the default bot scope. */
        public PhaseEvent(List<PhaseAction> actions, Set<EffectType> effectTypes,
                          Transition transition, Integer intervalMs,
                          String visualType, Integer visibleMs, Double visualSize,
                          TargetPolicy targetPolicy) {
            this(actions, effectTypes, transition, intervalMs, visualType,
                    visibleMs, visualSize, targetPolicy, List.of(), Set.of());
        }

        public PhaseEvent(List<PhaseAction> actions) {
            this(actions, Set.of(), null, null, null, null, null, null, List.of(), Set.of());
        }

        public PhaseEvent(List<PhaseAction> actions, Transition transition) {
            this(actions, Set.of(), transition, null, null, null, null, null, List.of(), Set.of());
        }
    }

    /** Presentation metadata owned by the phase that is currently active. */
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

    /** Canonical phase metadata exposed by attached and entity contracts. */
    public record AbilityPhase(String id, PhaseType type, PhaseMovement movement,
                               Trigger trigger, Hitbox hitbox, Health health, List<Effect> effects,
                               Visual visual, Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs, Execution execution, boolean transitionOnly,
                               boolean skipOwner, Hit hit, Integer visibleMs,
                               Map<String, Double> statOverrides,
                               Map<String, EffectOverride> effectOverrides, int startMs) {
        public AbilityPhase {
            effects = effects == null ? List.of() : List.copyOf(effects);
            events = events == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(events));
            statOverrides = statOverrides == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(statOverrides));
            effectOverrides = effectOverrides == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(effectOverrides));
        }

        public AbilityPhase(String id, PhaseType type, Hitbox hitbox,
                            List<Effect> effects, Map<PhaseEventType, PhaseEvent> events,
                            Integer durationMs, Visual visual) {
            this(id, type, null, null, hitbox, null, effects, visual, events, durationMs,
                    null, false, false, null, visual == null ? null : visual.visibleMs(),
                    Map.of(), Map.of(), 0);
        }

        public AbilityPhase(String id, PhaseType type, PhaseMovement movement,
                            Hitbox hitbox, List<Effect> effects,
                            Map<PhaseEventType, PhaseEvent> events, Integer durationMs) {
            this(id, type, movement, hitbox, effects, events, durationMs, null);
        }

        public AbilityPhase(String id, PhaseType type, PhaseMovement movement,
                            Hitbox hitbox, List<Effect> effects,
                            Map<PhaseEventType, PhaseEvent> events, Integer durationMs,
                            Visual visual) {
            this(id, type, movement, null, hitbox, null, effects, visual, events, durationMs,
                    null, false, false, null, null, Map.of(), Map.of(), 0);
        }

        public AbilityPhase(String id, PhaseType type, Hitbox hitbox,
                            List<Effect> effects, Map<PhaseEventType, PhaseEvent> events,
                            Integer durationMs) {
            this(id, type, hitbox, effects, events, durationMs, null);
        }

        public AbilityPhase(String id, PhaseType type, PhaseMovement movement,
                            Hitbox hitbox, List<Effect> effects, Visual visual,
                            Map<PhaseEventType, PhaseEvent> events) {
            this(id, type, movement, null, hitbox, null, effects, visual, events,
                    null, null, false, false, null,
                    visual == null ? null : visual.visibleMs(),
                    Map.of(), Map.of(), 0);
        }

        public AbilityPhase withHealth(Health nextHealth) {
            return new AbilityPhase(id, type, movement, trigger, hitbox, nextHealth, effects,
                    visual, events, durationMs, execution, transitionOnly, skipOwner, hit,
                    visibleMs, statOverrides, effectOverrides, startMs);
        }

        /** The effect types are derived from the concrete payloads for compatibility. */
        public Set<EffectType> effectTypes() {
            if (effects.isEmpty()) return Set.of();
            EnumSet<EffectType> types = EnumSet.noneOf(EffectType.class);
            effects.stream().map(Effect::type).filter(type -> type != null).forEach(types::add);
            return Collections.unmodifiableSet(types);
        }
    }

    /**
     * The one normalized contract shape. Direct bot abilities use
     * BOT_ATTACHED; spawned abilities additionally fill entity lifecycle fields.
     */
    public record AbilityContract(
            int abilityId,
            String entityType,
            String runtimeType,
            Category category,
            Spawn spawn,
            SelectableOwner selectableOwner,
            Lifetime lifetime,
            InitialState initialState,
            Activation activation,
            List<AbilityPhase> phases,
            List<EntityAbility> abilities) {
        public AbilityContract {
            category = category == null ? Category.BOT_ATTACHED : category;
            spawn = spawn == null
                    ? new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400)
                    : spawn;
            selectableOwner = selectableOwner == null ? SelectableOwner.OWNER : selectableOwner;
            lifetime = lifetime == null ? new Lifetime(TimerMode.NONE, 0, 0) : lifetime;
            initialState = initialState == null ? new InitialState(false, false) : initialState;
            activation = activation == null
                    ? new Activation(null, false, false, null, false, false)
                    : activation;
            phases = phases == null ? List.of() : List.copyOf(phases);
            abilities = abilities == null ? List.of() : List.copyOf(abilities);
        }
    }

    private static final Map<Integer, AbilityContract> ATTACHED_BY_ABILITY = attachedCatalog();

    private static Map<Integer, AbilityContract> attachedCatalog() {
        Map<Integer, AbilityContract> contracts = new LinkedHashMap<>();

        contracts.put(1, attachedAbility(1, 
                phase("active", PhaseType.BOT_ATTACHED,
                        arc(92, 120, true),
                        effects(damage(20)),
                        visual("meleeSlash", 207, 400),
                        PhaseEventType.COLLISION)));

        contracts.put(3, attachedAbility(3, 
                new Activation(null, true, false, null, false, false),
                phase("active", PhaseType.BOT_ATTACHED,
                        ray(700, 5),
                        effects(computedDamage(new Falloff(5.0, 15.0, null, null, 100.0, 700.0))),
                        visual("gun", 16, 500),
                        PhaseEventType.COLLISION)));

        contracts.put(6, attachedAbility(6, 
                phase("active", PhaseType.BOT_ATTACHED,
                        rectangle(80, 184, true),
                        effects(damage(10), status("stun", 0, 1200)),
                        visual("stun", 60, 100),
                        PhaseEventType.COLLISION)));

        contracts.put(7, attachedAbility(7, 
                phase("active", PhaseType.BOT_ATTACHED,
                        arc(115, 150, true),
                        effects(damage(30), status("bleed", 2, 5000, 1000, null)),
                        visual("heavySlash", 220.8, 400),
                        PhaseEventType.COLLISION)));

        contracts.put(8, attachedAbility(8, 
                phase("active", PhaseType.BOT_ATTACHED,
                        circle(110, true),
                        effects(damage(20), knockback(250)),
                        visual("repulsorBurst", 220, 500),
                        PhaseEventType.COLLISION)));

        contracts.put(9, attachedAbility(9, 
                phase("active", PhaseType.BOT_ATTACHED,
                        ray(500, 5),
                        effects(damage(20), status("slow", 0, 1000)),
                        visual("concussiveShot", 76, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(10, attachedAbility(10, 
                phase("active", PhaseType.BOT_ATTACHED,
                        null,
                        effects(effect(EffectType.HEALING, 25)),
                        visual("basicHeal", 12, 300),
                        PhaseEventType.ACTIVATION)));

        contracts.put(12, attachedAbility(12, 
                phase("active", PhaseType.BOT_ATTACHED,
                        ray(500, 5),
                        effects(computedDamage(new Falloff(4.0, 8.0, null, null, 0.0, 333.33))),
                        visual("pistol", 14, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(13, attachedAbility(13, 
                phase("active", PhaseType.BOT_ATTACHED,
                        ray(900, 5),
                        effects(effect(EffectType.DAMAGE, 40), status("shock", 3, 3000, 1000, 300)),
                        visual("railShot", 100, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(16, attachedAbility(16, 
                phase("active", PhaseType.BOT_ATTACHED,
                        null,
                        effects(timed(EffectType.DAMAGE_REDUCTION, .5, 4000),
                                timed(EffectType.DAMAGE_REFLECTION, .5, 4000)),
                        visual("reactiveArmor", 80, 300),
                        PhaseEventType.ACTIVATION)));

        contracts.put(19, attachedAbility(19, 
                phase("active", PhaseType.BOT_ATTACHED,
                        new PhaseMovement(75, 150.0, 300, "slow"),
                        null,
                        effects(),
                        visual("dash", 114, 300),
                        PhaseEventType.ACTIVATION)));

        contracts.put(20, attachedAbility(20, 
                new Activation("target", false, true, null, false, false),
                phase("active", PhaseType.BOT_ATTACHED,
                        null,
                        effects(),
                        visual("lockOn", 48, 200),
                        null)));

        contracts.put(23, attachedAbility(23, 
                phase("active", PhaseType.BOT_ATTACHED,
                        null,
                        effects(timed(EffectType.DAMAGE_IMMUNITY, 1, 1500)),
                        visual("absoluteGuard", 80, 300),
                        PhaseEventType.ACTIVATION)));

        contracts.put(25, attachedAbility(25, 
                new Activation(null, true, false, "0", false, true),
                phase("active", PhaseType.BOT_ATTACHED,
                        rectangle(60, 100, true),
                        effects(teleportByCenterDistance(), damage(15)),
                        visual("phaseStrike", 100, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(26, attachedAbility(26, 
                phase("active", PhaseType.BOT_ATTACHED,
                        circle(120, true),
                        effects(damage(15), status("slow", 0, 1_500), knockback(60)),
                        visual("frostRing", 240, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(30, attachedAbility(30, 
                phase("active", PhaseType.BOT_ATTACHED,
                        ray(600, 8),
                        effects(damage(15), timed(EffectType.INTERRUPT, 250), status("slow", 0, 2_000)),
                        visual("disruptorDart", 8, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(32, attachedAbility(32, 
                phase("active", PhaseType.BOT_ATTACHED,
                        ray(500, 10),
                        effects(computedDamage(new Falloff(15.0, 25.0, null, null, 0.0, 500.0)),
                                lifesteal("source")),
                        visual("vampiricBeam", 10, 300),
                        PhaseEventType.COLLISION)));

        contracts.put(33, attachedAbility(33, 
                phase("active", PhaseType.BOT_ATTACHED,
                        null,
                        effects(buff("overclock", .5, 4_000)),
                        visual("overclock", 80, 300),
                        PhaseEventType.ACTIVATION)));

        contracts.put(34, attachedAbility(34, 
                phase("active", PhaseType.BOT_ATTACHED,
                        arc(80, 30, true),
                        effects(damage(8)),
                        visual("basicStrike", 80, 200),
                        PhaseEventType.COLLISION)));

        return Collections.unmodifiableMap(contracts);
    }
    /** Action IDs come from the identity registry, not from one contract family. */
    private static final Set<Integer> ACTIONS = Set.copyOf(AbilityRegistry.all().keySet());

    private static AbilityContract attachedAbility(int abilityId, AbilityPhase... phases) {
        return attachedAbility(abilityId,
                new Activation(null, false, false, null, false, false), phases);
    }

    private static AbilityContract attachedAbility(int abilityId, Activation activation,
                                                    AbilityPhase... phases) {
        return new AbilityContract(abilityId, null, null, Category.BOT_ATTACHED,
                new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400),
                SelectableOwner.OWNER, new Lifetime(TimerMode.NONE, 0, 0),
                new InitialState(false, false), activation, List.of(phases), List.of());
    }

    private static AbilityPhase phase(String id, PhaseType type, Hitbox hitbox,
                                      List<Effect> effects, Visual visual,
                                      PhaseEventType eventType) {
        return phase(id, type, null, hitbox, effects, visual, eventType);
    }

    private static AbilityPhase phase(String id, PhaseType type, PhaseMovement movement,
                                      Hitbox hitbox, List<Effect> effects, Visual visual,
                                      PhaseEventType eventType) {
        Map<PhaseEventType, PhaseEvent> events = eventType == null
                ? Map.of() : Map.of(eventType, effectEvent(effects, eventType));
        return new AbilityPhase(id, type, movement, hitbox, effects, visual, events);
    }

    private static List<Effect> effects(Effect... effects) {
        return List.of(effects);
    }

    private static Visual visual(String type, double size, int visibleMs) {
        return new Visual(type, size, visibleMs);
    }

    private static Hitbox circle(double radius) {
        return circle(radius, false);
    }

    private static Hitbox circle(double radius, boolean includeTargetRadius) {
        return new Hitbox("circle", radius, null, null, 1.0,
                null, null, includeTargetRadius);
    }

    private static Hitbox rectangle(double width, double length) {
        return rectangle(width, length, false);
    }

    private static Hitbox rectangle(double width, double length, boolean includeTargetRadius) {
        return new Hitbox("rectangle", null, null, null, 1.0,
                width, length, includeTargetRadius);
    }

    private static Hitbox arc(double range, double degrees, boolean includeTargetRadius) {
        return new Hitbox("arc", null, range, degrees, 1.0,
                null, null, includeTargetRadius);
    }

    private static Hitbox ray(double range, double width) {
        return new Hitbox("ray", null, range, null, 1.0,
                width, range, false);
    }

    private static PhaseEvent effectEvent(List<Effect> effects, PhaseEventType eventType) {
        EnumSet<EffectType> phaseEffects = EnumSet.noneOf(EffectType.class);
        for (Effect effect : effects) phaseEffects.add(effect.type());
        List<TargetKind> targetKinds = eventType == PhaseEventType.COLLISION
                ? phaseEffects.contains(EffectType.DAMAGE) ? DAMAGE_TARGET_KINDS : BOT_TARGET_KINDS
                : List.of();
        return new PhaseEvent(List.of(PhaseAction.APPLY_EFFECTS), phaseEffects,
                null, null, null, null, null, null, targetKinds);
    }


    /** Resolves canonical submitted ability action IDs. */
    public static Integer abilityForAction(Object action) {
        if (action instanceof Integer id && ACTIONS.contains(id)) return id;
        return null;
    }

    public static boolean containsAction(Object action) {
        return abilityForAction(action) != null;
    }

    public static double effectAmount(int abilityId, EffectType type) {
        return get(abilityId).phases().stream()
                .flatMap(phase -> phase.effects().stream())
                .filter(effect -> effect.type() == type)
                .findFirst()
                .map(Effect::amount)
                .orElse(0.0);
    }

    public static int effectDurationMs(int abilityId, String subtype) {
        return get(abilityId).phases().stream()
                .flatMap(phase -> phase.effects().stream())
                .filter(effect -> effect.type() == EffectType.STATUS
                        && (subtype == null || subtype.equals(effect.subtype())))
                .findFirst()
                .map(Effect::durationMs)
                .orElse(0);
    }

    public static String effectOverrideKey(Effect effect) {
        if (effect == null || effect.type() == null) return null;
        return effect.type() == EffectType.STATUS && effect.subtype() != null
                ? effect.type().name().toLowerCase() + ":" + effect.subtype()
                : effect.type().name().toLowerCase();
    }
    public static Effect effect(EffectType type) { return new Effect(type); }
    public static Effect effect(EffectType type, double amount) { return new Effect(type, null, amount, 0, false); }
    public static Effect damage(double amount) { return effect(EffectType.DAMAGE, amount); }
    public static Effect knockback(double amount) { return effect(EffectType.KNOCKBACK, amount); }
    public static Effect pull(double amount) { return effect(EffectType.PULL, amount); }
    public static Effect interrupt(int durationMs) { return timed(EffectType.INTERRUPT, durationMs); }
    public static Effect computedDamage(Falloff falloff) { return computed(EffectType.DAMAGE, falloff); }
    public static Effect teleportByCenterDistance() {
        return new Effect(EffectType.TELEPORT, null, 0, 0, false, null, false, false, "center_distance");
    }
    public static Effect timed(EffectType type, int durationMs) { return new Effect(type, null, 0, durationMs, false); }
    public static Effect timed(EffectType type, double amount, int durationMs) { return new Effect(type, null, amount, durationMs, false); }
    public static Effect computed(EffectType type) { return new Effect(type, null, 0, 0, true); }
    public static Effect computed(EffectType type, Falloff falloff) {
        return new Effect(type, null, 0, 0, true, null, false, false, null, falloff);
    }
    public static Effect status(String subtype, double amount, int durationMs) {
        return new Effect(EffectType.STATUS, subtype, amount, durationMs, false);
    }
    public static Effect status(String subtype, double amount, int durationMs,
                                int intervalMs, Integer movementLockMs) {
        return new Effect(EffectType.STATUS, subtype, amount, durationMs, false,
                null, false, false, null, null, intervalMs, movementLockMs);
    }
    public static Effect healing(double amount, String recipient, boolean requiresConfirmedDamage) {
        return new Effect(EffectType.HEALING, null, amount, 0, false, recipient, requiresConfirmedDamage);
    }
    public static Effect lifesteal(String recipient) {
        return new Effect(EffectType.HEALING, null, 0, 0, true, recipient, true, true);
    }
    public static Effect buff(String subtype, double amount, int durationMs) {
        return new Effect(EffectType.BUFF, subtype, amount, durationMs, false);
    }
    private static Set<EffectType> immutableEffects(Set<EffectType> effects) {
        if (effects == null || effects.isEmpty()) return Set.of();
        return Collections.unmodifiableSet(EnumSet.copyOf(effects));
    }

    private static final Spawn SELF = new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400);
    /** Default spawn for an embedded ability: centered on its owning entity. */
    private static final Spawn ENTITY_ABILITY_SELF = new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn FORWARD = new Spawn(0, 47, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn FORWARD_ZERO = new Spawn(0, 38, false, RotationMode.ZERO, 0, 500, 400);
    private static final Spawn FORWARD_WIND = new Spawn(0, 44, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn FORWARD_TETHER = new Spawn(0, 41, false, RotationMode.OWNER, 0, 500, 400);
    private static final Spawn TARGET = new Spawn(0, 0, true, RotationMode.ZERO, 0, 500, 400);
    private static final Spawn NULL_ZONE_TARGET = new Spawn(0, 0, true, RotationMode.ZERO, 150, 500, 400);
    private static final Map<Integer, AbilityContract> ENTITY_BY_ABILITY = entityCatalog();
    private static final Map<String, AbilityContract> ENTITY_BY_TYPE = entityByType();

    private static final Map<Integer, AbilityContract> BY_ABILITY = combinedCatalog();

    private static Map<Integer, AbilityContract> combinedCatalog() {
        Map<Integer, AbilityContract> contracts = new LinkedHashMap<>();
        contracts.putAll(ATTACHED_BY_ABILITY);
        contracts.putAll(ENTITY_BY_ABILITY);
        return Collections.unmodifiableMap(contracts);
    }

    public static Map<Integer, AbilityContract> all() {
        return BY_ABILITY;
    }

    public static Map<Integer, AbilityContract> attachedAll() {
        return ATTACHED_BY_ABILITY;
    }

    public static Map<Integer, AbilityContract> entityAll() {
        return ENTITY_BY_ABILITY;
    }

    public static AbilityContract get(int abilityId) {
        AbilityContract contract = BY_ABILITY.get(abilityId);
        if (contract == null) throw new IllegalArgumentException("Unknown ability contract: " + abilityId);
        return contract;
    }

    public static AbilityContract forAbility(int abilityId) {
        return BY_ABILITY.get(abilityId);
    }

    public static AbilityContract attachedAbilityContract(int abilityId) {
        return ATTACHED_BY_ABILITY.get(abilityId);
    }

    public static AbilityContract entityContractForAbility(int abilityId) {
        AbilityContract contract = BY_ABILITY.get(abilityId);
        return contract != null && contract.category() != Category.BOT_ATTACHED ? contract : null;
    }

    public static boolean isAttachedAbility(int abilityId) {
        return ATTACHED_BY_ABILITY.containsKey(abilityId);
    }

    public static boolean isEntityAbility(int abilityId) {
        return ENTITY_BY_ABILITY.containsKey(abilityId);
    }

    public static Set<Integer> actions() {
        return ACTIONS;
    }

    public static Activation activationFor(int abilityId) {
        AbilityContract contract = ATTACHED_BY_ABILITY.get(abilityId);
        return contract == null
                ? new Activation(null, false, false, null, false, false)
                : contract.activation();
    }

    public static boolean targetsOwner(int abilityId) {
        AbilityContract contract = ATTACHED_BY_ABILITY.get(abilityId);
        return contract != null && !contract.phases().isEmpty()
                && contract.phases().getFirst().events().containsKey(PhaseEventType.ACTIVATION);
    }


    public static AbilityContract forEntity(ArenaEntity entity) {
        if (entity == null) return null;
        AbilityContract byAbility = entity.abilityId() == null
                ? null : ENTITY_BY_ABILITY.get(entity.abilityId());
        return byAbility == null ? ENTITY_BY_TYPE.get(entity.type()) : byAbility;
    }

    public static AbilityContract entityContract(ArenaEntity entity) {
        return forEntity(entity);
    }

    public static AbilityContract forType(String type) {
        return ENTITY_BY_TYPE.get(type);
    }

    public static List<AbilityPhase> phasesFor(ArenaEntity entity) {
        AbilityContract contract = forEntity(entity);
        return contract == null ? List.of() : contract.phases();
    }

    public static AbilityPhase phaseFor(ArenaEntity entity) {
        List<AbilityPhase> phases = phasesFor(entity);
        if (phases.isEmpty()) return null;
        if (entity != null && entity.phaseId() != null) {
            AbilityPhase locked = phaseById(entity, entity.phaseId());
            if (locked != null) return locked;
        }
        if (entity != null && entity.armed()) {
            AbilityPhase armed = phases.stream()
                    .filter(phase -> "armed".equals(phase.id()))
                    .findFirst().orElse(null);
            if (armed != null) return armed;
        }
        return phases.getFirst();
    }

    public static AbilityPhase phaseById(ArenaEntity entity, String phaseId) {
        if (phaseId == null) return null;
        return phasesFor(entity).stream()
                .filter(phase -> phaseId.equals(phase.id()))
                .findFirst().orElse(null);
    }

    /** Resolves one contract-owned mini ability scheduled by an entity phase. */
    public static EntityAbility entityAbilityFor(ArenaEntity entity, String abilityId) {
        AbilityContract contract = forEntity(entity);
        if (contract == null || abilityId == null) return null;
        return contract.abilities().stream()
                .filter(ability -> abilityId.equals(ability.id()))
                .findFirst().orElse(null);
    }

    /** Resolves the active phase of one entity-owned mini ability. */
    public static AbilityPhase entityAbilityPhaseFor(ArenaEntity entity) {
        AbilityPhase phase = phaseFor(entity);
        if (phase == null || phase.execution() == null) return null;
        EntityAbility ability = entityAbilityFor(entity, phase.execution().abilityId());
        return ability == null || ability.phases().isEmpty() ? null : ability.phases().getFirst();
    }

    /** Resolves the spawn point/orientation of one entity-owned mini ability. */
    public static Spawn entityAbilitySpawnFor(ArenaEntity entity) {
        AbilityPhase phase = phaseFor(entity);
        if (phase == null || phase.execution() == null) {
            return new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400);
        }
        EntityAbility ability = entityAbilityFor(entity, phase.execution().abilityId());
        return ability == null ? new Spawn(0, 0, false, RotationMode.OWNER, 0, 500, 400)
                : ability.spawn();
    }

    public static PhaseType phaseTypeFor(ArenaEntity entity) {
        AbilityPhase phase = phaseFor(entity);
        return phase == null ? null : phase.type();
    }

    private static AbilityPhase phase(
            String id, int startMs, PhaseType type,
            PhaseMovement movement, Hitbox hitbox,
            List<Effect> effects, Visual visual,
            Map<PhaseEventType, PhaseEvent> events,
            Integer durationMs) {
        return phase(id, startMs, type, movement, null, hitbox, effects, visual, events,
                durationMs, null, false, false, null, Map.of(), Map.of());
    }

    private static AbilityPhase phase(
            String id, PhaseType type,
            PhaseMovement movement, Hitbox hitbox,
            List<Effect> effects, Visual visual,
            Map<PhaseEventType, PhaseEvent> events,
            Integer durationMs) {
        return phase(id, 0, type, movement, hitbox, effects, visual, events, durationMs);
    }

    private static AbilityPhase phase(
            String id, int startMs, PhaseType type,
            PhaseMovement movement, Trigger trigger,
            Hitbox hitbox, List<Effect> effects,
            Visual visual,
            Map<PhaseEventType, PhaseEvent> events,
            Integer durationMs, Execution execution, boolean transitionOnly,
            boolean skipOwner, Hit hit,
            Map<String, Double> statOverrides,
            Map<String, EffectOverride> effectOverrides) {
        return new AbilityPhase(id, type, movement, trigger,
                hitbox, null, effects, visual, events, durationMs, execution, transitionOnly,
                skipOwner, hit, visual == null ? null : visual.visibleMs(),
                statOverrides, effectOverrides, startMs);
    }

    private static AbilityPhase phase(
            String id, PhaseType type,
            PhaseMovement movement, Trigger trigger,
            Hitbox hitbox, List<Effect> effects,
            Visual visual,
            Map<PhaseEventType, PhaseEvent> events,
            Integer durationMs, Execution execution, boolean transitionOnly,
            boolean skipOwner, Hit hit,
            Map<String, Double> statOverrides,
            Map<String, EffectOverride> effectOverrides) {
        return phase(id, 0, type, movement, trigger, hitbox, effects, visual, events,
                durationMs, execution, transitionOnly, skipOwner, hit, statOverrides,
                effectOverrides);
    }

    private static AbilityPhase phase(
            String id, PhaseType type,
            PhaseMovement movement, Hitbox hitbox,
            List<Effect> effects, Visual visual,
            Map<PhaseEventType, PhaseEvent> events,
            Integer durationMs, Execution execution, boolean transitionOnly,
            boolean skipOwner, Hit hit,
            Map<String, Double> statOverrides,
            Map<String, EffectOverride> effectOverrides) {
        return phase(id, 0, type, movement, null, hitbox, effects, visual, events,
                durationMs, execution, transitionOnly, skipOwner, hit, statOverrides,
                effectOverrides);
    }

    private static PhaseEvent event(PhaseAction... actions) {
        return new PhaseEvent(List.of(actions), Set.of(), null, null,
                null, null, null, null, BOT_TARGET_KINDS);
    }

    private static PhaseEvent event(List<PhaseAction> actions,
                                                     String transition) {
        return new PhaseEvent(actions, Set.of(),
                new Transition(transition), null, null, null,
                null, null, BOT_TARGET_KINDS);
    }

    private static PhaseEvent event(List<PhaseAction> actions,
                                                     String transition,
                                                     TargetPolicy targetPolicy) {
        return new PhaseEvent(actions, Set.of(),
                new Transition(transition), null, null, null,
                null, targetPolicy, BOT_TARGET_KINDS);
    }

    private static PhaseEvent event(List<PhaseAction> actions,
                                                     String transition, String visualType,
                                                     Integer visibleMs, Double visualSize) {
        return new PhaseEvent(actions, Set.of(),
                new Transition(transition), null,
                visualType, visibleMs, visualSize, null, BOT_TARGET_KINDS);
    }

    private static PhaseEvent event(List<PhaseAction> actions,
                                                     Set<EffectType> effects,
                                                     String visualType, Integer visibleMs,
                                                     Double visualSize, Integer intervalMs) {
        return new PhaseEvent(actions, effects, null, intervalMs,
                visualType, visibleMs, visualSize, null, BOT_TARGET_KINDS);
    }

    private static PhaseEvent event(TargetPolicy targetPolicy,
                                                     PhaseAction... actions) {
        return new PhaseEvent(List.of(actions), Set.of(), null,
                null, null, null, null, targetPolicy, BOT_TARGET_KINDS);
    }

    private static PhaseEvent damageEvent(
            TargetPolicy targetPolicy,
            PhaseAction... actions) {
        return new PhaseEvent(List.of(actions), Set.of(), null,
                null, null, null, null, targetPolicy, DAMAGE_TARGET_KINDS);
    }

    private static Map<Integer, AbilityContract> entityCatalog() {
        Map<Integer, AbilityContract> contracts = new LinkedHashMap<>();

        contracts.put(4, contract(4, "grenade", "grenade", Category.PROJECTILE, FORWARD_ZERO,
                new Lifetime(TimerMode.STOPPED, 0, 0),
                new InitialState(false, true), List.of(
                        phase("travel", 0, PhaseType.PROJECTILE,
                                new PhaseMovement(32),
                                rectangle(12, 12), effects(),
                                new Visual("grenade", "moving", 12),
                                Map.of(PhaseEventType.COLLISION,
                                                event(List.of(PhaseAction.TRANSITION), "active"),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "armed")),
                                1_000),
                        // Armed is reached when the fixed one-second travel phase ends.
                        phase("armed", -1, PhaseType.PROJECTILE,
                                new PhaseMovement(0), null,
                                rectangle(12, 12), effects(),
                                new Visual("grenade", "static", 12),
                                Map.of(PhaseEventType.COLLISION,
                                                event(List.of(PhaseAction.TRANSITION), "active"),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                 1_000, null, true, false, null, Map.of(), Map.of()),
                        // The explosion is reached by collision or armed-phase expiry.
                        phase("active", -1, PhaseType.ZONE,
                                new PhaseMovement(0), null,
                                circle(70), effects(computedDamage(
                                        new Falloff(25.0, 40.0, null, null, 0.0, 64.0))),
                                new Visual("grenadeExplosion", 140, 200),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(new TargetPolicy(
                                                TargetPolicyMode.ONCE),
                                                PhaseAction.APPLY_EFFECTS)),
                                 200, null, true, false, null, Map.of(), Map.of()))));

        contracts.put(5, contract(5, "fireball", "fireball", Category.PROJECTILE, FORWARD,
                new Lifetime(TimerMode.AGE, 1_200, 0),
                new InitialState(false, true), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new PhaseMovement(36),
                                rectangle(30, 30),
                                effects(
                                        damage(15),
                                         status("burn", 2, 5_000, 1_000, null)),
                                new Visual("fireball", 30),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(null, PhaseAction.APPLY_EFFECTS,
                                                PhaseAction.REMOVE)),
                                null))));

        contracts.put(11, contract(11, "proximity_mine", "proximityMine", Category.TRAP, SELF,
                new Lifetime(TimerMode.AGE, 20_800, 0),
                new InitialState(false, false), List.of(
                        phase("travel", PhaseType.PROJECTILE,
                                new PhaseMovement(22),
                                circle(12), effects(),
                                new Visual("proximityMine", "moving", 24),
                                Map.of(PhaseEventType.LIFETIME_END,
                                        event(List.of(PhaseAction.TRANSITION), "armed")),
                                800),
                        phase("armed", -1, PhaseType.ZONE,
                                new PhaseMovement(0),
                                new Trigger(87.5, null, true),
                                circle(87.5), effects(),
                                new Visual("proximityMine", "static", 24),
                                Map.of(PhaseEventType.TRIGGER,
                                                event(List.of(PhaseAction.TRANSITION), "active"),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                20_000, null, true, false, null, Map.of(), Map.of()),
                        phase("active", PhaseType.ZONE,
                                new PhaseMovement(0), null,
                                circle(87.5), effects(damage(25)),
                                new Visual("mineExplosion", 175, 300),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(new TargetPolicy(
                                                TargetPolicyMode.ONCE),
                                                PhaseAction.APPLY_EFFECTS)),
                                300, null, true, false, null, Map.of(), Map.of()))));

        contracts.put(14, contract(14, "gravity_zone", "gravityZone", Category.ZONE, SELF,
                new Lifetime(TimerMode.REMAINING, 7_000, 0),
                new InitialState(false, false), List.of(
                        phase("travel", PhaseType.PROJECTILE,
                                new PhaseMovement(22),
                                circle(120), effects(pull(6)),
                                new Visual("gravityZone", 240),
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "fuse")),
                                1_000),
                        phase("fuse", PhaseType.ZONE,
                                new PhaseMovement(0), null,
                                circle(120), effects(pull(6)),
                                new Visual("gravityZone", 240),
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                3_000, null, true, false, null, Map.of(), Map.of()),
                        phase("active", PhaseType.ZONE,
                                new PhaseMovement(0), null,
                                circle(120), effects(computedDamage(
                                        new Falloff(20.0, 35.0, null, null, 0.0, 90.0))),
                                new Visual("gravityExplosion", 240, 300),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(new TargetPolicy(
                                                TargetPolicyMode.ONCE),
                                                PhaseAction.APPLY_EFFECTS)),
                                300, null, true, false, null, Map.of(), Map.of()))));

        contracts.put(15, contract(15, "silence_wave", "silenceWave", Category.PROJECTILE, SELF,
                new Lifetime(TimerMode.REMAINING, 1_200, 0),
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new PhaseMovement(150),
                                rectangle(150, 190),
                                effects(
                                        status("silence", 0, 2_000),
                                        interrupt(100)),
                                new Visual("silenceWave", 225),
                                Map.of(PhaseEventType.COLLISION,
                                        event(new TargetPolicy(
                                                TargetPolicyMode.ONCE),
                                                PhaseAction.APPLY_EFFECTS)),
                                null))));

        contracts.put(17, droneContract(17, "hunter_drone", "hunterDrone",
                effects(damage(5))));
        contracts.put(31, droneContract(31, "repeller_drone", "hunterDrone",
                effects(damage(3), knockback(40))));

        contracts.put(18, contract(18, "windburst_projectile", "windburstProjectile",
                Category.PROJECTILE, FORWARD_WIND,
                new Lifetime(TimerMode.REMAINING, 500, 0),
                new InitialState(true, true), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new PhaseMovement(44),
                                rectangle(80, 115),
                                effects(damage(20),
                                        knockback(200)),
                                new Visual("windburstProjectile", 24),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(null, PhaseAction.APPLY_EFFECTS,
                                                PhaseAction.REMOVE)),
                                null))));

        contracts.put(21, contract(21, "temporal_rewind_zone", "temporalRewindZone",
                Category.ZONE, SELF,
                new Lifetime(TimerMode.REMAINING, 3_100, 0),
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.ZONE,
                                new PhaseMovement(0),
                                circle(45), effects(timed(
                                        EffectType.RESTORE_STATE, 3000)),
                                new Visual("temporalRewindZone", 90),
                                Map.of(PhaseEventType.ACTIVATION,
                                        event(List.of(PhaseAction.APPLY_EFFECTS),
                                                Set.of(EffectType.RESTORE_STATE),
                                                null, null, null, null)),
                                null))));

        contracts.put(22, contract(22, "orbital_zone", "orbitalMarker",
                Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Lifetime(TimerMode.REMAINING, 1_500, 0),
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.ZONE,
                                new PhaseMovement(0),
                                circle(130), effects(damage(15)),
                                new Visual("orbitalMarker", 260),
                                Map.of(PhaseEventType.INTERVAL,
                                        event(List.of(PhaseAction.APPLY_EFFECTS,
                                                        PhaseAction.EMIT_VISUAL),
                                                Set.of(EffectType.DAMAGE),
                                                "orbitalExplosion", 400, 260.0,
                                                500)),
                                null, new Execution(
                                        PhaseEventType.INTERVAL, null, 500, true),
                                false, true, null, Map.of(), Map.of()))));

        contracts.put(24, contract(24, "null_zone", "nullZone", Category.ZONE, NULL_ZONE_TARGET,
                new Lifetime(TimerMode.REMAINING, 5_000, 0),
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.ZONE,
                                new PhaseMovement(0),
                                circle(150), effects(status("silence", 0, 0)),
                                new Visual("nullZone", 300),
                                Map.of(PhaseEventType.COLLISION,
                                        event(PhaseAction.APPLY_EFFECTS)),
                                null, null, false, true, null, Map.of(), Map.of()))));

        contracts.put(27, contract(27, "singularity_zone", "singularityZone",
                Category.ZONE, TARGET, SelectableOwner.OWNER,
                new Lifetime(TimerMode.REMAINING, 1_300, 0),
                new InitialState(true, false), List.of(
                        phase("fuse", PhaseType.ZONE,
                                new PhaseMovement(0),
                                circle(140), effects(pull(10)),
                                new Visual("singularityZone", 280),
                                Map.of(PhaseEventType.COLLISION,
                                                event(PhaseAction.APPLY_EFFECTS),
                                        PhaseEventType.LIFETIME_END,
                                                event(List.of(PhaseAction.TRANSITION), "active")),
                                1_200, null, false, true, null, Map.of(), Map.of()),
                        phase("active", -1, PhaseType.ZONE,
                                new PhaseMovement(0), null,
                                circle(140), effects(computedDamage(
                                        new Falloff(15.0, 35.0, null, null, 0.0, 140.0))),
                                new Visual("singularityExplosion", 280, 400),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(new TargetPolicy(
                                                TargetPolicyMode.ONCE),
                                                PhaseAction.APPLY_EFFECTS)),
                                400, null, true, true, null, Map.of(), Map.of()))));

        contracts.put(28, contract(28, "tether_bolt", "tetherBolt", Category.PROJECTILE, FORWARD_TETHER,
                new Lifetime(TimerMode.REMAINING, 1_100, 0),
                new InitialState(true, true), List.of(
                        phase("active", PhaseType.PROJECTILE,
                                new PhaseMovement(42),
                                rectangle(18, 18),
                                effects(damage(10),
                                        pull(100),
                                        status("slow", 0, 1_200)),
                                null,
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(null, PhaseAction.APPLY_EFFECTS,
                                                PhaseAction.REMOVE)),
                                null))));

        contracts.put(29, contract(29, "static_snare", "staticSnare", Category.TRAP, SELF,
                new Lifetime(TimerMode.AGE, 16_000, 0),
                new InitialState(true, false), List.of(
                        phase("armed", PhaseType.ZONE,
                                new PhaseMovement(0),
                                new Trigger(75.0, 16_000, true),
                                circle(12), effects(
                                        damage(15),
                                        status("slow", 0, 2_200),
                                        interrupt(150)),
                                new Visual("staticSnare", 24),
                                Map.of(PhaseEventType.TRIGGER,
                                                event(List.of(PhaseAction.APPLY_EFFECTS,
                                                                PhaseAction.EMIT_VISUAL,
                                                                PhaseAction.TRANSITION),
                                                        "triggered", new TargetPolicy(
                                                                TargetPolicyMode.ONCE)),
                                        PhaseEventType.KILLED,
                                                event(List.of(PhaseAction.EMIT_VISUAL,
                                                                PhaseAction.TRANSITION),
                                                        "destroyed", "staticSnareBurst", 300, 240.0)),
                                null, null, false, true, null, Map.of(), Map.of())
                                .withHealth(new Health(20, 20)),
                        phase("triggered", -1, PhaseType.ZONE,
                                new PhaseMovement(0), null,
                                circle(75), effects(),
                                new Visual("staticSnareBurst", 150, 300),
                                Map.of(), 300, null, false, true, null, Map.of(), Map.of()),
                        phase("destroyed", -1, PhaseType.ZONE,
                                new PhaseMovement(0),
                                null,
                                circle(120), effects(
                                        damage(20),
                                        status("slow", 0, 3_000),
                                        interrupt(150)),
                                new Visual("staticSnareBurst", 240, 300),
                                Map.of(PhaseEventType.COLLISION,
                                        damageEvent(new TargetPolicy(
                                                TargetPolicyMode.ONCE),
                                                PhaseAction.APPLY_EFFECTS)),
                                300, null, false, true, null,
                                 Map.of(), Map.of()))));

        return Collections.unmodifiableMap(contracts);
    }

    private static AbilityContract droneContract(int abilityId, String entityType,
                                                String runtimeType,
                                                List<Effect> effects) {
        return contract(abilityId, entityType, runtimeType,
                Category.SUMMON, SELF,
                new Lifetime(TimerMode.AGE, 6_000, 0),
                new InitialState(true, false), List.of(
                        phase("active", PhaseType.SUMMON,
                                new PhaseMovement(4.5, 8, 28),
                                circle(14), effects(),
                                new Visual("hunterDrone", 28),
                                Map.of(PhaseEventType.KILLED,
                                                event(PhaseAction.REMOVE)),
                                null, new Execution(null, null, 1_000, true, "primary"),
                                false, true, null, Map.of(), Map.of())
                                .withHealth(new Health(50, 50))),
                List.of(new EntityAbility("primary", ENTITY_ABILITY_SELF, List.of(
                        new AbilityPhase("active", PhaseType.RAY, ray(200, 5), effects,
                                Map.of(PhaseEventType.COLLISION,
                                        event(PhaseAction.APPLY_EFFECTS)),
                                null, new Visual("gun", 16, 300))))));
    }

    private static AbilityContract contract(int abilityId, String entityType,
                                           String runtimeType, Category category,
                                           Spawn spawn, Lifetime lifetime,
                                           InitialState initialState,
                                           List<AbilityPhase> phases) {
        return contract(abilityId, entityType, runtimeType, category, spawn,
                SelectableOwner.OWNER, lifetime, initialState, phases, List.of());
    }

    private static AbilityContract contract(int abilityId, String entityType,
                                           String runtimeType, Category category,
                                           Spawn spawn, Lifetime lifetime,
                                           InitialState initialState,
                                           List<AbilityPhase> phases,
                                           List<EntityAbility> abilities) {
        return contract(abilityId, entityType, runtimeType, category, spawn,
                SelectableOwner.OWNER, lifetime, initialState, phases, abilities);
    }

    private static AbilityContract contract(int abilityId, String entityType,
                                           String runtimeType, Category category,
                                           Spawn spawn, SelectableOwner selectableOwner,
                                           Lifetime lifetime, InitialState initialState,
                                           List<AbilityPhase> phases) {
        return contract(abilityId, entityType, runtimeType, category, spawn,
                selectableOwner, lifetime, initialState, phases, List.of());
    }

    private static AbilityContract contract(int abilityId, String entityType,
                                           String runtimeType, Category category,
                                           Spawn spawn, SelectableOwner selectableOwner,
                                           Lifetime lifetime, InitialState initialState,
                                           List<AbilityPhase> phases,
                                           List<EntityAbility> abilities) {
        return new AbilityContract(abilityId, entityType, runtimeType, category, spawn,
                selectableOwner, lifetime, initialState,
                new Activation(null, false, false, null, false, false), phases, abilities);
    }

    private static Map<String, AbilityContract> entityByType() {
        Map<String, AbilityContract> byType = new LinkedHashMap<>();
        for (AbilityContract contract : ENTITY_BY_ABILITY.values()) {
            if (contract.entityType() != null) byType.put(contract.entityType(), contract);
            if (contract.runtimeType() != null) byType.put(contract.runtimeType(), contract);
        }
        return Collections.unmodifiableMap(byType);
    }

}
