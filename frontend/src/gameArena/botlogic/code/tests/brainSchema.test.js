import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildBrainSchema, serializeBrainSchema, OUTPUT_PATH } from "../../../../../scripts/generate-brain-schema.mjs";
import { createExpressionCondition, normalizeAbilityStrategyConfiguration } from "../../../../../../shared/engine/botlogic/code/BotCode.js";
import { ACTION_TYPES, STATE_VARIABLES } from "../../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { validateBrainSchema } from "../configuration/brainSchema.js";
import { brainRuleErrors, puzzleRulesAsBrain } from "../../../../../../shared/engine/botlogic/code/configuration/brainRules.js";
import { validateAbilityStrategyConfiguration } from "../validateBrain.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../shared/brain-tests");
const fixtures = (kind) => readdirSync(resolve(FIXTURES, kind)).filter((name) => name.endsWith(".json")).sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(resolve(FIXTURES, kind, name), "utf8")) }));

test("the committed brain schema is what the generator produces from the contracts", () => {
    const text = readFileSync(OUTPUT_PATH, "utf8");
    assert.equal(text, serializeBrainSchema(buildBrainSchema()), "run npm run schema:brain");
    const committed = JSON.parse(text);
    assert.deepEqual(committed, JSON.parse(JSON.stringify(buildBrainSchema())),
        "run `npm run schema:brain` and commit shared/schemas/brain.schema.json");
});

test("valid brain fixtures pass the schema and the brain rules", () => {
    const valid = fixtures("valid");
    assert.ok(valid.length > 5);
    for (const fixture of valid) {
        assert.deepEqual(validateBrainSchema(fixture.options?.puzzleRules ? puzzleRulesAsBrain(fixture.brain) : fixture.brain).errors, [], fixture.name);
        assert.deepEqual(brainRuleErrors(fixture.brain, fixture.options), [], fixture.name);
    }
});

test("invalid brain fixtures are rejected by the schema, or else by the brain rules", () => {
    const invalid = fixtures("invalid");
    assert.ok(invalid.length > 20);
    for (const fixture of invalid) {
        assert.ok(fixture.rule, `${fixture.name} names its rule`);
        assert.ok(["schema", "rules"].includes(fixture.layer), `${fixture.name} has a layer`);
        const result = validateBrainSchema(fixture.options?.puzzleRules ? puzzleRulesAsBrain(fixture.brain) : fixture.brain);
        assert.equal(result.valid, fixture.layer === "rules", `${fixture.name}: ${fixture.rule}`);
        if (fixture.layer === "schema") assert.ok(result.errors.length > 0 && result.errors.every((error) => error.startsWith("brain")), fixture.name);
        else assert.ok(brainRuleErrors(fixture.brain, fixture.options).length > 0, `${fixture.name}: ${fixture.rule}`);
    }
});

test("every action the editor offers produces a schema-valid brain", () => {
    for (const action of ACTION_TYPES.filter((entry) => !["none", "variable"].includes(entry.id))) {
        const brain = normalizeAbilityStrategyConfiguration({
            version: "bot-logic-tree-v2",
            roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: action.id }] }] }],
        });
        assert.deepEqual(validateBrainSchema(brain).errors, [], String(action.id));
    }
});

test("errors keep their JSON paths", () => {
    const brain = { version: "bot-logic-tree-v2", roots: [{ name: "x".repeat(26), branches: [] }] };
    assert.ok(validateBrainSchema(brain).errors.some((error) => error.startsWith("brain.roots[0].name:")));
});

test("the editor reports schema errors for what it would submit", () => {
    const configuration = { version: "bot-logic-tree-v2", roots: [], nodePositions: { n: { x: 1, y: 1 } } };
    assert.deepEqual(validateAbilityStrategyConfiguration(configuration).errors, []);
    // With no status effect to pick from, the normalized condition has none, and the server would reject it.
    const state = STATE_VARIABLES.find((variable) => variable.supportsStatusEffect);
    const broken = { version: "bot-logic-tree-v2", roots: [{ branches: [{ conditions: [
        createExpressionCondition(state.id),
    ], actions: [{ action: "move_walk" }] }] }] };
    const { errors } = validateAbilityStrategyConfiguration(broken);
    assert.ok(errors.some((error) => error.startsWith("brain.roots[0].branches[0].conditions[0].statusEffect")), JSON.stringify(errors));
});

test("the simulator schemas compile with ajv next to the brain schema, as the worker will load them", async () => {
    const { default: Ajv2020 } = await import("ajv/dist/2020.js");
    const read = (name) => JSON.parse(readFileSync(resolve(FIXTURES, "../schemas", name), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(read("brain.schema.json"));
    const validateRequest = ajv.compile(read("simulation-request.schema.json"));
    const validateResponse = ajv.compile(read("simulation-response.schema.json"));
    const brain = fixtures("valid").find((fixture) => fixture.name === "walk-and-loadout.json").brain;
    const request = {
        matchId: "6b8f4f4e-3c1e-4c8e-9a43-0f7b1f7a2d11", rulesetVersion: "duel-v2", seed: 42,
        arena: { width: 1200, height: 1200, durationMs: 120000 },
        bots: [{ userId: "6b8f4f4e-3c1e-4c8e-9a43-0f7b1f7a2d12", username: "a", slot: 1, x: 300, y: 600, rotation: 90, size: 60, selectedLoadout: "melee", brain, initialHp: null, teamNumber: 1 }],
        segments: [{ endsAtMs: 20000, bots: [] }], recordFromMs: null,
    };
    assert.equal(validateRequest(request), true, JSON.stringify(validateRequest.errors));
    assert.equal(validateRequest({ ...request, bots: [{ ...request.bots[0], brain: { ...brain, extra: 1 } }] }), false);
    const response = {
        result: { engineVersion: "node-engine-1", outcome: "BOT_WIN", endReason: "KO", winnerTeam: 1, teamHp: [{ teamNumber: 1, hp: 80 }], segmentEndMs: 9000 },
        replay: { initialState: {}, batches: [{ sequence: 1, endMs: 1000, terminal: true, frames: [{ elapsedMs: 0 }, { elapsedMs: 100 }] }] },
    };
    assert.equal(validateResponse(response), true, JSON.stringify(validateResponse.errors));
    assert.equal(validateResponse({ ...response, result: { ...response.result, winnerTeam: null } }), false);
});
