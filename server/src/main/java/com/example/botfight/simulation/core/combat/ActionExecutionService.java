package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Vector;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.logic.CustomVariableActionService;
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.core.state.BotMovementService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StaminaSystem;
import com.example.botfight.simulation.gameconfig.MovementConfig;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.AbilityChannels;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Orchestrates generic action selection, activation, and state transitions. */
@Service
public class ActionExecutionService {
    private static final int STEP_MS = 100;

    private final BotStateService botStateService;
    private final BotMovementService movementService;
    private final AbilityEffectService abilityEffectService;
    private final ArenaEntityCombatService entityCombatService;
    private final CustomVariableActionService customVariableActionService;

    @Autowired
    public ActionExecutionService(
            BotStateService botStateService,
            BotMovementService movementService,
            AbilityEffectService abilityEffectService,
            ArenaEntityCombatService entityCombatService,
            CustomVariableActionService customVariableActionService) {
        this.botStateService = botStateService;
        this.movementService = movementService;
        this.abilityEffectService = abilityEffectService;
        this.entityCombatService = entityCombatService;
        this.customVariableActionService = customVariableActionService;
    }

    /** Focused-test constructor that builds the phase-driven combat collaborators. */
    public ActionExecutionService(BotStateService botStateService) {
        this.botStateService = botStateService;
        this.movementService = new BotMovementService();
        AbilityHitDetectionService hitDetectionService = new AbilityHitDetectionService();
        this.abilityEffectService = new AbilityEffectService(botStateService, movementService, hitDetectionService);
        this.entityCombatService = new ArenaEntityCombatService(hitDetectionService);
        this.customVariableActionService = new CustomVariableActionService();
    }

    public boolean selectedAbilityReady(Bot bot, int ability) {
        return selectedAbilityReady(bot, AbilityExecutionPayload.forAbility(ability));
    }

    private boolean selectedAbilityReady(Bot bot, AbilityExecutionPayload payload) {
        if (payload == null || bot == null || !hasAbility(bot, payload.abilityId()))
            return false;
        String channel = AbilityChannels.channel(payload.abilityId());
        // A wind-up in this ability's channel (its own included) stops it from starting; other channels never do.
        if (AbilityState.channelWindingUp(bot, channel))
            return false;
        if (AbilityState.activeRemainingMs(bot, payload.abilityId()) > 0)
            return false;
        // A status that blocks the channel and reports it not ready (slow, for the dash channel).
        if (AbilityChannels.notReadyStatuses(channel).stream().anyMatch(status -> BotStateService.statusActive(bot, status)))
            return false;
        if (!StaminaSystem.abilityStaminaReady(bot, payload.abilityId()))
            return false;
        var definition = payload.definition();
        return selectedAbilityCooldownMs(bot, payload.abilityId()) <= 0
                && !anotherAbilityActive(bot, payload.abilityId())
                && (definition.charges() <= 0
                        || botStateService.abilityCharges(bot, payload.abilityId()) > 0)
                && !(definition.resourceModel() == Abilities.ResourceModel.RELOAD_WHEN_EMPTY
                        && botStateService.abilityRechargeMs(bot, payload.abilityId()) > 0);
    }

    /**
     * Action selection may keep an already-started preparation selected. This
     * is deliberately broader than selectedAbilityReady, which is the strict
     * value exposed to bot conditionals for a new activation.
     */
    public boolean selectedAbilityExecutable(Bot bot, int ability) {
        return selectedAbilityExecutable(bot, AbilityExecutionPayload.forAbility(ability));
    }

    private boolean selectedAbilityExecutable(Bot bot, AbilityExecutionPayload payload) {
        if (payload == null || bot == null || !hasAbility(bot, payload.abilityId()))
            return false;
        boolean continuingPreparation = AbilityState.windupRemainingMs(bot, payload.abilityId()) > 0;
        return continuingPreparation || selectedAbilityReady(bot, payload);
    }

    /** The longest of the ability's cooldown, its reload and the time to afford its stamina cost. */
    public int selectedAbilityCooldownMs(Bot bot, int ability) {
        if (bot == null || !hasAbility(bot, ability))
            return 0;
        if (windingUpBlocks(bot, ability) || AbilityState.activeRemainingMs(bot, ability) > 0)
            return 0;
        return Math.max(Math.max(AbilityState.cooldownRemainingMs(bot, ability),
                botStateService.abilityRechargeMs(bot, ability)),
                StaminaSystem.staminaWaitMs(bot, ability));
    }

    /** A wind-up in the ability's own channel hides its cooldown readout; another channel's wind-up never does. */
    private static boolean windingUpBlocks(Bot bot, int ability) {
        return AbilityState.channelWindingUp(bot, AbilityChannels.channel(ability));
    }

    public boolean selectedAbilityOnCooldown(Bot bot, int ability) {
        return bot != null && hasAbility(bot, ability)
                && !windingUpBlocks(bot, ability)
                && AbilityState.activeRemainingMs(bot, ability) <= 0
                && selectedAbilityCooldownMs(bot, ability) > 0;
    }

    public int selectedAbilityCharges(Bot bot, int ability) {
        if (bot == null || !hasAbility(bot, ability))
            return 0;
        if (!Abilities.hasCharges(ability))
            return 0;
        return botStateService.abilityCharges(bot, ability);
    }

    public int selectedAbilityActiveMs(Bot bot, int ability) {
        return bot == null || !hasAbility(bot, ability)
                ? 0
                : AbilityState.activeRemainingMs(bot, ability);
    }

    /** Milliseconds since the ability last hit an enemy bot; {@link BotStateService#NEVER_HIT_MS} if it never has. */
    public int selectedAbilitySinceHitMs(Bot bot, int ability) {
        return bot == null ? BotStateService.NEVER_HIT_MS
                : bot.abilityLastHitAgeMs.getOrDefault(ability, BotStateService.NEVER_HIT_MS);
    }

    public boolean selectedAbilityPresent(Bot bot, int ability) {
        return bot != null && hasAbility(bot, ability);
    }

    public Integer abilityForAction(Object action) {
        return AbilityContracts.abilityForAction(action);
    }

    public Integer configuredAbilityAction(StrategyBlock block) {
        return block != null ? abilityForAction(block.action()) : null;
    }

    public boolean abilityUsesTarget(StrategyBlock block) {
        return block != null && BotLogicContracts.actionUsesSelectableTarget(
                block.action(), block.movementMode(), block.targetMode());
    }

    public void applyCustomVariableAction(
            Bot bot,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            ConditionResolutionService conditionResolutionService,
            StrategyBlock block) {
        applyCustomVariableAction(bot, opponent, entities, arena, conditionResolutionService, block,
                bot == null ? BotLogicContracts.BRAIN_SCHEMA_V1 : bot.brainSchemaVersion);
    }

    public void applyCustomVariableAction(
            Bot bot,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            ConditionResolutionService conditionResolutionService,
            StrategyBlock block,
            String coordinateVersion) {
        customVariableActionService.apply(bot, opponent, entities, arena,
                conditionResolutionService, block, coordinateVersion);
    }

    public Vector movementVector(StrategyBlock block, Bot player, Entity target) {
        return movementService.movementVector(block, player, target);
    }

    public void execute(Bot bot, Action action, Arena arena) {
        if (bot.hp <= 0) {
            botStateService.beginTick(bot);
            return;
        }
        // Stamina lockouts count down (and stamina regenerates) as the tick starts and spends below
        // restart them. Whether Dash, a cancel or a sprint is allowed is judged on the state the
        // previous tick left (the bot's fields until finish), which is what conditions saw.
        StaminaSystem.Tick stamina = StaminaSystem.begin(bot, STEP_MS);

        // The browser evaluates the selected action against the pre-tick
        // status/resource state, then advances bot-owned systems afterward.
        // Capture those pre-tick facts before movement or activation mutates
        // the working bot.
        boolean slowedWasActive = BotStateService.statusActive(bot, "slow");
        boolean hitStaggerWasActive = BotStateService.statusActive(bot, "hit-stagger");
        boolean stunnedWasActive = BotStateService.statusActive(bot, "stun");
        boolean silencedWasActive = BotStateService.statusActive(bot, "silence");
        // Every ability that activates this step keeps its stages for the step.
        Set<Integer> justActivatedAbilityIds = new LinkedHashSet<>();
        // The statuses that block any channel, as they were when the tick started.
        Set<String> blockingAtStart = new HashSet<>();
        for (String channel : List.of(AbilityChannels.ABILITY, AbilityChannels.DASH)) {
            for (String status : AbilityChannels.blockingStatuses(channel)) {
                if (BotStateService.statusActive(bot, status)) blockingAtStart.add(status);
            }
        }

        if (stunnedWasActive) {
            movementService.applyTickMovement(bot, action, arena, false,
                    slowedWasActive, hitStaggerWasActive);
            BotStateService.interruptCurrentAbility(bot);
            stamina.finish(bot);
            botStateService.beginTick(bot);
            return;
        }

        // A wind-up is locked once started, so Cancel Wind-up is handled before the locked
        // continuation. It only works while preparing with enough stamina; otherwise it does nothing.
        boolean preparationLocked = AbilityState.isWindingUp(bot) && !silencedWasActive;
        boolean cancelsWindup = preparationLocked && action.cancelWindup()
                && StaminaSystem.canCancelWindup(bot);
        if (cancelsWindup) {
            StaminaSystem.clearWindup(bot);
            stamina.spend(StaminaSystem.cancelCost());
        }

        AbilityExecutionPayload payload = cancelsWindup ? null : selectedAbilityPayload(bot, action);
        // The ability's channel decides which statuses stop it: silence stops the ability channel, slow the dash.
        boolean blockedByStatus = payload != null && channelBlockedBy(payload.abilityId(), blockingAtStart);
        boolean blockedByAbilityState = payload != null
                && !blockedByStatus
                && !selectedAbilityExecutable(bot, payload);

        // Sprint applies on any tick that actually moves while the bot has stamina, including while an
        // ability is starting, winding up or active. Movement-lock, stun (handled above) and 0 stamina stop it.
        boolean sprinting = action.sprint()
                && Math.hypot(action.dx(), action.dy()) > 0.001
                && StaminaSystem.stamina(bot) > 0
                && !BotStateService.statusActive(bot, "movement-lock");
        // Fast turn doubles the rotation step on a tick that actually rotates, while the previous tick
        // left enough stamina. It stacks with sprint and does not depend on attacking.
        boolean fastTurning = action.fastTurn()
                && Math.abs(Math.max(-1, Math.min(1, action.dRot()))) > 0.001
                && StaminaSystem.canFastTurn(bot);
        movementService.applyTickMovement(bot, action, arena, false,
                slowedWasActive, hitStaggerWasActive, sprinting, fastTurning);
        if (sprinting) stamina.spend(MovementConfig.SPRINT_DRAIN_PER_TICK);
        if (fastTurning) stamina.spend(MovementConfig.FAST_TURN_DRAIN_PER_TICK);
        stamina.setSprinting(sprinting);
        stamina.setFastTurning(fastTurning);

        boolean abilityTriggered = false;
        if (blockedByStatus || blockedByAbilityState) {
            cancelPreparation(bot, payload);
        } else if (payload != null && !channelBlockedNow(bot, payload.abilityId())) {
            AbilityExecutionPayload activated = activateAbility(bot, payload, arena, stamina);
            if (activated != null) {
                setTriggeredPayload(bot, activated);
                justActivatedAbilityIds.add(activated.abilityId());
                abilityTriggered = true;
            }
        } else if (payload != null && AbilityState.isWindingUp(bot)) {
            cancelPreparation(bot, payload);
        }

        // Channels are independent: the dash channel starts after the ability (so it never changes where that
        // ability was captured), a wind-up in progress does not stop it, and silence does not either. Slow
        // still does (its blocking statuses), and stun returned above. When the ability also started this
        // tick it keeps the trigger so its hit resolves; the dash still counts as an activation.
        AbilityExecutionPayload dashPayload = AbilityExecutionPayload.dashChannel(action);
        if (dashPayload != null && !channelBlockedBy(dashPayload.abilityId(), blockingAtStart)) {
            AbilityExecutionPayload dashed = activateAbility(bot, dashPayload, arena, stamina);
            if (dashed != null) {
                if (abilityTriggered) bot.activationSerial++;
                else setTriggeredPayload(bot, dashed);
                justActivatedAbilityIds.add(dashed.abilityId());
            }
        }

        // The timeline steps that come due on this tick, derived from the active time left before the stage
        // advances: their spawn verbs create entities now, from the pose they name; their hit and applyEffects
        // verbs resolve with the trigger verbs.
        AbilityTimeline.stampSerial(bot, justActivatedAbilityIds);
        List<AbilityTimeline.DueStep> dueSteps = AbilityTimeline.due(bot, STEP_MS, justActivatedAbilityIds);

        stamina.finish(bot);
        botStateService.beginTick(bot, justActivatedAbilityIds);
        if (bot.triggeredAbilityPayload != null) {
            bot.abilitySpawn = new java.util.ArrayList<>();
            spawnAbilityEntities(bot, bot.triggeredAbilityPayload, arena);
        }
        bot.dueSteps = dueSteps;
        if (!dueSteps.isEmpty()) spawnDueEntities(bot, dueSteps, arena);
    }

    public void resolveTriggeredAbilities(Bot attacker, Bot defender, Arena arena) {
        abilityEffectService.resolveTriggeredAbility(attacker, defender, arena);
    }

    /** True when one of the ability channel's blocking statuses is in {@code active}. */
    private static boolean channelBlockedBy(int abilityId, Set<String> active) {
        return AbilityChannels.blockingStatuses(AbilityChannels.channel(abilityId)).stream().anyMatch(active::contains);
    }

    private static boolean channelBlockedNow(Bot bot, int abilityId) {
        return AbilityChannels.blockingStatuses(AbilityChannels.channel(abilityId)).stream()
                .anyMatch(status -> BotStateService.statusActive(bot, status));
    }

    public void resolveTriggeredAbilities(Bot attacker, List<Bot> bots, Arena arena) {
        abilityEffectService.resolveTriggeredAbilities(attacker, bots, arena);
        abilityEffectService.resolveDueSteps(attacker, bots, arena);
    }

    public ArenaEntity applyEffectsToEntity(ArenaEntity entity, List<Bot> bots,
            List<ArenaEntity> entities, ArenaBounds arena, int stepMs) {
        return entityCombatService.applyEffectsToEntity(entity, bots, entities, arena);
    }

    public boolean mineHitByCurrentAttack(ArenaEntity mine, List<Bot> bots,
            List<ArenaEntity> entities) {
        return entityCombatService.mineHitByCurrentAttack(mine, bots, entities);
    }

    private AbilityExecutionPayload selectedAbilityPayload(Bot bot, Action action) {
        Integer preparing = AbilityState.preparingAbilityId(bot);
        if (preparing != null && !channelBlockedNow(bot, preparing)) {
            AbilityState.Record record = AbilityState.record(bot, preparing);
            return AbilityExecutionPayload.forAbility(preparing)
                    .withPreparationTarget(record.targetX, record.targetY);
        }
        return AbilityExecutionPayload.abilityChannel(action);
    }

    private void setTriggeredPayload(Bot bot, AbilityExecutionPayload payload) {
        AbilityExecutionPayload captured = payload.capture(bot);
        bot.triggeredAbilityPayload = captured;
        bot.triggeredAbility = captured.actionId();
        bot.activationSerial++;
    }

    private AbilityExecutionPayload activateAbility(
            Bot bot, AbilityExecutionPayload payload, Arena arena, StaminaSystem.Tick stamina) {
        if (!selectedAbilityExecutable(bot, payload))
            return null;
        int windup = payload.definition().windupMs();
        if (windup > 0) {
            boolean continuingPreparation = AbilityState.windupRemainingMs(bot, payload.abilityId()) > 0;
            // The windup record's remainingMs is the countdown exposed to bot logic and replay. The
            // current fixed step is consumed before checking activation.
            int remainingMs = continuingPreparation
                    ? Math.max(0, AbilityState.windupRemainingMs(bot, payload.abilityId()) - STEP_MS)
                    : Math.max(0, windup - STEP_MS);
            AbilityState.Record record = AbilityState.ensure(bot, payload.abilityId());
            if (!continuingPreparation) {
                record.targetX = payload.targetX();
                record.targetY = payload.targetY();
            }
            record.stage = AbilityState.Stage.WINDUP;
            record.remainingMs = remainingMs;
            record.cooldownMs = 0;
            if (remainingMs > 0)
                return null;
        }
        // Only an ability's own wind-up ends here; a dash starting beside another ability's wind-up leaves it be.
        if (AbilityState.stage(bot, payload.abilityId()) == AbilityState.Stage.WINDUP) {
            AbilityState.ready(bot, payload.abilityId());
        }
        if (payload.definition().charges() > 0) {
            botStateService.consumeAbilityCharge(bot, payload.abilityId());
        }
        int activeMs = activationActiveMs(payload);
        int cooldownMs = activationCooldownMs(bot, payload, 1.0 / bot.attackSpeedMultiplier);
        BotStateService.startAbilityActive(bot, payload.abilityId(), activeMs);
        botStateService.setAbilityCooldown(bot, payload.abilityId(), cooldownMs);
        // An ability that declares a stamina cost (the dash channel) pays it on activation.
        stamina.spendForAbility(payload.abilityId());
        // The act-stage verbs: the owner faces its target (and the pose is captured again), then moves.
        ActHost host = new ActHost(bot, payload.capture(bot), arena);
        AbilityVerbs.run(payload.verbs(), AbilityVerbs.Stage.ACT, host);
        AbilityTimeline.start(bot, host.activated, activeMs);
        return host.activated;
    }

    /** Where the act-stage verbs run: the owner bot as the tick starts its ability. */
    private final class ActHost implements AbilityVerbs.Host {
        private final Bot bot;
        private final Arena arena;
        AbilityExecutionPayload activated;

        ActHost(Bot bot, AbilityExecutionPayload activated, Arena arena) {
            this.bot = bot;
            this.activated = activated;
            this.arena = arena;
        }

        @Override
        public void face(AbilityContracts.FaceVerb verb) {
            if (Double.isFinite(activated.targetX()) && Double.isFinite(activated.targetY())) {
                bot.rotation = vectorBearing(activated.targetX() - bot.x, activated.targetY() - bot.y);
                activated = activated.capture(bot);
            }
        }

        @Override
        public void move(AbilityContracts.MoveVerb verb) {
            if (bot.dashRemaining <= 0) movementService.startDash(bot, activated, arena, verb);
        }
    }

    /**
     * Charged abilities use the short cooldown only when another charge
     * remains. The final charge goes directly to its reload/recharge gate.
     */
    private int activationCooldownMs(Bot bot, AbilityExecutionPayload payload, double cooldownMultiplier) {
        var definition = payload.definition();
        if (definition.charges() > 0
                && botStateService.abilityCharges(bot, payload.abilityId()) <= 0)
            return 0;
        double startMultiplier = BotStateService.statusActive(bot, "overclock")
                ? Math.min(1.0, Math.max(0.0, BotStateService.statusEffectValue(
                        bot, "overclock", "cooldown_modifier", "multiplier", 1.0)))
                : 1.0;
        return (int) Math.round(definition.cooldownMs() * cooldownMultiplier * startMultiplier);
    }

    private static int activationActiveMs(AbilityExecutionPayload payload) {
        // Defensive effects and Overclock own their duration as statuses, not
        // as post-activation action locks. Other short-lived combat visuals
        // retain their explicit active fallback.
        boolean hasPhaseStatus = payload.contract().triggerEffects().stream()
                .anyMatch(effect -> effect.type() == EffectType.DAMAGE_REDUCTION
                || effect.type() == EffectType.DAMAGE_IMMUNITY
                || effect.type() == EffectType.DAMAGE_REFLECTION
                || (effect.type() == EffectType.BUFF && "overclock".equals(effect.subtype())));
        if (hasPhaseStatus) {
            return 0;
        }
        var definition = payload.definition();
        if (spawnsEntity(payload) && definition.activeMs() == 0)
            return 0;
        return definition.activeMs() > 0 ? definition.activeMs()
                : definition.durationMs() > 0 ? definition.durationMs() : 0;
    }

    private static boolean spawnsEntity(AbilityExecutionPayload payload) {
        return AbilityContracts.entityContractForAbility(payload.abilityId()) != null;
    }

    /** The spawn verbs create their entities from the bot's final pose, in verb order and pattern index order. */
    private static void spawnAbilityEntities(Bot bot, AbilityExecutionPayload payload, Arena arena) {
        if (arena == null || !spawnsEntity(payload))
            return;
        AbilityVerbs.run(payload.verbs(), new AbilityVerbs.Host() {
            @Override
            public void spawn(AbilityContracts.SpawnVerb verb) {
                if (verb.atMs() > 0) return;
                AbilityContracts.EntityContract entity = payload.contract().entities().get(verb.entity());
                if (entity == null) return;
                String idPrefix = !entity.phases().isEmpty()
                        && entity.phases().getFirst().type() == AbilityContracts.PhaseType.PROJECTILE
                                ? entity.runtimeType()
                                : "ability";
                for (AbilityEntityFactory.Placement placement : AbilityEntityFactory.placements(verb.pattern())) {
                    String entityId = idPrefix + "-" + bot.userId + "-" + bot.abilityEntitySerial++;
                    bot.entityActivations.put(entityId, bot.activationSerial);
                    bot.abilitySpawn.add(AbilityEntityFactory.create(
                            entityId, entity, bot.slot, bot.x, bot.y, bot.size, bot.rotation,
                            bot.attackDamageMultiplier, payload.targetX(), payload.targetY(),
                            arena.width(), arena.height(), placement));
                }
            }
        });
    }

    /**
     * The entities the due timeline steps' spawn verbs create, after the trigger tick's own, in step, verb and
     * pattern index order, each tagged with the activation serial of the cast that made it. A step spawns from
     * the bot's pose on this tick ("current") or from the pose captured at the trigger ("captured").
     */
    private static void spawnDueEntities(Bot bot, List<AbilityTimeline.DueStep> dueSteps, Arena arena) {
        if (arena == null) return;
        List<ArenaEntity> spawned = new java.util.ArrayList<>(bot.abilitySpawn);
        for (AbilityTimeline.DueStep step : dueSteps) {
            AbilityExecutionPayload payload = AbilityExecutionPayload.forAbility(step.abilityId());
            if (payload.contract() == null) continue;
            List<AbilityContracts.Verb> verbs = payload.verbs();
            for (int index = step.from(); index < step.to(); index += 1) {
                if (!(verbs.get(index) instanceof AbilityContracts.SpawnVerb verb)) continue;
                AbilityContracts.EntityContract entity = payload.contract().entities().get(verb.entity());
                if (entity == null) continue;
                String idPrefix = !entity.phases().isEmpty()
                        && entity.phases().getFirst().type() == AbilityContracts.PhaseType.PROJECTILE
                                ? entity.runtimeType()
                                : "ability";
                boolean captured = "captured".equals(verb.pose()) && step.hasPose();
                double x = captured ? step.poseX() : bot.x;
                double y = captured ? step.poseY() : bot.y;
                double rotation = captured ? step.poseRotation() : bot.rotation;
                for (AbilityEntityFactory.Placement placement : AbilityEntityFactory.placements(verb.pattern())) {
                    String entityId = idPrefix + "-" + bot.userId + "-" + bot.abilityEntitySerial++;
                    bot.entityActivations.put(entityId, step.serial());
                    spawned.add(AbilityEntityFactory.create(
                            entityId, entity, bot.slot, x, y, bot.size, rotation,
                            bot.attackDamageMultiplier, step.targetX(), step.targetY(),
                            arena.width(), arena.height(), placement));
                }
            }
        }
        bot.abilitySpawn = spawned;
    }

    private static void cancelPreparation(Bot bot) {
        AbilityState.clearWindup(bot);
    }

    private static void cancelPreparation(Bot bot, AbilityExecutionPayload payload) {
        if (payload != null && AbilityState.windupRemainingMs(bot, payload.abilityId()) <= 0)
            return;
        cancelPreparation(bot);
    }

    private static boolean hasAbility(Bot bot, int ability) {
        return bot.abilities.contains(ability);
    }

    /** True when another ability of the same channel is winding up or active. */
    private static boolean anotherAbilityActive(Bot bot, int ability) {
        return AbilityState.channelBusy(bot, AbilityChannels.channel(ability), ability);
    }

}
