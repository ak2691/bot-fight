import { useId, useLayoutEffect, useRef, useState } from "react";
import { getTutorialLesson } from "./TutorialContent.js";
import TutorialNodeVisual from "./TutorialNodeVisuals.jsx";

function LessonDescription({ description, className = "", visuals = null, compact = false, showStepNumbers = true }) {
    const bodyTextClass = compact ? "text-sm leading-6" : "text-base leading-7";
    const visualTextWidthClass = visuals ? "max-w-5xl" : "";
    return (
        <div className={`space-y-4 ${className}`}>
            {description.map((paragraph, index) => (
                <div key={typeof paragraph === "string" ? paragraph : `${paragraph.type}-${index}`}>
                    {paragraph?.type === "steps" ? (
                        showStepNumbers ? (
                            <ol className={`tutorial-guide-steps list-decimal space-y-2 pl-6 ${bodyTextClass} text-slate-200 ${visualTextWidthClass}`}>
                                {paragraph.items.map((step) => <li key={step}>{step}</li>)}
                            </ol>
                        ) : (
                            <div className={`tutorial-guide-steps space-y-2 ${bodyTextClass} text-slate-200 ${visualTextWidthClass}`}>
                                {paragraph.items.map((step) => <p key={step}>{step}</p>)}
                            </div>
                        )
                    ) : (
                        <p className={`${bodyTextClass} text-slate-200 ${visualTextWidthClass}`}>
                            {paragraph.split("\n").map((line, index) => (
                                <span key={`${index}-${line}`}>
                                    {index > 0 && <br />}
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

export default function TutorialGuide({ lessonId, minimized: minimizedProp = null, onMinimizedChange = null, variant = "arena" }) {
    const lesson = getTutorialLesson(lessonId);
    const [internalMinimized, setInternalMinimized] = useState(true);
    const descriptionRef = useRef(null);
    const descriptionScrollTopRef = useRef(0);
    const previousLessonIdRef = useRef(lessonId);
    const panelId = `tutorial-guide-panel-${useId().replaceAll(":", "")}`;
    const minimized = typeof minimizedProp === "boolean" ? minimizedProp : internalMinimized;
    const variantClass = variant === "workspace" ? "tutorial-guide--workspace" : "tutorial-guide--arena";
    useLayoutEffect(() => {
        if (previousLessonIdRef.current !== lessonId) {
            previousLessonIdRef.current = lessonId;
            descriptionScrollTopRef.current = 0;
        }
        if (!minimized && descriptionRef.current) {
            descriptionRef.current.scrollTop = descriptionScrollTopRef.current;
        }
    }, [lessonId, minimized]);
    const setMinimized = (next) => {
        if (typeof minimizedProp !== "boolean") setInternalMinimized(next);
        onMinimizedChange?.(next);
    };

    if (!lesson) return null;

    if (minimized) {
        return (
            <button
                type="button"
                onClick={() => setMinimized(false)}
                className={`tutorial-guide-button ${variantClass} info-popup-minimized gray-button-surface flex items-center gap-2 rounded-lg border border-cyan-400/40 px-3 py-2 text-left shadow-2xl`}
                aria-label={`Open ${lesson.title} lesson`}
                aria-expanded="false"
                aria-controls={panelId}
            >
                <span className="tutorial-guide-button__label font-mono text-[9px] font-bold tracking-[.16em] text-slate-300">VIEW LESSON</span>
                <img src="/assets/homepage/book-icon.svg" alt="" aria-hidden="true" className="tutorial-guide-button__icon h-5 w-5" />
            </button>
        );
    }

    return (
        <aside id={panelId} className={`tutorial-guide-panel ${variantClass} info-popup-panel font-interface w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-400/30 bg-[#07111b] shadow-[0_18px_50px_rgba(0,0,0,.48)]`} aria-label={`${lesson.title} lesson`}>
            <div className="tutorial-guide-header flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="font-mono text-[9px] font-bold tracking-[.16em] text-cyan-300">TUTORIAL</p>
                    <p className="mt-2 break-words font-mono text-lg font-bold leading-tight text-white">{lesson.title}</p>
                </div>
                <button type="button" onClick={() => setMinimized(true)} className="puzzle-info-minimize" aria-label={`Minimize ${lesson.title} lesson`} title="Minimize lesson"><span aria-hidden="true">-</span></button>
            </div>
            <div
                ref={descriptionRef}
                onScroll={(event) => { descriptionScrollTopRef.current = event.currentTarget.scrollTop; }}
                className="tutorial-guide-content p-3.5"
            >
                <LessonDescription description={lesson.description} compact />
            </div>
        </aside>
    );
}

export { LessonDescription };
