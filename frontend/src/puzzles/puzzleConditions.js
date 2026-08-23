import {
    customVariableDefinitions as customVariableDefinitionsForBrain,
    evaluateCondition,
    STATE_VARIABLES,
} from "../gameArena/botlogic/code/BotCode.js";

function numeric(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const FULL_CONDITION_TYPES = new Set(["always", "expression"]);
const COMPARATOR_LABELS = Object.freeze({
    lt: "<",
    lte: "≤",
    eq: "=",
    neq: "≠",
    gte: "≥",
    gt: ">",
});

function isFullCondition(condition) {
    return FULL_CONDITION_TYPES.has(condition?.type);
}

function hasFullConditionList(conditions) {
    return Array.isArray(conditions) && conditions.length > 0 && conditions.every(isFullCondition);
}

function buildPuzzleState(player, opponent, objects = [], closingZone = null, customVariableDefinitions = []) {
    return {
        player: player ?? null,
        opponent: opponent ?? null,
        objects: Array.isArray(objects) ? objects.filter(Boolean) : [],
        closingZone: closingZone ? {
            x: numeric(closingZone.x),
            y: numeric(closingZone.y),
            safeRadius: numeric(closingZone.safeRadius ?? Number(closingZone.size ?? 0) / 2),
        } : null,
        customVariableDefinitions,
    };
}

export function createPuzzleRunMetrics(player, opponent, playerBrain = null) {
    const playerHp = numeric(player?.hp, 0);
    const opponentHp = numeric(opponent?.hp, 0);
    const customDefinitions = customVariableDefinitionsForBrain(playerBrain);
    return {
        elapsedMs: 0,
        playerHp,
        opponentHp,
        playerDamageTaken: 0,
        opponentDamageTaken: 0,
        playerHitsLanded: 0,
        opponentHitsLanded: 0,
        playerAbilityUses: 0,
        opponentAbilityUses: 0,
        playerCustomVariables: { ...(player?.customVariables ?? {}) },
        opponentCustomVariables: { ...(opponent?.customVariables ?? {}) },
        lastPlayerHp: playerHp,
        lastOpponentHp: opponentHp,
        customVariableDefinitions: customDefinitions,
        state: buildPuzzleState(player, opponent, [], null, customDefinitions),
    };
}

export function updatePuzzleRunMetrics(metrics, { player, opponent, stepMs, objects = [], closingZone = null }) {
    if (!metrics) return metrics;

    const playerHp = numeric(player?.hp, 0);
    const opponentHp = numeric(opponent?.hp, 0);
    const playerDamage = Math.max(0, numeric(player?.damageTakenLastTick, 0));
    const opponentDamage = Math.max(0, numeric(opponent?.damageTakenLastTick, 0));

    metrics.elapsedMs = Math.max(metrics.elapsedMs, numeric(player?.matchElapsedMs, metrics.elapsedMs + numeric(stepMs, 0)));
    metrics.playerDamageTaken += playerDamage;
    metrics.opponentDamageTaken += opponentDamage;
    if (opponentHp < metrics.lastOpponentHp) metrics.playerHitsLanded += 1;
    if (playerHp < metrics.lastPlayerHp) metrics.opponentHitsLanded += 1;
    if (player?.triggeredAbility != null) metrics.playerAbilityUses += 1;
    if (opponent?.triggeredAbility != null) metrics.opponentAbilityUses += 1;
    metrics.playerHp = playerHp;
    metrics.opponentHp = opponentHp;
    metrics.playerCustomVariables = { ...(player?.customVariables ?? {}) };
    metrics.opponentCustomVariables = { ...(opponent?.customVariables ?? {}) };
    metrics.lastPlayerHp = playerHp;
    metrics.lastOpponentHp = opponentHp;
    metrics.state = buildPuzzleState(player, opponent, objects, closingZone, metrics.customVariableDefinitions);
    return metrics;
}

function valueForCondition(condition, metrics) {
    switch (condition?.subject) {
        case "opponent.hp": return numeric(metrics.opponentHp);
        case "player.hp": return numeric(metrics.playerHp);
        case "time.elapsedMs": return numeric(metrics.elapsedMs);
        case "player.damageTaken": return numeric(metrics.playerDamageTaken);
        case "opponent.damageTaken": return numeric(metrics.opponentDamageTaken);
        case "player.hitsLanded": return numeric(metrics.playerHitsLanded);
        case "opponent.hitsLanded": return numeric(metrics.opponentHitsLanded);
        case "player.abilityUses": return numeric(metrics.playerAbilityUses);
        case "opponent.abilityUses": return numeric(metrics.opponentAbilityUses);
        case "player.alive": return numeric(metrics.playerHp) > 0;
        case "opponent.alive": return numeric(metrics.opponentHp) > 0;
        case "player.customVariable": return numeric(metrics.playerCustomVariables?.[condition.variableId]);
        case "opponent.customVariable": return numeric(metrics.opponentCustomVariables?.[condition.variableId]);
        default: return null;
    }
}

function compare(actual, operator, expected) {
    if (typeof actual === "boolean") return operator === "eq" && actual === Boolean(expected);

    const left = numeric(actual);
    const right = numeric(expected);
    switch (operator) {
        case "lt": return left < right;
        case "lte": return left <= right;
        case "eq": return Math.abs(left - right) < 0.000001;
        case "gte": return left >= right;
        case "gt": return left > right;
        default: return false;
    }
}

function evaluateFullCondition(condition, metrics) {
    if (!metrics?.state || !isFullCondition(condition)) return false;
    try {
        return Boolean(evaluateCondition(condition, metrics.state));
    } catch {
        return false;
    }
}

function evaluateConditionEntry(condition, metrics) {
    if (isFullCondition(condition)) return evaluateFullCondition(condition, metrics);
    return compare(valueForCondition(condition, metrics), condition?.operator, condition?.value);
}

function evaluateFullConditionList(conditions, metrics) {
    return conditions.reduce((matches, condition, index) => {
        const conditionMatches = evaluateConditionEntry(condition, metrics);
        return index > 0 && condition.join === "or"
            ? matches || conditionMatches
            : matches && conditionMatches;
    }, true);
}

function allConditionsPass(conditions, metrics) {
    if (!Array.isArray(conditions) || !conditions.length) return false;
    return hasFullConditionList(conditions)
        ? evaluateFullConditionList(conditions, metrics)
        : conditions.every((condition) => evaluateConditionEntry(condition, metrics));
}

function anyConditionPasses(conditions, metrics) {
    if (!Array.isArray(conditions) || !conditions.length) return false;
    return hasFullConditionList(conditions)
        ? evaluateFullConditionList(conditions, metrics)
        : conditions.some((condition) => evaluateConditionEntry(condition, metrics));
}

export function evaluatePuzzleOutcome(puzzle, metrics) {
    if (!puzzle || !metrics) return null;

    if (allConditionsPass(puzzle.winConditions, metrics)) return "solved";
    if (anyConditionPasses(puzzle.loseConditions, metrics)) return "failed";
    if (numeric(metrics.elapsedMs) >= numeric(puzzle.timeLimitMs, 90_000)) return "failed";
    return null;
}

function conditionDefinitionsForDisplay(variableDefinitions) {
    const customDefinitions = Array.isArray(variableDefinitions)
        ? variableDefinitions
        : Array.isArray(variableDefinitions?.customVariables) ? variableDefinitions.customVariables : [];
    return [
        ...STATE_VARIABLES,
        ...customDefinitions.map((variable) => ({
            ...variable,
            label: variable.label ?? variable.name ?? variable.id,
        })),
    ];
}

export function puzzleConditionLabel(condition, variableDefinitions = []) {
    if (!condition) return "Unknown condition";
    if (condition.type === "always") return "Always";
    if (condition.type === "expression") {
        const definitions = conditionDefinitionsForDisplay(variableDefinitions);
        const leftDefinition = definitions.find((variable) => variable.id === condition.left);
        const leftLabel = leftDefinition?.label ?? (String(condition.left ?? "condition").startsWith("custom.")
            ? `Custom variable ${condition.left.slice("custom.".length)}`
            : condition.left ?? "condition");
        const target = condition.leftTarget ? ` @ ${condition.leftTarget}` : "";
        const right = condition.right?.type === "variable"
            ? (definitions.find((variable) => variable.id === condition.right.value)?.label ?? condition.right.value)
            : condition.right?.type === "boolean"
                ? (condition.right.value ? "TRUE" : "FALSE")
                : condition.right?.value ?? "?";
        const selection = condition.ability != null
            ? ` (ability ${condition.ability})`
            : condition.statusEffect ? ` (${condition.statusEffect})` : "";
        return `${leftLabel}${target} ${COMPARATOR_LABELS[condition.comparator] ?? condition.comparator ?? "?"} ${right}${selection}`;
    }
    const subject = String(condition.subject ?? "condition").replaceAll(".", " ");
    const operator = COMPARATOR_LABELS[condition.operator] ?? condition.operator ?? "?";
    const value = condition.subject?.endsWith("alive") ? (condition.value ? "alive" : "not alive") : condition.value;
    return `${subject} ${operator} ${value}`;
}
