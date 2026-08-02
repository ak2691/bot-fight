import { encodeSandboxLoadout } from "../beta/loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetFighterShape } from "../beta/modelPayloads/arenaShapes.js";

function loadout(...abilities) {
    return encodeSandboxLoadout({ abilities, statPoints: { maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 } });
}

function branch(id, conditions, actions, branchType = "if", createdOrder = 0) {
    return { id, branchType, createdOrder, priority: 1, conditions, actions, children: [] };
}

function column(id, name, createdOrder, branches) {
    return { id, name, createdOrder, branches };
}

const always = () => ({ type: "always" });
const compare = (left, comparator, value, leftTarget = undefined) => ({
    type: "expression", left, comparator, right: { type: "number", value }, ...(leftTarget ? { leftTarget } : {}),
});
const compareBoolean = (left, value = true) => ({
    type: "expression", left, comparator: "eq", right: { type: "boolean", value },
});
const move = (direction, target = "opponent") => ({ action: "move_walk", movementMode: "target", movementDirection: direction, actionTarget: target });
const face = (target = "opponent") => ({ action: "rotate_toward_enemy", actionTarget: target });

export function createEmptyTutorialBrain() {
    return { version: "bot-logic-tree-v1", columns: [], blocks: [], clusters: [], customVariables: [] };
}

function brain(columns) {
    return { ...createEmptyTutorialBrain(), columns };
}

function stepOneSolution() {
    return brain([column("lesson-1-move", "Always move toward opponent", 0, [
        branch("lesson-1-move-if", [always()], [move("toward")]),
    ])]);
}

function stepTwoSolution() {
    return brain([column("lesson-2-decisions", "Retreat or approach", 0, [
        branch("lesson-2-retreat-if", [compare("my.hp", "lt", 45)], [move("away"), face()]),
        branch("lesson-2-engage-else-if", [compare("target.distance", "gt", 92, "opponent")], [move("toward"), face()], "else_if", 1),
    ])]);
}

function stepThreeSolution() {
    return brain([
        column("lesson-3-face", "Turn toward opponent", 0, [branch("lesson-3-face-if", [always()], [face()])]),
        column("lesson-3-close", "Enter Heavy Slash range", 1, [
            branch("lesson-3-close-if", [compare("target.distance", "gt", 88, "opponent")], [move("toward")]),
        ]),
        column("lesson-3-slash", "Slash only when aimed", 2, [branch("lesson-3-slash-if", [
            compare("target.distance", "lte", 105, "opponent"),
            compare("target.relativeBearing", "lte", 89, "opponent"),
        ], [{ action: "heavy_slash", actionTarget: "opponent" }])]),
    ]);
}

function stepFourSolution() {
    return brain([column("lesson-4-dodge", "Dodge a nearby grenade", 0, [branch("lesson-4-dodge-if", [
        compare("target.distance", "lt", 190, "opponent_grenade"),
    ], [{ action: "micro_dash", movementMode: "target", movementDirection: "right", actionTarget: "opponent_grenade" }])])]);
}

function stepSixSolution() {
    return brain([
        ...stepFourSolution().columns,
        column("lesson-6-face", "Keep the opponent centered", 1, [branch("lesson-6-face-if", [always()], [face()])]),
        column("lesson-6-close", "Close the distance", 2, [branch("lesson-6-close-if", [
            compare("target.distance", "gt", 88, "opponent"),
        ], [move("toward")])]),
        column("lesson-6-slash", "Confirm Heavy Slash", 3, [branch("lesson-6-slash-if", [
            compare("target.distance", "lte", 105, "opponent"),
            compare("target.relativeBearing", "lte", 16, "opponent"),
        ], [{ action: "heavy_slash", actionTarget: "opponent" }])]),
    ]);
}

function stepSevenSolution() {
    return brain([
        column("lesson-7-retreat", "Protect low HP", 0, [branch("lesson-7-retreat-if", [
            compare("my.hp", "lt", 35),
        ], [move("away"), face()])]),
        column("lesson-7-approach", "Enter Sword Swing range", 1, [branch("lesson-7-approach-if", [
            compare("my.hp", "gte", 35),
            compare("target.distance", "gt", 80, "opponent"),
        ], [move("toward")])]),
        column("lesson-7-attack", "Fight while healthy", 2, [branch("lesson-7-attack-if", [
            compare("my.hp", "gte", 35),
        ], [face(), { action: "swing", actionTarget: "opponent" }])]),
    ]);
}

const SEARCH_LESSON_LETTERS = "ABCDEFGHIJKLMNOPQRST".split("");
const SEARCH_LESSON_START_ORDER = ["A", "E", "C", "D", "H", "F", "G", "K", "I", "J", "N", "L", "M", "B", "O", "P", "Q", "R", "S", "T"];
const SEARCH_LESSON_DELETED_LETTERS = new Set(["B", "O", "T"]);

function searchLessonColumn(letter, createdOrder, configured = false) {
    return column(`lesson-search-node-${letter.toLowerCase()}`, configured ? "Retreating" : `Node ${letter}`, createdOrder, configured ? [
        branch("lesson-search-node-q-if", [always()], [move("toward")]),
    ] : []);
}

function searchLessonStartingBrain() {
    return brain(SEARCH_LESSON_START_ORDER.map((letter, index) => searchLessonColumn(letter, index)));
}

function searchLessonSolution() {
    return brain(SEARCH_LESSON_LETTERS
        .filter((letter) => !SEARCH_LESSON_DELETED_LETTERS.has(letter))
        .map((letter, index) => searchLessonColumn(letter, index, letter === "Q")));
}

export function validateSearchNodesLesson(configuration) {
    const columns = Array.isArray(configuration?.columns) ? configuration.columns : [];
    const expectedLetters = SEARCH_LESSON_LETTERS.filter((letter) => !SEARCH_LESSON_DELETED_LETTERS.has(letter));
    if (columns.length !== expectedLetters.length) return false;
    if (!columns.every((entry, index) => entry?.id === `lesson-search-node-${expectedLetters[index].toLowerCase()}`)) return false;

    const nodeQ = columns.find((entry) => entry.id === "lesson-search-node-q");
    const actions = (nodeQ?.branches ?? []).flatMap((entry) => entry.actions ?? []);
    return nodeQ?.name === "Retreating" && actions.some((entry) => (
        entry.action === "move_walk"
        && entry.movementMode === "target"
        && entry.movementDirection === "toward"
        && entry.actionTarget === "opponent"
    ));
}

const CUSTOM_VARIABLE_ATTACK_WINDOW = "custom.attack_window";
const CUSTOM_VARIABLE_HITS_LANDED = "custom.hits_landed";

function customVariablesLessonSolution() {
    return {
        ...brain([
            column("lesson-variables-count", "Count confirmed hits", 0, [
                branch("lesson-variables-count-if", [compare("opponent.hpNetChangeLastTick", "lt", 0)], [{
                    action: "variable",
                    variableId: CUSTOM_VARIABLE_HITS_LANDED,
                    operation: "add",
                    value: 1,
                }]),
            ]),
            ...["pistol_shot", "concussive_shot", "rail_shot"].map((action, index) => (
                column(`lesson-variables-spam-${action}`, `Spam ${action.replaceAll("_", " ")}`, index + 1, [
                    branch(`lesson-variables-spam-${action}-if`, [compareBoolean(CUSTOM_VARIABLE_ATTACK_WINDOW)], [{ action, actionTarget: "opponent" }]),
                ])
            )),
            column("lesson-variables-retreat", "Disengage after three hits", 4, [
                branch("lesson-variables-retreat-if", [compare(CUSTOM_VARIABLE_HITS_LANDED, "gte", 3)], [move("away")]),
            ]),
        ]),
        customVariables: [
            {
                id: CUSTOM_VARIABLE_ATTACK_WINDOW,
                name: "Attack Window",
                valueType: "boolean",
                initialValue: false,
                conditions: [
                    compare("target.distance", "lte", 350, "opponent"),
                    { ...compare("my.hp", "gte", 50), join: "and" },
                    { ...compare("target.relativeBearing", "lte", 20, "opponent"), join: "and" },
                ],
            },
            { id: CUSTOM_VARIABLE_HITS_LANDED, name: "Hits Landed", valueType: "number", initialValue: 0 },
        ],
    };
}

export function validateCustomVariablesLesson(configuration) {
    const variables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const attackWindow = variables.find((variable) => variable.name === "Attack Window" && variable.valueType === "boolean");
    const hitsLanded = variables.find((variable) => variable.name === "Hits Landed" && variable.valueType === "number");
    if (!attackWindow || attackWindow.initialValue !== false || !hitsLanded || Number(hitsLanded.initialValue) !== 0) return false;
    const derivedConditions = attackWindow.conditions ?? [];
    const hasDerivedCondition = (left, comparator, value, target) => derivedConditions.some((condition) => (
        condition.type === "expression"
        && condition.left === left
        && condition.comparator === comparator
        && Number(condition.right?.value) === value
        && (!target || condition.leftTarget === target)
    ));
    const hasAttackWindow = derivedConditions.length === 3
        && derivedConditions.every((condition, index) => index === 0 || condition.join !== "or")
        && hasDerivedCondition("target.distance", "lte", 350, "opponent")
        && hasDerivedCondition("my.hp", "gte", 50)
        && hasDerivedCondition("target.relativeBearing", "lte", 20, "opponent");
    if (!hasAttackWindow) return false;

    const branches = (configuration?.columns ?? []).flatMap((entry) => entry.branches ?? []);
    const attackWindowUses = branches.filter((entry) => (entry.conditions ?? []).some((condition) => (
        condition.type === "expression"
        && condition.left === attackWindow.id
        && condition.comparator === "eq"
        && condition.right?.value === true
    )));
    const abilityActions = new Set(attackWindowUses.flatMap((entry) => entry.actions ?? []).map((entry) => entry.action));
    const usesThreeAbilities = attackWindowUses.length >= 3
        && ["pistol_shot", "concussive_shot", "rail_shot"].every((action) => abilityActions.has(action));
    const countsConfirmedHits = branches.some((entry) => (
        (entry.conditions ?? []).some((condition) => condition.left === "opponent.hpNetChangeLastTick" && condition.comparator === "lt" && Number(condition.right?.value) === 0)
        && (entry.actions ?? []).some((action) => action.action === "variable" && action.variableId === hitsLanded.id && (
            action.operation === "add" && Number(action.value) === 1
            || action.terms?.some((term) => term.operator === "add" && term.operand?.type === "number" && Number(term.operand.value) === 1)
        ))
    ));
    const retreatsAfterThree = branches.some((entry) => (
        (entry.conditions ?? []).some((condition) => condition.left === hitsLanded.id && condition.comparator === "gte" && Number(condition.right?.value) === 3)
        && (entry.actions ?? []).some((action) => action.action === "move_walk" && action.movementDirection === "away")
    ));
    return usesThreeAbilities && countsConfirmedHits && retreatsAfterThree;
}

function passiveOpponent() {
    return createEmptyTutorialBrain();
}

function meleeOpponent() {
    return brain([column("opponent-sword", "Stationary sword pressure", 0, [
        branch("opponent-sword-if", [always()], [face(), { action: "swing", actionTarget: "opponent" }]),
    ])]);
}
function meleeOpponentNoRot() {
    return brain([column("opponent-sword", "Stationary sword pressure", 0, [
        branch("opponent-sword-if", [always()], [{ action: "swing", actionTarget: "opponent" }]),
    ])]);
}

function grenadeOpponent() {
    return brain([
        column("opponent-grenade-face", "Aim at player", 0, [branch("opponent-grenade-face-if", [always()], [face()])]),
        column("opponent-grenade-throw", "Throw grenade", 1, [branch("opponent-grenade-throw-if", [always()], [{ action: "throw_grenade", actionTarget: "opponent" }])]),
    ]);
}

const SCENARIOS = [
    { playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialBrain, opponentBrain: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { playerLoadout: loadout(), opponentLoadout: loadout(), solution: stepOneSolution, opponentBrain: passiveOpponent, spawn: { playerY: 360, opponentY: 650, playerRotation: 180 } },
    { playerLoadout: loadout(), opponentLoadout: loadout("swing"), solution: stepTwoSolution, opponentBrain: meleeOpponent, spawn: { playerY: 420, opponentY: 560, playerRotation: 180 } },
    { playerLoadout: loadout("heavy_slash"), opponentLoadout: loadout(), solution: stepThreeSolution, opponentBrain: passiveOpponent, spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { playerLoadout: loadout("micro_dash"), opponentLoadout: loadout("throw_grenade"), solution: stepFourSolution, opponentBrain: grenadeOpponent, spawn: { playerY: 420, opponentY: 570, playerRotation: 180 } },
    { playerLoadout: loadout("heavy_slash", "micro_dash"), opponentLoadout: loadout("throw_grenade"), solution: stepSixSolution, opponentBrain: grenadeOpponent, durationMs: 5000, goal: "combo", spawn: { playerY: 420, opponentY: 570, playerRotation: 0 } },
    { playerLoadout: loadout("swing"), opponentLoadout: loadout("swing"), solution: stepSevenSolution, opponentBrain: meleeOpponentNoRot, durationMs: 10000, goal: "survive", opponentHp: 1000, spawn: { playerY: 440, opponentY: 560, playerRotation: 0 } },
    { playerLoadout: loadout("pistol_shot", "concussive_shot", "rail_shot"), opponentLoadout: loadout(), solution: customVariablesLessonSolution, opponentBrain: passiveOpponent, goal: "custom_variables", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { playerLoadout: loadout(), opponentLoadout: loadout(), solution: searchLessonSolution, emptyBrain: searchLessonStartingBrain, opponentBrain: passiveOpponent, goal: "brain_search", spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialBrain, opponentBrain: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
    { playerLoadout: loadout(), opponentLoadout: loadout(), solution: createEmptyTutorialBrain, opponentBrain: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 180 } },
];

export const TUTORIAL_STEP_COUNT = SCENARIOS.length;

export function getTutorialScenario(step) {
    const source = SCENARIOS[Math.max(0, Math.min(SCENARIOS.length - 1, Number(step) || 0))];
    return { ...source, emptyBrain: (source.emptyBrain ?? createEmptyTutorialBrain)(), solution: source.solution(), opponentBrain: source.opponentBrain() };
}

export function buildTutorialArenaShapes(step = 0) {
    const scenario = getTutorialScenario(step);
    const { playerY, opponentY, playerRotation } = scenario.spawn;
    const player = resetFighterShape({
        ...MAIN_SHAPE, username: "Your tutorial bot", x: 500, y: playerY, spawnX: 500, spawnY: playerY,
        rotation: playerRotation, combatLoadout: scenario.playerLoadout,
    });
    const opponent = resetFighterShape({
        ...buildOpponentShape({ username: "Tutorial opponent", selectedLoadout: scenario.opponentLoadout, slot: 2 }),
        x: 500, y: opponentY, spawnX: 500, spawnY: opponentY, rotation: 0,
        combatLoadout: scenario.opponentLoadout, locked: true,
    });
    return [player, scenario.opponentHp ? { ...opponent, hp: scenario.opponentHp, maxHp: scenario.opponentHp } : opponent];
}
