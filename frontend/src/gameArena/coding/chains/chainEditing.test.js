import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_TYPES, BOT_CODE_ACTIONS, SELECTABLE_TYPES, STATE_VARIABLES, actionSupportsTarget } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { ACTION_BY_ID, CHAIN_ACTION_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { MAX_CHAIN_STEPS } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import {
    BODY,
    BRANCH,
    addStepBlockReason,
    appendStepAt,
    insertStepAt,
    callBlockReason,
    chainUsage,
    changeStepAction,
    cleanChainName,
    countChainSteps,
    createChain,
    firstCallableChain,
    moveStepAt,
    newActionStep,
    newFlowStep,
    numberChainSteps,
    pathKey,
    removeChain,
    removeStepAt,
    renameChain,
    secondsToMs,
    setTimedMode,
    stepAt,
    stepMeterState,
    updateStepAt,
    withConditionOperand,
} from "./chainEditing.js";
import { conditionsPhrase, describeChainStep, shortTargetLabel } from "./chainStepPresentation.js";

const action = (id) => ACTION_TYPES.find((candidate) => candidate.id === id);
// An ability that takes a target, and one that does not.
const targeted = ACTION_TYPES.find((candidate) => candidate.head === "ability" && !candidate.movementConfig && actionSupportsTarget(candidate));
const untargeted = ACTION_TYPES.find((candidate) => candidate.head === "ability" && !candidate.movementConfig && !actionSupportsTarget(candidate));
const actionHead = (id) => ACTION_BY_ID.get(id)?.head ?? null;

test("Else if requires an adjacent conditional and edits preserve that relationship", () => {
    const first = newFlowStep("if");
    const alternate = newFlowStep("elseIf");
    const wait = newFlowStep("wait");
    assert.deepEqual(appendStepAt([], [], alternate), []);
    assert.deepEqual(appendStepAt([wait], [], alternate), [wait]);
    assert.deepEqual(appendStepAt([first], [], alternate), [first, alternate]);
    assert.deepEqual(appendStepAt([first, alternate], [], alternate), [first, alternate, alternate]);
    assert.equal(moveStepAt([first, alternate, wait], [2], -1), null);
    assert.equal(moveStepAt([first, alternate], [1], -1), null);
    const promoted = removeStepAt([first, { ...alternate, steps: [wait] }], [0]);
    assert.deepEqual(promoted, [{ ...alternate, type: "if", steps: [wait] }]);
    const chain = { id: "chain.a", steps: [wait] };
    assert.match(addStepBlockReason({ chains: [chain], chain, listPath: [], stepType: "elseIf" }), /directly follow/);
});
const readyCondition = {
    type: "expression",
    left: "bot.selectedAbilityReady",
    comparator: "eq",
    right: { type: "boolean", value: true },
    ability: 1,
};

/** The feint-punish chain from the design: a repeat, a wait, an If with two paths, then a variable. */
function samplePunish() {
    return [
        { type: "repeat", count: 2, steps: [
            { ...newActionStep(targeted), selectable: "opponent_1" },
            { type: "wait", forMs: 300 },
            { ...newActionStep(action(BOT_CODE_ACTIONS.CANCEL_WINDUP)) },
        ] },
        { type: "wait", untilConditions: [readyCondition], maxMs: 1000 },
        { type: "if", conditions: [readyCondition], steps: [
            { ...newActionStep(action(BOT_CODE_ACTIONS.MOVE_WALK)) },
            { type: "end" },
        ] },
        { type: "elseIf", conditions: [], steps: [{ type: "end" }] },
        { type: "end" },
    ];
}

test("steps are numbered in reading order: the step, its Yes path, its No path, then what follows", () => {
    const numbers = numberChainSteps(samplePunish());
    const at = (path) => numbers.get(pathKey(path));
    // The Repeat is a bracket and takes no number; its body is numbered like the rest.
    assert.equal(numbers.has("0"), false);
    assert.deepEqual([at([0, BODY, 0]), at([0, BODY, 1]), at([0, BODY, 2])], [1, 2, 3]);
    assert.equal(at([1]), 4);
    assert.equal(at([2]), 5);
    assert.deepEqual([at([2, BRANCH, 0]), at([2, BRANCH, 1]), at([3, BRANCH, 0])], [6, 7, 9]);
    assert.equal(at([3]), 8);
    assert.equal(at([4]), 10);
});

test("steps are found, changed, added, removed and moved by their path", () => {
    let steps = samplePunish();
    assert.equal(stepAt(steps, [2, BRANCH, 1]).type, "end");
    steps = updateStepAt(steps, [0, BODY, 1], (step) => ({ ...step, forMs: 700 }));
    assert.equal(stepAt(steps, [0, BODY, 1]).forMs, 700);
    steps = appendStepAt(steps, [3, BRANCH], { type: "end" });
    assert.equal(stepAt(steps, [3, BRANCH, 1]).type, "end");
    steps = removeStepAt(steps, [2, BRANCH, 0]);
    assert.equal(stepAt(steps, [2, BRANCH, 0]).type, "end");
    const moved = moveStepAt(steps, [0, BODY, 0], 1);
    assert.deepEqual(moved.path, [0, BODY, 1]);
    assert.equal(stepAt(moved.steps, [0, BODY, 0]).type, "wait");
    assert.equal(moveStepAt(steps, [0, BODY, 2], 1), null);
    assert.equal(moveStepAt(steps, [0, BODY, 0], -1), null);
    assert.equal(samplePunish()[0].steps.length, 3, "editing never mutates the original");
});

test("the step meter turns amber, then red, close to the limit", () => {
    assert.equal(stepMeterState(14), "");
    assert.equal(stepMeterState(23), "");
    assert.equal(stepMeterState(24), "is-near");
    assert.equal(stepMeterState(29), "is-near");
    assert.equal(stepMeterState(30), "is-full");
    assert.equal(stepMeterState(MAX_CHAIN_STEPS), "is-full");
    assert.equal(countChainSteps({ steps: samplePunish() }), 11);
});

test("adding a step is blocked, with a reason, at the step limit, in over-deep loops and for useless steps", () => {
    const chain = { id: "chain.a", name: "A", steps: [] };
    const chains = [chain, { id: "chain.b", name: "B", steps: [] }];
    const budget = { actions: 10, conditions: 10 };
    const reason = (stepType, listPath = [], overrides = {}) => addStepBlockReason({ chains, chain, listPath, stepType, budget, ...overrides });
    assert.equal(reason("wait"), null);
    const full = { ...chain, steps: Array.from({ length: MAX_CHAIN_STEPS }, () => ({ type: "end" })) };
    assert.match(reason("wait", [], { chain: full }), /full \(32 steps\)/);
    assert.match(reason("wait", [], { budget: { actions: 0, conditions: 5 } }), /out of action slots/);
    assert.match(reason("if", [], { budget: { actions: 5, conditions: 0 } }), /out of condition slots/);
    assert.equal(reason("repeat", [0, BODY]), null);
    assert.match(reason("repeat", [0, BODY, 1, BODY]), /nest at most 2/);
    assert.match(reason("exitLoop"), /inside a Repeat/);
    assert.equal(reason("exitLoop", [0, BODY]), null);
    assert.equal(reason("runChain"), null);
    assert.match(reason("runChain", [], { chains: [chain] }), /Create another chain/);
});

test("a chain cannot run itself, close a loop, or nest calls deeper than three", () => {
    const run = (chainId) => ({ type: "runChain", chainId });
    const chains = [
        { id: "chain.a", name: "A", steps: [run("chain.b")] },
        { id: "chain.b", name: "B", steps: [run("chain.c")] },
        { id: "chain.c", name: "C", steps: [] },
        { id: "chain.d", name: "D", steps: [] },
    ];
    assert.match(callBlockReason(chains, "chain.a", "chain.a"), /cannot run itself/);
    assert.match(callBlockReason(chains, "chain.c", "chain.a"), /would loop/);
    assert.match(callBlockReason(chains, "chain.d", "chain.a"), /3 levels/);
    assert.match(callBlockReason(chains, "chain.c", "chain.d"), /3 levels/, "a to b to c to d is four deep");
    assert.equal(callBlockReason(chains, "chain.a", "chain.d"), null);
    assert.equal(firstCallableChain(chains, "chain.c"), null);
});

test("new chains get an unused name and a valid ID, and rename keeps the ID", () => {
    const first = createChain({ chains: [] });
    assert.deepEqual(first, { id: "chain.chain_1", name: "Chain 1", steps: [] });
    const second = createChain({ chains: [first] }, "Feint punish!");
    assert.equal(second.id, "chain.feint_punish");
    assert.equal(createChain({ chains: [first, second] }, "Feint punish").id, "chain.feint_punish_2");
    const renamed = renameChain({ chains: [first, second] }, second.id, "  Punish   later ");
    assert.equal(renamed.chains[1].id, "chain.feint_punish");
    assert.equal(renamed.chains[1].name, "Punish later");
    assert.equal(renameChain({ chains: [first] }, first.id, "   ").chains[0].name, "Chain 1");
    assert.equal(cleanChainName("x".repeat(40)).length, 25);
    assert.equal(createChain({ chains: Array.from({ length: 16 }, (_, index) => ({ id: `chain.c${index}`, name: `C${index}`, steps: [] })) }), null);
});

test("deleting a chain removes every call to it and reports where it is used", () => {
    const configuration = {
        chains: [
            { id: "chain.a", name: "A", steps: [{ type: "runChain", chainId: "chain.b" }, { type: "if", conditions: [], steps: [{ type: "runChain", chainId: "chain.b" }, { type: "end" }] }] },
            { id: "chain.b", name: "B", steps: [] },
        ],
        roots: [
            { id: "r1", branches: [{ id: "b1", conditions: [], actions: [{ action: BOT_CODE_ACTIONS.RUN_CHAIN, chainId: "chain.b" }, { action: BOT_CODE_ACTIONS.MOVE_WALK, selectable: "opponent_1" }], action: BOT_CODE_ACTIONS.RUN_CHAIN, children: [{ id: "b2", conditions: [], actions: [{ action: BOT_CODE_ACTIONS.RUN_CHAIN, chainId: "chain.b" }], action: BOT_CODE_ACTIONS.RUN_CHAIN }] }] },
            { id: "r2", branches: [{ id: "b3", conditions: [], actions: [{ action: BOT_CODE_ACTIONS.RUN_CHAIN, chainId: "chain.a" }] }] },
        ],
    };
    assert.deepEqual(chainUsage(configuration, "chain.b"), { roots: 1, chains: 1 });
    assert.deepEqual(chainUsage(configuration, "chain.a"), { roots: 1, chains: 0 });
    const next = removeChain(configuration, "chain.b");
    assert.deepEqual(next.chains.map((chain) => chain.id), ["chain.a"]);
    assert.deepEqual(next.chains[0].steps.map((step) => step.type), ["if"]);
    assert.deepEqual(next.chains[0].steps[0].steps.map((step) => step.type), ["end"]);
    const branch = next.roots[0].branches[0];
    assert.deepEqual(branch.actions.map((entry) => entry.action), [BOT_CODE_ACTIONS.MOVE_WALK]);
    assert.equal(branch.action, BOT_CODE_ACTIONS.MOVE_WALK);
    assert.deepEqual(branch.children[0].actions, []);
    assert.equal(branch.children[0].action, "none");
    assert.equal(next.roots[1].branches[0].actions.length, 1, "calls to other chains stay");
    assert.deepEqual(validateChains(next, { actionHead }), []);
});

test("steps built by the editor pass chain validation", () => {
    const chains = [
        { id: "chain.a", name: "A", steps: [] },
        { id: "chain.b", name: "B", steps: [] },
    ];
    const abilityId = targeted.id;
    chains[0].steps = [
        newActionStep(action(abilityId)),
        newActionStep(action(BOT_CODE_ACTIONS.MOVE_WALK)),
        newActionStep(action(BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET)),
        newActionStep(action(BOT_CODE_ACTIONS.CANCEL_WINDUP)),
        newFlowStep("wait"),
        { ...newFlowStep("repeat"), steps: [newFlowStep("exitLoop")] },
        { ...newFlowStep("if", { defaultCondition: readyCondition }), steps: [newFlowStep("end")] },
        newFlowStep("runChain", { chainId: "chain.b" }),
        newFlowStep("end"),
    ];
    assert.deepEqual(validateChains({ chains, roots: [] }, { actionHead }), []);
    assert.equal(chains[0].steps[0].continue, "now");
    assert.equal(chains[0].steps[1].forMs, 500);
});

test("a step switches between a fixed time and conditions, and times snap to whole ticks", () => {
    const wait = newFlowStep("wait");
    const until = setTimedMode(wait, true, readyCondition);
    assert.deepEqual(until, { type: "wait", untilConditions: [readyCondition], maxMs: 1000 });
    assert.deepEqual(setTimedMode(until, false), { type: "wait", forMs: 500 });
    assert.deepEqual(setTimedMode(newFlowStep("repeat"), true, readyCondition), { type: "repeat", steps: [], whileConditions: [readyCondition], maxMs: 1000 });
    assert.deepEqual(setTimedMode({ type: "repeat", whileConditions: [readyCondition], maxMs: 1000, steps: [] }, false), { type: "repeat", steps: [], count: 2 });
    assert.equal(secondsToMs(0.34), 300);
    assert.equal(secondsToMs(0), 100);
    assert.equal(secondsToMs(99), 10000);
    assert.equal(secondsToMs("abc"), 500);
});

test("changing a step's ability keeps its target and timing", () => {
    const dashId = ACTION_TYPES.find((candidate) => candidate.head === "ability" && candidate.movementConfig)?.id;
    const cleaveId = untargeted.id;
    const step = { ...newActionStep(action(cleaveId)), selectable: "opponent_1", continue: "now" };
    const changed = changeStepAction(step, action(dashId ?? cleaveId));
    assert.equal(changed.selectable, "opponent_1");
    assert.equal(changed.continue, "now");
    const walk = { ...newActionStep(action(BOT_CODE_ACTIONS.MOVE_WALK)), forMs: 700 };
    const rotate = changeStepAction(walk, action(BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET));
    assert.deepEqual([rotate.forMs, rotate.untilConditions, rotate.maxMs], [700, undefined, undefined]);
});

test("picking a variable for a condition row keeps what still fits", () => {
    const stateVariables = STATE_VARIABLES;
    const distance = stateVariables.find((variable) => variable.id === "selectable.distance");
    const hp = stateVariables.find((variable) => variable.id === "selectable.hp");
    const row = { type: "expression", left: "selectable.distance", comparator: "lt", right: { type: "number", value: 120 }, leftSelectable: "opponent_1" };
    const swapped = withConditionOperand([row], 0, 1, hp.id, hp, SELECTABLE_TYPES);
    assert.equal(swapped[0].left, hp.id);
    assert.deepEqual(swapped[0].right, { type: "number", value: 120 });
    assert.deepEqual(withConditionOperand([row], 0, 1, "always", null, SELECTABLE_TYPES), [{ type: "always" }]);
    const compared = withConditionOperand([row], 0, 2, hp.id, hp, SELECTABLE_TYPES);
    assert.deepEqual(compared[0].right, { type: "variable", value: hp.id });
    const bool = stateVariables.find((variable) => variable.valueType === "boolean");
    assert.deepEqual(withConditionOperand([row], 0, 2, bool.id, bool, SELECTABLE_TYPES), [row], "only numbers compare to a variable");
    assert.ok(distance);
});

test("steps read like the design: category, label and a one-line summary", () => {
    const lookups = {
        variable: (id) => STATE_VARIABLES.find((variable) => variable.id === id) ?? null,
        selectable: (id) => id,
        ability: () => "Cleave",
    };
    const context = { actionTypes: ACTION_TYPES, selectableTypes: SELECTABLE_TYPES, customVariables: [], stateVariables: STATE_VARIABLES, chains: [{ id: "chain.a", name: "Feint punish" }], lookups };
    const opponent = SELECTABLE_TYPES.find((selectable) => selectable.role === "opponent" && selectable.kind === "bot").id;
    const use = describeChainStep({ ...newActionStep(targeted), selectable: opponent, continue: "now" }, context);
    assert.deepEqual([use.tag, use.tone, use.label, use.summary], ["ABILITY", "action", targeted.label.replace(/^[^:]+:\s*/, ""), "Opponent 1"]);
    const walk = describeChainStep({ ...newActionStep(action(BOT_CODE_ACTIONS.MOVE_WALK)), selectable: opponent, sprint: true, movementMode: "target", movementDirection: 0 }, context);
    assert.deepEqual([walk.tag, walk.label, walk.summary], ["MOVE", "Walk", "to Opponent 1, sprint for 0.5 s"]);
    const rotate = describeChainStep({ ...newActionStep(action(BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET)), selectable: opponent, fastTurn: true }, context);
    assert.deepEqual([rotate.tag, rotate.summary], ["ROTATE", "Opponent 1, fast for 0.5 s"]);
    const away = describeChainStep({ ...newActionStep(action(BOT_CODE_ACTIONS.MOVE_WALK)), selectable: opponent, movementMode: "target", movementDirection: 180, forMs: 1000 }, context);
    assert.deepEqual([away.label, away.summary], ["Walk", "away from Opponent 1 for 1.0 s"]);
    assert.equal(describeChainStep({ type: "action", action: BOT_CODE_ACTIONS.CANCEL_WINDUP }, context).label, "Cancel wind-up");
    const wait = describeChainStep({ type: "wait", forMs: 300 }, context);
    assert.deepEqual([wait.tag, wait.tone, wait.label, wait.summary], ["WAIT", "flow", "0.3 s", ""]);
    const until = describeChainStep({ type: "wait", untilConditions: [readyCondition], maxMs: 1000 }, context);
    assert.deepEqual([until.label, until.summary], ["until Cleave Ready", "max 1.0 s"]);
    assert.equal(describeChainStep({ type: "repeat", count: 2, steps: [] }, context).label, "Repeat 2 times");
    assert.match(describeChainStep({ type: "repeat", whileConditions: [readyCondition], maxMs: 3000, steps: [] }, context).label, /^Repeat while Cleave Ready \(max 3\.0 s\)$/);
    assert.equal(describeChainStep({ type: "runChain", chainId: "chain.a" }, context).label, "Feint punish");
    assert.equal(describeChainStep({ type: "runChain", chainId: "chain.gone" }, context).label, "Choose a chain");
    assert.equal(describeChainStep({ type: "end" }, context).label, "End chain");
    assert.equal(conditionsPhrase([], lookups), "its conditions hold");
    assert.deepEqual(["My Bot", "Opponent 2", "Teammate 1", "Dummy"].map(shortTargetLabel), ["Me", "Opp 2", "Ally 1", "Dummy"]);
    assert.deepEqual(CHAIN_ACTION_TYPES.map((candidate) => candidate.id), [BOT_CODE_ACTIONS.RUN_CHAIN]);
});

test("an action the loadout no longer offers still shows, so the step can be fixed or deleted", () => {
    const description = describeChainStep({ type: "action", action: "gone", selectable: "opponent_1" }, { actionTypes: ACTION_TYPES, selectableTypes: SELECTABLE_TYPES, lookups: null });
    assert.deepEqual([description.tag, description.tone, description.label], ["ACTION", "action", "Unavailable action"]);
});


test("chain pins insert at the first, after, and nested body positions", () => {
    const original = [{ type: "if", conditions: [readyCondition], steps: [{ type: "wait", forMs: 100 }] }, { type: "end" }];
    const wait = { type: "wait", forMs: 300 };
    assert.equal(insertStepAt(original, [], 0, wait)[0], wait);
    assert.equal(insertStepAt(original, [], 1, wait)[1], wait);
    assert.equal(insertStepAt(original, [0, BRANCH], 0, wait)[0].steps[0], wait);
    assert.equal(original.length, 2);
    const pair = [original[0], { type: "elseIf", conditions: [readyCondition], steps: [] }];
    assert.equal(insertStepAt(pair, [], 1, wait), pair);
    assert.match(addStepBlockReason({ chains: [], chain: { steps: pair }, listPath: [], insertionIndex: 1, stepType: "wait" }), /Else if must stay/);
    assert.equal(addStepBlockReason({ chains: [], chain: { steps: original }, listPath: [], insertionIndex: 1, stepType: "elseIf" }), null);
});

test("removing a chain clears connected root actions and orphan references", () => {
    const run = { action: BOT_CODE_ACTIONS.RUN_CHAIN, chainId: "chain.a" };
    const brain = { roots: [{ branches: [], actions: [run] }], chains: [{ id: "chain.a", steps: [] }], orphans: [{ ...run, id: "loose", kind: "action" }] };
    assert.equal(chainUsage(brain, "chain.a").roots, 1);
    const next = removeChain(brain, "chain.a");
    assert.deepEqual(next.roots[0].actions, []);
    assert.deepEqual(next.orphans, []);
});

// ---- Stacked blocks ----------------------------------------------------------------------------
import {
    addLooseBlock, chooseDropGap, dropBlockReason, placeBlockInStack, removeStepPath, stepAtPath, updateStepPath,
    hasUnboundExit, repeatDepthOf,
} from "./chainEditing.js";
import { normalizeAbilityStrategyConfiguration, countActionSlots as countSlots } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { validateChains } from "../../../../../shared/engine/botlogic/code/configuration/chainValidation.js";

const stackStep = (type, extra = {}) => ({ type, ...extra });
const stackChain = (steps, loose) => ({ id: "chain.a", name: "A", steps, ...(loose ? { loose } : {}) });
const gapsOf = (listPath, ys, left = 0, right = 240) => ys.map((y, index) => ({ listPath, index, y, left, right }));

test("drop rule: nearest gap to the top edge within 28 px that overlaps the stack", () => {
    const gaps = [...gapsOf([], [40, 80, 120]), ...gapsOf([1, "body"], [100], 20, 240)];
    assert.deepEqual(chooseDropGap(gaps, { top: 78, left: 10, right: 200 }), gaps[1], "just above a gap");
    assert.deepEqual(chooseDropGap(gaps, { top: 100, left: 10, right: 200 }), gaps[3], "inside a mouth, nearest gap");
    assert.deepEqual(chooseDropGap(gaps, { top: 60, left: 10, right: 200 }), gaps[1], "a tie goes under the block above");
    assert.equal(chooseDropGap(gaps, { top: 300, left: 10, right: 200 }), null, "too far vertically");
    assert.equal(chooseDropGap(gaps, { top: 80, left: 400, right: 600 }), null, "no horizontal overlap");
    assert.deepEqual(chooseDropGap(gaps, { top: 20, left: 10, right: 200 }), gaps[0], "first in the list");
});

test("dropping an Else if anywhere but under an If is refused with a reason", () => {
    const steps = [stackStep("if", { conditions: [], steps: [] }), stackStep("wait", { forMs: 100 })];
    const chain = stackChain(steps);
    const elseIf = stackStep("elseIf", { conditions: [], steps: [] });
    const args = { chains: [chain], chain, step: elseIf };
    assert.equal(dropBlockReason({ ...args, listPath: [], index: 1 }), null);
    assert.match(dropBlockReason({ ...args, listPath: [], index: 2 }), /directly follow/);
    assert.match(dropBlockReason({ ...args, listPath: [], index: 0 }), /directly follow/);
    assert.equal(dropBlockReason({ chains: [chain], chain, step: stackStep("exitLoop"), listPath: [], index: 1 }), "Exit loop only works inside a Repeat.");
    assert.equal(hasUnboundExit(stackStep("if", { steps: [stackStep("exitLoop")] })), true);
    assert.equal(hasUnboundExit(stackStep("repeat", { count: 2, steps: [stackStep("exitLoop")] })), false);
    assert.equal(repeatDepthOf(stackStep("repeat", { steps: [stackStep("repeat", { steps: [] })] })), 2);
});

test("drops into a mouth, below a block and first in a list place the block where the gap is", () => {
    const chain = stackChain([stackStep("repeat", { count: 2, steps: [stackStep("wait", { forMs: 100 })] }), stackStep("end")]);
    const block = stackStep("wait", { forMs: 300 });
    const inside = placeBlockInStack(chain, [0, "body"], 1, block);
    assert.equal(inside.steps[0].steps[1].forMs, 300);
    const below = placeBlockInStack(chain, [], 1, block);
    assert.deepEqual(below.steps.map((step) => step.type), ["repeat", "wait", "end"]);
    const first = placeBlockInStack(chain, [], 0, block);
    assert.equal(first.steps[0].forMs, 300);
    assert.equal(placeBlockInStack(chain, [], 9, block), null);
});

test("loose blocks round trip through paths, removal and normalization", () => {
    const chain = addLooseBlock(stackChain([stackStep("end")]), stackStep("if", { conditions: [], steps: [stackStep("wait", { forMs: 100 })] }), 300.4, 220);
    assert.equal(chain.loose[0].x, 300);
    assert.equal(stepAtPath(chain, ["loose", 0, "branch", 0]).type, "wait");
    const edited = updateStepPath(chain, ["loose", 0, "branch", 0], (step) => ({ ...step, forMs: 700 }));
    assert.equal(edited.loose[0].step.steps[0].forMs, 700);
    assert.equal(removeStepPath(edited, ["loose", 0, "branch", 0]).loose[0].step.steps.length, 0);
    assert.equal("loose" in removeStepPath(chain, ["loose", 0]), false);
    const brain = normalizeAbilityStrategyConfiguration({ roots: [], chains: [{ ...edited, loose: [...edited.loose, { step: { type: "bogus" }, x: 1, y: 2 }, { step: { type: "end" }, x: -5, y: "nope" }] }] });
    assert.equal(brain.chains[0].loose.length, 2, "unknown types are dropped");
    assert.deepEqual([brain.chains[0].loose[1].x, brain.chains[0].loose[1].y], [0, 0]);
    assert.equal(brain.chains[0].loose[0].step.steps[0].forMs, 700);
    const plain = normalizeAbilityStrategyConfiguration({ roots: [], chains: [stackChain([stackStep("end")])] });
    assert.equal("loose" in plain.chains[0], false, "old chains are unchanged");
});

test("loose blocks count toward the chain limit and the brain budget, and are validated", () => {
    const chain = stackChain([stackStep("end"), stackStep("end")], [{ step: stackStep("if", { conditions: [], steps: [stackStep("end")] }), x: 1, y: 1 }]);
    assert.equal(countChainSteps(chain), 4);
    assert.equal(countSlots({ roots: [], chains: [chain] }), 4);
    assert.deepEqual(validateChains({ roots: [], chains: [chain] }, { actionHead: () => "ability" }), []);
    const bad = { roots: [], chains: [stackChain([], [{ step: { type: "wait", forMs: 150 }, x: 0, y: 0 }, { step: { type: "end" }, x: "a", y: 0 }])] };
    const errors = validateChains(bad, { actionHead: () => "ability" });
    assert.ok(errors.some((error) => /loose block 1/.test(error)) && errors.some((error) => /loose block 2 x/.test(error)), errors.join("|"));
    const full = stackChain(Array.from({ length: 31 }, () => stackStep("end")), [{ step: stackStep("end"), x: 0, y: 0 }, { step: stackStep("end"), x: 0, y: 0 }]);
    assert.ok(validateChains({ roots: [], chains: [full] }, { actionHead: () => "ability" }).some((error) => /33 steps/.test(error)));
});

test("action steps are fixed-duration only: a saved until is dropped by normalization", () => {
    const brain = normalizeAbilityStrategyConfiguration({ roots: [], chains: [{ id: "chain.a", name: "A", steps: [
        { type: "action", action: BOT_CODE_ACTIONS.MOVE_WALK, movementMode: "absolute", movementDirection: 90, untilConditions: [{ type: "always" }], maxMs: 2000 },
    ] }] });
    const [step] = brain.chains[0].steps;
    assert.equal(step.untilConditions, undefined);
    assert.equal(step.maxMs, undefined);
    assert.equal(typeof step.forMs, "number");
});
