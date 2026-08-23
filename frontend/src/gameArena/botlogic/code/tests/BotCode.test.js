import assert from "node:assert/strict";
import test from "node:test";
import {
    createDefaultAbilityStrategyConfiguration,
    createExpressionCondition,
    createCodeRoot,
    countConditionSlots,
    inspectAbilityStrategyConditions,
    normalizeConditionSelections,
    normalizeAbilityStrategyConfiguration,
    normalizeRoots,
    setLogicBranchPriority,
    selectAbilityStrategyActionPlan,
    setLogicRootPriority,
    validateAbilityStrategyConfiguration,
} from "../BotCode.js";
import { getTutorialScenario, TUTORIAL_STEP_COUNT, validateSearchNodesLesson } from "../../../../tutorial/TutorialPresets.js";
import { ABILITY_TAGS, ACTION_TYPES, STATE_VARIABLES, TARGET_TYPES, TARGET_CAPABILITIES, VARIABLE_TAGS, abilityDefinitionsForVariable, variableHasTag } from "../contracts/BotLogicContracts.js";
import { ALL_ABILITY_DEFINITIONS, statusEffectDefinitionsForAbilities } from "../../../loadout/BotLoadout.js";
import { compareAngleValues } from "../runtime/conditionEvaluator.js";
import { matchingStrategyTargets, resolveAbilityStrategyTarget } from "../runtime/targeting.js";
import { absoluteMovementAngle, normalizeRelativeMovementDegrees, relativeMovementAngle, relativeMovementVector, vectorToCompassDegrees } from "../../planner/arenaAngles.js";
import { buildDeterministicLogicAction } from "../../planner/ArenaActionPlanner.js";
import { nodePositionsForGraph, offsetsForGraphPositions } from "../configuration/nodePositions.js";

function payload(overrides = {}) {
    return {
        playerModel: { x: 400, y: 400, hp: 100, abilities: ["swing", "concussive_shot"], abilityCooldowns: {}, ...overrides.playerModel },
        closingZone: overrides.closingZone ?? null,
        objects: overrides.objects ?? [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 180 }],
    };
}

test("bot-code targets and action capabilities are derived from gameplay contracts", () => {
    const entityAbilities = ALL_ABILITY_DEFINITIONS.filter((ability) => ability.entityType);
    for (const ability of entityAbilities) {
        assert.equal(TARGET_TYPES.some((target) => target.abilityId === ability.id), true);
    }
    assert.equal(ACTION_TYPES.find((action) => action.id === 22)?.locationTarget, true);
    assert.equal(ACTION_TYPES.find((action) => action.id === 24)?.coordinateTarget, true);
    assert.equal(ACTION_TYPES.find((action) => action.id === 25)?.orientationConfig, true);
    assert.equal(TARGET_TYPES.some((target) => target.id === "opponent_singularity_zone"), true);
    assert.equal(TARGET_TYPES.some((target) => target.id === "my_singularity_zone"), true);
    assert.equal(TARGET_TYPES.some((target) => target.id === "singularity_zone"), false);
    assert.equal(TARGET_TYPES.find((target) => target.id === "opponent_grenade")?.healthBearing, false);
    assert.equal(TARGET_TYPES.find((target) => target.id === "opponent_hunter_drone")?.healthBearing, true);
    assert.equal(ACTION_TYPES.find((action) => action.id === "rotate_toward_enemy")?.angleTarget, true);
});

test("health conditionals reject non-health targets and signed HP net changes stay enabled", () => {
    const hp = STATE_VARIABLES.find((variable) => variable.id === "target.hp");
    const netChange = STATE_VARIABLES.find((variable) => variable.id === "my.hpNetChangeLastTick");
    assert.equal(hp.targetCapability, TARGET_CAPABILITIES.HEALTH);
    assert.equal(netChange.tags.includes(VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER), true);

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: hp.id,
            target: "opponent_grenade",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].leftTarget, "opponent");
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

test("target type count selects an object type without target ordering", () => {
    const count = STATE_VARIABLES.find((variable) => variable.id === "target.count");
    const age = STATE_VARIABLES.find((variable) => variable.id === "target.age");
    assert.equal(count.targetOrderable, false);
    assert.notEqual(age.targetOrderable, false);
    assert.notEqual(createExpressionCondition(count).leftTarget, "opponent");

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: count.id,
            leftTarget: "opponent_grenade:farthest:2",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].leftTarget, "opponent_grenade");

    const orderedAge = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: age.id,
            leftTarget: "opponent_grenade:farthest:2",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(orderedAge.roots[0].branches[0].conditions[0].leftTarget, "opponent_grenade:farthest:2");
});

test("target-count defaults follow the visible entity type and inspection uses its base label", () => {
    const count = STATE_VARIABLES.find((variable) => variable.id === "target.count");
    const visibleTargets = TARGET_TYPES.filter((target) => ["opponent", "opponent_fireball"].includes(target.id));
    assert.equal(createExpressionCondition(count, visibleTargets).leftTarget, "opponent_fireball");

    const configuration = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: count.id,
            leftTarget: "opponent_fireball",
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
    assert.equal(inspection.target, "Shoot Fireball by Opponent 1");
    assert.equal(inspection.value, 1);
});

test("target existence and age conditions resolve spawned opponent entities", () => {
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: "east" };
    const configuration = {
        roots: [{ branches: [{
            id: "singularity-old-enough",
            conditions: [
                {
                    type: "expression",
                    left: "target.exists",
                    leftTarget: "opponent_singularity_zone",
                    comparator: "eq",
                    right: { type: "boolean", value: true },
                },
                {
                    type: "expression",
                    left: "target.age",
                    leftTarget: "opponent_singularity_zone",
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

    assert.equal(result.movement?.id, "root-1-1-1");

    const inspection = inspectAbilityStrategyConditions(configuration, payload({
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, slot: 2 },
            { id: "singularity-1", type: "singularityZone", abilityId: 27, ownerId: "opponent-model", ownerSlot: 2, x: 500, y: 400, size: 240, ageMs: 100 },
        ],
    }));
    assert.equal(inspection[1].value, 0.1);
    assert.equal(inspection[1].result, false);
    assert.equal(inspection[1].targetSelector, "opponent_singularity_zone");
    assert.deepEqual(inspection[1].resolvedTarget, {
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
                left: "target.exists",
                leftTarget: "opponent_singularity_zone",
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
    })).movement?.id, "root-1-1-1");
});

test("target selectors keep shared runtime entities separated and order by age", () => {
    const objects = [
            { id: "opponent-model", type: "opponentModel", x: 700, y: 700, hp: 100, slot: 2 },
            { id: "hunter-old", type: "hunterDrone", abilityId: 17, ownerId: "opponent-model", ownerSlot: 2, x: 200, y: 100, ageMs: 5_000, hp: 20 },
            { id: "repeller-old", type: "hunterDrone", abilityId: 31, ownerId: "opponent-model", ownerSlot: 2, x: 300, y: 100, ageMs: 5_000, hp: 20 },
            { id: "repeller-new", type: "hunterDrone", abilityId: 31, ownerId: "opponent-model", ownerSlot: 2, x: 400, y: 100, ageMs: 1_000, hp: 20 },
    ];
    const state = {
        player: { id: "main", slot: 1, x: 100, y: 100 },
        opponent: { id: "opponent-model", slot: 2, x: 700, y: 700 },
        objects,
    };

    assert.deepEqual(matchingStrategyTargets(state, "opponent_hunter_drone").map((target) => target.id), ["hunter-old"]);
    assert.deepEqual(matchingStrategyTargets(state, "opponent_repeller_drone").map((target) => target.id), ["repeller-old", "repeller-new"]);
    assert.equal(resolveAbilityStrategyTarget(state, "opponent_repeller_drone:oldest:1").id, "repeller-old");
    assert.equal(resolveAbilityStrategyTarget(state, "opponent_repeller_drone:newest:1").id, "repeller-new");

    const exists = {
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: "target.exists",
            leftTarget: "opponent_repeller_drone",
            comparator: "eq",
            right: { type: "boolean", value: true },
        }], actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: "east" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(exists, payload({
        playerModel: state.player,
        objects: [objects[0], objects[1]],
    })).primary, null);
    assert.equal(selectAbilityStrategyActionPlan(exists, payload({ playerModel: state.player, objects })).movement?.id, "root-1-1-1");
});

test("target facing falls back to a bot when an entity target is supplied", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: "target.facing",
            leftTarget: "opponent_hunter_drone",
            comparator: "gt",
            right: { type: "number", value: 0 },
        }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].leftTarget, "opponent");
});

test("target speed uses a direction-independent per-tick movement magnitude", () => {
    const speed = STATE_VARIABLES.find((variable) => variable.id === "target.speed");
    assert.equal(speed.label, "Target Speed");

    const configuration = {
        roots: [{ branches: [{ id: "speed", conditions: [{
            type: "expression",
            left: "target.speed",
            comparator: "gt",
            right: { type: "number", value: 4 },
        }], actions: [{ action: "swing" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, movementVelocityX: 3, movementVelocityY: 4 }],
    })).primary.id, "root-1-1-1");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, movementVelocityX: -3, movementVelocityY: -4 }],
    })).primary.id, "root-1-1-1");
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
    })).primary.id, "root-1-1-1");

});

test("closing-zone edge distance uses signed bot-hitbox clearance instead of target-center distance", () => {
    const distance = STATE_VARIABLES.find((variable) => variable.id === "my.closingZoneEdgeDistance");
    const opponentDistance = STATE_VARIABLES.find((variable) => variable.id === "opponent.closingZoneEdgeDistance");
    assert.equal(distance.supportsTarget, undefined);
    assert.equal(distance.min, -1200);
    assert.equal(distance.max, 1200);
    assert.equal(variableHasTag(distance, VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER), true);
    assert.equal(opponentDistance.scope, "opponent");
    assert.equal(opponentDistance.min, -1200);
    assert.equal(opponentDistance.max, 1200);
    assert.equal(variableHasTag(opponentDistance, VARIABLE_TAGS.ALLOW_NEGATIVE_INTEGER), true);

    const configuration = {
        roots: [{ branches: [{ id: "outside-zone", conditions: [{
            type: "expression",
            left: distance.id,
            comparator: "lt",
            right: { type: "number", value: -15 },
        }], actions: [{ action: "swing" }] }] }],
    };
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[0].conditions[0].right.value, -15);
    const zone = { x: 500, y: 500, safeRadius: 400 };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        closingZone: zone,
        playerModel: { x: 900, y: 500, size: 60 },
    })).primary.id, "root-1-1-1");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        closingZone: zone,
        playerModel: { x: 700, y: 500, size: 60 },
    })).primary, null);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary, null);

    const opponentConfiguration = {
        roots: [{ branches: [{ id: "opponent-outside-zone", conditions: [{
            type: "expression",
            left: opponentDistance.id,
            comparator: "lt",
            right: { type: "number", value: -15 },
        }], actions: [{ action: "swing" }] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(opponentConfiguration, payload({
        closingZone: zone,
        objects: [{ id: "opponent-model", type: "opponentModel", x: 900, y: 500, size: 60, hp: 100 }],
    })).primary.id, "root-1-1-1");
});

test("conditional ability choices include standard abilities and filter charges to real resources", () => {
    const equipped = new Set(ALL_ABILITY_DEFINITIONS.map((ability) => ability.id));
    const ready = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityReady");
    const charges = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityCharges");

    assert.equal(charges.requiredTag, ABILITY_TAGS.CHARGES);
    assert.equal(abilityDefinitionsForVariable(ready, equipped).some((ability) => ability.id === 2), false);
    assert.equal(abilityDefinitionsForVariable(ready, equipped).some((ability) => ability.id === 19), true);
    assert.equal(abilityDefinitionsForVariable(ready, equipped).some((ability) => ability.id === 20), true);
    assert.deepEqual(abilityDefinitionsForVariable(charges, equipped).map((ability) => ability.id), [3, 5]);

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "expression", left: charges.id, ability: "swing", comparator: "gt", right: { type: "number", value: 0 } }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].left, "match.elapsedSeconds");
    assert.equal(normalized.roots[0].branches[0].conditions[0].ability, undefined);

    const defaulted = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "expression", left: charges.id, comparator: "gt", right: { type: "number", value: 0 } }], actions: [] }] }],
    });
    assert.equal(defaulted.roots[0].branches[0].conditions[0].ability, 3);
});

test("conditional ability choices expose active state and remaining active time", () => {
    const equipped = new Set(ALL_ABILITY_DEFINITIONS.map((ability) => ability.id));
    const active = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityActive");
    const onCooldown = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityOnCooldown");
    const activeTime = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityActiveMs");

    assert.equal(active.valueType, "boolean");
    assert.equal(onCooldown.valueType, "boolean");
    assert.equal(activeTime.valueType, "number");
    assert.equal(activeTime.suffix, "s");
    assert.equal(activeTime.min, 0);
    assert.equal(abilityDefinitionsForVariable(active, equipped).some((ability) => ability.id === 9), true);
    assert.equal(abilityDefinitionsForVariable(onCooldown, equipped).some((ability) => ability.id === 9), true);
    assert.equal(abilityDefinitionsForVariable(activeTime, equipped).some((ability) => ability.id === 9), true);

    const configuration = {
        roots: [{ branches: [
            {
                id: "active-ability",
                conditions: [
                    { type: "expression", left: active.id, ability: "concussive_shot", comparator: "eq", right: { type: "boolean", value: true } },
                    { type: "expression", left: activeTime.id, ability: "concussive_shot", comparator: "gt", right: { type: "number", value: 0.5 } },
                ],
                actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: "north" }],
            },
            { id: "fallback", conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] },
        ] }],
    };

    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { abilityActiveMs: { concussive_shot: 850 } },
    })).primary.id, "root-1-1-1");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary.id, "root-1-1-2");
});

test("ability phase conditionals expose mutually exclusive active, cooldown, preparation, and ready states", () => {
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: "east" };
    const phaseConfiguration = (conditions) => ({
        roots: [{ branches: [{ id: "phase", conditions, actions: [action] }] }],
    });
    const condition = (left, comparator, value, extra = {}) => ({
        type: "expression",
        left,
        comparator,
        right: { type: typeof value === "boolean" ? "boolean" : "number", value },
        ability: "concussive_shot",
        ...extra,
    });

    const activePlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("my.selectedAbilityActive", "eq", true),
        condition("my.selectedAbilityOnCooldown", "eq", false),
        condition("my.selectedAbilityCooldownMs", "eq", 0),
        condition("my.selectedAbilityReady", "eq", false),
    ]), payload({
        playerModel: { abilityActiveMs: { concussive_shot: 500 }, abilityCooldowns: { concussive_shot: 3000 } },
    }));
    assert.equal(activePlan.movement?.id, "root-1-1-1");

    const cooldownPlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("my.selectedAbilityActive", "eq", false),
        condition("my.selectedAbilityOnCooldown", "eq", true),
        condition("my.selectedAbilityCooldownMs", "gt", 0),
        condition("my.selectedAbilityReady", "eq", false),
    ]), payload({
        playerModel: { abilityActiveMs: { concussive_shot: 0 }, abilityCooldowns: { concussive_shot: 500 } },
    }));
    assert.equal(cooldownPlan.movement?.id, "root-1-1-1");

    const preparationPlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("my.selectedAbilityPreparing", "eq", true),
        condition("my.selectedAbilityPreparationMs", "gt", 0),
        condition("my.selectedAbilityActive", "eq", false),
        condition("my.selectedAbilityActiveMs", "eq", 0),
        condition("my.selectedAbilityOnCooldown", "eq", false),
        condition("my.selectedAbilityCooldownMs", "eq", 0),
        condition("my.selectedAbilityReady", "eq", false),
    ]), payload({
        playerModel: { preparingAbility: 9, preparingMs: 400 },
    }));
    assert.equal(preparationPlan.movement?.id, "root-1-1-1");

    const readyPlan = selectAbilityStrategyActionPlan(phaseConfiguration([
        condition("my.selectedAbilityActive", "eq", false),
        condition("my.selectedAbilityPreparing", "eq", false),
        condition("my.selectedAbilityOnCooldown", "eq", false),
        condition("my.selectedAbilityReady", "eq", true),
    ]), payload());
    assert.equal(readyPlan.movement?.id, "root-1-1-1");
});

test("ability condition defaults and persisted selections use the visible ability options", () => {
    const active = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityActive");
    const visible = {
        ...active,
        abilityOptions: [
            { id: 33, label: "Overclock" },
            { id: 16, label: "Reactive Armor" },
        ],
    };

    assert.equal(createExpressionCondition(visible).ability, 33);
    assert.equal(normalizeConditionSelections({ type: "expression", left: active.id, ability: 1 }, visible).ability, 33);
    assert.equal(normalizeConditionSelections({ type: "expression", left: active.id, ability: "16" }, visible).ability, 16);
});

test("ability conditionals resolve several selected abilities and numeric preparation state", () => {
    const activeConditions = [
        [16, "reactive_armor"],
        [19, "dash"],
        [33, "overclock"],
    ];
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: "north" };
    for (const [abilityId, ability] of activeConditions) {
        const result = selectAbilityStrategyActionPlan({
            roots: [{ branches: [{ id: `active-${abilityId}`, conditions: [{
                type: "expression",
                left: "my.selectedAbilityActive",
                ability,
                comparator: "eq",
                right: { type: "boolean", value: true },
            }], actions: [action] }] }],
        }, payload({
            playerModel: { abilities: [16, 19, 33], abilityActiveMs: { [abilityId]: 500 } },
        }));
        assert.equal(result.movement?.id, "root-1-1-1", ability);
    }

    const preparing = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ id: "preparing", conditions: [
            {
                type: "expression",
                left: "my.selectedAbilityPreparing",
                ability: "rail_shot",
                comparator: "eq",
                right: { type: "boolean", value: true },
            },
            {
                type: "expression",
                left: "my.selectedAbilityPreparationMs",
                ability: "rail_shot",
                comparator: "gt",
                right: { type: "number", value: 0.5 },
            },
        ], actions: [action] }] }],
    }, payload({
        playerModel: { abilities: [13], preparingAbility: 13, preparingMs: 700 },
    }));
    assert.equal(preparing.movement?.id, "root-1-1-1");
});

test("condition inspection identifies the ability represented by My Ability Active", () => {
    const active = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityActive");
    const inspection = inspectAbilityStrategyConditions({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: active.id,
            ability: "reactive_armor",
            comparator: "eq",
            right: { type: "boolean", value: true },
        }], actions: [] }] }],
    }, payload({
        playerModel: { abilities: [16, 19], abilityActiveMs: { 16: 2500 } },
    }))[0];

    assert.deepEqual(inspection.ability, { id: 16, name: "reactive_armor", label: "Reactive Armor" });
    assert.equal(inspection.value, true);
    assert.equal(inspection.result, true);
});

test("numeric-string ability selections preserve Dash active-state conditions", () => {
    const active = STATE_VARIABLES.find((variable) => variable.id === "my.selectedAbilityActive");
    const configuration = {
        roots: [{ branches: [{
            id: "dash-active",
            conditions: [{ type: "expression", left: active.id, ability: "19", comparator: "eq", right: { type: "boolean", value: true } }],
            actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: "north" }],
        }, { id: "fallback", conditions: [{ type: "always" }], actions: [{ action: "none" }] }] }],
    };

    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[0].conditions[0].ability, 19);
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        playerModel: { abilityActiveMs: { 19: 850 } },
    })).primary.id, "root-1-1-1");
});

test("angle condition inputs use signed full-turn bounds", () => {
    const angles = STATE_VARIABLES.filter((variable) => variable.suffix === "deg");
    assert.ok(angles.length > 0);
    assert.ok(angles.every((variable) => variable.angle && variable.min === -360 && variable.max === 360));

    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{ type: "expression", left: "target.facing", comparator: "gt", right: { type: "number", value: 999 } }], actions: [] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].conditions[0].right.value, 360);
});

test("movement actions normalize relative angles and discard movement offsets", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ actions: [{
            action: "move_walk",
            movementMode: "coordinates",
            movementDirection: -90,
            targetX: 125,
            targetY: 640,
            targetOffsetX: 80,
            targetOffsetY: -40,
        }] }] }],
    });
    const movement = normalized.roots[0].branches[0].actions[0];

    assert.equal(movement.movementDirection, -90);
    assert.equal(movement.targetMode, "coordinates");
    assert.equal(movement.targetX, 125);
    assert.equal(movement.targetY, 640);
    assert.equal("targetOffsetX" in movement, false);
    assert.equal("targetOffsetY" in movement, false);

});

test("absolute walk angles use the north-zero clockwise compass", () => {
    const normalized = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ actions: [{
            action: "move_walk",
            movementMode: "absolute",
            movementDirection: -90,
        }] }] }],
    });
    assert.equal(normalized.roots[0].branches[0].actions[0].movementDirection, -90);
    assert.equal(absoluteMovementAngle("east"), 90);
    assert.equal(absoluteMovementAngle("west"), 270);

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
    const right = relativeMovementVector(0, -100, relativeMovementAngle(90));
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

test("target directions compare positive and negative angle equivalents", () => {
    assert.equal(compareAngleValues(350, "lt", 50), true);
    assert.equal(compareAngleValues(-10, "lt", 50), true);
    assert.equal(compareAngleValues(50, "eq", -310), true);

    const configuration = {
        roots: [{ branches: [{ id: "angle", conditions: [{
            type: "expression",
            left: "target.bearingFromMe",
            comparator: "lt",
            right: { type: "number", value: 50 },
        }], actions: [{ action: "swing" }], children: [] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100, rotation: 180 }],
    })).primary.id, "root-1-1-1");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).primary.id, "root-1-1-1");

    const boundedConfiguration = {
        roots: [{ branches: [{ id: "centered-angle", conditions: [
            { type: "expression", left: "target.bearingFromMe", comparator: "gte", right: { type: "number", value: -50 } },
            { type: "expression", left: "target.bearingFromMe", comparator: "lt", right: { type: "number", value: 50 } },
        ], actions: [{ action: "swing" }], children: [] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(boundedConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 400, y: 300, hp: 100, rotation: 180 }],
    })).primary.id, "root-1-1-1");

    const facingConfiguration = {
        roots: [{ branches: [{ id: "facing-range", conditions: [
            { type: "expression", left: "target.facing", comparator: "gt", right: { type: "number", value: 10 } },
            { type: "expression", left: "target.facing", comparator: "lt", right: { type: "number", value: 50 } },
        ], actions: [{ action: "swing" }], children: [] }] }],
    };
    assert.equal(selectAbilityStrategyActionPlan(facingConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 30 }],
    })).primary.id, "root-1-1-1");
    assert.equal(selectAbilityStrategyActionPlan(facingConfiguration, payload({
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, hp: 100, rotation: 70 }],
    })).primary, null);
});

test("timed self buffs are available to status-effect conditionals", () => {
    assert.deepEqual(statusEffectDefinitionsForAbilities([33]), [{ id: "overclock", label: "Overclock" }]);
});

test("status-effect condition defaults follow the available status options instead of Burn", () => {
    const statusVariable = STATE_VARIABLES.find((variable) => variable.id === "my.selectedStatusEffectActive");
    const overclockVariable = {
        ...statusVariable,
        statusEffectOptions: statusEffectDefinitionsForAbilities([33]),
    };
    assert.equal(createExpressionCondition(overclockVariable).statusEffect, "overclock");

    const normalizedMissingSelection = normalizeAbilityStrategyConfiguration({
        roots: [{ branches: [{ conditions: [{
            type: "expression",
            left: statusVariable.id,
            comparator: "eq",
            right: { type: "boolean", value: true },
        }], actions: [] }] }],
    });
    assert.equal(normalizedMissingSelection.roots[0].branches[0].conditions[0].statusEffect, null);

    const slowVariable = {
        ...statusVariable,
        statusEffectOptions: [{ id: "slow", label: "Slow" }, { id: "burn", label: "Burn" }],
    };
    assert.equal(createExpressionCondition(slowVariable).statusEffect, "slow");
    assert.equal(normalizeConditionSelections({ type: "expression", left: statusVariable.id, statusEffect: "not-a-status" }, slowVariable).statusEffect, "slow");
});

test("status-effect conditionals resolve multiple effect types and labels", () => {
    assert.deepEqual(
        statusEffectDefinitionsForAbilities([5, 9, 15, 33]).map((effect) => effect.id),
        ["burn", "slow", "silence", "overclock"],
    );
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: "west" };
    for (const [statusEffect, label] of [["burn", "Burn"], ["slow", "Slow"], ["overclock", "Overclock"]]) {
        const result = selectAbilityStrategyActionPlan({
            roots: [{ branches: [{ id: `status-${statusEffect}`, conditions: [{
                type: "expression",
                left: "my.selectedStatusEffectActive",
                statusEffect: label,
                comparator: "eq",
                right: { type: "boolean", value: true },
            }], actions: [action] }] }],
        }, payload({
            playerModel: { statusEffects: [{ type: statusEffect, remainingMs: 1200 }] },
        }));
        assert.equal(result.movement?.id, "root-1-1-1", statusEffect);
    }
});

test("right-hand ability and status variables keep their own selection metadata", () => {
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: "east" };
    const abilityResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ id: "right-ability", conditions: [{
            type: "expression",
            left: "my.hp",
            comparator: "lt",
            right: { type: "variable", value: "my.selectedAbilityCooldownMs" },
            ability: "dash",
        }], actions: [action] }] }],
    }, payload({
        playerModel: { hp: 1, abilities: [19], abilityCooldowns: { 19: 1300 } },
    }));
    assert.equal(abilityResult.movement?.id, "root-1-1-1");

    const statusResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ id: "right-status", conditions: [{
            type: "expression",
            left: "my.hp",
            comparator: "lt",
            right: { type: "variable", value: "my.selectedStatusEffectDurationMs" },
            statusEffect: "overclock",
        }], actions: [action] }] }],
    }, payload({
        playerModel: { hp: 1, statusEffects: [{ type: "overclock", remainingMs: 3200 }] },
    }));
    assert.equal(statusResult.movement?.id, "root-1-1-1");
});

test("status conditions read Overclock like Burn from the generic status collection", () => {
    const activeCondition = (statusEffect) => ({
        type: "expression",
        left: "my.selectedStatusEffectActive",
        statusEffect,
        comparator: "eq",
        right: { type: "boolean", value: true },
    });
    const durationCondition = {
        type: "expression",
        left: "my.selectedStatusEffectDurationMs",
        statusEffect: "overclock",
        comparator: "gt",
        right: { type: "number", value: 3 },
    };
    const action = { action: "move_walk", movementMode: "absolute", movementDirection: "west" };
    for (const statusEffect of ["burn", "overclock"]) {
        const configuration = { roots: [{ branches: [{ conditions: [activeCondition(statusEffect)], actions: [action] }] }] };
        const result = selectAbilityStrategyActionPlan(configuration, payload({
            playerModel: {
                abilities: [33],
                statusEffects: [{ type: statusEffect, remainingMs: 3200 }],
            },
        }));
        assert.equal(result.movement?.id, "root-1-1-1", statusEffect);
    }

    const durationResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [durationCondition], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [33],
            statusEffects: [{ type: "overclock", remainingMs: 3200 }],
        },
    }));
    assert.equal(durationResult.movement?.id, "root-1-1-1");

    const inspection = inspectAbilityStrategyConditions({
        roots: [{ branches: [{ conditions: [durationCondition], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [33],
            statusEffects: [{
                type: "overclock",
                remainingMs: 3200,
                effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
            }],
        },
    }))[0];
    assert.equal(inspection.target, null);
    assert.equal(inspection.statusEffect, "overclock");
    assert.deepEqual(inspection.statusEffectState, {
        type: "overclock",
        mode: "duration",
        active: true,
        remainingMs: 3200,
        effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
    });

    const effectRecordResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [activeCondition("overclock")], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [33],
            statusEffects: [{
                type: "overclock",
                remainingMs: 3200,
                effects: [{ type: "cooldown_modifier", mode: "constant", multiplier: 0.5 }],
            }],
        },
    }));
    assert.equal(effectRecordResult.movement?.id, "root-1-1-1");

    const labelSelectionResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [activeCondition("Overclock")], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [33],
            statusEffects: [{ type: "overclock", remainingMs: 3200 }],
        },
    }));
    assert.equal(labelSelectionResult.movement?.id, "root-1-1-1");

    const flatFieldResult = selectAbilityStrategyActionPlan({
        roots: [{ branches: [{ conditions: [durationCondition], actions: [action] }] }],
    }, payload({
        playerModel: {
            abilities: [33],
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
        blocks: [{ action: "swing", conditions: [{ type: "always" }] }],
        clusters: [{ blocks: [{ action: "swing", conditions: [{ type: "always" }] }] }],
    });
    assert.deepEqual(code, {
        version: "bot-logic-tree-v1",
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

test("roots preserve names and derive IDs from numeric priorities", () => {
    const roots = normalizeRoots([
        {
            id: "first",
            name: "Custom name",
            createdOrder: 4,
            branches: [{
                id: "conditional",
                createdOrder: 0,
                children: [{ id: "nested", createdOrder: 2, children: [] }],
            }],
        },
        { id: "second", name: "Another name", createdOrder: 9, branches: [] },
    ]);
    assert.deepEqual(roots.map((root) => root.createdOrder), [4, 9]);
    assert.deepEqual(roots.map((root) => root.id), ["root-5", "root-10"]);
    assert.deepEqual(roots.map((root) => root.name), ["Custom name", "Another name"]);
    assert.equal(roots[0].branches[0].id, "root-5-1-1");
    assert.equal(roots[0].branches[0].children[0].id, "root-5-2-3");
    const created = createCodeRoot(2);
    assert.equal(created.createdOrder, 2);
    assert.equal(created.name, "Root");
    assert.equal(created.id, "root-3");
});

test("numeric conditional order selects a later conditional", () => {
    const configuration = {
        roots: [{
            branches: [
                { id: "first", branchType: "if", createdOrder: 0, conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 1 } }], actions: [{ action: "swing" }] },
                { id: "second", branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] },
            ],
        }],
    };
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[1].branchType, "if");
    assert.equal(selectAbilityStrategyActionPlan(configuration, payload()).ability.action, 9);
});

test("root priority switches values without moving roots or changing execution", () => {
    const roots = [
        { id: "fire-root", name: "Fire", createdOrder: 0, branches: [{ id: "fire", conditions: [{ type: "always" }], actions: [{ action: "swing" }] }] },
        { id: "concussive-root", name: "Concussive", createdOrder: 1, branches: [{ id: "concussive", conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] }] },
    ];
    const switched = setLogicRootPriority(roots, 1, 1);
    assert.deepEqual(switched.map((root) => root.id), ["root-2", "root-1"]);
    assert.deepEqual(switched.map((root) => root.branches[0].id), ["root-2-1-1", "root-1-1-1"]);
    assert.deepEqual(switched.map((root) => root.createdOrder), [1, 0]);
    assert.equal(selectAbilityStrategyActionPlan({ roots: switched }, payload()).ability.action, 9);
});

test("conditional priority switches siblings without renumbering them", () => {
    const roots = [{ createdOrder: 0, branches: [
        { id: "first", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [] },
        { id: "third", branchType: "if", createdOrder: 2, conditions: [{ type: "always" }], actions: [] },
    ] }];
    const switched = setLogicBranchPriority(roots, 0, [1], 1);
    assert.deepEqual(switched[0].branches.map((branch) => branch.id), ["root-1-1-1", "root-1-1-3"]);
    assert.deepEqual(switched[0].branches.map((branch) => branch.createdOrder), [0, 2]);
});

test("tutorial teaches rotate before lock on", () => {
    const basicStrikeScenario = getTutorialScenario(2);
    const rotateScenario = getTutorialScenario(3);
    const lockOnScenario = getTutorialScenario(4);
    const dodgeScenario = getTutorialScenario(5);
    const combineScenario = getTutorialScenario(6);
    const rotateActions = rotateScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    const lockOnActions = lockOnScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    const basicStrikeActions = basicStrikeScenario.solution.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions ?? []));
    assert.equal(rotateActions.some((action) => action.action === "rotate_toward_enemy"), true);
    assert.equal(lockOnActions.some((action) => action.action === 20), true);
    assert.equal(rotateScenario.durationMs, 2000);
    assert.equal(lockOnScenario.durationMs, 1000);
    assert.equal(rotateScenario.goal, "heavy_slash");
    assert.equal(lockOnScenario.goal, "heavy_slash");
    assert.equal(dodgeScenario.durationMs, 3000);
    assert.equal(basicStrikeScenario.durationMs, 2000);
    assert.equal(combineScenario.durationMs, 3000);
    assert.equal(dodgeScenario.goal, "dodge_grenade");
    assert.equal(basicStrikeScenario.goal, "basic_strike");
    assert.equal(basicStrikeActions.some((action) => action.action === 34), true);
    assert.equal(basicStrikeActions.some((action) => action.action === 2), false);
});

test("tutorial roots are named and search validation preserves their priorities", () => {
    const scenario = getTutorialScenario(8);
    assert.equal(TUTORIAL_STEP_COUNT, 13);
    assert.equal(scenario.id, "search-roots");
    assert.equal(getTutorialScenario(9).id, "game-overview");
    assert.equal(getTutorialScenario(10).id, "ability-catalogue");
    assert.equal(getTutorialScenario(11).id, "conditional-catalogue");
    assert.deepEqual(scenario.emptyCode.roots.map((root) => root.name), ["A", "E", "C", "D", "H", "F", "G", "K", "I", "J", "N", "L", "M", "B", "O", "P", "Q", "R", "S", "T"]);
    assert.deepEqual(scenario.solution.roots.map((root) => root.createdOrder), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18]);
    assert.equal(validateSearchNodesLesson(scenario.emptyCode), false);
    assert.equal(validateSearchNodesLesson(scenario.solution), true);
});

test("roots count conditions and validate as a trainable code", () => {
    const configuration = {
        roots: [{ createdOrder: 0, branches: [{ id: "branch", branchType: "if", conditions: [{ type: "always" }], actions: [{ action: "swing" }], children: [] }] }],
    };
    assert.equal(countConditionSlots(configuration), 1);
    assert.deepEqual(validateAbilityStrategyConfiguration(configuration).errors, []);
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
