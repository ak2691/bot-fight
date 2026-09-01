package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.GameConfig;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.HitStagger;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.Abilities.ResourceModel;
import java.util.HashMap;
import java.util.List;
import java.util.EnumSet;
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

    private final GameConfig gameConfig;
    private final BotCodeService botCodeService;

    public BotStateService(GameConfigCatalog gameConfigCatalog, BotCodeService botCodeService) {
        this.gameConfig = gameConfigCatalog.duelV1();
        this.botCodeService = botCodeService;
    }

    public DuelSimulationService.Bot create(DuelSimulationService.DuelBotRequest request) {
        DuelSimulationService.Bot bot = new DuelSimulationService.Bot();
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
        bot.abilities.stream()
                .filter(abilityId -> Abilities.definition(abilityId).charges() > 0)
                .filter(abilityId -> Abilities.definition(abilityId).resourceModel() != ResourceModel.FIXED)
                .forEach(abilityId -> bot.abilityCharges.put(abilityId, Abilities.maxCharges(abilityId, bot.maxHp)));
        return bot;
    }

    public void startTick(DuelSimulationService.Bot bot) {
        bot.tickStartHp = bot.hp;
        bot.damageTakenThisTick = 0;
        // The browser clears one-tick outputs before the next action is
        // selected.  Keep the authoritative working state at that same
        // boundary; the current tick may repopulate these fields below.
        bot.triggeredAbility = null;
        bot.triggeredAbilityPayload = null;
        bot.abilitySpawn = null;
        bot.visualOriginX = Double.NaN;
        bot.visualOriginY = Double.NaN;
        bot.visualOriginRotation = Double.NaN;
        bot.entityHitIds.clear();
    }

    public void beginTick(DuelSimulationService.Bot bot) {
        bot.matchElapsedMs = Math.min(99_999_000L, bot.matchElapsedMs + STEP_MS);
        if (bot.hp <= 0) {
            bot.abilityActiveMs.replaceAll((id, value) -> Math.max(0, value - STEP_MS));
            bot.dashActiveMs = 0;
            bot.dashRemaining = 0;
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
            bot.velocityX = 0;
            bot.velocityY = 0;
            bot.entityHitIds.clear();
            bot.damageTakenThisTick = 0;
            return;
        }

        var activeBeforeTimers = new HashMap<>(bot.abilityActiveMs);
        tickAbilityTimers(bot, STEP_MS);
        tickAbilityResources(bot, STEP_MS, activeBeforeTimers);
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

    private void tickStatuses(DuelSimulationService.Bot bot) {
        for (String key : new ArrayList<>(bot.statusEffects.keySet())) {
            StatusEffectState status = bot.statusEffects.get(key);
            if (status == null || !status.active()) {
                bot.statusEffects.remove(key);
                continue;
            }
            if ("presence".equals(status.mode)) continue;
            int previousRemainingMs = Math.max(0, status.remainingMs);
            int activeElapsedMs = Math.min(STEP_MS, previousRemainingMs);
            int tickMs = Math.max(0, status.tickMs);
            int tickElapsedMs = Math.max(0, status.tickElapsedMs) + activeElapsedMs;
            while (tickMs > 0 && tickElapsedMs >= tickMs) {
                for (StatusEffectState.Effect effect : status.effects) {
                    if (!"tick".equals(effect.mode)) continue;
                    if ("damage".equals(effect.type)) {
                        applyDamage(bot, Math.max(0, effect.amount * effect.multiplier), status.sourceSlot);
                        if (bot.hp <= 0) return;
                    } else if ("movement_lock".equals(effect.type) && effect.durationMs > 0) {
                        upsertStatusEffect(bot, new StatusEffectState("movement-lock", effect.durationMs, 0));
                    }
                }
                tickElapsedMs -= tickMs;
            }
            status.remainingMs = Math.max(0, previousRemainingMs - STEP_MS);
            status.tickElapsedMs = status.remainingMs > 0 && tickMs > 0 ? tickElapsedMs : 0;
            if (status.remainingMs <= 0) bot.statusEffects.remove(key);
        }
    }

    public static boolean statusActive(DuelSimulationService.Bot bot, String type) {
        return bot != null && bot.statusEffects.values().stream()
                .filter(status -> type.equalsIgnoreCase(status.type))
                .anyMatch(StatusEffectState::active);
    }

    public static int statusRemainingMs(DuelSimulationService.Bot bot, String type) {
        return bot == null ? 0 : bot.statusEffects.values().stream()
                .filter(status -> type.equalsIgnoreCase(status.type) && !"presence".equals(status.mode))
                .mapToInt(status -> Math.max(0, status.remainingMs)).max().orElse(0);
    }

    public static double statusEffectValue(DuelSimulationService.Bot bot, String statusType, String effectType,
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

    public static void upsertStatusEffect(DuelSimulationService.Bot bot, StatusEffectState incoming) {
        if (bot == null || incoming == null || incoming.type == null || incoming.type.isBlank()) return;
        incoming.type = incoming.type.toLowerCase(Locale.ROOT);
        incoming.mode = "presence".equals(incoming.mode) ? "presence" : "duration";
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
            }
        }
    }

    public void settleTick(DuelSimulationService.Bot bot) {
        if (bot.pendingHealing > 0) {
            bot.hp = Math.min(bot.maxHp, bot.hp + bot.pendingHealing);
            bot.pendingHealing = 0;
        }
        bot.damageTakenLastTick = bot.damageTakenThisTick;
        bot.hpNetChangeLastTick = bot.hp - bot.tickStartHp;
    }

    public void applyDamage(DuelSimulationService.Bot target, double damage) {
        applyDamage(target, damage, (Integer) null);
    }

    public void applyClosingZoneDamage(DuelSimulationService.Bot target, double damage) {
        double previousHp = target.hp;
        applyDamage(target, damage);
        if (target.hp < previousHp) target.closingZoneDamageCount++;
    }

    public void applyDamage(DuelSimulationService.Bot target, double damage, DuelSimulationService.Bot source) {
        applyDamage(target, damage, source == null ? null : source.slot,
                source == null ? Double.NaN : source.x,
                source == null ? Double.NaN : source.y);
    }

    public void applyDamage(DuelSimulationService.Bot target, double damage, Integer sourceSlot) {
        applyDamage(target, damage, sourceSlot, Double.NaN, Double.NaN);
    }

    public void applyDamage(DuelSimulationService.Bot target, double damage, Integer sourceSlot,
                            double sourceX, double sourceY) {
        if (target.hp <= 0 || target.ignoresHostileEffects()) return;
        double previousHp = target.hp;
        double incomingDamageMultiplier = statusEffectValue(
                target, "incoming-damage", "incoming_damage_modifier", "multiplier", 1.0);
        double remaining = Math.max(0, damage) * Math.max(0, incomingDamageMultiplier);
        double reactiveArmorMultiplier = statusEffectValue(
                target, "reactive-armor", "incoming_damage_modifier", "multiplier", 1.0);
        remaining = roundCombatValue(remaining * Math.max(0, reactiveArmorMultiplier));
        if (remaining > 0) target.hp = roundCombatValue(Math.max(0, target.hp - remaining));
        double appliedDamage = roundCombatValue(Math.max(0, previousHp - target.hp));
        target.damageTakenThisTick = roundCombatValue(target.damageTakenThisTick + appliedDamage);
        if (appliedDamage > 0 && sourceSlot != null && sourceSlot != target.slot) {
            upsertStatusEffect(target, new StatusEffectState("hit-stagger", HitStagger.DURATION_MS, 0)
                    .addEffect(new StatusEffectState.Effect("movement_modifier", "constant")
                            .movement(HitStagger.MOVEMENT_MULTIPLIER, HitStagger.ROTATION_MULTIPLIER)));
        }
        if (previousHp > 0 && target.hp <= 0) clearBotEffects(target);
    }

    public void applyDamageFrom(DuelSimulationService.Bot source, DuelSimulationService.Bot target, double damage) {
        double reflectionMultiplier = statusEffectValue(
                target, "reactive-armor", "damage_reflection", "multiplier", 0.0);
        boolean reflecting = source != null && source != target && reflectionMultiplier > 0;
        applyDamage(target, damage, source.slot, source.x, source.y);
        if (reflecting) applyDamage(source,
                roundCombatValue(Math.max(0, damage) * reflectionMultiplier), target);
    }

    private static double roundCombatValue(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    public AbilityEntitySystem.ShieldResult resolveShield(
            DuelSimulationService.Bot bot,
            double sourceX,
            double sourceY,
            int abilityId) {
        return resolveShield(bot, sourceX, sourceY, abilityId, null);
    }

    public AbilityEntitySystem.ShieldResult resolveShield(
            DuelSimulationService.Bot bot,
            double sourceX,
            double sourceY,
            int abilityId,
            Integer chargeCost) {
        if (bot.ignoresHostileEffects()) {
            return new AbilityEntitySystem.ShieldResult(true, EnumSet.allOf(EffectType.class));
        }
        return AbilityEntitySystem.ShieldResult.none();
    }

    public double damageMultiplier(DuelSimulationService.Bot bot) {
        return bot.attackDamageMultiplier;
    }

    public void clearBotEffects(DuelSimulationService.Bot bot) {
        bot.statusEffects.clear();
        bot.dashActiveMs = 0;
        bot.dashRemaining = 0;
        bot.abilityActiveMs.clear();
        bot.abilityPendingCooldownMs.forEach((abilityId, pending) ->
                bot.abilityCooldowns.merge(abilityId, pending, Math::max));
        bot.abilityPendingCooldownMs.clear();
        bot.temporalRewindMs = 0;
        bot.temporalRewindPulseMs = 0;
        bot.pendingHealing = 0;
        bot.utilityHealAccumulatorMs = 0;
    }

    public static int abilityCharges(DuelSimulationService.Bot bot, int abilityId) {
        int maxCharges = Abilities.maxCharges(abilityId, bot.maxHp);
        return Math.max(0, Math.min(
                maxCharges,
                bot.abilityCharges.getOrDefault(abilityId, 0)));
    }

    public int abilityRechargeMs(DuelSimulationService.Bot bot, int abilityId) {
        var definition = Abilities.definition(abilityId);
        int timer = bot.abilityRechargeMs.getOrDefault(abilityId, 0);
        return definition.resourceModel() == ResourceModel.REGENERATE && abilityCharges(bot, abilityId) < definition.charges()
                ? Math.max(0, definition.rechargeMs() - timer) : timer;
    }

    public boolean consumeAbilityCharge(DuelSimulationService.Bot bot, int abilityId) {
        return consumeAbilityCharges(bot, abilityId, 1);
    }

    public void startAbilityResource(DuelSimulationService.Bot bot, int abilityId) {
        var definition = Abilities.definition(abilityId);
        if (definition.resourceModel() != ResourceModel.FIXED || definition.charges() <= 0) return;
        bot.abilityCharges.put(abilityId, definition.charges());
        bot.abilityRechargeMs.put(abilityId, 0);
    }

    public void setAbilityReuseCooldown(DuelSimulationService.Bot bot, int abilityId) {
        int reuseMs = Abilities.definition(abilityId).reuseCooldownMs();
        setAbilityCooldown(bot, abilityId, acceleratedCooldownMs(bot, reuseMs));
    }

    /**
     * Interrupts every bot-owned preparation or active phase without removing
     * any already-spawned ability entity. Each interrupted phase immediately
     * enters its normal cooldown or reload gate.
     */
    public static boolean interruptCurrentAbility(DuelSimulationService.Bot bot) {
        if (bot == null || bot.hp <= 0) return false;
        Set<Integer> abilityIds = new HashSet<>();
        if (bot.preparingAbility != null && bot.preparingMs > 0) {
            abilityIds.add(bot.preparingAbility);
        }
        bot.abilityActiveMs.forEach((abilityId, activeMs) -> {
            if (activeMs != null && activeMs > 0) abilityIds.add(abilityId);
        });
        boolean interrupted = false;
        for (Integer abilityId : abilityIds) {
            interrupted |= interruptAbility(bot, abilityId);
        }
        bot.preparingAbility = null;
        bot.preparingMs = 0;
        bot.preparingTargetX = Double.NaN;
        bot.preparingTargetY = Double.NaN;
        return interrupted;
    }

    /** Applies the shared interrupt state transition and its control status. */
    public static void applyInterrupt(DuelSimulationService.Bot bot, int durationMs,
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

    private static boolean interruptAbility(DuelSimulationService.Bot bot, int abilityId) {
        boolean preparing = bot.preparingAbility != null
                && bot.preparingAbility == abilityId
                && bot.preparingMs > 0;
        boolean active = bot.abilityActiveMs.getOrDefault(abilityId, 0) > 0;
        if (!preparing && !active) return false;

        var definition = Abilities.definition(abilityId);
        if (preparing) {
            bot.preparingAbility = null;
            bot.preparingMs = 0;
            bot.preparingTargetX = Double.NaN;
            bot.preparingTargetY = Double.NaN;
        }
        if (active) bot.abilityActiveMs.put(abilityId, 0);

        boolean reloadActive = definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY
                && abilityCharges(bot, abilityId) == 0
                && bot.abilityRechargeMs.getOrDefault(abilityId, 0) > 0;
        if (preparing && !reloadActive
                && definition.charges() > 0
                && definition.resourceModel() != ResourceModel.FIXED
                && definition.resourceModel() != ResourceModel.HP
                && abilityCharges(bot, abilityId) > 0) {
            if (consumeAbilityCharges(bot, abilityId, 1)) {
                reloadActive = definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY
                        && abilityCharges(bot, abilityId) == 0
                        && bot.abilityRechargeMs.getOrDefault(abilityId, 0) > 0;
            }
        }

        if (reloadActive) {
            bot.abilityCooldowns.put(abilityId, 0);
            bot.abilityPendingCooldownMs.remove(abilityId);
        } else {
            double attackSpeed = bot.attackSpeedMultiplier > 0
                    && Double.isFinite(bot.attackSpeedMultiplier) ? bot.attackSpeedMultiplier : 1.0;
            int baseCooldown = definition.cooldownMs() > 0
                    ? definition.cooldownMs() : definition.reuseCooldownMs();
            int cooldownMs = (int) Math.round(baseCooldown / attackSpeed * cooldownStartMultiplier(bot));
            setAbilityCooldown(bot, abilityId, cooldownMs);
        }

        var contract = AbilityContracts.all().get(abilityId);
        if (active && contract != null && contract.execution().movement() != null) {
            bot.dashActiveMs = 0;
            bot.dashRemaining = 0;
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
            bot.velocityX = 0;
            bot.velocityY = 0;
        }
        return true;
    }

    /** Sets a cooldown in the active or recovery phase without exposing both at once. */
    public static void setAbilityCooldown(DuelSimulationService.Bot bot, int abilityId, int cooldownMs) {
        int requested = Math.max(0, cooldownMs);
        int current = Math.max(
                bot.abilityCooldowns.getOrDefault(abilityId, 0),
                bot.abilityPendingCooldownMs.getOrDefault(abilityId, 0));
        if (bot.abilityActiveMs.getOrDefault(abilityId, 0) > 0) {
            bot.abilityCooldowns.put(abilityId, 0);
            int pending = Math.max(current, requested);
            if (pending > 0) bot.abilityPendingCooldownMs.put(abilityId, pending);
            else bot.abilityPendingCooldownMs.remove(abilityId);
        } else {
            bot.abilityCooldowns.put(abilityId, Math.max(current, requested));
            bot.abilityPendingCooldownMs.remove(abilityId);
        }
    }

    private static boolean consumeAbilityCharges(
            DuelSimulationService.Bot bot, int abilityId, int amount) {
        var definition = Abilities.definition(abilityId);
        if (definition.charges() <= 0) return true;
        int current = bot.abilityCharges.getOrDefault(abilityId, 0);
        if (current <= 0) return false;
        int remaining = Math.max(0, current - Math.max(0, amount));
        if (remaining == 0 && definition.resourceModel() == ResourceModel.FIXED) {
            bot.abilityCharges.remove(abilityId);
            bot.abilityRechargeMs.remove(abilityId);
            bot.abilityActiveMs.remove(abilityId);
        } else {
            bot.abilityCharges.put(abilityId, remaining);
        }
        if (remaining == 0 && definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY) {
            bot.abilityRechargeMs.put(abilityId,
                    (int) Math.round(definition.rechargeMs() / bot.attackSpeedMultiplier
                            * cooldownStartMultiplier(bot)));
        }
        if (remaining > 0 && definition.reuseCooldownMs() > 0) {
            setAbilityCooldown(bot, abilityId, definition.reuseCooldownMs());
        }
        return true;
    }

    /** Advances active/recovery phases in order; cooldown modifiers are snapshotted at activation. */
    private static void tickAbilityTimers(DuelSimulationService.Bot bot, int stepMs) {
        Set<Integer> abilityIds = new HashSet<>(bot.abilityCooldowns.keySet());
        abilityIds.addAll(bot.abilityPendingCooldownMs.keySet());
        abilityIds.addAll(bot.abilityActiveMs.keySet());
        for (Integer abilityId : abilityIds) {
            int activeBefore = Math.max(0, bot.abilityActiveMs.getOrDefault(abilityId, 0));
            int visible = Math.max(0, bot.abilityCooldowns.getOrDefault(abilityId, 0));
            int pending = Math.max(0, bot.abilityPendingCooldownMs.getOrDefault(abilityId, 0));
            if (activeBefore > 0) {
                // Migrate old/incoming state that still carries recovery in the
                // visible map while the active phase is running.
                pending = Math.max(pending, visible);
                bot.abilityCooldowns.put(abilityId, 0);
                if (activeBefore <= stepMs) {
                    int recoveryElapsed = Math.max(0, stepMs - activeBefore);
                    bot.abilityCooldowns.put(abilityId, Math.max(0, pending - recoveryElapsed));
                    bot.abilityPendingCooldownMs.remove(abilityId);
                } else if (pending > 0) {
                    bot.abilityPendingCooldownMs.put(abilityId, pending);
                } else {
                    bot.abilityPendingCooldownMs.remove(abilityId);
                }
            } else {
                int current = Math.max(visible, pending);
                bot.abilityCooldowns.put(abilityId, Math.max(0, current - stepMs));
                bot.abilityPendingCooldownMs.remove(abilityId);
            }
        }
        bot.abilityActiveMs.replaceAll((id, value) -> Math.max(0, value - stepMs));
    }

    private static void tickAbilityResources(DuelSimulationService.Bot bot, int stepMs,
                                             java.util.Map<Integer, Integer> activeBeforeTimers) {
        for (int abilityId : bot.abilities) {
            var definition = Abilities.definition(abilityId);
            if (definition.charges() <= 0) continue;
            int maxCharges = Abilities.maxCharges(abilityId, bot.maxHp);
            int charges = (int) clamp(bot.abilityCharges.getOrDefault(abilityId, definition.charges()),
                    0, maxCharges);
            if (definition.resourceModel() == ResourceModel.FIXED) {
                if (bot.abilityActiveMs.getOrDefault(abilityId, 0) <= 0) {
                    bot.abilityCharges.remove(abilityId);
                } else {
                    bot.abilityCharges.put(abilityId, charges);
                }
                bot.abilityRechargeMs.remove(abilityId);
                continue;
            }
            int activeBefore = Math.max(0, activeBeforeTimers.getOrDefault(abilityId, 0));
            int recoveryElapsed = Math.max(0, stepMs - Math.min(stepMs, activeBefore));
            bot.abilityCharges.put(abilityId, charges);
            if (charges >= maxCharges) {
                bot.abilityRechargeMs.remove(abilityId);
                continue;
            }
            if (definition.resourceModel() == ResourceModel.REGENERATE) {
                int elapsed = bot.abilityRechargeMs.getOrDefault(abilityId, 0) + recoveryElapsed;
                while (charges < maxCharges && elapsed >= definition.rechargeMs()) {
                    charges += 1;
                    elapsed -= definition.rechargeMs();
                }
                bot.abilityCharges.put(abilityId, charges);
                if (charges >= maxCharges) bot.abilityRechargeMs.remove(abilityId);
                else bot.abilityRechargeMs.put(abilityId, elapsed);
            } else if (definition.resourceModel() == ResourceModel.HP) {
                if (bot.abilityActiveMs.getOrDefault(abilityId, 0) > 0) continue;
                int rateHpPerSecond = Math.max(0,
                        (int) Math.floor(Abilities.stat(abilityId, "chargeRegenHpPerSecond", 0)));
                long total = bot.abilityRechargeMs.getOrDefault(abilityId, 0)
                        + (long) rateHpPerSecond * recoveryElapsed;
                int gained = (int) (total / 1_000L);
                charges = Math.min(maxCharges, charges + gained);
                bot.abilityCharges.put(abilityId, charges);
                if (charges >= maxCharges) bot.abilityRechargeMs.remove(abilityId);
                else bot.abilityRechargeMs.put(abilityId, (int) (total % 1_000L));
            } else if (definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY && charges == 0) {
                int remaining = Math.max(0,
                        bot.abilityRechargeMs.getOrDefault(abilityId, definition.rechargeMs()) - recoveryElapsed);
                if (remaining == 0) {
                    bot.abilityCharges.put(abilityId, maxCharges);
                    bot.abilityRechargeMs.remove(abilityId);
                } else {
                    bot.abilityRechargeMs.put(abilityId, remaining);
                }
            }
        }
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static int acceleratedCooldownMs(DuelSimulationService.Bot bot, int cooldownMs) {
        return (int) Math.round(cooldownMs * cooldownStartMultiplier(bot));
    }

    private static double cooldownStartMultiplier(DuelSimulationService.Bot bot) {
        return statusActive(bot, "overclock")
                ? Math.min(1.0, Math.max(0.0, statusEffectValue(
                        bot, "overclock", "cooldown_modifier", "multiplier", 1.0))) : 1.0;
    }

    private static void initializeCustomVariables(DuelSimulationService.Bot bot) {
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
