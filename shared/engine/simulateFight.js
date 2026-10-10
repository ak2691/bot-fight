import { buildStatePayload } from "./modelPayloads/strategyStatePayload.js";
import { stateHash } from "./stateHash.js";
import { createFight } from "./fight.js";
import { normalizeAbilityStrategyConfiguration, evaluatePuzzleTick } from "./botlogic/code/BotCode.js";
import { initialAbilityState } from "./gameconfig/AbilityResourceSystem.js";
import { CLOSING_ZONE_CONFIG, TIMED_ROUNDS_V2_ZONE_CONFIG } from "./gameconfig/ArenaHazardConfig.js";
import { BASE_BOT_STATS, STANDARD_ABILITY_IDS, encodeBotLoadout } from "./loadout/BotLoadout.js";
import { AUTO_STEP_MS } from "./modelPayloads/arenaConstants.js";
import { createBotState, isBotState } from "./modelPayloads/botState.js";

/**
 * The shared match loop. One call runs a request from the
 * start of the fight and returns `{ result, replay }` as shared/schemas/simulation-response.schema.json
 * describes. The request follows simulation-request.schema.json (the caller validates it against the schemas,
 * including the brains; this function checks roster, segment and seed invariants).
 *
 * - A match is up to six 20 s segments of one continuous fight. `segments[i].endsAtMs` ends segment i; at
 *   each boundary the listed bots swap brain, loadout and custom variables (`variableResets` names variables,
 *   by id or name, that go back to their default) and a running chain ends. Position, HP, statuses,
 *   cooldowns, wind-ups, stamina, entities and the closing zone carry over.
 * - `recordFromMs` (a segment start) records only that segment and stops when it ends, as the server does;
 *   frames are relative to the segment start. Without it the whole run is recorded.
 * - Endings: a team with no bot alive loses (KO; everyone dead at once is a draw). When the last segment
 *   ends with more than one team alive, the team with more total HP wins (HP_DECISION; equal HP is a draw).
 *   A segment that ends before the last one reports CONTINUES.
 * - `seed` is validated and otherwise unused: the engine has no randomness, so a run is a function of the
 *   request alone.
 *
 * Bots with slot 1 and 2 are the fight's "main" and "opponent-model" bots (their brains travel in the fight
 * options); any other slot uses `bot.strategyConfiguration`. `hooks.combatLog` records the combat log and
 * `hooks.onTick(fight, elapsedMs)` observes every tick (the golden tests); neither changes the result.
 */
export const DUEL_RULESET_VERSION = "duel-v2";
export const ENGINE_VERSION = "e1-dev";
export const MAX_SIMULATION_BOTS = 8;
export const SEGMENT_DURATION_MS = 20_000;
export const MAX_SEGMENTS = 6;
export const SINGLE_FIGHT_DURATION_MS = CLOSING_ZONE_CONFIG.simulationDurationMs;
export const REPLAY_BATCH_MS = 1_000;

const MAX_VARIABLE_RESETS = 100;
const MAX_VARIABLE_RESET_LENGTH = 64;
const MAX_CUSTOM_VARIABLES = 100;
const HP_EQUAL_EPSILON = 1e-6;
const DEFAULT_ARENA_SIZE = 1200;

export function simulateFight(request, hooks = {}) {
    if (!request || request.rulesetVersion !== DUEL_RULESET_VERSION) {
        throw new Error("rulesetVersion must be duel-v2");
    }
    if (typeof request.seed === "string") {
        if (!/^-?(0|[1-9][0-9]{0,18})$/.test(request.seed)
            || BigInt(request.seed) < -9223372036854775808n || BigInt(request.seed) > 9223372036854775807n) {
            throw new Error("seed must be a signed 64-bit integer");
        }
    } else if (!Number.isSafeInteger(request.seed)) throw new Error("seed must be a safe integer or decimal string");
    validateRoster(request);

    const segments = Array.isArray(request.segments) ? request.segments : [];
    const segmented = segments.length > 0;
    const zoneConfig = segmented ? TIMED_ROUNDS_V2_ZONE_CONFIG : CLOSING_ZONE_CONFIG;
    const maxDurationMs = zoneConfig.simulationDurationMs;
    if (segmented) validateSegments(request, segments, maxDurationMs);
    const arena = {
        width: request.arena?.width ?? DEFAULT_ARENA_SIZE,
        height: request.arena?.height ?? DEFAULT_ARENA_SIZE,
        durationMs: segmented ? segments[segments.length - 1].endsAtMs : request.arena?.durationMs ?? SINGLE_FIGHT_DURATION_MS,
    };
    const initialElapsedMs = request.arena?.initialElapsedMs ?? 0;
    if (initialElapsedMs < 0 || initialElapsedMs > maxDurationMs
        || initialElapsedMs + Math.max(0, arena.durationMs) > maxDurationMs
        || (segmented && initialElapsedMs !== 0)) {
        throw new Error(`initialElapsedMs must leave room within the ${maxDurationMs / 1000} second duel`);
    }

    const roster = request.bots.map((spec) => ({ spec, brain: prepareBrain(spec.brain) }));
    const bots = roster.map(({ spec, brain }) => createBot(spec, brain, initialElapsedMs));
    const fight = createFight(bots, { closingZoneConfig: zoneConfig, combatLog: hooks.combatLog ?? null });
    const slots = new Map(roster.map((entry) => [entry.spec.slot, { brain: entry.brain, loadout: loadoutOf(entry.brain) }]));
    applyBrains(fight, slots);

    // Only the requested segment is recorded; asking for one segment also stops the run when it ends.
    const recordStartMs = segmented && request.recordFromMs != null ? request.recordFromMs : 0;
    let loopEndMs = arena.durationMs;
    if (segmented && request.recordFromMs != null) loopEndMs = Math.min(loopEndMs, segmentEndAfter(segments, recordStartMs));
    const recorder = createRecorder(arena, recordStartMs);
    if (recordStartMs === 0) recorder.start(fight);

    const hashes = request.diagnostics?.stateHashes ? [] : null;
    let nextSegment = 1;
    let ended = null;
    let lastElapsedMs = 0;
    let puzzleStatus = null;
    let puzzleVariables = null;
    for (let elapsedMs = AUTO_STEP_MS; elapsedMs <= loopEndMs; elapsedMs += AUTO_STEP_MS) {
        // A segment boundary is the end of the previous tick: swap brains before any logic of this tick runs,
        // then start recording if this is the target segment.
        const boundaryMs = elapsedMs - AUTO_STEP_MS;
        if (nextSegment < segments.length && boundaryMs === segments[nextSegment - 1].endsAtMs) {
            applySegment(fight, slots, segments[nextSegment]);
            nextSegment += 1;
        }
        if (!recorder.recording && boundaryMs === recordStartMs) recorder.start(fight);

        fight.step();
        lastElapsedMs = elapsedMs;
        recorder.frame(fight, elapsedMs);
        hooks.onTick?.(fight, elapsedMs);
        if (hashes) hashes.push(stateHash([...fight.bots, ...fight.entities]));

        if (request.puzzle) {
            const player = fight.bots.find((bot) => bot.slot === 1 && bot.teamNumber === 1)
                ?? fight.bots.filter((bot) => bot.teamNumber === 1).sort((a, b) => a.slot - b.slot)[0];
            if (!player) throw new Error("Puzzle requires a player on team 1");
            const evaluated = evaluatePuzzleTick(request.puzzle.logicConfiguration,
                buildStatePayload(fight.frame(), player.combatLoadout, player.id), puzzleVariables, slots.get(player.slot)?.brain.configuration.customVariables);
            puzzleVariables = evaluated.customVariables;
            player.customVariables = { ...player.customVariables, ...puzzleVariables };
            puzzleStatus = evaluated.status ?? (elapsedMs >= request.puzzle.timeLimitMs ? "failed" : null);
            if (puzzleStatus) break;
        }
        const aliveTeams = teamsAlive(fight.bots);
        if (aliveTeams.size <= 1) {
            ended = { kind: "KO", winnerTeam: aliveTeams.size === 1 ? [...aliveTeams][0] : null };
            break;
        }
        if (elapsedMs === request.diagnostics?.stopAtMs) break;
    }
    // A knockout before the target segment leaves nothing to replay, but the result still needs an initial state.
    if (!recorder.recording) recorder.start(fight);

    const continues = ended === null && loopEndMs < arena.durationMs;
    return {
        ...(hashes ? { diagnostics: { stateHashes: hashes } } : {}),
        result: { ...buildResult(fight, ended, continues, lastElapsedMs, hooks.engineVersion),
            ...(request.puzzle ? { puzzleStatus: puzzleStatus ?? "failed" } : {}) },
        replay: { initialState: recorder.initialState, batches: batchFrames(recorder.frames) },
    };
}

function buildResult(fight, ended, continues, segmentEndMs, engineVersion) {
    const teamHp = teamHpOf(fight.bots);
    let outcome;
    let endReason;
    let winnerTeam = null;
    if (ended) {
        winnerTeam = ended.winnerTeam;
        outcome = winnerTeam == null ? "DRAW" : "BOT_WIN";
        endReason = "KO";
    } else if (continues) {
        outcome = "CONTINUES";
        endReason = "SEGMENT_END";
    } else {
        winnerTeam = hpDecisionWinner(teamHp);
        outcome = winnerTeam == null ? "DRAW" : "BOT_WIN";
        endReason = "HP_DECISION";
    }
    return {
        engineVersion: engineVersion ?? ENGINE_VERSION,
        outcome,
        endReason,
        winnerTeam,
        teamHp,
        segmentEndMs,
        endState: fight.bots.map(({ slot, x, y, rotation, hp, teamNumber, stamina, sprinting, runningChain }) =>
            ({ slot, x, y, rotation, hp, teamNumber, stamina, sprinting, runningChain })),
    };
}

function teamsAlive(bots) {
    return new Set(bots.filter((bot) => bot.hp > 0).map((bot) => bot.teamNumber));
}

/** Total HP left per team, by team number. */
function teamHpOf(bots) {
    const totals = new Map();
    for (const bot of bots) totals.set(bot.teamNumber, (totals.get(bot.teamNumber) ?? 0) + Math.max(0, bot.hp));
    return [...totals].sort(([first], [second]) => first - second).map(([teamNumber, hp]) => ({ teamNumber, hp }));
}

/** The team with the most HP, or null when the best totals are equal. */
function hpDecisionWinner(teamHp) {
    const best = Math.max(...teamHp.map((entry) => entry.hp));
    const leaders = teamHp.filter((entry) => Math.abs(entry.hp - best) < HP_EQUAL_EPSILON);
    return leaders.length === 1 ? leaders[0].teamNumber : null;
}

// ---- replay recording -----------------------------------------------------------------------------------------

/**
 * Frames are `{ elapsedMs, shapes }` with `shapes` the fight's render frame, relative to the start of the
 * recorded segment. The initial state is the render frame at the segment start, after the brain swap.
 */
function createRecorder(arena, recordStartMs) {
    const recorder = {
        recording: false,
        initialState: null,
        frames: [],
        start(fight) {
            recorder.recording = true;
            recorder.initialState = { width: arena.width, height: arena.height, shapes: renderFrame(fight) };
        },
        frame(fight, elapsedMs) {
            if (recorder.recording) recorder.frames.push({ elapsedMs: elapsedMs - recordStartMs, shapes: renderFrame(fight) });
        },
    };
    return recorder;
}

/** The fight's frame without the working brain of the bots outside the two main slots (not a render field). */
function renderFrame(fight) {
    return fight.frame().map((shape) => (isBotState(shape) && shape.strategyConfiguration != null
        ? { ...shape, strategyConfiguration: null }
        : shape));
}

/**
 * Cuts frames into one-second batches, as the server's MatchReplayService.prepareBatches: a batch holds the
 * frames in (start, end], a window with no frame is skipped but still uses up its sequence number, and the
 * batch that reaches the last frame is terminal.
 */
export function batchFrames(frames) {
    const finalElapsedMs = frames.length ? frames[frames.length - 1].elapsedMs : 0;
    if (finalElapsedMs <= 0) return [];
    const batches = [];
    let sequence = 1;
    let index = 0;
    for (let startMs = 0; startMs < finalElapsedMs; startMs += REPLAY_BATCH_MS) {
        const endMs = Math.min(finalElapsedMs, startMs + REPLAY_BATCH_MS);
        const batchFramesInWindow = [];
        while (index < frames.length && frames[index].elapsedMs <= endMs) {
            if (frames[index].elapsedMs > startMs || (startMs === 0 && frames[index].elapsedMs === 0)) {
                batchFramesInWindow.push(frames[index]);
            }
            index += 1;
        }
        if (batchFramesInWindow.length > 0) {
            const last = batchFramesInWindow[batchFramesInWindow.length - 1].elapsedMs;
            batches.push({ sequence, endMs: last, terminal: last >= finalElapsedMs, frames: batchFramesInWindow });
        }
        sequence += 1;
    }
    return batches;
}

// ---- bots and brains ------------------------------------------------------------------------------------------

function prepareBrain(brain) {
    const configuration = normalizeAbilityStrategyConfiguration(brain);
    return { configuration, abilities: abilityIdsOf(brain) };
}

function abilityIdsOf(brain) {
    const listed = Array.isArray(brain?.loadout?.abilities) ? brain.loadout.abilities : [];
    return listed.filter((id) => Number.isInteger(id));
}

/** The loadout string a brain's abilities encode to (the selected loadout the brains see). */
function loadoutOf(brain) {
    return encodeBotLoadout({ abilities: brain.abilities });
}

/** Standard abilities first, then the brain's, each once. */
function allAbilities(brain) {
    return [...new Set([...STANDARD_ABILITY_IDS, ...brain.abilities])];
}

function botIdOf(slot) {
    return slot === 1 ? "main" : slot === 2 ? "opponent-model" : `bot-${slot}`;
}

function createBot(spec, brain, initialElapsedMs) {
    const abilities = allAbilities(brain);
    const maxHp = BASE_BOT_STATS.maxHp;
    const hp = spec.initialHp == null || !Number.isFinite(spec.initialHp) ? maxHp : Math.max(0, Math.min(maxHp, spec.initialHp));
    return createBotState({
        id: botIdOf(spec.slot),
        type: spec.slot === 1 ? "circle" : "opponentModel",
        isCurrentUser: spec.slot === 1,
        slot: spec.slot,
        teamNumber: spec.teamNumber ?? spec.slot,
        userId: spec.userId ?? null,
        username: spec.username ?? null,
        x: spec.x,
        y: spec.y,
        rotation: spec.rotation ?? (spec.slot === 1 ? 90 : 270),
        size: spec.size,
        hp,
        maxHp,
        moveSpeed: BASE_BOT_STATS.moveSpeed,
        attackDamageMultiplier: BASE_BOT_STATS.attackDamagePercent / 100,
        attackSpeedMultiplier: BASE_BOT_STATS.attackSpeedPercent / 100,
        spawnX: spec.x,
        spawnY: spec.y,
        matchElapsedMs: initialElapsedMs,
        abilities,
        combatLoadout: encodeBotLoadout({ abilities }),
        abilityState: initialAbilityState(abilities, maxHp),
    });
}

/** Points the fight at each slot's brain and loadout: slots 1 and 2 through the options, the rest on the bot. */
function applyBrains(fight, slots) {
    const main = slots.get(1);
    const opponent = slots.get(2);
    fight.configure({
        selectedLoadout: main?.loadout,
        opponentLoadout: opponent?.loadout,
        testingConfiguration: main?.brain.configuration,
        opponentTestingConfiguration: opponent?.brain.configuration,
    });
    for (const bot of fight.bots) {
        if (bot.slot === 1 || bot.slot === 2) continue;
        bot.strategyConfiguration = slots.get(bot.slot)?.brain.configuration ?? null;
    }
}

/**
 * Applies one segment's brain schedule at its boundary. Only brain, loadout and custom variables change: an
 * ability the bot did not have starts ready with full charges, while the cooldowns, charges, wind-up, stamina,
 * position, HP and statuses already in play carry over. A running chain ends.
 */
function applySegment(fight, slots, segment) {
    for (const update of segment.bots ?? []) {
        const bot = fight.bots.find((candidate) => candidate.slot === update.slot);
        const previous = slots.get(update.slot);
        if (!bot || !previous) continue;
        const brain = update.brain == null ? previous.brain : prepareBrain(update.brain);
        slots.set(update.slot, { brain, loadout: loadoutOf(brain) });

        const known = new Set(bot.abilities);
        const abilities = allAbilities(brain);
        const abilityState = { ...bot.abilityState };
        for (const id of abilities) {
            if (known.has(id)) continue;
            delete abilityState[id];
            Object.assign(abilityState, initialAbilityState([id], bot.maxHp));
        }
        bot.abilities = abilities;
        bot.abilityState = abilityState;
        bot.combatLoadout = encodeBotLoadout({ abilities });
        bot.customVariables = reconcileVariables(bot.customVariables, previous.brain.configuration, brain.configuration, update.variableResets);
        bot.chainStack = [];
        bot.runningChain = null;
    }
    applyBrains(fight, slots);
}

/**
 * A variable that keeps its name and type keeps its value unless it is reset; a new, reset or retyped variable
 * takes its declared default (the brain runtime fills in a missing value); a variable the brain no longer
 * declares is dropped.
 */
function reconcileVariables(values, previousConfiguration, configuration, variableResets) {
    const resets = new Set(variableResets ?? []);
    const previousTypes = new Map((previousConfiguration?.customVariables ?? []).map((variable) => [variable.id, variable.valueType]));
    const kept = {};
    for (const variable of (configuration?.customVariables ?? []).slice(0, MAX_CUSTOM_VARIABLES)) {
        if (previousTypes.get(variable.id) !== variable.valueType) continue;
        if (resets.has(variable.id) || resets.has(variable.name)) continue;
        if (values?.[variable.id] != null) kept[variable.id] = values[variable.id];
    }
    return kept;
}

// ---- request checks (shared request bounds) -------------------------------------------------

function validateRoster(request) {
    const bots = request.bots;
    if (!Array.isArray(bots) || bots.length < 2 || bots.length > MAX_SIMULATION_BOTS) {
        throw new Error(`duel-v2 requires between two and ${MAX_SIMULATION_BOTS} bots`);
    }
    const slots = new Set();
    const teams = new Set();
    for (const bot of bots) {
        const team = bot?.teamNumber ?? bot?.slot;
        if (!bot || !Number.isInteger(bot.slot) || bot.slot <= 0 || bot.slot > MAX_SIMULATION_BOTS
            || slots.has(bot.slot) || !Number.isInteger(team) || team <= 0) {
            throw new Error("bot slots and team numbers must be unique positive values");
        }
        slots.add(bot.slot);
        teams.add(team);
    }
    if (teams.size < 2) throw new Error("duel-v2 requires at least two teams");
}

function validateSegments(request, segments, maxDurationMs) {
    if (segments.length > MAX_SEGMENTS) throw new Error(`a match has at most ${MAX_SEGMENTS} segments`);
    const slots = new Set(request.bots.map((bot) => bot.slot));
    let previousEndMs = 0;
    segments.forEach((segment, index) => {
        if (!segment || !Number.isInteger(segment.endsAtMs) || segment.endsAtMs <= previousEndMs
            || segment.endsAtMs - previousEndMs > SEGMENT_DURATION_MS
            || segment.endsAtMs % AUTO_STEP_MS !== 0 || segment.endsAtMs > maxDurationMs) {
            throw new Error(`segments must end in increasing multiples of ${AUTO_STEP_MS} ms, at most ${SEGMENT_DURATION_MS / 1000} seconds long, within ${maxDurationMs / 1000} seconds`);
        }
        previousEndMs = segment.endsAtMs;
        const updates = segment.bots ?? [];
        if (index === 0 && updates.length > 0) throw new Error("the first segment's bots come from the request's bots");
        const updated = new Set();
        for (const update of updates) {
            if (!update || !slots.has(update.slot) || updated.has(update.slot)) {
                throw new Error("segment bots must name each roster slot at most once");
            }
            updated.add(update.slot);
            const resets = update.variableResets ?? [];
            if (resets.length > MAX_VARIABLE_RESETS
                || resets.some((name) => typeof name !== "string" || name.length > MAX_VARIABLE_RESET_LENGTH)) {
                throw new Error("variableResets exceeds its bounds");
            }
        }
    });
    const recordFromMs = request.recordFromMs;
    if (recordFromMs != null && recordFromMs !== 0
        && !segments.slice(0, -1).some((segment) => segment.endsAtMs === recordFromMs)) {
        throw new Error("recordFromMs must be the start of a segment");
    }
}

/** The end of the segment that starts at `startMs`. */
function segmentEndAfter(segments, startMs) {
    if (startMs === 0) return segments[0].endsAtMs;
    for (let index = 0; index + 1 < segments.length; index += 1) {
        if (segments[index].endsAtMs === startMs) return segments[index + 1].endsAtMs;
    }
    throw new Error("recordFromMs must be the start of a segment");
}
