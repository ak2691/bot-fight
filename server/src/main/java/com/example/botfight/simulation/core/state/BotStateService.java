package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.core.orchestration.Bot;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.orchestration.CombatLog;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.GameConfig;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.HitStagger;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.gameconfig.Abilities.ResourceModel;
import java.util.HashMap;
import java.util.List;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Creates and initializes authoritative bot state from a validated bot submission. */
@Service
public class BotStateService {
    private static final int STEP_MS = 100;
    /** Cap on a hit record's age; also the Time Since Hit reading (99,999 s) of an ability that never hit. */
    public static final int NEVER_HIT_MS = 99_999_000;

    private final GameConfig gameConfig;
    private final BotCodeService botCodeService;

    public BotStateService(GameConfigCatalog gameConfigCatalog, BotCodeService botCodeService) {
        this.gameConfig = gameConfigCatalog.duelV1();
        this.botCodeService = botCodeService;
    }

    public Bot create(DuelSimulationService.DuelBotRequest request) {
        Bot bot = new Bot();
        bot.userId = request.userId();
        bot.username = request.username();
        bot.slot = request.slot();
        bot.teamNumber = request.teamNumber();
        bot.x = request.x();
        bot.y = request.y();
        bot.rotation = request.rotation() != null ? request.rotation() : request.slot() == 1 ? 90.0 : 270.0;
        bot.size = request.size();
        bot.brain = request.brain();
        bot.combatLoadout = "custom";
        initializeCustomVariables(bot);
        bot.abilities = botCodeService.readAbilities(request.brain());
        bot.maxHp = gameConfig.maxHp();
        bot.moveSpeed = gameConfig.moveSpeed();
        bot.attackDamageMultiplier = 1.0;
        bot.attackSpeedMultiplier = 1.0;
        bot.hp = request.initialHp() == null || !Double.isFinite(request.initialHp())
                ? bot.maxHp
                : Math.max(0, Math.min(bot.maxHp, request.initialHp()));
        bot.spawnX = bot.x;
        bot.spawnY = bot.y;
        bot.movementStartX = bot.x;
        bot.movementStartY = bot.y;
        bot.abilities.forEach(abilityId -> initializeAbilityResources(bot, abilityId));
        return bot;
    }

    /** Gives an ability its starting charges. Cooldowns need no entry: an absent record is ready. */
    private void initializeAbilityResources(Bot bot, int abilityId) {
        if (Abilities.definition(abilityId).charges() > 0) {
            AbilityState.ensure(bot, abilityId).charges = Abilities.maxCharges(abilityId, bot.maxHp);
        }
    }

    /**
     * Swaps in the next segment's brain at a timed-rounds boundary. Only the brain, the loadout and the
     * custom variables change: an ability the bot did not have starts ready with full charges, while
     * the cooldowns, charges, wind-up, stamina, position, HP and statuses already in play carry over.
     * A running action chain ends, because the new brain may not contain it.
     */
    public void applyBrainSchedule(Bot bot, JsonNode brain, java.util.Collection<String> variableResets) {
        bot.brain = brain;
        bot.combatLoadout = "custom";
        reconcileCustomVariables(bot, variableResets == null ? Set.of() : new HashSet<>(variableResets));
        Set<Integer> next = botCodeService.readAbilities(brain);
        for (int abilityId : next) {
            if (bot.abilities.contains(abilityId)) continue;
            bot.abilityState.remove(abilityId);
            initializeAbilityResources(bot, abilityId);
        }
        bot.abilities = next;
        bot.chainStack.clear();
    }

    /**
     * A variable that keeps its name and type keeps its value unless it is reset; a new, reset or
     * retyped variable takes its declared default; a variable the brain no longer declares is dropped.
     */
    private void reconcileCustomVariables(Bot bot, Set<String> resets) {
        Map<String, Object> previousValues = new HashMap<>(bot.customVariables);
        Map<String, String> previousTypes = new HashMap<>(bot.customVariableTypes);
        bot.customVariables.clear();
        bot.customVariableTypes.clear();
        initializeCustomVariables(bot);
        JsonNode variables = bot.brain != null ? bot.brain.get("customVariables") : null;
        if (variables == null || !variables.isArray()) return;
        int slots = 0;
        for (JsonNode variable : variables) {
            slots += 1;
            if (slots > 100) break;
            String id = variable.path("id").asText("");
            String type = bot.customVariableTypes.get(id);
            if (type == null || !type.equals(previousTypes.get(id))) continue;
            if (resets.contains(id) || resets.contains(variable.path("name").asText(null))) continue;
            Object kept = previousValues.get(id);
            if (kept != null) bot.customVariables.put(id, kept);
        }
    }

    public void startTick(Bot bot) {
        bot.tickStartHp = bot.hp;
        bot.damageTakenThisTick = 0;
        // The browser clears one-tick outputs before the next action is
        // selected.  Keep the authoritative working state at that same
        // boundary; the current tick may repopulate these fields below.
        bot.triggeredAbility = null;
        bot.triggeredAbilityPayload = null;
        bot.abilitySpawn = java.util.List.of();
        bot.dueSteps = java.util.List.of();
        bot.visualOriginX = Double.NaN;
        bot.visualOriginY = Double.NaN;
        bot.visualOriginRotation = Double.NaN;
        bot.entityHitIds.clear();
    }

    public void beginTick(Bot bot) {
        beginTick(bot, Set.of());
    }

    /** Advances one step without consuming a just-activated ability's active window. */
    public void beginTick(Bot bot, Integer justActivatedAbilityId) {
        beginTick(bot, justActivatedAbilityId == null ? Set.of() : Set.of(justActivatedAbilityId));
    }

    /**
     * Advances one step. Every ability that activated this step (an ability and a dash can both start in one
     * step) keeps its stages for the step, so a dash started beside an ability gets the same active and
     * cooldown timing as a dash started alone.
     */
    public void beginTick(Bot bot, Set<Integer> justActivatedAbilityIds) {
        bot.matchElapsedMs = Math.min(99_999_000L, bot.matchElapsedMs + STEP_MS);
        if (bot.hp <= 0) {
            runOutActiveStages(bot);
            bot.dashRemaining = 0;
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
            bot.velocityX = 0;
            bot.velocityY = 0;
            bot.entityHitIds.clear();
            bot.damageTakenThisTick = 0;
            return;
        }

        var activeBeforeTimers = activeRemainingByAbility(bot);
        tickAbilityTimers(bot, STEP_MS, justActivatedAbilityIds);
        tickAbilityResources(bot, STEP_MS, activeBeforeTimers, justActivatedAbilityIds);
        tickStatuses(bot);
        if (bot.hp <= 0) {
            clearBotEffects(bot);
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
            bot.velocityX = 0;
            bot.velocityY = 0;
            bot.entityHitIds.clear();
            bot.damageTakenThisTick = 0;
            return;
        }
        DeferredStateSystem.tick(bot, STEP_MS);
        bot.entityHitIds.clear();
        bot.damageTakenThisTick = 0;
    }

    private void tickStatuses(Bot bot) {
        Map<String, Integer> remainingAtStart = new HashMap<>();
        bot.statusEffects.forEach((key, status) -> remainingAtStart.put(key, status.remainingMs));
        for (String key : new ArrayList<>(bot.statusEffects.keySet())) {
            StatusEffectState status = bot.statusEffects.get(key);
            if (status == null || !status.active()) {
                bot.statusEffects.remove(key);
                continue;
            }
            if ("presence".equals(status.mode)) continue;
            // A sibling's tick effect refreshed this status during this interval (burn re-applying
            // hit-stagger): the refresh starts at full duration, whatever order the statuses are visited in.
            if (status.remainingMs != remainingAtStart.get(key)) continue;
            int previousRemainingMs = Math.max(0, status.remainingMs);
            int activeElapsedMs = Math.min(STEP_MS, previousRemainingMs);
            int tickMs = Math.max(0, status.tickMs);
            int tickElapsedMs = Math.max(0, status.tickElapsedMs) + activeElapsedMs;
            while (tickMs > 0 && tickElapsedMs >= tickMs) {
                for (StatusEffectState.Effect effect : status.effects) {
                    if (!"tick".equals(effect.mode)) continue;
                    Integer previousAbility = CombatLog.setAbility(status.abilityId);
                    try {
                        if ("damage".equals(effect.type)) {
                            applyDamage(bot, Math.max(0, effect.amount * effect.multiplier), status.sourceSlot,
                                    Double.NaN, Double.NaN, "status", status.type);
                            if (bot.hp <= 0) return;
                        } else if ("movement_lock".equals(effect.type) && effect.durationMs > 0) {
                            upsertStatusEffect(bot, new StatusEffectState("movement-lock", effect.durationMs, 0));
                        }
                    } finally {
                        CombatLog.setAbility(previousAbility);
                    }
                }
                tickElapsedMs -= tickMs;
            }
            status.remainingMs = Math.max(0, previousRemainingMs - STEP_MS);
            status.tickElapsedMs = status.remainingMs > 0 && tickMs > 0 ? tickElapsedMs : 0;
            if (status.remainingMs <= 0) bot.statusEffects.remove(key);
        }
    }

    public static boolean statusActive(Bot bot, String type) {
        return bot != null && bot.statusEffects.values().stream()
                .filter(status -> type.equalsIgnoreCase(status.type))
                .anyMatch(StatusEffectState::active);
    }

    public static int statusRemainingMs(Bot bot, String type) {
        return bot == null ? 0 : bot.statusEffects.values().stream()
                .filter(status -> type.equalsIgnoreCase(status.type) && !"presence".equals(status.mode))
                .mapToInt(status -> Math.max(0, status.remainingMs)).max().orElse(0);
    }

    public static double statusEffectValue(Bot bot, String statusType, String effectType,
                                            String field, double fallback) {
        if (!statusActive(bot, statusType)) return fallback;
        return bot.statusEffects.values().stream()
                .filter(status -> statusType.equalsIgnoreCase(status.type) && status.active())
                .flatMap(status -> status.effects.stream())
                .filter(effect -> effectType.equalsIgnoreCase(effect.type))
                .mapToDouble(effect -> switch (field) {
                    case "multiplier" -> effect.multiplier;
                    case "amount" -> effect.amount;
                    case "movementMultiplier" -> effect.movementMultiplier;
                    case "rotationMultiplier" -> effect.rotationMultiplier;
                    default -> Double.NaN;
                })
                .filter(Double::isFinite)
                .findFirst().orElse(fallback);
    }

    public static void upsertStatusEffect(Bot bot, StatusEffectState incoming) {
        if (bot == null || incoming == null || incoming.type == null || incoming.type.isBlank()) return;
        incoming.type = incoming.type.toLowerCase(Locale.ROOT);
        incoming.mode = "presence".equals(incoming.mode) ? "presence" : "duration";
        CombatLog.record("status", CombatLog.bot(incoming.sourceSlot), CombatLog.bot(bot.slot),
                incoming.abilityId, incoming.type, incoming.remainingMs);
        String key = incoming.type + ":" + incoming.mode;
        StatusEffectState current = bot.statusEffects.get(key);
        if (current == null) {
            bot.statusEffects.put(key, incoming);
            return;
        }
        int currentRemainingMs = current.remainingMs;
        current.remainingMs = Math.max(current.remainingMs, incoming.remainingMs);
        if (currentRemainingMs <= 0 && incoming.tickMs > 0) current.tickMs = incoming.tickMs;
        current.tickElapsedMs = currentRemainingMs > 0 ? current.tickElapsedMs : incoming.tickElapsedMs;
        current.sourceSlot = incoming.sourceSlot != null ? incoming.sourceSlot : current.sourceSlot;
        current.abilityId = incoming.abilityId != null ? incoming.abilityId : current.abilityId;
        for (StatusEffectState.Effect incomingEffect : incoming.effects) {
            StatusEffectState.Effect existing = current.effects.stream()
                    .filter(effect -> effect.type.equals(incomingEffect.type) && effect.mode.equals(incomingEffect.mode))
                    .findFirst().orElse(null);
            if (existing == null) current.effects.add(incomingEffect);
            else {
                existing.amount = Math.max(existing.amount, incomingEffect.amount);
                existing.multiplier = Math.max(existing.multiplier, incomingEffect.multiplier);
                existing.durationMs = Math.max(existing.durationMs, incomingEffect.durationMs);
                existing.movementMultiplier = incomingEffect.movementMultiplier;
                existing.rotationMultiplier = incomingEffect.rotationMultiplier;
                if (incomingEffect.damageModifier != null) existing.damageModifier = incomingEffect.damageModifier;
                if (incomingEffect.excludedDamageSourceTypes != null) {
                    existing.excludedDamageSourceTypes = new ArrayList<>(incomingEffect.excludedDamageSourceTypes);
                }
                if (incomingEffect.rounding != null) existing.rounding = incomingEffect.rounding;
            }
        }
    }

    public void settleTick(Bot bot) {
        if (bot.pendingHealing > 0) {
            bot.hp = Math.min(bot.maxHp, bot.hp + bot.pendingHealing);
            bot.pendingHealing = 0;
        }
        bot.damageTakenLastTick = bot.damageTakenThisTick;
        bot.hpNetChangeLastTick = bot.hp - bot.tickStartHp;
        settleAbilityHits(bot);
        // Banked hit refunds are paid after the tick's spends and regeneration; the pause is untouched.
        com.example.botfight.simulation.core.state.StaminaSystem.refund(bot, bot.pendingStaminaRefund);
        bot.pendingStaminaRefund = 0;
    }

    /**
     * Ends a tick for the hit ledger: abilities that hit this tick start at one step
     * (so the next tick's logic reads 0.1 s) and every older record ages by one step.
     */
    /**
     * Notes that {@code owner}'s ability landed on an enemy bot this tick (Time Since Hit). The same hit
     * earns the hit stamina refund, once per activation: {@code activationSerial} identifies the activation
     * that landed it, so multi-hit, piercing and damage-over-time effects pay out once.
     */
    public static void recordEnemyHit(Bot owner, int abilityId, int activationSerial) {
        owner.abilityHitsThisTick.add(abilityId);
        if (owner.refundedActivations.add(activationSerial)) {
            owner.pendingStaminaRefund += com.example.botfight.simulation.gameconfig.MovementConfig.HIT_STAMINA_REFUND;
        }
    }

    private static void settleAbilityHits(Bot bot) {
        bot.abilityLastHitAgeMs.replaceAll((id, ageMs) ->
                (int) Math.min(NEVER_HIT_MS, (long) ageMs + STEP_MS));
        for (Integer abilityId : bot.abilityHitsThisTick) bot.abilityLastHitAgeMs.put(abilityId, STEP_MS);
        bot.abilityHitsThisTick.clear();
    }

    public void applyDamage(Bot target, double damage) {
        applyDamage(target, damage, (Integer) null);
    }

    public void applyClosingZoneDamage(Bot target, double damage) {
        double previousHp = target.hp;
        applyDamage(target, damage);
        if (target.hp < previousHp) target.closingZoneDamageCount++;
    }

    public void applyDamage(Bot target, double damage, Bot source) {
        applyDamage(target, damage, source == null ? null : source.slot,
                source == null ? Double.NaN : source.x,
                source == null ? Double.NaN : source.y);
    }

    public void applyDamage(Bot target, double damage, Integer sourceSlot) {
        applyDamage(target, damage, sourceSlot, Double.NaN, Double.NaN);
    }

    public void applyDamage(Bot target, double damage, Integer sourceSlot,
                            double sourceX, double sourceY) {
        applyDamage(target, damage, sourceSlot, sourceX, sourceY, null, null);
    }

    private void applyDamage(Bot target, double damage, Integer sourceSlot,
                             double sourceX, double sourceY, String damageSourceKind,
                             String damageSourceType) {
        if (target.hp <= 0 || target.ignoresHostileEffects()) return;
        double previousHp = target.hp;
        IncomingDamage incomingDamage = incomingDamageFor(target, damageSourceKind, damageSourceType);
        double baseDamage = Math.max(0, damage);
        double remaining = Math.max(0, baseDamage + baseDamage * incomingDamage.damageModifier());
        if (incomingDamage.truncateToTenths()) remaining = truncateDamageToTenths(remaining);
        remaining = roundCombatValue(remaining);
        if (remaining > 0) target.hp = roundCombatValue(Math.max(0, target.hp - remaining));
        double appliedDamage = roundCombatValue(Math.max(0, previousHp - target.hp));
        CombatLog.record("effect", CombatLog.bot(sourceSlot), CombatLog.bot(target.slot), null, "damage", appliedDamage);
        target.damageTakenThisTick = roundCombatValue(target.damageTakenThisTick + appliedDamage);
        if (appliedDamage > 0 && sourceSlot != null && sourceSlot != target.slot) {
            upsertStatusEffect(target, new StatusEffectState("hit-stagger", HitStagger.DURATION_MS, 0)
                    .addEffect(new StatusEffectState.Effect("movement_modifier", "constant")
                            .movement(HitStagger.MOVEMENT_MULTIPLIER, HitStagger.ROTATION_MULTIPLIER)));
        }
        if (previousHp > 0 && target.hp <= 0) clearBotEffects(target);
    }

    public void applyDamageFrom(Bot source, Bot target, double damage) {
        applyDamageFrom(source, target, damage, source.x, source.y);
    }

    /** Damage from {@code source} landing at an origin (sourceX, sourceY), reflected back if the target reflects. */
    public void applyDamageFrom(Bot source, Bot target, double damage, double sourceX, double sourceY) {
        double reflectionMultiplier = statusEffectValue(
                target, "reactive-armor", "damage_reflection", "multiplier", 0.0);
        boolean reflecting = source != null && source != target && reflectionMultiplier > 0;
        applyDamage(target, damage, source.slot, sourceX, sourceY);
        if (reflecting) applyDamage(source,
                roundCombatValue(Math.max(0, damage) * reflectionMultiplier), target);
    }

    private static IncomingDamage incomingDamageFor(Bot bot,
                                                    String damageSourceKind,
                                                    String damageSourceType) {
        double damageModifier = 0;
        boolean truncateToTenths = false;
        for (StatusEffectState status : bot.statusEffects.values()) {
            if (status == null || !status.active()) continue;
            for (StatusEffectState.Effect effect : status.effects) {
                if (!"incoming_damage_modifier".equals(effect.type)
                        || !"constant".equals(effect.mode)
                        || damageSourceIsExcluded(effect, damageSourceKind, damageSourceType)) continue;
                if (effect.damageModifier != null && Double.isFinite(effect.damageModifier)) {
                    damageModifier += effect.damageModifier;
                } else if (Double.isFinite(effect.multiplier)) {
                    // Read older replay/status payloads by converting their factor to a delta.
                    damageModifier += effect.multiplier - 1.0;
                }
                if (StatusEffectState.TRUNCATE_DAMAGE_TO_TENTHS.equals(effect.rounding)) {
                    truncateToTenths = true;
                }
            }
        }
        return new IncomingDamage(damageModifier, truncateToTenths);
    }

    private static boolean damageSourceIsExcluded(StatusEffectState.Effect effect,
                                                  String damageSourceKind,
                                                  String damageSourceType) {
        if (!"status".equals(damageSourceKind) || damageSourceType == null
                || effect.excludedDamageSourceTypes == null) return false;
        return effect.excludedDamageSourceTypes.stream()
                .anyMatch(type -> damageSourceType.equalsIgnoreCase(type));
    }

    private static double truncateDamageToTenths(double value) {
        return Math.floor(Math.max(0, value) * 10.0) / 10.0;
    }

    private record IncomingDamage(double damageModifier, boolean truncateToTenths) {
    }

    private static double roundCombatValue(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    public double damageMultiplier(Bot bot) {
        return bot.attackDamageMultiplier;
    }

    public void clearBotEffects(Bot bot) {
        bot.statusEffects.clear();
        bot.dashRemaining = 0;
        // Active stages end now; the cooldown each reserved starts in full.
        for (int abilityId : AbilityState.idsInStage(bot, AbilityState.Stage.ACTIVE)) {
            AbilityState.endActive(bot, abilityId);
        }
        bot.temporalRewindMs = 0;
        bot.temporalRewindPulseMs = 0;
        bot.pendingHealing = 0;
        bot.utilityHealAccumulatorMs = 0;
    }

    public static int abilityCharges(Bot bot, int abilityId) {
        int maxCharges = Abilities.maxCharges(abilityId, bot.maxHp);
        AbilityState.Record record = AbilityState.record(bot, abilityId);
        return Math.max(0, Math.min(
                maxCharges,
                record == null || record.charges == null ? 0 : record.charges));
    }

    public int abilityRechargeMs(Bot bot, int abilityId) {
        AbilityState.Record record = AbilityState.record(bot, abilityId);
        return record == null || record.reloadMs == null ? 0 : record.reloadMs;
    }

    public boolean consumeAbilityCharge(Bot bot, int abilityId) {
        return consumeAbilityCharges(bot, abilityId, 1);
    }

    public void setAbilityReuseCooldown(Bot bot, int abilityId) {
        int reuseMs = Abilities.definition(abilityId).reuseCooldownMs();
        setAbilityCooldown(bot, abilityId, acceleratedCooldownMs(bot, reuseMs));
    }

    /**
     * Interrupts every bot-owned preparation or active phase without removing
     * any already-spawned ability entity. Each interrupted phase immediately
     * enters its normal cooldown or reload gate.
     */
    public static boolean interruptCurrentAbility(Bot bot) {
        if (bot == null || bot.hp <= 0) return false;
        Set<Integer> abilityIds = new HashSet<>();
        abilityIds.addAll(AbilityState.idsInStage(bot, AbilityState.Stage.WINDUP));
        abilityIds.addAll(AbilityState.idsInStage(bot, AbilityState.Stage.ACTIVE));
        boolean interrupted = false;
        for (Integer abilityId : abilityIds) {
            interrupted |= interruptAbility(bot, abilityId);
        }
        return interrupted;
    }

    /** Applies the shared interrupt state transition and its control status. */
    public static void applyInterrupt(Bot bot, int durationMs,
                                      Integer sourceAbilityId) {
        if (bot == null || bot.hp <= 0 || bot.ignoresHostileEffects()) return;
        interruptCurrentAbility(bot);
        StatusEffectState stun = new StatusEffectState("stun", Math.max(0, durationMs), 0)
                .addEffect(new StatusEffectState.Effect("stun", "constant"));
        stun.abilityId = sourceAbilityId;
        upsertStatusEffect(bot, stun);
        bot.movementVelocityX = 0;
        bot.movementVelocityY = 0;
        bot.velocityX = 0;
        bot.velocityY = 0;
    }

    private static boolean interruptAbility(Bot bot, int abilityId) {
        boolean preparing = AbilityState.windupRemainingMs(bot, abilityId) > 0;
        boolean active = AbilityState.activeRemainingMs(bot, abilityId) > 0;
        if (!preparing && !active) return false;

        var definition = Abilities.definition(abilityId);
        if (preparing) AbilityState.ready(bot, abilityId);
        if (active) AbilityState.endActive(bot, abilityId);

        boolean reloadActive = definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY
                && abilityCharges(bot, abilityId) == 0
                && reloadMs(bot, abilityId) > 0;
        if (preparing && !reloadActive
                && definition.charges() > 0
                && abilityCharges(bot, abilityId) > 0) {
            if (consumeAbilityCharges(bot, abilityId, 1)) {
                reloadActive = definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY
                        && abilityCharges(bot, abilityId) == 0
                        && reloadMs(bot, abilityId) > 0;
            }
        }

        if (reloadActive) {
            AbilityState.ready(bot, abilityId);
        } else {
            double attackSpeed = bot.attackSpeedMultiplier > 0
                    && Double.isFinite(bot.attackSpeedMultiplier) ? bot.attackSpeedMultiplier : 1.0;
            int baseCooldown = definition.cooldownMs() > 0
                    ? definition.cooldownMs() : definition.reuseCooldownMs();
            int cooldownMs = (int) Math.round(baseCooldown / attackSpeed * cooldownStartMultiplier(bot));
            setAbilityCooldown(bot, abilityId, cooldownMs);
        }

        var contract = AbilityContracts.forAbility(abilityId);
        boolean hasPhaseDash = contract != null && contract.has(AbilityContracts.MoveVerb.class);
        if (active && hasPhaseDash) {
            bot.dashRemaining = 0;
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
            bot.velocityX = 0;
            bot.velocityY = 0;
        }
        return true;
    }

    private static int reloadMs(Bot bot, int abilityId) {
        AbilityState.Record record = AbilityState.record(bot, abilityId);
        return record == null || record.reloadMs == null ? 0 : record.reloadMs;
    }

    /**
     * Sets a cooldown in the stage where it will actually run: while the ability is active it stays reserved on
     * the record and starts when the active stage ends; otherwise it is the visible cooldown.
     */
    public static void setAbilityCooldown(Bot bot, int abilityId, int cooldownMs) {
        int requested = Math.max(0, cooldownMs);
        AbilityState.Record record = AbilityState.ensure(bot, abilityId);
        if (record.stage == AbilityState.Stage.ACTIVE) {
            record.cooldownMs = Math.max(Math.max(0, record.cooldownMs), requested);
        } else {
            int cooldown = Math.max(AbilityState.cooldownRemainingMs(bot, abilityId), requested);
            record.stage = cooldown > 0 ? AbilityState.Stage.COOLDOWN : AbilityState.Stage.READY;
            record.remainingMs = cooldown;
            record.cooldownMs = 0;
            record.targetX = Double.NaN;
            record.targetY = Double.NaN;
        }
    }

    /**
     * Starts an ability's active stage. A cooldown still running (or reserved) is carried over to the end of
     * the active stage; an ability with no active time goes straight to its cooldown.
     */
    public static void startAbilityActive(Bot bot, int abilityId, int activeMs) {
        AbilityState.Record record = AbilityState.ensure(bot, abilityId);
        int carried = Math.max(AbilityState.cooldownRemainingMs(bot, abilityId),
                AbilityState.pendingCooldownMs(bot, abilityId));
        record.targetX = Double.NaN;
        record.targetY = Double.NaN;
        if (activeMs > 0) {
            record.stage = AbilityState.Stage.ACTIVE;
            record.remainingMs = activeMs;
            record.cooldownMs = carried;
        } else {
            record.stage = carried > 0 ? AbilityState.Stage.COOLDOWN : AbilityState.Stage.READY;
            record.remainingMs = carried;
            record.cooldownMs = 0;
        }
    }

    private static boolean consumeAbilityCharges(
            Bot bot, int abilityId, int amount) {
        var definition = Abilities.definition(abilityId);
        if (definition.charges() <= 0) return true;
        AbilityState.Record record = AbilityState.ensure(bot, abilityId);
        int current = record.charges == null ? 0 : record.charges;
        if (current <= 0) return false;
        int remaining = Math.max(0, current - Math.max(0, amount));
        record.charges = remaining;
        if (remaining == 0 && definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY) {
            record.reloadMs = (int) Math.round(definition.rechargeMs() / bot.attackSpeedMultiplier
                    * cooldownStartMultiplier(bot));
        }
        if (remaining > 0 && definition.reuseCooldownMs() > 0) {
            setAbilityCooldown(bot, abilityId, definition.reuseCooldownMs());
        }
        return true;
    }

    private static Map<Integer, Integer> activeRemainingByAbility(Bot bot) {
        Map<Integer, Integer> active = new HashMap<>();
        bot.abilityState.forEach((id, record) -> {
            if (record.stage == AbilityState.Stage.ACTIVE) active.put(id, Math.max(0, record.remainingMs));
        });
        return active;
    }

    /** A dead bot only runs out its active stages. */
    private static void runOutActiveStages(Bot bot) {
        for (AbilityState.Record record : bot.abilityState.values()) {
            if (record.stage != AbilityState.Stage.ACTIVE) continue;
            record.remainingMs = Math.max(0, record.remainingMs - STEP_MS);
            if (record.remainingMs <= 0) record.toReady();
        }
    }

    /**
     * Advances active and cooldown stages in order: when an active stage ends, only the part of the step left
     * over counts toward the cooldown that starts then. Cooldown modifiers were snapshotted at activation.
     */
    private static void tickAbilityTimers(Bot bot, int stepMs,
                                          Set<Integer> justActivatedAbilityIds) {
        for (Map.Entry<Integer, AbilityState.Record> entry : bot.abilityState.entrySet()) {
            AbilityState.Record record = entry.getValue();
            // Activation is at this step's boundary; the stage begins at its configured value.
            if (justActivatedAbilityIds.contains(entry.getKey())) continue;
            if (record.stage == AbilityState.Stage.ACTIVE) {
                if (record.remainingMs <= stepMs) {
                    int recoveryElapsed = Math.max(0, stepMs - record.remainingMs);
                    int cooldown = Math.max(0, record.cooldownMs - recoveryElapsed);
                    record.stage = cooldown > 0 ? AbilityState.Stage.COOLDOWN : AbilityState.Stage.READY;
                    record.remainingMs = cooldown;
                    record.cooldownMs = 0;
                } else {
                    record.remainingMs -= stepMs;
                }
            } else if (record.stage == AbilityState.Stage.COOLDOWN) {
                record.remainingMs = Math.max(0, record.remainingMs - stepMs);
                if (record.remainingMs <= 0) record.toReady();
            }
        }
    }

    private static void tickAbilityResources(Bot bot, int stepMs,
                                             java.util.Map<Integer, Integer> activeBeforeTimers,
                                             Set<Integer> justActivatedAbilityIds) {
        for (int abilityId : bot.abilities) {
            var definition = Abilities.definition(abilityId);
            if (definition.charges() <= 0) continue;
            int maxCharges = Abilities.maxCharges(abilityId, bot.maxHp);
            AbilityState.Record record = AbilityState.ensure(bot, abilityId);
            int charges = (int) clamp(record.charges == null ? definition.charges() : record.charges,
                    0, maxCharges);
            int activeBefore = Math.max(0, activeBeforeTimers.getOrDefault(abilityId, 0));
            int recoveryElapsed = justActivatedAbilityIds.contains(abilityId)
                    ? 0 : Math.max(0, stepMs - Math.min(stepMs, activeBefore));
            record.charges = charges;
            if (charges >= maxCharges) {
                record.reloadMs = null;
                continue;
            }
            if (definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY && charges == 0) {
                int remaining = Math.max(0,
                        (record.reloadMs == null ? definition.rechargeMs() : record.reloadMs) - recoveryElapsed);
                if (remaining == 0) {
                    record.charges = maxCharges;
                    record.reloadMs = null;
                } else {
                    record.reloadMs = remaining;
                }
            }
        }
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static int acceleratedCooldownMs(Bot bot, int cooldownMs) {
        return (int) Math.round(cooldownMs * cooldownStartMultiplier(bot));
    }

    private static double cooldownStartMultiplier(Bot bot) {
        return statusActive(bot, "overclock")
                ? Math.min(1.0, Math.max(0.0, statusEffectValue(
                        bot, "overclock", "cooldown_modifier", "multiplier", 1.0))) : 1.0;
    }

    private static void initializeCustomVariables(Bot bot) {
        JsonNode variables = bot.brain != null ? bot.brain.get("customVariables") : null;
        if (variables == null || !variables.isArray()) return;
        int slots = 0;
        for (JsonNode variable : variables) {
            slots += 1;
            if (slots > 100) break;
            String id = variable.path("id").asText("");
            String type = variable.path("valueType").asText("number");
            if (!id.startsWith(BotLogicContracts.CUSTOM_VARIABLE_PREFIX) || bot.customVariableTypes.containsKey(id)) continue;
            bot.customVariableTypes.put(id, type);
            bot.customVariables.put(id, "boolean".equals(type)
                    ? variable.path("initialValue").asBoolean(false)
                    : BotLogicContracts.truncateToNumberPrecision(Math.max(-BotLogicContracts.CUSTOM_NUMBER_LIMIT,
                            Math.min(BotLogicContracts.CUSTOM_NUMBER_LIMIT, variable.path("initialValue").asDouble(0)))));
        }
    }
}
