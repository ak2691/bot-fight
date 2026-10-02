import { useCallback, useEffect, useId, useRef, useState } from "react";
import { loadTutorialGuideProgress, saveTutorialGuideProgress } from "../gameArena/persistence/tutorialStorage.js";
import { getTutorialLesson, TUTORIAL_CATEGORIES } from "./TutorialContent.js";
import TutorialNodeVisual from "./TutorialNodeVisuals.jsx";
import { useStackedLayout } from "./useStackedLayout.js";
import "./tutorialGuide.css";

function LessonDescription({ description, className = "", visuals = null, compact = false, showStepNumbers = true }) {
    const bodyTextClass = compact ? "text-sm leading-6" : "text-[15px] leading-7";
    return (
        <div className={`space-y-4 ${className}`}>
            {description.map((paragraph, index) => (
                <div key={typeof paragraph === "string" ? paragraph : `${paragraph.type}-${index}`}>
                    {paragraph?.type === "steps" ? (
                        showStepNumbers ? (
                            <ol start={paragraph.start ?? 1} className={`tutorial-guide-steps max-w-[65ch] list-decimal space-y-1.5 pl-6 ${bodyTextClass} text-slate-200`}>
                                {paragraph.items.map((step) => <li key={step}>{step}</li>)}
                            </ol>
                        ) : (
                            <div className={`tutorial-guide-steps max-w-[65ch] space-y-2 ${bodyTextClass} text-slate-200`}>
                                {paragraph.items.map((step) => <p key={step}>{step}</p>)}
                            </div>
                        )
                    ) : (
                        <p className={`max-w-[65ch] ${bodyTextClass} text-slate-300`}>
                            {paragraph.split("\n").map((line, lineIndex) => (
                                <span key={`${lineIndex}-${line}`}>
                                    {lineIndex > 0 && <br />}
                                    {line}
                                </span>
                            ))}
                        </p>
                    )}
                    {visuals?.[index] && <TutorialNodeVisual kind={visuals[index]} />}
                </div>
            ))}
        </div>
    );
}

function clampGuidePage(value, pageCount) {
    const maxPage = Math.max(0, pageCount - 1);
    const numericValue = Number(value);
    const page = Number.isFinite(numericValue) ? Math.trunc(numericValue) : 0;
    return Math.max(0, Math.min(maxPage, page));
}

function guidePagesForDescription(description = []) {
    return description.flatMap((paragraph) => {
        if (paragraph?.type !== "steps" || !Array.isArray(paragraph.items)) return [paragraph];
        return paragraph.items.map((item, index) => ({ type: "steps", items: [item], start: index + 1 }));
    });
}

function lessonPosition(lessonId) {
    for (const category of TUTORIAL_CATEGORIES) {
        const index = category.lessons.findIndex((candidate) => candidate.id === lessonId);
        if (index >= 0) return { chapter: category.title, number: index + 1 };
    }
    return { chapter: "Tutorial", number: 1 };
}

function ChevronIcon({ direction = "left" }) {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={direction === "left" ? "m15 6-6 6 6 6" : direction === "down" ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} />
        </svg>
    );
}

export default function TutorialGuide({ lessonId, minimized: minimizedProp = null, onMinimizedChange = null, variant = "arena" }) {
    const lesson = getTutorialLesson(lessonId);
    const [internalMinimized, setInternalMinimized] = useState(true);
    const [peek, setPeek] = useState(false);
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const progressKey = lessonId;
    const guidePages = guidePagesForDescription(lesson?.description);
    const pageCount = guidePages.length;
    const [pageIndex, setPageIndex] = useState(() => clampGuidePage(loadTutorialGuideProgress(progressKey), pageCount));
    const loadedProgressKeyRef = useRef(progressKey);
    const skipProgressSaveRef = useRef(false);
    const hostRef = useRef(null);
    const dragStartYRef = useRef(null);
    const panelId = `tutorial-guide-panel-${useId().replaceAll(":", "")}`;
    const isWorkspace = variant === "workspace";
    // The arena card starts as a pill; the workspace dock has its own collapsed state.
    const minimized = typeof minimizedProp === "boolean" ? minimizedProp : internalMinimized;
    const stacked = useStackedLayout();
    // Stacked layouts start with the sheet closed; the desktop dock starts open.
    const [workspaceCollapsed, setWorkspaceCollapsed] = useState(() => isWorkspace && stacked);
    const visiblePageIndex = clampGuidePage(pageIndex, pageCount);
    const currentPage = guidePages[visiblePageIndex];
    const position = lessonPosition(lessonId);

    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (loadedProgressKeyRef.current === progressKey) return;
        loadedProgressKeyRef.current = progressKey;
        skipProgressSaveRef.current = true;
        setPageIndex(clampGuidePage(loadTutorialGuideProgress(progressKey), pageCount));
    }, [pageCount, progressKey]);

    // Re-read saved progress when the arena card reopens, so both guides stay in step.
    const previousMinimizedRef = useRef(minimized);
    useEffect(() => {
        const wasMinimized = previousMinimizedRef.current;
        previousMinimizedRef.current = minimized;
        if (minimized || wasMinimized === minimized || loadedProgressKeyRef.current !== progressKey) return;
        const stored = clampGuidePage(loadTutorialGuideProgress(progressKey), pageCount);
        if (stored === visiblePageIndex) return;
        skipProgressSaveRef.current = true;
        setPageIndex(stored);
    }, [minimized, pageCount, progressKey, visiblePageIndex]);

    // Workspace dock: collapse to its header and step aside while the side config panel is open.
    useEffect(() => {
        if (!isWorkspace) return undefined;
        const scope = hostRef.current?.closest(".code-workspace") ?? document.body;
        const check = () => {
            const open = Boolean(scope.querySelector(".code-inspector"));
            setInspectorOpen((current) => {
                if (open && !current) setWorkspaceCollapsed(true);
                return open;
            });
        };
        check();
        const observer = new MutationObserver(check);
        observer.observe(scope, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [isWorkspace]);
    /* eslint-enable react-hooks/set-state-in-effect */

    useEffect(() => {
        if (skipProgressSaveRef.current) {
            skipProgressSaveRef.current = false;
            return;
        }
        saveTutorialGuideProgress(progressKey, visiblePageIndex);
    }, [progressKey, visiblePageIndex]);

    const setMinimized = useCallback((next) => {
        if (typeof minimizedProp !== "boolean") setInternalMinimized(next);
        onMinimizedChange?.(next);
        if (!next) setPeek(false);
    }, [minimizedProp, onMinimizedChange]);
    const changePage = (offset) => setPageIndex((current) => clampGuidePage(current + offset, pageCount));

    if (!lesson) return null;

    const counter = `${visiblePageIndex + 1}/${pageCount}`;
    const atStart = visiblePageIndex <= 0;
    const atEnd = visiblePageIndex >= pageCount - 1;
    const eyebrow = `${position.chapter} · Lesson ${position.number}`;
    const collapseGuide = () => (isWorkspace ? setWorkspaceCollapsed(true) : setMinimized(true));
    const openGuide = () => (isWorkspace ? setWorkspaceCollapsed(false) : setMinimized(false));

    const navigation = (
        <div className="tg-nav" role="group" aria-label={`Navigate ${lesson.title} pages`}>
            <button type="button" className="tg-btn tg-btn--back" onClick={() => changePage(-1)} disabled={atStart} aria-label="Previous lesson page" title="Previous page"><ChevronIcon /></button>
            <button
                type="button"
                className="tg-btn tg-btn--next"
                onClick={() => (atEnd ? collapseGuide() : changePage(1))}
                aria-label={atEnd ? "Finish lesson guide" : "Next lesson page"}
                title={atEnd ? "Done" : "Next page"}
            >
                {atEnd ? "Done" : "Next"}
            </button>
        </div>
    );

    const pill = (
        <button
            type="button"
            onClick={openGuide}
            className="tg-pill"
            aria-label={`Open ${lesson.title} lesson, step ${counter}`}
            aria-expanded="false"
            aria-controls={panelId}
            title={lesson.title}
        >
            <svg viewBox="0 0 24 24" className="tg-pill__icon" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Zm0 13a3 3 0 0 1 3-3h11" /></svg>
            <span className="tg-pill__name">{lesson.title}</span>
            <span className="tg-pill__count">{counter}</span>
        </button>
    );

    const isSteps = currentPage?.type === "steps";
    const card = (closeLabel, sheet) => (
        <aside id={panelId} className={`tg-card ${sheet ? "tg-card--sheet" : ""} ${peek ? "is-peek" : ""}`} aria-label={`${lesson.title} lesson, page ${counter}`}>
            <button
                type="button"
                className="tg-card__handle"
                aria-label={peek ? "Expand lesson" : "Collapse lesson to a bar"}
                onPointerDown={(event) => { dragStartYRef.current = event.clientY; }}
                onPointerUp={(event) => {
                    const start = dragStartYRef.current;
                    dragStartYRef.current = null;
                    if (start == null) return;
                    const delta = event.clientY - start;
                    if (delta > 36) setPeek(true);
                    else if (delta < -36) setPeek(false);
                    else setPeek((current) => !current);
                }}
            ><span aria-hidden="true" /></button>
            <header className="tg-card__header">
                <div className="min-w-0 flex-1">
                    <p className="tg-eyebrow">{eyebrow}</p>
                    <h2 className="tg-title" title={lesson.title}>{lesson.title}</h2>
                </div>
                <span className="tg-card__count" aria-live="polite">{counter}</span>
                <button type="button" onClick={collapseGuide} className="tg-minimize" aria-label={closeLabel} title={closeLabel}><span aria-hidden="true">{sheet ? "×" : "–"}</span></button>
            </header>
            {!peek && (
                <>
                    <div className="tg-dots" role="presentation">
                        {guidePages.map((_, index) => <span key={index} className={index <= visiblePageIndex ? "is-on" : ""} />)}
                    </div>
                    <div className="tg-card__body">
                        {currentPage != null && !isSteps && (
                            <LessonDescription
                                description={[currentPage]}
                                visuals={lesson.visuals?.[visiblePageIndex] ? { 0: lesson.visuals[visiblePageIndex] } : null}
                                compact
                            />
                        )}
                        {isSteps && (
                            <div className="tg-task">
                                <p className="tg-task__label">Your task</p>
                                <p className="tg-task__text">{currentPage.items[0]}</p>
                            </div>
                        )}
                    </div>
                    {navigation}
                </>
            )}
        </aside>
    );

    // Stacked layouts and phones: a round lesson button opens the guide as a bottom sheet.
    if (stacked) {
        const sheetOpen = isWorkspace ? !workspaceCollapsed : !minimized;
        return (
            <div ref={hostRef} className={`tg-stacked ${isWorkspace ? "tg-stacked--workspace" : ""}`}>
                {sheetOpen ? card("Close lesson", true) : (
                    <button type="button" className="tg-fab" onClick={openGuide} aria-label="Open lesson" title={`${lesson.title} · step ${counter}`}>
                        <svg viewBox="0 0 24 24" className="tg-fab__icon" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Zm0 13a3 3 0 0 1 3-3h11" /></svg>
                        <span className="tg-fab__badge">{counter}</span>
                    </button>
                )}
            </div>
        );
    }

    if (isWorkspace) {
        return (
            <div ref={hostRef} className={`tg-dock ${inspectorOpen ? "tg-dock--inspector-open" : ""} ${workspaceCollapsed ? "is-collapsed" : ""}`}>
                {workspaceCollapsed ? pill : card("Collapse lesson", false)}
            </div>
        );
    }

    return minimized ? pill : card("Minimize lesson", false);
}

export { LessonDescription };
