import { createStatePayloadFactory } from "../modelPayloads/strategyStatePayload.js";
import { isSimulationBotShape } from "../modelPayloads/arenaTick.js";
import { toSimulationBotShape } from "../modelPayloads/arenaShapes.js";
import { stateFromPayload } from "../botlogic/code/runtime/runtimeState.js";
import {
    applyStrategyVariableAction,
    evaluateStrategyConditions,
    normalizeConditions,
    prepareStrategyCustomVariables,
} from "../botlogic/code/BotCode.js";
import {
    BOT_LOGIC_TREE_V1,
    BOT_LOGIC_TREE_VERSION,
    CUSTOM_NUMBER_MAX,
    MAX_VARIABLE_ACTION_TERMS,
    truncateToNumberPrecision,
} from "../botlogic/code/configuration/constants.js";
import {
    BOT_CODE_ACTIONS,
    CUSTOM_VARIABLE_CONTRACT,
    CUSTOM_VARIABLE_OPERATIONS,
} from "../botlogic/code/contracts/BotLogicContracts.js";

const PUZZLE_VARIABLE_PREFIX = `${CUSTOM_VARIABLE_CONTRACT.PREFIX}puzzle.`;
const NO_TERM_OPERATIONS = new Set([
    CUSTOM_VARIABLE_OPERATIONS.ADD,
    CUSTOM_VARIABLE_OPERATIONS.SUBTRACT,
    CUSTOM_VARIABLE_OPERATIONS.MODULO,
]);

/**
 * Port of server PuzzleOutcomeEvaluator.java. Create one per attempt and pass
 * `afterTick` to simulateMatch: it is called after every tick and returns true once
 * the outcome is known. `status()` is "solved" or "failed" (failed by default), and
 * `elapsedMs()` is the loop's clock. initialElapsedMs is not needed here: the arena
 * already carries it, as in Java (the evaluator only stored it).
 *
 * `afterTick({ elapsedMs, shapes })` may write the player's custom variables back into
 * `shapes` in place. The planner reads them on the next tick.
 */
export function createPuzzleOutcome(puzzle) {
    if (!isPlainObject(puzzle)) throw new Error("puzzle must be an object");
    const logicConfiguration = isPlainObject(puzzle.logicConfiguration) ? puzzle.logicConfiguration : null;
    // Java usesPuzzleLogic: the logic configuration is an object with a roots array.
    const usesPuzzleLogic = Array.isArray(logicConfiguration?.roots);
    // Java logicCoordinateVersion: v2 only when named exactly, otherwise v1. Legacy flat
    // conditions always evaluate as v1.
    const coordinateVersion = usesPuzzleLogic && logicConfiguration.version === BOT_LOGIC_TREE_VERSION
        ? BOT_LOGIC_TREE_VERSION
        : BOT_LOGIC_TREE_V1;
    const timeLimitMs = Math.max(0, Math.trunc(Number(puzzle.timeLimitMs) || 0));
    const legacyWin = legacyConditions(puzzle.winConditions);
    const legacyLose = legacyConditions(puzzle.loseConditions);
    const definitions = usesPuzzleLogic ? puzzleVariableDefinitions(logicConfiguration) : new Map();
    const definitionList = [...definitions.values()];

    let initialized = false;
    let elapsed = 0;
    let status = null;

    function legacyConditions(source) {
        return Array.isArray(source) && source.length > 0
            ? normalizeConditions(source, [], undefined, BOT_LOGIC_TREE_V1)
            : [];
    }

    // Java selects the player (team 1, slot 1; else lowest team-1 slot; else first bot).
    function selectPlayer(bots) {
        return bots.find((bot) => Number(bot.teamNumber) === 1 && Number(bot.slot) === 1)
            ?? lowestSlot(bots.filter((bot) => Number(bot.teamNumber) === 1))
            ?? bots[0]
            ?? null;
    }

    // Java selects the opponent: not the player, and on another team (or any team when the
    // player has no positive team), lowest team number then lowest slot.
    function selectOpponent(bots, player) {
        const candidates = bots.filter((bot) => bot !== player
            && (Number(player.teamNumber) <= 0 || Number(bot.teamNumber) !== Number(player.teamNumber)));
        return candidates.reduce((best, bot) => (best == null
            || Number(bot.teamNumber) < Number(best.teamNumber)
            || (Number(bot.teamNumber) === Number(best.teamNumber) && Number(bot.slot) < Number(best.slot))
            ? bot
            : best), null);
    }

    // Java initializePuzzleVariables: write the puzzle variables onto the player, once.
    function initializePuzzleVariables(shapes, index) {
        const shape = shapes[index];
        const customVariables = { ...(shape.customVariables ?? {}) };
        for (const definition of definitionList) customVariables[definition.id] = definition.initialValue;
        shapes[index] = { ...shape, customVariables };
        initialized = true;
    }

    // The planner's view of the player after the tick, built from the current shapes so
    // that every check sees variables written by earlier modify actions.
    function playerState(shapes, index, loadout) {
        const payload = createStatePayloadFactory(shapes).forActor(loadout, shapes[index].id);
        const state = stateFromPayload(payload, coordinateVersion);
        prepareStrategyCustomVariables(state, definitionList);
        return state;
    }

    // Java matchesPuzzleBranch: a branch needs a non-empty condition list; all must pass.
    function branchMatches(branch, state) {
        const conditions = branch?.conditions;
        if (!Array.isArray(conditions) || conditions.length === 0) return false;
        return evaluateStrategyConditions(
            normalizeConditions(conditions, definitionList, undefined, coordinateVersion),
            state,
        );
    }

    // Java matchesPuzzleRules: any branch of any root with this kind wins. Only top-level
    // branches are checked, as in Java.
    function rulesMatch(kind, state) {
        return rootsOf(logicConfiguration, kind).some((root) => branchesOf(root)
            .some((branch) => branchMatches(branch, state)));
    }

    // Java applyPuzzleModifyRules: each modify branch is checked against the player as it
    // stands, then its variable actions apply in order.
    function applyModifyRules(shapes, index, loadout) {
        for (const root of rootsOf(logicConfiguration, "modify")) {
            for (const branch of branchesOf(root)) {
                const state = playerState(shapes, index, loadout);
                if (!branchMatches(branch, state)) continue;
                if (!Array.isArray(branch.actions)) continue;
                for (const action of branch.actions) applyPuzzleVariableAction(action, state);
                shapes[index] = { ...shapes[index], customVariables: { ...state.player.customVariables } };
            }
        }
    }

    // Java applyPuzzleVariableAction + CustomVariableActionService.apply, expressed as a
    // block for the planner's custom-variable runtime.
    function applyPuzzleVariableAction(action, state) {
        if (action?.action !== BOT_CODE_ACTIONS.VARIABLE) return;
        const variableId = typeof action.variableId === "string" ? action.variableId : "";
        const definition = definitions.get(variableId);
        if (!definition) return;

        if (definition.valueType === "boolean") {
            // Java: the boolean value is read with asBoolean(false), then stored as value != 0.
            applyStrategyVariableAction({
                action: BOT_CODE_ACTIONS.VARIABLE,
                variableId,
                value: booleanValue(action.value),
            }, state, definitionList);
            return;
        }

        // Java: the value only counts when it is a JSON number; anything else is 0.
        const value = typeof action.value === "number" ? action.value : 0;
        const terms = Array.isArray(action.terms) && action.terms.length > 0
            ? action.terms.slice(0, MAX_VARIABLE_ACTION_TERMS).map(sanitizeTerm)
            : null;
        if (terms) {
            applyStrategyVariableAction({ action: BOT_CODE_ACTIONS.VARIABLE, variableId, terms }, state, definitionList);
            return;
        }
        // Java applyOperation: any operation other than add, subtract or modulo sets the value.
        const operation = NO_TERM_OPERATIONS.has(action.operation) ? action.operation : CUSTOM_VARIABLE_OPERATIONS.SET;
        applyStrategyVariableAction({ action: BOT_CODE_ACTIONS.VARIABLE, variableId, operation, value }, state, definitionList);
    }

    return {
        afterTick({ elapsedMs: nextElapsedMs, shapes }) {
            if (status !== null) return true;
            elapsed = Math.max(0, Number(nextElapsedMs) || 0);
            const bots = shapes.filter(isSimulationBotShape).map(toSimulationBotShape);
            if (bots.length < 2) {
                status = "failed";
                return true;
            }
            const player = selectPlayer(bots);
            const opponent = player ? selectOpponent(bots, player) : null;
            if (!player || !opponent) {
                status = "failed";
                return true;
            }
            const index = shapes.findIndex((shape) => shape.id === player.id);
            const loadout = player.combatLoadout;

            if (usesPuzzleLogic) {
                if (!initialized) initializePuzzleVariables(shapes, index);
                applyModifyRules(shapes, index, loadout);
            }

            const state = playerState(shapes, index, loadout);
            const won = usesPuzzleLogic
                ? rulesMatch("win", state)
                : legacyWin.length > 0 && evaluateStrategyConditions(legacyWin, state);
            if (won) {
                status = "solved";
            } else {
                const lost = usesPuzzleLogic
                    ? rulesMatch("lose", state)
                    : legacyLose.length > 0 && evaluateStrategyConditions(legacyLose, state);
                if (lost) status = "failed";
                else if (elapsed >= timeLimitMs) status = "failed";
            }
            return status !== null;
        },
        status() {
            return status ?? "failed";
        },
        elapsedMs() {
            return elapsed;
        },
    };
}

function puzzleVariableDefinitions(logicConfiguration) {
    const definitions = new Map();
    const variables = logicConfiguration.customVariables;
    if (!Array.isArray(variables)) return definitions;
    for (const variable of variables) {
        const id = typeof variable?.id === "string" ? variable.id : "";
        if (!id.startsWith(PUZZLE_VARIABLE_PREFIX)) continue;
        const valueType = variable.valueType === "boolean" ? "boolean" : "number";
        const initialValue = valueType === "boolean"
            ? booleanValue(variable.initialValue ?? false)
            : truncateToNumberPrecision(Math.max(
                -CUSTOM_NUMBER_MAX,
                Math.min(CUSTOM_NUMBER_MAX, numberValue(variable.initialValue)),
            ));
        definitions.set(id, { id, name: id, valueType, initialValue });
    }
    return definitions;
}

// Keeps only what Java reads from a term: a variable operand, or a JSON number otherwise.
function sanitizeTerm(term) {
    const operand = term?.operand;
    const operator = term?.operator;
    if (operand?.type === "variable") return { operator, operand };
    return { operator, operand: { type: "number", value: typeof operand?.value === "number" ? operand.value : 0 } };
}

function rootsOf(logicConfiguration, kind) {
    return (Array.isArray(logicConfiguration?.roots) ? logicConfiguration.roots : [])
        .filter((root) => root?.kind === kind);
}

function branchesOf(root) {
    return Array.isArray(root?.branches) ? root.branches : [];
}

// Jackson-style reads: a JSON number, a numeric string, otherwise the fallback.
function numberValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    return 0;
}

// Jackson-style asBoolean(false): true/false, a number is true when non-zero, the strings
// "true" and "false" are read, anything else is false.
function booleanValue(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (value === "true") return true;
    return false;
}

function lowestSlot(bots) {
    return bots.reduce((best, bot) => (best == null || Number(bot.slot) < Number(best.slot) ? bot : best), null);
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}
