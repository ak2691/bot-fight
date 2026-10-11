package com.example.botfight.simulation.ecs.contracts;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts.AbilityContract;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.AbilityPhase;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Activation;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.ApplyEffectsVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Effect;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EmitVisualVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EntityContract;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EventSchedule;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.FaceVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Falloff;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Health;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.HitVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Hitbox;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.InitialState;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Lifetime;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.MoveVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.PatternType;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.PhaseEvent;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.PhaseEventType;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.PhaseMovement;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.RemoveVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.SelectableOwner;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Spawn;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.SpawnPattern;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.SpawnVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TargetKind;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TargetPolicy;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TransitionVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Trigger;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Verb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Visual;
import com.example.botfight.simulation.gameconfig.GameplayData;
import com.example.botfight.simulation.gameconfig.GameplayData.AbilityData;
import com.example.botfight.simulation.gameconfig.GameplayData.EffectData;
import com.example.botfight.simulation.gameconfig.GameplayData.EntityData;
import com.example.botfight.simulation.gameconfig.GameplayData.EventData;
import com.example.botfight.simulation.gameconfig.GameplayData.PhaseData;
import com.example.botfight.simulation.gameconfig.GameplayData.VerbData;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Turns the shared gameplay data into the contract records the simulation reads. This is a field-for-field
 * copy: the data holds every value, and the JSON nulls of Java's primitive components (a status has no
 * amount, a phase has no start offset) read as 0 and false. Four fields differ in shape from the browser's
 * and are derived here from their JSON form: a buff's subtype is its {@code buff}, a restore-state effect's
 * durationMs is its {@code delayMs}, an activation captures when it declares a capture map, and a spawn's
 * target position, clamp radius and fallback target come from {@code targeting} (a fallback of
 * "owner.x"/"owner.y", which only the browser resolves, reads as the arena fallback 500/400).
 */
final class GameplayContracts {
    private static final double FALLBACK_TARGET_X = 500;
    private static final double FALLBACK_TARGET_Y = 400;

    private GameplayContracts() {}

    static Map<Integer, AbilityContract> abilities() {
        return abilities(GameplayData.get());
    }

    static Map<Integer, AbilityContract> abilities(GameplayData data) {
        Map<Integer, AbilityContract> contracts = new TreeMap<>();
        for (AbilityData ability : data.abilities().abilities()) {
            contracts.put(ability.id(), contract(ability));
        }
        return Collections.unmodifiableMap(new LinkedHashMap<>(contracts));
    }

    private static AbilityContract contract(AbilityData ability) {
        List<Verb> onTrigger = ability.onTrigger().stream().map(GameplayContracts::verb).toList();
        Map<String, EntityContract> entities = new LinkedHashMap<>();
        ability.entities().forEach((entityType, entity) -> entities.put(entityType, entity(ability.id(), entityType, entity)));
        String spawned = onTrigger.stream().filter(SpawnVerb.class::isInstance).map(SpawnVerb.class::cast)
                .map(SpawnVerb::entity).filter(entities::containsKey).findFirst()
                .orElse(entities.isEmpty() ? null : entities.keySet().iterator().next());
        return new AbilityContract(ability.id(), activation(ability.activation()), onTrigger, entities, spawned);
    }

    private static EntityContract entity(int abilityId, String entityType, EntityData data) {
        GameplayData.TargetingData targeting = data.targeting();
        return new EntityContract(
                abilityId,
                entityType,
                data.runtimeType(),
                data.category(),
                spawn(data.spawn(), targeting),
                targeting.owner() != null ? SelectableOwner.OWNER : SelectableOwner.NONE,
                new Lifetime(data.lifetime().timerMode(), zero(data.lifetime().duration()), zero(data.lifetime().add())),
                new InitialState(flag(data.initialState().armed()), flag(data.initialState().damageMultiplierFromOwner())),
                data.phases().stream().map(GameplayContracts::phase).toList());
    }

    private static Spawn spawn(GameplayData.SpawnData data, GameplayData.TargetingData targeting) {
        boolean targetPosition = targeting != null && "target".equals(targeting.position());
        return new Spawn(data.offset().x(), data.offset().y(), targetPosition, data.rotation(), data.rotationSpace(),
                targeting == null || targeting.clampToRadius() == null ? 0 : targeting.clampToRadius(),
                targeting != null && targeting.defaultX() instanceof Number number ? number.doubleValue() : FALLBACK_TARGET_X,
                targeting != null && targeting.defaultY() instanceof Number number ? number.doubleValue() : FALLBACK_TARGET_Y);
    }

    private static Activation activation(GameplayData.ActivationData data) {
        return new Activation(data.targetMode(), data.capture() != null, data.phaseFacingDefault(),
                flag(data.teleportOncePerActivation()));
    }

    private static AbilityPhase phase(PhaseData data) {
        Map<PhaseEventType, PhaseEvent> events = new LinkedHashMap<>();
        data.on().forEach((type, event) -> events.put(type, event(event)));
        return new AbilityPhase(
                data.id(), data.type(), movement(data.movement()), trigger(data.trigger()), hitbox(data.hitbox()),
                data.health() == null ? null : new Health(zero(data.health().hp()), zero(data.health().maxHp()),
                        flag(data.health().allowFriendlyDamage())),
                visual(data.visual()), events, data.durationMs(),
                flag(data.transitionOnly()), flag(data.skipOwner()), zero(data.startMs()));
    }

    private static PhaseMovement movement(GameplayData.MovementData data) {
        return data == null ? null : new PhaseMovement(data.mode(), zero(data.unitsPerTick()),
                zero(data.turnDegrees()), zero(data.size()), data.direction());
    }

    private static Trigger trigger(GameplayData.TriggerData data) {
        return data == null ? null : new Trigger(data.radius(), data.lifetimeMs(), flag(data.attackHits()),
                flag(data.projectileOverlap()), flag(data.botContact()), flag(data.chain()));
    }

    private static Hitbox hitbox(GameplayData.HitboxData data) {
        return data == null ? null : new Hitbox(data.shape(), data.radius(), data.range(), data.arc(),
                data.radiusMultiplier(), data.width(), data.length(), flag(data.includeTargetRadius()));
    }

    private static Visual visual(GameplayData.VisualData data) {
        return data == null ? null : new Visual(data.type(), data.state(), zero(data.visualSize()), data.visibleMs());
    }

    private static Effect effect(EffectData data) {
        Falloff falloff = data.falloff() == null ? null : new Falloff(data.falloff().minAmount(),
                data.falloff().maxAmount(), data.falloff().minDurationMs(), data.falloff().maxDurationMs(),
                data.falloff().falloffStart(), data.falloff().falloffEnd());
        String subtype = data.type() == EffectType.BUFF ? data.buff() : data.subtype();
        int durationMs = zero(data.type() == EffectType.RESTORE_STATE ? data.delayMs() : data.durationMs());
        return new Effect(data.type(), subtype, zero(data.amount()), durationMs, flag(data.runtimeComputed()),
                data.recipient(), flag(data.requiresConfirmedDamage()), flag(data.mirrorsDamage()),
                data.distanceMode(), falloff, data.intervalMs(), data.movementLockMs(), data.targetKinds());
    }

    private static List<Effect> effects(List<EffectData> data) {
        return data == null ? List.of() : data.stream().map(GameplayContracts::effect).toList();
    }

    private static List<TargetKind> kinds(List<String> targets) {
        return targets == null ? List.of() : targets.stream()
                .filter(target -> !AbilityContracts.OWNER_TARGET.equals(target))
                .map(TargetKind::valueOf).toList();
    }

    private static Verb verb(VerbData data) {
        return switch (data.verb()) {
            case "hit" -> new HitVerb(hitbox(data.hitbox()), kinds(data.targets()), effects(data.effects()),
                    flag(data.nearestOnly()), data.oncePerTarget(), data.aim(),
                    data.origin() == null ? null : spawn(data.origin(), null),
                    data.knockbackDirection(), data.pullDirection(), visual(data.visual()),
                    zero(data.atMs()), data.pose());
            case "applyEffects" -> new ApplyEffectsVerb(
                    data.targets() != null && data.targets().contains(AbilityContracts.OWNER_TARGET),
                    effects(data.effects()), data.knockbackDirection(), data.pullDirection(), visual(data.visual()),
                    zero(data.atMs()), data.pose());
            case "spawn" -> new SpawnVerb(data.entity(), pattern(data.pattern()), zero(data.atMs()), data.pose());
            case "move" -> new MoveVerb(data.distance(), data.unitsPerTick(), zero(data.trailMs()), visual(data.visual()));
            case "face" -> new FaceVerb(data.target(), visual(data.visual()));
            case "transition" -> new TransitionVerb(data.to());
            case "remove" -> new RemoveVerb();
            case "emitVisual" -> new EmitVisualVerb(data.visualType(), data.visibleMs(), data.visualSize());
            default -> throw new IllegalStateException("Unknown verb " + data.verb());
        };
    }

    private static SpawnPattern pattern(GameplayData.PatternData data) {
        return data == null ? null : new SpawnPattern(PatternType.valueOf(data.type().toUpperCase()),
                data.count(), zero(data.spreadDeg()), zero(data.spacing()));
    }

    private static PhaseEvent event(EventData data) {
        return new PhaseEvent(data.targets(),
                new EventSchedule(data.schedule().mode(), data.schedule().intervalMs(),
                        flag(data.schedule().startImmediately()), data.schedule().count()),
                data.targetPolicy() == null ? null : new TargetPolicy(data.targetPolicy().mode(),
                        data.targetPolicy().intervalStat(), data.targetPolicy().intervalMs()),
                flag(data.recheckCollisionOnTransition()), flag(data.nearestOnly()), flag(data.waitForHit()),
                data.verbs().stream().map(GameplayContracts::verb).toList());
    }

    private static boolean flag(Boolean value) {
        return value != null && value;
    }

    private static int zero(Integer value) {
        return value == null ? 0 : value;
    }

    private static double zero(Double value) {
        return value == null ? 0 : value;
    }
}
