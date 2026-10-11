package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.DistanceCalculator.between;

import com.example.botfight.simulation.core.orchestration.CombatLog;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.state.BotMovementService;
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.ApplyEffectsVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.HitVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TargetKind;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Verb;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Runs the resolveHits-stage verbs of a triggered ability (applyEffects on the owner, hit on the opposing
 * bots) through the {@link AbilityVerbs} executor.
 */
@Service
class AbilityEffectService {
    private final BotStateService botStateService;
    private final BotMovementService movementService;
    private final AbilityHitDetectionService hitDetectionService;

    AbilityEffectService(BotStateService botStateService,
                         BotMovementService movementService,
                         AbilityHitDetectionService hitDetectionService) {
        this.botStateService = botStateService;
        this.movementService = movementService;
        this.hitDetectionService = hitDetectionService;
    }

    /** Resolves the attacker's trigger verbs against one defender (the owner's own verbs included). */
    void resolveTriggeredAbility(Bot attacker, Bot defender, Arena arena) {
        AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(attacker);
        if (!hasTriggerVerbs(payload)) return;
        ResolveHost host = new ResolveHost(attacker, List.of(), arena, payload, null, Set.of());
        host.onlyDefender = defender;
        runTimeline(host, payload.verbs(), 0, AbilityVerbs.triggerEnd(payload.verbs()));
    }

    void resolveTriggeredAbilities(Bot attacker, List<Bot> bots, Arena arena) {
        AbilityExecutionPayload payload = AbilityExecutionPayload.fromTriggered(attacker);
        if (!hasTriggerVerbs(payload)) return;
        // Browser combat attaches the transient visual before applying any
        // effect (including teleport). Preserve that exact activation pose in
        // the authoritative frame so replay can use the same origin.
        AbilityExecutionPayload.Pose pose = payload.pose(attacker);
        attacker.visualOriginX = pose.x();
        attacker.visualOriginY = pose.y();
        attacker.visualOriginRotation = pose.rotation();
        AbilityState.Record record = AbilityState.record(attacker, payload.abilityId());
        ResolveHost host = new ResolveHost(attacker, bots, arena, payload, null,
                record == null || record.steps == null ? Set.of() : record.steps.hit);
        runTimeline(host, payload.verbs(), 0, AbilityVerbs.triggerEnd(payload.verbs()));
        persistActivationHits(attacker, host);
    }

    /** Resolves the timeline steps that came due on this tick: hit and applyEffects verbs, ability by ability. */
    void resolveDueSteps(Bot attacker, List<Bot> bots, Arena arena) {
        for (AbilityTimeline.DueStep step : attacker.dueSteps) {
            AbilityExecutionPayload payload = AbilityExecutionPayload.forAbility(step.abilityId());
            if (payload.contract() == null) continue;
            ResolveHost host = new ResolveHost(attacker, bots, arena, payload, step, step.hit());
            runTimeline(host, payload.verbs(), step.from(), step.to());
            persistActivationHits(attacker, host);
        }
    }

    /**
     * Runs the resolveHits verbs of {@code verbs[from..to)}, one atMs group at a time. The targets a
     * {@code "step"}-scoped hit touched are remembered for the group only.
     */
    private static void runTimeline(ResolveHost host, List<AbilityContracts.Verb> verbs, int from, int to) {
        int index = from;
        while (index < to) {
            int atMs = AbilityContracts.atMs(verbs.get(index));
            host.stepHit = new HashSet<>();
            for (; index < to && AbilityContracts.atMs(verbs.get(index)) == atMs; index += 1) {
                AbilityContracts.Verb verb = verbs.get(index);
                if (AbilityVerbs.stageOf(verb) != AbilityVerbs.Stage.RESOLVE_HITS) continue;
                host.beforeVerb(verb);
                AbilityVerbs.execute(verb, host);
            }
        }
    }

    /** Writes the targets an activation has hit back to its record when they changed (while the record is still there). */
    private static void persistActivationHits(Bot attacker, ResolveHost host) {
        if (host.activationHit.size() == host.activationHitCount) return;
        AbilityState.Record record = AbilityState.record(attacker, host.payload.abilityId());
        if (record == null || record.steps == null) return;
        record.steps.hit.clear();
        record.steps.hit.addAll(host.activationHit);
    }

    /** An ability that only spawns entities has nothing to resolve here. */
    private static boolean hasTriggerVerbs(AbilityExecutionPayload payload) {
        return payload != null && payload.verbs().stream()
                .anyMatch(verb -> !(verb instanceof AbilityContracts.SpawnVerb));
    }

    /** Where the resolveHits verbs run: the attacker, the roster they can hit, and what was already hit. */
    private final class ResolveHost implements AbilityVerbs.Host {
        private final Bot attacker;
        private final List<Bot> bots;
        private final Arena arena;
        private final AbilityExecutionPayload payload;
        /** The due timeline step this run resolves, or null for the verbs of the trigger tick. */
        private final AbilityTimeline.DueStep step;
        /** Slots an {@code "activation"}-scoped hit has touched in this cast (kept in the activation's record). */
        final Set<Integer> activationHit;
        final int activationHitCount;
        /** Slots a {@code "step"}-scoped hit has touched in the atMs group being resolved. */
        Set<Integer> stepHit = new HashSet<>();
        /** When set, hit verbs resolve against this bot only (the single-defender entry point). */
        Bot onlyDefender;

        ResolveHost(Bot attacker, List<Bot> bots, Arena arena, AbilityExecutionPayload payload,
                    AbilityTimeline.DueStep step, Set<Integer> activationHit) {
            this.attacker = attacker;
            this.bots = bots;
            this.arena = arena;
            this.payload = payload;
            this.step = step;
            this.activationHit = new java.util.TreeSet<>(activationHit);
            this.activationHitCount = this.activationHit.size();
        }

        /** The activation serial hit refunds are paid once per. */
        private int activationSerial() {
            return step == null ? attacker.activationSerial : step.serial();
        }

        /** The pose a verb fires from: the trigger pose, or for a delayed step the pose its verb names. */
        private AbilityExecutionPayload.Pose poseFor(Verb verb) {
            String pose = AbilityContracts.poseOf(verb);
            if (step == null || pose == null) return payload.pose(attacker);
            if ("captured".equals(pose) && step.hasPose()) {
                return new AbilityExecutionPayload.Pose(step.poseX(), step.poseY(), step.poseRotation());
            }
            AbilityContracts.Spawn origin = verb instanceof HitVerb hit ? hit.origin() : null;
            return payload.currentPose(attacker, origin);
        }

        /** A delayed step emits its visual from the pose it fires from, when it fires. */
        void beforeVerb(Verb verb) {
            if (step == null || AbilityContracts.atMs(verb) <= 0) return;
            boolean visual = verb instanceof HitVerb hit ? hit.visual() != null
                    : verb instanceof ApplyEffectsVerb apply && apply.visual() != null;
            if (!visual) return;
            AbilityExecutionPayload.Pose pose = poseFor(verb);
            attacker.visualOriginX = pose.x();
            attacker.visualOriginY = pose.y();
            attacker.visualOriginRotation = pose.rotation();
        }

        /** The targets a hit verb's {@code oncePerTarget} scope has already used up, or null when it has none. */
        private Set<Integer> onceSet(HitVerb verb) {
            if ("step".equals(verb.oncePerTarget())) return stepHit;
            if ("activation".equals(verb.oncePerTarget())) return activationHit;
            return null;
        }

        @Override
        public void applyEffects(ApplyEffectsVerb verb) {
            if (!verb.ownerTarget()) return;
            // Self effects (heals, buffs, Rewind) land on the owner; nothing else is touched.
            AbilityExecutionPayload.Pose pose = poseFor(verb);
            applyContractEffects(attacker, null, payload, arena, pose.x(), pose.y(), false, verb.effects(), null);
        }

        @Override
        public void hit(HitVerb verb) {
            if (!verb.targets().contains(TargetKind.BOT)) return;
            Set<Integer> once = onceSet(verb);
            if (onlyDefender != null) {
                resolveHit(verb, onlyDefender, false, once);
                return;
            }
            boolean teleports = payload.activation().teleportOncePerActivation();
            AbilityExecutionPayload.Pose pose = poseFor(verb);
            List<Bot> candidates = bots.stream()
                    .filter(defender -> defender != attacker && defender.entityTeam() != attacker.entityTeam())
                    .filter(defender -> once == null || !once.contains(defender.slot))
                    .toList();
            if (!teleports && !verb.nearestOnly()) {
                candidates.forEach(defender -> resolveHit(verb, defender, false, once));
                return;
            }
            // The displacement of a teleporting ability is consumed by the nearest valid target so roster order
            // cannot overwrite the landing position.
            List<Bot> touched = candidates.stream()
                    .filter(defender -> defender.hp > 0)
                    .filter(defender -> hitDetectionService.abilityHitsTarget(attacker, defender, pose, verb))
                    .sorted(Comparator.comparingDouble(defender -> between(pose.x(), pose.y(), defender.x, defender.y)))
                    .toList();
            if (verb.nearestOnly()) touched = touched.stream().limit(1).toList();
            boolean teleportApplied = false;
            for (Bot defender : touched) {
                boolean canApplyTeleport = !defender.ignoresHostileEffects();
                resolveHit(verb, defender, teleports && teleportApplied, once);
                if (!teleportApplied && canApplyTeleport) teleportApplied = true;
            }
        }

        /** One hit verb against one opposing bot: geometry test, then the effects in declaration order. */
        private void resolveHit(HitVerb verb, Bot defender, boolean skipTeleport, Set<Integer> once) {
            if (defender == null || defender.hp <= 0) return;
            if (defender != attacker && defender.entityTeam() == attacker.entityTeam()) return;
            AbilityExecutionPayload.Pose pose = poseFor(verb);
            if (!hitDetectionService.abilityHitsTarget(attacker, defender, pose, verb)) return;
            if (defender.ignoresHostileEffects()) return;
            boolean landedOnEnemy = applyContractEffects(attacker, defender, payload, arena, pose.x(), pose.y(),
                    skipTeleport, verb.effects(), verb.hitbox());
            if (once != null) once.add(defender.slot);
            if (landedOnEnemy) {
                BotStateService.recordEnemyHit(attacker, payload.abilityId(), activationSerial());
            }
        }
    }

    /** Applies the effects that land on a bot and reports whether any of them landed on a living defender. */
    private boolean applyContractEffects(Bot attacker, Bot defender, AbilityExecutionPayload payload, Arena arena,
                                         double sourceX, double sourceY, boolean skipTeleport,
                                         List<AbilityContracts.Effect> effects, AbilityContracts.Hitbox hitbox) {
        Integer previousAbility = CombatLog.setAbility(payload.abilityId());
        try {
            return applyContractEffectsScoped(attacker, defender, payload, arena, sourceX, sourceY, skipTeleport,
                    effects, hitbox);
        } finally {
            CombatLog.setAbility(previousAbility);
        }
    }

    private boolean applyContractEffectsScoped(Bot attacker, Bot defender, AbilityExecutionPayload payload,
                                               Arena arena, double sourceX, double sourceY, boolean skipTeleport,
                                               List<AbilityContracts.Effect> effects,
                                               AbilityContracts.Hitbox hitbox) {
        Effects.Context ctx = new Effects.Context();
        ctx.abilityId = payload.abilityId();
        ctx.range = Effects.hitboxRange(hitbox);
        ctx.ownerSlot = attacker.slot;
        ctx.sourceX = sourceX;
        ctx.sourceY = sourceY;
        // A push leads away from where the attacker stands, not from where the ability was fired.
        ctx.pushOriginX = attacker.x;
        ctx.pushOriginY = attacker.y;
        ctx.damageMultiplier = botStateService.damageMultiplier(attacker);
        ctx.arena = arena == null ? null : new ArenaBounds(arena.width(), arena.height());
        ctx.owner = attacker;
        ctx.defender = defender;
        ctx.bot = defender;
        ctx.skipTeleport = skipTeleport;
        ctx.host = new Effects.Host() {
            @Override
            public void damage(AbilityEntityBot target, double amount, int ownerSlot, double fromX, double fromY) {
                if (attacker != null && attacker.slot == ownerSlot) {
                    botStateService.applyDamageFrom(attacker, (Bot) target, amount, fromX, fromY);
                } else {
                    botStateService.applyDamage((Bot) target, amount, ownerSlot, fromX, fromY);
                }
            }

            @Override
            public Double ownerDamageMultiplier(int ownerSlot) {
                return botStateService.damageMultiplier(attacker);
            }

            @Override
            public void teleport(Bot owner, Bot target, double distance) {
                movementService.applyTeleport(owner, target, distance, payload, arena);
            }
        };
        boolean landedOnEnemy = false;
        for (AbilityContracts.Effect effect : effects) {
            if (!AbilityContracts.effectTargetsBot(effect)) continue;
            if (defender != null && defender.hp > 0 && Effects.ENEMY_HIT_EFFECT_TYPES.contains(effect.type())) {
                landedOnEnemy = true;
            }
            Effects.apply(effect, ctx);
        }
        return landedOnEnemy;
    }
}
