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

    public enum ResourceModel { NONE, REGENERATE, RELOAD_WHEN_EMPTY, FIXED, HP }
    public enum FalloffMode { CONTINUOUS }

    // Only ability-level timing and resource values are authored here. Damage,
    // geometry, movement, effects, and visuals are owned by phase contracts.
    private static final Map<Integer, TimingDefinition> TIMING_CATALOG = Map.ofEntries(
            Map.entry(1, timing(600, 0, 400, 0)),
            Map.entry(3, timing(1_000, 0, 500, 0, 6, 5_000, ResourceModel.RELOAD_WHEN_EMPTY)),
            Map.entry(4, timing(12_000, 0, 1, 0)),
            Map.entry(5, timing(300, 0, 500, 1_200, 4, 5_000, ResourceModel.RELOAD_WHEN_EMPTY)),
            Map.entry(6, timing(9_600, 200, 100, 1_200)),
            Map.entry(7, timing(4_600, 300, 400, 0)),
            Map.entry(8, timing(10_000, 0, 500, 0)),
            Map.entry(9, timing(6_700, 500, 300, 0)),
            Map.entry(10, timing(11_700, 800, 300, 0)),
            Map.entry(11, timing(10_000, 0, 300, 20_800)),
            Map.entry(12, timing(400, 0, 300, 0, 10, 3_000, ResourceModel.RELOAD_WHEN_EMPTY)),
            Map.entry(13, timing(10_700, 900, 300, 0)),
            Map.entry(14, timing(11_000, 0, 1_000, 7_000)),
            Map.entry(15, timing(10_000, 1_000, 2_000, 1_200)),
            Map.entry(16, timing(9_000, 500, 0, 4_000)),
            Map.entry(17, timing(8_000, 0, 300, 6_000)),
            Map.entry(18, timing(7_000, 300, 500, 500)),
            Map.entry(19, timing(1_800, 0, 200, 200)),
            Map.entry(20, timing(9_800, 200, 200, 0)),
            Map.entry(21, timing(18_000, 0, 300, 3_100)),
            Map.entry(22, timing(18_000, 500, 0, 1_500)),
            Map.entry(23, timing(15_500, 500, 0, 1_500)),
            Map.entry(24, timing(13_000, 1_000, 300, 5_000)),
            Map.entry(25, timing(1_500, 0, 300, 0)),
            Map.entry(26, timing(8_700, 0, 300, 0)),
            Map.entry(27, timing(18_000, 0, 300, 1_300)),
            Map.entry(28, timing(7_700, 300, 300, 1_100)),
            Map.entry(29, timing(10_000, 0, 300, 16_000)),
            Map.entry(30, timing(8_000, 200, 300, 0)),
            Map.entry(31, timing(9_000, 0, 300, 6_000)),
            Map.entry(32, timing(10_000, 300, 300, 0)),
            Map.entry(33, timing(12_000, 500, 0, 4_000)),
            Map.entry(34, timing(500, 0, 200, 0))
    );

    /** Compatibility view assembled from timing metadata and phase contracts. */
    public static final Map<Integer, AbilityDefinition> CATALOG = buildCatalog();

    private static TimingDefinition timing(int cooldownMs, int windupMs,
                                           int activeMs, int durationMs) {
        return timing(cooldownMs, windupMs, activeMs, durationMs,
                0, 0, ResourceModel.NONE);
    }

    private static TimingDefinition timing(int cooldownMs, int windupMs,
                                           int activeMs, int durationMs,
                                           int charges, int rechargeMs,
                                           ResourceModel resourceModel) {
        return new TimingDefinition(cooldownMs, windupMs, activeMs, durationMs,
                charges, rechargeMs, 0, resourceModel);
    }

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
        AbilityContracts.AbilityContract direct = AbilityContracts.attachedAll().get(id);
        AbilityContracts.AbilityContract entity = AbilityContracts.entityContractForAbility(id);
        List<AbilityContracts.AbilityPhase> phases = entity != null && !entity.phases().isEmpty()
                ? entity.phases()
                : direct == null ? List.of() : direct.phases();
        List<AbilityContracts.AbilityPhase> embeddedPhases = entity == null ? List.of()
                : entity.abilities().stream()
                        .flatMap(ability -> ability.phases().stream())
                        .toList();
        List<AbilityContracts.AbilityPhase> behaviorPhases = Stream.concat(
                phases.stream(), embeddedPhases.stream()).toList();
        List<AbilityContracts.Effect> effects = behaviorPhases.stream()
                .flatMap(phase -> phase.effects().stream())
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
                && entity.category() == AbilityContracts.Category.PROJECTILE;
        Double movingRange = movingProjectile && timing.durationMs() > 0
                && movement != null && movement.speed() > 0
                ? movement.speed() * timing.durationMs() / 100.0 : null;
        double range = movingRange != null ? movingRange : hitboxValue(hitbox, "range");
        double arc = hitbox == null || hitbox.arc() == null ? 0 : hitbox.arc();
        Map<String, Double> stats = new LinkedHashMap<>();
        if (range > 0) stats.put("range", range);
        if (hitbox != null && hitbox.radius() != null) stats.put("radius", hitbox.radius());
        if (hitbox != null && hitbox.width() != null) stats.put("hitboxWidth", hitbox.width());
        if (hitbox != null && hitbox.length() != null) stats.put("hitboxLength", hitbox.length());
        if (movement != null) {
            stats.put("speed", movement.speed());
            if (movement.distance() != null) stats.put("distance", movement.distance());
            if (movement.trailMs() != null) stats.put("trailMs", movement.trailMs().doubleValue());
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
                .flatMap(phase -> phase.events().values().stream())
                .map(AbilityContracts.PhaseEvent::visibleMs)
                .filter(value -> value != null)
                .findFirst().orElse(null);
        if (visibleMs == null) visibleMs = eventVisibleMs;
        if (visibleMs != null) stats.put("visibleMs", visibleMs.doubleValue());
        AbilityContracts.PhaseEvent repeatedEvent = phases.stream()
                .flatMap(phase -> phase.events().values().stream())
                .filter(event -> event.schedule() != null
                        && event.schedule().mode() == AbilityContracts.EventScheduleMode.REPEAT)
                .findFirst().orElse(null);
        Integer intervalMs = repeatedEvent == null
                ? phases.stream()
                        .map(AbilityContracts.AbilityPhase::execution)
                        .filter(java.util.Objects::nonNull)
                        .map(AbilityContracts.Execution::intervalMs)
                        .filter(java.util.Objects::nonNull)
                        .findFirst().orElse(null)
                : repeatedEvent.schedule().intervalMs();
        if (intervalMs != null) stats.put("intervalMs", intervalMs.doubleValue());
        AbilityContracts.Visual embeddedVisual = embeddedPhases.stream()
                .map(AbilityContracts.AbilityPhase::visual)
                .filter(value -> value != null && value.visibleMs() != null)
                .findFirst().orElse(null);
        if (embeddedVisual != null) {
            stats.put("shotVisualMs", embeddedVisual.visibleMs().doubleValue());
        }
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
        AbilityContracts.AbilityContract direct = AbilityContracts.attachedAll().get(id);
        AbilityContracts.AbilityContract entity = AbilityContracts.entityContractForAbility(id);
        Stream<AbilityContracts.AbilityPhase> phases = direct == null
                ? Stream.empty() : direct.phases().stream();
        if (entity != null) phases = Stream.concat(phases, entity.phases().stream());
        return phases
                .flatMap(phase -> phase.effects().stream())
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
