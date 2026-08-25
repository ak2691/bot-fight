import { encodeSandboxLoadout } from "../gameArena/loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetBotShape } from "../gameArena/modelPayloads/arenaShapes.js";

function loadout(...abilities) {
    return encodeSandboxLoadout({ abilities });
}

function branch(id, conditions, actions, createdOrder = 0) {
    return { id, branchType: "if", createdOrder, priority: 1, conditions, actions, children: [] };
}

function root(createdOrder, branches, name = "Root", id = null) {
    const safeName = String(name || "Root").trim() || "Root";
    return { id: id || `tutorial-root-${safeName.toLocaleLowerCase()}-${createdOrder + 1}`, name: safeName, createdOrder, branches };
}

const always = () => ({ type: "always" });
const compare = (left, comparator, value, leftTarget = undefined) => ({
    type: "expression", left, comparator, right: { type: "number", value }, ...(leftTarget ? { leftTarget } : {}),
});
const move = (direction, target = "opponent") => ({ action: "move_walk", movementMode: "target", movementDirection: direction, actionTarget: target });
const face = (target = "opponent") => ({ action: "rotate_toward_enemy", actionTarget: target });

export function createEmptyTutorialCode() {
    return { version: "bot-logic-tree-v1", roots: [], blocks: [], clusters: [], customVariables: [] };
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
    return Boolean(first && second && Number(first.createdOrder) < Number(second.createdOrder));
}

function code(roots) {
    return { ...createEmptyTutorialCode(), roots };
}

function stepOneSolution() {
    return code([root(0, [
        branch("lesson-1-move-if", [always()], [move(0)]),
    ])]);
}

function stepTwoSolution() {
    return code([root(0, [
        branch("lesson-2-retreat-if", [compare("my.hp", "lt", 45)], [move(180)]),
        branch("lesson-2-engage", [compare("target.distance", "gt", 100, "opponent")], [move(0)], 1),
    ])]);
}

function stepThreeRotationSolution() {
    return code([
        root(0, [branch("lesson-3-rotate-if", [always()], [face()])]),
        root(1, [
            branch("lesson-3-close-if", [compare("target.distance", "gt", 115, "opponent")], [move(0)]),
        ]),
        root(2, [branch("lesson-3-slash-if", [
            compare("target.distance", "lte", 115, "opponent"),
            compare("target.relativeBearing", "lte", 75, "opponent"),
        ], [{ action: 7, actionTarget: "opponent" }])]),
    ]);
}

function stepFourSolution() {
    return code([
        root(0, [branch("lesson-4-lock-on-if", [always()], [{ action: 20, actionTarget: "opponent" }])]),
        root(1, [
            branch("lesson-4-close-if", [compare("target.distance", "gt", 115, "opponent")], [move(0)]),
        ]),
        root(2, [branch("lesson-4-slash-if", [
            compare("target.distance", "lte", 115, "opponent"),
            compare("target.relativeBearing", "lte", 75, "opponent"),
        ], [{ action: 7, actionTarget: "opponent" }])]),
    ]);
}

function stepFiveSolution(actionTarget = "opponent") {
    return code([root(0, [branch("lesson-6-dodge-if", [always()], [
        { action: 19, movementMode: "target", movementDirection: 90, actionTarget },
    ])])]);
}

function stepSixBasicStrikeSolution() {
    return code([root(0, [branch("lesson-6-basic-strike-if", [always()], [{ action: 34, actionTarget: "opponent" }])])]);
}

function stepEightCustomVariableSolution() {
    const variableId = "custom.variable-1";
    return {
        ...code([root(0, [branch("lesson-8-variable-if", [always()], [{
            action: "variable",
            variableId,
            terms: [{ operator: "add", operand: { type: "number", value: 1 } }],
        }])])]),
        customVariables: [{ id: variableId, name: "Variable 1", valueType: "number", initialValue: 0 }],
    };
}

function stepSevenSolution() {
    return code([
        ...stepFiveSolution("opponent_grenade").roots,
        root(1, [branch("lesson-7-face-if", [always()], [face()])]),
        root(2, [branch("lesson-7-close-if", [
            compare("target.distance", "gt", 115, "opponent"),
        ], [move(0)])]),
        root(3, [branch("lesson-7-slash-if", [
            compare("target.distance", "lte", 115, "opponent"),
            compare("target.relativeBearing", "lte", 75, "opponent"),
        ], [{ action: 7, actionTarget: "opponent" }])]),
    ]);
}

function priorityLessonStartingCode() {
    return code([
        root(0, [branch("lesson-9-dash-if", [always()], [
            { action: 19, movementMode: "target", movementDirection: 90, actionTarget: "opponent" },
        ])], "Dash", "tutorial-root-dash"),
        root(1, [branch("lesson-9-lock-on-if", [always()], [
            { action: 20, actionTarget: "opponent" },
        ])], "Lock On", "tutorial-root-lock-on"),
    ]);
}

function priorityLessonSolution() {
    return code([
        root(1, [branch("lesson-9-dash-if", [always()], [
            { action: 19, movementMode: "target", movementDirection: 90, actionTarget: "opponent" },
        ])], "Dash", "tutorial-root-dash"),
        root(0, [branch("lesson-9-lock-on-if", [always()], [
            { action: 20, actionTarget: "opponent" },
        ])], "Lock On", "tutorial-root-lock-on"),
    ]);
}

function passiveOpponent() {
    return createEmptyTutorialCode();
}

function meleeOpponent() {
    return code([root(0, [
        branch("opponent-sword-if", [always()], [face(), { action: 1, actionTarget: "opponent" }]),
    ])]);
}

function grenadeOpponent() {
    return code([
        root(0, [branch("opponent-grenade-face-if", [always()], [face()])]),
        root(1, [branch("opponent-grenade-throw-if", [always()], [{ action: 4, actionTarget: "opponent" }])]),
    ]);
}

const SCENARIOS = [
    { id: "movement", playerLoadout: loadout(), opponentLoadout: loadout(), solution: stepOneSolution, opponentCode: passiveOpponent, spawn: { playerY: 360, opponentY: 650, playerRotation: 180 } },
    { id: "distance", playerLoadout: loadout(), opponentLoadout: loadout(1), solution: stepTwoSolution, opponentCode: meleeOpponent, spawn: { playerY: 420, opponentY: 560, playerRotation: 180 } },
    { id: "basic-strike", playerLoadout: loadout(34), opponentLoadout: loadout(), solution: stepSixBasicStrikeSolution, opponentCode: passiveOpponent, durationMs: 2000, goal: "basic_strike", spawn: { playerY: 500, opponentY: 560, playerRotation: 180 } },
    { id: "rotate", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: stepThreeRotationSolution, opponentCode: passiveOpponent, durationMs: 2000, goal: "heavy_slash", spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { id: "lock-on", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: stepFourSolution, opponentCode: passiveOpponent, durationMs: 1000, goal: "heavy_slash", spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { id: "dodge", playerLoadout: loadout(), opponentLoadout: loadout(4), solution: stepFiveSolution, opponentCode: grenadeOpponent, durationMs: 3000, goal: "dodge_grenade", spawn: { playerY: 420, opponentY: 570, playerRotation: 180 } },
    { id: "combine", playerLoadout: loadout(7), opponentLoadout: loadout(4), solution: stepSevenSolution, opponentCode: grenadeOpponent, durationMs: 3000, goal: "combo", spawn: { playerY: 420, opponentY: 570, playerRotation: 0 } },
    { id: "custom-variable", playerLoadout: loadout(), opponentLoadout: loadout(), solution: stepEightCustomVariableSolution, opponentCode: passiveOpponent, durationMs: 1000, goal: "custom_variable", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "priority", playerLoadout: loadout(), opponentLoadout: loadout(), solution: priorityLessonSolution, emptyCode: priorityLessonStartingCode, opponentCode: passiveOpponent, durationMs: 2200, goal: "priority", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "game-overview", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "ability-catalogue", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "conditional-catalogue", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "puzzles", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
];

export const TUTORIAL_STEP_COUNT = SCENARIOS.length;

export function getTutorialScenario(step) {
    const source = SCENARIOS[Math.max(0, Math.min(SCENARIOS.length - 1, Number(step) || 0))];
    return { ...source, emptyCode: (source.emptyCode ?? createEmptyTutorialCode)(), solution: source.solution(), opponentCode: source.opponentCode() };
}

export function buildTutorialArenaShapes(step = 0) {
    const scenario = getTutorialScenario(step);
    const { playerY, opponentY, playerRotation } = scenario.spawn;
    const player = resetBotShape({
        ...MAIN_SHAPE, username: "Your tutorial bot", x: 500, y: playerY, spawnX: 500, spawnY: playerY,
        rotation: playerRotation, combatLoadout: scenario.playerLoadout,
    });
    const opponent = resetBotShape({
        ...buildOpponentShape({ username: "Tutorial opponent", selectedLoadout: scenario.opponentLoadout, slot: 2 }),
        x: 500, y: opponentY, spawnX: 500, spawnY: opponentY, rotation: 0,
        combatLoadout: scenario.opponentLoadout, locked: true,
    });
    return [player, scenario.opponentHp ? { ...opponent, hp: scenario.opponentHp, maxHp: scenario.opponentHp } : opponent];
}
