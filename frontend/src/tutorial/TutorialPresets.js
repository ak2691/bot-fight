import { encodeSandboxLoadout } from "../gameArena/loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetBotShape } from "../gameArena/modelPayloads/arenaShapes.js";

function loadout(...abilities) {
    return encodeSandboxLoadout({ abilities, statPoints: { maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 } });
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
const compareBoolean = (left, value = true) => ({
    type: "expression", left, comparator: "eq", right: { type: "boolean", value },
});
const move = (direction, target = "opponent") => ({ action: "move_walk", movementMode: "target", movementDirection: direction, actionTarget: target });
const dash = (direction, target = "opponent") => ({ action: 19, movementMode: "target", movementDirection: direction, actionTarget: target });
const face = (target = "opponent") => ({ action: "rotate_toward_enemy", actionTarget: target });

export function createEmptyTutorialCode() {
    return { version: "bot-logic-tree-v1", roots: [], blocks: [], clusters: [], customVariables: [] };
}

function code(roots) {
    return { ...createEmptyTutorialCode(), roots };
}

function stepOneSolution() {
    return code([root(0, [
        branch("lesson-1-move-if", [always()], [move("toward")]),
    ])]);
}

function stepTwoSolution() {
    return code([root(0, [
        branch("lesson-2-retreat-if", [compare("my.hp", "lt", 45)], [move("away")]),
        branch("lesson-2-engage", [compare("target.distance", "gt", 100, "opponent")], [move("toward")], 1),
    ])]);
}

function stepThreeRotationSolution() {
    return code([
        root(0, [branch("lesson-3-rotate-if", [always()], [face()])]),
        root(1, [
            branch("lesson-3-close-if", [compare("target.distance", "gt", 115, "opponent")], [move("toward")]),
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
            branch("lesson-4-close-if", [compare("target.distance", "gt", 115, "opponent")], [move("toward")]),
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
    ], [{ action: 19, movementMode: "target", movementDirection: "right", actionTarget: "opponent_grenade" }])])]);
}

function stepSixSolution() {
    return code([
        ...stepFiveSolution().roots,
        root(1, [branch("lesson-6-face-if", [always()], [face()])]),
        root(2, [branch("lesson-6-close-if", [
            compare("target.distance", "gt", 115, "opponent"),
        ], [move("toward")])]),
        root(3, [branch("lesson-6-slash-if", [
            compare("target.distance", "lte", 115, "opponent"),
            compare("target.relativeBearing", "lte", 16, "opponent"),
        ], [{ action: 7, actionTarget: "opponent" }])]),
    ]);
}

function stepSevenSolution() {
    return code([
        root(0, [branch("lesson-7-retreat-if", [
            compare("my.hp", "lt", 35),
        ], [move("away"), face()])]),
        root(1, [branch("lesson-7-approach-if", [
            compare("my.hp", "gte", 35),
            compare("target.distance", "gt", 100, "opponent"),
        ], [move("toward")])]),
        root(2, [branch("lesson-7-attack-if", [
            compare("my.hp", "gte", 35),
        ], [face(), { action: 1, actionTarget: "opponent" }])]),
    ]);
}

const SEARCH_LESSON_START_ORDER = ["A", "E", "C", "D", "H", "F", "G", "K", "I", "J", "N", "L", "M", "B", "O", "P", "Q", "R", "S", "T"];
const SEARCH_LESSON_DELETED_LETTERS = new Set(["B", "O", "T"]);

function searchLessonRoot(createdOrder, name, configured = false) {
    return root(createdOrder, configured ? [
        branch("lesson-search-node-q-if", [always()], [move("toward")]),
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
        && entry.movementDirection === "toward"
        && entry.actionTarget === "opponent"
    ));
}

const CUSTOM_BOOLEAN_SLASH_READY = "custom.heavy_slash_ready";
const CUSTOM_VARIABLE_HITS_LANDED = "custom.hits_landed";

function booleanVariableLessonSolution() {
    const base = stepThreeRotationSolution();
    return {
        ...base,
        roots: base.roots.map((entry, index) => index === 2
            ? {
                ...entry,
                branches: entry.branches.map((branchEntry) => ({
                    ...branchEntry,
                    conditions: [compareBoolean(CUSTOM_BOOLEAN_SLASH_READY)],
                })),
            }
            : entry),
        customVariables: [{
            id: CUSTOM_BOOLEAN_SLASH_READY,
            name: "Heavy Slash Ready",
            valueType: "boolean",
            initialValue: false,
            conditions: [
                compare("target.distance", "lte", 115, "opponent"),
                { ...compare("target.relativeBearing", "lte", 75, "opponent"), join: "and" },
            ],
        }],
    };
}

export function validateBooleanCustomVariableLesson(configuration) {
    const variables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const slashReady = variables.find((variable) => variable.name === "Heavy Slash Ready" && variable.valueType === "boolean");
    if (variables.length !== 1 || !slashReady || slashReady.initialValue !== false) return false;

    const derivedConditions = slashReady.conditions ?? [];
    const matchesCondition = (condition, left, comparator, value, target = undefined) => (
        condition?.type === "expression"
        && condition.left === left
        && condition.comparator === comparator
        && Number(condition.right?.value) === value
        && (!target || condition.leftTarget === target)
    );
    if (derivedConditions.length !== 2
        || derivedConditions[1]?.join !== "and"
        || !matchesCondition(derivedConditions[0], "target.distance", "lte", 115, "opponent")
        || !matchesCondition(derivedConditions[1], "target.relativeBearing", "lte", 75, "opponent")) return false;

    const branches = (configuration?.roots ?? []).flatMap((entry) => entry.branches ?? []);
    const hasRotate = branches.some((entry) => (entry.actions ?? []).some((action) => action.action === "rotate_toward_enemy"));
    const hasApproach = branches.some((entry) => (entry.actions ?? []).some((action) => (
        action.action === "move_walk" && action.movementMode === "target" && action.movementDirection === "toward"
    )));
    const heavySlashBranches = branches.filter((entry) => (entry.actions ?? []).some((action) => action.action === 7));
    const usesSlashReady = heavySlashBranches.length > 0 && heavySlashBranches.every((entry) => (
        (entry.conditions ?? []).length === 1
        && entry.conditions[0].left === slashReady.id
        && entry.conditions[0].comparator === "eq"
        && entry.conditions[0].right?.value === true
    ));
    return hasRotate && hasApproach && usesSlashReady;
}

function customVariablesLessonSolution() {
    return {
        ...code([
            root(0, [
                branch("lesson-variables-count-if", [compare("opponent.hpNetChangeLastTick", "lt", 0)], [{
                    action: "variable",
                    variableId: CUSTOM_VARIABLE_HITS_LANDED,
                    operation: "add",
                    value: 1,
                }]),
            ]),
            root(1, [
                branch("lesson-variables-retreat-if", [compare(CUSTOM_VARIABLE_HITS_LANDED, "gte", 3)], [dash("away")]),
            ]),
            ...[12, 9, 13].map((action, index) => (
                root(index + 2, [
                    branch(`lesson-variables-spam-${action}-if`, [always()], [{ action, actionTarget: "opponent" }]),
                ])
            )),
        ]),
        customVariables: [{ id: CUSTOM_VARIABLE_HITS_LANDED, name: "Hits Landed", valueType: "number", initialValue: 0 }],
    };
}

export function validateCustomVariablesLesson(configuration) {
    const variables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const hitsLanded = variables.find((variable) => variable.name === "Hits Landed" && variable.valueType === "number");
    if (variables.length !== 1 || !hitsLanded || Number(hitsLanded.initialValue) !== 0) return false;

    const branches = (configuration?.roots ?? []).flatMap((entry) => entry.branches ?? []);
    const alwaysBranches = branches.filter((entry) => (entry.conditions ?? []).some((condition) => condition.type === "always"));
    const usesThreeAbilities = [12, 9, 13].every((action) => (
        alwaysBranches.some((entry) => (entry.actions ?? []).some((candidate) => candidate.action === action))
    ));
    const countsConfirmedHits = branches.some((entry) => (
        (entry.conditions ?? []).some((condition) => (
            (condition.left === "opponent.hpNetChangeLastTick" && condition.comparator === "lt" && Number(condition.right?.value) === 0)
            || (condition.left === "opponent.damageTakenLastTick" && condition.comparator === "gt" && Number(condition.right?.value) === 0)
        ))
        && (entry.actions ?? []).some((action) => action.action === "variable" && action.variableId === hitsLanded.id && (
            action.operation === "add" && Number(action.value) === 1
            || action.terms?.some((term) => term.operator === "add" && term.operand?.type === "number" && Number(term.operand.value) === 1)
        ))
    ));
    const retreatsAfterThree = branches.some((entry) => (
        (entry.conditions ?? []).some((condition) => condition.left === hitsLanded.id && condition.comparator === "gte" && Number(condition.right?.value) === 3)
        && (entry.actions ?? []).some((action) => action.action === 19 && action.movementMode === "target" && action.movementDirection === "away" && action.actionTarget === "opponent")
    ));
    return usesThreeAbilities && countsConfirmedHits && retreatsAfterThree;
}

function passiveOpponent() {
    return createEmptyTutorialCode();
}

function meleeOpponent() {
    return code([root(0, [
        branch("opponent-sword-if", [always()], [face(), { action: 1, actionTarget: "opponent" }]),
    ])]);
}
function meleeOpponentNoRot() {
    return code([root(0, [
        branch("opponent-sword-if", [always()], [{ action: 1, actionTarget: "opponent" }]),
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
    { id: "rotate", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: stepThreeRotationSolution, opponentCode: passiveOpponent, durationMs: 2000, goal: "heavy_slash", spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { id: "lock-on", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: stepFourSolution, opponentCode: passiveOpponent, durationMs: 1000, goal: "heavy_slash", spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { id: "dodge", playerLoadout: loadout(), opponentLoadout: loadout(4), solution: stepFiveSolution, opponentCode: grenadeOpponent, durationMs: 3000, goal: "dodge_grenade", spawn: { playerY: 420, opponentY: 570, playerRotation: 180 } },
    { id: "combine", playerLoadout: loadout(7), opponentLoadout: loadout(4), solution: stepSixSolution, opponentCode: grenadeOpponent, durationMs: 3000, goal: "combo", spawn: { playerY: 420, opponentY: 570, playerRotation: 0 } },
    { id: "survive", playerLoadout: loadout(1), opponentLoadout: loadout(1), solution: stepSevenSolution, opponentCode: meleeOpponentNoRot, durationMs: 10000, goal: "survive", opponentHp: 1000, spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { id: "custom-boolean", playerLoadout: loadout(7), opponentLoadout: loadout(), solution: booleanVariableLessonSolution, emptyCode: stepThreeRotationSolution, opponentCode: passiveOpponent, goal: "custom_boolean", spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { id: "custom-integer", playerLoadout: loadout(12, 9, 13), opponentLoadout: loadout(), solution: customVariablesLessonSolution, opponentCode: passiveOpponent, goal: "custom_integer", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "search-roots", playerLoadout: loadout(), opponentLoadout: loadout(), solution: searchLessonSolution, emptyCode: searchLessonStartingCode, opponentCode: passiveOpponent, goal: "code_search", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "ability-catalogue", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { id: "conditional-catalogue", playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialCode, opponentCode: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
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
