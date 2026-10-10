import Ajv2020 from 'ajv/dist/2020.js';
import brainSchema from '../../shared/schemas/brain.schema.json' with { type: 'json' };
import requestSchema from '../../shared/schemas/simulation-request.schema.json' with { type: 'json' };
import { simulateFight } from '../../shared/engine/simulateFight.js';
import { brainRuleErrors, puzzleRulesAsBrain } from '../../shared/engine/botlogic/code/configuration/brainRules.js';
import { AUTO_STEP_MS } from '../../shared/engine/modelPayloads/arenaConstants.js';

// Loaded once per thread, including the engine's validated gameplay registries.
const ajv = new Ajv2020({ strict: false, allErrors: false });
ajv.addSchema(brainSchema);
const validate = ajv.compile(requestSchema);
const validateBrainSchema = ajv.getSchema(brainSchema.$id);

export default function run({ request, engineVersion, maxTicks }) {
    if (!validate(request)) {
        return { status: 400, error: { code: 'INVALID_REQUEST', issues: validate.errors.map(({ instancePath, keyword, message, params }) => ({ path: instancePath, keyword, message, params })) } };
    }
    const duration = request.segments?.length ? request.segments.at(-1).endsAtMs : request.arena.durationMs;
    if (Math.floor(duration / AUTO_STEP_MS) > maxTicks) {
        return { status: 400, error: { code: 'TICK_LIMIT', issues: [{ path: '/arena/durationMs', message: `Simulation exceeds ${maxTicks} ticks` }] } };
    }
    try {
        return { status: 200, body: simulateFight(request, { engineVersion }) };
    } catch (error) {
        // simulateFight owns roster, segment and seed invariants beyond JSON Schema.
        return { status: 400, error: { code: 'INVALID_SIMULATION', issues: [{ path: '', message: error.message }] } };
    }
}

/**
 * POST /validate: `{ brain }` checks a submitted brain; `{ brain, puzzleRules: true }` checks a puzzle's outcome
 * rules (flat win/lose conditions and variable modifications). `puzzleConstraints` applies authored bot
 * budgets and the reserved namespace. Answers `{ errors }`; empty means valid.
 */
export function validateBrain({ request }) {
    const { brain, puzzleRules = false, puzzleConstraints = null } = request ?? {};
    if (!brain || typeof brain !== 'object' || Array.isArray(brain)) return { status: 400, error: { code: 'INVALID_REQUEST', issues: [{ path: '/brain', message: 'must be an object' }] } };
    const candidate = puzzleRules ? puzzleRulesAsBrain(brain) : brain;
    if (!validateBrainSchema(candidate)) {
        const errors = validateBrainSchema.errors.map(({ instancePath, message }) => `brain${instancePath.replace(/\/(\d+)/g, '[$1]').replaceAll('/', '.')}: ${message}`);
        return { status: 200, body: { errors } };
    }
    return { status: 200, body: { errors: brainRuleErrors(brain, { puzzleRules, puzzleConstraints }) } };
}

