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
        roots: [
            {
                id: "root-1", name: "Defend",
                branches: [{ id: "b1", conditions: [compare(VAR)], actions: [setVariable(VAR)], children: [] }],
            },
            {
                id: "root-2", name: "",
                branches: [{ id: "b2", conditions: [compare(OTHER)], actions: [readVariable(OTHER, VAR)], children: [
                    { id: "b3", conditions: [compare(VAR, 9)], actions: [{ action: "none" }], children: [] },
                ] }],
            },
        ],
    };
}

test("uses are found on every root, including nested conditionals", () => {
    const uses = collectVariableUses(configuration(), VAR);
    assert.deepEqual(uses.map((use) => `${use.where}|${use.kind}`), [
        'Root "Defend"|IF',
        'Root "Defend"|SET',
        'Root "Root 2"|SET',
        'Root "Root 2"|IF',
    ]);
});

test("node targets use the ids the canvas gives its nodes", () => {
    const [condition, action] = collectVariableUses(configuration(), VAR);
    assert.equal(condition.target.nodeId, "condition:b1:root:root-1");
    assert.equal(action.target.nodeId, "action:b1:0:root:root-1");
});

test("deleting a variable removes its actions and conditions everywhere", () => {
    const cleaned = removeVariableFromConfiguration(configuration(), VAR);
    assert.deepEqual(cleaned.customVariables.map((variable) => variable.id), [OTHER]);
    assert.equal(collectVariableUses(cleaned, VAR).length, 0);
    assert.equal(JSON.stringify(cleaned).includes(VAR), false);
    // The read of the variable in the other root's action is reset to 0, so nothing dangles.
    assert.deepEqual(cleaned.roots[1].branches[0].actions[0].terms[0].operand, { type: "number", value: 0 });
    assert.deepEqual(cleaned.roots[1].branches[0].children[0].conditions, []);
});

test("changing a variable's type rewrites its actions in every root", () => {
    const rewritten = rewriteVariableActions(configuration(), VAR, (entry) => ({ ...entry, value: false, terms: undefined }));
    assert.equal(rewritten.roots[0].branches[0].actions[0].value, false);
});
