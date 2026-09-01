package com.example.botfight.simulation.core.combat;

import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Vector;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.logic.CustomVariableActionService;
import com.example.botfight.simulation.core.state.BotMovementService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import java.util.List;
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

    /**
     * Compatibility constructor for focused unit tests that build the simulator
     * directly.
     */
    public ActionExecutionService(BotStateService botStateService,
            ProjectileSimulationService projectileSimulationService) {
        this.botStateService = botStateService;
        this.movementService = new BotMovementService();
        AbilityHitDetectionService hitDetectionService = new AbilityHitDetectionService();
        this.abilityEffectService = new AbilityEffectService(botStateService, movementService, hitDetectionService);
        this.entityCombatService = new ArenaEntityCombatService(projectileSimulationService, hitDetectionService);
        this.customVariableActionService = new CustomVariableActionService();
    }

    public boolean selectedAbilityReady(Bot bot, int ability) {
        return selectedAbilityReady(bot, AbilityExecutionPayload.forAbility(ability));
    }

    private boolean selectedAbilityReady(Bot bot, AbilityExecutionPayload payload) {
        if (payload == null || bot == null || !hasAbility(bot, payload.abilityId()))
            return false;
        if (bot.preparingAbility != null && bot.preparingMs > 0)
            return false;
        if (bot.abilityActiveMs.getOrDefault(payload.abilityId(), 0) > 0)
            return false;
        if ("slow".equals(payload.contract().execution().blockedByStatus())
                && BotStateService.statusActive(bot, "slow"))
            return false;
        var definition = payload.definition();
        boolean fixedResourceInactive = definition.resourceModel() == Abilities.ResourceModel.FIXED
                && bot.abilityActiveMs.getOrDefault(payload.abilityId(), 0) <= 0;
        return selectedAbilityCooldownMs(bot, payload.abilityId()) <= 0
                && !anotherAbilityActive(bot, payload.abilityId(),
                        payload.contract().execution().ignoresGlobalAbilityLock())
                && (definition.charges() <= 0 || fixedResourceInactive
                        || botStateService.abilityCharges(bot, payload.abilityId()) > 0)
                && !(definition.resourceModel() == Abilities.ResourceModel.RELOAD_WHEN_EMPTY
                        && botStateService.abilityRechargeMs(bot, payload.abilityId()) > 0);
    }

    /**
     * Action selection may keep an already-started preparation or channelled
     * action selected. This is deliberately broader than selectedAbilityReady,
     * which is the strict value exposed to bot conditionals for a new
     * activation.
     */
    public boolean selectedAbilityExecutable(Bot bot, int ability) {
        return selectedAbilityExecutable(bot, AbilityExecutionPayload.forAbility(ability));
    }

    private boolean selectedAbilityExecutable(Bot bot, AbilityExecutionPayload payload) {
        if (payload == null || bot == null || !hasAbility(bot, payload.abilityId()))
            return false;
        boolean continuingPreparation = Integer.valueOf(payload.abilityId()).equals(bot.preparingAbility)
                && bot.preparingMs > 0;
        boolean continuingChannel = payload.definition().activationModel() == Abilities.ActivationModel.CHANNELLED
                && bot.abilityActiveMs.getOrDefault(payload.abilityId(), 0) > 0;
        return continuingPreparation || continuingChannel || selectedAbilityReady(bot, payload);
    }

    public int selectedAbilityCooldownMs(Bot bot, int ability) {
        if (bot == null || !hasAbility(bot, ability))
            return 0;
        if (bot.preparingMs > 0 || bot.abilityActiveMs.getOrDefault(ability, 0) > 0)
            return 0;
        return Math.max(bot.abilityCooldowns.getOrDefault(ability, 0),
                botStateService.abilityRechargeMs(bot, ability));
    }

    public boolean selectedAbilityOnCooldown(Bot bot, int ability) {
        return bot != null && hasAbility(bot, ability)
                && bot.preparingMs <= 0
                && bot.abilityActiveMs.getOrDefault(ability, 0) <= 0
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
                : bot.abilityActiveMs.getOrDefault(ability, 0);
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
        customVariableActionService.apply(bot, opponent, entities, arena,
                conditionResolutionService, block);
    }

    public Vector movementVector(StrategyBlock block, Bot player, Entity target) {
        return movementService.movementVector(block, player, target);
    }

    public void execute(Bot bot, Action action, Arena arena) {
        if (bot.hp <= 0) {
            botStateService.beginTick(bot);
            return;
        }

        // The browser evaluates the selected action against the pre-tick
        // status/resource state, then advances bot-owned systems afterward.
        // Capture those pre-tick facts before movement or activation mutates
        // the working bot.
        boolean slowedWasActive = BotStateService.statusActive(bot, "slow");
        boolean hitStaggerWasActive = BotStateService.statusActive(bot, "hit-stagger");
        boolean stunnedWasActive = BotStateService.statusActive(bot, "stun");
        boolean silencedWasActive = BotStateService.statusActive(bot, "silence");
        Integer channelledAbility = activeChannelledAbility(bot);

        movementService.applyTickMovement(bot, action, arena, false,
                slowedWasActive, hitStaggerWasActive);
        if (stunnedWasActive) {
            BotStateService.interruptCurrentAbility(bot);
            if (channelledAbility != null) {
                botStateService.setAbilityReuseCooldown(bot, channelledAbility);
            }
            botStateService.beginTick(bot);
            return;
        }

        AbilityExecutionPayload payload = selectedAbilityPayload(bot, action);
        boolean blockedByStatus = payload != null
                && payload.definition().activationModel() != Abilities.ActivationModel.CHANNELLED
                && (silencedWasActive
                        || ("slow".equals(payload.contract().execution().blockedByStatus())
                                && slowedWasActive));
        boolean blockedByAbilityState = payload != null
                && payload.definition().activationModel() != Abilities.ActivationModel.CHANNELLED
                && !blockedByStatus
                && !selectedAbilityExecutable(bot, payload);
        boolean channelledActive = payload != null
                && !blockedByStatus
                && payload.definition().activationModel() == Abilities.ActivationModel.CHANNELLED
                && selectedAbilityExecutable(bot, payload);
        if (channelledAbility != null
                && (payload == null || !channelledAbility.equals(payload.abilityId()))) {
            botStateService.setAbilityReuseCooldown(bot, channelledAbility);
        }
        if (channelledActive) {
            if (channelledAbility == null
                    || !channelledAbility.equals(payload.abilityId())) {
                botStateService.startAbilityResource(bot, payload.abilityId());
            }
            bot.abilityActiveMs.put(payload.abilityId(), STEP_MS + 1);
            setTriggeredPayload(bot, payload);
        }
        if (!blockedByStatus && !blockedByAbilityState && !channelledActive && payload != null
                && payload.definition().activationModel() == Abilities.ActivationModel.IMMEDIATE) {
            AbilityExecutionPayload activated = activateImmediateAbility(bot, payload);
            if (activated != null)
                setTriggeredPayload(bot, activated);
        }
        if (blockedByStatus || blockedByAbilityState) {
            cancelPreparation(bot, payload);
        } else if (!channelledActive && payload != null
                && !BotStateService.statusActive(bot, "silence")
                && payload.definition().activationModel() == Abilities.ActivationModel.CONFIGURED) {
            AbilityExecutionPayload activated = activateConfiguredAbility(bot, payload);
            if (activated != null)
                setTriggeredPayload(bot, activated);
        } else if (payload != null
                && payload.definition().activationModel() == Abilities.ActivationModel.CONFIGURED
                && bot.preparingAbility != null
                && (BotStateService.statusActive(bot, "silence") || BotStateService.statusActive(bot, "stun"))) {
            cancelPreparation(bot, payload);
        }

        botStateService.beginTick(bot);
        if (bot.triggeredAbilityPayload != null) {
            spawnAbilityEntity(bot, bot.triggeredAbilityPayload, arena);
        }
    }

    public void resolveTriggeredAbilities(Bot attacker, Bot defender, Arena arena) {
        abilityEffectService.resolveTriggeredAbility(attacker, defender, arena);
    }

    public void resolveTriggeredAbilities(Bot attacker, List<Bot> bots, Arena arena) {
        abilityEffectService.resolveTriggeredAbilities(attacker, bots, arena);
    }

    public int damageToDroneThisTick(ArenaEntity drone, List<Bot> bots,
            List<ArenaEntity> projectileEffects, List<ArenaEntity> projectiles,
            List<ArenaEntity> placements) {
        return entityCombatService.damageToDroneThisTick(
                drone, bots, projectileEffects, projectiles, placements);
    }

    public boolean mineHitByCurrentAttack(ArenaEntity mine, List<Bot> bots,
            List<ArenaEntity> projectiles, List<ArenaEntity> placements) {
        return entityCombatService.mineHitByCurrentAttack(mine, bots, projectiles, placements);
    }

    private AbilityExecutionPayload selectedAbilityPayload(Bot bot, Action action) {
        if (bot.preparingAbility != null && bot.preparingMs > 0
                && !BotStateService.statusActive(bot, "silence")) {
            return AbilityExecutionPayload.forAbility(bot.preparingAbility)
                    .withPreparationTarget(bot.preparingTargetX, bot.preparingTargetY);
        }
        return AbilityExecutionPayload.from(action);
    }

    private void setTriggeredPayload(Bot bot, AbilityExecutionPayload payload) {
        AbilityExecutionPayload captured = payload.capture(bot);
        bot.triggeredAbilityPayload = captured;
        bot.triggeredAbility = captured.actionId();
    }

    private AbilityExecutionPayload activateImmediateAbility(
            Bot bot, AbilityExecutionPayload payload) {
        if (payload.definition().activationModel() != Abilities.ActivationModel.IMMEDIATE
                || !selectedAbilityReady(bot, payload))
            return null;
        var definition = payload.definition();
        double cooldownMultiplier = 1.0 / bot.attackSpeedMultiplier;
        botStateService.startAbilityResource(bot, payload.abilityId());
        if (definition.charges() > 0
                && definition.resourceModel() != Abilities.ResourceModel.FIXED
                && definition.resourceModel() != Abilities.ResourceModel.HP
                && !botStateService.consumeAbilityCharge(bot, payload.abilityId())) {
            return null;
        }
        int activeMs = activationActiveMs(payload);
        int cooldownMs = activationCooldownMs(bot, payload, cooldownMultiplier);
        bot.abilityActiveMs.put(payload.abilityId(), activeMs + STEP_MS);
        botStateService.setAbilityCooldown(bot, payload.abilityId(), cooldownMs);
        AbilityExecutionPayload activated = payload.capture(bot);
        return activated;
    }

    private AbilityExecutionPayload activateConfiguredAbility(
            Bot bot, AbilityExecutionPayload payload) {
        if (!selectedAbilityExecutable(bot, payload))
            return null;
        int windup = payload.definition().windupMs();
        if (windup > 0) {
            boolean continuingPreparation = Integer.valueOf(payload.abilityId()).equals(bot.preparingAbility);
            // Store the countdown value exposed to bot logic and replay. The
            // current fixed step is consumed before checking activation.
            bot.preparingMs = continuingPreparation
                    ? Math.max(0, bot.preparingMs - STEP_MS)
                    : Math.max(0, windup - STEP_MS);
            if (!continuingPreparation) {
                bot.preparingTargetX = payload.targetX();
                bot.preparingTargetY = payload.targetY();
            }
            bot.preparingAbility = payload.abilityId();
            if (bot.preparingMs > 0)
                return null;
        }
        cancelPreparation(bot);
        botStateService.startAbilityResource(bot, payload.abilityId());
        if (payload.definition().charges() > 0
                && payload.definition().resourceModel() != Abilities.ResourceModel.FIXED
                && payload.definition().resourceModel() != Abilities.ResourceModel.HP) {
            botStateService.consumeAbilityCharge(bot, payload.abilityId());
        }
        int activeMs = activationActiveMs(payload);
        int cooldownMs = activationCooldownMs(bot, payload, 1.0 / bot.attackSpeedMultiplier);
        bot.abilityActiveMs.put(payload.abilityId(), activeMs + STEP_MS);
        botStateService.setAbilityCooldown(bot, payload.abilityId(), cooldownMs);
        AbilityExecutionPayload activated = payload.capture(bot);
        if (payload.contract().execution().faceTargetFromPayload()
                && Double.isFinite(activated.targetX()) && Double.isFinite(activated.targetY())) {
            bot.rotation = vectorBearing(activated.targetX() - bot.x, activated.targetY() - bot.y);
            activated = activated.capture(bot);
        }
        return activated;
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
        // as post-activation action locks. Other existing short-lived combat
        // visuals retain their explicit legacy active fallback.
        if (payload.contract().effects().stream().anyMatch(effect -> effect.type() == EffectType.DAMAGE_REDUCTION
                || effect.type() == EffectType.DAMAGE_IMMUNITY
                || effect.type() == EffectType.DAMAGE_REFLECTION
                || (effect.type() == EffectType.BUFF && "overclock".equals(effect.subtype())))) {
            return 0;
        }
        var definition = payload.definition();
        if (definition.activationModel() == Abilities.ActivationModel.IMMEDIATE) {
            return definition.activeMs() > 0 ? definition.activeMs()
                    : definition.windupMs() > 0 ? definition.windupMs() : STEP_MS;
        }
        if (spawnsEntity(payload) && definition.activeMs() == 0)
            return 0;
        return definition.activeMs() > 0 ? definition.activeMs()
                : definition.durationMs() > 0 ? definition.durationMs() : 0;
    }

    private static boolean spawnsEntity(AbilityExecutionPayload payload) {
        return payload.contract().effects().stream()
                .anyMatch(effect -> effect.type() == EffectType.SPAWN_ENTITY);
    }

    private static void spawnAbilityEntity(Bot bot, AbilityExecutionPayload payload, Arena arena) {
        if (arena == null || !spawnsEntity(payload))
            return;
        EntityContracts.EntityContract entityContract = EntityContracts.forAbility(payload.abilityId());
        String idPrefix = entityContract != null
                && entityContract.system() == EntityContracts.SystemType.PROJECTILE
                        ? entityContract.runtimeType()
                        : "ability";
        bot.abilitySpawn = AbilityEntityFactory.create(
                idPrefix + "-" + bot.userId + "-" + bot.abilityEntitySerial++,
                payload.abilityId(),
                bot.slot,
                bot.x,
                bot.y,
                bot.size,
                bot.rotation,
                bot.attackDamageMultiplier,
                payload.targetX(),
                payload.targetY(),
                arena.width(),
                arena.height());
    }

    private static void cancelPreparation(Bot bot) {
        bot.preparingAbility = null;
        bot.preparingMs = 0;
        bot.preparingTargetX = Double.NaN;
        bot.preparingTargetY = Double.NaN;
    }

    private static void cancelPreparation(Bot bot, AbilityExecutionPayload payload) {
        if (payload != null && !Integer.valueOf(payload.abilityId()).equals(bot.preparingAbility))
            return;
        cancelPreparation(bot);
    }

    private static boolean hasAbility(Bot bot, int ability) {
        return bot.abilities.contains(ability);
    }

    private static boolean anotherAbilityActive(Bot bot, int ability, boolean ignoresGlobalAbilityLock) {
        if (ignoresGlobalAbilityLock)
            return false;
        if (bot.preparingAbility != null
                && bot.preparingAbility != ability
                && !AbilityContracts.get(bot.preparingAbility).execution().ignoresGlobalAbilityLock())
            return true;
        return bot.abilityActiveMs.entrySet().stream()
                .anyMatch(entry -> entry.getKey() != ability
                        && entry.getValue() > 0
                        && !AbilityContracts.get(entry.getKey()).execution().ignoresGlobalAbilityLock());
    }

    private static Integer activeChannelledAbility(Bot bot) {
        return bot.abilityActiveMs.entrySet().stream()
                .filter(entry -> entry.getValue() > 0)
                .map(java.util.Map.Entry::getKey)
                .filter(id -> Abilities.definition(id).activationModel() == Abilities.ActivationModel.CHANNELLED)
                .findFirst()
                .orElse(null);
    }
}
