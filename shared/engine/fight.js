import { buildDeterministicLogicAction, idleAction } from "./botlogic/planner/ArenaActionPlanner.js";
import { hasAbilityStrategyActions } from "./botlogic/code/BotCode.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "./ecs/abilities/AbilityEntitySystem.js";
import { advanceEntityAge } from "./ecs/entities/EntityWorld.js";
import { applyBotAction } from "./ecs/bots/ActionExecutionSystem.js";
import { settleHealing } from "./ecs/abilities/effects.js";
import { resolveTriggerVerbsForRoster } from "./ecs/abilities/verbs.js";
import { settleAbilityHits } from "./gameconfig/AbilityHitRecord.js";
import { isClosingZone, tickClosingZoneWorld } from "./ecs/entities/ClosingZoneSystem.js";
import { ACTION_TO_ABILITY } from "./loadout/BotLoadout.js";
import { phaseForEntity } from "./ecs/contracts/AbilityContracts.js";
import { beginCombatTick, botRef, entityRef, logCombat, setCombatStage, withCombatLog } from "./ecs/combatLog.js";
import { AUTO_STEP_MS, ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "./modelPayloads/arenaConstants.js";
import { createStatePayloadFactory } from "./modelPayloads/strategyStatePayload.js";
import { isBotState } from "./modelPayloads/botState.js";

/**
 * The fight engine. `createFight(setup)` takes the bots, ability entities and closing zone of a setup (copying
 * them: the caller's objects are never touched) and owns them from then on. `fight.step()` advances one tick
 * through the seven stages and changes the fight's own bots and entities in place; `fight.frame()` returns new
 * plain objects for callers (React, Pixi, tests). A caller never holds a working object: values nested inside a
 * bot or entity (status lists, ability records) are replaced when they change, never edited, so a frame stays
 * valid while the fight runs on.
 *
 * Brains read the snapshot of the start of the tick (built once, before anything changes). Code that compares
 * before and after (hp change, damage taken) reads that snapshot for "before".
 *
 * The shared engine runs these stages in order:
 * decide, act, resolveHits, spawn, entities, hazards, settle. Pass `combatLog` (see ecs/combatLog.js) to record
 * one entry per trigger, effect, status, spawn, phase change, removal and stamina change; with no log nothing
 * is recorded.
 *
 * Options (all may be replaced per step, or in between with `fight.configure`): `selectedLoadout`,
 * `opponentLoadout`, and the normalized brains `testingConfiguration` (bot "main") and
 * `opponentTestingConfiguration` (bot "opponent-model"); every other bot uses `bot.strategyConfiguration` and
 * `bot.combatLoadout`. The brains in the options and in `bot.strategyConfiguration` are already normalized (see
 * normalizeAbilityStrategyConfiguration); nothing here normalizes. `closingZoneConfig` picks the zone schedule
 * (default: the single-fight zone; simulateFight passes the timed-rounds one).
 */
export function createFight(setup, options = {}) {
    const fight = {
        bots: [],
        entities: [],
        closingZone: null,
        options: { ...options },
        /** Replaces options for the steps that follow (a brain swap between segments). */
        configure(patch) {
            fight.options = { ...fight.options, ...patch };
        },
        step(overrides = null) {
            stepFight(fight, overrides ? { ...fight.options, ...overrides } : fight.options);
        },
        frame() {
            return [
                ...fight.bots.map((bot) => ({ ...bot })),
                ...fight.entities.map((entity) => ({ ...entity })),
                ...(fight.closingZone ? [{ ...fight.closingZone }] : []),
            ];
        },
    };
    for (const shape of setup) {
        if (isBotState(shape)) fight.bots.push({ ...shape });
        else if (isClosingZone(shape)) fight.closingZone = { ...shape };
        else if (isAbilityEntity(shape)) fight.entities.push({ ...shape });
    }
    return fight;
}

function stepFight(fight, options) {
    withCombatLog(options.combatLog ?? null, () => {
        beginCombatTick();
        // Entities age at the start of the tick, before this tick's spawns join, as on the server.
        for (const entity of fight.entities) advanceEntityAge(entity, AUTO_STEP_MS);
        const snapshot = createStatePayloadFactory([
            ...fight.bots,
            ...fight.entities,
            ...(fight.closingZone ? [fight.closingZone] : []),
        ]);
        const decisions = decide(fight, snapshot, options);
        act(fight, decisions);
        resolveHits(fight);
        spawn(fight);
        entities(fight);
        hazards(fight, options);
        settle(fight, snapshot);
    });
}

/** Every bot picks its action from the start-of-tick snapshot. */
function decide(fight, snapshot, options) {
    setCombatStage("decide");
    const { selectedLoadout, opponentLoadout, testingConfiguration, opponentTestingConfiguration } = options;
    const stateSnapshot = snapshot.forActor(selectedLoadout);
    return fight.bots.map((bot) => {
        const configuration = bot.id === "main"
            ? testingConfiguration
            : bot.id === "opponent-model"
                ? opponentTestingConfiguration
                : bot.strategyConfiguration;
        const botLoadout = bot.id === "main"
            ? selectedLoadout
            : bot.id === "opponent-model"
                ? opponentLoadout
                : bot.combatLoadout;
        const action = configuration
            && (bot.id === "main" || hasAbilityStrategyActions(configuration))
            ? buildDeterministicLogicAction(
                configuration,
                bot.id === "main" ? stateSnapshot : snapshot.forActor(botLoadout, bot.id),
            )
            : idleAction();
        return { bot, action };
    });
}

/** Stamina timers, stun, cancel, movement, channels and the ability triggers of every bot. */
function act(fight, decisions) {
    setCombatStage("act");
    for (const { bot, action } of decisions) {
        bot.lastPredictedAction = action;
        applyBotAction(bot, action, AUTO_STEP_MS);
        bot.customVariables = action.customVariables;
        bot.chainStack = action.chainStack ?? [];
        bot.runningChain = action.runningChain ?? null;
    }
    for (const bot of fight.bots) {
        if (bot.triggeredAbility == null) continue;
        logCombat("trigger", {
            source: botRef(bot),
            abilityId: ACTION_TO_ABILITY[bot.triggeredAbility] ?? bot.triggeredAbility,
        });
    }
}

/** The trigger verbs of the abilities that triggered this tick hit the opposing bots or apply to their owner. */
function resolveHits(fight) {
    setCombatStage("resolveHits");
    resolveTriggerVerbsForRoster(fight.bots);
}

/** New ability entities join the world; the bots' one-tick spawn slot is cleared. */
function spawn(fight) {
    setCombatStage("spawn");
    const spawned = fight.bots.flatMap((bot) => bot.abilitySpawn ?? []).filter(isAbilityEntity);
    for (const entity of spawned) {
        logCombat("spawn", {
            source: botRef(entity.ownerSlot),
            target: entityRef(entity),
            abilityId: entity.abilityId,
            effect: entity.type,
        });
    }
    fight.entities = [...fight.entities, ...spawned];
    for (const bot of fight.bots) bot.abilitySpawn = [];
}

/** Projectiles, zones, traps and summons advance and apply their effects. */
function entities(fight) {
    setCombatStage("entities");
    const before = fight.entities;
    // The entities change in place, so what the log compares them with is noted first.
    const phaseBefore = new Map(before.map((entity) => [entity.id, phaseForEntity(entity)?.id ?? null]));
    const update = tickAbilityEntityWorld({
        entities: before,
        entitiesAged: true,
        bots: fight.bots,
        stepMs: AUTO_STEP_MS,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    });
    fight.entities = update.entities;
    logEntityChanges(before, update.entities, phaseBefore);
}

/** Phase transitions, removals and entities spawned by other entities, found by comparing worlds. */
function logEntityChanges(before, after, phaseBefore) {
    const afterIds = new Set(after.map((entity) => entity.id));
    for (const entity of before) {
        if (!afterIds.has(entity.id)) {
            logCombat("removal", { source: botRef(entity.ownerSlot), target: entityRef(entity), abilityId: entity.abilityId, effect: entity.type });
            continue;
        }
        const from = phaseBefore.get(entity.id);
        const to = phaseForEntity(entity)?.id ?? null;
        if (from !== to) {
            logCombat("phase", { source: botRef(entity.ownerSlot), target: entityRef(entity), abilityId: entity.abilityId, effect: `${from}>${to}` });
        }
    }
    for (const entity of after) {
        if (phaseBefore.has(entity.id)) continue;
        logCombat("spawn", { source: botRef(entity.ownerSlot), target: entityRef(entity), abilityId: entity.abilityId, effect: entity.type });
    }
}

/** The closing zone shrinks and hurts the bots outside it. */
function hazards(fight, options) {
    setCombatStage("hazards");
    const main = fight.bots.find((bot) => bot.id === "main");
    const update = tickClosingZoneWorld({
        zone: fight.closingZone,
        bots: fight.bots,
        elapsedMs: Number(main?.matchElapsedMs ?? AUTO_STEP_MS),
        stepMs: AUTO_STEP_MS,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
        ...(options.closingZoneConfig ? { config: options.closingZoneConfig } : {}),
    });
    fight.closingZone = update.zone;
}

/** Healing lands, hit stamina refunds are paid and the per-tick measurements roll over. */
function settle(fight, snapshot) {
    setCombatStage("settle");
    for (const bot of fight.bots) {
        settleHealing(bot);
        bot.damageTakenLastTick = Number(bot.damageTakenThisTick ?? 0);
        bot.damageTakenThisTick = 0;
        bot.hpNetChangeLastTick = bot.hp - snapshot.core(bot).health.current;
        settleAbilityHits(bot, AUTO_STEP_MS);
    }
}
