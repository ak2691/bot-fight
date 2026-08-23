import { encodeSandboxLoadout } from "../gameArena/loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetBotShape } from "../gameArena/modelPayloads/arenaShapes.js";

function loadout(...abilities) {
    return encodeSandboxLoadout({ abilities });
}

function branch(id, conditions, actions, createdOrder = 0) {
    return { id, branchType: "if", createdOrder, priority: 1, conditions, actions, children: [] };
}

function root(createdOrder, branches, name = "Root") {
    const safeName = String(name || "Root").trim() || "Root";
    return { id: `tutorial-root-${safeName.toLocaleLowerCase()}-${createdOrder + 1}`, name: safeName, createdOrder, branches };
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

function stepFiveSolution() {
    return code([root(0, [branch("lesson-5-dodge-if", [
        compare("target.distance", "lt", 190, "opponent_grenade"),
    ], [{ action: 19, movementMode: "target", movementDirection: 90, actionTarget: "opponent_grenade" }])])]);
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
        ...stepFiveSolution().roots,
        root(1, [branch("lesson-7-face-if", [always()], [face()])]),
        root(2, [branch("lesson-7-close-if", [
            compare("target.distance", "gt", 115, "opponent"),
        ], [move(0)])]),
        root(3, [branch("lesson-7-slash-if", [
            compare("target.distance", "lte", 115, "opponent"),
            compare("target.relativeBearing", "lte", 16, "opponent"),
        ], [{ action: 7, actionTarget: "opponent" }])]),
    ]);
}

const SEARCH_LESSON_START_ORDER = ["A", "E", "C", "D", "H", "F", "G", "K", "I", "J", "N", "L", "M", "B", "O", "P", "Q", "R", "S", "T"];
const SEARCH_LESSON_DELETED_LETTERS = new Set(["B", "O", "T"]);

function searchLessonRoot(createdOrder, name, configured = false) {
    return root(createdOrder, configured ? [
        branch("lesson-search-node-q-if", [always()], [move(0)]),
    ] : [], name);
}

function searchLessonStartingCode() {
    return code(SEARCH_LESSON_START_ORDER.map((name, index) => searchLessonRoot(index, name)));
}

function searchLessonSolution() {
    return code(SEARCH_LESSON_START_ORDER
        .map((name, index) => ({ name, index }))
        .filter(({ name }) => !SEARCH_LESSON_DELETED_LETTERS.has(name))
        .map(({ name, index }) => searchLessonRoot(index, name, name === "Q")));
}

export function validateSearchNodesLesson(configuration) {
    const roots = Array.isArray(configuration?.roots) ? configuration.roots : [];
    const expectedNames = SEARCH_LESSON_START_ORDER.filter((name) => !SEARCH_LESSON_DELETED_LETTERS.has(name));
    if (roots.length !== expectedNames.length || !roots.every((entry, index) => entry.name === expectedNames[index])) return false;

    const nodeQ = roots.find((entry) => entry.name === "Q");
    if (!nodeQ || Number(nodeQ.createdOrder) !== SEARCH_LESSON_START_ORDER.indexOf("Q")) return false;
    const actions = (nodeQ?.branches ?? []).flatMap((entry) => entry.actions ?? []);
    return actions.some((entry) => (
        entry.action === "move_walk"
        && entry.movementMode === "target"
        && Number(entry.movementDirection) === 0
        && entry.actionTarget === "opponent"
    ));
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
    { id: "search-roots", playerLoadout: loadout(), opponentLoadout: loadout(), solution: searchLessonSolution, emptyCode: searchLessonStartingCode, opponentCode: passiveOpponent, goal: "code_search", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
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
