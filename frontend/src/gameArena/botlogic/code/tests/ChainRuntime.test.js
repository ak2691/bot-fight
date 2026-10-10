import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
    countActionSlots,
    countConditionSlots,
    normalizeAbilityStrategyConfiguration,
    validateAbilityStrategyConfiguration,
} from "../../../../../../shared/engine/botlogic/code/BotCode.js";
import { ACTION_TYPES, ACTION_BY_ID } from "../../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { traceScenario } from "./chainScenarioRunner.js";

// The same scenarios and expected traces run on the server (ChainRuntimeSimulationTest).
const SCENARIOS = JSON.parse(fs.readFileSync(new URL("./chainScenarios.json", import.meta.url), "utf8"));
const SERVER_COPY = new URL("../../../../../../server/src/test/resources/botlogic/chainScenarios.json", import.meta.url);

for (const scenario of SCENARIOS) {
    test(`chain scenario: ${scenario.name}`, () => {
        assert.deepEqual(traceScenario(scenario), scenario.expected);
    });
    test(`C4 replay fields: ${scenario.name}`, () => {
        traceScenario(scenario, (bot, tick) => {
            const trace = scenario.expected[tick].split(" | ")[0];
            if (trace === "idle") {
                assert.equal(bot.runningChain, null);
                return;
            }
            const frames = trace.split(">");
            const [slug, path] = frames.at(-1).split("@");
            const chainId = `chain.${slug}`;
            assert.deepEqual(bot.runningChain, {
                chainId,
                name: scenario.chains.find((chain) => chain.id === chainId).name,
                path: path.split(".").map((part) => /^\d+$/.test(part) ? Number(part) : part),
                callDepth: frames.length,
            });
        });
    });
}

test("the browser and server chain scenario files stay identical", { skip: !fs.existsSync(SERVER_COPY) }, () => {
    assert.deepEqual(JSON.parse(fs.readFileSync(SERVER_COPY, "utf8")), SCENARIOS);
});

const always = [{ type: "always" }];
const walkStep = (extra = {}) => ({ type: "action", action: "move_walk", movementMode: "absolute", movementDirection: 90, forMs: 100, ...extra });
const chainOf = (slug, steps) => ({ id: `chain.${slug}`, name: slug, steps });
const brain = (chains, roots = []) => ({ version: "bot-logic-tree-v2", roots, chains });
const errorsFor = (configuration) => validateAbilityStrategyConfiguration(configuration).errors;

test("If and Else if bodies validate and orphan alternatives and removed cancellation are rejected", () => {
    const conditional = (type) => ({ type, conditions: always, steps: [walkStep()] });
    assert.deepEqual(errorsFor(brain([chainOf("a", [conditional("if"), conditional("elseIf"), conditional("elseIf")])])), []);
    for (const steps of [[conditional("elseIf")], [conditional("if"), walkStep(), conditional("elseIf")]]) {
        assert.match(errorsFor(brain([chainOf("a", steps)])).join(" "), /directly follow/);
    }
    assert.match(errorsFor(brain([chainOf("a", [{ type: "cancelChain" }])])).join(" "), /unknown step/);
    const migrated = normalizeAbilityStrategyConfiguration(brain([chainOf("a", [
        { type: "if", conditions: always, then: [walkStep()], else: [{ type: "end" }] },
    ])]));
    assert.deepEqual(migrated.chains[0].steps.map(({ type }) => type), ["if", "elseIf"]);
    assert.equal(migrated.chains[0].steps[0].steps[0].action, "move_walk");
    assert.deepEqual(migrated.chains[0].steps[1].steps, [{ type: "end" }]);
    assert.deepEqual(normalizeAbilityStrategyConfiguration(migrated), migrated);
});

test("brains without chains normalize exactly as before and chains stay out of the action picker", () => {
    const normalized = normalizeAbilityStrategyConfiguration({ version: "bot-logic-tree-v2", roots: [] });
    assert.equal(Object.hasOwn(normalized, "chains"), false);
    assert.equal(ACTION_TYPES.some((action) => action.id === "run_chain" || action.id === "cancel_chain"), false);
    assert.equal(ACTION_BY_ID.get("run_chain").head, "chain");
    assert.equal(ACTION_BY_ID.has("cancel_chain"), false);
});

test("chains are normalized and preserved on save", () => {
    const source = brain([chainOf("punish", [
        { type: "action", action: 37 },
        walkStep({ forMs: 540 }),
        { type: "wait", forMs: 99_999 },
        { type: "wait", untilConditions: always, maxMs: 250 },
        { type: "if", conditions: always, then: [{ type: "end" }], else: [] },
        { type: "repeat", count: 99, steps: [{ type: "exitLoop" }] },
        { type: "teleport" },
    ])], [{ priority: 1, branches: [{ priority: 1, branchType: "if", conditions: always, actions: [{ action: "run_chain", chainId: "chain.punish", ifRunning: "replace" }], children: [] }] }]);
    const normalized = normalizeAbilityStrategyConfiguration(source);
    const [chain] = normalized.chains;
    assert.deepEqual(chain.steps.map((step) => step.type), ["action", "action", "wait", "wait", "if", "repeat"]);
    assert.equal(chain.steps[0].continue, "end");
    assert.equal(chain.steps[1].forMs, 500);
    assert.equal(chain.steps[2].forMs, 10_000);
    assert.equal(chain.steps[3].maxMs, 300);
    assert.equal(chain.steps[5].count, 20);
    const [run] = normalized.roots[0].branches[0].actions;
    assert.deepEqual([run.action, run.chainId, run.ifRunning], ["run_chain", "chain.punish", undefined]);
    assert.deepEqual(normalizeAbilityStrategyConfiguration(normalized).chains, normalized.chains);
});

test("chain steps count toward the brain size metrics", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([chainOf("a", [
        { type: "action", action: 37 },
        { type: "if", conditions: [{ type: "expression", left: "match.elapsedSeconds", comparator: "lt", right: { type: "number", value: 5 } }], then: [walkStep()], else: [] },
    ])]));
    // Use ability (1) + If (1) + Walk (1); one condition.
    assert.equal(countActionSlots(configuration), 3);
    assert.equal(countConditionSlots(configuration), 1);
});

test("validation accepts a well-formed chain brain", () => {
    const configuration = brain([
        chainOf("a", [{ type: "runChain", chainId: "chain.b" }, { type: "repeat", count: 2, steps: [{ type: "repeat", whileConditions: always, maxMs: 500, steps: [{ type: "wait", forMs: 100 }] }] }]),
        chainOf("b", [walkStep()]),
    ]);
    assert.deepEqual(errorsFor(configuration), []);
});

test("validation rejects the chain bounds", () => {
    const tooManySteps = Array.from({ length: 33 }, () => ({ type: "end" }));
    const cases = [
        ["chain count", brain(Array.from({ length: 17 }, (_, index) => chainOf(`c${index}`, []))), /at most 16 chains/],
        ["step count", brain([chainOf("a", tooManySteps)]), /33 steps/],
        ["nested step count", brain([chainOf("a", [{ type: "repeat", count: 1, steps: tooManySteps.slice(0, 32) }])]), /33 steps/],
        ["repeat count", brain([chainOf("a", [{ type: "repeat", count: 21, steps: [] }])]), /count must be a whole number from 1 to 20/],
        ["repeat count of zero", brain([chainOf("a", [{ type: "repeat", count: 0, steps: [] }])]), /count must be a whole number/],
        ["wait not a multiple of 100", brain([chainOf("a", [{ type: "wait", forMs: 150 }])]), /multiple of 100/],
        ["wait too long", brain([chainOf("a", [{ type: "wait", forMs: 10_100 }])]), /multiple of 100 ms from 100 to 10000/],
        ["wait of zero", brain([chainOf("a", [{ type: "wait", forMs: 0 }])]), /multiple of 100/],
        ["until without a max", brain([chainOf("a", [{ type: "wait", untilConditions: always }])]), /max time/],
        ["walk without a duration", brain([chainOf("a", [{ type: "action", action: "move_walk", movementMode: "absolute", movementDirection: 90 }])]), /duration/],
        ["loop nesting", brain([chainOf("a", [{ type: "repeat", count: 1, steps: [{ type: "repeat", count: 1, steps: [{ type: "repeat", count: 1, steps: [] }] }] }])]), /nests loops deeper than 2/],
        ["unknown step type", brain([chainOf("a", [{ type: "teleport" }])]), /unknown step type/],
        ["missing chain reference", brain([chainOf("a", [{ type: "runChain", chainId: "chain.nope" }])]), /does not exist/],
        ["chain control inside a chain step", brain([chainOf("a", [{ type: "action", action: "run_chain", chainId: "chain.a" }])]), /cannot run/],
        ["root run_chain to a missing chain", brain([], [{ priority: 1, branches: [{ priority: 1, branchType: "if", conditions: always, actions: [{ action: "run_chain", chainId: "chain.nope" }], children: [] }] }]), /runs a chain that does not exist/],
        ["invalid chain id", brain([chainOf("Bad Id", [])].map((chain) => ({ ...chain, id: "Bad Id" }))), /invalid ID/],
    ];
    for (const [label, configuration, pattern] of cases) {
        assert.ok(errorsFor(configuration).some((error) => pattern.test(error)), `${label}: ${JSON.stringify(errorsFor(configuration))}`);
    }
});

test("validation rejects call cycles and calls nested deeper than three levels", () => {
    const call = (id) => ({ type: "runChain", chainId: `chain.${id}` });
    assert.ok(errorsFor(brain([chainOf("a", [call("a")])])).some((error) => /cycle/.test(error)));
    assert.ok(errorsFor(brain([chainOf("a", [call("b")]), chainOf("b", [call("a")])])).some((error) => /cycle/.test(error)));
    const threeDeep = brain([chainOf("a", [call("b")]), chainOf("b", [call("c")]), chainOf("c", [])]);
    assert.deepEqual(errorsFor(threeDeep), []);
    const fourDeep = brain([chainOf("a", [call("b")]), chainOf("b", [call("c")]), chainOf("c", [call("d")]), chainOf("d", [])]);
    assert.ok(errorsFor(fourDeep).some((error) => /3 levels deep/.test(error)));
});
