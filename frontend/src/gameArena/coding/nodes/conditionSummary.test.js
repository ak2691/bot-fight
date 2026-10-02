import assert from "node:assert/strict";
import test from "node:test";
import { describeCondition } from "./conditionSummary.js";

const lookups = {
    variable: (id) => ({
        "selectable.distance": { label: "Distance", suffix: "u" },
        "bot.selectedAbilityReady": { label: "Ability Ready", supportsAbility: true },
    })[id],
    selectable: (id) => ({ my_bot: "My Bot", opponent_1: "Opponent 1" })[id] ?? id,
    ability: (id) => ({ 3: "Dash" })[id] ?? `Ability ${id}`,
};

test("condition rows read as sentences", () => {
    assert.equal(describeCondition({ type: "always" }, lookups), "Always");
    assert.equal(describeCondition({
        type: "expression", left: "selectable.distance", selectable1: "my_bot", selectable2: "opponent_1",
        comparator: "lte", right: { type: "number", value: 50 },
    }, lookups), "Distance (My Bot → Opponent 1) ≤ 50 u");
    assert.equal(describeCondition({
        type: "expression", left: "bot.selectedAbilityReady", leftSelectable: "my_bot", ability: 3,
        comparator: "eq", right: { type: "boolean", value: true },
    }, lookups), "Ability Ready (My Bot · Dash) = true");
});
