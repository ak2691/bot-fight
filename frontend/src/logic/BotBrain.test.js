import assert from "node:assert/strict";
import test from "node:test";
import {
    ACTION_TYPES,
    CONDITION_TYPES,
    CONDITION_DEFINITIONS,
    STATE_VARIABLES,
    TARGET_TYPES,
    actionSupportsTarget,
    countVariableSlots,
    countConditionSlots,
    createDefaultMeleeStrategyConfiguration,
    hasMeleeStrategyActions,
    moveLogicColumnPriority,
    setLogicColumnPriority,
    createExpressionCondition,
    createLogicCluster,
    createLogicBlock,
    normalizeMeleeStrategyConfiguration,
    resolveMeleeStrategyTarget,
    selectMeleeStrategyActionPlan,
    selectMeleeStrategyBlock,
    selectMeleeStrategyIntent,
    shouldAllowMeleeStrategyDash,
    shouldSuppressMeleeStrategyDash,
    validateMeleeStrategyConfiguration,
} from "./BotBrain.js";
import { buildStatePayload } from "../beta/modelPayloads/strategyStatePayload.js";
import { buildDeterministicLogicAction } from "./ArenaActionPlanner.js";
import { getTutorialScenario, TUTORIAL_STEP_COUNT, validateCustomVariablesLesson, validateSearchNodesLesson } from "../tutorial/TutorialPresets.js";

test("opponent condition and variable labels contain only one ordinal", () => {
    for (const definition of [...CONDITION_DEFINITIONS, ...STATE_VARIABLES]) {
        assert.doesNotMatch(definition.label, /Opponent 1 1\b/, definition.id);
    }
});

test("search-nodes tutorial starts shuffled and validates the completed brain", () => {
    const scenario = getTutorialScenario(8);
    assert.equal(TUTORIAL_STEP_COUNT, 11);
    assert.equal(scenario.emptyBrain.columns.length, 20);
    assert.deepEqual(
        scenario.emptyBrain.columns.map((column) => column.name),
        ["Node A", "Node E", "Node C", "Node D", "Node H", "Node F", "Node G", "Node K", "Node I", "Node J", "Node N", "Node L", "Node M", "Node B", "Node O", "Node P", "Node Q", "Node R", "Node S", "Node T"],
    );
    assert.equal(validateSearchNodesLesson(scenario.emptyBrain), false);
    assert.equal(validateSearchNodesLesson(scenario.solution), true);

    const wrongDirection = structuredClone(scenario.solution);
    wrongDirection.columns.find((column) => column.id === "lesson-search-node-q").branches[0].actions[0].movementDirection = "away";
    assert.equal(validateSearchNodesLesson(wrongDirection), false);
});

test("custom-variables tutorial requires reusable boolean logic and integer history", () => {
    const scenario = getTutorialScenario(7);
    assert.equal(validateCustomVariablesLesson(scenario.emptyBrain), false);
    assert.equal(validateCustomVariablesLesson(scenario.solution), true);

    const missingAbilityUse = structuredClone(scenario.solution);
    missingAbilityUse.columns = missingAbilityUse.columns.filter((column) => !column.id.endsWith("rail_shot"));
    assert.equal(validateCustomVariablesLesson(missingAbilityUse), false);

    const missingHitMemory = structuredClone(scenario.solution);
    missingHitMemory.columns = missingHitMemory.columns.filter((column) => column.id !== "lesson-variables-count");
    assert.equal(validateCustomVariablesLesson(missingHitMemory), false);
});

test("expression condition factory preserves a supplied custom variable definition", () => {
    assert.deepEqual(createExpressionCondition({
        id: "custom.counter",
        label: "Counter",
        valueType: "number",
        defaultValue: 7,
        min: -100,
        max: 100,
    }), {
        type: "expression",
        left: "custom.counter",
        comparator: "lt",
        right: { type: "number", value: 7 },
    });

    assert.deepEqual(createExpressionCondition({
        id: "custom.ready",
        label: "Ready",
        valueType: "boolean",
        defaultValue: false,
    }), {
        type: "expression",
        left: "custom.ready",
        comparator: "eq",
        right: { type: "boolean", value: true },
    });
});

function payload(overrides = {}) {
    return {
        playerModel: {
            x: 400,
            y: 400,
            size: 60,
            hp: 80,
            swingAvailable: true,
            blockAvailable: true,
            dashAvailable: true,
            gunAvailable: false,
            ...overrides.playerModel,
        },
        objects: [
            {
                id: "opponent-model",
                type: "opponentModel",
                x: 600,
                y: 400,
                size: 60,
                hp: 100,
                gunAvailable: false,
                velocityX: 0,
                velocityY: 0,
                ...overrides.opponent,
            },
            ...(overrides.objects ?? []),
        ],
    };
}

function selectedAbilityCondition(ability, {
    owner = "my",
    field = "Ready",
    comparator = "eq",
    value = true,
    join,
} = {}) {
    return {
        type: "expression",
        left: `${owner}.selectedAbility${field}`,
        ability,
        comparator,
        right: { type: typeof value === "boolean" ? "boolean" : "number", value },
        ...(join ? { join } : {}),
    };
}

function selectedAbilityBlock(ability, action, options) {
    return {
        ...createLogicBlock("always", action),
        conditions: [selectedAbilityCondition(ability, options)],
    };
}

test("Bot Room resolves Opponent 1 by fighter id for Walk, Dash, and Micro Dash", () => {
    const state = buildStatePayload([
        { id: "main", type: "circle", slot: 1, x: 400, y: 400, rotation: 0, hp: 100, size: 60, abilities: ["dash", "micro_dash"], dashCooldownMs: 0, dashActiveMs: 0, abilityCooldowns: { micro_dash: 0 } },
        // Reproduce the failure: the canvas type drifted, but fighter identity
        // remains the stable opponent-model id.
        { id: "opponent-model", type: "circle", slot: 2, x: 600, y: 500, rotation: 180, hp: 100, size: 60, abilities: [] },
    ], "custom");
    const configuration = {
        version: "bot-logic-tree-v1",
        blocks: [{
            id: "target-actions",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [
                { action: "move_walk", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" },
                { action: "dash", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" },
                { action: "micro_dash", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" },
            ],
        }],
    };

    assert.equal(state.objects.find((object) => object.id === "opponent-model")?.type, "opponentModel");
    const plan = selectMeleeStrategyActionPlan(configuration, state);
    assert.equal(plan.movement?.action, "move_walk");
    assert.equal(plan.dash?.action, "dash");
    assert.equal(plan.ability?.action, "micro_dash");
});

test("target-relative Away uses opposite facing when fighters occupy the same position", () => {
    const action = buildDeterministicLogicAction({
        version: "bot-logic-tree-v1",
        blocks: [{
            id: "overlap-retreat",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [{ action: "move_walk", movementMode: "target", movementDirection: "away", actionTarget: "opponent" }],
        }],
    }, {
        playerModel: { id: "main", x: 500, y: 500, rotation: 180, hp: 20, abilities: [] },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 500, y: 500, rotation: 0, hp: 1000, abilities: [] }],
    });

    assert.ok(Math.abs(action.dx) < 0.001);
    assert.ok(action.dy < 0);
});

test("step seven solution stops approaching inside Sword Swing range", () => {
    const configuration = getTutorialScenario(6).solution;
    const action = buildDeterministicLogicAction(configuration, {
        playerModel: { id: "main", x: 500, y: 480, rotation: 180, hp: 100, abilities: ["swing"], swingAvailable: true },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 500, y: 560, rotation: 0, hp: 1000, abilities: ["swing"] }],
    });

    assert.equal(action.dx, 0);
    assert.equal(action.dy, 0);
    assert.equal(action.abilityAction?.action, "swing");
});

test("normalizes deterministic logic blocks without testing knobs", () => {
    const configuration = normalizeMeleeStrategyConfiguration({
        epochLimit: 999,
        blocks: [{ conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 999 } }], action: "move_outward", sampleCount: 99999 }],
    });

    assert.equal(configuration.version, "bot-logic-tree-v1");
    assert.equal(configuration.epochLimit, undefined);
    assert.equal(configuration.blocks[0].sampleCount, undefined);
    assert.equal(configuration.blocks[0].conditions[0].right.value, 100);
});

test("default strategy starts as a valid empty brain while non-empty veto-only brains are rejected", () => {
    const empty = createDefaultMeleeStrategyConfiguration();
    assert.equal(empty.blocks.length, 0);
    assert.deepEqual(validateMeleeStrategyConfiguration(empty).errors, []);

    const onlyVeto = { blocks: [createLogicBlock("enemy_distance_gt", "no_dash")] };
    assert.ok(validateMeleeStrategyConfiguration(onlyVeto).errors.some((error) => error.includes("bot brain action")));
});

test("legacy direct and fixed-ability conditionals are absent from the frontend contract", () => {
    assert.deepEqual(CONDITION_DEFINITIONS.map(({ id }) => id), ["always"]);
    const variableIds = new Set(STATE_VARIABLES.map(({ id }) => id));
    for (const id of ["my.swingReady", "my.shieldUp", "my.dashCooldownMs", "my.gunAmmo", "opponent.blockReady", "opponent.fireballCharges"]) {
        assert.equal(variableIds.has(id), false);
    }
    const normalized = normalizeMeleeStrategyConfiguration({
        blocks: [{ action: "swing", conditions: [{ type: "my_swing_ready" }] }],
    });
    assert.deepEqual(normalized.blocks[0].conditions[0], {
        type: "expression",
        left: "match.elapsedSeconds",
        comparator: "lt",
        right: { type: "number", value: 0 },
    });
});

test("first matching non-veto block is the selected priority action", () => {
    const closeRetreat = {
        ...createLogicBlock("enemy_distance_lt", "move_outward"),
        conditions: [{ type: "expression", left: "target.distance", comparator: "lt", right: { type: "number", value: 250 } }],
    };
    const alwaysEngage = {
        ...createLogicBlock("enemy_distance_gt", "move_inward"),
        conditions: [{ type: "expression", left: "target.distance", comparator: "gt", right: { type: "number", value: 10 } }],
    };

    const selected = selectMeleeStrategyBlock({ blocks: [closeRetreat, alwaysEngage] }, payload());
    assert.equal(selected.id, closeRetreat.id);

    const intent = selectMeleeStrategyIntent({ blocks: [closeRetreat, alwaysEngage] }, payload());
    assert.equal(intent.intent, "disengage_target");
});

test("always condition can drive arena-relative movement", () => {
    const north = createLogicBlock("always", "move_north");
    const selected = selectMeleeStrategyBlock({ blocks: [north] }, payload());
    const intent = selectMeleeStrategyIntent({ blocks: [north] }, payload());

    assert.equal(selected.id, north.id);
    assert.equal(intent.intent, "reposition");
    assert.equal(intent.target, "none");
    assert.equal(intent.movementStyle, "north");
});

test("always condition can drive arena-relative dash", () => {
    const northDash = createLogicBlock("always", "dash_north");
    const selected = selectMeleeStrategyBlock({ blocks: [northDash] }, payload());
    const intent = selectMeleeStrategyIntent({ blocks: [northDash] }, payload());

    assert.equal(selected.id, northDash.id);
    assert.equal(intent.intent, "reposition");
    assert.equal(intent.target, "none");
    assert.equal(intent.movementStyle, "north");
    assert.equal(intent.dash, 1);
});

test("logic tree selects the first matching sibling and descends into nested scopes", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        columns: [{
            id: "movement",
            name: "Movement",
            createdOrder: 1,
            branches: [{
                id: "parent",
                branchType: "if",
                createdOrder: 1,
                conditions: [createExpressionCondition("my.hp")],
                action: "move_stop",
                children: [
                    { id: "false-child", branchType: "if", createdOrder: 1, conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 10 } }], action: "move_west" },
                    { id: "fallback-child", branchType: "else", createdOrder: 2, conditions: [], action: "move_east" },
                ],
            }],
        }],
    };
    configuration.columns[0].branches[0].conditions[0] = { type: "always" };
    assert.equal(selectMeleeStrategyBlock(configuration, payload()).action, "move_walk");
});

test("earliest-created matching column wins same-head conflicts without speculative warnings", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        columns: [
            { id: "later", name: "Later", createdOrder: 20, branches: [{ id: "later-move", branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], action: "move_west" }] },
            { id: "earlier", name: "Earlier", createdOrder: 10, branches: [{ id: "earlier-move", branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], action: "move_east" }] },
        ],
    };
    const plan = selectMeleeStrategyActionPlan(configuration, payload());
    assert.equal(plan.movement.action, "move_walk");
    assert.deepEqual(validateMeleeStrategyConfiguration(configuration).warnings, []);
});

test("lower priority numbers beat higher priority numbers", () => {
    const highPriorityRetreat = {
        ...createLogicBlock("enemy_distance_gt", "move_outward"),
        priority: 1,
        conditions: [{ type: "expression", left: "target.distance", comparator: "gt", right: { type: "number", value: 10 } }],
    };
    const lowerPriorityEngage = {
        ...createLogicBlock("enemy_distance_gt", "move_inward"),
        priority: 5,
        conditions: [{ type: "expression", left: "target.distance", comparator: "gt", right: { type: "number", value: 10 } }],
    };

    const selected = selectMeleeStrategyBlock({ blocks: [lowerPriorityEngage, highPriorityRetreat] }, payload());
    assert.equal(selected.id, highPriorityRetreat.id);
});

test("brain-node priority controls reorder root columns and execution order", () => {
    const columns = [
        { id: "fireball", name: "Fireball", createdOrder: 0, branches: [{ id: "fire", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: "shoot_fireball" }] }] },
        { id: "concussive", name: "Concussive", createdOrder: 1, branches: [{ id: "conc", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] }] },
    ];
    const reordered = moveLogicColumnPriority(columns, 1, -1);
    const state = payload({ playerModel: {
        abilities: ["shoot_fireball", "concussive_shot"],
        fireballAvailable: true,
        abilityCooldowns: { concussive_shot: 0 },
    } });

    assert.deepEqual(reordered.map((column) => column.id), ["concussive", "fireball"]);
    assert.deepEqual(reordered.map((column) => column.createdOrder), [0, 1]);
    assert.equal(selectMeleeStrategyActionPlan({ version: "bot-logic-tree-v1", columns: reordered }, state).ability.action, "concussive_shot");
});

test("setting a brain-node priority inserts it at that position and shifts displaced nodes", () => {
    const columns = ["one", "two", "three", "four", "five"].map((id, createdOrder) => ({ id, createdOrder }));

    const movedHigher = setLogicColumnPriority(columns, 4, 3);
    assert.deepEqual(movedHigher.map((column) => column.id), ["one", "two", "five", "three", "four"]);
    assert.deepEqual(movedHigher.map((column) => column.createdOrder), [0, 1, 2, 3, 4]);

    const movedLower = setLogicColumnPriority(columns, 1, 4);
    assert.deepEqual(movedLower.map((column) => column.id), ["one", "three", "four", "two", "five"]);
    assert.deepEqual(movedLower.map((column) => column.createdOrder), [0, 1, 2, 3, 4]);
});

test("an unavailable higher-priority ability falls through without losing the ability head", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        columns: [{
            id: "ability-priority",
            createdOrder: 1,
            branches: [
                { id: "fireball-first", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: "shoot_fireball" }] },
                { id: "concussive-second", branchType: "else_if", createdOrder: 1, conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] },
            ],
        }],
    };
    const coolingDown = payload({ playerModel: {
        abilities: ["shoot_fireball", "concussive_shot"],
        fireballAvailable: false,
        abilityCooldowns: { concussive_shot: 0 },
    } });
    const ready = payload({ playerModel: {
        abilities: ["shoot_fireball", "concussive_shot"],
        fireballAvailable: true,
        abilityCooldowns: { concussive_shot: 0 },
    } });

    assert.equal(selectMeleeStrategyActionPlan(configuration, coolingDown).ability?.action, "concussive_shot");
    assert.equal(selectMeleeStrategyActionPlan(configuration, ready).ability?.action, "shoot_fireball");
});

test("low-health retreat stays selected over lower-priority distance engage", () => {
    const lowHealthRetreat = {
        ...createLogicBlock("my_hp_lt", "move_outward"),
        priority: 1,
        conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 50 } }],
    };
    const distanceEngage = {
        ...createLogicBlock("enemy_distance_gt", "move_inward"),
        priority: 2,
        conditions: [{ type: "expression", left: "target.distance", comparator: "gt", right: { type: "number", value: 10 } }],
    };

    const plan = selectMeleeStrategyActionPlan({
        blocks: [lowHealthRetreat, distanceEngage],
    }, payload({ playerModel: { hp: 30 } }));

    assert.equal(plan.movement.id, lowHealthRetreat.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [lowHealthRetreat, distanceEngage],
    }, payload({ playerModel: { hp: 30 } })).intent, "disengage_target");
});

test("same-priority movement and dash blocks merge by action head", () => {
    const moveBlock = createLogicBlock("enemy_distance_gt", "move_inward");
    const dashBlock = createLogicBlock("enemy_distance_gt", "dash");
    const plan = selectMeleeStrategyActionPlan({ blocks: [moveBlock, dashBlock] }, payload());

    assert.equal(plan.movement.id, moveBlock.id);
    assert.equal(plan.dash.id, dashBlock.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [moveBlock, dashBlock] }, payload()).dash, 1);
});

test("dash blocks do not keep moving while dash is on cooldown", () => {
    const grenadeObject = {
        id: "grenade-opponent-model-1",
        type: "grenade",
        ownerId: "opponent-model",
        x: 500,
        y: 400,
        size: 12,
    };
    const dodgeGrenade = {
        ...createLogicBlock("target_exists", "dash_tangent_right"),
        conditions: [{ type: "expression", left: "target.exists", leftTarget: "opponent_grenade", comparator: "eq", right: { type: "boolean", value: true } }],
        actionTarget: "opponent_grenade",
    };
    const readyPlan = selectMeleeStrategyActionPlan({ blocks: [dodgeGrenade] }, payload({
        playerModel: { dashAvailable: true },
        objects: [grenadeObject],
    }));
    const cooldownPlan = selectMeleeStrategyActionPlan({ blocks: [dodgeGrenade] }, payload({
        playerModel: { dashAvailable: false },
        objects: [grenadeObject],
    }));

    assert.equal(readyPlan.dash.id, dodgeGrenade.id);
    assert.equal(readyPlan.dashMovement.id, dodgeGrenade.id);
    assert.equal(cooldownPlan.dash, undefined);
    assert.equal(cooldownPlan.dashMovement, undefined);
    assert.equal(shouldAllowMeleeStrategyDash({ blocks: [dodgeGrenade] }, payload({
        playerModel: { dashAvailable: false },
        objects: [grenadeObject],
    })), false);
});

test("micro dash executes independently of standard dash availability", () => {
    const plan = selectMeleeStrategyActionPlan({ blocks: [{
        id: "micro-dash-only",
        priority: 1,
        conditions: [{ type: "always" }],
        actions: [{ action: "micro_dash", movementMode: "absolute", movementDirection: "east" }],
    }] }, payload({ playerModel: { dashAvailable: false } }));
    assert.equal(plan.ability?.action, "micro_dash");
    assert.equal(plan.micro_dash?.movementDirection, "east");
    assert.equal(plan.dash, undefined);
});

test("pistol shot remains executable alongside a standard dash", () => {
    const plan = selectMeleeStrategyActionPlan({ blocks: [{
        id: "dash-and-pistol",
        priority: 1,
        conditions: [{ type: "always" }],
        actions: [{ action: "dash", movementMode: "absolute", movementDirection: "east" }, { action: "pistol_shot" }],
    }] }, payload({ playerModel: { dashAvailable: true } }));

    assert.equal(plan.dash?.action, "dash");
    assert.equal(plan.ability?.action, "pistol_shot");
    assert.equal(plan.pistol_shot?.action, "pistol_shot");
});

test("current bot-brain columns count as executable opponent actions", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        columns: [{
            id: "opponent-pistol-column",
            createdOrder: 1,
            branches: [{
                id: "opponent-pistol",
                branchType: "if",
                createdOrder: 1,
                priority: 1,
                conditions: [{ type: "always" }],
                action: "pistol_shot",
            }],
        }],
        blocks: [],
        clusters: [],
    };

    assert.equal(hasMeleeStrategyActions(configuration), true);
    assert.equal(selectMeleeStrategyActionPlan(configuration, payload()).ability?.action, "pistol_shot");
});

test("cluster conditions and cluster priority gate nested logic blocks", () => {
    const fallback = createLogicBlock("always", "move_inward");
    const cluster = {
        ...createLogicCluster("always"),
        priority: 1,
        conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 50 } }],
        blocks: [createLogicBlock("always", "move_inward")],
    };
    cluster.blocks[0].actionTarget = "object_1";
    cluster.blocks[0].conditions = [{ type: "always" }];

    const selectedHealthy = selectMeleeStrategyBlock({
        blocks: [{ ...fallback, priority: 5 }],
        clusters: [cluster],
    }, payload({ objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }] }));
    assert.equal(selectedHealthy.id, fallback.id);

    const selectedLowHp = selectMeleeStrategyBlock({
        blocks: [{ ...fallback, priority: 5 }],
        clusters: [cluster],
    }, payload({
        playerModel: { hp: 30 },
        objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
    }));
    assert.equal(selectedLowHp.id, cluster.blocks[0].id);
});

test("cluster blocks can inherit the cluster condition without their own IF condition", () => {
    const cluster = {
        ...createLogicCluster("my_hp_lt"),
        conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 50 } }],
        blocks: [{
            ...createLogicBlock("enemy_distance_gt", "move_outward"),
            conditions: [],
        }],
    };

    const normalized = normalizeMeleeStrategyConfiguration({ clusters: [cluster] });
    assert.equal(normalized.clusters[0].blocks[0].conditions.length, 0);

    const selected = selectMeleeStrategyBlock({ clusters: [cluster] }, payload({ playerModel: { hp: 30 } }));
    assert.equal(selected.id, cluster.blocks[0].id);
});

test("do-not-dash suppresses dash without replacing movement intent", () => {
    const noDashBlock = createLogicBlock("my_hp_gt", "no_dash");
    const moveBlock = createLogicBlock("enemy_distance_gt", "move_inward");
    const configuration = { blocks: [noDashBlock, moveBlock] };

    const intent = selectMeleeStrategyIntent(configuration, payload());
    assert.equal(shouldSuppressMeleeStrategyDash(configuration, payload()), true);
    assert.equal(intent.intent, "engage_target");
    assert.equal(intent.dash, 0);
});

test("opponent cooldown conditionals read opponent ability state", () => {
    const punishCooldown = selectedAbilityBlock("dash", "move_inward", {
        owner: "opponent",
        field: "CooldownMs",
        comparator: "gt",
        value: 0,
    });
    const selected = selectMeleeStrategyBlock({
        blocks: [punishCooldown],
    }, payload({
        opponent: {
            dashAvailable: false,
            dashCooldownRemainingMs: 500,
        },
    }));

    assert.equal(selected.id, punishCooldown.id);
});

test("fire gun conditionals select the ranged action head", () => {
    const fireWhenReady = selectedAbilityBlock("fire_gun", "fire_gun");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [fireWhenReady],
    }, payload({
        playerModel: {
            gunAvailable: true,
        },
    }));

    assert.equal(plan.gun.id, fireWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [fireWhenReady],
    }, payload({
        playerModel: {
            gunAvailable: true,
        },
    })).intent, "attack_target");
});

test("grenade conditionals select the ranged grenade action head", () => {
    const throwWhenReady = selectedAbilityBlock("throw_grenade", "throw_grenade");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [throwWhenReady],
    }, payload({
        playerModel: {
            grenadeAvailable: true,
        },
    }));

    assert.equal(plan.grenade.id, throwWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [throwWhenReady],
    }, payload({
        playerModel: {
            grenadeAvailable: true,
        },
    })).intent, "attack_target");
});

test("fireball conditionals select the mage fireball action head", () => {
    const shootWhenReady = selectedAbilityBlock("shoot_fireball", "shoot_fireball");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [shootWhenReady],
    }, payload({
        playerModel: {
            fireballAvailable: true,
            fireballCharges: 4,
        },
    }));

    assert.equal(plan.fireball.id, shootWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [shootWhenReady],
    }, payload({
        playerModel: {
            fireballAvailable: true,
            fireballCharges: 4,
        },
    })).intent, "attack_target");
});

test("stun conditionals select the mage stun action head", () => {
    const stunWhenReady = selectedAbilityBlock("stun", "stun");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [stunWhenReady],
    }, payload({
        playerModel: {
            stunAvailable: true,
        },
    }));

    assert.equal(plan.stun.id, stunWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [stunWhenReady],
    }, payload({
        playerModel: {
            stunAvailable: true,
        },
    })).intent, "attack_target");
});

test("dash is allowed only when a matching dash block owns the action and no veto matches", () => {
    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [createLogicBlock("enemy_distance_gt", "move_inward")],
    }, payload()), false);

    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [createLogicBlock("enemy_distance_gt", "dash")],
    }, payload()), true);

    const dashBlock = createLogicBlock("enemy_distance_gt", "dash");
    const vetoBlock = { ...createLogicBlock("my_hp_gt", "no_dash"), priority: 1 };
    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [dashBlock, vetoBlock],
    }, payload()), false);
});

test("fight-only target picker exposes one entry per target type", () => {
    assert.deepEqual(TARGET_TYPES.map((target) => target.id), [
        "opponent",
        "orbital_zone",
        "opponent_grenade",
        "opponent_fireball",
        "opponent_concussive_shot",
        "opponent_proximity_mine",
        "opponent_gravity_field",
        "opponent_silence_wave",
        "opponent_hunter_drone",
        "opponent_temporal_rewind_zone",
        "opponent_orbital_zone",
        "opponent_null_zone",
        "my_grenade",
        "my_fireball",
        "my_concussive_shot",
        "my_proximity_mine",
        "my_gravity_field",
        "my_silence_wave",
        "my_hunter_drone",
        "my_temporal_rewind_zone",
        "my_orbital_zone",
        "my_null_zone",
    ]);
    assert.ok(TARGET_TYPES.every((target) => !target.id.includes(":")));
    const legacyTargetRule = {
        ...createLogicBlock("always", "move_inward"),
        actionTarget: "defender_core",
    };
    assert.equal(normalizeMeleeStrategyConfiguration({ blocks: [legacyTargetRule] }).blocks[0].actionTarget, "opponent");
});

test("missing orbital-zone targets fall through to the next eligible priority", () => {
    const missingZone = {
        ...createLogicBlock("always", "move_inward"),
        priority: 1,
        actions: [{ action: "move_inward", actionTarget: "orbital_zone" }],
    };
    const fallback = { ...createLogicBlock("always", "move_outward"), priority: 2 };
    assert.equal(selectMeleeStrategyBlock({ blocks: [missingZone, fallback] }, payload()).id, fallback.id);
    const zone = { id: "orbital-1", type: "orbitalMarker", x: 500, y: 300, size: 260 };
    assert.equal(selectMeleeStrategyBlock({ blocks: [missingZone, fallback] }, payload({ objects: [zone] })).id, missingZone.id);
});

test("opponent grenade can be used as a condition and movement target", () => {
    const grenadeObject = {
        id: "grenade-opponent-model-1",
        type: "grenade",
        ownerId: "opponent-model",
        x: 500,
        y: 400,
        size: 12,
    };
    const dodgeGrenade = {
        ...createLogicBlock("target_exists", "move_outward"),
        conditions: [{ type: "expression", left: "target.exists", leftTarget: "opponent_grenade", comparator: "eq", right: { type: "boolean", value: true } }],
        actionTarget: "opponent_grenade",
    };
    const selected = selectMeleeStrategyBlock({
        blocks: [dodgeGrenade],
    }, payload({ objects: [grenadeObject] }));

    assert.equal(selected.id, dodgeGrenade.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [dodgeGrenade] }, payload({ objects: [grenadeObject] })).target, "opponent_grenade");
    assert.equal(resolveMeleeStrategyTarget({
        objects: payload({ objects: [grenadeObject] }).objects,
        opponent: { id: "opponent-model" },
        obstacles: [],
    }, "opponent_grenade")?.id, grenadeObject.id);
});

test("opponent grenade expression variables resolve from target selectors", () => {
    const grenadeNear = {
        ...createLogicBlock("always", "move_outward"),
        conditions: [{
            type: "expression",
            left: "target.exists",
            comparator: "eq",
            target: "opponent_grenade",
            right: { type: "boolean", value: true },
        }],
        actionTarget: "opponent_grenade",
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [grenadeNear] }, payload({
        objects: [{
            id: "grenade-opponent-model-1",
            type: "grenade",
            ownerId: "opponent-model",
            x: 500,
            y: 400,
            size: 12,
        }],
    })).id, grenadeNear.id);
});

test("opponent fireball target resolves the closest opponent fireball", () => {
    const farFireball = {
        id: "fireball-opponent-model-1",
        type: "fireball",
        ownerId: "opponent-model",
        x: 700,
        y: 400,
        size: 30,
    };
    const closeFireball = {
        id: "fireball-opponent-model-2",
        type: "fireball",
        ownerId: "opponent-model",
        x: 430,
        y: 400,
        size: 30,
    };
    const dodgeFireball = {
        ...createLogicBlock("target_exists", "move_outward"),
        conditions: [{ type: "expression", left: "target.exists", leftTarget: "opponent_fireball", comparator: "eq", right: { type: "boolean", value: true } }],
        actionTarget: "opponent_fireball",
    };
    const statePayload = payload({ objects: [farFireball, closeFireball] });

    assert.equal(selectMeleeStrategyBlock({ blocks: [dodgeFireball] }, statePayload).id, dodgeFireball.id);
    assert.equal(resolveMeleeStrategyTarget({
        objects: statePayload.objects,
        opponent: { id: "opponent-model" },
        player: statePayload.playerModel,
        obstacles: [],
    }, "opponent_fireball")?.id, closeFireball.id);
});

test("a dead opponent remains targetable while Target Alive reports false", () => {
    const statePayload = payload({ opponent: { hp: 0, alive: false, hittable: false } });
    const state = { player: statePayload.playerModel, opponent: statePayload.objects[0], objects: statePayload.objects, obstacles: [] };
    const target = resolveMeleeStrategyTarget(state, "opponent");
    const deadTargetRule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "target.alive",
            comparator: "eq",
            target: "opponent",
            right: { type: "boolean", value: false },
        }],
    };

    assert.equal(target?.id, "opponent-model");
    assert.equal(target?.hp, 0);
    assert.equal(selectMeleeStrategyBlock({ blocks: [deadTargetRule] }, statePayload)?.id, deadTargetRule.id);
});

test("ordered entity selectors require the requested ordinal and target count sees the full type", () => {
    const objects = [
        { id: "fireball-001", type: "fireball", ownerId: "opponent-model", x: 430, y: 400, size: 20, createdOrder: 1 },
        { id: "fireball-002", type: "fireball", ownerId: "opponent-model", x: 600, y: 400, size: 20, createdOrder: 2 },
        { id: "fireball-003", type: "fireball", ownerId: "opponent-model", x: 700, y: 400, size: 20, createdOrder: 3 },
    ];
    const state = { objects, opponent: { id: "opponent-model" }, player: { x: 400, y: 400 }, obstacles: [] };
    assert.equal(resolveMeleeStrategyTarget(state, "opponent_fireball:farthest:2")?.id, "fireball-002");
    assert.equal(resolveMeleeStrategyTarget({ ...state, objects: objects.slice(0, 2) }, "opponent_fireball:oldest:3"), null);

    const countRule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "target.count", comparator: "eq", target: "opponent_fireball:newest:3", right: { type: "number", value: 3 } }],
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [countRule] }, payload({ objects }))?.id, countRule.id);
});

test("rotation variables use north-zero clockwise bearings and fighter-only facing", () => {
    const rules = [
        ["target.bearingFromMe", 90],
        ["my.bearingFromTarget", 270],
        ["target.relativeBearing", 0],
        ["target.facing", 90],
    ].map(([left, value], index) => ({
        ...createLogicBlock("always", "move_stop"),
        id: `rotation-${index}`,
        conditions: [{ type: "expression", left, comparator: left === "target.bearingFromMe" ? "range" : "eq", target: "opponent", right: left === "target.bearingFromMe" ? { type: "range", min: value, max: value } : { type: "number", value } }],
    }));
    const state = payload({ playerModel: { x: 400, y: 400, rotation: 90 }, opponent: { x: 500, y: 400, rotation: 90 } });
    for (const rule of rules) assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, state)?.id, rule.id);
});

test("relative bearing offers shortest, clockwise, and counterclockwise angle choices", () => {
    const rules = [
        ["target.relativeBearing", 90],
        ["target.relativeBearingClockwise", 270],
        ["target.relativeBearingCounterclockwise", 90],
    ].map(([left, value], index) => ({
        ...createLogicBlock("always", "move_stop"),
        id: `bearing-mode-${index}`,
        conditions: [{ type: "expression", left, comparator: "eq", target: "opponent", right: { type: "number", value } }],
    }));
    const state = payload({ playerModel: { x: 400, y: 400, rotation: 180 }, opponent: { x: 500, y: 400 } });
    for (const rule of rules) assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, state)?.id, rule.id);
});

test("shortest target bearing difference is never negative", () => {
    const facingToleranceRule = {
        ...createLogicBlock("always", "shoot_gun"),
        conditions: [{
            type: "expression",
            left: "target.relativeBearing",
            comparator: "lt",
            target: "opponent",
            right: { type: "number", value: 10 },
        }],
    };
    const targetWestWhileFacingNorth = payload({
        playerModel: { x: 400, y: 400, rotation: 0 },
        opponent: { x: 300, y: 400 },
    });

    assert.equal(selectMeleeStrategyBlock({ blocks: [facingToleranceRule] }, targetWestWhileFacingNorth), null);
});

test("edge-distance expression variables support less-than and greater-than comparisons", () => {
    const safeAtCenter = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{ type: "expression", left: "my.edgeDistance", comparator: "gt", right: { type: "number", value: 250 } }],
    };
    const nearEdgeTarget = {
        ...createLogicBlock("always", "move_outward"),
        conditions: [{ type: "expression", left: "target.edgeDistance", comparator: "lt", right: { type: "number", value: 60 } }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [safeAtCenter],
    }, payload({ playerModel: { x: 400, y: 400 } })).id, safeAtCenter.id);

    assert.equal(selectMeleeStrategyBlock({
        blocks: [nearEdgeTarget],
    }, payload({ opponent: { x: 45, y: 400 } })).id, nearEdgeTarget.id);

    const normalized = normalizeMeleeStrategyConfiguration({
        blocks: [{ conditions: [{ type: "expression", left: "my.edgeDistance", comparator: "lt", right: { type: "number", value: 80 } }], action: "move_outward" }],
    });
    assert.equal(normalized.blocks[0].conditions[0].type, "expression");
    assert.equal(normalized.blocks[0].conditions[0].left, "my.edgeDistance");
});

test("expression conditions compare state variables and numeric literals", () => {
    const lowHp = {
        ...createLogicBlock("always", "move_outward"),
        conditions: [{
            type: "expression",
            left: "my.hp",
            comparator: "lt",
            right: { type: "variable", value: "opponent.hp" },
        }],
    };
    const farTarget = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.distance",
            comparator: "gte",
            right: { type: "number", value: 200 },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [lowHp] }, payload({ playerModel: { hp: 40 }, opponent: { hp: 60 } })).id, lowHp.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [farTarget] }, payload()).id, farTarget.id);
});

test("condition joins can use OR and expression variables expose x/y positions", () => {
    const anySidePosition = {
        ...createLogicBlock("always", "move_center"),
        conditions: [
            {
                type: "expression",
                left: "my.x",
                comparator: "lt",
                right: { type: "number", value: 100 },
            },
            {
                type: "expression",
                join: "or",
                left: "opponent.y",
                comparator: "eq",
                right: { type: "number", value: 400 },
            },
        ],
    };
    const andPosition = {
        ...createLogicBlock("always", "move_stop"),
        conditions: anySidePosition.conditions.map((condition) => ({ ...condition, join: undefined })),
    };

    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [anySidePosition] });
    assert.equal(normalized.blocks[0].conditions[0].join, undefined);
    assert.equal(normalized.blocks[0].conditions[1].join, "or");
    assert.equal(selectMeleeStrategyBlock({ blocks: [anySidePosition] }, payload()).id, anySidePosition.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [andPosition] }, payload()), null);

    const readyOrCoolingDown = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [
            selectedAbilityCondition("dash"),
            selectedAbilityCondition("dash", { field: "CooldownMs", comparator: "gt", value: 0, join: "or" }),
        ],
    };
    assert.deepEqual(validateMeleeStrategyConfiguration({ blocks: [readyOrCoolingDown] }).errors, []);
});

test("position expression variables can read player and opponent coordinates", () => {
    const playerLeft = {
        ...createLogicBlock("always", "move_east"),
        conditions: [{ type: "expression", left: "my.x", comparator: "lt", right: { type: "number", value: 200 } }],
    };
    const playerLow = {
        ...createLogicBlock("always", "move_north"),
        conditions: [{ type: "expression", left: "my.y", comparator: "gt", right: { type: "number", value: 500 } }],
    };
    const opponentRight = {
        ...createLogicBlock("always", "move_center"),
        conditions: [{ type: "expression", left: "opponent.x", comparator: "gt", right: { type: "number", value: 650 } }],
    };
    const opponentHigh = {
        ...createLogicBlock("always", "move_south"),
        conditions: [{ type: "expression", left: "opponent.y", comparator: "lt", right: { type: "number", value: 250 } }],
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [playerLeft] }, payload({ playerModel: { x: 150 } })).id, playerLeft.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [playerLow] }, payload({ playerModel: { y: 650 } })).id, playerLow.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [opponentRight] }, payload({ opponent: { x: 700 } })).id, opponentRight.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [opponentHigh] }, payload({ opponent: { y: 200 } })).id, opponentHigh.id);
});

test("removed object-type, danger-zone, and legacy effect conditions stay hidden", () => {
    const conditionIds = new Set(CONDITION_TYPES.map((condition) => condition.id));
    const variableIds = new Set(STATE_VARIABLES.map((variable) => variable.id));
    for (const id of ["target_missing", "target_health_pack", "target_damage_zone", "target_projectile_wall", "target_bouncy_wall", "inside_damage_zone", "my_jammed", "my_command_locked", "opponent_jammed", "opponent_command_locked"]) {
        assert.equal(conditionIds.has(id), false);
    }
    for (const id of ["my.overdriveMs", "my.barrierMs", "my.slowedMs", "my.jammedMs", "my.commandLockedMs", "opponent.overdriveMs", "opponent.barrierMs", "opponent.slowedMs", "opponent.jammedMs", "opponent.commandLockedMs", "my.jammed", "my.commandLocked", "opponent.jammed", "opponent.commandLocked", "target.isHealthPack", "target.isDamageZone", "target.isProjectileWall", "target.isBouncyWall", "my.insideDamageZone"]) {
        assert.equal(variableIds.has(id), false);
    }
});

test("cooldown expression variables use seconds and behavior shortcuts stay hidden", () => {
    const visibleConditionIds = new Set(CONDITION_TYPES.map((condition) => condition.id));
    assert.equal(visibleConditionIds.has("expression"), false);
    assert.equal(visibleConditionIds.has("my_hp_lt"), false);
    assert.equal(visibleConditionIds.has("my_hp_gt"), false);
    assert.equal(visibleConditionIds.has("enemy_distance_lt"), false);
    assert.equal(visibleConditionIds.has("enemy_distance_gt"), false);
    assert.equal(visibleConditionIds.has("enemy_rushing"), false);
    assert.equal(visibleConditionIds.has("enemy_fleeing"), false);
    assert.equal(visibleConditionIds.has("enemy_attacking"), false);
    assert.equal(visibleConditionIds.has("enemy_blocking"), false);

    const dashStillCoolingDown = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.selectedAbilityCooldownMs",
            ability: "dash",
            comparator: "gt",
            right: { type: "number", value: 0.5 },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [dashStillCoolingDown],
    }, payload({ playerModel: { dashCooldownRemainingMs: 750 } })).id, dashStillCoolingDown.id);
    assert.equal(selectMeleeStrategyBlock({
        blocks: [dashStillCoolingDown],
    }, payload({ playerModel: { dashCooldownRemainingMs: 250 } })), null);

});

test("generic selected-ability variables replace per-ability condition menu entries", () => {
    const variableIds = new Set(STATE_VARIABLES.map((variable) => variable.id));
    assert.equal(variableIds.has("my.selectedAbilityReady"), true);
    assert.equal(variableIds.has("my.selectedAbilityAmmo"), true);
    assert.equal(variableIds.has("opponent.selectedAbilityCooldownMs"), true);
    assert.equal(variableIds.has("my.abilityReady.null_zone"), false);
    assert.equal(CONDITION_TYPES.some((condition) => condition.id === "my_null_zone_ready"), false);

    const ready = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.selectedAbilityReady",
            ability: "null_zone",
            comparator: "eq",
            right: { type: "boolean", value: true },
        }],
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [ready] }, payload({ playerModel: { abilityCooldowns: { null_zone: 0 } } }))?.id, ready.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [ready] }, payload({ playerModel: { abilityCooldowns: { null_zone: 500 } } })), null);
});

test("expression variable operands can resolve different targets", () => {
    const rule = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.distance",
            leftTarget: "opponent_grenade",
            comparator: "lt",
            right: { type: "variable", value: "target.distance" },
            rightTarget: "opponent",
        }],
    };
    const state = payload({ objects: [{ id: "grenade-opponent-model-1", type: "grenade", ownerId: "opponent-model", x: 450, y: 400, size: 12 }] });

    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [rule] });
    assert.equal(normalized.blocks[0].conditions[0].leftTarget, "opponent_grenade");
    assert.equal(normalized.blocks[0].conditions[0].rightTarget, "opponent");
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, state).id, rule.id);
});

test("tick damage, net hp change, target direction, and velocity are expression variables", () => {
    const state = payload({
        playerModel: { damageTakenLastTick: 30, hpNetChangeLastTick: -15 },
        opponent: { velocityX: 3, velocityY: -4 },
    });
    const matches = (left, comparator, right) => selectMeleeStrategyBlock({
        blocks: [{
            ...createLogicBlock("always", "move_stop"),
            conditions: [{ type: "expression", left, comparator, leftTarget: "opponent", right }],
        }],
    }, state);

    assert.ok(matches("my.damageTakenLastTick", "eq", { type: "number", value: 30 }));
    assert.ok(matches("my.hpNetChangeLastTick", "eq", { type: "number", value: -15 }));
    assert.ok(matches("target.velocity", "eq", { type: "number", value: 5 }));
    assert.ok(matches("target.movementDirection", "range", { type: "range", min: 30, max: 40 }));
});

test("target direction uses an inclusive signed range", () => {
    const rule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "target.bearingFromMe", comparator: "range", target: "opponent", right: { type: "range", min: -100, max: -80 } }],
    };
    const west = payload({ playerModel: { x: 400, y: 400 }, opponent: { x: 300, y: 400 } });
    const east = payload({ playerModel: { x: 400, y: 400 }, opponent: { x: 500, y: 400 } });
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, west)?.id, rule.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, east), null);
});

test("a reversed target direction range wraps around the circle", () => {
    const rule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "target.bearingFromMe", comparator: "range", target: "opponent", right: { type: "range", min: 32, max: 30 } }],
    };
    const east = payload({ opponent: { x: 500, y: 400 } });
    const bearing31 = 31 * Math.PI / 180;
    const excluded = payload({ opponent: { x: 400 + Math.sin(bearing31) * 100, y: 400 - Math.cos(bearing31) * 100 } });
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, east)?.id, rule.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, excluded), null);
    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [rule] });
    assert.deepEqual(normalized.blocks[0].conditions[0].right, { type: "range", min: 32, max: 30 });
});

test("target age uses seconds at one-decimal tick precision", () => {
    const definition = STATE_VARIABLES.find((variable) => variable.id === "target.age");
    assert.equal(definition.suffix, "s");
    assert.equal(definition.step, 0.1);
    const block = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.age",
            comparator: "gte",
            right: { type: "number", value: 1.34 },
            target: "opponent_proximity_mine",
        }],
    };
    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [block] });
    assert.equal(normalized.blocks[0].conditions[0].right.value, 1.3);
});

test("generic selected-ability ammo reads gun ammo, fireball charges, and block charges", () => {
    const condition = (ability, expected) => ({
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.selectedAbilityAmmo",
            ability,
            comparator: "eq",
            right: { type: "number", value: expected },
        }],
    });
    const state = payload({ playerModel: {
        gunAmmo: 7,
        fireballCharges: 3,
        blockCharges: 4,
    } });

    assert.ok(selectMeleeStrategyBlock({ blocks: [condition("fire_gun", 7)] }, state));
    assert.ok(selectMeleeStrategyBlock({ blocks: [condition("shoot_fireball", 3)] }, state));
    assert.ok(selectMeleeStrategyBlock({ blocks: [condition("block", 4)] }, state));
});

test("expression conditions normalize and compare boolean variables", () => {
    const ready = selectedAbilityCondition("dash");
    assert.deepEqual(ready.right, { type: "boolean", value: true });
    const dashWhenReady = {
        ...createLogicBlock("always", "dash"),
        conditions: [ready],
    };
    const waitWhenOff = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.selectedAbilityReady",
            ability: "dash",
            comparator: "eq",
            right: { type: "boolean", value: false },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [dashWhenReady] }, payload({ playerModel: { dashAvailable: true } })).id, dashWhenReady.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [waitWhenOff] }, payload({ playerModel: { dashAvailable: false } })).id, waitWhenOff.id);
});

test("target support is limited to directional and dash-like actions", () => {
    const move = ACTION_TYPES.find((action) => action.id === "move_inward");
    const north = ACTION_TYPES.find((action) => action.id === "move_north");
    const dash = ACTION_TYPES.find((action) => action.id === "dash");
    const dashNorth = ACTION_TYPES.find((action) => action.id === "dash_north");
    const stop = ACTION_TYPES.find((action) => action.id === "move_stop");
    const noDash = ACTION_TYPES.find((action) => action.id === "no_dash");
    const microDash = ACTION_TYPES.find((action) => action.id === "micro_dash");

    assert.equal(actionSupportsTarget(move), true);
    assert.equal(actionSupportsTarget(north), false);
    assert.equal(actionSupportsTarget(dash), true);
    assert.equal(actionSupportsTarget(dashNorth), false);
    assert.equal(actionSupportsTarget(stop), false);
    assert.equal(actionSupportsTarget(noDash), false);
    assert.equal(actionSupportsTarget(microDash), true);
});

test("one conditional can execute movement rotation and one ability", () => {
    const branch = {
        ...createLogicBlock("always", "none"),
        conditions: [{ type: "always" }],
        actions: [
            { action: "move_inward", actionTarget: "opponent" },
            { action: "rotate_toward_enemy", actionTarget: "opponent" },
            { action: "swing", actionTarget: "opponent" },
        ],
    };

    const plan = selectMeleeStrategyActionPlan({ blocks: [branch] }, payload());

    assert.equal(plan.movement?.action, "move_walk");
    assert.equal(plan.rotation?.action, "rotate_toward_enemy");
    assert.equal(plan.ability?.action, "swing");
});

test("normalization keeps only one action per execution category", () => {
    const normalized = normalizeMeleeStrategyConfiguration({
        blocks: [{
            ...createLogicBlock("always", "none"),
            actions: [
                { action: "move_inward", actionTarget: "opponent" },
                { action: "move_outward", actionTarget: "opponent" },
                { action: "swing" },
                { action: "block" },
                { action: "none" },
            ],
        }],
    });

    assert.deepEqual(normalized.blocks[0].actions.map((entry) => entry.action), ["move_walk", "swing"]);
});

test("custom integer variable nodes persist and saturate at the hard limit", () => {
    const state = payload();
    state.playerModel.customVariables = {};
    const configuration = {
        version: "bot-logic-tree-v1",
        customVariables: [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: 99_990 }],
        columns: [{ id: "column", createdOrder: 0, branches: [{
            id: "branch", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }],
            actions: [{ action: "variable", variableId: "custom.counter", operation: "add", value: 50 }], children: [],
        }] }],
    };

    selectMeleeStrategyActionPlan(configuration, state);

    assert.equal(state.playerModel.customVariables["custom.counter"], 99_999);
});

test("custom variable increments persist across ticks and gate later actions", () => {
    const state = payload({ playerModel: { customVariables: {} } });
    const configuration = {
        version: "bot-logic-tree-v1",
        customVariables: [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: 0 }],
        columns: [
            { id: "increment", createdOrder: 0, branches: [{
                id: "increment-always", branchType: "if", createdOrder: 0,
                conditions: [{ type: "always" }],
                actions: [{ action: "variable", variableId: "custom.counter", operation: "add", value: 1 }], children: [],
            }] },
            { id: "gate", createdOrder: 1, branches: [{
                id: "move-after-five", branchType: "if", createdOrder: 0,
                conditions: [{ type: "expression", left: "custom.counter", comparator: "gt", right: { type: "number", value: 5 } }],
                actions: [{ action: "move_walk", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" }], children: [],
            }] },
        ],
    };

    for (let tick = 0; tick < 6; tick += 1) selectMeleeStrategyActionPlan(configuration, state);
    assert.equal(state.playerModel.customVariables["custom.counter"], 6);
    assert.equal(selectMeleeStrategyActionPlan(configuration, state).movement?.action, "move_walk");
});

test("normalization restores declared custom-variable metadata for variable action references", () => {
    const normalized = normalizeMeleeStrategyConfiguration({
        version: "bot-logic-tree-v1",
        columns: [{
            branches: [{
                branchType: "if",
                conditions: [{ type: "always" }],
                actions: [
                    { action: "variable", variableId: "custom.counter", operation: "add", value: 1 },
                    { action: "variable", variableId: "custom.enabled", operation: "set", value: true },
                ],
                children: [],
            }],
        }],
    });

    assert.deepEqual(normalized.customVariables, [
        { id: "custom.counter", name: "Variable 1", valueType: "number", initialValue: 0 },
        { id: "custom.enabled", name: "Variable 2", valueType: "boolean", initialValue: false },
    ]);
    assert.equal(normalized.columns[0].branches[0].variableId, "custom.counter");
});

test("normalization restores metadata for custom variables referenced only by conditions", () => {
    const normalized = normalizeMeleeStrategyConfiguration({
        columns: [{ branches: [{
            branchType: "if",
            conditions: [
                { type: "expression", left: "custom.ready", comparator: "eq", right: { type: "boolean", value: true } },
                { type: "expression", left: "my.hp", comparator: "gt", right: { type: "variable", value: "custom.threshold" } },
            ],
            actions: [{ action: "move_stop" }],
            children: [],
        }] }],
    });

    assert.deepEqual(normalized.customVariables, [
        { id: "custom.ready", name: "Variable 1", valueType: "boolean", initialValue: false },
        { id: "custom.threshold", name: "Variable 2", valueType: "number", initialValue: 0 },
    ]);
});

test("integer variable expressions chain state variables, custom variables, and literals", () => {
    const state = payload({ playerModel: { customVariables: { "custom.first": 40, "custom.second": 7 } } });
    state.objects[0].hp = 30;
    const configuration = {
        customVariables: [
            { id: "custom.first", name: "First", valueType: "number", initialValue: 0 },
            { id: "custom.second", name: "Second", valueType: "number", initialValue: 0 },
        ],
        columns: [{ id: "column", createdOrder: 0, branches: [{ id: "branch", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{
            action: "variable", variableId: "custom.first", terms: [
                { operator: "add", operand: { type: "variable", value: "opponent.hp" } },
                { operator: "subtract", operand: { type: "variable", value: "custom.second" } },
                { operator: "add", operand: { type: "number", value: 2 } },
            ],
        }], children: [] }] }],
    };
    selectMeleeStrategyActionPlan(configuration, state);
    assert.equal(state.playerModel.customVariables["custom.first"], 65);
});

test("equals evaluates from zero on every execution without charging unrelated variable slots", () => {
    const state = payload({ playerModel: { customVariables: {} } });
    const action = { action: "variable", variableId: "custom.total", terms: [
        { operator: "set", operand: { type: "number", value: 5 } },
        { operator: "add", operand: { type: "number", value: 3 } },
    ] };
    const configuration = { customVariables: [{ id: "custom.total", name: "Total", valueType: "number", initialValue: 99 }], columns: [{ id: "column", createdOrder: 0, branches: [{ id: "branch", branchType: "if", createdOrder: 0, conditions: [{ type: "expression", left: "my.hp", comparator: "gt", right: { type: "number", value: 0 } }], actions: [action], children: [] }] }] };
    selectMeleeStrategyActionPlan(configuration, state);
    selectMeleeStrategyActionPlan(configuration, state);
    assert.equal(state.playerModel.customVariables["custom.total"], 8);
    assert.equal(countVariableSlots(configuration), 1);
    assert.equal(countConditionSlots(configuration), 1);
});

test("arena planner returns updated custom variables without mutating its source shape", () => {
    const fighter = { id: "main", x: 400, y: 400, hp: 100, customVariables: { "custom.counter": 2 } };
    const opponent = { id: "opponent-model", x: 600, y: 400, hp: 100 };
    const configuration = {
        version: "bot-logic-tree-v1",
        customVariables: [{ id: "custom.counter", name: "Counter", valueType: "number", initialValue: 0 }],
        columns: [{ id: "increment", createdOrder: 0, branches: [{
            id: "increment-always", branchType: "if", createdOrder: 0,
            conditions: [{ type: "always" }],
            actions: [{ action: "variable", variableId: "custom.counter", operation: "add", value: 1 }], children: [],
        }] }],
    };

    const action = buildDeterministicLogicAction(configuration, buildStatePayload([fighter, opponent], "custom"));

    assert.equal(action.customVariables["custom.counter"], 3);
    assert.equal(fighter.customVariables["custom.counter"], 2);
});

test("legacy variable action with an empty id modifies the visually selected first variable", () => {
    const state = payload({ playerModel: { customVariables: {} } });
    const configuration = {
        version: "bot-logic-tree-v1",
        customVariables: [{ id: "custom.variable_1", name: "Variable 1", valueType: "number", initialValue: 0 }],
        columns: [{ id: "increment", createdOrder: 0, branches: [{
            id: "increment-always", branchType: "if", createdOrder: 0,
            conditions: [{ type: "always" }],
            actions: [{ action: "variable", variableId: "", operation: "add", value: 1 }], children: [],
        }] }],
    };

    selectMeleeStrategyActionPlan(configuration, state);

    assert.equal(state.playerModel.customVariables["custom.variable_1"], 1);
});

test("derived booleans consume variable slots and can gate combat actions", () => {
    const configuration = {
        version: "bot-logic-tree-v1",
        customVariables: [{
            id: "custom.low_hp", name: "Low HP", valueType: "boolean", initialValue: false,
            conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 50 } }],
        }],
        columns: [{ id: "column", createdOrder: 0, branches: [{
            id: "branch", branchType: "if", createdOrder: 0,
            conditions: [{ type: "expression", left: "custom.low_hp", comparator: "eq", right: { type: "boolean", value: true } }],
            actions: [{ action: "move_walk", movementMode: "target", movementDirection: "away", actionTarget: "opponent" }], children: [],
        }] }],
    };
    const state = payload({ playerModel: { hp: 25 } });

    const plan = selectMeleeStrategyActionPlan(configuration, state);
    assert.equal(plan.movement?.action, "move_walk");
    assert.equal(plan.customVariables["custom.low_hp"], true);
    assert.equal(countVariableSlots(configuration), 2);
    assert.equal(countConditionSlots(configuration), 3); // one derivation plus the derived variable's two-slot use cost
    const tooExpensive = { ...configuration, customVariables: Array.from({ length: 51 }, (_, index) => ({ ...configuration.customVariables[0], id: `custom.v${index}`, name: `Variable ${index}` })) };
    assert.match(validateMeleeStrategyConfiguration(tooExpensive).errors.join(" "), /variable slots/i);
});

test("custom variables inside derivations do not recursively increase variable cost", () => {
    const configuration = {
        customVariables: [
            { id: "custom.source", name: "Source", valueType: "boolean", initialValue: false },
            { id: "custom.derived", name: "Derived", valueType: "boolean", initialValue: false, conditions: [
                { type: "expression", left: "custom.source", comparator: "eq", right: { type: "boolean", value: true } },
            ] },
        ],
        columns: [{ id: "column", branches: [{ id: "branch", conditions: [
            { type: "expression", left: "custom.derived", comparator: "eq", right: { type: "boolean", value: true } },
        ], actions: [], children: [] }] }],
    };

    assert.equal(countVariableSlots(configuration), 3);
    assert.equal(countConditionSlots(configuration), 3);
});

test("a custom variable used as the right conditional operand charges its definition cost", () => {
    const configuration = {
        customVariables: [{ id: "custom.threshold", name: "Threshold", valueType: "number", initialValue: 10 }],
        columns: [{ id: "column", branches: [{ id: "branch", conditions: [
            { type: "expression", left: "my.hp", comparator: "gt", right: { type: "variable", value: "custom.threshold" } },
        ], actions: [], children: [] }] }],
    };

    assert.equal(countVariableSlots(configuration), 1);
    assert.equal(countConditionSlots(configuration), 1);
});

test("elapsed match time is a non-negative expression variable measured in seconds", () => {
    const rule = {
        ...createLogicBlock("always", "move_center"),
        conditions: [{ type: "expression", left: "match.elapsedSeconds", comparator: "gte", right: { type: "number", value: 2.5 } }],
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, payload({ playerModel: { matchElapsedMs: 2_500 } }))?.id, rule.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, payload({ playerModel: { matchElapsedMs: 2_400 } })), null);
});
