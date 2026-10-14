import { createStatePayloadFactory } from "../modelPayloads/strategyStatePayload.js";
import { advanceArenaTick, isSimulationBotShape } from "../modelPayloads/arenaTick.js";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";
import { createMatchBots, prepareMatchBrains, resolveMatchArena } from "./botSetup.js";
import { toSimulationBotShape } from "../modelPayloads/arenaShapes.js";
import { replayFrame, replayInitialState, replayResult } from "./replayMapping.js";
import { createPuzzleOutcome } from "./puzzleOutcome.js";

/**
 * Runs an authoritative duel-v1 match on the JS engine (worker-only; no DOM).
 *
 * Loop: elapsedMs runs from 100 to durationMs in 100 ms steps. Each step every bot runs
 * its own brain against one start-of-tick snapshot, the engine advances the arena, and the
 * frame is recorded. The match ends when at most one team has a living bot. The winner is
 * the first living bot of the surviving team in request order; no survivors or running out
 * of time is a draw.
 *
 * `request.puzzle` (optional) runs the puzzle outcome check after every tick (see
 * puzzleOutcome.js). Puzzle requests record no frames, and the result gains `puzzle:
 * { status, elapsedMs }`. Without it the result has no `puzzle` key.
 *
 * `afterTick({ elapsedMs, shapes })` may return true to stop early. The result is then a
 * draw, as in Java.
 *
 * `request.seed` is accepted and unused: duel-v1 has no randomness.
 */
export function simulateMatch(request, { recordFrames = true, afterTick = null } = {}) {
    const arena = resolveMatchArena(request);
    const brains = prepareMatchBrains(request);
    const puzzle = request.puzzle == null ? null : createPuzzleOutcome(request.puzzle);
    const shouldRecordFrames = recordFrames && puzzle == null;
    let shapes = createMatchBots(request, arena);
    const initialState = replayInitialState(shapes);
    const frames = [];
    let endElapsedMs = 0;

    const finish = (winner) => {
        const replay = {
            initialState,
            frames,
            ...replayResult(winner),
        };
        return {
            replay,
            endElapsedMs,
            bots: shapes,
            ...(puzzle ? { puzzle: { status: puzzle.status(), elapsedMs: puzzle.elapsedMs() } } : {}),
        };
    };

    for (let elapsedMs = AUTO_STEP_MS; elapsedMs <= arena.durationMs; elapsedMs += AUTO_STEP_MS) {
        const statePayloads = createStatePayloadFactory(shapes);
        shapes = advanceArenaTick(shapes, {
            brainFor(bot) {
                const brain = brains.get(bot.id);
                if (!brain) return null;
                return {
                    configuration: brain.configuration,
                    loadout: brain.loadout,
                    stateSnapshot: statePayloads.forActor(bot.combatLoadout, bot.id),
                };
            },
            closingZoneElapsedMs: arena.initialElapsedMs + elapsedMs,
        });
        endElapsedMs = elapsedMs;
        if (shouldRecordFrames) frames.push(replayFrame(elapsedMs, shapes));
        // Both hooks run on the same tick; the puzzle may update player variables in `shapes`.
        const puzzleDone = puzzle?.afterTick({ elapsedMs, shapes }) === true;
        const hookDone = afterTick?.({ elapsedMs, shapes }) === true;
        if (puzzleDone || hookDone) return finish(null);

        const bots = shapes.filter(isSimulationBotShape).map(toSimulationBotShape);
        const aliveTeams = new Set(bots.filter(isAlive).map((bot) => bot.teamNumber));
        if (aliveTeams.size <= 1) {
            const winner = aliveTeams.size === 0
                ? null
                : bots.find((bot) => aliveTeams.has(bot.teamNumber) && isAlive(bot)) ?? null;
            return finish(winner);
        }
    }
    return finish(null);
}

function isAlive(bot) {
    return Number(bot.hp) > 0;
}
