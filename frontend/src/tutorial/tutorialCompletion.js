import {
    TUTORIAL_COMPLETION_PREFIX,
    loadTutorialBooleanState,
    saveTutorialBooleanState,
} from "../gameArena/persistence/tutorialStorage.js";

/** Lesson-specific completion checks for the browser tutorial practice room. */
export function tutorialGoalSatisfied(scenario, shapes) {
    if (scenario?.goal === "fireball_hit") {
        return (Array.isArray(shapes) ? shapes : []).some((shape) => (
            Number(shape?.teamNumber) === 2
            && Number(shape?.health?.damageTakenLastTick ?? shape?.damageTakenLastTick ?? 0) > 0
        ));
    }
    return false;
}

/** Persist a tutorial goal once; returning true means it completed just now. */
export function completeTutorialGoal(scenario, shapes, step = scenario?.id) {
    if (!tutorialGoalSatisfied(scenario, shapes)) return false;
    if (loadTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, step)) return false;
    saveTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, step, true);
    return true;
}
