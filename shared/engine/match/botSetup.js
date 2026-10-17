import {
    BOT_CODE_SELECTABLES,
    createDefaultAbilityStrategyConfiguration,
    normalizeAbilityStrategyConfiguration,
} from "../botlogic/code/BotCode.js";
import { actionIdsForLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, BASE_BOT_HP } from "../modelPayloads/arenaConstants.js";
import { CLOSING_ZONE_CONFIG } from "../gameconfig/ArenaHazardConfig.js";
import {
    buildOpponentShape,
    resetBotShape,
    toCanonicalBotShape,
    toSimulationBotShape,
} from "../modelPayloads/arenaShapes.js";

export const DUEL_RULESET_VERSION = "duel-v1";
export const MAX_SIMULATION_BOTS = 8;
export const SIMULATION_DURATION_MS = CLOSING_ZONE_CONFIG.simulationDurationMs;
// Mirrors frontend/src/gameArena/gameconfig/CombatLoadouts.js COMMON_ACTION_IDS.
const COMMON_ACTION_IDS = Object.freeze(["none", "variable", "move_walk", "rotate_toward_enemy"]);

/** Engine shape id for a roster slot. Slots are unique, so ids are too. */
export function matchBotId(slot) {
    return `bot-${slot}`;
}

/** Java validateBotRoster: 2-8 bots, unique slots 1-8, positive teams, at least two teams. */
export function validateMatchRoster(bots) {
    if (!Array.isArray(bots) || bots.length < 2 || bots.length > MAX_SIMULATION_BOTS) {
        throw new Error(`duel-v1 requires between two and ${MAX_SIMULATION_BOTS} bots`);
    }
    const slots = new Set();
    const teams = new Set();
    for (const bot of bots) {
        const slot = Number(bot?.slot);
        const teamNumber = Number(bot?.teamNumber);
        if (!bot || !Number.isInteger(slot) || slot < 1 || slot > MAX_SIMULATION_BOTS
            || slots.has(slot) || !Number.isInteger(teamNumber) || teamNumber <= 0) {
            throw new Error("bot slots and team numbers must be unique positive values");
        }
        slots.add(slot);
        teams.add(teamNumber);
    }
    if (teams.size < 2) {
        throw new Error("duel-v1 requires at least two teams");
    }
}

/**
 * Validates the request and resolves the arena. Missing arena fields fall back to the
 * duel-v1 defaults, as in Java. The engine's arena geometry is fixed, so a request that
 * names another size is refused rather than silently simulated on the wrong board.
 */
export function resolveMatchArena(request) {
    if (request == null || typeof request !== "object") throw new Error("simulation request is required");
    if (request.rulesetVersion !== DUEL_RULESET_VERSION) {
        throw new Error(`rulesetVersion must be ${DUEL_RULESET_VERSION}`);
    }
    validateMatchRoster(request.bots);
    const arena = request.arena ?? {};
    const width = arena.width ?? ARENA_WIDTH_UNITS;
    const height = arena.height ?? ARENA_HEIGHT_UNITS;
    if (width !== ARENA_WIDTH_UNITS || height !== ARENA_HEIGHT_UNITS) {
        throw new Error(`arena must be ${ARENA_WIDTH_UNITS}x${ARENA_HEIGHT_UNITS} for duel-v1`);
    }
    const durationMs = arena.durationMs ?? SIMULATION_DURATION_MS;
    const initialElapsedMs = arena.initialElapsedMs ?? 0;
    if (!Number.isInteger(durationMs) || durationMs < 0) {
        throw new Error("arena durationMs must be a non-negative integer");
    }
    if (!Number.isInteger(initialElapsedMs) || initialElapsedMs < 0 || initialElapsedMs > SIMULATION_DURATION_MS
        || initialElapsedMs + durationMs > SIMULATION_DURATION_MS) {
        throw new Error("initialElapsedMs must leave room within the 90 second duel");
    }
    return { width, height, durationMs, initialElapsedMs };
}

/**
 * Builds the engine bot shapes for a validated request, in request order.
 * Values follow Java BotStateService.create: rotation defaults to 90 (slot 1) or 270,
 * hp is initialHp clamped to [0, maxHp] (maxHp when absent), and matchElapsedMs starts at
 * the arena's initialElapsedMs. Abilities come only from brain.loadout.abilities.
 */
export function createMatchBots(request, arena = resolveMatchArena(request)) {
    return request.bots.map((bot) => {
        const x = Number(bot.x);
        const y = Number(bot.y);
        const size = Number(bot.size);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("bot positions must be finite numbers");
        if (!Number.isFinite(size) || size <= 0) throw new Error("bot size must be a positive number");
        const slot = Number(bot.slot);
        const loadout = normalizedBotLoadout(bot.brain?.loadout);
        const combatLoadout = encodeBotLoadout(loadout);
        const base = buildOpponentShape({
            userId: bot.userId ?? null,
            username: bot.username,
            slot,
            teamNumber: Number(bot.teamNumber),
            loadout,
            selectedLoadout: combatLoadout,
        });
        const maxHp = BASE_BOT_HP;
        const hp = bot.initialHp == null || !Number.isFinite(Number(bot.initialHp))
            ? maxHp
            : Math.max(0, Math.min(maxHp, Number(bot.initialHp)));
        const rotation = bot.rotation == null ? (slot === 1 ? 90 : 270) : Number(bot.rotation);
        if (!Number.isFinite(rotation)) throw new Error("bot rotation must be a finite number");
        const shape = resetBotShape({
            ...base,
            id: matchBotId(slot),
            type: "bot",
            isCurrentUser: false,
            locked: true,
            username: bot.username,
            opponentUsername: bot.username,
            x,
            y,
            size,
            rotation,
            startHp: hp,
            combatLoadout,
            loadout,
        });
        return toCanonicalBotShape({
            ...toSimulationBotShape(shape),
            matchElapsedMs: arena.initialElapsedMs,
        });
    });
}

/**
 * Normalizes each raw brain with the browser's BotCode normalization, then drops any
 * action the bot's loadout does not grant (the browser's sanitizeStrategyConfigurationForLoadout).
 * Returns a Map from shape id to `{ configuration, loadout }`.
 */
export function prepareMatchBrains(request) {
    const brains = new Map();
    for (const bot of request.bots) {
        const loadout = normalizedBotLoadout(bot.brain?.loadout);
        const allowed = new Set([...COMMON_ACTION_IDS, ...actionIdsForLoadout(loadout)]);
        const normalized = normalizeAbilityStrategyConfiguration(bot.brain ?? createDefaultAbilityStrategyConfiguration());
        brains.set(matchBotId(Number(bot.slot)), {
            configuration: restrictActions(normalized, allowed),
            loadout,
        });
    }
    return brains;
}

function restrictActions(configuration, allowed) {
    const sanitizeAction = (action) => {
        if (!action || typeof action !== "object") return action;
        if (allowed.has(action.action)) return action;
        return { ...action, action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT };
    };
    const sanitizeBlock = (block) => {
        if (!block || typeof block !== "object") return block;
        return {
            ...block,
            ...sanitizeAction(block),
            ...(Array.isArray(block.actions) ? { actions: block.actions.map(sanitizeAction) } : {}),
            ...(Array.isArray(block.children) ? { children: block.children.map(sanitizeBlock) } : {}),
        };
    };
    return {
        ...configuration,
        roots: Array.isArray(configuration.roots)
            ? configuration.roots.map((root) => ({
                ...root,
                branches: Array.isArray(root?.branches) ? root.branches.map(sanitizeBlock) : [],
            }))
            : [],
        ...(Array.isArray(configuration.orphans) && configuration.orphans.length
            ? {
                orphans: configuration.orphans.map((node) => (node?.kind === "action"
                    ? sanitizeAction(node)
                    : sanitizeBlock(node))),
            }
            : {}),
    };
}
