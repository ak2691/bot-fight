package com.example.botfight.simulation.ecs.contracts;

import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.example.botfight.simulation.gameconfig.AbilityRegistry;
import com.example.botfight.simulation.gameconfig.GameplayData;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.function.Supplier;

/**
 * Gameplay-only ability metadata shared by authoritative combat resolvers.
 *
 * <p>An ability is {@code onTrigger} verbs that run when its wind-up ends, plus the {@code entities} its
 * {@code spawn} verbs create. An entity is a list of phases whose events run the same verbs
 * ({@code AbilityVerbs} is the one executor).
 */
public final class AbilityContracts {
    private AbilityContracts() {}

    public enum EffectType { @JsonProperty("damage") DAMAGE, @JsonProperty("healing") HEALING, @JsonProperty("knockback") KNOCKBACK, @JsonProperty("pull") PULL, @JsonProperty("status") STATUS, @JsonProperty("buff") BUFF, @JsonProperty("interrupt") INTERRUPT, @JsonProperty("teleport") TELEPORT, @JsonProperty("restore_state") RESTORE_STATE, @JsonProperty("damage_reduction") DAMAGE_REDUCTION, @JsonProperty("damage_immunity") DAMAGE_IMMUNITY, @JsonProperty("damage_reflection") DAMAGE_REFLECTION }
    /** Phase host vocabulary of entity phases. */
    public enum PhaseType { @JsonProperty("projectile") PROJECTILE, @JsonProperty("zone") ZONE, @JsonProperty("summon") SUMMON }
    public enum PhaseEventType { @JsonProperty("collision") COLLISION, @JsonProperty("trigger") TRIGGER, @JsonProperty("hit") HIT, @JsonProperty("killed") KILLED, @JsonProperty("lifetimeEnd") LIFETIME_END, @JsonProperty("schedule") SCHEDULE }
    public enum MovementMode { @JsonProperty("straight") STRAIGHT, @JsonProperty("static") STATIC, @JsonProperty("seek") SEEK, @JsonProperty("followOwner") FOLLOW_OWNER }
    public enum TargetPolicyMode { @JsonProperty("once") ONCE, @JsonProperty("everyTick") EVERY_TICK, @JsonProperty("interval") INTERVAL }
    public enum EventScheduleMode { @JsonProperty("once") ONCE, @JsonProperty("repeat") REPEAT, @JsonProperty("continuous") CONTINUOUS }
    public record EventSchedule(EventScheduleMode mode, Integer intervalMs,
                                boolean startImmediately, Integer count) {
        public EventSchedule {
            mode = mode == null ? EventScheduleMode.ONCE : mode;
            intervalMs = intervalMs == null ? null : Math.max(1, intervalMs);
            count = count == null || count <= 0 ? null : count;
            if (mode != EventScheduleMode.REPEAT) {
                intervalMs = null;
                count = null;
            }
        }

        public EventSchedule(EventScheduleMode mode) {
            this(mode, null, true, null);
        }

        public EventSchedule(EventScheduleMode mode, int intervalMs,
                             boolean startImmediately) {
            this(mode, intervalMs, startImmediately, null);
        }
    }

    /** Semantic target categories used by verbs and entity collision events. */
    public enum TargetKind { BOT, HP_ENTITY, SUMMON, ENTITY }

    /** A verb's {@code targets} list names this to apply to the bot that owns the ability. */
    public static final String OWNER_TARGET = "OWNER";

    public enum Category { @JsonProperty("projectile") PROJECTILE, @JsonProperty("trap") TRAP, @JsonProperty("summon") SUMMON, @JsonProperty("zone") ZONE }
    public enum RotationSpace { @JsonProperty("owner") OWNER, @JsonProperty("world") WORLD }
    public enum TimerMode { @JsonProperty("none") NONE, @JsonProperty("age") AGE, @JsonProperty("remaining") REMAINING, @JsonProperty("stopped") STOPPED, @JsonProperty("fuse") FUSE }
    public enum SelectableOwner { OWNER, NONE }
    public enum PatternType { @JsonProperty("fan") FAN, @JsonProperty("ring") RING, @JsonProperty("line") LINE }

    /** Owner-relative spawn metadata. Movement belongs to phases, never spawn. */
    public record Spawn(double offsetX, double offsetY, boolean targetPosition,
                        double rotation, RotationSpace rotationSpace,
                        double clampToRadius, double defaultX, double defaultY) {
        public Spawn {
            rotation = Double.isFinite(rotation)
                    ? Math.max(-360, Math.min(360, rotation)) : 0;
            rotationSpace = rotationSpace == null ? RotationSpace.OWNER : rotationSpace;
        }
    }

    public record Lifetime(TimerMode timerMode, int duration, int add) {}
    public record InitialState(boolean armed, boolean damageMultiplierFromOwner) {}

    public static final List<TargetKind> BOT_TARGET_KINDS = List.of(TargetKind.BOT);
    public static final List<TargetKind> DAMAGE_TARGET_KINDS = List.of(
            TargetKind.BOT, TargetKind.HP_ENTITY);
    public static final List<TargetKind> BOT_AND_SUMMON_TARGET_KINDS = List.of(
            TargetKind.BOT, TargetKind.SUMMON);

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
    }

    public record Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                         String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage,
                         String distanceMode, Falloff falloff, Integer intervalMs,
                         Integer movementLockMs, List<TargetKind> targetKinds) {
        public Effect {
            List<TargetKind> normalized = targetKinds == null || targetKinds.isEmpty()
                    ? defaultEffectTargetKinds(type)
                    : targetKinds.stream().filter(Objects::nonNull).distinct().toList();
            targetKinds = List.copyOf(normalized);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage,
                      String distanceMode, Falloff falloff, Integer intervalMs,
                      Integer movementLockMs) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient,
                    requiresConfirmedDamage, mirrorsDamage, distanceMode, falloff,
                    intervalMs, movementLockMs, null);
        }
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

    /** Ability-level activation metadata: how the ability starts, not what it does. */
    public record Activation(String targetMode, boolean captureAtActivation,
                             String phaseFacingDefault,
                             boolean teleportOncePerActivation) {
        public Activation(String targetMode, boolean captureAtActivation,
                         String phaseFacingDefault) {
            this(targetMode, captureAtActivation,
                    phaseFacingDefault, false);
        }
    }

    public record TargetPolicy(TargetPolicyMode mode, String intervalStat, Integer intervalMs) {
        public TargetPolicy(TargetPolicyMode mode) {
            this(mode, null, null);
        }

        public String interval() { return intervalStat; }
    }

    /** Initial and maximum health for a phase that can receive incoming damage. */
    public record Health(double hp, double maxHp, boolean allowFriendlyDamage) {
        public Health(double hp, double maxHp) {
            this(hp, maxHp, false);
        }

        public Health(double maxHp) {
            this(maxHp, maxHp, false);
        }
    }

    /** Numeric geometry. */
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

    /**
     * How an entity phase moves. {@code straight} goes forward (or {@code backward}) {@code unitsPerTick},
     * {@code static} stays, {@code seek} turns {@code turnDegrees} toward the nearest enemy while moving
     * {@code unitsPerTick}, {@code followOwner} takes the owner's pose plus the entity's spawn offset.
     */
    public record PhaseMovement(MovementMode mode, double unitsPerTick, double turnDegrees, double size,
                                String direction) {
        public PhaseMovement {
            mode = mode == null ? MovementMode.STATIC : mode;
        }

        public PhaseMovement(double unitsPerTick) {
            this(unitsPerTick > 0 ? MovementMode.STRAIGHT : MovementMode.STATIC, unitsPerTick, 0, 0, null);
        }

        public PhaseMovement(double unitsPerTick, double turnDegrees, double size) {
            this(MovementMode.SEEK, unitsPerTick, turnDegrees, size, null);
        }

        public PhaseMovement(double unitsPerTick, String direction) {
            this(unitsPerTick > 0 ? MovementMode.STRAIGHT : MovementMode.STATIC, unitsPerTick, 0, 0, direction);
        }

        /** Units per tick of straight and seek movement; 0 for static and followOwner phases. */
        public double speed() {
            return mode == MovementMode.STATIC || mode == MovementMode.FOLLOW_OWNER ? 0 : unitsPerTick;
        }
    }

    public record Trigger(Double radius, Integer lifetimeMs, boolean attackHits,
                          boolean projectileOverlap, boolean botContact,
                          boolean chain) {
        public Trigger(Double radius, Integer lifetimeMs, boolean botContact) {
            this(radius, lifetimeMs, false, false, botContact, false);
        }
    }

    /** Presentation metadata of a verb or of the phase that is currently active. */
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

    // ---- verbs

    /** How a spawn verb places several entities: a fan, a ring, or a sideways line (1 to 12 of them). */
    public record SpawnPattern(PatternType type, int count, double spreadDeg, double spacing) {}

    /** One allowlisted instruction. Verbs never carry executable user code. */
    public sealed interface Verb permits HitVerb, ApplyEffectsVerb, SpawnVerb, MoveVerb, FaceVerb,
            TransitionVerb, RemoveVerb, EmitVisualVerb {
        String name();
    }

    /**
     * Instant: query the hitbox from the source pose once and apply {@code effects} to each target in distance
     * order. {@code aim} {@code "seekTarget"} limits an entity's shot to the enemy it is chasing.
     */
    public record HitVerb(Hitbox hitbox, List<TargetKind> targets, List<Effect> effects,
                          boolean nearestOnly, String oncePerTarget, String aim, Spawn origin,
                          String knockbackDirection, String pullDirection, Visual visual,
                          int atMs, String pose) implements Verb {
        public HitVerb {
            targets = targets == null ? List.of() : List.copyOf(targets);
            effects = effects == null ? List.of() : List.copyOf(effects);
        }

        @Override public String name() { return "hit"; }

        public HitVerb(Hitbox hitbox, List<TargetKind> targets, List<Effect> effects,
                       boolean nearestOnly, String oncePerTarget, String aim, Spawn origin,
                       String knockbackDirection, String pullDirection, Visual visual) {
            this(hitbox, targets, effects, nearestOnly, oncePerTarget, aim, origin, knockbackDirection,
                    pullDirection, visual, 0, null);
        }
    }

    /** Applies {@code effects} to the owner ({@code ownerTarget}) or to the event's targets. */
    public record ApplyEffectsVerb(boolean ownerTarget, List<Effect> effects, String knockbackDirection,
                                   String pullDirection, Visual visual, int atMs, String pose) implements Verb {
        public ApplyEffectsVerb {
            effects = effects == null ? List.of() : List.copyOf(effects);
        }

        @Override public String name() { return "applyEffects"; }

        public ApplyEffectsVerb(boolean ownerTarget, List<Effect> effects, String knockbackDirection,
                                String pullDirection, Visual visual) {
            this(ownerTarget, effects, knockbackDirection, pullDirection, visual, 0, null);
        }
    }

    public record SpawnVerb(String entity, SpawnPattern pattern, int atMs, String pose) implements Verb {
        public SpawnVerb(String entity, SpawnPattern pattern) {
            this(entity, pattern, 0, null);
        }

        @Override public String name() { return "spawn"; }
    }

    /** The tick offset a trigger verb runs at: 0 for the trigger tick, else the delayed step's {@code atMs}. */
    public static int atMs(Verb verb) {
        return switch (verb) {
            case HitVerb hit -> hit.atMs();
            case ApplyEffectsVerb apply -> apply.atMs();
            case SpawnVerb spawn -> spawn.atMs();
            default -> 0;
        };
    }

    /** The pose a delayed trigger verb fires from ({@code "current"} or {@code "captured"}), or null. */
    public static String poseOf(Verb verb) {
        return switch (verb) {
            case HitVerb hit -> hit.pose();
            case ApplyEffectsVerb apply -> apply.pose();
            case SpawnVerb spawn -> spawn.pose();
            default -> null;
        };
    }

    /** Index of the first delayed trigger verb (atMs above 0), or -1 when every verb runs at the trigger. */
    public static int firstDelayedIndex(List<Verb> verbs) {
        for (int index = 0; index < verbs.size(); index += 1) {
            if (atMs(verbs.get(index)) > 0) return index;
        }
        return -1;
    }

    /** Moves the owner (a dash): {@code distance} units, {@code unitsPerTick} each tick. */
    public record MoveVerb(double distance, double unitsPerTick, int trailMs, Visual visual) implements Verb {
        @Override public String name() { return "move"; }
    }

    /** Turns the owner toward the activation target. */
    public record FaceVerb(String target, Visual visual) implements Verb {
        @Override public String name() { return "face"; }
    }

    public record TransitionVerb(String to) implements Verb {
        @Override public String name() { return "transition"; }
    }

    public record RemoveVerb() implements Verb {
        @Override public String name() { return "remove"; }
    }

    public record EmitVisualVerb(String visualType, Integer visibleMs, Double visualSize) implements Verb {
        @Override public String name() { return "emitVisual"; }
    }

    /** A phase event: who it reaches, when it is evaluated, and the verbs it runs. */
    public record PhaseEvent(List<TargetKind> targets, EventSchedule schedule, TargetPolicy targetPolicy,
                             boolean recheckCollisionOnTransition, boolean nearestOnly, boolean waitForHit,
                             List<Verb> verbs) {
        public PhaseEvent {
            targets = targets == null || targets.isEmpty()
                    ? BOT_TARGET_KINDS
                    : targets.stream().filter(Objects::nonNull).distinct().toList();
            verbs = verbs == null ? List.of() : List.copyOf(verbs);
        }

        public PhaseEvent(List<Verb> verbs) {
            this(List.of(), null, null, true, false, false, verbs);
        }

        public PhaseEvent withSchedule(EventSchedule nextSchedule) {
            return new PhaseEvent(targets, nextSchedule, targetPolicy, recheckCollisionOnTransition,
                    nearestOnly, waitForHit, verbs);
        }

        public boolean has(Class<? extends Verb> kind) {
            return verbs.stream().anyMatch(kind::isInstance);
        }

        /** The effects of this event's {@code applyEffects} verbs, in order. */
        public List<Effect> applyEffects() {
            return verbs.stream().filter(ApplyEffectsVerb.class::isInstance)
                    .flatMap(verb -> ((ApplyEffectsVerb) verb).effects().stream()).toList();
        }
    }

    /** Canonical entity phase metadata. */
    public record AbilityPhase(String id, PhaseType type, PhaseMovement movement,
                               Trigger trigger, Hitbox hitbox, Health health,
                               Visual visual, Map<PhaseEventType, PhaseEvent> on,
                               Integer durationMs, boolean transitionOnly,
                               boolean skipOwner, int startMs) {
        public AbilityPhase {
            Map<PhaseEventType, PhaseEvent> normalizedEvents = new LinkedHashMap<>();
            if (on != null) {
                on.forEach((eventType, event) -> {
                    if (event == null || event.schedule() != null) {
                        normalizedEvents.put(eventType, event);
                    } else {
                        EventScheduleMode mode = eventType == PhaseEventType.COLLISION
                                ? EventScheduleMode.CONTINUOUS : EventScheduleMode.ONCE;
                        normalizedEvents.put(eventType, event.withSchedule(new EventSchedule(mode)));
                    }
                });
            }
            on = Collections.unmodifiableMap(normalizedEvents);
        }

        public AbilityPhase(String id, PhaseType type, PhaseMovement movement,
                            Hitbox hitbox, Visual visual, Map<PhaseEventType, PhaseEvent> on,
                            Integer durationMs) {
            this(id, type, movement, null, hitbox, null, visual, on, durationMs, false, false, 0);
        }

        public AbilityPhase withHealth(Health nextHealth) {
            return new AbilityPhase(id, type, movement, trigger, hitbox, nextHealth, visual, on,
                    durationMs, transitionOnly, skipOwner, startMs);
        }

        public AbilityPhase withEventSchedule(PhaseEventType eventType, EventSchedule schedule) {
            Map<PhaseEventType, PhaseEvent> nextEvents = new LinkedHashMap<>(on);
            PhaseEvent event = nextEvents.get(eventType);
            if (event != null) nextEvents.put(eventType, event.withSchedule(schedule));
            return new AbilityPhase(id, type, movement, trigger, hitbox, health, visual, nextEvents,
                    durationMs, transitionOnly, skipOwner, startMs);
        }

        /** The effects this phase's events apply to their targets (its {@code applyEffects} verbs). */
        public List<Effect> effects() {
            return on.values().stream().filter(Objects::nonNull)
                    .flatMap(event -> event.applyEffects().stream()).toList();
        }

        /** The effect types are derived from the concrete payloads. */
        public Set<EffectType> effectTypes() {
            List<Effect> effects = effects();
            if (effects.isEmpty()) return Set.of();
            EnumSet<EffectType> types = EnumSet.noneOf(EffectType.class);
            effects.stream().map(Effect::type).filter(type -> type != null).forEach(types::add);
            return Collections.unmodifiableSet(types);
        }

        /** The {@code hit} verb of this phase's timer event (a summon's shot), or null. */
        public HitVerb scheduledHit() {
            PhaseEvent schedule = on.get(PhaseEventType.SCHEDULE);
            if (schedule == null) return null;
            return schedule.verbs().stream().filter(HitVerb.class::isInstance)
                    .map(HitVerb.class::cast).findFirst().orElse(null);
        }
    }

    /** One arena entity an ability can spawn. */
    public record EntityContract(
            int abilityId,
            String entityType,
            String runtimeType,
            Category category,
            Spawn spawn,
            SelectableOwner selectableOwner,
            Lifetime lifetime,
            InitialState initialState,
            List<AbilityPhase> phases) {
        public EntityContract {
            category = category == null ? Category.ZONE : category;
            spawn = spawn == null
                    ? new Spawn(0, 0, false, 0, RotationSpace.OWNER, 0, 500, 400)
                    : spawn;
            selectableOwner = selectableOwner == null ? SelectableOwner.OWNER : selectableOwner;
            lifetime = lifetime == null ? new Lifetime(TimerMode.NONE, 0, 0) : lifetime;
            initialState = initialState == null ? new InitialState(false, false) : initialState;
            phases = phases == null ? List.of() : List.copyOf(phases);
        }
    }

    /** The one normalized ability shape: activation metadata, trigger verbs and the entities it spawns. */
    public record AbilityContract(
            int abilityId,
            Activation activation,
            List<Verb> onTrigger,
            Map<String, EntityContract> entities,
            String primaryEntity) {
        public AbilityContract {
            activation = activation == null
                    ? new Activation(null, false, null, false)
                    : activation;
            onTrigger = onTrigger == null ? List.of() : List.copyOf(onTrigger);
            entities = entities == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(entities));
        }

        /** The entity the ability's spawn verb creates, or null when it spawns nothing. */
        public EntityContract primary() {
            return primaryEntity == null ? null : entities.get(primaryEntity);
        }

        public List<HitVerb> hitVerbs() {
            return onTrigger.stream().filter(HitVerb.class::isInstance).map(HitVerb.class::cast).toList();
        }

        public boolean has(Class<? extends Verb> kind) {
            return onTrigger.stream().anyMatch(kind::isInstance);
        }

        /** The effects the ability's trigger verbs apply. */
        public List<Effect> triggerEffects() {
            return onTrigger.stream().flatMap(verb -> verbEffects(verb).stream()).toList();
        }
    }

    /** The effects one verb applies. */
    public static List<Effect> verbEffects(Verb verb) {
        if (verb instanceof HitVerb hit) return hit.effects();
        if (verb instanceof ApplyEffectsVerb apply) return apply.effects();
        return List.of();
    }

    private record Registry(Map<Integer, AbilityContract> contracts,
                            Map<Integer, EntityContract> entities,
                            Map<String, EntityContract> byType) {}

    private static volatile Registry registry = buildRegistry(GameplayContracts.abilities());

    private static Registry buildRegistry(Map<Integer, AbilityContract> contracts) {
        Map<Integer, EntityContract> entities = new LinkedHashMap<>();
        for (AbilityContract contract : contracts.values()) {
            if (contract.primary() != null) entities.put(contract.abilityId(), contract.primary());
        }
        Map<String, EntityContract> byType = new LinkedHashMap<>();
        for (AbilityContract contract : contracts.values()) {
            for (EntityContract entity : contract.entities().values()) {
                byType.put(entity.entityType(), entity);
                byType.putIfAbsent(entity.runtimeType(), entity);
            }
        }
        if (entities.containsKey(29)) {
            byType.put("static_snare", entities.get(29));
            byType.put("staticSnare", entities.get(29));
        }
        return new Registry(Collections.unmodifiableMap(new LinkedHashMap<>(contracts)),
                Collections.unmodifiableMap(entities), Collections.unmodifiableMap(byType));
    }

    /**
     * Runs {@code body} with the given abilities (written in the abilities.json schema) in the registry: an
     * ability whose id is already used replaces the shipped one. The data goes through the same checks as the
     * shipped files. For tests.
     */
    public static <T> T withTestAbilities(List<GameplayData.AbilityData> extra, Supplier<T> body) {
        GameplayData merged = GameplayData.get().withAbilities(extra);
        Registry previous = registry;
        registry = buildRegistry(GameplayContracts.abilities(merged));
        try {
            return body.get();
        } finally {
            registry = previous;
        }
    }

    /** Action IDs come from the identity registry, not from one contract family. */
    private static final Set<Integer> ACTIONS = Set.copyOf(AbilityRegistry.all().keySet());

    /** Resolves canonical submitted ability action IDs. */
    public static Integer abilityForAction(Object action) {
        if (action instanceof Integer id && ACTIONS.contains(id)) return id;
        return null;
    }

    public static boolean containsAction(Object action) {
        return abilityForAction(action) != null;
    }

    public static double effectAmount(int abilityId, EffectType type) {
        return allEffects(abilityId).stream()
                .filter(effect -> effect.type() == type)
                .findFirst()
                .map(Effect::amount)
                .orElse(0.0);
    }

    public static int effectDurationMs(int abilityId, String subtype) {
        return allEffects(abilityId).stream()
                .filter(effect -> effect.type() == EffectType.STATUS
                        && (subtype == null || subtype.equals(effect.subtype())))
                .findFirst()
                .map(Effect::durationMs)
                .orElse(0);
    }

    /** Trigger-time effects, then the effects of the ability's entity phases. */
    private static List<Effect> allEffects(int abilityId) {
        AbilityContract contract = get(abilityId);
        java.util.ArrayList<Effect> effects = new java.util.ArrayList<>(contract.triggerEffects());
        contract.entities().values().forEach(entity ->
                entity.phases().forEach(phase -> effects.addAll(phase.effects())));
        return effects;
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

    private static List<TargetKind> defaultEffectTargetKinds(EffectType type) {
        return type == EffectType.DAMAGE ? DAMAGE_TARGET_KINDS : BOT_TARGET_KINDS;
    }

    /** Returns an effect copy with an explicit target capability list. */
    public static Effect targeted(Effect effect, TargetKind... targetKinds) {
        return new Effect(effect.type(), effect.subtype(), effect.amount(), effect.durationMs(),
                effect.runtimeComputed(), effect.recipient(), effect.requiresConfirmedDamage(),
                effect.mirrorsDamage(), effect.distanceMode(), effect.falloff(), effect.intervalMs(),
                effect.movementLockMs(), targetKinds == null ? List.of() : List.of(targetKinds));
    }

    /** Empty event target lists retain bot-only behavior; entities need explicit kinds. */
    public static boolean eventTargetsKind(PhaseEvent event, TargetKind targetKind) {
        List<TargetKind> kinds = event == null ? List.of() : event.targets();
        return kinds.isEmpty() ? targetKind == TargetKind.BOT : kinds.contains(targetKind);
    }

    /** HP-bearing summons carry both HP_ENTITY and SUMMON target capabilities. */
    public static boolean eventTargetsEntity(PhaseEvent event, boolean summonTarget) {
        return event != null && targetsEntity(event.targets(), summonTarget);
    }

    /** Whether a target list reaches an HP entity (and a summon, when {@code summonTarget}). */
    public static boolean targetsEntity(List<TargetKind> kinds, boolean summonTarget) {
        List<TargetKind> declared = kinds == null ? List.of() : kinds;
        if (declared.isEmpty()) return false;
        return declared.contains(TargetKind.ENTITY) || declared.contains(TargetKind.HP_ENTITY)
                || summonTarget && declared.contains(TargetKind.SUMMON);
    }

    public static boolean effectTargetsBot(Effect effect) {
        return effect != null && effect.targetKinds().contains(TargetKind.BOT);
    }

    /** Generic HP entities receive damage and displacement; coded summons support bot-like effects. */
    public static boolean effectTargetsEntity(Effect effect, boolean summonTarget) {
        if (effect == null) return false;
        if (summonTarget && effect.targetKinds().contains(TargetKind.SUMMON)
                && switch (effect.type()) {
                    case DAMAGE, STATUS, INTERRUPT, KNOCKBACK, PULL -> true;
                    default -> false;
                }) return true;
        if (effect.targetKinds().contains(TargetKind.HP_ENTITY)
                && switch (effect.type()) {
                    case DAMAGE, KNOCKBACK, PULL -> true;
                    default -> false;
                }) return true;
        return effect.type() == EffectType.DAMAGE
                && effect.targetKinds().contains(TargetKind.ENTITY);
    }

    public static Map<Integer, AbilityContract> all() {
        return registry.contracts();
    }

    /** Ability ID to the entity its spawn verb creates; abilities that spawn nothing are absent. */
    public static Map<Integer, EntityContract> entityAll() {
        return registry.entities();
    }

    public static AbilityContract get(int abilityId) {
        AbilityContract contract = registry.contracts().get(abilityId);
        if (contract == null) throw new IllegalArgumentException("Unknown ability contract: " + abilityId);
        return contract;
    }

    public static AbilityContract forAbility(int abilityId) {
        return registry.contracts().get(abilityId);
    }

    public static EntityContract entityContractForAbility(int abilityId) {
        return registry.entities().get(abilityId);
    }

    public static boolean isEntityAbility(int abilityId) {
        return registry.entities().containsKey(abilityId);
    }

    public static Set<Integer> actions() {
        return ACTIONS;
    }

    public static Activation activationFor(int abilityId) {
        AbilityContract contract = registry.contracts().get(abilityId);
        return contract == null
                ? new Activation(null, false, null, false)
                : contract.activation();
    }

    /** True when the ability applies effects to its owner at trigger time (heals, buffs, Rewind). */
    public static boolean appliesToOwner(int abilityId) {
        AbilityContract contract = registry.contracts().get(abilityId);
        return contract != null && contract.onTrigger().stream()
                .anyMatch(verb -> verb instanceof ApplyEffectsVerb apply && apply.ownerTarget());
    }

    public static List<HitVerb> hitVerbs(int abilityId) {
        AbilityContract contract = registry.contracts().get(abilityId);
        return contract == null ? List.of() : contract.hitVerbs();
    }

    /** The entity definition for an entity payload: its ability's entity of that key, else the primary one. */
    public static EntityContract forEntity(ArenaEntity entity) {
        if (entity == null) return null;
        AbilityContract contract = entity.abilityId() == null
                ? null : registry.contracts().get(entity.abilityId());
        if (contract != null) {
            EntityContract keyed = entity.entityKey() == null ? null : contract.entities().get(entity.entityKey());
            if (keyed != null) return keyed;
            if (contract.primary() != null) return contract.primary();
        }
        return registry.byType().get(entity.type());
    }

    public static EntityContract entityContract(ArenaEntity entity) {
        return forEntity(entity);
    }

    public static EntityContract forType(String type) {
        return registry.byType().get(type);
    }

    /** Summon capability belongs to the entity class, not its current phase. */
    public static boolean isSummon(ArenaEntity entity) {
        EntityContract contract = forEntity(entity);
        return contract != null && contract.category() == Category.SUMMON;
    }

    public static List<AbilityPhase> phasesFor(ArenaEntity entity) {
        EntityContract contract = forEntity(entity);
        return contract == null ? List.of() : contract.phases();
    }

    public static AbilityPhase phaseFor(ArenaEntity entity) {
        List<AbilityPhase> phases = phasesFor(entity);
        if (phases.isEmpty()) return null;
        if (entity != null && entity.phaseId() != null) {
            AbilityPhase locked = phaseById(entity, entity.phaseId());
            if (locked != null) return locked;
        }
        return phases.getFirst();
    }

    public static AbilityPhase phaseById(ArenaEntity entity, String phaseId) {
        if (phaseId == null) return null;
        return phasesFor(entity).stream()
                .filter(phase -> phaseId.equals(phase.id()))
                .findFirst().orElse(null);
    }

    /** The shot of a summon entity: the {@code hit} verb of its current phase's timer event, or null. */
    public static HitVerb entityShot(ArenaEntity entity) {
        AbilityPhase phase = phaseFor(entity);
        return phase == null ? null : phase.scheduledHit();
    }

    public static PhaseType phaseTypeFor(ArenaEntity entity) {
        AbilityPhase phase = phaseFor(entity);
        return phase == null ? null : phase.type();
    }
}
