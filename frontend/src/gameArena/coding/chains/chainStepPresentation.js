// Plain-language labels and one-line summaries for chain steps. Formatting only.
import { ACTION_HEADS, BOT_CODE_ACTIONS, CUSTOM_VARIABLE_OPERATIONS } from "../../botlogic/code/contracts/BotLogicContracts.js";
import { CHAIN_STEP_TYPES } from "../../botlogic/code/configuration/constants.js";
import { absoluteMovementAngle, relativeMovementAngle } from "../../botlogic/planner/arenaAngles.js";
import { summarizeCondition, describeCondition } from "../nodes/conditionSummary.js";
import {
    actionTargetMode,
    relativeMovementPhrase,
    resolveSelectableTarget,
    variableActionSummary,
} from "../nodes/actionNodePresentation.js";
import { variableActionTerms } from "../nodes/actionOperandEdits.js";
import { msToSeconds } from "./chainEditing.js";

export const CHAIN_CATEGORY_LABELS = Object.freeze({
    [ACTION_HEADS.MOVEMENT]: "MOVE",
    [ACTION_HEADS.ROTATION]: "ROTATE",
    [ACTION_HEADS.ABILITY]: "ABILITY",
    [ACTION_HEADS.VARIABLE]: "VARIABLE",
    [ACTION_HEADS.CANCEL]: "CANCEL",
});

const FLOW_LABELS = Object.freeze({
    [CHAIN_STEP_TYPES.IF]: "IF",
    [CHAIN_STEP_TYPES.ELSE_IF]: "ELSE IF",
    [CHAIN_STEP_TYPES.ELSE_IF]: "ELSE IF",
    [CHAIN_STEP_TYPES.WAIT]: "WAIT",
    [CHAIN_STEP_TYPES.RUN_CHAIN]: "RUN CHAIN",
    [CHAIN_STEP_TYPES.EXIT_LOOP]: "EXIT LOOP",
    [CHAIN_STEP_TYPES.END]: "END",
});

/** "1.0 s": seconds with one decimal, the way every chain duration is shown. */
export const formatChainSeconds = (ms) => `${msToSeconds(ms).toFixed(1)} s`;

/** Short entity names for tight spaces: Me, Opp 1, Ally 2. */
export function shortTargetLabel(description) {
    return String(description ?? "")
        .replace(/^My Bot$/, "Me")
        .replace(/^Opponent (\d+)/, "Opp $1")
        .replace(/^Teammate (\d+)/, "Ally $1");
}

function targetText(entry, selectableTypes) {
    return resolveSelectableTarget(entry.selectable, selectableTypes).description;
}

const formatPoint = (entry) => `(${Number(entry.targetX ?? 0)}, ${Number(entry.targetY ?? 0)})`;

/** Where a move heads, worded as on the main canvas: "to Opponent 1", "away from Opponent 1", "90° from Opponent 1". */
function movementPhrase(entry, selectableTypes) {
    if (entry.movementMode === "absolute") return `${absoluteMovementAngle(entry.movementDirection)}° absolute`;
    const subject = entry.movementMode === "coordinates" ? formatPoint(entry) : targetText(entry, selectableTypes);
    return relativeMovementPhrase(relativeMovementAngle(entry.movementDirection), subject);
}

/** Plain-language condition list: "Cleave Ready", "Time Since Hit (Cleave) < 0.3 s". Several read as "A and B". */
export function conditionsPhrase(conditions, lookups) {
    const phrases = (Array.isArray(conditions) ? conditions : []).map((condition) => {
        const summary = summarizeCondition(condition, lookups);
        const holds = condition?.right?.type === "boolean" && condition.comparator === "eq";
        if (!holds) return describeCondition(condition, lookups);
        // Your own bot is implied, and "Ability Ready" for Cleave reads "Cleave Ready".
        const entities = summary.entities.map(shortTargetLabel).filter((entity) => entity !== "Me");
        const name = [...entities, summary.subject.replace(/^Ability (?=\S)/, entities.length ? "" : "Ability ")].join(" ");
        return condition.right.value ? name : `not ${name}`;
    });
    return phrases.length ? phrases.join(" and ") : "its conditions hold";
}

function timingPhrase(step, lookups) {
    if (Array.isArray(step.untilConditions)) {
        return { text: `until ${conditionsPhrase(step.untilConditions, lookups)}`, max: `max ${formatChainSeconds(step.maxMs)}` };
    }
    return { text: `for ${formatChainSeconds(step.forMs)}`, max: "" };
}

/**
 * One step as { tag, tone, label, summary }. `tone` is "action" (green node), "if" (blue), "flow"
 * (grey node) or "repeat" (violet bracket). `context` supplies { actionTypes, selectableTypes,
 * customVariables, stateVariables, chains, lookups }.
 */
export function describeChainStep(step, context) {
    const { actionTypes = [], selectableTypes = [], customVariables = [], stateVariables = [], chains = [], lookups } = context;
    switch (step?.type) {
        case CHAIN_STEP_TYPES.ACTION: {
            const definition = actionTypes.find((action) => action.id === step.action);
            return describeActionStep(step, definition, { selectableTypes, customVariables, stateVariables, lookups });
        }
        case CHAIN_STEP_TYPES.IF:
        case CHAIN_STEP_TYPES.ELSE_IF:
            return { tag: FLOW_LABELS[step.type], tone: "if", label: step.type === CHAIN_STEP_TYPES.IF ? "If" : "Else if", summary: conditionsPhrase(step.conditions, lookups) };
        case CHAIN_STEP_TYPES.WAIT: {
            const timing = timingPhrase(step, lookups);
            return { tag: FLOW_LABELS.wait, tone: "flow", label: timing.text.replace(/^for /, ""), summary: timing.max };
        }
        case CHAIN_STEP_TYPES.REPEAT: {
            const label = Array.isArray(step.whileConditions)
                ? `Repeat while ${conditionsPhrase(step.whileConditions, lookups)} (max ${formatChainSeconds(step.maxMs)})`
                : `Repeat ${step.count} ${step.count === 1 ? "time" : "times"}`;
            return { tag: "REPEAT", tone: "repeat", label, summary: "" };
        }
        case CHAIN_STEP_TYPES.RUN_CHAIN:
            return { tag: FLOW_LABELS.runChain, tone: "flow", label: chains.find((chain) => chain.id === step.chainId)?.name ?? "Choose a chain", summary: "" };
        case CHAIN_STEP_TYPES.EXIT_LOOP: return { tag: FLOW_LABELS.exitLoop, tone: "flow", label: "Leave the Repeat", summary: "" };
        case CHAIN_STEP_TYPES.END: return { tag: FLOW_LABELS.end, tone: "flow", label: "End chain", summary: "" };
        default: return { tag: "", tone: "flow", label: "Unknown step", summary: "" };
    }
}

function describeActionStep(step, definition, { selectableTypes, customVariables, stateVariables, lookups }) {
    // An action the loadout no longer offers still shows, so the step can be changed or deleted.
    if (!definition) return { tag: "ACTION", tone: "action", label: "Unavailable action", summary: "Not in your loadout" };
    const head = definition.head;
    const tag = CHAIN_CATEGORY_LABELS[head] ?? "ACTION";
    // Row 2 is the action's name, as on the main canvas ("Dash", "Walk"); row 3 is its settings.
    let label = String(definition?.label ?? "Action").replace(/^(?:Ability|Weapon|Movement|Move|Rotate|Cancel):\s*/i, "");
    const parts = [];
    const mode = actionTargetMode(step, definition);
    if (head === ACTION_HEADS.VARIABLE) {
        const target = customVariables.find((variable) => variable.id === step.variableId);
        label = variableStepLabel(step, target, stateVariables);
    } else if (head === ACTION_HEADS.CANCEL) {
        label = "Cancel wind-up";
    } else if (definition?.movementConfig) {
        parts.push(movementPhrase(step, selectableTypes) + (definition?.id === BOT_CODE_ACTIONS.MOVE_WALK && step.sprint === true ? ", sprint" : ""));
    } else if (mode === "target") parts.push(targetText(step, selectableTypes));
    else if (mode === "coordinates") parts.push(formatPoint(step));
    else if (mode === "angle") parts.push(`${Number(step.targetAngle ?? 0)}° absolute`);
    if (step.aim === "lead") parts.push(`lead ${Number(step.leadSeconds ?? 0.5)} s`);
    else if (step.aim === "auto") parts.push("auto lead");
    if (definition?.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET && step.fastTurn === true) {
        if (parts.length) parts[parts.length - 1] += ", fast";
        else parts.push("Fast");
    }
    if (head === ACTION_HEADS.ABILITY && step.continue === "end") parts.push("waits for it to end");
    // The time goes after the settings on the same row: "to Opponent 1 for 0.5 s".
    const timing = head === ACTION_HEADS.MOVEMENT || head === ACTION_HEADS.ROTATION ? timingPhrase(step, lookups).text : "";
    return { tag, tone: "action", label, summary: [parts.join(", "), timing].filter(Boolean).join(" ") };
}

function variableStepLabel(step, target, stateVariables) {
    if (!target) return "Choose a variable";
    const terms = target.valueType === "boolean"
        ? [{ operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: step.operand ?? { type: "boolean", value: step.value ?? false } }]
        : variableActionTerms(step);
    const summary = variableActionSummary({ target, terms, stateVariables });
    // A change already leads with the variable's name; a plain set reads "Name = value".
    return terms[0]?.operator === CUSTOM_VARIABLE_OPERATIONS.SET || !terms[0]?.operator ? `${target.name} = ${summary}` : summary;
}

