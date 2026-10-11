package com.example.botfight.simulation.gameconfig;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Category;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EventScheduleMode;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.MovementMode;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.PhaseEventType;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.PhaseType;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.RotationSpace;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TargetKind;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TargetPolicyMode;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TimerMode;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * The shared gameplay data (shared/gameplay/*.json, copied onto the classpath as gameplay/), read once into
 * immutable records and checked. The browser reads the same files in gameconfig/gameplayData.js and runs the
 * same checks in gameplayValidation.js; keep the two lists in step.
 *
 * <p>Every value is written in the files and unknown properties fail the load, so nothing here fills a
 * missing value in. A JSON {@code null} means the field does not apply. Any error throws, so the app does
 * not start and tests fail.
 *
 * <p>Checks: (1) ability ids are unique positive integers, names and labels unique; (2) every closed
 * vocabulary value is known (enums fail the parse); (3) every transition.to names a phase of that entity and
 * every spawn names an entity of its ability; (4) onTrigger verbs are hit, spawn, move, face or applyEffects
 * (applyEffects there targets OWNER), entity event verbs are hit, spawn, applyEffects, transition, remove or
 * emitVisual; (5) every *Ms is a whole number of 100 ms ticks within bounds (interrupt durations and the 1 ms
 * Grenade activeMs predate the tick rule and are the only exceptions); (6) counts and sizes are within bounds, a
 * spawn pattern has a count of 1..12 and the fields its type needs; (7) an effect carries the fields its type
 * needs and a hit or applyEffects verb applies at least one; (8) every status an effect applies has a preset in
 * statuses.json and its tokens are known; (9) movement.json numbers are whole and in bounds; (10) every
 * ability names a channel of channels.json, a channel's blocking statuses have presets (and the ones that make
 * an ability not ready are among them), and only the dash channel may declare a stamina cost (a whole number
 * in 1..staminaMax); (11) an entity phase moves in a known mode with the numbers it needs and a timer
 * (schedule) event repeats at a whole tick interval.
 */
public record GameplayData(AbilitiesFile abilities, StatusesFile statuses, MovementFile movement,
                           ChannelsFile channels) {
    public static final String DASH_CHANNEL = "dash";
    private static final String RESOURCE_DIR = "gameplay/";
    private static final int MAX_MS = 600_000;
    private static final double MAX_LENGTH = 5000;
    private static final Set<String> STATUS_EFFECT_TYPES = Set.of(
            "damage", "silence", "stun", "movement_modifier", "movement_lock", "incoming_damage_modifier");
    private static final Set<String> STATUS_MODES = Set.of("constant", "tick");
    private static final Set<String> STATUS_TOKENS = Set.of("$amount", "$damageMultiplier", "$movementLockMs");

    // ---- abilities.json
    public record AbilitiesFile(int version, Map<String, Integer> legacyNames, List<AbilityData> abilities) {
    }

    public record AbilityData(Integer id, String name, String label, String type, String channel, CostData cost,
                              TimingData timing, ActivationData activation, List<VerbData> onTrigger,
                              Map<String, EntityData> entities) {
    }

    /** What an activation costs; only the dash channel may declare a stamina cost. */
    public record CostData(Integer stamina) {
    }

    public record TimingData(Integer cooldownMs, Integer windupMs, Integer activeMs, Integer durationMs,
                             Integer maxCharges, String resourceModel, String chargeType, Integer reloadMs) {
    }

    /** One arena entity an ability's spawn verbs can create. */
    public record EntityData(String runtimeType, Category category, SpawnData spawn, TargetingData targeting,
                             LifetimeData lifetime, InitialStateData initialState, Map<String, Object> state,
                             List<PhaseData> phases) {
    }

    public record SpawnData(OffsetData offset, Double rotation, RotationSpace rotationSpace) {
    }

    public record OffsetData(Double x, Double y) {
    }

    /** defaultX/defaultY are numbers, or "owner.x"/"owner.y" which only the browser resolves. */
    public record TargetingData(String owner, String position, Object defaultX, Object defaultY,
                                Double clampToRadius) {
    }

    public record LifetimeData(TimerMode timerMode, Integer duration, Integer add) {
    }

    public record InitialStateData(Boolean armed, Boolean damageMultiplierFromOwner) {
    }

    public record ActivationData(String targetMode, Map<String, String> capture, String phaseFacingDefault,
                                 Boolean teleportOncePerActivation) {
    }

    public record PhaseData(String id, PhaseType type, Integer durationMs, Integer startMs, Boolean transitionOnly,
                            Boolean skipOwner, MovementData movement, HitboxData hitbox, HealthData health,
                            TriggerData trigger, VisualData visual, Map<PhaseEventType, EventData> on) {
    }

    public record MovementData(MovementMode mode, Double unitsPerTick, String direction, Double turnDegrees,
                               Double size) {
    }

    public record TriggerData(Double radius, Integer lifetimeMs, Boolean attackHits, Boolean projectileOverlap,
                              Boolean botContact, Boolean chain) {
    }

    public record HitboxData(String shape, Double radius, Double range, Double arc, Double width, Double length,
                             Double radiusMultiplier, Boolean includeTargetRadius) {
    }

    public record HealthData(Double hp, Double maxHp, Boolean allowFriendlyDamage) {
    }

    public record VisualData(String type, String state, Double visualSize, Integer visibleMs) {
    }

    /**
     * One verb, the union of every verb's fields (a field that does not apply is null). {@code verb} is the JSON
     * {@code do}: hit, spawn, move, face, applyEffects, transition, remove or emitVisual.
     */
    public record VerbData(@JsonProperty("do") String verb, Integer atMs, String pose, HitboxData hitbox,
                           List<String> targets, List<EffectData> effects, Boolean nearestOnly,
                           String oncePerTarget, String aim,
                           SpawnData origin, String knockbackDirection, String pullDirection, VisualData visual,
                           String entity, PatternData pattern, Double distance, Double unitsPerTick,
                           Integer trailMs, String target, String to, String visualType, Integer visibleMs,
                           Double visualSize) {
    }

    public record PatternData(String type, Integer count, Double spreadDeg, Double spacing) {
    }

    public record FalloffData(Double minAmount, Double maxAmount, Integer minDurationMs, Integer maxDurationMs,
                              Double falloffStart, Double falloffEnd) {
    }

    public record EffectData(EffectType type, String subtype, Double amount, Integer durationMs, Integer delayMs,
                             Integer intervalMs, Integer movementLockMs, Double multiplier, String buff,
                             Boolean whileInside, Boolean runtimeComputed, String recipient,
                             Boolean requiresConfirmedDamage, Boolean mirrorsDamage, String distanceMode,
                             FalloffData falloff, List<TargetKind> targetKinds) {
    }

    public record ScheduleData(EventScheduleMode mode, Integer intervalMs, Integer count,
                               Boolean startImmediately) {
    }

    public record TargetPolicyData(TargetPolicyMode mode, String intervalStat, Integer intervalMs) {
    }

    public record EventData(List<TargetKind> targets, ScheduleData schedule, TargetPolicyData targetPolicy,
                            Boolean recheckCollisionOnTransition, Boolean nearestOnly, Boolean waitForHit,
                            @JsonProperty("do") List<VerbData> verbs) {
    }

    // ---- statuses.json
    public record StatusesFile(int version, Map<String, StatusPreset> statuses) {
    }

    public record StatusPreset(Boolean presenceWhenInside, Integer tickIntervalDefaultMs,
                               Boolean carriesSourceSlot, Boolean clearsVelocity,
                               List<StatusEffectData> effects) {
    }

    /** amount, multiplier and durationMs are numbers or one of the "$..." tokens. */
    public record StatusEffectData(String type, String mode, Object amount, Object multiplier,
                                   Double movementMultiplier, Double rotationMultiplier, Object durationMs,
                                   Double damageModifier, String rounding,
                                   List<String> excludedDamageSourceTypes) {
    }

    // ---- movement.json
    public record MovementFile(int version, int tickMs, Map<String, Double> config) {
    }

    // ---- channels.json
    public record ChannelsFile(int version, Map<String, ChannelData> channels) {
    }

    public record ChannelData(String label, List<String> blockedByStatuses, List<String> notReadyWhileStatuses) {
    }

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private static volatile GameplayData loaded;

    /** The data shipped on the classpath, loaded and checked once. */
    public static GameplayData get() {
        GameplayData data = loaded;
        if (data == null) {
            synchronized (GameplayData.class) {
                data = loaded;
                if (data == null) loaded = data = parse(resource("abilities.json"), resource("statuses.json"),
                        resource("movement.json"), resource("channels.json"));
            }
        }
        return data;
    }

    private static String resource(String name) {
        try (InputStream stream = GameplayData.class.getClassLoader().getResourceAsStream(RESOURCE_DIR + name)) {
            if (stream == null) throw new IllegalStateException("Missing classpath resource " + RESOURCE_DIR + name);
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new IllegalStateException("Cannot read " + RESOURCE_DIR + name, ex);
        }
    }

    /** Reads and checks the four files' text. Throws {@link IllegalStateException} on any problem. */
    public static GameplayData parse(String abilitiesJson, String statusesJson, String movementJson,
                                     String channelsJson) {
        GameplayData data;
        try {
            data = new GameplayData(
                    MAPPER.readValue(abilitiesJson, AbilitiesFile.class),
                    MAPPER.readValue(statusesJson, StatusesFile.class),
                    MAPPER.readValue(movementJson, MovementFile.class),
                    MAPPER.readValue(channelsJson, ChannelsFile.class));
        } catch (RuntimeException ex) {
            throw new IllegalStateException("Invalid gameplay data: " + ex.getMessage(), ex);
        }
        List<String> errors = data.check();
        if (!errors.isEmpty()) {
            throw new IllegalStateException("Invalid gameplay data (" + errors.size() + "):\n"
                    + String.join("\n", errors.subList(0, Math.min(30, errors.size()))));
        }
        return data;
    }

    /**
     * A copy with {@code extra} abilities added to (or, for an id already used, replacing) the shipped ones, checked
     * like the shipped files. For tests.
     */
    public GameplayData withAbilities(List<AbilityData> extra) {
        Set<Integer> replaced = new HashSet<>();
        extra.forEach(ability -> replaced.add(ability.id()));
        List<AbilityData> merged = new ArrayList<>();
        abilities.abilities().stream().filter(ability -> !replaced.contains(ability.id())).forEach(merged::add);
        merged.addAll(extra);
        GameplayData next = new GameplayData(
                new AbilitiesFile(abilities.version(), abilities.legacyNames(), merged), statuses, movement, channels);
        List<String> errors = next.check();
        if (!errors.isEmpty()) {
            throw new IllegalStateException("Invalid gameplay data (" + errors.size() + "):\n"
                    + String.join("\n", errors.subList(0, Math.min(30, errors.size()))));
        }
        return next;
    }

    /** Reads one ability written in the abilities.json schema. For tests. */
    public static AbilityData parseAbility(String json) {
        try {
            return MAPPER.readValue(json, AbilityData.class);
        } catch (RuntimeException ex) {
            throw new IllegalStateException("Invalid ability: " + ex.getMessage(), ex);
        }
    }

    // ---- semantic checks (the same list as gameplayValidation.js)
    private List<String> check() {
        List<String> errors = new ArrayList<>();
        Map<String, StatusPreset> presets = statuses.statuses() == null ? Map.of() : statuses.statuses();

        presets.forEach((name, preset) -> {
            String path = "statuses." + name;
            ms(errors, path + ".tickIntervalDefaultMs", preset.tickIntervalDefaultMs(), false, false);
            List<StatusEffectData> entries = preset.effects() == null ? List.of() : preset.effects();
            for (int index = 0; index < entries.size(); index += 1) {
                StatusEffectData entry = entries.get(index);
                String entryPath = path + ".effects[" + index + "]";
                if (!STATUS_EFFECT_TYPES.contains(entry.type())) errors.add(entryPath + ".type: unknown statusEffectType " + entry.type());
                if (!STATUS_MODES.contains(entry.mode())) errors.add(entryPath + ".mode: unknown statusMode " + entry.mode());
                for (Object value : new Object[] {entry.amount(), entry.multiplier(), entry.durationMs()}) {
                    if (value instanceof String token && !STATUS_TOKENS.contains(token)) {
                        errors.add(entryPath + ": unknown token " + token);
                    } else if (value != null && !(value instanceof Number) && !(value instanceof String)) {
                        errors.add(entryPath + ": value must be a number or a token");
                    }
                }
            }
        });

        Map<String, ChannelData> channelList = channels.channels() == null ? Map.of() : channels.channels();
        if (channelList.isEmpty()) errors.add("channels.channels: needs at least one channel");
        channelList.forEach((name, channel) -> {
            if (channel.blockedByStatuses() == null) errors.add("channels." + name + ".blockedByStatuses: must be a list");
            else for (String status : channel.blockedByStatuses()) {
                if (!presets.containsKey(status)) {
                    errors.add("channels." + name + ".blockedByStatuses: " + status + " has no preset in statuses.json");
                }
            }
            if (channel.notReadyWhileStatuses() == null) {
                errors.add("channels." + name + ".notReadyWhileStatuses: must be a list");
            } else for (String status : channel.notReadyWhileStatuses()) {
                if (channel.blockedByStatuses() == null || !channel.blockedByStatuses().contains(status)) {
                    errors.add("channels." + name + ".notReadyWhileStatuses: " + status
                            + " is not one of the channel's blockedByStatuses");
                }
            }
        });
        double staminaMax = movement.config() == null || movement.config().get("staminaMax") == null
                ? 100 : movement.config().get("staminaMax");

        Set<Integer> ids = new HashSet<>();
        Set<String> names = new HashSet<>();
        Set<String> labels = new HashSet<>();
        List<AbilityData> list = abilities.abilities() == null ? List.of() : abilities.abilities();
        for (int index = 0; index < list.size(); index += 1) {
            AbilityData ability = list.get(index);
            String path = "abilities[" + index + "]";
            if (ability.id() == null || ability.id() <= 0) errors.add(path + ".id: " + ability.id() + " is not a positive integer");
            else if (!ids.add(ability.id())) errors.add(path + ".id: duplicate id " + ability.id());
            if (ability.name() == null || ability.name().isBlank() || !names.add(ability.name())) {
                errors.add(path + ".name: missing or duplicate name " + ability.name());
            }
            if (ability.label() == null || ability.label().isBlank() || !labels.add(ability.label())) {
                errors.add(path + ".label: missing or duplicate label " + ability.label());
            }
            if (!channelList.containsKey(ability.channel())) {
                errors.add(path + ".channel: unknown channel " + ability.channel());
            }
            if (ability.cost() != null) {
                if (!DASH_CHANNEL.equals(ability.channel())) {
                    errors.add(path + ".cost: only the dash channel may declare a stamina cost");
                }
                Integer stamina = ability.cost().stamina();
                if (stamina == null) errors.add(path + ".cost: needs stamina");
                else if (stamina < 1 || stamina > staminaMax || stamina != Math.rint(stamina)) {
                    errors.add(path + ".cost.stamina: " + stamina + " is outside 1.." + staminaMax);
                }
            }
            TimingData timing = ability.timing();
            if (timing == null) { errors.add(path + ".timing: missing"); continue; }
            ms(errors, path + ".timing.cooldownMs", timing.cooldownMs(), false, false);
            ms(errors, path + ".timing.windupMs", timing.windupMs(), false, false);
            ms(errors, path + ".timing.activeMs", timing.activeMs(), true, false);
            ms(errors, path + ".timing.durationMs", timing.durationMs(), false, false);
            ms(errors, path + ".timing.reloadMs", timing.reloadMs(), false, false);
            if (timing.maxCharges() != null && (timing.maxCharges() < 1 || timing.maxCharges() > 100)) {
                errors.add(path + ".timing.maxCharges: " + timing.maxCharges() + " is outside 1..100");
            }
            if (timing.resourceModel() != null && !"reload".equals(timing.resourceModel())) {
                errors.add(path + ".timing.resourceModel: unknown resourceModel " + timing.resourceModel());
            }
            if ((timing.maxCharges() == null) != (timing.reloadMs() == null)) {
                errors.add(path + ".timing: maxCharges and reloadMs go together");
            }

            if (ability.activation() == null) errors.add(path + ".activation: missing");
            Map<String, EntityData> entities = ability.entities() == null ? Map.of() : ability.entities();
            Set<String> entityNames = entities.keySet();
            if (ability.onTrigger() == null || ability.onTrigger().isEmpty()) {
                errors.add(path + ".onTrigger: needs at least one verb");
            } else for (int verbIndex = 0; verbIndex < ability.onTrigger().size(); verbIndex += 1) {
                checkVerb(errors, ability.onTrigger().get(verbIndex), path + ".onTrigger[" + verbIndex + "]", true,
                        Set.of(), entityNames, presets, timing, ability.activation());
            }
            int previousAtMs = 0;
            if (ability.onTrigger() != null) for (int verbIndex = 0; verbIndex < ability.onTrigger().size(); verbIndex += 1) {
                Integer atMs = ability.onTrigger().get(verbIndex).atMs();
                int value = atMs == null ? 0 : atMs;
                if (value < previousAtMs) {
                    errors.add(path + ".onTrigger[" + verbIndex + "].atMs: " + value + " comes after a verb at "
                            + previousAtMs + " (verbs run in non-decreasing atMs order)");
                }
                previousAtMs = Math.max(previousAtMs, value);
            }
            entities.forEach((entityName, entity) ->
                    checkEntity(errors, entity, path + ".entities." + entityName, entityNames, presets));
        }
        if (abilities.legacyNames() != null) {
            abilities.legacyNames().forEach((name, id) -> {
                if (!ids.contains(id)) errors.add("abilities.legacyNames." + name + ": " + id + " is not an ability id");
            });
        }

        MovementFile move = movement;
        if (move.tickMs() != 100) errors.add("movement.tickMs: the simulation ticks every 100 ms");
        if (move.config() == null) errors.add("movement.config: missing");
        else move.config().forEach((key, value) -> {
            if (value == null || value < 0 || value > 1000) errors.add("movement.config." + key + ": " + value + " is outside 0..1000");
            else if (key.endsWith("Ms")) ms(errors, "movement.config." + key, value.intValue(), false, false);
            else if (!key.endsWith("Multiplier") && value != Math.rint(value)) {
                errors.add("movement.config." + key + ": " + value + " must be a whole number");
            }
        });
        return errors;
    }

    private static void ms(List<String> errors, String path, Integer value, boolean allowOneMs, boolean allowSubTick) {
        if (value == null) return;
        if (value < 0 || value > MAX_MS) errors.add(path + ": " + value + " is not a whole number of ms in 0.." + MAX_MS);
        else if (value % 100 != 0 && !(allowOneMs && value == 1) && !allowSubTick) {
            errors.add(path + ": " + value + " is not a multiple of 100 ms");
        }
    }

    private static void bounded(List<String> errors, String path, Double value, double min, double max) {
        if (value != null && (value < min || value > max)) errors.add(path + ": " + value + " is outside " + min + ".." + max);
    }

    private static boolean has(Object value) {
        return value != null;
    }

    /**
     * trigger.radius is the only radius a trigger uses (detection, chains, trigger targets). A phase with a
     * trigger must set it, and must not also set hitbox.radius unless the hitbox serves another event.
     */
    private static void checkTriggerRadius(List<String> errors, PhaseData phase, String phasePath) {
        boolean triggerEvent = phase.on() != null && phase.on().get(PhaseEventType.TRIGGER) != null;
        if (phase.trigger() == null && !triggerEvent) return;
        if (phase.trigger() == null) {
            errors.add(phasePath + ".trigger: a trigger event needs a trigger");
        } else if (phase.trigger().radius() == null || phase.trigger().radius() < 1) {
            errors.add(phasePath + ".trigger.radius: a trigger needs its own radius; the hitbox radius is not used");
        }
        boolean hitboxServesAnotherEvent = phase.health() != null || (phase.on() != null
                && (phase.on().get(PhaseEventType.COLLISION) != null || phase.on().get(PhaseEventType.HIT) != null
                || phase.on().get(PhaseEventType.KILLED) != null));
        if (phase.trigger() != null && phase.trigger().radius() != null
                && phase.hitbox() != null && phase.hitbox().radius() != null && !hitboxServesAnotherEvent) {
            errors.add(phasePath + ".hitbox.radius: set alongside trigger.radius but no collision, hit or killed event"
                    + " uses the hitbox; drop it");
        }
    }

    private static void checkHitbox(List<String> errors, HitboxData hitbox, String path) {
        if (hitbox == null) { errors.add(path + ": needs a hitbox"); return; }
        bounded(errors, path + ".radius", hitbox.radius(), 1, MAX_LENGTH);
        bounded(errors, path + ".range", hitbox.range(), 1, MAX_LENGTH);
        bounded(errors, path + ".width", hitbox.width(), 1, MAX_LENGTH);
        bounded(errors, path + ".length", hitbox.length(), 1, MAX_LENGTH);
        bounded(errors, path + ".arc", hitbox.arc(), 1, 360);
    }

    private static void checkVisual(List<String> errors, VisualData visual, String path) {
        if (visual == null) return;
        ms(errors, path + ".visibleMs", visual.visibleMs(), false, false);
        bounded(errors, path + ".visualSize", visual.visualSize(), 1, 2000);
    }

    private static final Set<String> TRIGGER_VERBS = Set.of("hit", "spawn", "move", "face", "applyEffects");
    private static final Set<String> EVENT_VERBS = Set.of("hit", "spawn", "applyEffects", "transition", "remove",
            "emitVisual");
    private static final Set<String> VERB_TARGETS = Set.of("OWNER", "BOT", "HP_ENTITY", "SUMMON", "ENTITY");

    private static final Set<String> DELAYABLE_VERBS = Set.of("hit", "spawn", "applyEffects");

    /**
     * A trigger verb's place on the ability's timeline ({@code atMs}, {@code pose}); an entity event verb has none.
     * The browser also requires both keys to be written; JSON {@code null} and an absent key read the same here.
     */
    private static void checkTimeline(List<String> errors, VerbData verb, String here, boolean trigger,
                                      TimingData timing, ActivationData activation) {
        if (!trigger) {
            if (verb.atMs() != null) errors.add(here + ".atMs: only an onTrigger verb has atMs");
            if (verb.pose() != null) errors.add(here + ".pose: only an onTrigger verb has pose");
            return;
        }
        Integer atMs = verb.atMs();
        if (atMs != null) {
            if (!DELAYABLE_VERBS.contains(verb.verb())) {
                errors.add(here + ".atMs: a " + verb.verb() + " verb cannot be delayed");
                return;
            }
            int activeMs = timing == null || timing.activeMs() == null ? 0 : timing.activeMs();
            if (atMs < 0) errors.add(here + ".atMs: " + atMs + " is not a whole number of ms");
            else if (atMs % 100 != 0) errors.add(here + ".atMs: " + atMs + " is not a multiple of 100 ms");
            else if (atMs > activeMs) errors.add(here + ".atMs: " + atMs + " is after the ability's activeMs " + activeMs);
        }
        if (atMs != null && atMs > 0) {
            if (verb.pose() == null || !VERB_POSES.contains(verb.pose())) {
                errors.add(here + ".pose: unknown verbPose " + verb.pose());
            } else if ("captured".equals(verb.pose())
                    && (activation == null || activation.capture() == null || activation.capture().isEmpty())) {
                errors.add(here + ".pose: captured needs activation.capture");
            }
        } else if (verb.pose() != null) {
            errors.add(here + ".pose: pose is only for a delayed verb (atMs above 0)");
        }
    }

    private static final Set<String> VERB_POSES = Set.of("current", "captured");
    private static final Set<String> ONCE_PER_TARGET_SCOPES = Set.of("step", "activation");

    private static void checkVerb(List<String> errors, VerbData verb, String here, boolean trigger,
                                  Set<String> phaseIds, Set<String> entityNames, Map<String, StatusPreset> presets,
                                  TimingData timing, ActivationData activation) {
        String name = verb.verb();
        if (name == null || !(trigger ? TRIGGER_VERBS : EVENT_VERBS).contains(name)) {
            errors.add(here + ".do: unknown " + (trigger ? "triggerVerb" : "eventVerb") + " " + name);
            return;
        }
        if (verb.targets() != null) {
            for (String target : verb.targets()) {
                if (!VERB_TARGETS.contains(target)) errors.add(here + ".targets: unknown verbTarget " + target);
            }
        }
        checkVisual(errors, verb.visual(), here + ".visual");
        checkTimeline(errors, verb, here, trigger, timing, activation);
        switch (name) {
            case "hit" -> {
                checkHitbox(errors, verb.hitbox(), here + ".hitbox");
                if (verb.targets() == null || verb.targets().isEmpty()) errors.add(here + ".targets: hit needs targets");
                checkVerbEffects(errors, verb, here, "hit", presets);
                if (verb.nearestOnly() == null) errors.add(here + ".nearestOnly: missing");
                if (verb.oncePerTarget() != null && !ONCE_PER_TARGET_SCOPES.contains(verb.oncePerTarget())) {
                    errors.add(here + ".oncePerTarget: unknown oncePerTarget " + verb.oncePerTarget());
                }
                if (verb.aim() != null && !"seekTarget".equals(verb.aim())) {
                    errors.add(here + ".aim: unknown hitAim " + verb.aim());
                }
                checkDirection(errors, verb, here);
            }
            case "applyEffects" -> {
                checkVerbEffects(errors, verb, here, "applyEffects", presets);
                if (trigger && (verb.targets() == null || !verb.targets().contains("OWNER"))) {
                    errors.add(here + ".targets: an applyEffects in onTrigger must target OWNER");
                }
                checkDirection(errors, verb, here);
            }
            case "spawn" -> {
                if (verb.entity() == null || !entityNames.contains(verb.entity())) {
                    errors.add(here + ".entity: " + verb.entity() + " is not an entity of this ability");
                }
                PatternData pattern = verb.pattern();
                if (pattern != null) {
                    if (pattern.type() == null || !Set.of("fan", "ring", "line").contains(pattern.type())) {
                        errors.add(here + ".pattern.type: unknown patternType " + pattern.type());
                    }
                    if (pattern.count() == null) errors.add(here + ".pattern.count: missing");
                    else if (pattern.count() < 1 || pattern.count() > 12) {
                        errors.add(here + ".pattern.count: " + pattern.count() + " is outside 1.0..12.0");
                    }
                    if ("fan".equals(pattern.type())) {
                        bounded(errors, here + ".pattern.spreadDeg", pattern.spreadDeg(), 0, 360);
                        if (pattern.spreadDeg() == null) errors.add(here + ".pattern.spreadDeg: fan needs spreadDeg");
                    }
                    if ("line".equals(pattern.type())) {
                        bounded(errors, here + ".pattern.spacing", pattern.spacing(), 1, 500);
                        if (pattern.spacing() == null) errors.add(here + ".pattern.spacing: line needs spacing");
                    }
                }
            }
            case "move" -> {
                bounded(errors, here + ".distance", verb.distance(), 1, MAX_LENGTH);
                bounded(errors, here + ".unitsPerTick", verb.unitsPerTick(), 1, 500);
                ms(errors, here + ".trailMs", verb.trailMs(), false, false);
                if (verb.distance() == null || verb.unitsPerTick() == null) {
                    errors.add(here + ": move needs distance and unitsPerTick");
                }
            }
            case "face" -> {
                if (!"activationTarget".equals(verb.target())) errors.add(here + ".target: unknown faceTarget " + verb.target());
            }
            case "transition" -> {
                if (verb.to() == null || !phaseIds.contains(verb.to())) {
                    errors.add(here + ".to: " + verb.to() + " is not a phase of this entity");
                }
            }
            case "emitVisual" -> {
                if (verb.visualType() == null) errors.add(here + ".visualType: missing");
                ms(errors, here + ".visibleMs", verb.visibleMs(), false, false);
                if (verb.visibleMs() == null || verb.visibleMs() <= 0) {
                    errors.add(here + ".visibleMs: emitVisual needs a positive visibleMs");
                }
                bounded(errors, here + ".visualSize", verb.visualSize(), 1, 2000);
            }
            default -> { }
        }
    }

    private static void checkDirection(List<String> errors, VerbData verb, String here) {
        for (String direction : new String[] {verb.knockbackDirection(), verb.pullDirection()}) {
            if (direction != null && !Set.of("source", "owner", "velocity").contains(direction)) {
                errors.add(here + ": unknown pushDirection " + direction);
            }
        }
    }

    private static void checkVerbEffects(List<String> errors, VerbData verb, String here, String name,
                                         Map<String, StatusPreset> presets) {
        List<EffectData> effects = verb.effects() == null ? List.of() : verb.effects();
        if (effects.isEmpty()) errors.add(here + ".effects: " + name + " needs at least one effect");
        for (int effectIndex = 0; effectIndex < effects.size(); effectIndex += 1) {
            checkEffect(errors, effects.get(effectIndex), here + ".effects[" + effectIndex + "]", presets);
        }
    }

    private static void checkEntity(List<String> errors, EntityData entity, String here, Set<String> entityNames,
                                    Map<String, StatusPreset> presets) {
        if (entity.category() == null) errors.add(here + ".category: missing");
        if (entity.spawn() == null || entity.spawn().rotationSpace() == null) errors.add(here + ".spawn.rotationSpace: missing");
        if (entity.lifetime() == null || entity.lifetime().timerMode() == null) errors.add(here + ".lifetime.timerMode: missing");
        else {
            ms(errors, here + ".lifetime.duration", entity.lifetime().duration(), false, false);
            ms(errors, here + ".lifetime.add", entity.lifetime().add(), false, false);
        }
        if (entity.runtimeType() == null) errors.add(here + ".runtimeType: missing");
        List<PhaseData> phases = entity.phases() == null ? List.of() : entity.phases();
        if (phases.isEmpty()) { errors.add(here + ".phases: needs at least one phase"); return; }
        Set<String> phaseIds = new HashSet<>();
        phases.forEach(phase -> phaseIds.add(phase.id()));
        if (phaseIds.size() != phases.size()) errors.add(here + ".phases: duplicate phase ids");
        for (int phaseIndex = 0; phaseIndex < phases.size(); phaseIndex += 1) {
            PhaseData phase = phases.get(phaseIndex);
            String phasePath = here + ".phases[" + phaseIndex + "]";
            if (phase.type() == null) errors.add(phasePath + ".type: missing");
            ms(errors, phasePath + ".durationMs", phase.durationMs(), false, false);
            if (phase.trigger() != null) ms(errors, phasePath + ".trigger.lifetimeMs", phase.trigger().lifetimeMs(), false, false);
            checkVisual(errors, phase.visual(), phasePath + ".visual");
            if (phase.health() != null) {
                bounded(errors, phasePath + ".health.hp", phase.health().hp(), 1, 10_000);
                bounded(errors, phasePath + ".health.maxHp", phase.health().maxHp(), 1, 10_000);
            }
            if (phase.hitbox() != null) {
                bounded(errors, phasePath + ".hitbox.radius", phase.hitbox().radius(), 1, MAX_LENGTH);
                bounded(errors, phasePath + ".hitbox.range", phase.hitbox().range(), 1, MAX_LENGTH);
                bounded(errors, phasePath + ".hitbox.width", phase.hitbox().width(), 1, MAX_LENGTH);
                bounded(errors, phasePath + ".hitbox.length", phase.hitbox().length(), 1, MAX_LENGTH);
                bounded(errors, phasePath + ".hitbox.arc", phase.hitbox().arc(), 1, 360);
            }
            checkTriggerRadius(errors, phase, phasePath);
            MovementData movement = phase.movement();
            if (movement != null) {
                if (movement.mode() == null) errors.add(phasePath + ".movement.mode: missing");
                bounded(errors, phasePath + ".movement.unitsPerTick", movement.unitsPerTick(), 0, 500);
                if (movement.direction() != null && !Set.of("forward", "backward").contains(movement.direction())) {
                    errors.add(phasePath + ".movement.direction: unknown movementDirection " + movement.direction());
                }
                if ((movement.mode() == MovementMode.STRAIGHT || movement.mode() == MovementMode.SEEK)
                        && (movement.unitsPerTick() == null || movement.unitsPerTick() <= 0)) {
                    errors.add(phasePath + ".movement.unitsPerTick: " + movement.mode().name().toLowerCase()
                            + " movement needs unitsPerTick above 0");
                }
                if (movement.mode() == MovementMode.SEEK && movement.turnDegrees() == null) {
                    errors.add(phasePath + ".movement.turnDegrees: seek needs turnDegrees");
                }
            }
            if (phase.on() == null) continue;
            phase.on().forEach((eventType, event) -> {
                String eventPath = phasePath + ".on." + eventType;
                if (event.schedule() == null || event.schedule().mode() == null) errors.add(eventPath + ".schedule.mode: missing");
                else {
                    ms(errors, eventPath + ".schedule.intervalMs", event.schedule().intervalMs(), false, false);
                    // Unlimited is a missing count; 0 would mean unlimited in the browser and never in the server.
                    bounded(errors, eventPath + ".schedule.count",
                            event.schedule().count() == null ? null : event.schedule().count().doubleValue(), 1, 1000);
                }
                if (event.nearestOnly() == null) errors.add(eventPath + ".nearestOnly: missing");
                if (event.waitForHit() == null) errors.add(eventPath + ".waitForHit: missing");
                if (eventType == PhaseEventType.SCHEDULE) {
                    if (event.schedule() == null || event.schedule().mode() != EventScheduleMode.REPEAT) {
                        errors.add(eventPath + ".schedule.mode: a schedule event repeats");
                    }
                    if (event.schedule() == null || event.schedule().intervalMs() == null
                            || event.schedule().intervalMs() <= 0) {
                        errors.add(eventPath + ".schedule.intervalMs: a schedule event needs intervalMs");
                    }
                } else if (Boolean.TRUE.equals(event.waitForHit())) {
                    errors.add(eventPath + ".waitForHit: only a schedule event waits for its hit");
                }
                if (event.verbs() == null) { errors.add(eventPath + ".do: must be a list of verbs"); return; }
                for (int verbIndex = 0; verbIndex < event.verbs().size(); verbIndex += 1) {
                    checkVerb(errors, event.verbs().get(verbIndex), eventPath + ".do[" + verbIndex + "]", false,
                            phaseIds, entityNames, presets, null, null);
                }
            });
        }
    }

    private static void checkEffect(List<String> errors, EffectData effect, String path, Map<String, StatusPreset> presets) {
        ms(errors, path + ".durationMs", effect.durationMs(), false, effect.type() == EffectType.INTERRUPT);
        ms(errors, path + ".delayMs", effect.delayMs(), false, false);
        ms(errors, path + ".intervalMs", effect.intervalMs(), false, false);
        ms(errors, path + ".movementLockMs", effect.movementLockMs(), false, false);
        if (effect.type() == null) { errors.add(path + ".type: missing"); return; }
        switch (effect.type()) {
            case DAMAGE -> {
                if (effect.amount() == null && effect.falloff() == null) errors.add(path + ": damage needs amount or falloff");
            }
            case HEALING -> {
                if (effect.amount() == null && !Boolean.TRUE.equals(effect.mirrorsDamage())) {
                    errors.add(path + ": healing needs amount or mirrorsDamage");
                }
            }
            case KNOCKBACK, PULL -> need(errors, path, effect.type(), "amount", effect.amount());
            case STATUS -> {
                need(errors, path, effect.type(), "subtype", effect.subtype());
                if (effect.subtype() != null && !presets.containsKey(effect.subtype())) {
                    errors.add(path + ": status " + effect.subtype() + " has no preset in statuses.json");
                }
                if (effect.durationMs() == null && !Boolean.TRUE.equals(effect.whileInside())) {
                    errors.add(path + ": status needs durationMs or whileInside");
                }
            }
            case BUFF -> {
                need(errors, path, effect.type(), "buff", effect.buff());
                need(errors, path, effect.type(), "amount", effect.amount());
                need(errors, path, effect.type(), "durationMs", effect.durationMs());
            }
            case INTERRUPT -> need(errors, path, effect.type(), "durationMs", effect.durationMs());
            case TELEPORT -> {
                if (effect.distanceMode() == null && effect.amount() == null) errors.add(path + ": teleport needs distanceMode or amount");
            }
            case RESTORE_STATE -> need(errors, path, effect.type(), "delayMs", effect.delayMs());
            case DAMAGE_REDUCTION, DAMAGE_REFLECTION, DAMAGE_IMMUNITY -> {
                need(errors, path, effect.type(), "amount", effect.amount());
                need(errors, path, effect.type(), "durationMs", effect.durationMs());
            }
        }
    }

    private static void need(List<String> errors, String path, EffectType type, String field, Object value) {
        if (value == null) errors.add(path + ": " + type.name().toLowerCase() + " needs " + field);
    }
}
