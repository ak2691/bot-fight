package com.example.botfight.simulation.gameconfig;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;

/** Gameplay-only ability metadata shared by authoritative combat resolvers. */
public final class AbilityContracts {
    private AbilityContracts() {}

    public enum EffectType { DAMAGE, HEALING, KNOCKBACK, PULL, STATUS, BUFF, INTERRUPT, MOVEMENT, TELEPORT,
        RESTORE_STATE, DAMAGE_REDUCTION, DAMAGE_IMMUNITY, DAMAGE_REFLECTION, SPAWN_ENTITY }
    public enum DeliveryType { SELF, MELEE, RAY, PROJECTILE, RADIAL, ZONE, TRAP, SUMMON }
    public enum HitboxGeometry { ARC, RECTANGLE }
    /** Public phase vocabulary used by ability authoring and direct effects. */
    public enum PhaseType { SELF, MELEE, RAY, ARC, PROJECTILE, ZONE, SUMMON }
    public enum PhaseEventType { ACTIVATION, COLLISION, INTERVAL, LIFETIME_END, DESTROYED, ENTER, EXIT }
    public enum PhaseAction { APPLY_EFFECTS, TRANSITION, REMOVE, EMIT_VISUAL }
    public enum PersistenceMode { ONCE, EVERY_TICK, INTERVAL }

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
                         String distanceMode, Falloff falloff) {
        public Effect(EffectType type) { this(type, null, 0, 0, false, null, false, false, null, null); }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed) {
            this(type, subtype, amount, durationMs, runtimeComputed, null, false, false, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient, requiresConfirmedDamage, false, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient, requiresConfirmedDamage, mirrorsDamage, null, null);
        }
        public Effect(EffectType type, String subtype, double amount, int durationMs, boolean runtimeComputed,
                      String recipient, boolean requiresConfirmedDamage, boolean mirrorsDamage,
                      String distanceMode) {
            this(type, subtype, amount, durationMs, runtimeComputed, recipient,
                    requiresConfirmedDamage, mirrorsDamage, distanceMode, null);
        }
    }
    public record Movement(String distanceStat, String speedStat,
                           String durationStat, String trailDurationStat) {}
    public record Execution(String targetMode, boolean captureAtActivation,
                             boolean faceTargetFromPayload, String phaseFacingDefault,
                             Movement movement, String blockedByStatus,
                             boolean ignoresGlobalAbilityLock,
                             boolean teleportOncePerActivation) {
        public Execution(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault,
                         Movement movement) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, movement, null, false, false);
        }
        public Execution(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault,
                         Movement movement, String blockedByStatus) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, movement, blockedByStatus, false, false);
        }
        public Execution(String targetMode, boolean captureAtActivation,
                         boolean faceTargetFromPayload, String phaseFacingDefault,
                         Movement movement, String blockedByStatus,
                         boolean ignoresGlobalAbilityLock) {
            this(targetMode, captureAtActivation, faceTargetFromPayload,
                    phaseFacingDefault, movement, blockedByStatus,
                    ignoresGlobalAbilityLock, false);
        }
    }

    /** A phase event is an allowlisted instruction, never executable user code. */
    public record PhaseEvent(List<PhaseAction> actions, Set<EffectType> effectTypes,
                             String transitionPhaseId, String intervalStat,
                             String visualType, String visibleStat,
                             Integer visibleMs, Double visualSize) {
        public PhaseEvent {
            actions = actions == null ? List.of() : List.copyOf(actions);
            effectTypes = effectTypes == null || effectTypes.isEmpty()
                    ? Set.of() : Collections.unmodifiableSet(EnumSet.copyOf(effectTypes));
        }

        public PhaseEvent(List<PhaseAction> actions) {
            this(actions, Set.of(), null, null, null, null, null, null);
        }

        public PhaseEvent(List<PhaseAction> actions, String transitionPhaseId) {
            this(actions, Set.of(), transitionPhaseId, null, null, null, null, null);
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

    /** Canonical phase metadata exposed by every ability contract. */
    public record AbilityPhase(String id, PhaseType type, Map<String, String> hitbox,
                                List<Effect> effects,
                                Map<PhaseEventType, PhaseEvent> events,
                                PersistenceMode persistence, String intervalStat,
                                Integer durationMs, Visual visual,
                                Map<String, Double> statOverrides,
                                Map<String, EffectOverride> effectOverrides) {
        public AbilityPhase {
            hitbox = hitbox == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(hitbox));
            effects = effects == null ? List.of() : List.copyOf(effects);
            events = events == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(events));
            statOverrides = statOverrides == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(statOverrides));
            effectOverrides = effectOverrides == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(effectOverrides));
        }

        public AbilityPhase(String id, PhaseType type, Map<String, String> hitbox,
                            List<Effect> effects, Map<PhaseEventType, PhaseEvent> events,
                            PersistenceMode persistence, String intervalStat,
                            Integer durationMs, Visual visual) {
            this(id, type, hitbox, effects, events, persistence, intervalStat,
                    durationMs, visual, Map.of(), Map.of());
        }

        public AbilityPhase(String id, PhaseType type, Map<String, String> hitbox,
                            List<Effect> effects, Map<PhaseEventType, PhaseEvent> events,
                            PersistenceMode persistence, String intervalStat,
                            Integer durationMs) {
            this(id, type, hitbox, effects, events, persistence, intervalStat,
                    durationMs, null, Map.of(), Map.of());
        }
    }

    public record AbilityContract(DeliveryType delivery, HitboxGeometry hitboxGeometry,
                                  boolean includeTargetRadius,
                                  List<Effect> effects, Execution execution,
                                  List<AbilityPhase> phases) {
        public AbilityContract {
            effects = effects == null ? List.of() : List.copyOf(effects);
            execution = execution == null ? NONE : execution;
            phases = phases == null || phases.isEmpty()
                    ? List.of(defaultPhase(delivery, hitboxGeometry, effects)) : List.copyOf(phases);
        }

        public AbilityContract(DeliveryType delivery, HitboxGeometry hitboxGeometry,
                               boolean includeTargetRadius, List<Effect> effects,
                               Execution execution) {
            this(delivery, hitboxGeometry, includeTargetRadius, effects, execution, List.of());
        }
    }

    private static final Execution NONE = new Execution(null, false, false, null, null);

    private static final Map<Integer, AbilityContract> CATALOG = Map.ofEntries(
            entry(1, DeliveryType.MELEE, true, effect(EffectType.DAMAGE, 20)),
            entry(3, DeliveryType.RAY,
                    execution(null, true, false, null, null),
                    computed(EffectType.DAMAGE, Abilities.definition(3).falloff())),
            entry(4, DeliveryType.PROJECTILE,
                    computed(EffectType.DAMAGE, Abilities.definition(4).falloff()), spawn("grenade")),
            entry(5, DeliveryType.PROJECTILE, effect(EffectType.DAMAGE, 15), status("burn", 2, Abilities.statusDurationMs(5, "burn", 5000)), spawn("fireball")),
            entry(6, DeliveryType.MELEE, HitboxGeometry.RECTANGLE, true, NONE,
                    effect(EffectType.DAMAGE, 10), status("stun", 0, Abilities.statusDurationMs(6, "stun", 1200))),
            entry(7, DeliveryType.MELEE, true, effect(EffectType.DAMAGE, 30), status("bleed", 2, Abilities.statusDurationMs(7, "bleed", 5000))),
            entry(8, DeliveryType.RADIAL, true, effect(EffectType.DAMAGE, 20), effect(EffectType.KNOCKBACK, 250)),
            entry(9, DeliveryType.RAY, effect(EffectType.DAMAGE, 20), status("slow", 0, Abilities.statusDurationMs(9, "slow", 1000))),
            entry(10, DeliveryType.SELF, effect(EffectType.HEALING, 25)),
            entry(11, DeliveryType.TRAP, effect(EffectType.DAMAGE, 25), spawn("proximity_mine")),
            entry(12, DeliveryType.RAY,
                    computed(EffectType.DAMAGE, Abilities.definition(12).falloff())),
            entry(13, DeliveryType.RAY, effect(EffectType.DAMAGE, 40), status("shock", 3, Abilities.statusDurationMs(13, "shock", 3000))),
            entry(14, DeliveryType.PROJECTILE,
                    effect(EffectType.PULL, Abilities.stat(14, "pullPerTick", 6)),
                    computed(EffectType.DAMAGE, Abilities.definition(14).falloff()), spawn("gravity_zone")),
            entry(15, DeliveryType.PROJECTILE, status("silence", 0, Abilities.statusDurationMs(15, "silence", 2000)), timed(EffectType.INTERRUPT, 100), spawn("silence_wave")),
            entry(16, DeliveryType.SELF,
                    timed(EffectType.DAMAGE_REDUCTION, .5, Abilities.statusDurationMs(16, "damage_reduction", 4000)),
                    timed(EffectType.DAMAGE_REFLECTION, .5, Abilities.statusDurationMs(16, "damage_reflection", 4000))),
            entry(17, DeliveryType.SUMMON, effect(EffectType.DAMAGE, 5), spawn("hunter_drone")),
            entry(18, DeliveryType.PROJECTILE, effect(EffectType.DAMAGE, Abilities.definition(18).damage()),
                    effect(EffectType.KNOCKBACK, Abilities.stat(18, "knockback", 0)), spawn("windburst_projectile")),
            entry(19, DeliveryType.SELF, execution("slow", new Movement("distance", "speed", "activeMs", "trailMs")), effect(EffectType.MOVEMENT, 150)),
            entry(20, DeliveryType.SELF, execution("target", false, true, null, null)),
            entry(21, DeliveryType.SELF, timed(EffectType.RESTORE_STATE, 3000), spawn("temporal_rewind_zone")),
            entry(22, DeliveryType.ZONE, effect(EffectType.DAMAGE, 15), spawn("orbital_zone")),
            entry(23, DeliveryType.SELF, timed(EffectType.DAMAGE_IMMUNITY, 1, Abilities.statusDurationMs(23, "damage_immunity", 1500))),
            entry(24, DeliveryType.ZONE, status("silence", 0, 0), spawn("null_zone")),
            entry(25, DeliveryType.MELEE, HitboxGeometry.RECTANGLE, true,
                    execution(null, true, false, "0", null, true),
                    teleportByCenterDistance(), effect(EffectType.DAMAGE, 15)),
            entry(26, DeliveryType.RADIAL, true,
                    effect(EffectType.DAMAGE, 15), status("slow", 0, Abilities.statusDurationMs(26, "slow", 1_500)), effect(EffectType.KNOCKBACK, 60)),
            entry(27, DeliveryType.ZONE,
                    effect(EffectType.PULL, Abilities.stat(27, "pullPerTick", 10)),
                    computed(EffectType.DAMAGE, Abilities.definition(27).falloff()), spawn("singularity_zone")),
            entry(28, DeliveryType.PROJECTILE,
                    effect(EffectType.DAMAGE, 10), effect(EffectType.PULL, Abilities.stat(28, "pullPerTick", 100)), status("slow", 0, Abilities.statusDurationMs(28, "slow", 1_200)),
                    spawn("tether_bolt")),
            entry(29, DeliveryType.TRAP,
                    effect(EffectType.DAMAGE, Abilities.definition(29).damage()),
                    status("slow", 0, Abilities.statusDurationMs(29, "slow", 2_200)), timed(EffectType.INTERRUPT, 150), spawn("static_snare")),
            entry(30, DeliveryType.RAY,
                    effect(EffectType.DAMAGE, 15), timed(EffectType.INTERRUPT, 250), status("slow", 0, Abilities.statusDurationMs(30, "slow", 2_000))),
            entry(31, DeliveryType.SUMMON,
                    effect(EffectType.DAMAGE, 3), effect(EffectType.KNOCKBACK, 40), spawn("repeller_drone")),
            entry(32, DeliveryType.RAY,
                    computed(EffectType.DAMAGE, Abilities.definition(32).falloff()), lifesteal("source")),
            entry(33, DeliveryType.SELF,
                    buff("overclock", .5, Abilities.statusDurationMs(33, "overclock", 4_000))),
            entry(34, DeliveryType.MELEE, true,
                    effect(EffectType.DAMAGE, 8))
    );
    private static final Set<Integer> ACTIONS = CATALOG.keySet();

    public static AbilityContract get(int abilityId) {
        AbilityContract contract = CATALOG.get(abilityId);
        if (contract == null) throw new IllegalArgumentException("Unknown ability contract: " + abilityId);
        return contract;
    }
    public static Map<Integer, AbilityContract> all() { return CATALOG; }
    public static Set<Integer> actions() { return ACTIONS; }

    private static AbilityPhase defaultPhase(DeliveryType delivery, HitboxGeometry geometry,
                                             List<Effect> effects) {
        PhaseType type = switch (delivery) {
            case SELF -> PhaseType.SELF;
            case MELEE -> PhaseType.MELEE;
            case RAY -> PhaseType.RAY;
            case PROJECTILE -> PhaseType.PROJECTILE;
            case RADIAL, ZONE, TRAP -> PhaseType.ZONE;
            case SUMMON -> PhaseType.SUMMON;
        };
        Map<String, String> hitbox = new LinkedHashMap<>();
        switch (type) {
            case RAY -> {
                hitbox.put("shape", "ray");
                hitbox.put("range", "range");
                hitbox.put("width", "hitboxWidth");
            }
            case PROJECTILE -> {
                hitbox.put("shape", "rectangle");
                hitbox.put("width", "hitboxWidth");
                hitbox.put("length", "hitboxLength");
            }
            case MELEE -> {
                hitbox.put("shape", geometry == HitboxGeometry.RECTANGLE ? "rectangle" : "arc");
                hitbox.put("range", "range");
                hitbox.put(geometry == HitboxGeometry.RECTANGLE ? "width" : "arc",
                        geometry == HitboxGeometry.RECTANGLE ? "hitboxWidth" : "arc");
            }
            case ARC -> {
                hitbox.put("shape", "arc");
                hitbox.put("range", "range");
                hitbox.put("arc", "arc");
            }
            case ZONE -> {
                hitbox.put("shape", "circle");
                hitbox.put("radius", "radius");
            }
            default -> { }
        }
        EnumSet<EffectType> phaseEffects = EnumSet.noneOf(EffectType.class);
        for (Effect effect : effects) {
            if (effect.type() != EffectType.SPAWN_ENTITY) phaseEffects.add(effect.type());
        }
        List<Effect> resolvedEffects = effects.stream()
                .filter(effect -> effect.type() != EffectType.SPAWN_ENTITY).toList();
        Map<PhaseEventType, PhaseEvent> events = new LinkedHashMap<>();
        if (!resolvedEffects.isEmpty()) {
            PhaseEventType eventType = type == PhaseType.SELF
                    ? PhaseEventType.ACTIVATION : PhaseEventType.COLLISION;
            events.put(eventType,
                    new PhaseEvent(List.of(PhaseAction.APPLY_EFFECTS), phaseEffects,
                            null, null, null, null, null, null));
        }
        return new AbilityPhase("active", type, hitbox, resolvedEffects, events,
                PersistenceMode.ONCE, null, null);
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
        return get(abilityId).effects().stream()
                .filter(effect -> effect.type() == type)
                .findFirst()
                .map(Effect::amount)
                .orElse(0.0);
    }

    public static int effectDurationMs(int abilityId, String subtype) {
        return get(abilityId).effects().stream()
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
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              Effect... effects) {
        return entry(id, delivery, false, NONE, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              boolean includeTargetRadius,
                                                              Effect... effects) {
        return entry(id, delivery, includeTargetRadius, NONE, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              Execution execution,
                                                              Effect... effects) {
        return entry(id, delivery, false, execution, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              HitboxGeometry hitboxGeometry,
                                                              Execution execution,
                                                              Effect... effects) {
        return entry(id, delivery, hitboxGeometry, false, execution, effects);
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              HitboxGeometry hitboxGeometry,
                                                              boolean includeTargetRadius,
                                                              Execution execution,
                                                              Effect... effects) {
        return Map.entry(id, new AbilityContract(delivery, hitboxGeometry, includeTargetRadius,
                List.of(effects), execution));
    }
    private static Map.Entry<Integer, AbilityContract> entry(int id, DeliveryType delivery,
                                                              boolean includeTargetRadius,
                                                              Execution execution,
                                                              Effect... effects) {
        return Map.entry(id, new AbilityContract(delivery, HitboxGeometry.ARC, includeTargetRadius,
                List.of(effects), execution));
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
    private static Execution execution(String targetMode, boolean captureAtActivation,
                                       boolean faceTargetFromPayload, String phaseFacingDefault,
                                       Movement movement, boolean teleportOncePerActivation) {
        return new Execution(targetMode, captureAtActivation, faceTargetFromPayload,
                phaseFacingDefault, movement, null, false, teleportOncePerActivation);
    }
    private static Effect effect(EffectType type) { return new Effect(type); }
    private static Effect effect(EffectType type, double amount) { return new Effect(type, null, amount, 0, false); }
    private static Effect teleportByCenterDistance() {
        return new Effect(EffectType.TELEPORT, null, 0, 0, false, null, false, false, "center_distance");
    }
    private static Effect timed(EffectType type, int durationMs) { return new Effect(type, null, 0, durationMs, false); }
    private static Effect timed(EffectType type, double amount, int durationMs) { return new Effect(type, null, amount, durationMs, false); }
    private static Effect computed(EffectType type) { return new Effect(type, null, 0, 0, true); }
    private static Effect computed(EffectType type, Falloff falloff) {
        return new Effect(type, null, 0, 0, true, null, false, false, null, falloff);
    }
    private static Effect status(String subtype, double amount, int durationMs) { return new Effect(EffectType.STATUS, subtype, amount, durationMs, false); }
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
