import assert from "node:assert/strict";
import test from "node:test";
import {
    createDefaultAbilityStrategyConfiguration,
    createExpressionCondition,
    createCodeRoot,
    countConditionSlots,
    countActionSlots,
    inspectAbilityStrategyConditions,
    normalizeConditionSelections,
    normalizeConditions,
    normalizeAbilityStrategyConfiguration,
    normalizeRoots,
    setLogicBranchPriority,
    selectAbilityStrategyActionPlan as selectAbilityStrategyActionPlanNormalized,
    setLogicRootPriority,
    validateAbilityStrategyConfiguration,
} from "../../../../../../shared/engine/botlogic/code/BotCode.js";
import { getTutorialScenario, hasTutorialPriorityOrder, TUTORIAL_STEP_COUNT } from "../../../../tutorial/TutorialPresets.js";
import { ABILITY_TAGS, ACTION_TYPES, STATE_VARIABLES, SELECTABLE_DEPENDENCIES, SELECTABLE_IDENTITIES, SELECTABLE_TYPES, TARGET_MODES, VARIABLE_TAGS, VARIABLE_SELECTABLE_TYPES, VISIBLE_STATE_VARIABLES, abilityDefinitionsForVariable, selectableIdentitiesForVariable, selectableMatchesVariable, variableHasTag } from "../../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { ALL_ABILITY_DEFINITIONS, statusEffectDefinitionsForAbilities } from "../../../../../../shared/engine/loadout/BotLoadout.js";
import { compareAngleValues, evaluateConditionNodes } from "../../../../../../shared/engine/botlogic/code/runtime/conditionEvaluator.js";
import { matchingStrategySelectables } from "../../../../../../shared/engine/botlogic/code/runtime/targeting.js";
import { movementAngle, normalizeRelativeMovementDegrees, relativeMovementVector, vectorToCompassDegrees } from "../../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { buildDeterministicLogicAction as buildDeterministicLogicActionNormalized } from "../../../../../../shared/engine/botlogic/planner/ArenaActionPlanner.js";
import { nodePositionsForGraph, offsetsForGraphPositions } from "../../../../../../shared/engine/botlogic/code/configuration/nodePositions.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../../../../../shared/engine/botlogic/code/BotCode.js";

// The engine takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const selectAbilityStrategyActionPlan = (configuration, ...rest) => selectAbilityStrategyActionPlanNormalized(normalizeBrainForTick(configuration), ...rest);
const buildDeterministicLogicAction = (configuration, ...rest) => buildDeterministicLogicActionNormalized(normalizeBrainForTick(configuration), ...rest);

function payload(overrides = {}) {
    return {
        playerModel: { x: 400, y: 400, hp: 100, abilities: ["slash", "gun"], ...overrides.playerModel },
        closingZone: overrides.closingZone ?? null,
        objects: overrides.objects ?? [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 180 }],
    };
}

test("conditions are AND-only and legacy OR joins are ignored", () => {
    const condition = (value, join = undefined) => ({ type: "expression", value, ...(join ? { join } : {}) });
    const evaluate = (values) => evaluateConditionNodes(values, null, (entry) => entry.value);

    assert.equal(evaluate([]), true);
    assert.equal(evaluate([condition(true), condition(true)]), true);
    assert.equal(evaluate([condition(true), condition(false)]), false);
    assert.equal(evaluate([condition(false), condition(true, "or")]), false);
    const normalized = normalizeConditions([
        { type: "always" },
        { type: "always", join: "or" },
    ]);
    assert.equal(normalized.some((entry) => "join" in entry), false);
});

const SELECTABLE_IDENTITY_MATRIX = Object.freeze({
    "selectable.distance": [[], []],
    "selectable.hp": [[]],
    "selectable.damageTakenLastTick": [[]],
    "selectable.hpNetChangeLastTick": [[]],
    "selectable.x": [[]],
    "selectable.y": [[]],
    "selectable.alive": [[]],
    "selectable.movementDirection": [[]],
    "selectable.speed": [[]],
    "selectable.approachAngle": [[], []],
    "selectable.moving": [[]],
    "bot.anyAbilityPreparing": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.stamina": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.sprinting": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.fastTurning": [[SELECTABLE_IDENTITIES.BOT]],
    "selectable.inView": [[SELECTABLE_IDENTITIES.FACING], []],
    "selectable.facing": [[SELECTABLE_IDENTITIES.FACING]],
    "selectable.count": [[SELECTABLE_IDENTITIES.ABILITY_ENTITY]],
    "selectable.age": [[SELECTABLE_IDENTITIES.ABILITY_ENTITY]],
    "selectable.edgeDistance": [[]],
    "selectable.dangerZoneEdgeDistance": [[]],
    "selectable.exists": [[SELECTABLE_IDENTITIES.ABILITY_ENTITY]],
    "bot.selectedAbilityReady": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityActive": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityOnCooldown": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityActiveMs": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityBaseRange": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilitySinceHit": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityCooldownMs": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityCharges": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityPreparing": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedAbilityPreparationMs": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedStatusEffectActive": [[SELECTABLE_IDENTITIES.BOT]],
    "bot.selectedStatusEffectDurationMs": [[SELECTABLE_IDENTITIES.BOT]],
});

test("bot-code targets and action capabilities are derived from gameplay contracts", () => {
    const entityAbilities = ALL_ABILITY_DEFINITIONS.filter((ability) => ability.entityType);
    for (const ability of entityAbilities) {
        assert.equal(SELECTABLE_TYPES.some((target) => target.abilityId === ability.id), true);
    }
    assert.equal(ACTION_TYPES.find((action) => action.id === 22)?.locationTarget, true);
    assert.equal(ACTION_TYPES.find((action) => action.id === 25)?.orientationConfig, true);
    assert.equal(SELECTABLE_TYPES.some((target) => target.id === "opponent_1_singularity_zone"), true);
    assert.equal(SELECTABLE_TYPES.some((target) => target.id === "my_bot_singularity_zone"), true);
    assert.equal(SELECTABLE_TYPES.some((target) => target.id === "singularity_zone"), false);
    assert.equal(SELECTABLE_TYPES.find((target) => target.id === "opponent_1_grenade")?.selectableIdentities.includes(SELECTABLE_IDENTITIES.HEALTH), false);
    assert.equal(SELECTABLE_TYPES.find((target) => target.id === "opponent_1_hunter_drone")?.selectableIdentities.includes(SELECTABLE_IDENTITIES.HEALTH), true);
    assert.equal(SELECTABLE_TYPES.find((target) => target.id === "opponent_1_hunter_drone")?.selectableIdentities.includes(SELECTABLE_IDENTITIES.FACING), true);
    assert.equal(ACTION_TYPES.find((action) => action.id === "rotate_toward_enemy")?.angleTarget, true);
});

test("browser selectable inputs enforce the complete conditional identity matrix", () => {
    const selectableVariables = STATE_VARIABLES.filter((variable) => variable.supportsSelectable);
    assert.deepEqual(new Set(selectableVariables.map((variable) => variable.id)), new Set(Object.keys(SELECTABLE_IDENTITY_MATRIX)));

    for (const variable of selectableVariables) {
        const expectedSlots = SELECTABLE_IDENTITY_MATRIX[variable.id];
        if (variable.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
            assert.equal(expectedSlots.length, 2, `${variable.id} should expose two entity slots`);
            assert.deepEqual(selectableIdentitiesForVariable(variable, 0), expectedSlots[0]);
            assert.deepEqual(selectableIdentitiesForVariable(variable, 1), expectedSlots[1]);
        } else {
            assert.equal(expectedSlots.length, 1, `${variable.id} should expose one entity slot`);
            assert.deepEqual(selectableIdentitiesForVariable(variable), expectedSlots[0]);
        }

        for (const selectable of SELECTABLE_TYPES) {
            const slots = variable.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR ? [0, 1] : [null];
            for (const slot of slots) {
                const required = slot == null ? expectedSlots[0] : expectedSlots[slot];
                const expected = required.every((identity) => selectable.selectableIdentities.includes(identity));
                assert.equal(
                    selectableMatchesVariable(selectable, variable, slot),
                    expected,
                    `${variable.id} selector ${slot ?? "single"} mismatched for ${selectable.id}`,
                );
            }
        }
    }

    const selectable = (id) => SELECTABLE_TYPES.find((candidate) => candidate.id === id);
    const inView = STATE_VARIABLES.find((variable) => variable.id === "selectable.inView");
    const count = STATE_VARIABLES.find((variable) => variable.id === "selectable.count");
    const botAbility = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActive");
    assert.equal(selectableMatchesVariable(selectable("my_bot"), inView, 0), true);
    assert.equal(selectableMatchesVariable(selectable("opponent_1_hunter_drone"), inView, 0), true);
    assert.equal(selectableMatchesVariable(selectable("opponent_1_grenade"), inView, 0), false);
    assert.equal(selectableMatchesVariable(selectable("opponent_1_grenade"), inView, 1), true);
    assert.equal(selectableMatchesVariable(selectable("opponent_1_grenade"), count), true);
    assert.equal(selectableMatchesVariable(selectable("opponent_1"), count), false);
    assert.equal(selectableMatchesVariable(selectable("opponent_1"), botAbility), true);
    assert.equal(selectableMatchesVariable(selectable("opponent_1_grenade"), botAbility), false);
});

test("condition normalization emits canonical server variable ids", () => {
    const retired = normalizeConditions([{
        type: "expression",
        left: "opponent.hp",
        comparator: "lte",
        right: { type: "number", value: 0 },
    }])[0];
    const displayName = normalizeConditions([{
        type: "expression",
        left: "Match Time",
        comparator: "lt",
        right: { type: "number", value: 5 },
    }])[0];
    const current = normalizeConditions([{
        type: "expression",
        left: "selectable.hp",
        leftSelectable: "opponent",
        comparator: "lte",
        right: { type: "number", value: 0 },
    }])[0];

    assert.equal(retired.left, "match.elapsedSeconds");
    assert.equal(displayName.left, "match.elapsedSeconds");
    assert.equal(current.left, "selectable.hp");
    assert.equal(current.leftSelectable, "opponent_1");
});

test("target health metrics resolve zero for targets without health", () => {
    const hp = STATE_VARIABLES.find((variable) => variable.id === "selectable.hp");
    const netChange = STATE_VARIABLES.find((variable) => variable.id === "selectable.hpNetChangeLastTick");
    assert.equal(hp.selectableCapability, undefined);
    assert.equal(netChange.tags.includes(VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER), true);

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: hp.id,
            selectable: "opponent_grenade",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].leftSelectable, "opponent_1_grenade");
});

test("selectable distance defaults to My Bot and Opponent and supports custom pairs", () => {
    const distance = STATE_VARIABLES.find((variable) => variable.id === "selectable.distance");
    assert.equal(distance.selectableType, VARIABLE_SELECTABLE_TYPES.PAIR);
    assert.equal(distance.selectableSelectorLabels, undefined);
    assert.deepEqual(selectableIdentitiesForVariable(distance, 0), []);
    assert.deepEqual(selectableIdentitiesForVariable(distance, 1), []);
    assert.deepEqual(distance.targetModes, [TARGET_MODES.TARGET, TARGET_MODES.COORDINATES]);
    const defaultCondition = createExpressionCondition(distance);
    assert.deepEqual([defaultCondition.selectable1, defaultCondition.selectable2], ["my_bot", "opponent_1"]);
    assert.equal(defaultCondition.targetMode, TARGET_MODES.TARGET);

    const configuration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: distance.id,
            selectable1: "my_bot",
            selectable2: "opponent_hunter_drone",
            comparator: "lt",
            right: { type: "number", value: 150 },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { x: 100, y: 100 },
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 900, y: 700, hp: 100 },
            { id: "drone-1", type: "hunterDrone", abilityId: 17, ownerId: "opponent-model", x: 200, y: 100, hp: 30 },
        ],
    })).primary.id, "root-1-1-1");

    const coordinateConfiguration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: distance.id,
            selectable1: "my_bot",
            targetMode: TARGET_MODES.COORDINATES,
            targetX: -450,
            targetY: 500,
            comparator: "eq",
            right: { type: "number", value: 50 },
        }], actions: [{ action: "slash" }] }] }],
    };
    const normalizedCoordinate = normalizeAbilityStrategyConfiguration(coordinateConfiguration);
    const coordinateCondition = normalizedCoordinate.roots[0].branches[0].conditions[0];
    assert.equal(coordinateCondition.targetMode, TARGET_MODES.COORDINATES);
    assert.equal(coordinateCondition.targetX, -450);
    assert.equal(coordinateCondition.targetY, 500);
    assert.equal(selectAbilityStrategyActionPlan(coordinateConfiguration, payload({
        playerModel: { x: 100, y: 100 },
        objects: [],
    })).primary.id, "root-1-1-1");
});

test("In View conditionals use the configured From and To pair", () => {
    const inView = STATE_VARIABLES.find((variable) => variable.id === "selectable.inView");
    assert.equal(inView.valueType, "boolean");
    assert.equal(inView.selectableType, VARIABLE_SELECTABLE_TYPES.PAIR);
    assert.deepEqual(inView.selectableSelectorLabels, ["From", "To"]);
    assert.deepEqual(inView.targetModes, [TARGET_MODES.TARGET, TARGET_MODES.COORDINATES]);
    assert.deepEqual(selectableIdentitiesForVariable(inView, 0), [SELECTABLE_IDENTITIES.FACING]);
    assert.deepEqual(selectableIdentitiesForVariable(inView, 1), []);
    // Angle To and Direction To are gone from the contract, so no variable carries their ids.
    assert.equal(STATE_VARIABLES.some((variable) => /selectable.(relative|absolute)Bearing$/.test(variable.id)), false);
    assert.equal(VISIBLE_STATE_VARIABLES.some((variable) => variable.id === "selectable.inView"), true);

    const conditions = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [
            { type: "expression", left: "selectable.inView", selectable1: "opponent", selectable2: "opponent_hunter_drone", comparator: "eq", right: { type: "boolean", value: true }, viewArc: 90 },
            { type: "expression", left: "selectable.inView", selectable1: "opponent_grenade", selectable2: "opponent", comparator: "eq", right: { type: "boolean", value: true } },
            { type: "expression", left: "selectable.inView", selectable1: "my_bot", selectable2: "opponent_1", comparator: "eq", right: { type: "boolean", value: true }, viewArc: 1000 },
        ], actions: [] }] }],
    }).roots[0].branches[0].conditions;
    assert.equal(conditions[0].selectable1, "opponent_1");
    assert.equal(conditions[0].selectable2, "opponent_1_hunter_drone");
    assert.equal(conditions[0].viewArc, 90);
    // A From without the facing identity falls back to My Bot, as Angle To did.
    assert.equal(conditions[1].selectable1, "my_bot");
    // Arc widths are whole degrees from 1 to 360, and a missing arc is the full circle.
    assert.equal(conditions[2].viewArc, 360);
    const defaultArc = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "expression", left: "selectable.inView", selectable1: "my_bot", selectable2: "opponent_1", comparator: "eq", right: { type: "boolean", value: true } }], actions: [] }] }],
    }).roots[0].branches[0].conditions[0];
    assert.equal(defaultArc.viewArc, 360);

    const configuration = { roots: [{ branches: [{ conditions: [{
        type: "expression",
        left: "selectable.inView",
        selectable1: "opponent",
        selectable2: "my_bot",
        comparator: "eq",
        right: { type: "boolean", value: true },
        viewArc: 2,
    }], actions: [{ action: "slash" }] }] }] };
    // The opponent faces left, straight at My Bot, so My Bot sits in the 2-degree arc.
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 270 }],
    })).primary.id, "root-1-1-1");
    // Facing away (the default rotation of 180) puts My Bot outside that arc.
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary, null);
});

test("bot ability conditionals select the configured bot and declare a loadout dependency", () => {
    const ability = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActive");
    assert.equal(ability.label, "Ability Active");
    assert.equal(ability.selectableType, undefined);
    assert.deepEqual(ability.selectableIdentities, [SELECTABLE_IDENTITIES.BOT]);
    assert.equal(ability.selectableDependency, SELECTABLE_DEPENDENCIES.ABILITY_LOADOUT);
    assert.equal(ability.defaultSelectable, "my_bot");

    const configuration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: ability.id,
            leftSelectable: "opponent",
            ability: 5,
            comparator: "eq",
            right: { type: "boolean", value: true },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{
            id: "opponent-model",
            type: "opponentModel",
            x: 600,
            y: 400,
            abilities: [5],
            abilityState: { 5: { stage: "active", remainingMs: 700 } },
        }],
    })).primary.id, "root-1-1-1");

    const hpConfiguration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: "selectable.hp",
            leftSelectable: "opponent_grenade",
            comparator: "eq",
            right: { type: "number", value: 0 },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(hpConfiguration, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100 },
            { id: "grenade-1", type: "grenade", abilityId: 4, ownerId: "opponent-model", x: 500, y: 400, hp: 90 },
        ],
    })).primary.id, "root-1-1-1");
});

test("editor node positions survive brain normalization as bounded visual metadata", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        nodePositions: {
            "rootNode:root-1": { x: 156, y: 50 },
            "condition:branch-1:root:root-1": { x: 80.25, y: 300.5 },
            invalid: { x: -1, y: 20 },
        },
        roots: [],
    });

    assert.deepEqual(normalized.nodePositions, {
        "rootNode:root-1": { x: 156, y: 50 },
        "condition:branch-1:root:root-1": { x: 80.25, y: 300.5 },
    });
});

test("editor node positions convert between saved coordinates and graph offsets", () => {
    const graphNodes = [
        { id: "rootNode:root-1", x: 156, y: 50 },
        { id: "condition:branch-1:root:root-1", x: 80, y: 300 },
    ];
    const saved = {
        "rootNode:root-1": { x: 240, y: 95 },
        "condition:branch-1:root:root-1": { x: 80, y: 420 },
    };

    const offsets = offsetsForGraphPositions(graphNodes, saved);

    assert.deepEqual(offsets, {
        "rootNode:root-1": { x: 84, y: 45 },
        "condition:branch-1:root:root-1": { x: 0, y: 120 },
    });
    assert.deepEqual(nodePositionsForGraph(graphNodes, offsets), saved);
});

test("normalized editor positions stay with roots and conditionals after priority changes", () => {
    const configuration = {
        nodePositions: {
            "rootNode:fire-root": { x: 100, y: 50 },
            "condition:fire-condition:root:fire-root": { x: 110, y: 300 },
            "action:fire-condition:0:root:fire-root": { x: 120, y: 500 },
            "rootNode:concussive-root": { x: 600, y: 50 },
            "condition:concussive-condition:root:concussive-root": { x: 610, y: 300 },
            "action:concussive-condition:0:root:concussive-root": { x: 620, y: 500 },
        },
        roots: [
            { id: "fire-root", priority: 1, branches: [{ id: "fire-condition", priority: 1, conditions: [{ type: "always" }], actions: [{ action: "slash" }] }] },
            { id: "concussive-root", priority: 2, branches: [{ id: "concussive-condition", priority: 1, conditions: [{ type: "always" }], actions: [{ action: "gun" }] }] },
        ],
    };
    const switched = setLogicRootPriority(configuration.roots, 1, 1);
    const normalized = normalizeAbilityStrategyConfiguration({ ...configuration, roots: switched });

    assert.deepEqual(normalized.roots.map((root) => ({ id: root.id, priority: root.priority })), [
        { id: "fire-root", priority: 2 },
        { id: "concussive-root", priority: 1 },
    ]);
    assert.deepEqual(normalized.nodePositions, {
        "rootNode:fire-root": { x: 100, y: 50 },
        "condition:fire-condition:root:fire-root": { x: 110, y: 300 },
        "action:fire-condition:0:root:fire-root": { x: 120, y: 500 },
        "rootNode:concussive-root": { x: 600, y: 50 },
        "condition:concussive-condition:root:concussive-root": { x: 610, y: 300 },
        "action:concussive-condition:0:root:concussive-root": { x: 620, y: 500 },
    });
});

test("conditional priority swaps preserve node identities and positions", () => {
    const configuration = normalizeAbilityStrategyConfiguration({
        nodePositions: {
            "condition:logic-root-1-1:root:logic-root": { x: 110, y: 300 },
            "action:logic-root-1-1:0:root:logic-root": { x: 120, y: 500 },
            "condition:logic-root-1-2:root:logic-root": { x: 610, y: 300 },
            "action:logic-root-1-2:0:root:logic-root": { x: 620, y: 500 },
            "condition:logic-root-1-3:root:logic-root": { x: 1110, y: 300 },
            "action:logic-root-1-3:0:root:logic-root": { x: 1120, y: 500 },
        },
        roots: [{ id: "logic-root", branches: [
            { conditions: [{ type: "always" }], actions: [{ action: "slash" }] },
            { conditions: [{ type: "always" }], actions: [{ action: "slash" }] },
            { conditions: [{ type: "always" }], actions: [{ action: "slash" }] },
        ] }],
    });
    const switchedRoots = setLogicBranchPriority(normalizeRoots(configuration.roots), 0, [0], 3);
    const switched = normalizeAbilityStrategyConfiguration({ ...configuration, roots: switchedRoots });

    assert.deepEqual(switched.roots[0].branches.map((branch) => ({ action: branch.action, priority: branch.priority })), [
        { action: 1, priority: 3 },
        { action: 1, priority: 2 },
        { action: 1, priority: 1 },
    ]);
    assert.deepEqual(switched.roots[0].branches.map((branch) => branch.id), ["logic-root-1-1", "logic-root-1-2", "logic-root-1-3"]);
    assert.deepEqual(switched.nodePositions, configuration.nodePositions);
});

test("selectable type count selects an object type without selectable ordering", () => {
    const count = STATE_VARIABLES.find((variable) => variable.id === "selectable.count");
    const age = STATE_VARIABLES.find((variable) => variable.id === "selectable.age");
    assert.equal(count.selectableOrderable, false);
    assert.notEqual(age.selectableOrderable, false);
    assert.notEqual(createExpressionCondition(count).leftSelectable, "opponent");

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: count.id,
            leftSelectable: "opponent_grenade:farthest:2",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].leftSelectable, "opponent_1_grenade");

    const orderedAge = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: age.id,
            leftSelectable: "opponent_grenade:farthest:2",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(orderedAge.roots[0].branches[0].conditions[0].leftSelectable, "opponent_1_grenade:farthest:2");
});

test("target-count defaults follow the visible entity type and inspection uses its base label", () => {
    const count = STATE_VARIABLES.find((variable) => variable.id === "selectable.count");
    const visibleTargets = SELECTABLE_TYPES.filter((target) => ["opponent_1", "opponent_1_fireball"].includes(target.id));
    assert.equal(createExpressionCondition(count, visibleTargets).leftSelectable, "opponent_1_fireball");

    const configuration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: count.id,
            leftSelectable: "opponent_fireball",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    };
    const inspection = inspectAbilityStrategyConditions(configuration, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 },
            { id: "fireball-1", type: "fireball", abilityId: 5, ownerId: "opponent-model", ownerSlot: 2, x: 500, y: 400, size: 20 },
        ],
    }))[0];
    assert.equal(inspection.selectable, "Fireball by Opponent 1");
    assert.equal(inspection.value, 1);
});

test("target existence and age conditions resolve spawned opponent entities", () => {
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: 90 };
    const configuration = {
        roots: [{ branches: [{
            id: "singularity-old-enough",
            conditions: [
                {
                    type: "expression",
                    left: "selectable.exists",
                    leftSelectable: "opponent_singularity_zone",
                    comparator: "eq",
                    right: { type: "boolean", value: true },
                },
                {
                    type: "expression",
                    left: "selectable.age",
                    leftSelectable: "opponent_singularity_zone",
                    comparator: "gte",
                    right: { type: "number", value: 2 },
                },
            ],
            actions: [action],
        }] }],
    };

    const result = selectAbilityStrategyActionPlan(configuration, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 },
            { id: "singularity-1", type: "singularityZone", abilityId: 27, ownerId: "opponent-model", ownerSlot: 2, x: 500, y: 400, size: 240, ageMs: 2_000 },
        ],
    }));

    assert.equal(result.movement?.id, "singularity-old-enough");

    const inspection = inspectAbilityStrategyConditions(configuration, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 },
            { id: "singularity-1", type: "singularityZone", abilityId: 27, ownerId: "opponent-model", ownerSlot: 2, x: 500, y: 400, size: 240, ageMs: 100 },
        ],
    }));
    assert.equal(inspection[1].value, 0.1);
    assert.equal(inspection[1].result, false);
    assert.equal(inspection[1].selectableSelector, "opponent_1_singularity_zone");
    assert.deepEqual(inspection[1].resolvedSelectable, {
        id: "singularity-1",
        type: "singularityZone",
        entityContractType: null,
        ownerId: "opponent-model",
        ownerSlot: 2,
        ageMs: 100,
    });

    const timerOnlyInspection = inspectAbilityStrategyConditions(configuration, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 },
            { id: "singularity-1", type: "singularityZone", abilityId: 27, ownerId: "opponent-model", ownerSlot: 2, x: 500, y: 400, size: 240, timerMs: 5_000 },
        ],
    }));
    assert.equal(timerOnlyInspection[1].value, 0);

    const existsOnly = {
        roots: [{ branches: [{
            id: "singularity-exists",
            conditions: [{
                type: "expression",
                left: "selectable.exists",
                leftSelectable: "opponent_singularity_zone",
                comparator: "eq",
                right: { type: "boolean", value: true },
            }],
            actions: [action],
        }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(existsOnly, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 }],
    })).primary, null);
    assert.equal(selectAbilityStrategyActionPlan(existsOnly, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 },
            { id: "singularity-1", type: "singularityZone", abilityId: 27, ownerId: "opponent-model", ownerSlot: 2, x: 500, y: 400, size: 240, ageMs: 0 },
        ],
    })).movement?.id, "singularity-exists");
});

test("numbered entity selectors isolate identical spawned abilities by bot owner", () => {
    const state = {
        player: { id: "main", slot: 1, x: 100, y: 100 },
        teammates: [{ id: "teammate-1", slot: 2, x: 200, y: 100 }],
        opponents: [
            { id: "opponent-1", slot: 3, x: 700, y: 700 },
            { id: "opponent-2", slot: 4, x: 800, y: 700 },
        ],
        objects: [
            { id: "my-fireball", type: "fireball", abilityId: 5, ownerId: "main", ownerSlot: 1 },
            { id: "teammate-fireball", type: "fireball", abilityId: 5, ownerId: "teammate-1", ownerSlot: 2 },
            { id: "opponent-one-fireball", type: "fireball", abilityId: 5, ownerId: "opponent-1", ownerSlot: 3 },
            { id: "opponent-two-fireball", type: "fireball", abilityId: 5, ownerId: "opponent-2", ownerSlot: 4 },
        ],
    };

    assert.deepEqual(matchingStrategySelectables(state, "my_bot_fireball").map((object) => object.id), ["my-fireball"]);
    assert.deepEqual(matchingStrategySelectables(state, "teammate_1_fireball").map((object) => object.id), ["teammate-fireball"]);
    assert.deepEqual(matchingStrategySelectables(state, "opponent_1_fireball").map((object) => object.id), ["opponent-one-fireball"]);
    assert.deepEqual(matchingStrategySelectables(state, "opponent_2_fireball").map((object) => object.id), ["opponent-two-fireball"]);
    assert.deepEqual(matchingStrategySelectables(state, "opponent_fireball").map((object) => object.id), ["opponent-one-fireball"]);
});

test("facing identity allows oriented ability entities", () => {
    const facing = STATE_VARIABLES.find((variable) => variable.id === "selectable.facing");
    assert.deepEqual(facing.selectableIdentities, [SELECTABLE_IDENTITIES.FACING]);
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: "selectable.facing",
            leftSelectable: "opponent_hunter_drone",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].leftSelectable, "opponent_1_hunter_drone");

    const facingConfiguration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: "selectable.facing",
            leftSelectable: "opponent_hunter_drone",
            comparator: "eq",
            right: { type: "number", value: 30 },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(facingConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 30 },
            { id: "drone-1", type: "hunterDrone", abilityId: 17, ownerId: "opponent-model", x: 500, y: 400, rotation: 30 }],
    })).primary.id, "root-1-1-1");
});

test("selectable speed uses a direction-independent per-tick movement magnitude", () => {
    const speed = STATE_VARIABLES.find((variable) => variable.id === "selectable.speed");
    assert.equal(speed.label, "Speed");
    assert.deepEqual(speed.selectableIdentities ?? [], []);

    const configuration = {
        roots: [{ branches: [{ id: "speed", conditions: [{
            type: "expression",
            left: "selectable.speed",
            comparator: "gt",
            right: { type: "number", value: 4 },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, movementVelocityX: 3, movementVelocityY: 4 }],
    })).primary.id, "speed");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, movementVelocityX: -3, movementVelocityY: -4 }],
    })).primary.id, "speed");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, movementVelocityX: 0, movementVelocityY: 3 }],
    })).primary, null);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{
            id: "opponent-model",
            type: "opponentModel",
            transform: {
                position: { x: 600, y: 400 },
                rotation: 0,
                size: 64,
                velocity: { x: 60, y: 80 },
                movementVelocity: { x: 6, y: 8 },
            },
            health: { current: 100, max: 100 },
        }],
    })).primary.id, "speed");

});

test("danger-zone edge distance uses signed center-to-boundary distance", () => {
    const distance = STATE_VARIABLES.find((variable) => variable.id === "selectable.dangerZoneEdgeDistance");
    assert.equal(distance.supportsSelectable, true);
    assert.equal(distance.min, -1200);
    assert.equal(distance.max, 1200);
    assert.equal(variableHasTag(distance, VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER), true);

    const configuration = {
        roots: [{ branches: [{ id: "outside-zone", conditions: [{
            type: "expression",
            left: distance.id,
            leftSelectable: "my_bot",
            comparator: "lt",
            right: { type: "number", value: -15 },
        }], actions: [{ action: "slash" }] }] }],
    };
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[0].conditions[0].right.value, -15);
    const zone = { x: 500, y: 500, safeRadius: 400 };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        closingZone: zone,
        playerModel: { x: 920, y: 500, size: 60 },
    })).primary.id, "outside-zone");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        closingZone: zone,
        playerModel: { x: 700, y: 500, size: 60 },
    })).primary, null);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary, null);

    const opponentConfiguration = {
        roots: [{ branches: [{ id: "opponent-outside-zone", conditions: [{
            type: "expression",
            left: distance.id,
            leftSelectable: "opponent",
            comparator: "lt",
            right: { type: "number", value: -15 },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(opponentConfiguration, payload({
        closingZone: zone,
        objects: [{ id: "opponent-model", type: "opponentModel", x: 920, y: 500, size: 60, hp: 100 }],
    })).primary.id, "opponent-outside-zone");

    const centerInsideConfiguration = {
        roots: [{ branches: [{ id: "center-inside", conditions: [{
            type: "expression",
            left: distance.id,
            leftSelectable: "my_bot",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [{ action: "slash" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(centerInsideConfiguration, payload({
        closingZone: zone,
        playerModel: { x: 880, y: 500, size: 60 },
    })).primary.id, "center-inside");
});

test("arena edge distance uses the entity center instead of its hitbox edge", () => {
    const distance = STATE_VARIABLES.find((variable) => variable.id === "selectable.edgeDistance");
    const configuration = {
        roots: [{ branches: [{ id: "near-edge", conditions: [{
            type: "expression",
            left: distance.id,
            leftSelectable: "my_bot",
            comparator: "lt",
            right: { type: "number", value: 15 },
        }], actions: [{ action: "slash" }] }] }],
    };

    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { x: 30, y: 400, size: 60 },
    })).primary, null);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { x: 10, y: 400, size: 60 },
    })).primary.id, "near-edge");
});

test("conditional ability choices expose active state and remaining active time", () => {
    const equipped = new Set(ALL_ABILITY_DEFINITIONS.map((ability) => ability.id));
    const active = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActive");
    const onCooldown = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityOnCooldown");
    const activeTime = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActiveMs");

    assert.equal(active.valueType, "boolean");
    assert.equal(onCooldown.valueType, "boolean");
    assert.equal(activeTime.valueType, "number");
    assert.equal(activeTime.label, "Active Time");
    assert.equal(activeTime.unit, "seconds");
    assert.equal(activeTime.suffix, undefined);
    assert.equal(activeTime.min, 0);
    assert.equal(abilityDefinitionsForVariable(active, equipped).some((ability) => ability.id === 3), true);
    assert.equal(abilityDefinitionsForVariable(onCooldown, equipped).some((ability) => ability.id === 3), true);
    assert.equal(abilityDefinitionsForVariable(activeTime, equipped).some((ability) => ability.id === 3), true);

    const configuration = {
        roots: [{ branches: [
            {
                id: "active-ability",
                conditions: [
                    { type: "expression", left: active.id, ability: "gun", comparator: "eq", right: { type: "boolean", value: true } },
                    { type: "expression", left: activeTime.id, ability: "gun", comparator: "gt", right: { type: "number", value: 0.5 } },
                ],
                actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: 0 }],
            },
            { id: "fallback", conditions: [{ type: "always" }], actions: [{ action: "gun" }] },
        ] }],
    };

    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { abilityState: { gun: { stage: "active", remainingMs: 850 } } },
    })).primary.id, "active-ability");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary.id, "fallback");
});

test("ability phase conditionals expose mutually exclusive active, cooldown, preparation, and ready states", () => {
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: 90 };
    const phaseConfiguration = (conditions) => ({
        roots: [{ branches: [{ id: "phase", conditions, actions: [action] }] }],
    });
    const condition = (left, comparator, value, extra = {}) => ({
        type: "expression",
        left,
        comparator,
        right: { type: typeof value === "boolean" ? "boolean" : "number", value },
        ability: "gun",
        ...extra,
    });

    const activePlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("bot.selectedAbilityActive", "eq", true),
        condition("bot.selectedAbilityOnCooldown", "eq", false),
        condition("bot.selectedAbilityCooldownMs", "eq", 0),
        condition("bot.selectedAbilityReady", "eq", false),
    ]), payload({
        playerModel: { abilityState: { gun: { stage: "active", remainingMs: 500, cooldownMs: 3000 } } },
    }));
    assert.equal(activePlan.movement?.id, "phase");

    const cooldownPlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("bot.selectedAbilityActive", "eq", false),
        condition("bot.selectedAbilityOnCooldown", "eq", true),
        condition("bot.selectedAbilityCooldownMs", "gt", 0),
        condition("bot.selectedAbilityReady", "eq", false),
    ]), payload({
        playerModel: { abilityState: { gun: { stage: "cooldown", remainingMs: 500 } } },
    }));
    assert.equal(cooldownPlan.movement?.id, "phase");

    const preparationPlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("bot.selectedAbilityPreparing", "eq", true),
        condition("bot.selectedAbilityPreparationMs", "gt", 0),
        condition("bot.selectedAbilityActive", "eq", false),
        condition("bot.selectedAbilityActiveMs", "eq", 0),
        condition("bot.selectedAbilityOnCooldown", "eq", false),
        condition("bot.selectedAbilityCooldownMs", "eq", 0),
        condition("bot.selectedAbilityReady", "eq", false),
    ]), payload({
        playerModel: { abilityState: { gun: { stage: "windup", remainingMs: 400 } } },
    }));
    assert.equal(preparationPlan.movement?.id, "phase");

    const readyPlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("bot.selectedAbilityActive", "eq", false),
        condition("bot.selectedAbilityPreparing", "eq", false),
        condition("bot.selectedAbilityOnCooldown", "eq", false),
        condition("bot.selectedAbilityReady", "eq", true),
    ]), payload());
    assert.equal(readyPlan.movement?.id, "phase");
});

test("unowned ability conditionals resolve every ability state as false or zero", () => {
    const conditions = [
        ["bot.selectedAbilityReady", "eq", false, "boolean"],
        ["bot.selectedAbilityActive", "eq", false, "boolean"],
        ["bot.selectedAbilityActiveMs", "eq", 0, "number"],
        ["bot.selectedAbilityOnCooldown", "eq", false, "boolean"],
        ["bot.selectedAbilityCooldownMs", "eq", 0, "number"],
        ["bot.selectedAbilityCharges", "eq", 0, "number"],
        ["bot.selectedAbilityPreparing", "eq", false, "boolean"],
        ["bot.selectedAbilityPreparationMs", "eq", 0, "number"],
    ];
    const configurationFor = (target) => ({
        roots: [{ branches: [{ conditions: conditions.map(([left, comparator, value, type]) => ({
            type: "expression",
            left,
            leftSelectable: target,
            ability: 12,
            comparator,
            right: { type, value },
        })), actions: [] }] }],
    });
    const stateWithStaleAbilityState = payload({
        playerModel: {
            abilities: [],
            abilityState: { 12: { stage: "windup", remainingMs: 600, charges: 2 } },
        },
        objects: [{
            id: "opponent-model",
            type: "opponentModel",
            x: 600,
            y: 400,
            abilities: [],
            abilityState: { 12: { stage: "windup", remainingMs: 600, charges: 2 } },
        }],
    });

    for (const target of ["my_bot", "opponent"]) {
        const inspections = inspectAbilityStrategyConditions(configurationFor(target), stateWithStaleAbilityState);
        assert.deepEqual(inspections.map((inspection) => inspection.value), [false, false, 0, false, 0, 0, false, 0]);
        assert.ok(inspections.every((inspection) => inspection.result));
    }
});

test("ability condition defaults and persisted selections use the visible ability options", () => {
    const active = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActive");
    const visible = {
        ...active,
        abilityOptions: [
            { id: 21, label: "Rewind" },
            { id: 6, label: "Stun" },
        ],
    };

    assert.equal(createExpressionCondition(visible).ability, 21);
    assert.equal(normalizeConditionSelections({ type: "expression", left: active.id, ability: 1 }, visible).ability, 21);
    assert.equal(normalizeConditionSelections({ type: "expression", left: active.id, ability: "6" }, visible).ability, 6);
});

test("ability conditionals resolve several selected abilities and numeric preparation state", () => {
    const activeConditions = [
        [6, "stun"],
        [19, "dash"],
        [21, "rewind"],
    ];
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: 0 };
    for (const [abilityId, ability] of activeConditions) {
        const result = selectAbilityStrategyActionPlan({
            roots: [{ branches: [{ id: `active-${abilityId}`, conditions: [{
                type: "expression",
                left: "bot.selectedAbilityActive",
                ability,
                comparator: "eq",
                right: { type: "boolean", value: true },
            }], actions: [action] }] }],
        }, payload({
            playerModel: { abilities: [6, 19, 21], abilityState: { [abilityId]: { stage: "active", remainingMs: 500 } } },
        }));
        assert.equal(result.movement?.id, `active-${abilityId}`, ability);
    }

    const preparing = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ id: "preparing", conditions: [
            {
                type: "expression",
                left: "bot.selectedAbilityPreparing",
                ability: "gun",
                comparator: "eq",
                right: { type: "boolean", value: true },
            },
            {
                type: "expression",
                left: "bot.selectedAbilityPreparationMs",
                ability: "gun",
                comparator: "gt",
                right: { type: "number", value: 0.5 },
            },
        ], actions: [action] }] }],
    }, payload({
        playerModel: { abilities: [3], abilityState: { 3: { stage: "windup", remainingMs: 700 } } },
    }));
    assert.equal(preparing.movement?.id, "preparing");
});

test("condition inspection identifies the ability represented by Ability Active", () => {
    const active = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActive");
    const inspection = inspectAbilityStrategyConditions({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: active.id,
            ability: "stun",
            comparator: "eq",
            right: { type: "boolean", value: true },
        }], actions: [] }] }],
    }, payload({
        playerModel: { abilities: [6, 19], abilityState: { 6: { stage: "active", remainingMs: 2500 } } },
    }))[0];

    assert.deepEqual(inspection.ability, { id: 6, name: "stun", label: "Stun" });
    assert.equal(inspection.value, true);
    assert.equal(inspection.result, true);
});

test("numeric-string ability selections preserve Dash active-state conditions", () => {
    const active = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityActive");
    const configuration = {
        roots: [{ branches: [{
            id: "dash-active",
            conditions: [{ type: "expression", left: active.id, ability: "19", comparator: "eq", right: { type: "boolean", value: true } }],
            actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: 0 }],
        }, { id: "fallback", conditions: [{ type: "always" }], actions: [{ action: "none" }] }] }],
    };

    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[0].conditions[0].ability, 19);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { abilities: [19], abilityState: { 19: { stage: "active", remainingMs: 850 } } },
    })).primary.id, "dash-active");
});

test("angle condition inputs use bounds matching their runtime ranges", () => {
    const angles = STATE_VARIABLES.filter((variable) => variable.suffix === "deg");
    assert.ok(angles.length > 0);
    assert.ok(angles.every((variable) => variable.angle));
    assert.deepEqual(
        Object.fromEntries(angles.map(({ id, min, max }) => [id, [min, max]])),
        {
            "selectable.movementDirection": [-360, 360],
            "selectable.approachAngle": [0, 180],
            "selectable.facing": [-360, 360],
        },
    );

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [
            { type: "expression", left: "selectable.facing", comparator: "gt", right: { type: "number", value: 999 } },
            { type: "expression", left: "selectable.approachAngle", comparator: "gt", right: { type: "number", value: 1000 } },
            { type: "expression", left: "selectable.approachAngle", comparator: "gt", right: { type: "number", value: -100 } },
        ], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].right.value, 360);
    assert.equal(normalized.roots[0].branches[0].conditions[1].right.value, 180);
    assert.equal(normalized.roots[0].branches[0].conditions[2].right.value, 0);
});

test("conditional measurement units stay in catalogue metadata except for inline degrees", () => {
    const age = STATE_VARIABLES.find((variable) => variable.id === "selectable.age");
    const distance = STATE_VARIABLES.find((variable) => variable.id === "selectable.distance");
    const charges = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedAbilityCharges");

    assert.equal(age.label, "Age");
    assert.equal(age.unit, "seconds");
    assert.equal(age.suffix, undefined);
    assert.equal(distance.unit, "arena units");
    assert.equal(distance.suffix, undefined);
    assert.equal(charges.unit, "charges");
    assert.deepEqual(new Set(STATE_VARIABLES.filter((variable) => variable.suffix).map((variable) => variable.suffix)), new Set(["deg"]));
});

test("movement actions normalize relative angles and discard movement offsets", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ actions: [{
            action: "move_walk",
            movementMode: "coordinates",
            movementDirection: -90,
            targetX: 125,
            targetY: 540,
            targetOffsetX: 80,
            targetOffsetY: -40,
        }] }] }],
    });
    const movement = normalized.roots[0].branches[0].actions[0];

    assert.equal(movement.movementDirection, -90);
    assert.equal(movement.targetMode, "coordinates");
    assert.equal(movement.targetX, 125);
    assert.equal(movement.targetY, 540);
    assert.equal("targetOffsetX" in movement, false);
    assert.equal("targetOffsetY" in movement, false);

});

test("absolute movement angles use the north-zero clockwise compass", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ actions: [{
            action: "move_walk",
            movementMode: "absolute",
            movementDirection: -90,
        }] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].actions[0].movementDirection, -90);

    const actionFor = (movementDirection) => buildDeterministicLogicAction({
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{
            action: "move_walk",
            movementMode: "absolute",
            movementDirection,
        }] }] }],
    }, payload({
        playerModel: { x: 400, y: 400, rotation: 0 },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100 }],
    }));

    for (const [direction, expectedX, expectedY] of [
        [0, 0, -1],
        [90, 1, 0],
        [180, 0, 1],
        [270, -1, 0],
        [-90, -1, 0],
    ]) {
        const action = actionFor(direction);
        assert.ok(Math.abs(action.dx - expectedX) < 0.000001, `${direction} x`);
        assert.ok(Math.abs(action.dy - expectedY) < 0.000001, `${direction} y`);
    }
});

test("rotate actions support absolute angles and absolute coordinates", () => {
    const angleConfiguration = {
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{
            action: "rotate_toward_enemy",
            targetMode: "angle",
            targetAngle: 90,
        }] }] }],
    };
    const angleAction = buildDeterministicLogicAction(angleConfiguration, payload({
        playerModel: { x: 400, y: 400, rotation: 0 },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100 }],
    }));
    assert.equal(angleAction.dRot, 1);

    const coordinateConfiguration = {
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{
            action: "rotate_toward_enemy",
            targetMode: "coordinates",
            targetX: 500,
            targetY: 400,
        }] }] }],
    };
    const coordinateAction = buildDeterministicLogicAction(coordinateConfiguration, payload({
        playerModel: { x: 400, y: 400, rotation: 0 },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100 }],
    }));
    assert.equal(coordinateAction.dRot, 1);
});

test("relative movement angles use the universal clockwise compass", () => {
    assert.equal(vectorToCompassDegrees(1, 0), 90);
    const toward = relativeMovementVector(0, -100, 0);
    const right = relativeMovementVector(0, -100, movementAngle(90));
    const away = relativeMovementVector(0, -100, 180);
    const left = relativeMovementVector(0, -100, 270);

    assert.ok(Math.abs(toward.x) < 0.000001);
    assert.ok(Math.abs(toward.y + 1) < 0.000001);
    assert.ok(Math.abs(right.x - 1) < 0.000001);
    assert.ok(Math.abs(right.y) < 0.000001);
    assert.ok(Math.abs(away.x) < 0.000001);
    assert.ok(Math.abs(away.y - 1) < 0.000001);
    assert.ok(Math.abs(left.x + 1) < 0.000001);
    assert.ok(Math.abs(left.y) < 0.000001);
    assert.equal(normalizeRelativeMovementDegrees(270), -90);
});

test("selectable directions compare positive and negative angle equivalents", () => {
    assert.equal(compareAngleValues(350, "lt", 50), true);
    assert.equal(compareAngleValues(-10, "lt", 50), true);
    assert.equal(compareAngleValues(50, "eq", -310), true);

    const configuration = {
        roots: [{ branches: [{ id: "angle", conditions: [{
            type: "expression",
            left: "selectable.facing",
            comparator: "lt",
            right: { type: "number", value: 50 },
        }], actions: [{ action: "slash" }], children: [] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100, rotation: 20 }],
    })).primary.id, "angle");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary.id, "angle");

    const boundedConfiguration = {
        roots: [{ branches: [{ id: "centered-angle", conditions: [
            { type: "expression", left: "selectable.facing", comparator: "gte", right: { type: "number", value: -50 } },
            { type: "expression", left: "selectable.facing", comparator: "lt", right: { type: "number", value: 50 } },
        ], actions: [{ action: "slash" }], children: [] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(boundedConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100, rotation: 350 }],
    })).primary.id, "centered-angle");

    const facingConfiguration = {
        roots: [{ branches: [{ id: "facing-range", conditions: [
            { type: "expression", left: "selectable.facing", comparator: "gt", right: { type: "number", value: 10 } },
            { type: "expression", left: "selectable.facing", comparator: "lt", right: { type: "number", value: 50 } },
        ], actions: [{ action: "slash" }], children: [] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(facingConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 30 }],
    })).primary.id, "facing-range");
    assert.equal(selectAbilityStrategyActionPlan(facingConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 70 }],
    })).primary, null);
});

test("status-effect condition defaults follow the available status options instead of Burn", () => {
    const statusVariable = STATE_VARIABLES.find((variable) => variable.id === "bot.selectedStatusEffectActive");
    const slowVariable = {
        ...statusVariable,
        statusEffectOptions: statusEffectDefinitionsForAbilities([6]),
    };
    assert.equal(createExpressionCondition(slowVariable).statusEffect, "stun");

    const normalizedMissingSelection = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: statusVariable.id,
            comparator: "eq",
            right: { type: "boolean", value: true },
        }], actions: [] }] }],
    });
    assert.equal(normalizedMissingSelection.roots[0].branches[0].conditions[0].statusEffect, null);

    const slowStatusVariable = {
        ...statusVariable,
        statusEffectOptions: [{ id: "slow", label: "Slow" }, { id: "burn", label: "Burn" }],
    };
    assert.equal(createExpressionCondition(slowStatusVariable).statusEffect, "slow");
    assert.equal(normalizeConditionSelections({ type: "expression", left: statusVariable.id, statusEffect: "not-a-status" }, slowStatusVariable).statusEffect, "slow");
});

test("status-effect conditionals resolve multiple effect types and labels", () => {
    assert.deepEqual(
        statusEffectDefinitionsForAbilities([5, 6, 15]).map((effect) => effect.id),
        ["burn", "stun", "silence"],
    );
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: 270 };
    for (const [statusEffect, label] of [["burn", "Burn"], ["stun", "Stun"], ["silence", "Silence"]]) {
        const result = selectAbilityStrategyActionPlan({
            roots: [{ branches: [{ id: `status-${statusEffect}`, conditions: [{
                type: "expression",
                left: "bot.selectedStatusEffectActive",
                statusEffect: label,
                comparator: "eq",
                right: { type: "boolean", value: true },
            }], actions: [action] }] }],
        }, payload({
            playerModel: { statusEffects: [{ type: statusEffect, remainingMs: 1200 }] },
        }));
        assert.equal(result.movement?.id, `status-${statusEffect}`, statusEffect);
    }
});

test("right-hand ability and status variables keep their own selection metadata", () => {
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: 90 };
    const abilityResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ id: "right-ability", conditions: [{
            type: "expression",
            left: "selectable.hp",
            leftSelectable: "my_bot",
            comparator: "lt",
            right: { type: "variable", value: "bot.selectedAbilityCooldownMs" },
            ability: "dash",
        }], actions: [action] }] }],
    }, payload({
        playerModel: { hp: 1, abilities: [19], abilityState: { 19: { stage: "cooldown", remainingMs: 1800 } } },
    }));
    assert.equal(abilityResult.movement?.id, "right-ability");

    const statusResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ id: "right-status", conditions: [{
            type: "expression",
            left: "selectable.hp",
            leftSelectable: "my_bot",
            comparator: "lt",
            right: { type: "variable", value: "bot.selectedStatusEffectDurationMs" },
            statusEffect: "slow",
        }], actions: [action] }] }],
    }, payload({
        playerModel: { hp: 1, statusEffects: [{ type: "slow", remainingMs: 3200 }] },
    }));
    assert.equal(statusResult.movement?.id, "right-status");
});

test("status conditions read Slow like Burn from the generic status collection", () => {
    const activeCondition = (statusEffect) => ({
        type: "expression",
        left: "bot.selectedStatusEffectActive",
        statusEffect,
        comparator: "eq",
        right: { type: "boolean", value: true },
    });
    const durationCondition = {
        type: "expression",
        left: "bot.selectedStatusEffectDurationMs",
        statusEffect: "slow",
        comparator: "gt",
        right: { type: "number", value: 3 },
    };
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: 270 };
    for (const statusEffect of ["burn", "slow"]) {
        const configuration = { roots: [{ branches: [{ conditions: [activeCondition(statusEffect)], actions: [action] }] }] };
        const result = selectAbilityStrategyActionPlan(configuration, payload({
            playerModel: {
                abilities: [26],
                statusEffects: [{ type: statusEffect, remainingMs: 3200 }],
            },
        }));
        assert.equal(result.movement?.id, "root-1-1-1", statusEffect);
    }

    const durationResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [durationCondition], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [26],
            statusEffects: [{ type: "slow", remainingMs: 3200 }],
        },
    }));
    assert.equal(durationResult.movement?.id, "root-1-1-1");

    const inspection = inspectAbilityStrategyConditions({
        roots: [{ branches: [{ conditions: [durationCondition], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [26],
            statusEffects: [{
                type: "slow",
                remainingMs: 3200,
                effects: [{ type: "modifier", mode: "constant", stat: "cooldown", multiply: 0.5 }],
            }],
        },
    }))[0];
    assert.equal(inspection.selectable, "My Bot");
    assert.equal(inspection.statusEffect, "slow");
    assert.deepEqual(inspection.statusEffectState, {
        type: "slow",
        mode: "duration",
        active: true,
        remainingMs: 3200,
        effects: [{ type: "modifier", mode: "constant", stat: "cooldown", multiply: 0.5 }],
    });

    const effectRecordResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [activeCondition("slow")], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [26],
            statusEffects: [{
                type: "slow",
                remainingMs: 3200,
                effects: [{ type: "modifier", mode: "constant", stat: "cooldown", multiply: 0.5 }],
            }],
        },
    }));
    assert.equal(effectRecordResult.movement?.id, "root-1-1-1");

    const labelSelectionResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [activeCondition("Slow")], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [26],
            statusEffects: [{ type: "slow", remainingMs: 3200 }],
        },
    }));
    assert.equal(labelSelectionResult.movement?.id, "root-1-1-1");

    const flatFieldResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [durationCondition], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [26],
            cooldownRecoveryMs: 3200,
        },
    }));
    assert.equal(flatFieldResult.movement?.id, undefined);
});

test("empty strategy uses the roots schema", () => {
    const code = createDefaultAbilityStrategyConfiguration();
    assert.deepEqual(code.roots, []);
    assert.equal("columns" in code, false);
});

test("retired blocks and clusters are not migrated", () => {
    const code = normalizeAbilityStrategyConfiguration({
        blocks: [{ action: "slash", conditions: [{ type: "always" }] }],
        clusters: [{ blocks: [{ action: "slash", conditions: [{ type: "always" }] }] }],
    });
    assert.deepEqual(code, {
        version: "bot-logic-tree-v2",
        roots: [],
        customVariables: [],
    });
});

test("retired directional action IDs are not migrated", () => {
    const code = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "move_inward" }], children: [] }] }],
    });
    assert.equal(code.roots[0].branches[0].actions[0].action, "none");
});

test("roots preserve editor IDs independently from numeric priorities", () => {
    const roots = normalizeRoots([
        {
            id: "first",
            name: "Custom name",
            priority: 5,
            branches: [{
                id: "conditional",
                priority: 1,
                children: [{ id: "nested", priority: 3, children: [] }],
            }],
        },
        { id: "second", name: "Another name", priority: 10, branches: [] },
    ]);
    assert.deepEqual(roots.map((root) => root.priority), [5, 10]);
    assert.deepEqual(roots.map((root) => root.id), ["first", "second"]);
    assert.deepEqual(roots.map((root) => root.name), ["Custom name", "Another name"]);
    assert.equal(roots[0].branches[0].id, "conditional");
    assert.equal(roots[0].branches[0].priority, 1);
    assert.equal(roots[0].branches[0].children[0].id, "nested");
    assert.equal(roots[0].branches[0].children[0].priority, 3);
    const created = createCodeRoot(2);
    const createdWithSamePriority = createCodeRoot(2);
    assert.equal(created.priority, 2);
    assert.equal(created.name, "Root");
    assert.notEqual(created.id, "root-3");
    assert.notEqual(created.id, createdWithSamePriority.id);
    assert.equal(createCodeRoot(2, "Saved root", "saved-root").id, "saved-root");
});

test("roots without ids keep stable fallback identities when priorities change", () => {
    const normalized = normalizeRoots([
        { priority: 1, branches: [] },
        { priority: 2, branches: [] },
    ]);
    const switched = setLogicRootPriority(normalized, 1, 1);

    assert.deepEqual(switched.map((root) => root.id), ["root-1", "root-2"]);
    assert.deepEqual(switched.map((root) => root.priority), [2, 1]);
    assert.deepEqual(normalizeRoots(switched).map((root) => root.id), ["root-1", "root-2"]);
});

test("numeric conditional order selects a later conditional", () => {
    const configuration = {
        roots: [{
            branches: [
                { id: "first", branchType: "if", priority: 1, conditions: [{ type: "expression", left: "selectable.hp", leftSelectable: "my_bot", comparator: "lt", right: { type: "number", value: 1 } }], actions: [{ action: "slash" }] },
                { id: "second", branchType: "if", priority: 2, conditions: [{ type: "always" }], actions: [{ action: "gun" }] },
            ],
        }],
    };
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[1].branchType, "if");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).ability.action, 3);
});

test("root priority switches values without moving roots or changing execution", () => {
    const roots = [
        { id: "fire-root", name: "Fire", priority: 1, branches: [{ id: "fire", conditions: [{ type: "always" }], actions: [{ action: "slash" }] }] },
        { id: "concussive-root", name: "Concussive", priority: 2, branches: [{ id: "concussive", conditions: [{ type: "always" }], actions: [{ action: "gun" }] }] },
    ];
    const switched = setLogicRootPriority(roots, 1, 1);
    assert.deepEqual(switched.map((root) => root.id), ["fire-root", "concussive-root"]);
    assert.deepEqual(switched.map((root) => root.name), ["Fire", "Concussive"]);
    assert.deepEqual(switched.map((root) => root.branches[0].id), ["fire", "concussive"]);
    assert.deepEqual(switched.map((root) => root.priority), [2, 1]);
    assert.equal(selectAbilityStrategyActionPlan({ roots: switched }, payload()).ability.action, 3);
});

test("a matching conditional with an unavailable ability falls through to the next conditional", () => {
    const configuration = { roots: [{ branches: [
        { id: "cooling-down", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [{ action: "slash" }] },
        { id: "ready", branchType: "if", priority: 2, conditions: [{ type: "always" }], actions: [{ action: "gun" }] },
    ] }] };
    const plan = selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { abilityState: { 1: { stage: "cooldown", remainingMs: 500 } } },
    }));

    assert.equal(plan.ability.action, 3);
});

test("root priority swaps an occupied priority without changing root positions", () => {
    const roots = Array.from({ length: 6 }, (_, index) => ({
        id: `root-${index + 1}`,
        name: `Root ${index + 1}`,
        priority: index + 1,
        branches: [],
    }));
    const switched = setLogicRootPriority(roots, 5, 1);

    assert.deepEqual(switched.map((root) => root.id), roots.map((root) => root.id));
    assert.deepEqual(switched.map((root) => root.priority), [6, 2, 3, 4, 5, 1]);
});

test("conditional priority switches values without moving siblings", () => {
    const roots = [{ priority: 1, branches: [
        { id: "first", branchType: "if", priority: 1, conditions: [{ type: "always" }], actions: [] },
        { id: "third", branchType: "if", priority: 3, conditions: [{ type: "always" }], actions: [] },
    ] }];
    const switched = setLogicBranchPriority(roots, 0, [1], 1);
    assert.deepEqual(switched[0].branches.map((branch) => branch.id), ["first", "third"]);
    assert.deepEqual(switched[0].branches.map((branch) => branch.priority), [3, 1]);
});

test("tutorial teaches rotate before fast turn", () => {
    const basicStrikeScenario = getTutorialScenario(3);
    const rotateScenario = getTutorialScenario(5);
    const lockOnScenario = getTutorialScenario(6);
    const dodgeScenario = getTutorialScenario(7);
    const combineScenario = getTutorialScenario(8);
    const rotateActions = rotateScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    const lockOnActions = lockOnScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    const basicStrikeActions = basicStrikeScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    assert.equal(rotateActions.some((action) => action.action === "rotate_toward_enemy"), true);
    assert.equal(lockOnActions.some((action) => action.action === "rotate_toward_enemy" && action.fastTurn === true), true);
    assert.equal(rotateScenario.durationMs, 2000);
    assert.equal(lockOnScenario.durationMs, 1000);
    assert.equal(rotateScenario.goal, "stun");
    assert.equal(lockOnScenario.goal, "stun");
    assert.equal(dodgeScenario.durationMs, 3000);
    assert.equal(basicStrikeScenario.durationMs, 2000);
    assert.equal(combineScenario.durationMs, 3000);
    assert.equal(dodgeScenario.goal, "dodge_grenade");
    assert.equal(basicStrikeScenario.goal, "slash");
    assert.equal(basicStrikeActions.some((action) => action.action === 1), true);
    assert.equal(basicStrikeActions.some((action) => action.action === 34), false);
    assert.equal(basicStrikeActions.some((action) => action.action === 2), false);
});

test("tutorial priority lesson keeps roots in place while swapping priorities", () => {
    const scenario = getTutorialScenario(4);
    assert.equal(TUTORIAL_STEP_COUNT, 16);
    assert.equal(scenario.id, "priority");
    assert.equal(getTutorialScenario(12).id, "game-overview");
    assert.equal(getTutorialScenario(13).id, "ability-catalogue");
    assert.equal(getTutorialScenario(14).id, "conditional-catalogue");
    assert.equal(getTutorialScenario(15).id, "puzzles");
    assert.deepEqual(scenario.emptyCode.roots.map((root) => root.name), ["Dash", "Fast turn"]);
    assert.deepEqual(scenario.emptyCode.roots.map((root) => root.priority), [1, 2]);
    assert.deepEqual(scenario.solution.roots.map((root) => root.id), scenario.emptyCode.roots.map((root) => root.id));
    assert.deepEqual(scenario.solution.roots.map((root) => root.priority), [2, 1]);
    assert.equal(hasTutorialPriorityOrder(scenario.emptyCode, 19, "rotate_toward_enemy"), true);
    assert.equal(hasTutorialPriorityOrder(scenario.solution, "rotate_toward_enemy", 19), true);
});

test("roots count conditions and validate as a trainable code", () => {
    const configuration = {
        roots: [{ priority: 1, branches: [{ id: "branch", branchType: "if", conditions: [{ type: "always" }], actions: [{ action: "slash" }], children: [] }] }],
    };
    assert.equal(countConditionSlots(configuration), 1);
    assert.deepEqual(validateAbilityStrategyConfiguration(configuration).errors, []);
});

test("empty or incomplete bot code does not create a submission-blocking action error", () => {
    assert.deepEqual(validateAbilityStrategyConfiguration({ roots: [] }).errors, []);
    assert.deepEqual(validateAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "none" }], children: [] }] }],
    }).errors, []);
});

test("custom variables use one variable slot and do not carry boolean conditions", () => {
    const configuration = {
        customVariables: [{ id: "custom.ready", name: "Ready", valueType: "boolean", initialValue: false, conditions: [{ type: "always" }] }],
        roots: [],
    };
    assert.equal(countConditionSlots(configuration), 0);
    assert.deepEqual(normalizeAbilityStrategyConfiguration(configuration).customVariables[0], {
        id: "custom.ready",
        name: "Ready",
        valueType: "boolean",
        initialValue: false,
    });
    assert.match(validateAbilityStrategyConfiguration(configuration).errors.join(" "), /no longer supports conditions/);
});

test("custom-variable references cost one conditional slot", () => {
    const configuration = {
        customVariables: [{ id: "custom.ready", name: "Ready", valueType: "boolean", initialValue: false }],
        roots: [{ branches: [{ conditions: [{ type: "expression", left: "custom.ready", comparator: "eq", right: { type: "boolean", value: true } }], actions: [], children: [] }] }],
    };
    assert.equal(countConditionSlots(configuration), 1);
});

test("retired custom-variable conditions do not reduce root condition capacity", () => {
    const branches = Array.from({ length: 300 }, (_, index) => ({ id: `branch-${index}`, conditions: [{ type: "always" }], actions: [], children: [] }));
    const normalized = normalizeAbilityStrategyConfiguration({
        customVariables: [{ id: "custom.ready", name: "Ready", valueType: "boolean", initialValue: false, conditions: [{ type: "always" }] }],
        roots: [{ branches }],
    });
    assert.equal(normalized.roots[0].branches.length, 300);
    assert.equal(normalized.customVariables[0].conditions, undefined);
});

test("a compared-to pair variable keeps its own entity and target configuration", () => {
    const pairCondition = (extra = {}) => ({
        type: "expression",
        left: "selectable.distance",
        selectable1: "my_bot",
        selectable2: "opponent_1",
        targetMode: "target",
        comparator: "lt",
        right: { type: "variable", value: "selectable.distance" },
        ...extra,
    });

    const independent = normalizeConditions([pairCondition({ rightSelectable1: "my_bot", rightTargetMode: "coordinates", rightTargetX: 100, rightTargetY: 0 })])[0];
    assert.equal(independent.targetMode, "target");
    assert.equal(independent.selectable2, "opponent_1");
    assert.equal(independent.rightTargetMode, "coordinates");
    assert.equal(independent.rightTargetX, 100);

    // Changing only the left side never moves the right side once it has its own fields.
    const leftPoint = normalizeConditions([pairCondition({ targetMode: "coordinates", targetX: 5, targetY: 5, rightSelectable1: "my_bot", rightSelectable2: "opponent_1", rightTargetMode: "target" })])[0];
    assert.equal(leftPoint.targetMode, "coordinates");
    assert.equal(leftPoint.rightTargetMode, "target");

    // Older brains without right* fields keep their shared configuration.
    const legacy = normalizeConditions([pairCondition({ targetMode: "coordinates", targetX: 5, targetY: 5 })])[0];
    assert.equal(legacy.rightTargetMode, "coordinates");
    assert.equal(legacy.rightTargetX, 5);

    // A non-pair right side carries no right pair fields.
    const plain = normalizeConditions([pairCondition({ right: { type: "number", value: 50 }, rightTargetMode: "coordinates" })])[0];
    assert.equal("rightTargetMode" in plain, false);

    const inspection = inspectAbilityStrategyConditions({
        roots: [{ branches: [{ conditions: [independent], actions: [] }] }],
    }, payload())[0];
    assert.notEqual(inspection.value, inspection.comparedTo);
});

test("condition variable labels are short and ids are unchanged", () => {
    const labels = Object.fromEntries(STATE_VARIABLES.map((variable) => [variable.id, variable.label]));
    assert.deepEqual({
        "match.elapsedSeconds": labels["match.elapsedSeconds"],
        "selectable.hp": labels["selectable.hp"],
        "selectable.distance": labels["selectable.distance"],
        "selectable.inView": labels["selectable.inView"],
        "selectable.dangerZoneEdgeDistance": labels["selectable.dangerZoneEdgeDistance"],
        "bot.selectedAbilityCooldownMs": labels["bot.selectedAbilityCooldownMs"],
        "bot.selectedAbilityPreparationMs": labels["bot.selectedAbilityPreparationMs"],
        "bot.selectedStatusEffectDurationMs": labels["bot.selectedStatusEffectDurationMs"],
    }, {
        "match.elapsedSeconds": "Match Time",
        "selectable.hp": "HP",
        "selectable.distance": "Distance",
        "selectable.inView": "In View",
        "selectable.dangerZoneEdgeDistance": "Zone Distance",
        "bot.selectedAbilityCooldownMs": "Cooldown Left",
        "bot.selectedAbilityPreparationMs": "Prep Time",
        "bot.selectedStatusEffectDurationMs": "Status Time",
    });
    assert.equal(new Set(STATE_VARIABLES.map((variable) => variable.label)).size, STATE_VARIABLES.length);
});


test("root actions fill categories after the matched branch; action-only roots run", () => {
    const walk = { action: "move_walk", movementMode: "absolute", movementDirection: 90 };
    const brain = { version: "bot-logic-tree-v2", roots: [{ id: "r", priority: 1, actions: [walk], branches: [
        { id: "b", priority: 1, conditions: [{ type: "always" }], actions: [{ action: "rotate_toward_enemy" }], children: [] },
    ] }] };
    assert.equal(selectAbilityStrategyActionPlan(brain, payload()).movement.action, "move_walk");
    assert.equal(selectAbilityStrategyActionPlan({ ...brain, roots: [{ ...brain.roots[0], branches: [] }] }, payload()).movement.action, "move_walk");
    brain.roots[0].branches[0].actions = [{ ...walk, movementDirection: 180 }];
    assert.equal(selectAbilityStrategyActionPlan(brain, payload()).movement.movementDirection, 180);
});

test("orphans survive normalization and save, never run, and share budgets", () => {
    const brain = { version: "bot-logic-tree-v2", roots: [], nodePositions: { loose: { x: 20, y: 30 } }, orphans: [
        { id: "loose", kind: "conditional", priority: 1, conditions: [{ type: "always" }], actions: [{ action: "move_walk" }], children: [] },
        { id: "loose-action", kind: "action", action: "rotate_toward_enemy" },
    ] };
    const normalized = normalizeAbilityStrategyConfiguration(brain);
    assert.deepEqual(normalizeAbilityStrategyConfiguration(JSON.parse(JSON.stringify(normalized))), normalized);
    assert.equal(normalized.orphans[0].id, "loose");
    assert.deepEqual(normalized.nodePositions.loose, { x: 20, y: 30 });
    assert.equal(selectAbilityStrategyActionPlan(brain, payload()).movement, undefined);
    assert.equal(countConditionSlots(brain), 1);
    assert.equal(validateAbilityStrategyConfiguration(normalized).errors.length, 0);
    assert.match(validateAbilityStrategyConfiguration(brain).warnings[0], /3 nodes aren't connected/);
    assert.ok(validateAbilityStrategyConfiguration({ ...brain, orphans: [{ id: "bad", kind: "action", action: "eval" }] }).errors.length);
});


test("connected and orphan actions and conditions share their respective limits", () => {
    const roots = [{ actions: Array.from({ length: 100 }, () => ({ action: "variable", variableId: "custom.a", value: false })), branches: [] }];
    const orphans = [{ id: "extra", kind: "action", action: "move_walk" }];
    assert.equal(countActionSlots({ roots, orphans }), 101);
    assert.ok(validateAbilityStrategyConfiguration({ roots, orphans }).errors.some((e) => e.includes("action limit")));
    const conditions = Array.from({ length: 301 }, (_, index) => ({ id: `c-${index}`, kind: "conditional", conditions: [{ type: "always" }], actions: [{ action: "none" }], children: [] }));
    assert.equal(countConditionSlots({ roots: [], orphans: conditions }), 301);
    assert.ok(validateAbilityStrategyConfiguration({ roots: [], orphans: conditions }).errors.some((e) => e.includes("301/300")));
    for (const invalid of [{ id: "a", kind: "conditional", conditions: [{ type: "eval" }], actions: [{ action: "none" }] }, { id: "a", kind: "action", action: "move_walk", movementDirection: 999 }, { id: "a", kind: "action", action: "move_walk", children: [] }]) {
        assert.ok(validateAbilityStrategyConfiguration({ roots: [], orphans: [invalid] }).errors.length);
    }
    assert.doesNotThrow(() => validateAbilityStrategyConfiguration({ roots: [], orphans: "bad" }));
});

function graphNodeIds(roots) {
    const ids = [];
    const walk = (branches) => (branches ?? []).forEach((branch) => { ids.push(branch.id, ...(branch.actions ?? []).map((entry) => entry.id)); walk(branch.children); });
    roots.forEach((root) => { ids.push(root.id); walk(root.branches); });
    return ids;
}

test("a conditional keeps its own id when an action is wired to it, and ids stay unique", () => {
    const brain = normalizeAbilityStrategyConfiguration({
        roots: [{ id: "root-1", branches: [{ id: "cond-1", conditions: [{ type: "always" }], actions: [{ id: "act-1", action: "move_walk" }] }] }],
        orphans: [{ id: "orphan-cond", kind: "conditional", conditions: [{ type: "always" }], actions: [{ id: "orphan-act", action: "move_walk" }] }],
    });
    assert.equal(brain.roots[0].branches[0].id, "cond-1");
    assert.equal(brain.roots[0].branches[0].actions[0].id, "act-1");
    assert.equal(brain.orphans[0].id, "orphan-cond");
    assert.equal(brain.orphans[0].kind, "conditional");
    assert.equal(brain.orphans[0].actions[0].id, "orphan-act");
    const ids = [...graphNodeIds(brain.roots), brain.orphans[0].id, ...brain.orphans[0].actions.map((entry) => entry.id)];
    assert.equal(new Set(ids).size, ids.length);
});

test("a legacy brain without ids keeps conditional and action ids distinct", () => {
    const brain = normalizeAbilityStrategyConfiguration({ roots: [{ branches: [
        { conditions: [{ type: "always" }], actions: [{ action: "move_walk" }] },
        { conditions: [{ type: "always" }], actions: [{ action: "move_walk" }] },
    ] }] });
    // Legacy actions carry no ids (the graph derives them from their branch); everything else must be unique.
    const ids = graphNodeIds(brain.roots).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 3);
});
