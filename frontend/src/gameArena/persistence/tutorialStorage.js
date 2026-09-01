import { getTutorialScenario } from "../../tutorial/TutorialPresets.js";
import { loadStoredStrategyConfiguration } from "./arenaStrategyStorage.js";

const TUTORIAL_STRATEGY_PREFIX = "arena-tutorial-strategy-v2-";
export const TUTORIAL_COMPLETION_PREFIX = "arena-tutorial-completion-v2-";
export const TUTORIAL_SOLUTION_PREFIX = "arena-tutorial-solution-v2-";
const TUTORIAL_CHALLENGE_VERSION_PREFIX = "arena-tutorial-challenge-v2-";
const RESET_TUTORIAL_CHALLENGE_IDS = new Set(["rotate", "lock-on", "dodge"]);

export function tutorialStrategyConfigurationKey(step) {
    return `${TUTORIAL_STRATEGY_PREFIX}${getTutorialScenario(step).id ?? step}`;
}

export function loadTutorialStrategyConfiguration(step, fallback) {
    const key = tutorialStrategyConfigurationKey(step);
    try {
        return localStorage.getItem(key) ? loadStoredStrategyConfiguration(key) : fallback;
    } catch {
        return fallback;
    }
}

function tutorialBooleanStateKey(prefix, step) {
    return `${prefix}${getTutorialScenario(step).id ?? step}`;
}

function tutorialChallengeVersionKey(step) {
    return `${TUTORIAL_CHALLENGE_VERSION_PREFIX}${getTutorialScenario(step).id ?? step}`;
}

export function loadTutorialBooleanState(prefix, step) {
    try {
        const scenario = getTutorialScenario(step);
        if (prefix === TUTORIAL_COMPLETION_PREFIX
            && RESET_TUTORIAL_CHALLENGE_IDS.has(scenario.id)
            && localStorage.getItem(tutorialChallengeVersionKey(step)) !== "true") return false;
        const currentValue = localStorage.getItem(tutorialBooleanStateKey(prefix, step));
        return currentValue === "true";
    } catch {
        return false;
    }
}

export function saveTutorialBooleanState(prefix, step, value) {
    try {
        localStorage.setItem(tutorialBooleanStateKey(prefix, step), String(Boolean(value)));
        if (prefix === TUTORIAL_COMPLETION_PREFIX && RESET_TUTORIAL_CHALLENGE_IDS.has(getTutorialScenario(step).id)) {
            localStorage.setItem(tutorialChallengeVersionKey(step), "true");
        }
    } catch {
        // Tutorial memory is best-effort when browser storage is unavailable.
    }
}

export function tutorialChallengeForScenario(step, scenario) {
    const completed = loadTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, step);
    return {
        status: "idle",
        remainingMs: scenario.durationMs ?? 0,
        code: "ready",
        completed,
        initialRunComplete: scenario.id === "priority" ? completed : false,
    };
}
