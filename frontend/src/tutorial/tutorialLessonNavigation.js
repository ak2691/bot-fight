import { getTutorialLesson, practiceLessonsForTutorial } from "./TutorialContent.js";

function lessonNavigationTarget(lesson) {
    return lesson ? { lesson, path: `/tutorial?lesson=${encodeURIComponent(lesson.id)}` } : null;
}

export function tutorialLessonNavigationForArena({
    tutorialMode = false,
    lessonId = null,
    isMatchTesting = false,
    isReplay = false,
    isPuzzleMode = false,
    isPuzzleBuilder = false,
} = {}) {
    if (!tutorialMode || isMatchTesting || isReplay || isPuzzleMode || isPuzzleBuilder) return null;
    const lesson = getTutorialLesson(lessonId);
    if (!lesson?.scenarioId) return null;

    const lessons = practiceLessonsForTutorial();
    const currentIndex = lessons.findIndex((currentLesson) => currentLesson.id === lessonId);
    if (currentIndex < 0) return null;

    return {
        lesson,
        previous: lessonNavigationTarget(lessons[currentIndex - 1]),
        next: lessonNavigationTarget(lessons[currentIndex + 1]),
    };
}

export function captureTutorialNavigationScrollPosition({ windowTarget, contentShell, toolbarPanel } = {}) {
    return {
        windowX: windowTarget?.scrollX ?? 0,
        windowY: windowTarget?.scrollY ?? 0,
        contentX: contentShell?.scrollLeft ?? 0,
        contentY: contentShell?.scrollTop ?? 0,
        toolbarY: toolbarPanel?.scrollTop ?? 0,
    };
}

export function restoreTutorialNavigationScrollPosition(position, { windowTarget, contentShell, toolbarPanel } = {}) {
    if (!position) return;

    windowTarget?.scrollTo?.(position.windowX ?? 0, position.windowY ?? 0);
    if (contentShell) {
        contentShell.scrollLeft = position.contentX ?? 0;
        contentShell.scrollTop = position.contentY ?? 0;
    }
    if (toolbarPanel) toolbarPanel.scrollTop = position.toolbarY ?? 0;
}
