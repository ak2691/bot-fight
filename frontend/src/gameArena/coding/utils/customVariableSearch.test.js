import assert from "node:assert/strict";
import test from "node:test";
import { filterCustomVariableEntries } from "./customVariableSearch.js";

const variables = [
    { id: "custom.health", name: "Health Threshold", initialValue: 50 },
    { id: "custom.energy", name: "Energy", initialValue: 10 },
    { id: "custom.heal", name: "Heal Ready", initialValue: true },
];

const names = (entries) => entries.map(({ variable }) => variable.name);

test("custom variable search matches names case-insensitively and preserves order", () => {
    assert.deepEqual(names(filterCustomVariableEntries(variables, "  THRESH  ")), ["Health Threshold"]);
    assert.deepEqual(names(filterCustomVariableEntries(variables, "hea")), ["Health Threshold", "Heal Ready"]);
});

test("empty and whitespace-only custom variable searches restore every entry", () => {
    assert.deepEqual(names(filterCustomVariableEntries(variables, "")), names(filterCustomVariableEntries(variables, " \t ")));
    assert.deepEqual(names(filterCustomVariableEntries(variables, " \t ")), names(filterCustomVariableEntries(variables, "")));
});

test("custom variable search returns no entries for a missing name and keeps edited data intact", () => {
    const editedVariables = variables.map((variable) => variable.id === "custom.energy" ? { ...variable, name: "Energy Reserve", initialValue: 25 } : variable);
    assert.deepEqual(filterCustomVariableEntries(editedVariables, "missing"), []);
    assert.deepEqual(names(filterCustomVariableEntries(editedVariables, "")), ["Health Threshold", "Energy Reserve", "Heal Ready"]);
    assert.equal(filterCustomVariableEntries(editedVariables, "")[1].variable.initialValue, 25);
});
