package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.simulation.bot.BotCodeService;
import com.example.botfight.simulation.ecs.AbilityEntitySystem;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.GameConfig;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.HitStagger;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.AbilityContracts.ShieldMode;
import com.example.botfight.simulation.gameconfig.Abilities.ResourceModel;
import java.util.EnumSet;
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

    DuelSimulationService.Bot create(DuelSimulationService.DuelBotRequest request) {
        DuelSimulationService.Bot bot = new DuelSimulationService.Bot();
        bot.userId = request.userId();
        bot.username = request.username();
        bot.slot = request.slot();
        bot.x = request.x();
        bot.y = request.y();
        bot.rotation = request.rotation() != null ? request.rotation() : request.slot() == 1 ? 90.0 : 270.0;
        bot.size = request.size();
        bot.brain = request.brain();
        bot.combatLoadout = "custom";
        initializeCustomVariables(bot);
        bot.abilities = botCodeService.readAbilities(request.brain());
        bot.maxHp = gameConfig.maxHp() + botCodeService.readStatPoints(request.brain(), "maxHp") * 10;
        bot.moveSpeed = gameConfig.moveSpeed() + botCodeService.readStatPoints(request.brain(), "moveSpeed");
        bot.attackDamageMultiplier = 1.0 + botCodeService.readStatPoints(request.brain(), "attackDamage") * 0.1;
        bot.attackSpeedMultiplier = 1.0 + botCodeService.readStatPoints(request.brain(), "attackSpeed") * 0.1;
        bot.hp = bot.maxHp;
        bot.spawnX = bot.x;
        bot.spawnY = bot.y;
        bot.abilities.stream()
                .filter(abilityId -> Abilities.definition(abilityId).charges() > 0)
                .forEach(abilityId -> bot.abilityCharges.put(
                        abilityId, Abilities.definition(abilityId).charges()));
        return bot;
    }

    void startTick(DuelSimulationService.Bot bot) {
        bot.tickStartHp = bot.hp;
        bot.damageTakenThisTick = 0;
    }

    TickState beginTick(DuelSimulationService.Bot bot) {
        bot.matchElapsedMs = Math.min(99_999_000L, bot.matchElapsedMs + STEP_MS);
        if (bot.hp <= 0) {
            bot.abilityActiveMs.replaceAll((id, value) -> Math.max(0, value - STEP_MS));
            bot.triggeredAbility = null;
            clearTriggeredConfiguration(bot);
            bot.abilitySpawn = null;
            bot.microDashActiveMs = 0;
            bot.microDashRemaining = 0;
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
            bot.velocityX = 0;
            bot.velocityY = 0;
            bot.hitStaggerMs = 0;
            bot.burnSourceSlot = 0;
            bot.bleedSourceSlot = 0;
            bot.shockSourceSlot = 0;
            bot.entityHitIds.clear();
            return new TickState(false, false, false, false, null);
        }

        boolean rewoundThisTick = false;
        boolean slowedWasActive = bot.slowedMs > 0;
        boolean hitStaggerWasActive = bot.hitStaggerMs > 0;
        bot.slowedMs = Math.max(0, bot.slowedMs - STEP_MS);
        bot.hitStaggerMs = Math.max(0, bot.hitStaggerMs - STEP_MS);
        bot.movementLockMs = Math.max(0, bot.movementLockMs - STEP_MS);
        if (bot.shockRemainingMs > 0) {
            bot.shockRemainingMs = Math.max(0, bot.shockRemainingMs - STEP_MS);
            bot.shockTickElapsedMs += STEP_MS;
            int shockTickMs = (int) Abilities.stat(13, "shockTickMs", 1_000);
            if (bot.shockTickElapsedMs >= shockTickMs) {
                bot.shockTickElapsedMs -= shockTickMs;
                applyDamage(bot, (int) Math.round(AbilityContracts.effectAmount(13, EffectType.DEBUFF)),
                        bot.shockSourceSlot);
                bot.movementLockMs = (int) Abilities.stat(13, "movementLockMs", 300);
            }
        }
        if (bot.shockRemainingMs <= 0) bot.shockSourceSlot = 0;
        if (bot.bleedRemainingMs > 0) {
            boolean tickDueBeforeOrAtExpiry = bot.bleedTickMs <= bot.bleedRemainingMs;
            bot.bleedRemainingMs = Math.max(0, bot.bleedRemainingMs - STEP_MS);
            bot.bleedTickMs -= STEP_MS;
            if (tickDueBeforeOrAtExpiry && bot.bleedTickMs <= 0) {
                applyDamage(bot, (int) Math.round(AbilityContracts.effectAmount(7, EffectType.DEBUFF)),
                        bot.bleedSourceSlot);
                bot.bleedTickMs += (int) Abilities.stat(7, "bleedTickMs", 1_000);
            }
            if (bot.bleedRemainingMs <= 0) {
                bot.bleedTickMs = 0;
                bot.bleedSourceSlot = 0;
            }
        }
        if (bot.temporalRewindMs > 0) {
            bot.temporalRewindMs = Math.max(0, bot.temporalRewindMs - STEP_MS);
            if (bot.temporalRewindMs == 0) {
                bot.x = bot.temporalRewindX;
                bot.y = bot.temporalRewindY;
                bot.hp = Math.min(bot.maxHp, bot.temporalRewindHp);
                bot.temporalRewindPulseMs = (int) Abilities.stat(21, "pulseMs", 400);
                rewoundThisTick = true;
            }
        }
        bot.temporalRewindPulseMs = Math.max(0, bot.temporalRewindPulseMs - STEP_MS);
        Integer channelledAbility = bot.abilityActiveMs.entrySet().stream()
                .filter(entry -> entry.getValue() > 0)
                .map(java.util.Map.Entry::getKey)
                .filter(id -> Abilities.definition(id).activationModel() == Abilities.ActivationModel.CHANNELLED)
                .findFirst()
                .orElse(null);
        bot.microDashActiveMs = Math.max(0, bot.microDashActiveMs - STEP_MS);
        bot.stunnedMs = Math.max(0, bot.stunnedMs - STEP_MS);
        bot.silencedMs = Math.max(0, bot.silencedMs - STEP_MS);
        bot.quickJabComboMs = Math.max(0, bot.quickJabComboMs - STEP_MS);
        if (bot.quickJabComboMs == 0) bot.quickJabComboCount = 0;
        bot.abilityCooldowns.replaceAll((id, value) -> Math.max(0, value - STEP_MS));
        tickAbilityResources(bot, STEP_MS);
        bot.abilityActiveMs.replaceAll((id, value) -> Math.max(0, value - STEP_MS));
        bot.triggeredAbility = null;
        clearTriggeredConfiguration(bot);
        bot.entityHitIds.clear();
        bot.abilitySpawn = null;
        return new TickState(true, rewoundThisTick, slowedWasActive, hitStaggerWasActive, channelledAbility);
    }

    private static void clearTriggeredConfiguration(DuelSimulationService.Bot bot) {
        bot.triggeredMovementMode = null;
        bot.triggeredMovementDirection = null;
        bot.triggeredPhaseFacingMode = null;
    }

    void settleTick(DuelSimulationService.Bot bot) {
        if (bot.pendingHealing > 0) {
            bot.hp = Math.min(bot.maxHp, bot.hp + bot.pendingHealing);
            bot.pendingHealing = 0;
        }
        bot.damageTakenLastTick = bot.damageTakenThisTick;
        bot.hpNetChangeLastTick = bot.hp - bot.tickStartHp;
    }

    void applyDamage(DuelSimulationService.Bot target, int damage) {
        applyDamage(target, damage, (Integer) null);
    }

    void applyDamage(DuelSimulationService.Bot target, int damage, DuelSimulationService.Bot source) {
        applyDamage(target, damage, source == null ? null : source.slot);
    }

    void applyDamage(DuelSimulationService.Bot target, int damage, Integer sourceSlot) {
        if (target.hp <= 0 || target.ignoresHostileEffects()) return;
        int previousHp = target.hp;
        int remaining = Math.max(0, damage);
        if (target.abilityActiveMs.getOrDefault(16, 0) > 0) remaining = (int) Math.round(remaining * 0.5);
        if (target.shieldHp > 0 && remaining > 0) {
            int absorbed = Math.min(target.shieldHp, remaining);
            target.shieldHp -= absorbed;
            remaining -= absorbed;
        }
        if (remaining > 0) target.hp = Math.max(0, target.hp - remaining);
        int appliedDamage = Math.max(0, previousHp - target.hp);
        target.damageTakenThisTick += appliedDamage;
        if (appliedDamage > 0 && sourceSlot != null && sourceSlot != target.slot) {
            target.hitStaggerMs = Math.max(target.hitStaggerMs, HitStagger.DURATION_MS);
        }
        if (previousHp > 0 && target.hp <= 0) clearBotEffects(target);
    }

    void applyDamageFrom(DuelSimulationService.Bot source, DuelSimulationService.Bot target, int damage) {
        boolean reflecting = source != null && source != target
                && target.abilityActiveMs.getOrDefault(16, 0) > 0;
        applyDamage(target, damage, source);
        if (reflecting) applyDamage(source, (int) Math.round(Math.max(0, damage) * 0.5), target);
    }

    AbilityEntitySystem.ShieldResult resolveShield(
            DuelSimulationService.Bot bot,
            double sourceX,
            double sourceY,
            int abilityId) {
        return resolveShield(bot, sourceX, sourceY, abilityId, null);
    }

    AbilityEntitySystem.ShieldResult resolveShield(
            DuelSimulationService.Bot bot,
            double sourceX,
            double sourceY,
            int abilityId,
            Integer chargeCost) {
        if (bot.ignoresHostileEffects()) {
            return new AbilityEntitySystem.ShieldResult(true, EnumSet.allOf(EffectType.class));
        }
        var policy = AbilityContracts.get(abilityId).shieldInteraction();
        Integer shieldAbility = activeShieldAbility(bot);
        if (policy.mode() == ShieldMode.IGNORE
                || shieldAbility == null
                || abilityCharges(bot, shieldAbility) <= 0) return AbilityEntitySystem.ShieldResult.none();
        if (policy.mode() == ShieldMode.BLOCK
                && !blocksPoint(bot, shieldAbility, sourceX, sourceY, policy.halfArcDegrees())) {
            return AbilityEntitySystem.ShieldResult.none();
        }
        int charges = chargeCost != null ? chargeCost
                : policy.chargeCost() == AbilityContracts.ChargeCost.ALL ? abilityCharges(bot, shieldAbility) : 1;
        consumeAbilityCharges(bot, shieldAbility, charges);
        return new AbilityEntitySystem.ShieldResult(policy.mode() == ShieldMode.BLOCK, policy.prevents());
    }

    double damageMultiplier(DuelSimulationService.Bot bot) {
        return bot.attackDamageMultiplier;
    }

    void clearBotEffects(DuelSimulationService.Bot bot) {
        bot.shieldHp = 0;
        bot.slowedMs = 0;
        bot.hitStaggerMs = 0;
        bot.silencedMs = 0;
        bot.nullZoneSilenced = false;
        bot.burnRemainingMs = 0;
        bot.burnTickMs = 0;
        bot.burnAbilityId = null;
        bot.burnDamageMultiplier = 1.0;
        bot.burnSourceSlot = 0;
        bot.bleedRemainingMs = 0;
        bot.bleedTickMs = 0;
        bot.bleedSourceSlot = 0;
        bot.stunnedMs = 0;
        bot.shockRemainingMs = 0;
        bot.shockTickElapsedMs = 0;
        bot.shockSourceSlot = 0;
        bot.movementLockMs = 0;
        bot.microDashActiveMs = 0;
        bot.microDashRemaining = 0;
        bot.abilityActiveMs.clear();
        bot.quickJabComboCount = 0;
        bot.quickJabComboMs = 0;
        bot.temporalRewindMs = 0;
        bot.temporalRewindPulseMs = 0;
        bot.pendingHealing = 0;
        bot.utilityHealAccumulatorMs = 0;
    }

    private static boolean hasAbility(DuelSimulationService.Bot bot, int ability) {
        return bot.abilities.contains(ability);
    }

    private static boolean blocksPoint(DuelSimulationService.Bot defender, int shieldAbility,
                                       double sourceX, double sourceY, double halfArcDegrees) {
        if (defender.abilityActiveMs.getOrDefault(shieldAbility, 0) <= 0
                || abilityCharges(defender, shieldAbility) <= 0) return false;
        double bearing = vectorBearing(sourceX - defender.x, sourceY - defender.y);
        return Math.abs(shortestDelta(defender.rotation, bearing)) <= halfArcDegrees;
    }

    private static Integer activeShieldAbility(DuelSimulationService.Bot bot) {
        return bot.abilities.stream()
                .filter(id -> Abilities.stat(id, "shield", 0) > 0)
                .filter(id -> bot.abilityActiveMs.getOrDefault(id, 0) > 0)
                .findFirst()
                .orElse(null);
    }

    static int abilityCharges(DuelSimulationService.Bot bot, int abilityId) {
        return bot.abilityCharges.getOrDefault(abilityId, 0);
    }

    int abilityRechargeMs(DuelSimulationService.Bot bot, int abilityId) {
        var definition = Abilities.definition(abilityId);
        int timer = bot.abilityRechargeMs.getOrDefault(abilityId, 0);
        return definition.resourceModel() == ResourceModel.REGENERATE && abilityCharges(bot, abilityId) < definition.charges()
                ? Math.max(0, definition.rechargeMs() - timer) : timer;
    }

    boolean consumeAbilityCharge(DuelSimulationService.Bot bot, int abilityId) {
        return consumeAbilityCharges(bot, abilityId, 1);
    }

    void setAbilityReuseCooldown(DuelSimulationService.Bot bot, int abilityId) {
        int reuseMs = Abilities.definition(abilityId).reuseCooldownMs();
        bot.abilityCooldowns.merge(abilityId, reuseMs, Math::max);
    }

    private static boolean consumeAbilityCharges(
            DuelSimulationService.Bot bot, int abilityId, int amount) {
        var definition = Abilities.definition(abilityId);
        if (definition.charges() <= 0) return true;
        int current = bot.abilityCharges.getOrDefault(abilityId, 0);
        if (current <= 0) return false;
        int remaining = Math.max(0, current - Math.max(0, amount));
        bot.abilityCharges.put(abilityId, remaining);
        if (remaining == 0 && definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY) {
            bot.abilityRechargeMs.put(abilityId,
                    (int) Math.round(definition.rechargeMs() / bot.attackSpeedMultiplier));
        }
        if (remaining == 0 && definition.reuseCooldownMs() > 0) {
            bot.abilityActiveMs.remove(abilityId);
            bot.abilityCooldowns.merge(abilityId, definition.reuseCooldownMs(), Math::max);
        }
        return true;
    }

    private static void tickAbilityResources(DuelSimulationService.Bot bot, int stepMs) {
        for (int abilityId : bot.abilities) {
            var definition = Abilities.definition(abilityId);
            if (definition.charges() <= 0) continue;
            int charges = (int) clamp(bot.abilityCharges.getOrDefault(abilityId, definition.charges()),
                    0, definition.charges());
            bot.abilityCharges.put(abilityId, charges);
            if (charges >= definition.charges()) {
                bot.abilityRechargeMs.remove(abilityId);
                continue;
            }
            if (definition.resourceModel() == ResourceModel.REGENERATE) {
                int elapsed = bot.abilityRechargeMs.getOrDefault(abilityId, 0) + stepMs;
                while (charges < definition.charges() && elapsed >= definition.rechargeMs()) {
                    charges += 1;
                    elapsed -= definition.rechargeMs();
                }
                bot.abilityCharges.put(abilityId, charges);
                if (charges >= definition.charges()) bot.abilityRechargeMs.remove(abilityId);
                else bot.abilityRechargeMs.put(abilityId, elapsed);
            } else if (definition.resourceModel() == ResourceModel.RELOAD_WHEN_EMPTY && charges == 0) {
                int remaining = Math.max(0,
                        bot.abilityRechargeMs.getOrDefault(abilityId, definition.rechargeMs()) - stepMs);
                if (remaining == 0) {
                    bot.abilityCharges.put(abilityId, definition.charges());
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

    record TickState(boolean alive, boolean rewoundThisTick, boolean slowedWasActive,
                     boolean hitStaggerWasActive, Integer channelledAbility) {
    }

    private static void initializeCustomVariables(DuelSimulationService.Bot bot) {
        JsonNode variables = bot.brain != null ? bot.brain.get("customVariables") : null;
        if (variables == null || !variables.isArray()) return;
        int slots = 0;
        for (JsonNode variable : variables) {
            JsonNode conditions = variable.get("conditions");
            slots += 1 + (conditions != null && conditions.isArray() ? conditions.size() : 0);
            if (slots > 100) break;
            String id = variable.path("id").asText("");
            String type = variable.path("valueType").asText("number");
            if (!id.startsWith("custom.") || bot.customVariableTypes.containsKey(id)) continue;
            bot.customVariableTypes.put(id, type);
            bot.customVariables.put(id, "boolean".equals(type)
                    ? variable.path("initialValue").asBoolean(false)
                    : Math.max(-99_999L, Math.min(99_999L, (long) variable.path("initialValue").asDouble(0))));
            if ("boolean".equals(type) && conditions != null && conditions.isArray()) {
                bot.customVariableConditions.put(id, conditions);
            }
        }
    }
}
