import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_TYPES, SELECTABLE_TYPES } from "../../botlogic/code/BotCode.js";
import {
    actionSelectablePickerModel,
    encodeSelectableReplacement,
    measureActionNodeWidth,
    measureVariableActionExpressionWidth,
    resolveSelectableTarget,
    UNAVAILABLE_TARGET_LABEL,
} from "./actionNodePresentation.js";

const singularityTarget = SELECTABLE_TYPES.find((selectable) => selectable.id === "opponent_1_singularity_zone");
const availableTargets = SELECTABLE_TYPES.filter((selectable) => selectable.id !== singularityTarget.id);
const singAction = ACTION_TYPES.find((action) => action.id === 27);

test("Singularity entity action width follows its compact visible signature", () => {
    const target = resolveSelectableTarget(`${singularityTarget.id}:closest:1`, SELECTABLE_TYPES);
    const width = measureActionNodeWidth({
        actionLabel: singAction.label.replace(/^Ability:\s*/, ""),
        hasAbilityIcon: true,
        targetMode: "target",
        targetPresentation: target,
    });

    assert.equal(target.available, true);
    assert.equal(target.compactLabel, "O1");
    assert.match(target.description, /1st Closest Singularity by Opponent 1/);
    assert.ok(width <= 260, `expected a compact node width, got ${width}px`);
});

test("movement-to-entity action width includes only the visible angle, caption, and chips", () => {
    const target = resolveSelectableTarget(`${singularityTarget.id}:closest:1`, SELECTABLE_TYPES);
    const width = measureActionNodeWidth({
        actionLabel: "Walk",
        targetMode: "target",
        movement: true,
        movementDirection: 0,
        targetPresentation: target,
    });

    assert.ok(width <= 280, `expected movement to stay compact, got ${width}px`);
});

test("unavailable selectors use a human label and keep the stored value pending explicit replacement", () => {
    const staleValue = `${singularityTarget.id}:farthest:3`;
    const actionEntry = { action: singAction.id, selectable: staleValue };
    const model = actionSelectablePickerModel(actionEntry.selectable, availableTargets);
    const presentation = resolveSelectableTarget(staleValue, availableTargets);

    assert.equal(presentation.available, false);
    assert.equal(presentation.compactLabel, UNAVAILABLE_TARGET_LABEL);
    assert.equal(presentation.description, UNAVAILABLE_TARGET_LABEL);
    assert.doesNotMatch(presentation.description, /opponent_1_singularity_zone/);
    assert.equal(model.storedValue, staleValue);
    assert.equal(model.selectValue, "");
    assert.equal(model.statusLabel, UNAVAILABLE_TARGET_LABEL);
    assert.match(model.statusMessage, /unavailable in the current loadout or roster/);
    assert.equal(model.replacementPlaceholder, "Choose a replacement…");
    assert.ok(model.replacementOptions.length > 0);
    assert.ok(model.replacementOptions.every((option) => !option.label.includes(option.value)));
    assert.equal(actionEntry.selectable, staleValue);

    const selectedReplacement = model.replacementOptions.find((option) => option.kind === "entity");
    const encodedReplacement = encodeSelectableReplacement(selectedReplacement.value, availableTargets);
    const updatedEntry = { ...actionEntry, selectable: encodedReplacement };
    assert.equal(updatedEntry.selectable, `${selectedReplacement.value}:closest:1`);
    assert.equal(actionEntry.selectable, staleValue);
});

test("long visible labels, coordinates, angles, and variable expressions can expand action nodes", () => {
    const baseline = measureActionNodeWidth({ actionLabel: "Face" });
    const longCoordinates = measureActionNodeWidth({
        actionLabel: "Walk",
        targetMode: "coordinates",
        movement: true,
        movementDirection: -180,
        targetX: -99999,
        targetY: 99999,
    });
    const longAngle = measureActionNodeWidth({ actionLabel: "Set Facing Direction", targetMode: "angle", targetAngle: -360 });
    const expressionWidth = measureVariableActionExpressionWidth([
        { operator: "=", label: "Health Percentage", signatureWidth: 28 },
        { operator: "+", label: "Distance to Closest Singularity by Opponent 1", signatureWidth: 52 },
    ]);
    const variableAction = measureActionNodeWidth({ actionLabel: "Modify Custom Variable", variableExpressionWidth: expressionWidth });

    assert.ok(longCoordinates > baseline);
    assert.ok(longAngle > baseline);
    assert.ok(variableAction > baseline);
});
