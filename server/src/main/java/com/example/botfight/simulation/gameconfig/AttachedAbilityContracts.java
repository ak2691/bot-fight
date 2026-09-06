package com.example.botfight.simulation.gameconfig;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;

/** Gameplay-only ability metadata shared by authoritative combat resolvers. */
public final class AttachedAbilityContracts {
    private AttachedAbilityContracts() {}

    public enum EffectType { DAMAGE, HEALING, KNOCKBACK, PULL, STATUS, BUFF, INTERRUPT, TELEPORT,
        RESTORE_STATE, DAMAGE_REDUCTION, DAMAGE_IMMUNITY, DAMAGE_REFLECTION }
    /** Public phase vocabulary used by ability authoring and direct effects. */
    public enum PhaseType { SELF, MELEE, RAY, ARC, PROJECTILE, ZONE, SUMMON, BOT_ATTACHED }
    public enum PhaseEventType { ACTIVATION, COLLISION, INTERVAL, LIFETIME_END, DESTROYED, ENTER, EXIT }
    public enum PhaseAction { APPLY_EFFECTS, TRANSITION, REMOVE, EMIT_VISUAL }
    public enum TargetPolicyMode { ONCE, EVERY_TICK, INTERVAL }

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
                          boolean chain, boolean requiresDestruction) {
        public Trigger(Double radius, Integer lifetimeMs, boolean attackHits,
                       boolean projectileOverlap, boolean botContact, boolean chain) {
            this(radius, lifetimeMs, attackHits, projectileOverlap, botContact, chain, false);
        }
    }

    public record Repeat(PhaseEventType event, String interval, Integer intervalMs,
                         boolean startImmediately) {
        public Repeat(PhaseEventType event, String interval) {
            this(event, interval, null, true);
        }
    }

    public record Hit(HitMode mode, boolean removeOnHit, boolean oncePerTarget,
                      String knockbackDirection) {}

    public record Attack(Double range, String cooldownField, Integer cooldownMs,
                         String visualField, Integer visualMs,
                         Set<EffectType> effectTypes) {
        public Attack {
            effectTypes = immutableEffects(effectTypes);
        }
    }

    public enum HitMode { ALL, NEAREST }

    public record PhaseEvent(List<PhaseAction> actions, Set<EffectType> effectTypes,
                             Transition transition, Integer intervalMs,
                             String visualType,
                             Integer visibleMs, Double visualSize,
                             TargetPolicy targetPolicy) {
        public PhaseEvent {
            actions = actions == null ? List.of() : List.copyOf(actions);
            effectTypes = effectTypes == null || effectTypes.isEmpty()
                    ? Set.of() : Collections.unmodifiableSet(EnumSet.copyOf(effectTypes));
        }

        public PhaseEvent(List<PhaseAction> actions) {
            this(actions, Set.of(), null, null, null, null, null, null);
        }

        public PhaseEvent(List<PhaseAction> actions, Transition transition) {
            this(actions, Set.of(), transition, null, null, null, null, null);
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
                               Trigger trigger, Hitbox hitbox, List<Effect> effects,
                               Visual visual, Map<PhaseEventType, PhaseEvent> events,
                               Integer durationMs, Repeat repeat, boolean transitionOnly,
                               boolean skipOwner, Hit hit, Integer visibleMs,
                               Attack attack, Map<String, Double> statOverrides,
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
            this(id, type, null, null, hitbox, effects, visual, events, durationMs,
                    null, false, false, null, visual == null ? null : visual.visibleMs(),
                    null, Map.of(), Map.of(), 0);
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
            this(id, type, movement, null, hitbox, effects, visual, events, durationMs,
                    null, false, false, null, null, null, Map.of(), Map.of(), 0);
        }

        public AbilityPhase(String id, PhaseType type, Hitbox hitbox,
                            List<Effect> effects, Map<PhaseEventType, PhaseEvent> events,
                            Integer durationMs) {
            this(id, type, hitbox, effects, events, durationMs, null);
        }

        /** The effect types are derived from the concrete payloads for compatibility. */
        public Set<EffectType> effectTypes() {
            if (effects.isEmpty()) return Set.of();
            EnumSet<EffectType> types = EnumSet.noneOf(EffectType.class);
            effects.stream().map(Effect::type).filter(type -> type != null).forEach(types::add);
            return Collections.unmodifiableSet(types);
        }
    }

    public record AttachedAbilityContract(Activation activation, List<AbilityPhase> phases) {
        public AttachedAbilityContract {
            activation = activation == null ? NONE : activation;
            phases = phases == null ? List.of() : List.copyOf(phases);
        }
    }

    private static final Activation NONE = new Activation(null, false, false, null, false, false);

    private static final Map<Integer, AttachedAbilityContract> CATALOG = Map.ofEntries(
            entry(1, collisionPhase(1, directHitbox(1, true),
                    List.of(effect(EffectType.DAMAGE, 20)), directVisual(1))),
            entry(3, new Activation(null, true, false, null, false, false),
                    collisionPhase(3, directHitbox(3, false),
                            List.of(computed(EffectType.DAMAGE,
                                    new Falloff(5.0, 15.0, null, null, 100.0, 700.0))), directVisual(3))),
            entry(6, collisionPhase(6, directHitbox(6, true),
                    List.of(effect(EffectType.DAMAGE, 10), status("stun", 0, 1200)), directVisual(6))),
            entry(7, collisionPhase(7, directHitbox(7, true),
                    List.of(effect(EffectType.DAMAGE, 30), status("bleed", 2, 5000, 1000, null)), directVisual(7))),
            entry(8, collisionPhase(8, directHitbox(8, true),
                    List.of(effect(EffectType.DAMAGE, 20), effect(EffectType.KNOCKBACK, 250)), directVisual(8))),
            entry(9, collisionPhase(9, directHitbox(9, false),
                    List.of(effect(EffectType.DAMAGE, 20), status("slow", 0, 1000)), directVisual(9))),
            entry(10, activationPhase(10, null,
                    List.of(effect(EffectType.HEALING, 25)), directVisual(10))),
            entry(12, collisionPhase(12, directHitbox(12, false),
                    List.of(computed(EffectType.DAMAGE,
                            new Falloff(4.0, 8.0, null, null, 0.0, 333.33))), directVisual(12))),
            entry(13, collisionPhase(13, directHitbox(13, false),
                    List.of(effect(EffectType.DAMAGE, 40), status("shock", 3, 3000, 1000, 300)), directVisual(13))),
            entry(16, activationPhase(16, null,
                    List.of(timed(EffectType.DAMAGE_REDUCTION, .5, 4000),
                            timed(EffectType.DAMAGE_REFLECTION, .5, 4000)), directVisual(16))),
            entry(19, activationPhase(19, null, List.of(), directVisual(19))),
            entry(20, new Activation("target", false, true, null, false, false),
                    attachedPhase(20, null, List.of(), null, directVisual(20))),
            entry(23, activationPhase(23, null,
                    List.of(timed(EffectType.DAMAGE_IMMUNITY, 1, 1500)), directVisual(23))),
            entry(25, new Activation(null, true, false, "0", false, true),
                    collisionPhase(25, directHitbox(25, true),
                            List.of(teleportByCenterDistance(), effect(EffectType.DAMAGE, 15)), directVisual(25))),
            entry(26, collisionPhase(26, directHitbox(26, true),
                    List.of(effect(EffectType.DAMAGE, 15), status("slow", 0, 1_500),
                            effect(EffectType.KNOCKBACK, 60)), directVisual(26))),
            entry(30, collisionPhase(30, directHitbox(30, false),
                    List.of(effect(EffectType.DAMAGE, 15), timed(EffectType.INTERRUPT, 250),
                            status("slow", 0, 2_000)), directVisual(30))),
            entry(32, collisionPhase(32, directHitbox(32, false),
                    List.of(computed(EffectType.DAMAGE,
                                    new Falloff(15.0, 25.0, null, null, 0.0, 500.0)),
                            lifesteal("source")), directVisual(32))),
            entry(33, activationPhase(33, null,
                    List.of(buff("overclock", .5, 4_000)), directVisual(33))),
            entry(34, collisionPhase(34, directHitbox(34, true),
                    List.of(effect(EffectType.DAMAGE, 8)), directVisual(34)))
    );
    /** Action IDs come from the identity registry, not from one contract family. */
    private static final Set<Integer> ACTIONS = Set.copyOf(AbilityRegistry.all().keySet());

    public static AttachedAbilityContract get(int abilityId) {
        AttachedAbilityContract contract = CATALOG.get(abilityId);
        if (contract == null) throw new IllegalArgumentException("Unknown attached ability contract: " + abilityId);
        return contract;
    }
    public static Map<Integer, AttachedAbilityContract> all() { return CATALOG; }
    public static Set<Integer> actions() { return ACTIONS; }

    public static boolean isAttachedAbility(int abilityId) { return CATALOG.containsKey(abilityId); }

    public static AttachedAbilityContract forAbility(int abilityId) { return CATALOG.get(abilityId); }

    public static Activation activationFor(int abilityId) {
        AttachedAbilityContract contract = CATALOG.get(abilityId);
        return contract == null ? NONE : contract.activation();
    }

    public static boolean targetsOwner(int abilityId) {
        AttachedAbilityContract contract = CATALOG.get(abilityId);
        return contract != null && !contract.phases().isEmpty()
                && contract.phases().getFirst().events().containsKey(PhaseEventType.ACTIVATION);
    }

    private static AbilityPhase attachedPhase(int id, Hitbox hitbox, List<Effect> effects,
                                              PhaseEventType eventType, Visual visual) {
        return new AbilityPhase("active", PhaseType.BOT_ATTACHED, directMovement(id), hitbox,
                effects, eventType == null ? Map.of() : Map.of(eventType, effectEvent(effects)),
                null, visual);
    }

    private static AbilityPhase collisionPhase(int id, Hitbox hitbox, List<Effect> effects,
                                               Visual visual) {
        return attachedPhase(id, hitbox, effects, PhaseEventType.COLLISION, visual);
    }

    private static AbilityPhase activationPhase(int id, Hitbox hitbox, List<Effect> effects,
                                                Visual visual) {
        return attachedPhase(id, hitbox, effects, PhaseEventType.ACTIVATION, visual);
    }

    private static PhaseEvent effectEvent(List<Effect> effects) {
        EnumSet<EffectType> phaseEffects = EnumSet.noneOf(EffectType.class);
        for (Effect effect : effects) phaseEffects.add(effect.type());
        return new PhaseEvent(List.of(PhaseAction.APPLY_EFFECTS), phaseEffects,
                null, null, null, null, null, null);
    }

    private static PhaseMovement directMovement(int id) {
        return id == 19 ? new PhaseMovement(75, 150.0, 300, "slow") : null;
    }

    private static Visual directVisual(int id) {
        return switch (id) {
            case 1 -> new Visual("meleeSlash", 207, 400);
            case 3 -> new Visual("gun", 16, 500);
            case 6 -> new Visual("stun", 60, 100);
            case 7 -> new Visual("heavySlash", 220.8, 400);
            case 8 -> new Visual("repulsorBurst", 220, 500);
            case 9 -> new Visual("concussiveShot", 76, 300);
            case 10 -> new Visual("basicHeal", 12, 300);
            case 12 -> new Visual("pistol", 14, 300);
            case 13 -> new Visual("railShot", 100, 300);
            case 16 -> new Visual("reactiveArmor", 80, 300);
            case 19 -> new Visual("dash", 114, 300);
            case 20 -> new Visual("lockOn", 48, 200);
            case 23 -> new Visual("absoluteGuard", 80, 300);
            case 25 -> new Visual("phaseStrike", 100, 300);
            case 26 -> new Visual("frostRing", 240, 300);
            case 30 -> new Visual("disruptorDart", 8, 300);
            case 32 -> new Visual("vampiricBeam", 10, 300);
            case 33 -> new Visual("overclock", 80, 300);
            case 34 -> new Visual("basicStrike", 80, 200);
            default -> null;
        };
    }

    private static Hitbox directHitbox(int id, boolean includeTargetRadius) {
        return switch (id) {
            case 1 -> new Hitbox("arc", null, 92.0, 120.0, 1.0, null, null, true);
            case 3 -> new Hitbox("ray", null, 700.0, null, 1.0, 5.0, null, false);
            case 6 -> new Hitbox("rectangle", null, null, null, 1.0, 80.0, 184.0, true);
            case 7 -> new Hitbox("arc", null, 115.0, 150.0, 1.0, null, null, true);
            case 8 -> new Hitbox("circle", 110.0, null, null, 1.0, null, null, true);
            case 9 -> new Hitbox("ray", null, 500.0, null, 1.0, 5.0, null, false);
            case 12 -> new Hitbox("ray", null, 500.0, null, 1.0, 5.0, null, false);
            case 13 -> new Hitbox("ray", null, 900.0, null, 1.0, 5.0, null, false);
            case 25 -> new Hitbox("rectangle", null, null, null, 1.0, 60.0, 100.0, true);
            case 26 -> new Hitbox("circle", 120.0, null, null, 1.0, null, null, true);
            case 30 -> new Hitbox("ray", null, 600.0, null, 1.0, 8.0, null, false);
            case 32 -> new Hitbox("ray", null, 500.0, null, 1.0, 10.0, null, false);
            case 34 -> new Hitbox("arc", null, 80.0, 30.0, 1.0, null, null, true);
            default -> new Hitbox(null, null, null, null, 1.0, null, null,
                    includeTargetRadius);
        };
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
    private static Map.Entry<Integer, AttachedAbilityContract> entry(int id, AbilityPhase phase) {
        return entry(id, NONE, phase);
    }

    private static Map.Entry<Integer, AttachedAbilityContract> entry(
            int id, Activation activation, AbilityPhase phase) {
        return Map.entry(id, new AttachedAbilityContract(activation, List.of(phase)));
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
}
