package com.example.botfight.simulation.gameconfig;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;

/** Authoritative timing/resource definitions plus a derived compatibility view. */
public final class Abilities {
    private Abilities() {}

    public enum ResourceModel { NONE, RELOAD_WHEN_EMPTY }
    public enum FalloffMode { CONTINUOUS }

    // Only ability-level timing and resource values are authored here (shared/gameplay/abilities.json). Damage,
    // geometry, movement, effects, and visuals are owned by phase contracts.
    private static final Map<Integer, TimingDefinition> TIMING_CATALOG = timingCatalog();

    private static Map<Integer, TimingDefinition> timingCatalog() {
        Map<Integer, TimingDefinition> catalog = new LinkedHashMap<>();
        for (GameplayData.AbilityData ability : GameplayData.get().abilities().abilities()) {
            GameplayData.TimingData timing = ability.timing();
            catalog.put(ability.id(), new TimingDefinition(
                    orZero(timing.cooldownMs()), orZero(timing.windupMs()), orZero(timing.activeMs()),
                    orZero(timing.durationMs()), orZero(timing.maxCharges()), orZero(timing.reloadMs()), 0,
                    "reload".equals(timing.resourceModel()) ? ResourceModel.RELOAD_WHEN_EMPTY : ResourceModel.NONE));
        }
        return Collections.unmodifiableMap(catalog);
    }

    private static int orZero(Integer value) {
        return value == null ? 0 : value;
    }

    /** Compatibility view assembled from timing metadata and phase contracts. */
    public static final Map<Integer, AbilityDefinition> CATALOG = buildCatalog();

    private static Map<Integer, AbilityDefinition> buildCatalog() {
        Map<Integer, AbilityDefinition> catalog = new LinkedHashMap<>();
        TIMING_CATALOG.forEach((id, timing) -> {
            PhaseProjection projection = phaseProjection(id, timing);
            catalog.put(id, new AbilityDefinition(
                    timing.cooldownMs(), timing.windupMs(), timing.activeMs(), timing.durationMs(),
                    (int) Math.round(projection.damage()), projection.range(), projection.arc(), timing.charges(),
                    timing.rechargeMs(), timing.reuseCooldownMs(), timing.resourceModel(),
                    FalloffMode.CONTINUOUS, projection.falloff(), projection.damageOverTime(),
                    projection.stats()));
        });
        return Collections.unmodifiableMap(catalog);
    }

    private static PhaseProjection phaseProjection(int id, TimingDefinition timing) {
        AbilityContracts.AbilityContract contract = AbilityContracts.forAbility(id);
        AbilityContracts.EntityContract entity = AbilityContracts.entityContractForAbility(id);
        AbilityContracts.MoveVerb moveVerb = contract == null ? null : contract.onTrigger().stream()
                .filter(AbilityContracts.MoveVerb.class::isInstance)
                .map(AbilityContracts.MoveVerb.class::cast).findFirst().orElse(null);
        // The read model the stats are projected from: an entity's phases, or for any other ability one phase
        // built from its trigger verbs. A summon's shot is a phase of its own.
        List<AbilityContracts.AbilityPhase> phases = entity != null && !entity.phases().isEmpty()
                ? entity.phases()
                : contract == null ? List.of() : List.of(triggerPhase(contract, moveVerb));
        List<AbilityContracts.AbilityPhase> embeddedPhases = entity == null ? List.of()
                : entity.phases().stream()
                        .map(AbilityContracts.AbilityPhase::scheduledHit)
                        .filter(java.util.Objects::nonNull)
                        .map(Abilities::shotPhase)
                        .toList();
        List<AbilityContracts.AbilityPhase> behaviorPhases = Stream.concat(
                phases.stream(), embeddedPhases.stream()).toList();
        // Trigger-time effects (Rewind's restore) join the effects of the entity's phases.
        List<AbilityContracts.Effect> effects = Stream.concat(
                        contract == null ? Stream.<AbilityContracts.Effect>empty() : contract.triggerEffects().stream(),
                        behaviorPhases.stream().flatMap(phase -> phase.effects().stream()))
                .distinct()
                .toList();
        AbilityContracts.AbilityPhase behaviorPhase = behaviorPhases.stream()
                .filter(phase -> phase.effects().stream()
                        .anyMatch(effect -> effect.type() == AbilityContracts.EffectType.DAMAGE))
                .findFirst()
                .orElseGet(() -> behaviorPhases.stream()
                        .filter(phase -> !phase.effects().isEmpty())
                        .findFirst()
                        .orElse(behaviorPhases.isEmpty() ? null : behaviorPhases.getFirst()));
        AbilityContracts.AbilityPhase movementPhase = phases.stream()
                .filter(phase -> phase.movement() != null && phase.movement().speed() > 0)
                .findFirst()
                .orElseGet(() -> phases.stream()
                        .filter(phase -> phase.movement() != null)
                        .findFirst()
                        .orElse(null));
        AbilityContracts.AbilityPhase visualPhase = phases.stream()
                .filter(phase -> phase.visual() != null)
                .findFirst()
                .orElse(null);
        AbilityContracts.Hitbox hitbox = behaviorPhase == null ? null : behaviorPhase.hitbox();
        if (hitbox == null) {
            hitbox = phases.stream().map(AbilityContracts.AbilityPhase::hitbox)
                    .filter(value -> value != null).findFirst().orElse(null);
        }
        AbilityContracts.PhaseMovement movement = movementPhase == null ? null : movementPhase.movement();
        boolean movingProjectile = entity != null
                && entity.category() == AbilityContracts.Category.PROJECTILE
                && movementPhase != null
                && behaviorPhase != null
                && movementPhase.id().equals(behaviorPhase.id());
        Integer movingPhaseDuration = movementPhase == null ? null : movementPhase.durationMs();
        Double movingRange = movingProjectile
                && (movingPhaseDuration == null ? timing.durationMs() : movingPhaseDuration) > 0
                && movement != null && movement.speed() > 0
                ? movement.speed() * (movingPhaseDuration == null
                        ? timing.durationMs() : movingPhaseDuration) / 100.0 : null;
        double range = movingRange != null ? movingRange : hitboxValue(hitbox, "range");
        double arc = hitbox == null || hitbox.arc() == null ? 0 : hitbox.arc();
        Map<String, Double> stats = new LinkedHashMap<>();
        if (range > 0) stats.put("range", range);
        if (hitbox != null && hitbox.radius() != null) stats.put("radius", hitbox.radius());
        if (hitbox != null && hitbox.width() != null) stats.put("hitboxWidth", hitbox.width());
        if (hitbox != null && hitbox.length() != null) stats.put("hitboxLength", hitbox.length());
        if (movement != null) stats.put("speed", movement.speed());
        if (moveVerb != null) {
            stats.put("distance", moveVerb.distance());
            stats.put("trailMs", (double) moveVerb.trailMs());
        }
        if (visualPhase != null && visualPhase.visual() != null) {
            stats.put("visualSize", visualPhase.visual().visualSize());
        }
        Integer visibleMs = phases.stream()
                .map(AbilityContracts.AbilityPhase::visual)
                .filter(value -> value != null && value.visibleMs() != null)
                .map(AbilityContracts.Visual::visibleMs)
                .findFirst().orElse(null);
        Integer eventVisibleMs = phases.stream()
                .flatMap(phase -> phase.on().values().stream())
                .flatMap(event -> event.verbs().stream())
                .filter(AbilityContracts.EmitVisualVerb.class::isInstance)
                .map(verb -> ((AbilityContracts.EmitVisualVerb) verb).visibleMs())
                .filter(value -> value != null)
                .findFirst().orElse(null);
        if (visibleMs == null) visibleMs = eventVisibleMs;
        if (visibleMs != null) stats.put("visibleMs", visibleMs.doubleValue());
        AbilityContracts.PhaseEvent repeatedEvent = phases.stream()
                .flatMap(phase -> phase.on().values().stream())
                .filter(event -> event.schedule() != null
                        && event.schedule().mode() == AbilityContracts.EventScheduleMode.REPEAT)
                .findFirst().orElse(null);
        Integer intervalMs = repeatedEvent == null ? null : repeatedEvent.schedule().intervalMs();
        if (intervalMs != null) stats.put("intervalMs", intervalMs.doubleValue());
        Integer shotVisibleMs = entity == null ? null : entity.phases().stream()
                .map(AbilityContracts.AbilityPhase::scheduledHit)
                .filter(hit -> hit != null && hit.visual() != null && hit.visual().visibleMs() != null)
                .map(hit -> hit.visual().visibleMs())
                .findFirst().orElse(null);
        if (shotVisibleMs != null) stats.put("shotVisualMs", shotVisibleMs.doubleValue());
        if (entity != null && !entity.phases().isEmpty()) {
            AbilityContracts.AbilityPhase firstPhase = entity.phases().getFirst();
            stats.put("size", phaseSize(firstPhase));
            AbilityContracts.Health health = entity.phases().stream()
                    .map(AbilityContracts.AbilityPhase::health)
                    .filter(java.util.Objects::nonNull)
                    .findFirst().orElse(null);
            if (health != null) stats.put("hp", health.hp());
        }
        AbilityContracts.Effect damage = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.DAMAGE)
                .findFirst().orElse(null);
        AbilityContracts.Effect healing = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.HEALING)
                .findFirst().orElse(null);
        AbilityContracts.Effect knockback = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.KNOCKBACK)
                .findFirst().orElse(null);
        AbilityContracts.Effect pull = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.PULL)
                .findFirst().orElse(null);
        AbilityContracts.Effect interrupt = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.INTERRUPT)
                .findFirst().orElse(null);
        AbilityContracts.Effect restore = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.RESTORE_STATE)
                .findFirst().orElse(null);
        if (healing != null && !healing.mirrorsDamage()) stats.put("healing", healing.amount());
        if (knockback != null) stats.put("knockback", knockback.amount());
        if (pull != null) stats.put("pullPerTick", pull.amount());
        if (interrupt != null) stats.put("interruptMs", (double) interrupt.durationMs());
        if (restore != null) stats.put("delayMs", (double) restore.durationMs());
        AbilityContracts.Effect overclock = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.BUFF
                        && "overclock".equals(effect.subtype()))
                .findFirst().orElse(null);
        if (overclock != null) {
            stats.put("cooldownRecoveryPercent", overclock.amount() * 100);
            stats.put("cooldownRecoveryMultiplier", 1 - overclock.amount());
        }
        AbilityContracts.Effect statusWithMovementLock = effects.stream()
                .filter(effect -> effect.movementLockMs() != null)
                .findFirst().orElse(null);
        if (statusWithMovementLock != null) {
            stats.put("movementLockMs", statusWithMovementLock.movementLockMs().doubleValue());
        }
        DamageOverTime damageOverTime = effects.stream()
                .filter(effect -> effect.type() == AbilityContracts.EffectType.STATUS
                        && "burn".equals(effect.subtype()))
                .findFirst()
                .map(effect -> new DamageOverTime((int) Math.round(effect.amount())))
                .orElse(null);
        return new PhaseProjection(
                damage == null ? 0 : damage.amount(), range, arc,
                damage == null ? null : damage.falloff(), damageOverTime, stats);
    }

    /** One phase standing for an ability that spawns nothing: its first hitbox, its effects, its move and visual. */
    private static AbilityContracts.AbilityPhase triggerPhase(AbilityContracts.AbilityContract contract,
                                                              AbilityContracts.MoveVerb moveVerb) {
        AbilityContracts.HitVerb hit = contract.hitVerbs().isEmpty() ? null : contract.hitVerbs().getFirst();
        AbilityContracts.Visual visual = contract.onTrigger().stream()
                .map(Abilities::verbVisual).filter(java.util.Objects::nonNull).findFirst().orElse(null);
        java.util.Map<AbilityContracts.PhaseEventType, AbilityContracts.PhaseEvent> events = new LinkedHashMap<>();
        events.put(AbilityContracts.PhaseEventType.COLLISION, new AbilityContracts.PhaseEvent(List.of(
                new AbilityContracts.ApplyEffectsVerb(false, contract.triggerEffects(), null, null, null))));
        return new AbilityContracts.AbilityPhase("active", AbilityContracts.PhaseType.ZONE,
                moveVerb == null ? null : new AbilityContracts.PhaseMovement(moveVerb.unitsPerTick()),
                hit == null ? null : hit.hitbox(), visual, events, null);
    }

    /** A summon's shot as a phase: its hitbox and effects, with the shot's visual. */
    private static AbilityContracts.AbilityPhase shotPhase(AbilityContracts.HitVerb shot) {
        java.util.Map<AbilityContracts.PhaseEventType, AbilityContracts.PhaseEvent> events = new LinkedHashMap<>();
        events.put(AbilityContracts.PhaseEventType.COLLISION, new AbilityContracts.PhaseEvent(List.of(
                new AbilityContracts.ApplyEffectsVerb(false, shot.effects(), null, null, null))));
        return new AbilityContracts.AbilityPhase("shot", AbilityContracts.PhaseType.ZONE, null,
                shot.hitbox(), shot.visual(), events, null);
    }

    private static AbilityContracts.Visual verbVisual(AbilityContracts.Verb verb) {
        return switch (verb) {
            case AbilityContracts.HitVerb hit -> hit.visual();
            case AbilityContracts.ApplyEffectsVerb apply -> apply.visual();
            case AbilityContracts.MoveVerb move -> move.visual();
            case AbilityContracts.FaceVerb face -> face.visual();
            default -> null;
        };
    }

    private static double phaseSize(AbilityContracts.AbilityPhase phase) {
        if (phase == null) return 0;
        if (phase.visual() != null && phase.visual().visualSize() > 0) {
            return phase.visual().visualSize();
        }
        AbilityContracts.Hitbox hitbox = phase.hitbox();
        if (hitbox == null) return 0;
        if ("circle".equals(hitbox.shape()) && hitbox.radius() != null) return hitbox.radius() * 2;
        if ("rectangle".equals(hitbox.shape())) {
            double width = hitbox.width() == null ? 0 : hitbox.width();
            double length = hitbox.length() == null ? 0 : hitbox.length();
            return Math.max(width, length);
        }
        if ("ray".equals(hitbox.shape()) && hitbox.width() != null) return hitbox.width();
        if ("arc".equals(hitbox.shape()) && hitbox.range() != null) return hitbox.range() * 2;
        return 0;
    }

    private static double hitboxValue(AbilityContracts.Hitbox hitbox, String field) {
        if (hitbox == null) return 0;
        return switch (field) {
            case "range" -> hitbox.range() != null ? hitbox.range()
                    : hitbox.length() != null ? hitbox.length()
                    : hitbox.radius() == null ? 0 : hitbox.radius();
            case "radius" -> hitbox.radius() == null ? 0 : hitbox.radius();
            default -> 0;
        };
    }

    public static AbilityDefinition definition(int id) {
        AbilityDefinition definition = CATALOG.get(id);
        if (definition == null) throw new IllegalArgumentException("unknown ability: " + id);
        return definition;
    }
    public static int cooldownMs(int id) { return definition(id).cooldownMs(); }
    public static int windupMs(int id) { return definition(id).windupMs(); }
    public static int durationMs(int id) { return definition(id).durationMs(); }
    public static double range(int id) { return definition(id).range(); }
    public static double arc(int id) { return definition(id).arc(); }
    public static double radius(int id) { return stat(id, "radius", definition(id).range()); }
    public static int projectileSize(int id) { return (int) stat(id, "hitboxWidth", 0); }
    public static double projectileSpeed(int id) { return stat(id, "speed", 0); }
    public static int projectileFuseMs(int id) { return (int) stat(id, "fuseMs", 0); }
    public static int projectileVisualMs(int id) { return (int) stat(id, "visibleMs", 0); }
    public static double stat(int id, String name, double fallback) {
        return definition(id).stats().getOrDefault(name, fallback);
    }

    public static Map<String, StatusDefinition> statuses(int id) {
        AbilityContracts.AbilityContract contract = AbilityContracts.forAbility(id);
        AbilityContracts.EntityContract entity = AbilityContracts.entityContractForAbility(id);
        Stream<AbilityContracts.Effect> effects = contract == null
                ? Stream.empty() : contract.triggerEffects().stream();
        if (entity != null) {
            effects = Stream.concat(effects, entity.phases().stream().flatMap(phase -> phase.effects().stream()));
        }
        return effects
                .filter(effect -> effect.type() != null)
                .filter(effect -> switch (effect.type()) {
                    case STATUS, BUFF, DAMAGE_REDUCTION, DAMAGE_REFLECTION,
                            DAMAGE_IMMUNITY -> true;
                    default -> false;
                })
                .collect(Collectors.toUnmodifiableMap(
                        effect -> effect.subtype() == null
                                ? effect.type().name().toLowerCase() : effect.subtype(),
                        effect -> new StatusDefinition(effect.durationMs(),
                                effect.intervalMs() == null ? 0 : effect.intervalMs()),
                        (first, ignored) -> first));
    }
    public static int statusDurationMs(int id, String status, int fallback) {
        return statuses(id).getOrDefault(status, new StatusDefinition(fallback, 0)).durationMs();
    }
    public static int statusIntervalMs(int id, String status, int fallback) {
        return statuses(id).getOrDefault(status, new StatusDefinition(0, fallback)).intervalMs();
    }
    public static boolean hasCharges(int id) {
        return definition(id).charges() > 0;
    }

    public static int maxCharges(int id, double maxHp) {
        return definition(id).charges();
    }

    /** Resolves a caller-supplied generic amount profile, clamped to ability range. */
    public static double amountAtDistance(int id, double distance) {
        return amountAtDistance(id, distance, null);
    }

    private static double amountAtDistance(int id, double distance, Double rangeOverride) {
        AbilityDefinition ability = definition(id);
        AbilityContracts.Falloff profile = ability.falloff();
        if (profile == null || !profile.hasAmountProfile()) return ability.damage();
        return amountAtDistance(id, distance, profile, rangeOverride);
    }

    public static double amountAtDistance(int id, double distance,
                                          AbilityContracts.Falloff profile,
                                          Double rangeOverride) {
        if (profile == null || !profile.hasAmountProfile()) {
            return amountAtDistance(id, distance, rangeOverride);
        }
        double range = finitePositive(rangeOverride) ? rangeOverride : definition(id).range();
        if (!Double.isFinite(distance) || finitePositive(range) && distance > range) return 0;
        double maxAmount = profile.maxAmount() == null
                ? profile.minAmount() : profile.maxAmount();
        double minAmount = profile.minAmount() == null
                ? maxAmount : profile.minAmount();
        return resolveFalloffValue(distance, minAmount, maxAmount,
                profile.falloffStart(), profile.falloffEnd(), range);
    }

    /** Resolves a caller-supplied generic duration profile in milliseconds. */
    public static int durationAtDistance(int id, double distance, int defaultDurationMs,
                                         AbilityContracts.Falloff profile,
                                         Double rangeOverride) {
        if (profile == null || !profile.hasDurationProfile()) {
            return Math.max(0, defaultDurationMs);
        }
        double range = finitePositive(rangeOverride) ? rangeOverride : definition(id).range();
        if (!Double.isFinite(distance) || finitePositive(range) && distance > range) return 0;
        double maxDuration = profile.maxDurationMs() == null
                ? defaultDurationMs : profile.maxDurationMs();
        double minDuration = profile.minDurationMs() == null
                ? maxDuration : profile.minDurationMs();
        return Math.max(0, (int) Math.round(resolveFalloffValue(distance,
                minDuration, maxDuration, profile.falloffStart(),
                profile.falloffEnd(), range)));
    }

    private static double resolveFalloffValue(double distance, double minValue,
                                              double maxValue, double start,
                                              double end, double range) {
        if (!Double.isFinite(minValue) || !Double.isFinite(maxValue)
                || !Double.isFinite(start) || !Double.isFinite(end)) return 0;
        double maxRange = finitePositive(range) ? range : Math.max(0, end);
        double clampedStart = Math.min(Math.max(0, start), maxRange);
        double clampedEnd = Math.min(Math.max(0, end), maxRange);
        if (clampedEnd > clampedStart && minValue != maxValue) {
            double t = Math.max(0, Math.min(1,
                    (distance - clampedStart) / (clampedEnd - clampedStart)));
            return roundCombatValue(maxValue + (minValue - maxValue) * t);
        }
        return roundCombatValue(maxValue);
    }

    private static boolean finitePositive(Double value) {
        return value != null && Double.isFinite(value) && value > 0;
    }

    public record AbilityDefinition(
            int cooldownMs,
            int windupMs,
            int activeMs,
            int durationMs,
            int damage,
            double range,
            double arc,
            int charges,
            int rechargeMs,
            int reuseCooldownMs,
            ResourceModel resourceModel,
            FalloffMode falloffMode,
            AbilityContracts.Falloff falloff,
            DamageOverTime damageOverTime,
            Map<String, Double> stats) {}

    private record TimingDefinition(int cooldownMs, int windupMs, int activeMs,
                                    int durationMs, int charges, int rechargeMs,
                                    int reuseCooldownMs, ResourceModel resourceModel) {}

    private record PhaseProjection(double damage, double range, double arc,
                                   AbilityContracts.Falloff falloff,
                                   DamageOverTime damageOverTime,
                                   Map<String, Double> stats) {}

    private static double roundCombatValue(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    /** Damage payload only; status duration and interval belong to phase effects. */
    public record DamageOverTime(int damage) {}
    public record StatusDefinition(int durationMs, int intervalMs) {}
}
