import { encodeSandboxLoadout } from "../gameArena/loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetBotShape } from "../gameArena/modelPayloads/arenaShapes.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../gameArena/modelPayloads/arenaConstants.js";
import { createCodeRoot, createDefaultAbilityStrategyConfiguration } from "../gameArena/botlogic/code/configuration/configurationFactories.js";
import { BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../gameArena/botlogic/code/contracts/BotLogicContracts.js";
import { abilityIdFromLegacyName } from "../gameArena/gameconfig/AbilityRegistry.js";

const TUTORIAL_CENTER_X = ARENA_WIDTH_UNITS / 2;
const TUTORIAL_CENTER_Y = ARENA_HEIGHT_UNITS / 2;
const tutorialY = (offsetFromCenter) => TUTORIAL_CENTER_Y + offsetFromCenter;

function loadout(...abilities) {
    return encodeSandboxLoadout({ abilities });
}

function branch(id, conditions, actions, priority = 1) {
    return { id, branchType: "if", priority, conditions, actions, children: [] };
}

function root(priority, branches, name = "Root", id = null) {
    return { ...createCodeRoot(priority, name, id), branches };
}

const always = () => ({ type: "always" });
const compare = (left, comparator, value, leftSelectable = undefined) => ({
    type: "expression", left, comparator, right: { type: "number", value }, ...(leftSelectable ? { leftSelectable } : {}),
});
const comparePair = (left, comparator, value, selectable1 = BOT_CODE_SELECTABLES.MY, selectable2 = BOT_CODE_SELECTABLES.OPPONENT) => ({
    type: "expression", left, comparator, right: { type: "number", value }, selectable1, selectable2,
});
const move = (direction, selectable = BOT_CODE_SELECTABLES.OPPONENT) => ({ action: BOT_CODE_ACTIONS.MOVE_WALK, movementMode: "target", movementDirection: direction, selectable });
const face = (selectable = BOT_CODE_SELECTABLES.OPPONENT) => ({ action: BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET, selectable });
const ability = (actionId, selectable = BOT_CODE_SELECTABLES.OPPONENT, fields = {}) => ({ action: actionId, selectable, ...fields });

export const TUTORIAL_ACTIONS = Object.freeze({
    SLASH: abilityIdFromLegacyName("slash"),
    STUN: abilityIdFromLegacyName("stun"),
    RAIL_SHOT: abilityIdFromLegacyName("rail_shot"),
    GRENADE: abilityIdFromLegacyName("grenade"),
    HEAVY_SLASH: abilityIdFromLegacyName("heavy_slash"),
    WIND_BURST: abilityIdFromLegacyName("wind_burst"),
    DASH: abilityIdFromLegacyName("dash"),
    LOCK_ON: abilityIdFromLegacyName("lock_on"),
    BASIC_STRIKE: abilityIdFromLegacyName("basic_strike"),
});

export function createEmptyTutorialCode() {
    return createDefaultAbilityStrategyConfiguration();
}

export function hasTutorialPriorityOrder(configuration, firstAction, secondAction) {
    const roots = Array.isArray(configuration?.roots) ? configuration.roots : [];
    const rootForAction = (actionId) => roots.find((rootNode) => {
        const collect = (branches = []) => branches.flatMap((branchNode) => [
            branchNode,
            ...collect(Array.isArray(branchNode?.children) ? branchNode.children : []),
        ]);
        return collect(Array.isArray(rootNode?.branches) ? rootNode.branches : [])
            .some((branchNode) => (Array.isArray(branchNode?.actions) ? branchNode.actions : [])
                .some((action) => Number(action?.action) === actionId || action?.action === String(actionId)));
    });
    const first = rootForAction(firstAction);
    const second = rootForAction(secondAction);
    return Boolean(first && second && Number(first.priority) < Number(second.priority));
}

function code(roots) {
    return { ...createEmptyTutorialCode(), roots };
}

function stepOneSolution() {
    return code([root(1, [
        branch("lesson-1-move-if", [always()], [move(0)]),
    ])]);
}

function stepTwoSolution() {
    return code([root(1, [
        branch("lesson-2-retreat-if", [compare("selectable.hp", "lt", 45, BOT_CODE_SELECTABLES.MY)], [move(180)]),
        branch("lesson-2-engage", [comparePair("selectable.distance", "gt", 100)], [move(0)], 2),
    ])]);
}

function stepThreeRotationSolution() {
    return code([
        root(1, [branch("lesson-3-rotate-if", [always()], [face()])]),
        root(2, [
            branch("lesson-3-close-if", [comparePair("selectable.distance", "gt", 115)], [move(0)]),
        ]),
        root(3, [branch("lesson-3-slash-if", [
            comparePair("selectable.distance", "lte", 115),
            comparePair("selectable.relativeBearing", "lte", 75),
        ], [ability(TUTORIAL_ACTIONS.HEAVY_SLASH)])]),
    ]);
}

function stepFourSolution() {
    return code([
        root(1, [branch("lesson-4-lock-on-if", [always()], [ability(TUTORIAL_ACTIONS.LOCK_ON)])]),
        root(2, [
            branch("lesson-4-close-if", [comparePair("selectable.distance", "gt", 115)], [move(0)]),
        ]),
        root(3, [branch("lesson-4-slash-if", [
            comparePair("selectable.distance", "lte", 115),
            comparePair("selectable.relativeBearing", "lte", 75),
        ], [ability(TUTORIAL_ACTIONS.HEAVY_SLASH)])]),
    ]);
}

function stepFiveSolution(selectable = BOT_CODE_SELECTABLES.OPPONENT) {
    return code([root(1, [branch("lesson-6-dodge-if", [always()], [
        ability(TUTORIAL_ACTIONS.DASH, selectable, { movementMode: "target", movementDirection: 90 }),
    ])])]);
}

function stepSixBasicStrikeSolution() {
    return code([root(1, [branch("lesson-6-basic-strike-if", [always()], [ability(TUTORIAL_ACTIONS.BASIC_STRIKE)])])]);
}

function stepEightCustomVariableSolution() {
    const variableId = "custom.variable-1";
    return {
        ...code([root(1, [branch("lesson-8-variable-if", [always()], [{
            action: BOT_CODE_ACTIONS.VARIABLE,
            selectable: BOT_CODE_SELECTABLES.OPPONENT,
            variableId,
            terms: [{ operator: "add", operand: { type: "number", value: 1 } }],
        }])])]),
        customVariables: [{ id: variableId, name: "Variable 1", valueType: "number", initialValue: 0 }],
    };
}

function stepSevenSolution() {
    return code([
        root(1, [branch("lesson-7-slash-if", [
            comparePair("selectable.distance", "lte", 115),
            comparePair("selectable.relativeBearing", "lte", 75),
        ], [ability(TUTORIAL_ACTIONS.HEAVY_SLASH)])]),
        root(2, [branch("lesson-7-dodge-if", [always()], [
            ability(TUTORIAL_ACTIONS.DASH, "opponent_1_grenade", { movementMode: "target", movementDirection: 90 }),
        ])]),
        root(3, [branch("lesson-7-face-if", [always()], [face()])]),
        root(4, [branch("lesson-7-close-if", [
            comparePair("selectable.distance", "gt", 115),
        ], [move(0)])]),
    ]);
}

function priorityLessonStartingCode() {
    return code([
        root(1, [branch("lesson-9-dash-if", [always()], [
            ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: 90 }),
        ])], "Dash", "tutorial-root-dash"),
        root(2, [branch("lesson-9-lock-on-if", [always()], [
            ability(TUTORIAL_ACTIONS.LOCK_ON),
        ])], "Lock On", "tutorial-root-lock-on"),
    ]);
}

function priorityLessonSolution() {
    return code([
        root(2, [branch("lesson-9-dash-if", [always()], [
            ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: 90 }),
        ])], "Dash", "tutorial-root-dash"),
        root(1, [branch("lesson-9-lock-on-if", [always()], [
            ability(TUTORIAL_ACTIONS.LOCK_ON),
        ])], "Lock On", "tutorial-root-lock-on"),
    ]);
}

function orbitingSolution() {
    const lockOnReady = {
        type: "expression",
        left: "bot.selectedAbilityReady",
        comparator: "eq",
        right: { type: "boolean", value: true },
        ability: TUTORIAL_ACTIONS.LOCK_ON,
    };
    return code([
        root(1, [branch("lesson-9-lock-on-if", [
            comparePair("selectable.relativeBearing", "gte", 90),
        ], [ability(TUTORIAL_ACTIONS.LOCK_ON)])]),
        root(2, [branch("lesson-9-dash-if", [
            comparePair("selectable.distance", "lte", 60),
            lockOnReady,
        ], [ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: 45 })])]),
        root(3, [
            branch("lesson-9-orbit-close-if", [comparePair("selectable.distance", "lte", 60)], [move(90)]),
            branch("lesson-9-orbit-approach-if", [comparePair("selectable.distance", "gt", 60)], [move(45)], 2),
        ]),
        root(4, [branch("lesson-9-face-if", [always()], [face()])]),
        root(5, [branch("lesson-9-slash-if", [always()], [ability(TUTORIAL_ACTIONS.SLASH)])]),
        root(6, [branch("lesson-9-basic-strike-if", [always()], [ability(TUTORIAL_ACTIONS.BASIC_STRIKE)])]),
    ]);
}

const selectedAbilityState = (left, value, selectedAbility, leftSelectable = BOT_CODE_SELECTABLES.OPPONENT) => ({
    type: "expression",
    left,
    comparator: "eq",
    right: { type: "boolean", value },
    leftSelectable,
    ability: selectedAbility,
});

const selectedAbilityTime = (left, comparator, value, selectedAbility, leftSelectable = BOT_CODE_SELECTABLES.OPPONENT) => ({
    type: "expression",
    left,
    comparator,
    right: { type: "number", value },
    leftSelectable,
    ability: selectedAbility,
});

function vulnerabilityOneSolution() {
    const preparing = (selectedAbility) => selectedAbilityState("bot.selectedAbilityPreparing", true, selectedAbility);
    const coolingDown = (selectedAbility, selectable = BOT_CODE_SELECTABLES.OPPONENT) => selectedAbilityState("bot.selectedAbilityOnCooldown", true, selectedAbility, selectable);
    const dodge = (direction) => [
        ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: direction }),
    ];
    return code([
        root(1, [
            branch("lesson-10-dodge-rail", [
                preparing(TUTORIAL_ACTIONS.RAIL_SHOT),
                selectedAbilityTime("bot.selectedAbilityPreparationMs", "lte", 0.2, TUTORIAL_ACTIONS.RAIL_SHOT),
            ], dodge(90)),
            branch("lesson-10-dodge-heavy-slash", [preparing(TUTORIAL_ACTIONS.HEAVY_SLASH)], dodge(180), 2),
        ]),
        root(2, [
            branch("lesson-10-space-without-dash", [
                comparePair("selectable.distance", "lte", 100),
                coolingDown(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.MY),
            ], [move(120)]),
            branch("lesson-10-orbit-inside-slash-range", [
                comparePair("selectable.distance", "lte", 90),
            ], [move(90)], 2),
            branch("lesson-10-safe-approach", [
                selectedAbilityState("bot.selectedAbilityReady", true, TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.MY),
                { ...coolingDown(TUTORIAL_ACTIONS.RAIL_SHOT), join: "or" },
                coolingDown(TUTORIAL_ACTIONS.HEAVY_SLASH),
            ], [move(30)], 3),
            branch("lesson-10-orbit-until-safe", [always()], [move(90)], 4),
        ]),
        root(3, [branch("lesson-10-face", [always()], [face()])]),
        root(4, [branch("lesson-10-slash", [
            selectedAbilityTime("bot.selectedAbilityCooldownMs", "gt", 0.5, TUTORIAL_ACTIONS.HEAVY_SLASH),
        ], [ability(TUTORIAL_ACTIONS.SLASH)])]),
    ]);
}

function vulnerabilityTwoSolution() {
    const preparing = (selectedAbility) => selectedAbilityState("bot.selectedAbilityPreparing", true, selectedAbility);
    const coolingDown = (selectedAbility) => selectedAbilityState("bot.selectedAbilityOnCooldown", true, selectedAbility);
    return code([
        root(1, [
            branch("lesson-11-dash-through-stun", [
                comparePair("selectable.distance", "lt", 120),
                selectedAbilityState("bot.selectedAbilityReady", true, TUTORIAL_ACTIONS.STUN),
            ], [
                ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: 0 }),
            ]),
            branch("lesson-11-retreat-heavy-slash", [preparing(TUTORIAL_ACTIONS.HEAVY_SLASH)], [
                ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: 180 }),
                move(180),
            ], 2),
            branch("lesson-11-close-when-safe", [
                selectedAbilityState("bot.selectedAbilityReady", true, TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.MY),
                comparePair("selectable.distance", "gt", 80),
                { ...selectedAbilityTime("bot.selectedAbilityCooldownMs", "gt", 0.8, TUTORIAL_ACTIONS.STUN), join: "or" },
                coolingDown(TUTORIAL_ACTIONS.HEAVY_SLASH),
                comparePair("selectable.distance", "gt", 80),
            ], [move(0)], 3),
        ]),
        root(2, [branch("lesson-11-retreat-inside-range", [comparePair("selectable.distance", "lte", 120)], [move(180)])]),
        root(3, [branch("lesson-11-face", [always()], [face()])]),
        root(4, [branch("lesson-11-slash", [
            selectedAbilityTime("bot.selectedAbilityCooldownMs", "gt", 0.5, TUTORIAL_ACTIONS.HEAVY_SLASH),
        ], [ability(TUTORIAL_ACTIONS.SLASH)])]),
        root(5, [branch("lesson-11-lock-on", [
            comparePair("selectable.relativeBearing", "gt", 90),
        ], [ability(TUTORIAL_ACTIONS.LOCK_ON)])]),
    ]);
}

function comboAndKiteSolution() {
    const comboStepId = "custom.combo-step";
    const comboStep = (value) => compare(comboStepId, "eq", value);
    const ready = (selectedAbility) => selectedAbilityState("bot.selectedAbilityReady", true, selectedAbility, BOT_CODE_SELECTABLES.MY);
    const addComboStep = () => ({ action: BOT_CODE_ACTIONS.VARIABLE, variableId: comboStepId, terms: [{ operator: "add", operand: { type: "number", value: 1 } }] });
    const resetComboStep = () => ({ action: BOT_CODE_ACTIONS.VARIABLE, variableId: comboStepId, terms: [{ operator: "set", operand: { type: "number", value: 0 } }] });
    return {
        ...code([
            root(1, [
                branch("lesson-13-stun-combo", [comparePair("selectable.distance", "lte", 184), comboStep(0), ready(TUTORIAL_ACTIONS.STUN)], [ability(TUTORIAL_ACTIONS.STUN), addComboStep()]),
                branch("lesson-13-heavy-slash-combo", [comparePair("selectable.distance", "lte", 100), comboStep(1)], [ability(TUTORIAL_ACTIONS.HEAVY_SLASH), resetComboStep()], 2),
            ]),
            root(2, [branch("lesson-13-continue-combo", [compare(comboStepId, "neq", 0), comparePair("selectable.distance", "gt", 80)], [move(0)])]),
            root(3, [
                branch("lesson-13-move-off-edge", [compare("selectable.edgeDistance", "lte", 150, BOT_CODE_SELECTABLES.MY)], [move(120)]),
                branch("lesson-13-close-to-combat-range", [comparePair("selectable.distance", "gt", 300)], [move(0)], 2),
                branch("lesson-13-kite-out", [
                    comparePair("selectable.distance", "lt", 300),
                    selectedAbilityState("bot.selectedAbilityReady", false, TUTORIAL_ACTIONS.STUN, BOT_CODE_SELECTABLES.MY),
                    comboStep(0),
                ], [ability(TUTORIAL_ACTIONS.DASH, BOT_CODE_SELECTABLES.OPPONENT, { movementMode: "target", movementDirection: 180 }), move(180)], 3),
            ]),
            root(4, [branch("lesson-13-face", [always()], [face()])]),
            root(5, [branch("lesson-13-wind-burst", [
                comparePair("selectable.distance", "lt", 150),
                selectedAbilityState("bot.selectedAbilityReady", false, TUTORIAL_ACTIONS.STUN, BOT_CODE_SELECTABLES.MY),
                comboStep(0),
            ], [ability(TUTORIAL_ACTIONS.WIND_BURST)])]),
        ]),
        customVariables: [{ id: comboStepId, name: "Combo Step", valueType: "number", initialValue: 0 }],
    };
}

function passiveOpponent() {
    return createEmptyTutorialCode();
}

function meleeOpponent() {
    return code([root(1, [
        branch("opponent-sword-if", [always()], [face(), ability(TUTORIAL_ACTIONS.SLASH)]),
    ])]);
}

function orbitingOpponent() {
    return code([
        root(1, [branch("opponent-orbit-face-if", [always()], [face()])]),
        root(2, [branch("opponent-orbit-slash-if", [always()], [ability(TUTORIAL_ACTIONS.SLASH)])]),
        root(3, [branch("opponent-orbit-basic-strike-if", [always()], [ability(TUTORIAL_ACTIONS.BASIC_STRIKE)])]),
    ]);
}

function vulnerabilityOneOpponent() {
    return code([
        root(1, [branch("opponent-vulnerability-rail", [comparePair("selectable.distance", "lte", 250)], [ability(TUTORIAL_ACTIONS.RAIL_SHOT)])]),
        root(2, [branch("opponent-vulnerability-heavy-slash", [comparePair("selectable.distance", "lte", 100)], [ability(TUTORIAL_ACTIONS.HEAVY_SLASH)])]),
        root(3, [branch("opponent-vulnerability-face", [always()], [face()])]),
    ]);
}

function vulnerabilityTwoOpponent() {
    return code([
        root(1, [branch("opponent-vulnerability-lock-on", [
            comparePair("selectable.distance", "lte", 100),
            comparePair("selectable.relativeBearing", "gt", 45),
        ], [ability(TUTORIAL_ACTIONS.LOCK_ON)])]),
        root(2, [branch("opponent-vulnerability-stun", [comparePair("selectable.distance", "lte", 100)], [ability(TUTORIAL_ACTIONS.STUN)])]),
        root(3, [branch("opponent-vulnerability-heavy-slash", [comparePair("selectable.distance", "lte", 100)], [ability(TUTORIAL_ACTIONS.HEAVY_SLASH)])]),
        root(4, [branch("opponent-vulnerability-face", [always()], [face()])]),
    ]);
}

function comboAndKiteOpponent() {
    return code([
        root(1, [branch("opponent-combo-lock-on", [comparePair("selectable.distance", "lte", 184), comparePair("selectable.relativeBearing", "gt", 60)], [ability(TUTORIAL_ACTIONS.LOCK_ON)])]),
        root(2, [branch("opponent-combo-slash", [always()], [ability(TUTORIAL_ACTIONS.SLASH)])]),
        root(3, [branch("opponent-combo-basic-strike", [comparePair("selectable.distance", "lte", 92)], [ability(TUTORIAL_ACTIONS.BASIC_STRIKE)])]),
        root(4, [branch("opponent-combo-pursue", [always()], [move(0)])]),
        root(5, [branch("opponent-combo-face", [always()], [face()])]),
    ]);
}

function grenadeOpponent() {
    return code([
        root(1, [branch("opponent-grenade-face-if", [always()], [face()])]),
        root(2, [branch("opponent-grenade-throw-if", [always()], [ability(TUTORIAL_ACTIONS.GRENADE)])]),
    ]);
}

const SCENARIO_DEFINITIONS = [
    // Preserve each lesson's old relationship to the arena center as the world grows to 1200 units.
    { id: "arena-basics", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: tutorialY(150), opponentY: tutorialY(-140), playerRotation: 0, opponentRotation: 180 } },
    { id: "movement", playerLoadout: loadout(), opponentLoadout: loadout(), solution: stepOneSolution, opponentCode: passiveOpponent, spawn: { playerY: tutorialY(150), opponentY: tutorialY(-140), playerRotation: 0, opponentRotation: 180 } },
    { id: "distance", playerLoadout: loadout(), opponentLoadout: loadout(1), solution: stepTwoSolution, opponentCode: meleeOpponent, spawn: { playerY: tutorialY(60), opponentY: tutorialY(-80), playerRotation: 0, opponentRotation: 180 } },
    { id: "basic-strike", playerLoadout: loadout(34), opponentLoadout: loadout(), solution: stepSixBasicStrikeSolution, opponentCode: passiveOpponent, durationMs: 2000, goal: "basic_strike", spawn: { playerY: tutorialY(60), opponentY: tutorialY(0), playerRotation: 0, opponentRotation: 180 } },
    { id: "rotate", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: stepThreeRotationSolution, opponentCode: passiveOpponent, durationMs: 2000, goal: "heavy_slash", spawn: { playerY: tutorialY(60), opponentY: tutorialY(-60), playerRotation: 180, opponentRotation: 180 } },
    { id: "lock-on", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: stepFourSolution, opponentCode: passiveOpponent, durationMs: 1000, goal: "heavy_slash", spawn: { playerY: tutorialY(60), opponentY: tutorialY(-60), playerRotation: 180, opponentRotation: 180 } },
    { id: "dodge", playerLoadout: loadout(), opponentLoadout: loadout(4), solution: stepFiveSolution, opponentCode: grenadeOpponent, durationMs: 3000, goal: "dodge_grenade", spawn: { playerY: tutorialY(70), opponentY: tutorialY(-80), playerRotation: 0, opponentRotation: 180 } },
    { id: "combine", playerLoadout: loadout(7), opponentLoadout: loadout(4), solution: stepSevenSolution, opponentCode: grenadeOpponent, durationMs: 3000, goal: "combo", spawn: { playerY: tutorialY(70), opponentY: tutorialY(-80), playerRotation: 180, opponentRotation: 180 } },
    { id: "orbiting", playerLoadout: loadout(1), opponentLoadout: loadout(1), solution: orbitingSolution, opponentCode: orbitingOpponent, durationMs: 30000, goal: "defeat_opponent", spawn: { playerY: tutorialY(120), opponentY: tutorialY(0), playerRotation: 0, opponentRotation: 180 } },
    { id: "vulnerability-1", playerLoadout: loadout(1), opponentLoadout: loadout(7, 13), solution: vulnerabilityOneSolution, opponentCode: vulnerabilityOneOpponent, durationMs: 30000, goal: "defeat_opponent_survive", playerHp: 40, spawn: { playerY: tutorialY(300), opponentY: tutorialY(0), playerRotation: 0, opponentRotation: 180 } },
    { id: "vulnerability-2", playerLoadout: loadout(1), opponentLoadout: loadout(6, 7), solution: vulnerabilityTwoSolution, opponentCode: vulnerabilityTwoOpponent, durationMs: 30000, goal: "defeat_opponent_survive", playerHp: 40, spawn: { playerY: tutorialY(140), opponentY: tutorialY(0), playerRotation: 0, opponentRotation: 180 } },
    { id: "combo-and-kite", playerLoadout: loadout(6, 7, 18), opponentLoadout: loadout(1), solution: comboAndKiteSolution, opponentCode: comboAndKiteOpponent, durationMs: 30000, goal: "defeat_opponent_survive", playerHp: 1, spawn: { playerY: tutorialY(184), opponentY: tutorialY(0), playerRotation: 0, opponentRotation: 180 } },
    { id: "custom-variable", playerLoadout: loadout(), opponentLoadout: loadout(), solution: stepEightCustomVariableSolution, opponentCode: passiveOpponent, durationMs: 1000, goal: "custom_variable", spawn: { playerY: tutorialY(150), opponentY: tutorialY(-100), playerRotation: 0, opponentRotation: 180 } },
    { id: "priority", playerLoadout: loadout(), opponentLoadout: loadout(), solution: priorityLessonSolution, emptyCode: priorityLessonStartingCode, opponentCode: passiveOpponent, durationMs: 2200, goal: "priority", spawn: { playerY: tutorialY(150), opponentY: tutorialY(-100), playerRotation: 0, opponentRotation: 180 } },
    { id: "game-overview", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: tutorialY(150), opponentY: tutorialY(-100), playerRotation: 0, opponentRotation: 180 } },
    { id: "ability-catalogue", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: tutorialY(150), opponentY: tutorialY(-100), playerRotation: 0, opponentRotation: 180 } },
    { id: "conditional-catalogue", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: tutorialY(150), opponentY: tutorialY(-100), playerRotation: 0, opponentRotation: 180 } },
    { id: "puzzles", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: tutorialY(150), opponentY: tutorialY(-100), playerRotation: 0, opponentRotation: 180 } },
];

const SCENARIO_ORDER = [
    "arena-basics",
    "movement",
    "distance",
    "basic-strike",
    "priority",
    "rotate",
    "lock-on",
    "dodge",
    "combine",
    "orbiting",
    "vulnerability-1",
    "vulnerability-2",
    "custom-variable",
    "combo-and-kite",
    "game-overview",
    "ability-catalogue",
    "conditional-catalogue",
    "puzzles",
];

const SCENARIOS = SCENARIO_ORDER.map((scenarioId) => (
    SCENARIO_DEFINITIONS.find((scenario) => scenario.id === scenarioId)
));

export const TUTORIAL_STEP_COUNT = SCENARIOS.length;

export function getTutorialScenario(step) {
    const source = SCENARIOS[Math.max(0, Math.min(SCENARIOS.length - 1, Number(step) || 0))];
    return { ...source, emptyCode: (source.emptyCode ?? createEmptyTutorialCode)(), solution: source.solution(), opponentCode: source.opponentCode() };
}

export function buildTutorialArenaShapes(step = 0) {
    const scenario = getTutorialScenario(step);
    const { playerY, opponentY, playerRotation, opponentRotation } = scenario.spawn;
    const player = resetBotShape({
        ...MAIN_SHAPE,
        userId: "tutorial-player",
        username: "My Bot",
        slot: 1,
        teamNumber: 1,
        x: TUTORIAL_CENTER_X,
        y: playerY,
        spawnX: TUTORIAL_CENTER_X,
        spawnY: playerY,
        rotation: playerRotation, combatLoadout: scenario.playerLoadout,
    });
    const opponent = resetBotShape({
        ...buildOpponentShape({ userId: "tutorial-opponent", username: "Opponent 1", selectedLoadout: scenario.opponentLoadout, slot: 2, teamNumber: 2 }),
        x: TUTORIAL_CENTER_X, y: opponentY, spawnX: TUTORIAL_CENTER_X, spawnY: opponentY, rotation: opponentRotation,
        combatLoadout: scenario.opponentLoadout, locked: true,
    });
    const configuredPlayer = scenario.playerHp != null
        ? {
            ...player,
            hp: scenario.playerHp,
            maxHp: scenario.playerMaxHp ?? player.health?.max ?? 150,
            startHp: scenario.playerHp,
            health: {
                ...(player.health ?? {}),
                current: scenario.playerHp,
                max: scenario.playerMaxHp ?? player.health?.max ?? 150,
            },
        }
        : player;
    return [configuredPlayer, scenario.opponentHp ? { ...opponent, hp: scenario.opponentHp, maxHp: scenario.opponentHp } : opponent];
}
