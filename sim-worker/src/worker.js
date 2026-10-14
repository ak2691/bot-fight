import { simulateMatch } from '../../shared/engine/match/simulateMatch.js';

// Runs one duel in a Piscina thread. Requests are plain JSON; the engine validates the roster and arena.
export default function run({ request, engineVersion, maxTicks }) {
    if (request == null || typeof request !== 'object' || Array.isArray(request)) {
        return { status: 400, error: { code: 'INVALID_REQUEST', issues: [{ path: '', message: 'must be an object' }] } };
    }
    if (Math.floor((request.arena?.durationMs ?? 0) / 100) > maxTicks) {
        return { status: 400, error: { code: 'TICK_LIMIT', issues: [{ path: '/arena/durationMs', message: `Simulation exceeds ${maxTicks} ticks` }] } };
    }
    try {
        const result = simulateMatch(request, { recordFrames: !request.puzzle });
        return { status: 200, body: { engineVersion, replay: result.replay, ...(result.puzzle ? { puzzle: result.puzzle } : {}) } };
    } catch (error) {
        // simulateMatch owns roster, arena and segment invariants.
        return { status: 400, error: { code: 'INVALID_SIMULATION', issues: [{ path: '', message: error.message }] } };
    }
}
