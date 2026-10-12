import { BASE_BOT_HP } from "./arenaConstants.js";
import { BASE_BOT_STATS } from "../loadout/BotLoadout.js";
import { initialMovementState } from "../gameconfig/StaminaSystem.js";
import { normalizeStatusEffect } from "../ecs/contracts/StatusContracts.js";

/**
 * The one bot format. A bot is a flat object built by `createBotState` with every field present
 * (`null` when a field does not apply), whether it is simulated, rendered, previewed or hydrated from a
 * server replay. `kind` is the only way to tell a bot from an ability entity or the closing zone.
 */
export const BOT_KIND = "bot";

export function isBotState(shape) {
    return shape?.kind === BOT_KIND;
}

/** A new default bot. Arrays and objects are fresh per call so bots never share mutable state. */
function botStateDefaults() {
    return {
        kind: BOT_KIND,
        // Identity
        id: null,
        type: "bot",
        slot: null,
        teamNumber: null,
        userId: null,
        username: null,
        opponentUsername: null,
        isCurrentUser: false,
        locked: false,
        puzzleSlot: null,
        puzzleBotKey: null,
        // Loadout and brain
        combatLoadout: null,
        loadout: null,
        abilities: [],
        abilityState: {},
        strategyConfiguration: null,
        // Health
        hp: BASE_BOT_HP,
        maxHp: BASE_BOT_HP,
        damageTakenLastTick: 0,
        damageTakenThisTick: 0,
        hpNetChangeLastTick: 0,
        pendingHealing: 0,
        // Stats
        moveSpeed: BASE_BOT_STATS.moveSpeed,
        attackDamageMultiplier: 1,
        attackSpeedMultiplier: 1,
        // Transform
        x: 0,
        y: 0,
        size: 60,
        rotation: 0,
        velocityX: 0,
        velocityY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        movementStartX: null,
        movementStartY: null,
        // Starting configuration
        startX: null,
        startY: null,
        startRotation: null,
        startHp: null,
        spawnX: null,
        spawnY: null,
        // Stamina and movement
        ...initialMovementState(),
        pendingStaminaRefund: 0,
        // Statuses
        statusEffects: [],
        // Clocks and presentation
        matchElapsedMs: 0,
        closingZoneDamageCount: 0,
        hitFlashMs: 0,
        hitParticleEvent: null,
        // Brain runtime
        customVariables: {},
        chainStack: [],
        runningChain: null,
        lastPredictedAction: null,
        // Ability bookkeeping
        abilityLastHitAgeMs: {},
        abilityHitsThisTick: [],
        activationSerial: 0,
        refundedActivations: [],
        entityActivations: {},
        abilitySpawn: [],
        abilityEntitySerial: 1,
        triggeredAbility: null,
        triggeredPhaseFacingMode: null,
        abilityVisual: null,
        abilityTargetX: null,
        abilityTargetY: null,
        hitboxOriginX: null,
        hitboxOriginY: null,
        hitboxRotation: null,
        gunRayOriginX: null,
        gunRayOriginY: null,
        gunRayRotation: null,
        // Dash
        dashRemaining: 0,
        dashInitialDistance: 0,
        dashStepDistance: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        dashOriginX: null,
        dashOriginY: null,
        // The ability whose move (a dash, or a delayed move) is travelling; null when none is
        moveAbilityId: null,
        // Rewind's presentation pulse after the snap-back (the rewind status itself is in statusEffects)
        rewindPulseMs: 0,
    };
}

/**
 * Builds a bot from flat fields. Missing (or undefined) fields take the defaults above; the status list
 * is normalized here, once, at the edge. Fields outside the default set (replay presentation extras) are
 * kept after the defaults.
 */
export function createBotState(init = {}) {
    const bot = botStateDefaults();
    for (const key of Object.keys(init)) {
        if (init[key] !== undefined) bot[key] = init[key];
    }
    bot.kind = BOT_KIND;
    bot.statusEffects = (bot.statusEffects ?? []).map(normalizeStatusEffect).filter(Boolean);
    return bot;
}
