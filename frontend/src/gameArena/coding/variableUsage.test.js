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
            { ...readVariable(OTHER, VAR), id: "orphan-reader", kind: "action" },
        ],
    };
}

test("uses are found on roots and unconnected nodes", () => {
    const uses = collectVariableUses(configuration(), VAR);
    const where = uses.map((use) => `${use.where}|${use.kind}`);
    assert.deepEqual(where, [
        'Root "Defend"|IF',
        'Root "Defend"|SET',
        "Unconnected|IF",
        "Unconnected|SET",
        "Unconnected|SET",
    ]);
});

test("node targets use the ids the canvas gives its nodes", () => {
    const [condition, action] = collectVariableUses(configuration(), VAR);
    assert.equal(condition.target.nodeId, "condition:b1:root:root-1");
    assert.equal(action.target.nodeId, "action:b1:0:root:root-1");
});

test("deleting a variable removes its uses from roots and unconnected nodes", () => {
    const cleaned = removeVariableFromConfiguration(configuration(), VAR);
    assert.deepEqual(cleaned.customVariables.map((variable) => variable.id), [OTHER]);
    assert.equal(collectVariableUses(cleaned, VAR).length, 0);
    assert.equal(JSON.stringify(cleaned).includes(VAR), false);
    // Unconnected action nodes that wrote the variable are removed; the conditional loses its condition.
    assert.deepEqual(cleaned.orphans.map((node) => node.id), ["orphan-1", "orphan-reader"]);
    assert.deepEqual(cleaned.orphans[0].conditions, []);
    // The node that only read the variable in an operand stays, with that operand reset.
    assert.deepEqual(cleaned.orphans[1].terms[0].operand, { type: "number", value: 0 });
});

test("changing a variable's type rewrites its actions in unconnected nodes", () => {
    const rewritten = rewriteVariableActions(configuration(), VAR, (entry) => ({ ...entry, value: false, terms: undefined }));
    assert.equal(rewritten.orphans[1].value, false);
});
