// Writes shared/brain-tests/{valid,invalid}/*.json: brains the editor, Spring and the sim-worker must classify the same way.
// Valid brains are built with the browser's own normalizer; invalid ones are one deliberate mutation each, and
// name the rule they break. "layer" says who rejects it: "schema" (brain.schema.json) or "rules" (brainRules.js,
// run by the sim-worker on a schema-valid brain). The server checks the schema; the worker checks both.
// Run: npm run fixtures:brain. Fixtures are committed; this script is how they are regenerated.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createExpressionCondition, normalizeAbilityStrategyConfiguration } from "../../shared/engine/botlogic/code/BotCode.js";
import { STATE_VARIABLES } from "../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../shared/brain-tests");
const V2 = "bot-logic-tree-v2";
const always = [{ type: "always" }];
const clone = (value) => JSON.parse(JSON.stringify(value));
// The editor fills a status effect in from the loadout; with none equipped the normalizer leaves null, so name one here.
const withStatusEffects = (value) => JSON.parse(JSON.stringify(value, (key, entry) => (key === "statusEffect" && entry === null ? "burn" : entry)));
const normalized = (configuration) => withStatusEffects(normalizeAbilityStrategyConfiguration(configuration));
const walk = { action: "move_walk", movementMode: "target", movementDirection: 0 };
const branch = (overrides = {}) => ({ id: "b1", priority: 1, branchType: "if", conditions: always, children: [], actions: [{ ...walk }], ...overrides });
const root = (branches = [branch()], overrides = {}) => ({ id: "root-1", name: "Root", priority: 1, branches, ...overrides });
const variable = (id = "custom.n", valueType = "number") => ({ id, name: id.slice(7).toUpperCase() || "V", valueType, initialValue: valueType === "number" ? 0 : false });
const withCondition = (condition) => ({ version: V2, loadout: { abilities: [] }, roots: [root([branch({ conditions: [condition] })])] });
const expression = (left, right, extra = {}) => ({ type: "expression", left, comparator: "lt", right, ...extra });
const chain = (steps, id = "chain.a") => ({ id, name: "A", steps });

const valid = {};
const invalid = {};

// ---- valid
valid["empty"] = ["A brain with no roots.", { version: V2, roots: [] }];
valid["walk-and-loadout"] = ["A root with a walk action and a full loadout of non-standard abilities.",
    { version: V2, loadout: { abilities: [1, 15, 3, 4, 5, 6, 8] }, roots: [root()] }];
valid["every-state-variable"] = ["One condition per state variable, as the editor creates them.",
    normalized({ version: V2, roots: [root(STATE_VARIABLES.map((entry, index) => branch({
        id: `b${index}`, priority: index + 1, branchType: "if",
        conditions: [createExpressionCondition(entry.id)], actions: [{ action: "none" }],
    })))] })];
valid["custom-variables-and-actions"] = ["Number and boolean custom variables, set by variable actions and read by conditions.", normalized({
    version: V2,
    customVariables: [variable("custom.count"), variable("custom.flag", "boolean")],
    roots: [root([branch({
        conditions: [expression("custom.count", { type: "number", value: 3 }), { type: "expression", left: "custom.flag", comparator: "eq", right: { type: "boolean", value: true } }],
        actions: [
            { action: "variable", variableId: "custom.count", terms: [{ operator: "set", operand: { type: "number", value: 1 } }, { operator: "add", operand: { type: "variable", value: "selectable.hp", selectable: "my_bot" } }] },
            { action: "variable", variableId: "custom.flag", value: true },
        ],
    })])],
})];
valid["chains-and-run-chain"] = ["Chains with every step type, run by a root action.", {
    version: V2, loadout: { abilities: [] },
    chains: [
        chain([
            { type: "action", action: "move_walk", movementMode: "target", movementDirection: 0, forMs: 300 },
            { type: "wait", forMs: 200 },
            { type: "if", conditions: always, steps: [{ type: "end" }] },
            { type: "elseIf", conditions: [], steps: [{ type: "runChain", chainId: "chain.b" }] },
            { type: "repeat", count: 3, steps: [{ type: "exitLoop" }] },
            { type: "repeat", whileConditions: always, maxMs: 500, steps: [{ type: "wait", forMs: 100 }] },
            { type: "wait", untilConditions: always, maxMs: 1000 },
        ]),
        { ...chain([{ type: "end" }], "chain.b"), loose: [{ x: 10, y: 20, step: { type: "end" } }] },
    ],
    roots: [root([branch({ actions: [{ action: "run_chain", chainId: "chain.a" }] })])],
}];
valid["orphans"] = ["Unconnected nodes: a conditional and an action.", {
    version: V2, loadout: { abilities: [] }, roots: [],
    orphans: [
        { id: "orphan-1", kind: "conditional", priority: 1, branchType: "if", conditions: always, children: [], actions: [{ action: "none" }], action: "none" },
        { id: "orphan-2", kind: "action", ...walk },
    ],
}];
valid["node-positions"] = ["Editor positions are bounded metadata.", { version: V2, roots: [], nodePositions: { "rootNode:root-1": { x: 10.5, y: 20 } } }];
valid["lead-aim"] = ["Lead aim on a rotation and on an ability.", normalized({
    version: V2, loadout: { abilities: [4] },
    roots: [root([branch({ actions: [
        { action: "rotate_toward_enemy", aim: "lead", leadSeconds: 0.5 },
        { action: 4, aim: "auto", leadAbilityId: 4 },
    ] })])],
})];
valid["negative-coordinates"] = ["Coordinates are centered: -600 to 600.", { version: V2, roots: [{ branches: [{
    action: "move_walk", movementMode: "coordinates", movementDirection: 0, targetMode: "coordinates", targetX: -600, targetY: 600, conditions: [] }] }] }];
valid["selectable-orders"] = ["Entity selectors with an order and ordinal.", normalized({
    version: V2, loadout: { abilities: [5] },
    roots: [root([branch({ conditions: [{ type: "expression", left: "selectable.count", comparator: "gt", right: { type: "number", value: 0 }, leftSelectable: "opponent_1_grenade" }, { type: "expression", left: "selectable.age", comparator: "gt", right: { type: "number", value: 1 }, leftSelectable: "my_bot_grenade:closest:2" }] })])],
})];

// ---- invalid
const base = () => clone(valid["walk-and-loadout"][1]);
function add(slug, rule, layer, brain) { invalid[slug] = [rule, layer, brain]; }
function mutated(change) { const brain = base(); change(brain); return brain; }

add("unknown-top-level-field", "Unknown fields are rejected everywhere (additionalProperties false).", "schema", mutated((b) => { b.extra = 1; }));
add("retired-blocks-field", "The retired blocks list is not part of a brain.", "schema", { version: V2, blocks: [], roots: [] });
add("retired-version", "Only bot-logic-tree-v2 brains are accepted.", "schema", { version: "bot-logic-tree-v1", roots: [] });
add("missing-roots", "roots is required.", "schema", { version: V2 });
add("unsupported-version", "version is one of the two brain schema versions.", "schema", { version: "bot-logic-tree-v9", roots: [] });
add("roots-over-limit", "At most 100 roots.", "schema", { version: V2, roots: Array.from({ length: 101 }, (_, index) => root([], { id: `r${index}`, priority: 1 })) });
add("root-name-too-long", "Root names are at most 25 characters.", "schema", mutated((b) => { b.roots[0].name = "x".repeat(26); }));
add("root-priority-zero", "Priorities are whole numbers from 1 to 100.", "schema", mutated((b) => { b.roots[0].priority = 0; }));
add("unknown-action-id", "Actions come from the closed action list.", "schema", mutated((b) => { b.roots[0].branches[0].actions[0].action = 9999; }));
add("smuggled-field-on-branch", "A branch carries only the fields of its action and branch contract.", "schema", mutated((b) => { b.roots[0].branches[0].script = "eval()"; }));
add("action-field-not-for-this-action", "targetMode is not a field of a plain ability action.", "schema", mutated((b) => { b.roots[0].branches[0].actions[0] = { action: 1, targetMode: "coordinates", targetX: 0, targetY: 0 }; }));
add("unknown-condition-variable", "Conditions read variables from the closed variable list.", "schema", { version: V2, roots: [root([branch({ conditions: [expression("selectable.notAVariable", { type: "number", value: 1 })] })])] });
add("number-above-variable-range", "A literal compared to selectable.hp is at most 300.", "schema", withCondition(expression("selectable.hp", { type: "number", value: 9999 }, { leftSelectable: "opponent_1" })));
add("negative-hp-literal", "A literal compared to selectable.hp is at least 0.", "schema", withCondition(expression("selectable.hp", { type: "number", value: -1 }, { leftSelectable: "opponent_1" })));
add("boolean-variable-with-less-than", "Boolean variables only compare with eq and neq.", "schema", withCondition({ type: "expression", left: "selectable.moving", comparator: "lt", right: { type: "boolean", value: true }, leftSelectable: "opponent_1" }));
add("or-join-on-condition", "Conditions are AND-only; join is not a field.", "schema", withCondition({ ...expression("match.elapsedSeconds", { type: "number", value: 5 }), join: "or" }));
add("in-view-arc-below-one", "An In View arc is 1 to 360 degrees.", "schema", withCondition({ type: "expression", left: "selectable.inView", comparator: "eq", right: { type: "boolean", value: true }, selectable1: "my_bot", selectable2: "opponent_1", viewArc: 0 }));
add("selectable-not-allowed", "Selectors come from the closed selectable list.", "schema", withCondition(expression("selectable.hp", { type: "number", value: 5 }, { leftSelectable: "defender_core" })));
add("bot-variable-with-entity-selectable", "bot.* variables need a bot selector, not an ability entity.", "schema", withCondition({ type: "expression", left: "bot.anyAbilityPreparing", comparator: "eq", right: { type: "boolean", value: true }, leftSelectable: "my_bot_grenade" }));
add("ability-variable-without-ability", "Selected-ability variables must name an ability.", "schema", withCondition({ type: "expression", left: "bot.selectedAbilityReady", comparator: "eq", right: { type: "boolean", value: true }, leftSelectable: "my_bot" }));
add("charges-variable-for-ability-without-charges", "bot.selectedAbilityCharges needs an ability that has charges.", "schema", withCondition({ type: "expression", left: "bot.selectedAbilityCharges", comparator: "gt", right: { type: "number", value: 0 }, leftSelectable: "my_bot", ability: 1 }));
add("status-effect-not-allowed", "Status variables name an allowed status effect.", "schema", withCondition({ type: "expression", left: "bot.selectedStatusEffectActive", comparator: "eq", right: { type: "boolean", value: true }, leftSelectable: "my_bot", statusEffect: "frozen-solid" }));
add("coordinate-out-of-range", "Coordinates are at most 600.", "schema", { version: V2, roots: [{ branches: [{
    action: "move_walk", movementMode: "coordinates", movementDirection: 0, targetMode: "coordinates", targetX: 601, targetY: 0, conditions: [] }] }] });
add("movement-direction-over-360", "Movement directions are -360 to 360 degrees.", "schema", mutated((b) => { b.roots[0].branches[0].actions[0].movementDirection = 361; }));
add("loadout-standard-ability", "Standard abilities are granted by the server, not listed in a loadout.", "schema", mutated((b) => { b.loadout.abilities = [19]; }));
add("loadout-duplicate-ability", "Loadout abilities are unique.", "schema", mutated((b) => { b.loadout.abilities = [1, 1]; }));
add("loadout-over-seven", "A loadout holds at most seven abilities.", "schema", mutated((b) => { b.loadout.abilities = [1, 3, 4, 5, 6, 8, 15, 17]; }));
add("custom-variable-bad-name", "Custom variable names start with a letter.", "schema", { version: V2, customVariables: [{ id: "custom.a", name: "1bad", valueType: "number", initialValue: 0 }], roots: [] });
add("custom-variable-wrong-initial-type", "A number variable starts at a number.", "schema", { version: V2, customVariables: [{ id: "custom.a", name: "A", valueType: "number", initialValue: true }], roots: [] });
add("custom-variable-retired-conditions", "Custom variables no longer carry conditions.", "schema", { version: V2, customVariables: [{ id: "custom.a", name: "A", valueType: "number", initialValue: 0, conditions: [] }], roots: [] });
add("node-position-out-of-range", "Editor positions are 0 to 1,000,000.", "schema", { version: V2, roots: [], nodePositions: { n: { x: 2000000, y: 0 } } });
add("chain-bad-id", "Chain ids look like chain.name.", "schema", { version: V2, roots: [], chains: [{ id: "Bad Id", name: "x", steps: [] }] });
add("chain-unknown-step-type", "Chain steps come from the closed step list.", "schema", { version: V2, roots: [], chains: [chain([{ type: "teleport" }])] });
add("chain-wait-not-multiple-of-100", "Timed steps are whole ticks of 100 ms.", "schema", { version: V2, roots: [], chains: [chain([{ type: "wait", forMs: 150 }])] });
add("chain-repeat-count-zero", "Repeat counts are 1 to 20.", "schema", { version: V2, roots: [], chains: [chain([{ type: "repeat", count: 0, steps: [] }])] });
add("chain-step-runs-chain-control", "A chain cannot run chain-control or N/A actions.", "schema", { version: V2, roots: [], chains: [chain([{ type: "action", action: "run_chain", chainId: "chain.a" }])] });
add("chain-step-list-over-32", "A step list holds at most 32 steps.", "schema", { version: V2, roots: [], chains: [chain(Array.from({ length: 33 }, () => ({ type: "end" })))] });
add("chains-over-16", "At most 16 chains.", "schema", { version: V2, roots: [], chains: Array.from({ length: 17 }, (_, index) => chain([], `chain.c${index}`)) });
add("orphan-unknown-kind", "Orphans are conditional or action nodes.", "schema", { version: V2, roots: [], orphans: [{ id: "a", kind: "other" }] });
add("orphan-action-with-children", "An orphan action cannot contain a subtree.", "schema", { version: V2, roots: [], orphans: [{ id: "a", kind: "action", ...walk, children: [] }] });
add("lead-aim-auto-without-ability", "aim auto needs a leadAbilityId.", "schema", mutated((b) => { b.roots[0].branches[0].actions[0] = { action: "rotate_toward_enemy", aim: "auto" }; }));
add("lead-seconds-over-2", "Lead time is 0 to 2 seconds.", "schema", mutated((b) => { b.roots[0].branches[0].actions[0] = { action: "rotate_toward_enemy", aim: "lead", leadSeconds: 3 }; }));
add("variable-action-without-value", "A variable action sets a value, an operand or terms.", "schema", { version: V2, customVariables: [variable()], roots: [root([branch({ actions: [{ action: "variable", variableId: "custom.n" }] })])] });

add("action-uses-unequipped-ability", "An ability action needs the ability in the loadout.", "rules", mutated((b) => { b.loadout.abilities = [1]; b.roots[0].branches[0].actions[0] = { action: 3, selectable: "opponent_1" }; }));
add("condition-reads-unknown-custom-variable", "Conditions only read declared custom variables.", "rules", withCondition(expression("custom.ghost", { type: "number", value: 1 })));
add("boolean-custom-variable-compared-to-number", "A custom variable is compared with its own type.", "rules", {
    version: V2, customVariables: [variable("custom.flag", "boolean")], roots: [root([branch({ conditions: [expression("custom.flag", { type: "number", value: 1 })] })])] });
add("variable-action-on-unknown-variable", "Variable actions write declared custom variables.", "rules", { version: V2, roots: [root([branch({ actions: [{ action: "variable", variableId: "custom.ghost", value: true }] })])] });
add("duplicate-chain-ids", "Chain ids are unique.", "rules", { version: V2, roots: [], chains: [chain([]), chain([])] });
add("run-chain-to-missing-chain", "Run chain names an existing chain.", "rules", { version: V2, roots: [root([branch({ actions: [{ action: "run_chain", chainId: "chain.nope" }] })])] });
add("chain-call-cycle", "Chains cannot call each other in a cycle.", "rules", { version: V2, roots: [], chains: [chain([{ type: "runChain", chainId: "chain.b" }]), chain([{ type: "runChain", chainId: "chain.a" }], "chain.b")] });
add("chain-loops-nested-three-deep", "Loops nest at most twice.", "rules", { version: V2, roots: [], chains: [chain([{ type: "repeat", count: 1, steps: [{ type: "repeat", count: 1, steps: [{ type: "repeat", count: 1, steps: [] }] }] }])] });
add("else-branch-not-last", "An else branch is the last sibling.", "rules", { version: V2, roots: [root([branch(), branch({ id: "b2", branchType: "else", conditions: [] }), branch({ id: "b3", priority: 2 })])] });
add("first-sibling-is-else", "The first sibling is an if.", "rules", { version: V2, roots: [root([branch({ branchType: "else", conditions: [] })])] });
add("duplicate-custom-variable-id", "Custom variable ids are unique.", "rules", { version: V2, customVariables: [variable(), variable()], roots: [] });
add("two-movement-actions-in-one-block", "A block has one action per execution category.", "rules", { version: V2, roots: [root([branch({ actions: [{ ...walk }, { ...walk, movementDirection: 90 }] })])] });
add("tree-nested-too-deep", "Branches nest at most 40 levels.", "rules", (() => {
    let node = branch({ id: "leaf", conditions: [] });
    for (let depth = 0; depth < 45; depth += 1) node = branch({ id: `n${depth}`, conditions: [], children: [node] });
    return { version: V2, roots: [root([node])] };
})());
add("too-many-conditions", "At most 300 conditions in the whole brain.", "rules", { version: V2, roots: [root(Array.from({ length: 4 }, (_, index) => branch({ id: `b${index}`, priority: index + 1, conditions: Array.from({ length: 80 }, () => ({ type: "always" })) })))] });

// ---- puzzle rules and authored puzzle brain constraints
const puzzleVariable = { id: "custom.puzzle.count", name: "Puzzle count", valueType: "number", initialValue: 0 };
const puzzleBranch = (overrides = {}) => ({ id: "p1", priority: 1, branchType: "if", conditions: clone(always), children: [], ...overrides });
const puzzleRoot = (kind = "win", branches = [puzzleBranch()]) => ({ id: "puzzle", priority: 1, kind, branches });
const puzzle = () => ({ version: V2, customVariables: [clone(puzzleVariable)], roots: [puzzleRoot()] });
const puzzleOptions = { puzzleRules: true };
valid["puzzle-win-lose-modify"] = ["Flat puzzle outcomes and a declared puzzle variable modification.", {
    ...puzzle(), roots: [puzzleRoot(), puzzleRoot("lose"), puzzleRoot("modify", [puzzleBranch({ actions: [
        { action: "variable", variableId: puzzleVariable.id, value: 1 },
    ] })])],
}, puzzleOptions];
valid["puzzle-budget-boundary"] = ["Puzzle brains fit their authored action, condition, variable and loadout budgets.", {
    version: V2, roots: [root()], loadout: { abilities: [] }, customVariables: [variable()],
}, { puzzleConstraints: { maxActionNodes: 1, maxConditionNodes: 1, maxCustomVariables: 1, reservePuzzleNamespace: true } }];
function invalidPuzzle(slug, rule, change) {
    const brain = puzzle(); change(brain);
    invalid[slug] = [rule, "rules", brain, puzzleOptions];
}
invalidPuzzle("puzzle-variable-outside-namespace", "Puzzle rule variables use custom.puzzle.*.", (b) => { b.customVariables = [variable()]; });
invalidPuzzle("puzzle-missing-variable-list", "Puzzle rules declare the customVariables array.", (b) => { delete b.customVariables; });
invalidPuzzle("puzzle-unknown-root-kind", "Puzzle root kinds are win, lose and modify.", (b) => { b.roots.push(puzzleRoot("unknown")); });
invalidPuzzle("puzzle-missing-win-root", "Puzzle rules include at least one win root.", (b) => { b.roots[0].kind = "lose"; });
invalidPuzzle("puzzle-root-without-branches", "Puzzle roots contain a conditional.", (b) => { b.roots[0].branches = []; });
invalidPuzzle("puzzle-branch-without-conditions", "Puzzle branches contain a condition.", (b) => { b.roots[0].branches[0].conditions = []; });
invalidPuzzle("puzzle-nested-children", "Puzzle rule branches are flat.", (b) => { b.roots[0].branches[0].children = [branch({ actions: [{ action: "none" }] })]; });
invalidPuzzle("puzzle-win-with-actions", "Win and lose branches run no actions.", (b) => { b.roots[0].branches[0].actions = [walk]; });
invalidPuzzle("puzzle-win-with-legacy-action", "A legacy action field cannot bypass the no-actions rule.", (b) => { b.roots[0].branches[0].action = "move_walk"; });
invalidPuzzle("puzzle-modify-without-action", "Modify branches have exactly one variable action.", (b) => { b.roots.push(puzzleRoot("modify")); });
invalidPuzzle("puzzle-modify-with-multiple-actions", "Modify branches have exactly one variable action.", (b) => { b.roots.push(puzzleRoot("modify", [puzzleBranch({ actions: [
    { action: "variable", variableId: puzzleVariable.id, value: 1 }, { action: "variable", variableId: puzzleVariable.id, value: 2 },
] })])); });
invalidPuzzle("puzzle-modify-with-combat-action", "Modify branches only write custom variables.", (b) => { b.roots.push(puzzleRoot("modify", [puzzleBranch({ actions: [walk] })])); });
invalidPuzzle("puzzle-total-action-budget", "Puzzle outcome actions share the 100 action slot limit.", (b) => {
    b.roots.push(...Array.from({ length: 51 }, () => puzzleRoot("modify", [puzzleBranch({ actions: [
        { action: "variable", variableId: puzzleVariable.id, terms: [
            { operator: "set", operand: { type: "number", value: 1 } }, { operator: "add", operand: { type: "number", value: 1 } },
        ] },
    ] })])));
});
invalidPuzzle("puzzle-payload-too-large", "Puzzle outcome JSON is bounded to 250000 UTF-8 bytes.", (b) => {
    b.nodePositions = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`${i}`.padEnd(200, "x"), { x: 1000000, y: 1000000 }]));
    b.roots = Array.from({ length: 100 }, (_, i) => ({ ...puzzleRoot(), id: `${i}`.padEnd(160, "r"), name: "Root".padEnd(25, "x"),
        branches: [puzzleBranch({ id: `${i}`.padEnd(160, "b"), conditions: [
            { type: "always", selectable: "my_bot_grenade:closest:100" }, { type: "always" }, { type: "always" },
        ] })],
    }));
});
for (const [slug, constraints, brain] of [
    ["puzzle-bot-action-budget", { maxActionNodes: 0 }, { version: V2, roots: [root()] }],
    ["puzzle-bot-condition-budget", { maxConditionNodes: 0 }, { version: V2, roots: [root()] }],
    ["puzzle-bot-variable-budget", { maxCustomVariables: 0 }, { version: V2, roots: [], customVariables: [variable()] }],
    ["puzzle-bot-loadout-budget", { maxLoadoutAbilities: 6 }, base()],
    ["puzzle-bot-reserved-variable-namespace", { reservePuzzleNamespace: true }, { version: V2, roots: [], customVariables: [puzzleVariable] }],
]) {
    invalid[slug] = ["Puzzle brains obey authored budgets and reserve the puzzle namespace for outcome rules.", "rules", brain, { puzzleConstraints: constraints }];
}

// ---- write
function writeAll(directory, entries, shape) {
    mkdirSync(directory, { recursive: true });
    for (const name of readdirSync(directory)) rmSync(resolve(directory, name));
    for (const [slug, entry] of Object.entries(entries)) {
        writeFileSync(resolve(directory, `${slug}.json`), `${JSON.stringify(shape(entry), null, 2)}\n`);
    }
}
writeAll(resolve(ROOT, "valid"), valid, ([description, brain, options]) => ({ description, brain, ...(options ? { options } : {}) }));
writeAll(resolve(ROOT, "invalid"), invalid, ([rule, layer, brain, options]) => ({ rule, layer, brain, ...(options ? { options } : {}) }));
console.log(`wrote ${Object.keys(valid).length} valid and ${Object.keys(invalid).length} invalid brains to ${ROOT}`);
