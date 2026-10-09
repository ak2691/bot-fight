package com.example.botfight.simulation.core.orchestration;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.BrainNormalizer;
import com.example.botfight.simulation.core.combat.AbilityExecutionPayload;
import com.example.botfight.simulation.core.logic.ChainRuntime;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** The mutable per-bot working state of one authoritative duel. */
public final class Bot implements Entity, AbilityEntityBot {
    public UUID userId;
    public String username;
    public int slot;
    /** Team identity used for targeting, friendly-fire rules, and scoring. */
    public int teamNumber;
    public double x;
    public double y;
    public double rotation;
    public int size;
    public String combatLoadout;
    public JsonNode brain;
    /** Coordinate semantics are owned by this bot's submitted brain. */
    public String brainSchemaVersion = BotLogicContracts.BRAIN_SCHEMA_V1;
    public List<BrainNormalizer.TreeRoot> normalizedStrategy = List.of();
    public Map<String, ChainRuntime.Chain> normalizedChains = Map.of();
    /** The running action chain's call stack. It persists across ticks like the custom variables. */
    public List<ChainRuntime.Frame> chainStack = new ArrayList<>();
    /** Display metadata from the same normalized chains used by authoritative execution. */
    public String chainName(String chainId) {
        var chain = normalizedChains.get(chainId);
        return chain == null ? chainId : chain.name();
    }
    /** What the brain decided for the tick that just ran (read by tests and replays). */
    public Action lastPredictedAction;
    public Set<Integer> abilities = Set.of();
    public double hp;
    public long matchElapsedMs;
    public double maxHp;
    public double moveSpeed;
    public double attackDamageMultiplier = 1.0;
    public double attackSpeedMultiplier = 1.0;
    public double spawnX;
    public double spawnY;
    public int abilityEntitySerial = 1;
    public Map<String, StatusEffectState> statusEffects = new HashMap<>();
    public double dashRemaining;
    public double dashStepDistance;
    public double dashDirectionX;
    public double dashDirectionY;
    public double movementVelocityX;
    public double movementVelocityY;
    public double velocityX;
    public double velocityY;
    /** Start of the movement segment swept during the current tick. */
    public double movementStartX;
    public double movementStartY;
    public int utilityHealAccumulatorMs;
    /** One record per ability: stage, time left, reserved cooldown, charges, reload and wind-up target. */
    public Map<Integer, com.example.botfight.simulation.core.state.AbilityState.Record> abilityState = new HashMap<>();
    /** Milliseconds since each ability last hit an enemy bot; absent when it never has. */
    public Map<Integer, Integer> abilityLastHitAgeMs = new HashMap<>();
    /** Abilities that hit an enemy bot this tick, settled into abilityLastHitAgeMs by settleTick. */
    public Set<Integer> abilityHitsThisTick = new java.util.LinkedHashSet<>();
    /** Counts this bot's ability activations, so a hit stamina refund is paid once per activation. */
    public int activationSerial;
    /** Activations that already paid their hit refund. */
    public Set<Integer> refundedActivations = new java.util.HashSet<>();
    /** The activation that spawned each of this bot's entities, by entity id. */
    public Map<String, Integer> entityActivations = new HashMap<>();
    /** Hit refunds earned this tick, paid into stamina by settleTick. */
    public int pendingStaminaRefund;
    public Map<String, Object> customVariables = new HashMap<>();
    public Map<String, String> customVariableTypes = new HashMap<>();
    /** Stamina (an integer, 0-100) and its timers; see StaminaSystem. */
    public int stamina = com.example.botfight.simulation.gameconfig.MovementConfig.STAMINA_MAX;
    public int staminaRegenDelayMs;
    public boolean sprinting;
    public boolean fastTurning;
    public Integer triggeredAbility;
    public AbilityExecutionPayload triggeredAbilityPayload;
    /** One-tick origin for the shared combat activation visual. */
    public double visualOriginX = Double.NaN;
    public double visualOriginY = Double.NaN;
    public double visualOriginRotation = Double.NaN;
    public final Set<String> entityHitIds = new HashSet<>();
    /** Full immutable roster for this simulation, attached by the orchestrator. */
    public List<Bot> matchBots = List.of();
    /** The entities this tick's trigger spawned, in spawn order (empty when it spawned none). */
    public List<ArenaEntity> abilitySpawn = List.of();
    public double pendingHealing;
    public double tickStartHp;
    public double damageTakenThisTick;
    public double damageTakenLastTick;
    /** Monotonic replay-only event count for successful closing-zone hits. */
    public int closingZoneDamageCount;
    public double hpNetChangeLastTick;
    public int temporalRewindMs;
    public double temporalRewindX;
    public double temporalRewindY;
    public double temporalRewindHp;
    public int temporalRewindPulseMs;

    public Bot() {}

    @Override
    public double x() {
        return x;
    }

    @Override
    public double y() {
        return y;
    }

    @Override
    public int size() {
        return size;
    }

    @Override public int entitySlot() { return slot; }
    @Override public int entityTeam() { return teamNumber > 0 ? teamNumber : slot; }
    @Override public double entityX() { return x; }
    @Override public double entityY() { return y; }
    @Override public double entityMovementStartX() { return movementStartX; }
    @Override public double entityMovementStartY() { return movementStartY; }
    @Override public int entitySize() { return size; }
    @Override public double entityHp() { return hp; }
    public boolean alive() { return hp > 0; }
    public boolean projectileHittable() { return alive(); }
    @Override public boolean ignoresHostileEffects() {
        return !alive() || BotStateService.statusActive(this, "absolute-guard");
    }
    @Override public void setEntityPosition(double x, double y) { if (!ignoresHostileEffects()) { this.x = x; this.y = y; } }
    @Override public void setEntityVelocity(double velocityX, double velocityY) {
        this.velocityX = velocityX;
        this.velocityY = velocityY;
    }
    @Override public void applyStatus(StatusEffectState status, boolean clearsVelocity) {
        BotStateService.upsertStatusEffect(this, status);
        if (clearsVelocity) {
            movementVelocityX = 0;
            movementVelocityY = 0;
            velocityX = 0;
            velocityY = 0;
        }
    }
    @Override public void clearZonePresence() {
        statusEffects.entrySet().removeIf(entry -> "silence".equals(entry.getValue().type)
                && "presence".equals(entry.getValue().mode));
    }
    @Override public void applyInterrupt(int durationMs, Integer abilityId) {
        BotStateService.applyInterrupt(this, durationMs, abilityId);
    }
}
