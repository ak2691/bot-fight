import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Navigate } from "react-router-dom";
import AppNavbar from "../components/AppNavbar.jsx";
import Arena from "../gameArena/Arena";
import { LessonDescription } from "./TutorialGuide.jsx";
import { getTutorialLesson, TUTORIAL_CATEGORIES, TUTORIAL_ENDING, TUTORIAL_INTRODUCTION, TUTORIAL_INTRODUCTION_VISUALS } from "./TutorialContent.js";

function scrollIdForCategory(categoryId) {
    return `tutorial-category-${categoryId}`;
}

function TutorialLessonCard({ lesson, navigate }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const descriptionId = `tutorial-lesson-description-${lesson.id}`;

    return (
        <article className={`tutorial-level border border-slate-700/70 bg-slate-950/25 p-5 sm:p-6 ${isExpanded ? "is-expanded" : ""}`}>
            <button
                type="button"
                onClick={() => setIsExpanded((current) => !current)}
                className="tutorial-level-toggle"
                aria-expanded={isExpanded}
                aria-controls={descriptionId}
            >
                <span className="min-w-0 font-display-action text-left text-2xl uppercase tracking-wider text-white sm:text-3xl">{lesson.title}</span>
                <span className={`tutorial-level__chevron ${isExpanded ? "is-open" : ""}`} aria-hidden="true" />
            </button>

            {isExpanded && (
                <div id={descriptionId} className="tutorial-level-description mt-5 max-w-5xl">
                    <LessonDescription description={lesson.description} />
                    {lesson.scenarioId && (
                        <div className="mt-5 flex justify-end border-t border-slate-800/80 pt-4">
                            <button
                                type="button"
                                onClick={() => navigate(`/tutorial?lesson=${encodeURIComponent(lesson.id)}`)}
                                className="tutorial-try-button"
                            >
                                Try it out
                            </button>
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}

export default function TutorialPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const lessonId = searchParams.get("lesson");
    const selectedLesson = getTutorialLesson(lessonId);
    const [showScrollTop, setShowScrollTop] = useState(false);

    const openCatalogue = (path) => {
        navigate(path);
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    useEffect(() => {
        const handleScroll = () => setShowScrollTop(window.scrollY > 180);
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    if (lessonId && selectedLesson?.scenarioId) return <Arena tutorialMode />;
    if (lessonId) return <Navigate to="/tutorial" replace />;

    return (
        <main className="tutorial-catalogue min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="tutorial" />

            <header className="border-b border-slate-800/80 px-5 py-14 sm:px-8 sm:py-20">
                <div className="mx-auto max-w-7xl">
                    <p className="font-mono text-[10px] font-bold tracking-[.32em] text-cyan-300">TUTORIAL</p>
                    <h1 className="mt-3 font-display-action text-5xl uppercase tracking-wide text-white sm:text-7xl">Welcome to Bot Fight</h1>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-slate-400">
                        Read through the guide to learn everything you need to know to get started.
                    </p>
                </div>
            </header>

            <div className="mx-auto max-w-7xl space-y-12 px-5 py-12 sm:px-8 sm:py-16">
                <section aria-labelledby="tutorial-introduction-title" className="border border-slate-700/70 bg-slate-950/30 p-5 sm:p-8">
                    <div className="border-b border-slate-700/60 pb-4">
                        <p className="font-mono text-[9px] font-bold tracking-[.28em] text-cyan-300">START HERE</p>
                        <h2 id="tutorial-introduction-title" className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white sm:text-4xl">How your bot thinks</h2>
                    </div>
                    <div className="mt-5 border border-cyan-400/30 bg-cyan-950/20 p-4 sm:p-5">
                        <p className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-300">READY TO START?</p>
                        <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-300">
                            You can jump straight into a lesson if you want. The detailed explanation below is optional. It explains how each node works, but you can learn the game by following the tutorial lessons instead.
                        </p>
                        <nav aria-label="Start a tutorial category" className="mt-4 flex flex-wrap gap-2">
                            {TUTORIAL_CATEGORIES.map((category) => (
                                <a key={category.id} href={`#${scrollIdForCategory(category.id)}`} className="catalogue-jump-button">
                                    Start {category.title}
                                </a>
                            ))}
                        </nav>
                    </div>
                    <LessonDescription description={TUTORIAL_INTRODUCTION} visuals={TUTORIAL_INTRODUCTION_VISUALS} className="mt-6" />
                </section>

                {TUTORIAL_CATEGORIES.map((category) => (
                    <section key={category.id} id={scrollIdForCategory(category.id)} aria-labelledby={`${category.id}-title`} className="scroll-mt-8">
                        <div className="mb-5 flex items-end justify-between gap-6 border-b border-slate-700/60 pb-3">
                            <div>
                                <h2 id={`${category.id}-title`} className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white sm:text-4xl">{category.title}</h2>
                            </div>
                        </div>

                        {category.description.length > 0 && (
                            <div className="tutorial-category-intro mb-5 border border-slate-700/60 bg-slate-950/25 p-5 sm:p-6">
                                <LessonDescription description={category.description} className="max-w-5xl" />
                            </div>
                        )}

                        <div className="space-y-4">
                            {category.lessons.map((lesson) => <TutorialLessonCard key={lesson.id} lesson={lesson} navigate={navigate} />)}
                        </div>
                    </section>
                ))}

                <section aria-labelledby="tutorial-ending-title" className="tutorial-category-intro border border-slate-700/70 bg-slate-950/30 p-5 sm:p-8">
                    <div className="border-b border-slate-700/60 pb-4">
                        <h2 id="tutorial-ending-title" className="font-display-action text-3xl uppercase tracking-wider text-white sm:text-4xl">The End</h2>
                    </div>
                    <LessonDescription description={TUTORIAL_ENDING} className="mt-6 max-w-5xl" />
                    <nav aria-label="Continue learning" className="mt-6 flex flex-wrap gap-3 border-t border-slate-700/60 pt-5">
                        <button type="button" onClick={() => openCatalogue("/ability-catalogue")} className="tutorial-try-button">
                            View Ability Catalogue
                        </button>
                        <button type="button" onClick={() => openCatalogue("/conditionals")} className="tutorial-try-button">
                            View Conditional Catalogue
                        </button>
                    </nav>
                </section>
            </div>

            {showScrollTop && (
                <button
                    type="button"
                    className="catalogue-scroll-top"
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    aria-label="Back to top"
                >
                    BACK TO TOP
                </button>
            )}
        </main>
    );
}
