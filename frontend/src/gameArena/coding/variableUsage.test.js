import assert from "node:assert/strict";
import test from "node:test";
import { collectVariableUses, removeVariableFromConfiguration, rewriteVariableActions } from "./variableUsage.js";

const VAR = "custom.dodge";
const OTHER = "custom.other";

const compare = (left, value = 3) => ({ type: "expression", left, comparator: "lt", right: { type: "number", value } });
const setVariable = (variableId, value = 1) => ({ action: "variable", variableId, terms: [{ operator: "add", operand: { type: "number", value } }] });
const readVariable = (variableId, readId) => ({ action: "variable", variableId, terms: [{ operator: "set", operand: { type: "variable", value: readId } }] });

function configuration() {
    return {
        customVariables: [
            { id: VAR, name: "Dodge count", valueType: "number", initialValue: 0 },
            { id: OTHER, name: "Other", valueType: "number", initialValue: 0 },
        ],
        roots: [{
            id: "root-1", name: "Defend", kind: "modify",
            branches: [{ id: "b1", conditions: [compare(VAR)], actions: [setVariable(VAR)], children: [] }],
        }],
        orphans: [
            { id: "orphan-1", kind: "conditional", conditions: [compare(VAR, 9)], actions: [{ action: "none" }], children: [] },
            { ...setVariable(VAR, 2), id: "orphan-action", kind: "action" },
        ],
        chains: [{
            id: "reset", name: "Reset",
            steps: [
                { type: "action", ...setVariable(OTHER) },
                {
                    type: "if", conditions: [compare(VAR, 5)],
                    steps: [{ type: "repeat", count: 2, steps: [{ type: "action", ...setVariable(VAR, 7) }] }],
                },
            ],
            loose: [{ x: 10, y: 20, step: { type: "action", ...readVariable(OTHER, VAR) } }],
        }],
    };
}

test("uses are found on roots, unconnected nodes and chains, including nested and loose blocks", () => {
    const uses = collectVariableUses(configuration(), VAR);
    const where = uses.map((use) => `${use.where}|${use.kind}`);
    assert.deepEqual(where, [
        'Root "Defend"|IF',
        'Root "Defend"|SET',
        "Unconnected|IF",
        "Unconnected|SET",
        'Chain "Reset"|STEP 2',
        'Chain "Reset"|STEP 3',
        'Chain "Reset"|LOOSE',
    ]);
    const nested = uses.find((use) => use.target.type === "step" && use.target.path.length === 5);
    assert.deepEqual(nested.target.path, [1, "branch", 0, "body", 0]);
    assert.equal(nested.target.chainId, "reset");
    const loose = uses.at(-1);
    assert.deepEqual(loose.target.path, ["loose", 0, 0]);
});

test("a variable only used inside a chain is counted", () => {
    const config = configuration();
    config.roots = [];
    config.orphans = [];
    assert.equal(collectVariableUses(config, VAR).length, 3);
    assert.equal(collectVariableUses(config, "custom.unused").length, 0);
});

test("node targets use the ids the canvas gives its nodes", () => {
    const [condition, action] = collectVariableUses(configuration(), VAR);
    assert.equal(condition.target.nodeId, "condition:b1:root:root-1");
    assert.equal(action.target.nodeId, "action:b1:0:root:root-1");
});

test("deleting a variable removes its uses from roots, unconnected nodes and chains", () => {
    const cleaned = removeVariableFromConfiguration(configuration(), VAR);
    assert.deepEqual(cleaned.customVariables.map((variable) => variable.id), [OTHER]);
    assert.equal(collectVariableUses(cleaned, VAR).length, 0);
    assert.equal(JSON.stringify(cleaned).includes(VAR), false);
    // The unrelated chain step survives; the one that wrote the variable is gone.
    const chain = cleaned.chains[0];
    assert.equal(chain.steps.filter((step) => step.type === "action").length, 1);
    assert.deepEqual(chain.steps[1].steps[0].steps, []);
    // The loose block only read the variable in an operand, so it stays with that operand reset.
    assert.deepEqual(chain.loose[0].step.terms[0].operand, { type: "number", value: 0 });
    // Unconnected action nodes that wrote the variable are removed; the conditional loses its condition.
    assert.deepEqual(cleaned.orphans.map((node) => node.id), ["orphan-1"]);
    assert.deepEqual(cleaned.orphans[0].conditions, []);
});

test("changing a variable's type rewrites its actions in chains and unconnected nodes", () => {
    const rewritten = rewriteVariableActions(configuration(), VAR, (entry) => ({ ...entry, value: false, terms: undefined }));
    assert.equal(rewritten.chains[0].steps[1].steps[0].steps[0].value, false);
    assert.equal(rewritten.orphans[1].value, false);
});
